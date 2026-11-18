import { criteriaFixture } from './helpers/criteria-fixture.js';
// Os critérios do card um a um (17/11/2026, lib/engine/criterios-do-card.js): o campo OPCIONAL
// `criteriosDoCard` do envelope, gravado na decisão e mostrado no detalhe da revisão
// (GET /api/decision). Regra do dono: o campo NÃO entra em gate nenhum, não muda veredito,
// ressalva nem admissibilidade, e o envelope sem ele continua válido e igual a hoje. Os casos de
// baixo rodam a MESMA revisão com e sem o campo (e com ele dizendo o contrário do resto) e
// conferem que o que sai no GitHub e o que fica gravado são os mesmos.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-criterios-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const check = (name, conclusion) => ({ name, status: 'COMPLETED', conclusion, startedAt: '2026-11-17T12:00:00Z' });

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  }
  if (sub.includes('--json mergeable')) return { ok: true, code: 0, stdout: JSON.stringify({ mergeable: '' }), stderr: '' };
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(['test']), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const { criteriosDoCard, TETO_DE_CRITERIOS, TETO_DO_TEXTO } = await import('../lib/engine/criterios-do-card.js');
const { detalheDaDecisao } = await import('../lib/engine/detalhe-da-decisao.js');
const { parseEnvelope, parseHeadlessResult } = await import('../lib/engine/session.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { rollup: [check('test', 'SUCCESS')] };
});

function motor({ onClean = 'approve', onCaveats = 'approve', onReject = 'request_changes' } = {}) {
  const e = new Engine();
  e.config.aguardarCiParaAprovar = false;
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean, onCaveats, onReject };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

const envelope = (extra) => ({
  protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve',
  card: 'CARD-1', cardMet: true, reasons: [], coverage: { total: 0, reviewed: [], missing: [] },
  payloads: {
    approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' },
    request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' },
    comment: { event: 'COMMENT', body: 'Leitura completa.' },
  },
  reportMarkdown: '# ok', ...extra,
});

let numero = 100;
async function revisar(e, extra) {
  const n = ++numero;
  e.runClaudeStream = async () => ({ text: JSON.stringify(envelope(extra)), sessionId: `s${n}` });
  const pr = { key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', requested: true };
  const inicio = envios.length;
  await e.runHeadlessReview(pr);
  const d = e.decisions.pending.find((x) => x.key === pr.key) || decisoesResolvidas(e).find((x) => x.key === pr.key);
  return { d, envios: envios.slice(inicio), key: pr.key };
}

const textos = (lista) => (lista || []).map((r) => (r && r.text) || r);
// o que sai no GitHub e o que a decisão grava, sem o que muda de uma execução para outra e sem a
// própria lista dos critérios (que é a única coisa que pode diferir)
function semCriterios(provas) {
  const { criterios: _criterios, ...card } = provas.card;
  return { ...provas, card };
}
function desfecho({ d, envios: enviados }) {
  return {
    envios: enviados.map((p) => ({ event: p.event, body: p.body, commit_id: p.commit_id, comments: p.comments })),
    status: d.status, action: d.action, verdict: d.verdict, cardMet: d.cardMet, analysisStatus: d.analysisStatus,
    blockedReason: d.blockedReason, blockedKind: d.blockedKind, emEspera: !!d.esperaProva || !!d.esperaCi,
    reasons: textos(d.reasons), attention: textos(d.attention), approvalEvidence: d.approvalEvidence,
    provas: semCriterios(d.provas),
  };
}

const CRITERIOS = [
  { texto: 'Navegar entre as versões geradas', atende: true },
  { texto: 'Limite de cinco regenerações', atende: true },
  { texto: 'Editar a versão escolhida antes de enviar', atende: false },
];
// o campo dizendo o contrário do resto do envelope, e o campo torto: nada disso pesa
const VARIANTES = {
  'com os critérios': CRITERIOS,
  'com todos os critérios não atendidos': CRITERIOS.map((c) => ({ ...c, atende: false })),
  'com o campo torto': [7, null, { texto: '' }, { atende: true }, 'texto solto'],
  'com o campo que não é lista': { texto: 'x', atende: false },
};

const CENARIOS = {
  'aprovação limpa': { conta: {}, extra: {} },
  'card com a parte deste PR não entregue (reprova)': { conta: {}, extra: { cardMet: false, cardParteDestePr: false } },
  // até 17/11/2026 a conta da fixture esperava no com ressalvas, e havia o cenário da conta que
  // espera em tudo; o `wait` saiu (o revisor nunca espera decisão de gente), e esse cenário, que
  // repetiria a aprovação limpa, saiu junto
  'card inteiro não comprovado (ressalva, aprova com ela)': { conta: {}, extra: { cardMet: null, cardParteDestePr: true, decision: 'needs_decision' } },
  'card não lido': { conta: {}, extra: { card: null, cardMet: null, decision: 'needs_decision' } },
};

for (const [cenario, { conta, extra }] of Object.entries(CENARIOS)) {
  test(`${cenario}: o mesmo desfecho com e sem criteriosDoCard`, async () => {
    const base = desfecho(await revisar(motor(conta), extra));
    for (const [variante, valor] of Object.entries(VARIANTES)) {
      const com = desfecho(await revisar(motor(conta), { ...extra, criteriosDoCard: valor }));
      assert.deepEqual(com, base, variante);
    }
  });
}

test('os cenários cobrem os desfechos que importam: aprovar, reprovar e aprovar com ressalva', async () => {
  const r = [];
  for (const { conta, extra } of Object.values(CENARIOS)) r.push(await revisar(motor(conta), extra));
  assert.deepEqual(r.map((x) => x.envios.map((p) => p.event).join(',') || x.d.status), ['APPROVE', 'REQUEST_CHANGES', 'APPROVE', 'APPROVE']);
  assert.match(textos(r[2].d.attention).join(' | '), /card/, 'o terceiro cenário é o com ressalvas');
  assert.equal((r[0].d.attention || []).length, 0, 'o primeiro é o limpo');
});

test('a decisão grava os critérios declarados e o detalhe os entrega; sem o campo, a chave não existe', async () => {
  const e = motor();
  const com = await revisar(e, { criteriosDoCard: CRITERIOS });
  assert.deepEqual(com.d.provas.card.criterios, CRITERIOS);
  const detalhe = detalheDaDecisao(e, new URLSearchParams({ key: com.key }));
  assert.equal(detalhe.status, 200);
  assert.deepEqual(detalhe.body.decision.criteriosDoCard, CRITERIOS);

  const sem = await revisar(e, {});
  assert.equal('criterios' in sem.d.provas.card, false);
  assert.equal('criteriosDoCard' in detalheDaDecisao(e, new URLSearchParams({ key: sem.key })).body.decision, false);

  const torto = await revisar(e, { criteriosDoCard: [7, { texto: '  ' }] });
  assert.equal('criterios' in torto.d.provas.card, false, 'lista que fica vazia não vira chave');
});

test('o token partido pelo corte não escapa da máscara: a credencial sai antes de cortar', async () => {
  const segredo = 'ghp_' + 'Ab3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6';
  const texto = `${'a'.repeat(284)} ${segredo} fim`;
  assert.equal(texto.indexOf('ghp_'), 285);
  // a prova de que o corte sozinho deixaria escapar: o pedaço que sobra não casa mais
  const { hasCredential } = await import('../lib/sensitive-text.js');
  assert.equal(hasCredential(texto.slice(0, TETO_DO_TEXTO)), false);

  const e = motor();
  const r = await revisar(e, { criteriosDoCard: [{ texto, atende: true }] });
  const corpo = JSON.stringify(detalheDaDecisao(e, new URLSearchParams({ key: r.key })).body);
  assert.doesNotMatch(corpo, /ghp_/);
  assert.equal(corpo.includes(segredo.slice(4, 14)), false, 'nem um pedaço do segredo');
  assert.match(corpo, /\[credencial/, 'a marca da retirada no lugar do token');
  assert.doesNotMatch(JSON.stringify(r.d.provas), /ghp_/, 'nem na decisão gravada');
  assert.ok(Array.from(criteriosDoCard([{ texto }])[0].texto).length <= TETO_DO_TEXTO);
});

test('o detalhe confere de novo o que vem do disco', () => {
  const e = motor();
  e.decisions.pending.push({ id: 'd1', key: 'acme/app#9', createdAt: 1, status: 'pending', pr: { repo: 'acme/app', number: 9 },
    provas: { card: { inteiro: null, parteDestePr: null, criterios: [{ texto: 'ok', atende: 'sim' }, { texto: 5 }, { texto: 'x'.repeat(900), atende: false, extra: 'não passa' }] } } });
  const d = detalheDaDecisao(e, new URLSearchParams({ key: 'acme/app#9' })).body.decision;
  assert.deepEqual(d.criteriosDoCard, [{ texto: 'ok', atende: null }, { texto: 'x'.repeat(TETO_DO_TEXTO), atende: false }]);
});

test('criteriosDoCard: lista curta, texto limitado e atende só booleano', () => {
  assert.equal(criteriosDoCard(undefined), null);
  assert.equal(criteriosDoCard(null), null);
  assert.equal(criteriosDoCard('texto'), null);
  assert.equal(criteriosDoCard([]), null);
  assert.equal(criteriosDoCard([{ texto: '   ' }, null, 3]), null);
  assert.deepEqual(criteriosDoCard([{ texto: '  dois\n  espaços ', atende: true }]), [{ texto: 'dois espaços', atende: true }]);
  assert.deepEqual(criteriosDoCard([{ texto: 'a', atende: 1 }, { texto: 'b' }]), [{ texto: 'a', atende: null }, { texto: 'b', atende: null }]);
  const muitos = Array.from({ length: 50 }, (_, i) => ({ texto: `c${i}`, atende: true }));
  assert.equal(criteriosDoCard(muitos).length, TETO_DE_CRITERIOS);
  assert.equal(criteriosDoCard([{ texto: 'é'.repeat(TETO_DO_TEXTO + 50) }])[0].texto.length, TETO_DO_TEXTO);
  assert.equal(criteriosDoCard([{ texto: '\uD800 sozinho' }]), null, 'texto mal formado sai');
});

test('envelope sem o campo continua sem ele depois da leitura; com ele, chega como veio', () => {
  const engine = { parseEnvelope: (raw) => parseEnvelope(null, raw) };
  const sem = parseHeadlessResult(engine, JSON.stringify(envelope({})));
  assert.equal('criteriosDoCard' in sem, false);
  const com = parseHeadlessResult(engine, JSON.stringify(envelope({ criteriosDoCard: CRITERIOS })));
  assert.deepEqual(com.criteriosDoCard, CRITERIOS);
});

test('o prompt pede o campo como opcional, só com critérios lidos, e diz que ele não muda a decisão', () => {
  const prompt = fs.readFileSync(path.join(import.meta.dirname, '..', 'workspace-template', 'prompts', 'pr-review-auto.md'), 'utf8');
  assert.match(prompt, /"criteriosDoCard": \[ \{ "texto": "[^"]+", "atende": true \| false \| null \} \]/);
  assert.match(prompt, /`criteriosDoCard` \(opcional\):\*\* preencha só quando você leu critérios de aceitação no card; sem eles, omita o campo\./);
  assert.match(prompt, /não muda `cardMet`, `cardParteDestePr`, o veredito nem a decisão/);
});
