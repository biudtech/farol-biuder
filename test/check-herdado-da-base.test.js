import { criteriaFixture } from './helpers/criteria-fixture.js';
// Check obrigatório herdado da base não pesa na decisão (17/11/2026, regra do dono).
//
// Caso de origem: acme/api#678 no desenho do caso real (PR de task para uma bancada
// `release_hmg_*`). A revisão pediu "os checks obrigatórios `osv` estão falhando no commit... com
// os checks verdes, sigo com a aprovação". O `osv` é obrigatório no ruleset da branch base, mas já
// falhava no commit atual da própria base: o PR herdou a falha. Nas palavras do dono: "não é
// momento de cobrar coisas que não são check required" e "merge-back também é pra ser algo sem
// atrito nenhum". O GitHub segura o merge pelo ruleset de qualquer jeito.
//
// A regra: check obrigatório que falha (ou está sem resultado) no head do PR e que está VERMELHO no
// commit atual da base é herdado. Base sem o check (ausente, rollup vazio, check que só roda em
// pull_request) ou com ele ainda rodando nunca herda: a base não mostra falha nenhuma (correção da
// revisão independente, 17/11/2026). O herdado não segura a aprovação (o revisor nunca espera o CI
// desde 17/11/2026, e o herdado nem vira o aviso do CI no card), não vira ressalva, nem motivo de
// reprovação, nem texto de cobrança no card. O check que só falha no PR continua valendo como
// antes, e a leitura da base que falha é conservadora: trata como não herdado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-check-herdado-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const BASE_SHA = 'c0ffee1f09f3cef5043ec47e5eebbc5e8c44eb9c';
const BASE = 'release_hmg_17';
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-11-17T12:00:00Z' });

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const runReal = io.run;
let envios = [];
let leiturasDaBase = 0;
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  // o estado dos checks no commit atual da branch base (uma consulta, em cache curto)
  if (sub.startsWith('api graphql') && sub.includes('statusCheckRollup')) {
    leiturasDaBase++;
    if (gh.baseFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ oid: BASE_SHA, mais: false, rollup: gh.rollupBase }) };
  }
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, baseRefName: BASE, statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes('--json baseRefName,headRefOid,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ baseRefName: BASE, headRefOid: HEAD, statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes(`rules/branches/${BASE}`)) return { ok: true, code: 0, stdout: JSON.stringify(gh.exigidos), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const checksMod = await import('../lib/engine/checks-exigidos.js');
const { avisoDosHerdados, avisoDaAprovacao, avisoDoCi, motivoDeEspera } = await import('../lib/engine/gate-espera.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { reviewActions } = await import('../lib/engine/decision.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  leiturasDaBase = 0;
  gh = {
    exigidos: ['osv', 'test'],
    rollup: [check('osv', 'FAILURE'), check('test', 'SUCCESS')],
    rollupBase: [check('osv', 'FAILURE'), check('test', 'SUCCESS')],
    baseFalha: false,
  };
});

// `politica` = [limpo, com ressalvas].
function motor({ politica = ['approve', 'approve'], reprova = 'request_changes' } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean: politica[0], onCaveats: politica[1], onReject: reprova };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n) => ({ key: `acme/api#${n}`, repo: 'acme/api', number: n, url: `https://github.com/acme/api/pull/${n}`, title: 'PR', author: 'dev', requested: true });
const pendente = (e, n) => e.decisions.pending.find((x) => x.key === `acme/api#${n}`);
const resolvida = (e, n) => decisoesResolvidas(e).find((x) => x.key === `acme/api#${n}`);
const textos = (lista) => (lista || []).map((r) => (r && r.text) || String(r));

async function revisar(n, opcoes, extra) {
  const e = motor(opcoes);
  sessao(e, extra);
  await e.runHeadlessReview(PR(n));
  return e;
}

/* ---------- a regra pura ---------- */

test('separarHerdados: vermelho no head e vermelho na base é herdado', () => {
  const r = checksMod.separarHerdados([{ nome: 'osv', estado: 'vermelho' }], [check('osv', 'FAILURE')]);
  assert.deepEqual(r.faltando, []);
  assert.deepEqual(r.herdados.map((h) => h.nome), ['osv']);
});

test('separarHerdados: vermelho só no PR (verde ou ausente na base) continua valendo', () => {
  assert.deepEqual(checksMod.separarHerdados([{ nome: 'osv', estado: 'vermelho' }], [check('osv', 'SUCCESS')]).faltando,
    [{ nome: 'osv', estado: 'vermelho' }], 'verde na base: a falha é do PR');
  assert.deepEqual(checksMod.separarHerdados([{ nome: 'osv', estado: 'vermelho' }], []).faltando,
    [{ nome: 'osv', estado: 'vermelho' }], 'ausente na base: a base não mostra falha nenhuma');
  assert.deepEqual(checksMod.separarHerdados([{ nome: 'osv', estado: 'vermelho' }], [check('osv', null, 'IN_PROGRESS')]).faltando,
    [{ nome: 'osv', estado: 'vermelho' }], 'rodando na base: ainda não falhou lá');
});

// Até a revisão independente (17/11/2026) este caso gravava o contrário: sem resultado no head e
// sem resultado verde na base contava como herdado. Corrigido: só a base VERMELHA herda. Sem
// resultado nos dois lados não prova falha nenhuma, e soltava a aprovação sem CI.
test('separarHerdados: sem resultado no head só é herdado com a base vermelha', () => {
  for (const estado of ['rodando', 'ausente']) {
    const r = checksMod.separarHerdados([{ nome: 'osv', estado }], [check('osv', 'FAILURE')]);
    assert.deepEqual(r.faltando, [], `${estado} no head com a base vermelha`);
    assert.equal(r.herdados.length, 1);
    for (const base of [[], [check('osv', null, 'IN_PROGRESS')]]) {
      const segue = checksMod.separarHerdados([{ nome: 'osv', estado }], base);
      assert.deepEqual(segue.faltando, [{ nome: 'osv', estado }], `${estado} no head com a base ${JSON.stringify(base)}: continua faltando`);
      assert.deepEqual(segue.herdados, []);
    }
  }
});

test('separarHerdados: check que só roda em pull_request (ausente na base) nunca é herdado', () => {
  const base = [check('test', 'SUCCESS'), check('build', 'SUCCESS')];
  for (const estado of ['vermelho', 'rodando', 'ausente']) {
    const r = checksMod.separarHerdados([{ nome: 'pr-title', estado }], base);
    assert.deepEqual(r.faltando, [{ nome: 'pr-title', estado }], estado);
    assert.deepEqual(r.herdados, []);
  }
});

test('separarHerdados: sem resultado no head e verde na base continua segurando', () => {
  const r = checksMod.separarHerdados([{ nome: 'osv', estado: 'rodando' }], [check('osv', 'SUCCESS')]);
  assert.deepEqual(r.faltando, [{ nome: 'osv', estado: 'rodando' }]);
  assert.deepEqual(r.herdados, []);
});

test('separarHerdados: base ilegível (null) não inventa herança', () => {
  const r = checksMod.separarHerdados([{ nome: 'osv', estado: 'vermelho' }], null);
  assert.deepEqual(r.faltando, [{ nome: 'osv', estado: 'vermelho' }]);
  assert.deepEqual(r.herdados, []);
});

/* ---------- a leitura da base ---------- */

test('bloqueadoPorChecks: o herdado sai do que falta, e o PR não fica bloqueado por ele', async () => {
  const e = motor();
  const r = await e.bloqueadoPorChecks(PR(1));
  assert.equal(r.bloqueado, false);
  assert.deepEqual(r.faltando, []);
  assert.deepEqual(r.herdados.map((h) => h.nome), ['osv']);
  assert.equal(r.verifiedHead, HEAD);
});

test('bloqueadoPorChecks: leitura da base que falha é conservadora, o check segue valendo', async () => {
  gh.baseFalha = true;
  const r = await motor().bloqueadoPorChecks(PR(2));
  assert.equal(r.bloqueado, true);
  assert.deepEqual(r.faltando, [{ nome: 'osv', estado: 'vermelho' }]);
  assert.deepEqual(r.herdados, []);
});

test('bloqueadoPorChecks: a base é lida uma vez e fica em cache curto; com tudo verde nem é lida', async () => {
  const e = motor();
  await e.bloqueadoPorChecks(PR(3));
  await e.bloqueadoPorChecks(PR(4));
  assert.equal(leiturasDaBase, 1, 'o mesmo repo@base não paga outra consulta dentro do prazo');
  gh.rollup = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  leiturasDaBase = 0;
  const outro = motor();
  const r = await outro.bloqueadoPorChecks(PR(5));
  assert.equal(r.bloqueado, false);
  assert.equal(leiturasDaBase, 0, 'sem check obrigatório fora do verde não há o que comparar');
});

test('checksDaBase: a resposta que não traz o commit da base é falha de leitura', async () => {
  const e = motor();
  const salvo = io.run;
  io.run = async () => ({ ok: true, code: 0, stdout: JSON.stringify({ oid: null, mais: false, rollup: [] }), stderr: '' });
  try {
    assert.equal(await checksMod.checksDaBase(e, 'eu', 'acme/api', BASE), null);
  } finally { io.run = salvo; }
  e.checksDaBaseCache = new Map();
  io.run = async () => ({ ok: true, code: 0, stdout: JSON.stringify({ oid: BASE_SHA, mais: true, rollup: [] }), stderr: '' });
  try {
    assert.equal(await checksMod.checksDaBase(e, 'eu', 'acme/api', BASE), null, 'lista cortada não prova ausência na base');
  } finally { io.run = salvo; }
});

test('check NÃO obrigatório não pesa, e nem chega a ler a base', async () => {
  gh.rollup = [check('osv', 'SUCCESS'), check('test', 'SUCCESS'), check('sonar', 'FAILURE')];
  const r = await motor().bloqueadoPorChecks(PR(6));
  assert.equal(r.bloqueado, false);
  assert.deepEqual(r.faltando, []);
  assert.equal(leiturasDaBase, 0);
});

/* ---------- a leitura fresca da base ---------- */

// Quem decide lê a base fresca (correção da revisão independente): a retirada do pedido (lerCi).
// A leitura da revisão usa o cache de um minuto.
test('leitura fresca no sentido que importa: o herdado em cache que deixou de ser não vale para quem lê fresco', async () => {
  const e = motor({ reprova: 'wait' });
  await e.bloqueadoPorChecks(PR(26));
  assert.ok(e.checksDaBaseCache.size, 'o cache guarda a base vermelha');
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  const lancamento = await e.bloqueadoPorChecks(PR(26));
  assert.deepEqual(lancamento.faltando, [], 'a leitura da revisão pode usar o cache de um minuto');
  const fresco = await e.bloqueadoPorChecks(PR(26), { fresco: true });
  assert.deepEqual(fresco.faltando, [{ nome: 'osv', estado: 'vermelho' }], 'quem lê fresco vê a base de agora');
});

/* ---------- na revisão: o revisor nunca espera o CI ---------- */

test('o herdado não segura a aprovação nem vira o aviso "aprovado com check obrigatório vermelho" no card', async () => {
  const e = await revisar(20);
  assert.equal(envios.length, 1);
  assert.deepEqual(textos(resolvida(e, 20).attention), []);
});

test('o check que só falha no PR não segura, e o card avisa com que CI a aprovação saiu', async () => {
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  const e = await revisar(21);
  assert.equal(envios.length, 1);
  assert.ok(textos(resolvida(e, 21).attention).some((t) => /aprovado com check obrigatório vermelho no head \(osv\)/.test(t)));
});

/* ---------- o card e o texto ---------- */

test('card na mesa: o herdado aparece numa linha informativa, que não é ressalva', async () => {
  const e = await revisar(30, { politica: ['wait', 'wait'] });
  const d = pendente(e, 30);
  const linha = (d.reasons || []).find((r) => /falha também no commit atual da branch base/.test(r.text));
  assert.ok(linha, textos(d.reasons).join(' | '));
  assert.equal(linha.informativo, true);
  assert.match(linha.text, /osv/);
  assert.doesNotMatch(linha.text, /precisa|corrij|antes do merge|esper/i, 'informa, não cobra');
  assert.deepEqual(attentionPoints(null, d).filter((p) => /branch base/.test(p.text)), [], 'a linha nunca conta como ressalva');
  assert.match(textos(d.reasons)[0], /sem ressalvas/, 'a classe é limpa: a política é a do limpo');
});

test('Panorama: a linha informativa do herdado não marca a decisão como aprovada com ressalva', async () => {
  const e = await revisar(31, { politica: ['wait', 'wait'] });
  const d = pendente(e, 31);
  assert.ok((d.reasons || []).some((r) => r.informativo === true));
  // a pendência resolvida pelo clique leva as mesmas reasons para o histórico
  const so = { ...d, reasons: d.reasons.filter((r) => r.informativo === true), status: 'posted', action: 'approve', resolvedAt: Date.now(), cardMet: true, attention: [], key: 'acme/api#931' };
  assert.equal(reviewActions(e, [so])['acme/api#931'].caveats, false);
  const com = { ...so, reasons: [...so.reasons, { text: 'ressalva de verdade', kind: 'content' }] };
  assert.equal(reviewActions(e, [com])['acme/api#931'].caveats, true, 'ressalva de verdade continua marcando');
});

test('os textos do CI só falam do check que pesa', () => {
  const r = { checksObrigatorios: [], checksHerdados: [{ nome: 'osv', estado: 'vermelho', naBase: 'vermelho' }] };
  assert.equal(motivoDeEspera(r), null);
  assert.deepEqual(avisoDoCi(r), []);
  assert.deepEqual(avisoDaAprovacao(r), []);
  assert.equal(avisoDosHerdados(r).length, 1);
  assert.deepEqual(avisoDosHerdados({ checksObrigatorios: [] }), []);
});
