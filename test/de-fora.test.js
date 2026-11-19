// "De fora da fila" (redesenho de 19/11/2026, lote 1): a lista dos PRs pedidos à conta que o
// motor NÃO vai revisar sozinho, com o motivo de cada um. É projeção do que o motor já decide
// (lib/engine/de-fora.js): nenhuma regra de gate, fila ou postagem muda aqui. O antimeta é um
// "De fora" que esconda PR que o motor ainda vai revisar sozinho, por isso cada caminho que
// revisa sozinho tem o seu caso de "não aparece", e o clique atravessa cada motivo listado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-de-fora-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '9c1f0e2d3b4a59687766554433221100ffeeddcc';
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let gh;
let jqLidos;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (sub.includes('--json reviewRequests,reviews')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ reviewRequests: gh.pedidos, reviews: [] }) };
  }
  if (/pulls\/\d+\/reviews\?per_page=100/.test(sub)) {
    jqLidos.push(args[args.length - 1]);
    return { ok: true, code: 0, stdout: JSON.stringify(gh.alheios), stderr: '' };
  }
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { deForaParaTela, emRetentativaParaTela } = await import('../lib/engine/de-fora.js');
const jiraMod = await import('../lib/engine/jira.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  jqLidos = [];
  gh = { pedidos: [{ __typename: 'User', login: 'eu' }], alheios: [] };
});

const PR = (n, extra = {}) => ({
  key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`,
  title: `PR ${n}`, author: 'dev', updatedAt: `2026-11-19T10:0${n % 10}:00Z`, labels: [], mine: true,
  account: 'eu', ...extra,
});

let logs;
function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'] };
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.headSha = async () => HEAD;
  e.pushState = () => { };
  e.saveAutoReviewParked = () => { };
  e.saveSkipComentado = () => { };
  e.saveIgnorados = () => { };
  e.writeInflight = () => { };
  logs = [];
  e.log = (nivel, texto) => { logs.push(`${nivel} ${texto}`); };
  e.on('toast', () => { });
  return e;
}

// fila e panorama do mesmo jeito que o ciclo monta: o PR pedido está nos dois
function comFila(e, ...prs) {
  e.queue = prs;
  e.panorama = prs.map(p => ({ ...p }));
  return e;
}

const motivos = (e) => deForaParaTela(e).map(i => [i.key, i.motivo]);

/* ---------- o que o motor revisa sozinho nunca aparece ---------- */

test('fila comum: nada fica de fora', () => {
  const e = comFila(motor(), PR(1), PR(2));
  assert.deepEqual(deForaParaTela(e), []);
});

test('conflito com a base, limite do plano e retentativa: o motor ainda revisa sozinho', () => {
  const e = comFila(motor(), PR(1), PR(2), PR(3));
  e.esperaConflito = { 'acme/app#1': { at: 1, head: HEAD, updatedAt: 'x' } };
  e.limiteDoPlanoAte = () => Date.now() + 60000;
  e.retryAfterNet.set('acme/app#3', { tries: 1, pr: PR(3), notBefore: null });
  assert.deepEqual(deForaParaTela(e), []);
});

test('retentativa com o automático desligado: a retentativa retoma sozinha, não fica de fora', () => {
  const e = comFila(motor(), PR(4));
  e.autoReviewFor = () => false;
  e.retryAfterNet.set('acme/app#4', { tries: 2, pr: PR(4), notBefore: null });
  assert.deepEqual(deForaParaTela(e), []);
});

test('PR em revisão, na fila da vaga ou abrindo sessão não fica de fora', () => {
  const e = comFila(motor(), PR(1), PR(2), PR(3));
  e.autoReviewFor = () => false;
  e.activeReviews.set('s1', { keys: ['acme/app#1'] });
  e.headlessQueue = [PR(2)];
  e.headlessIniciando = new Set(['acme/app#3']);
  assert.deepEqual(deForaParaTela(e), []);
});

test('PR próprio não entra, e rascunho não é motivo (entra só por outro)', () => {
  const e = comFila(motor(), PR(1, { author: 'EU' }), PR(2, { isDraft: true }));
  e.ignorados = new Set(['acme/app#1']);
  assert.deepEqual(deForaParaTela(e), []);
  e.autoReviewFor = () => false;
  assert.deepEqual(motivos(e), [['acme/app#2', 'auto_desligado']]);
});

test('PR fora dos pedidos à conta não entra, nem estacionado nem ignorado', () => {
  const e = comFila(motor());
  e.panorama = [PR(5, { mine: false }), PR(6, { mine: false })];
  e.autoReviewParked.add('acme/app#5');
  e.ignorados = new Set(['acme/app#6']);
  assert.deepEqual(deForaParaTela(e), []);
});

/* ---------- um caso por motivo ---------- */

test('estacionado: tipo e motivo no detalhe, a hora e o head da parada', () => {
  const e = comFila(motor());
  e.panorama = [PR(7)];
  e.autoReviewParked.add('acme/app#7');
  e.parkedMotivos = { 'acme/app#7': { at: '2026-11-19T09:00:00.000Z', motivo: 'sessão caiu', tipo: 'esgotado', head: 'abc123' } };
  assert.deepEqual(deForaParaTela(e), [{
    key: 'acme/app#7', url: PR(7).url, title: 'PR 7', author: 'dev', repo: 'acme/app', number: 7,
    motivo: 'estacionado', detalhe: { tipo: 'esgotado', motivo: 'sessão caiu' },
    desde: Date.parse('2026-11-19T09:00:00.000Z'), head: 'abc123',
  }]);
});

test('outra conta pela saída de cena: quem, desde quando e o head', () => {
  const e = comFila(motor(), PR(8));
  e.skipComentado = { 'acme/app#8': { head: 'h8', quem: ['ana'], at: 1700 } };
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'outra_conta');
  assert.deepEqual(item.quem, ['ana']);
  assert.equal(item.desde, 1700);
  assert.equal(item.head, 'h8');
  assert.deepEqual(item.detalhe, { fonte: 'saida_de_cena' });
});

test('outra conta pela label viva: quem e desde quando a label é vista', () => {
  const e = comFila(motor(), PR(9, { outrosRevisando: ['bia'] }));
  e.labelVistaDesde = { 'acme/app#9': { bia: 2500 } };
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'outra_conta');
  assert.deepEqual(item.quem, ['bia']);
  assert.equal(item.desde, 2500);
  assert.equal(item.head, null);
  assert.deepEqual(item.detalhe, { fonte: 'label' });
});

test('decisão de gente: quem, o estado e quando, lidos do submitted_at', async () => {
  const e = comFila(motor(), PR(10));
  gh.alheios = [
    { quem: 'carla', tipo: 'User', state: 'CHANGES_REQUESTED', commit_id: HEAD, em: '2026-11-19T08:00:00Z' },
    { quem: 'carla', tipo: 'User', state: 'APPROVED', commit_id: HEAD, em: '2026-11-19T08:30:00Z' },
    { quem: 'acrity-advesarial-code-review[bot]', tipo: 'Bot', state: 'CHANGES_REQUESTED', commit_id: HEAD, em: '2026-11-19T08:40:00Z' },
  ];
  const antes = Date.now();
  assert.equal(await e.bloqueiaAutomatico(PR(10)), true);
  assert.ok(jqLidos.some(jq => jq.includes('submitted_at')), 'a leitura dos reviews traz o submitted_at');
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'decisao_de_gente');
  assert.deepEqual(item.quem, ['carla']);
  assert.equal(item.head, HEAD);
  assert.deepEqual(item.detalhe, { decisivos: [{ quem: 'carla', estado: 'APPROVED', em: '2026-11-19T08:30:00Z' }] });
  assert.ok(item.desde >= antes && item.desde <= Date.now());
});

test('decisão de gente some quando o motor deixa de segurar (head novo sem decisão)', async () => {
  const e = comFila(motor(), PR(11));
  gh.alheios = [{ quem: 'carla', tipo: 'User', state: 'APPROVED', commit_id: HEAD, em: '2026-11-19T08:30:00Z' }];
  assert.equal(await e.bloqueiaAutomatico(PR(11)), true);
  assert.equal(deForaParaTela(e).length, 1);
  gh.alheios = [];
  const mudou = PR(11, { updatedAt: '2026-11-19T11:00:00Z' });
  comFila(e, mudou);
  assert.equal(await e.bloqueiaAutomatico(mudou), false);
  assert.deepEqual(deForaParaTela(e), []);
});

test('pedido retirado: o pedido não está mais com a conta', async () => {
  const e = comFila(motor(), PR(12));
  gh.pedidos = [{ __typename: 'Team', name: 'squad', slug: 'squad' }];
  assert.equal(await e.bloqueiaAutomatico(PR(12)), true);
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'pedido_retirado');
  assert.ok(Number.isFinite(item.desde));
});

test('a recusa na boca da sessão grava o mesmo registro (pedido retirado e decisão de gente)', async () => {
  const e = comFila(motor(), PR(13), PR(14));
  gh.pedidos = [];
  await e.runOneHeadless(PR(13, { requested: true }), 'eu');
  gh.pedidos = [{ __typename: 'User', login: 'eu' }];
  gh.alheios = [{ quem: 'davi', tipo: 'User', state: 'CHANGES_REQUESTED', commit_id: HEAD, em: '2026-11-19T07:00:00Z' }];
  await e.runOneHeadless(PR(14, { requested: true }), 'eu');
  assert.deepEqual(motivos(e), [['acme/app#13', 'pedido_retirado'], ['acme/app#14', 'decisao_de_gente']]);
});

test('regra manual por organização e por autor, com a origem', () => {
  const e = comFila(motor(), PR(15), PR(16, { author: 'estagiario' }));
  e.config.conta.reviewRules = { acme: { mode: 'manual', authors: { estagiario: 'manual' } } };
  const [org, autor] = deForaParaTela(e);
  assert.equal(org.motivo, 'regra_manual');
  assert.deepEqual(org.detalhe, { source: 'organizacao', organization: 'acme' });
  assert.equal(autor.motivo, 'regra_manual');
  assert.deepEqual(autor.detalhe, { source: 'autor', organization: 'acme', author: 'estagiario' });
});

test('automático desligado na conta', () => {
  const e = comFila(motor(), PR(17));
  e.autoReviewFor = () => false;
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'auto_desligado');
  assert.deepEqual(item.detalhe, {});
});

test('ignorado: cruzado com o panorama, sem data', () => {
  const e = comFila(motor());
  e.panorama = [PR(18)];
  e.ignorados = new Set(['acme/app#18']);
  const [item] = deForaParaTela(e);
  assert.equal(item.motivo, 'ignorado');
  assert.equal(item.desde, null);
});

/* ---------- precedência: estacionado, outra conta, decisão, pedido, regra, ignorado ---------- */

test('precedência quando há dois motivos', () => {
  const e = comFila(motor(), PR(20), PR(21), PR(22));
  e.panorama.push(PR(19));
  e.autoReviewParked.add('acme/app#19');
  e.skipComentado = { 'acme/app#19': { head: 'h', quem: ['ana'], at: 1 }, 'acme/app#20': { head: 'h', quem: ['ana'], at: 1 } };
  e.seguradoPorGente = new Map([
    ['acme/app#20', { head: HEAD, motivo: 'decisao_de_gente', decisivos: [{ quem: 'carla', estado: 'APPROVED', em: '' }], desde: 5 }],
    ['acme/app#21', { head: HEAD, motivo: 'pedido_retirado', decisivos: [], desde: 5 }],
    ['acme/app#22', { head: HEAD, motivo: 'decisao_de_gente', decisivos: [{ quem: 'carla', estado: 'APPROVED', em: '' }], desde: 5 }],
  ]);
  e.config.conta.reviewRules = { acme: { mode: 'manual' } };
  assert.deepEqual(motivos(e).sort(), [
    ['acme/app#19', 'estacionado'], ['acme/app#20', 'outra_conta'],
    ['acme/app#21', 'pedido_retirado'], ['acme/app#22', 'decisao_de_gente'],
  ]);
});

test('a projeção não escreve no log', () => {
  const e = comFila(motor(), PR(23));
  e.autoReviewFor = () => false;
  deForaParaTela(e);
  assert.deepEqual(logs, []);
});

/* ---------- o clique atravessa cada motivo listado ---------- */

test('Revisar mesmo assim (POST /api/review) atravessa cada motivo', async () => {
  const casos = {
    estacionado: (e, p) => { e.queue = []; e.autoReviewParked.add(p.key); },
    outra_conta: (e, p) => { e.skipComentado = { [p.key]: { head: 'h', quem: ['ana'], at: 1 } }; },
    decisao_de_gente: (e, p) => { gh.alheios = [{ quem: 'carla', tipo: 'User', state: 'APPROVED', commit_id: HEAD, em: '' }]; e.seguradoPorGente = new Map([[p.key, { head: HEAD, motivo: 'decisao_de_gente', decisivos: [], desde: 1 }]]); },
    pedido_retirado: (e, p) => { gh.pedidos = []; e.seguradoPorGente = new Map([[p.key, { head: '', motivo: 'pedido_retirado', decisivos: [], desde: 1 }]]); },
    regra_manual: (e) => { e.config.conta.reviewRules = { acme: { mode: 'manual' } }; },
    auto_desligado: (e) => { e.autoReviewFor = () => false; },
    ignorado: (e, p) => { e.queue = []; e.ignorados = new Set([p.key]); },
  };
  let n = 30;
  for (const [motivo, preparar] of Object.entries(casos)) {
    gh = { pedidos: [{ __typename: 'User', login: 'eu' }], alheios: [] };
    const p = PR(n++);
    const e = comFila(motor(), p);
    preparar(e, p);
    assert.deepEqual(motivos(e), [[p.key, motivo]], `o caso de ${motivo} está de fora antes do clique`);
    const enfileirados = [];
    e.enqueueHeadless = (pr) => { enfileirados.push(pr.key); return { ok: true }; };
    const r = await e.launchReview([p.url], 'auto', 'clique');
    assert.equal(r.ok, true, `${motivo}: ${r.error || ''}`);
    assert.deepEqual(enfileirados, [p.key], motivo);
  }
});

/* ---------- os dados do Radar: retentativa e card ---------- */

test('emRetentativa: tentativas e a partir de quando, por PR', () => {
  const e = motor();
  e.retryAfterNet.set('acme/app#40', { tries: 2, pr: PR(40), notBefore: 5000 });
  e.retryAfterNet.set('acme/app#41', { tries: 0, pr: PR(41), notBefore: null });
  assert.deepEqual(emRetentativaParaTela(e), {
    'acme/app#40': { tentativas: 2, aPartirDe: 5000 },
    'acme/app#41': { tentativas: 0, aPartirDe: null },
  });
});

test('o snapshot leva deFora e emRetentativa', () => {
  const e = comFila(motor(), PR(42));
  e.autoReviewFor = () => false;
  e.retryAfterNet.set('acme/app#43', { tries: 1, pr: PR(43), notBefore: null });
  const s = e.snapshot();
  assert.deepEqual(s.deFora.map(i => i.motivo), ['auto_desligado']);
  assert.deepEqual(s.emRetentativa, { 'acme/app#43': { tentativas: 1, aPartirDe: null } });
  // a fila do motor não muda: a contagem limpa é do front
  assert.deepEqual(s.queue.map(p => p.key), ['acme/app#42']);
});

test('card na sessão ativa: a chave do card lido vai na projeção', () => {
  const e = motor();
  e.activeReviews.set('s1', { keys: ['acme/app#44'], label: 'x', mode: 'auto', startedAt: 1 });
  e.activeReviews.set('s2', { keys: ['acme/app#45'], label: 'y', mode: 'auto', startedAt: 1 });
  const lido = { ok: true, card: { key: 'PROJ-7', criteria: [] } };
  assert.equal(jiraMod.cardNaSessao(e, 's1', lido), lido);
  jiraMod.cardNaSessao(e, 's2', { ok: false, code: 'sem_chave' });
  jiraMod.cardNaSessao(e, 'sumiu', lido);
  const [s1, s2] = e.snapshot().activeSessions;
  assert.equal(s1.card, 'PROJ-7');
  assert.equal(Object.hasOwn(s2, 'card'), false);
});

test('a revisão anota o card logo depois de ler o Jira', () => {
  const fonte = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  assert.match(fonte, /const cardRes = jiraMod\.cardNaSessao\(engine, id, await jiraMod\.cardForPr\(engine, pr\)\);/);
});
