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
// A regra: check obrigatório que falha (ou está sem resultado) no head do PR e que também falha no
// commit atual da base é herdado; sem resultado no head e sem resultado verde na base, idem. O
// herdado não segura a aprovação (nem com a espera do CI ligada), não vira ressalva, nem motivo de
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
const { ciHerdadoBlock } = await import('../lib/engine/review-prompt.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');

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

// `ciObrigatorio`: "CI obrigatório antes da aprovação". `politica` = [limpo, com ressalvas].
function motor({ ciObrigatorio = true, politica = ['approve', 'approve'], reprova = 'request_changes' } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean: politica[0], onCaveats: politica[1], onReject: reprova };
  e.config.aguardarCiParaAprovar = ciObrigatorio;
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

test('separarHerdados: sem resultado no head e sem resultado verde na base é herdado', () => {
  for (const base of [[], [check('osv', null, 'IN_PROGRESS')], [check('osv', 'FAILURE')]]) {
    for (const estado of ['rodando', 'ausente']) {
      const r = checksMod.separarHerdados([{ nome: 'osv', estado }], base);
      assert.deepEqual(r.faltando, [], `${estado} no head com a base ${JSON.stringify(base)}`);
      assert.equal(r.herdados.length, 1);
    }
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

/* ---------- na revisão, com a espera do CI ligada ---------- */

test('espera ligada: o herdado não segura a aprovação, que sai limpa e sem aviso de CI no card', async () => {
  const e = await revisar(10);
  assert.equal(envios.length, 1, 'a aprovação saiu sem esperar o osv herdado');
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(pendente(e, 10), undefined, 'nenhuma espera do CI armada');
  const r = resolvida(e, 10);
  assert.equal(r.status, 'auto_approved');
  assert.deepEqual(textos(r.attention), [], 'nem ressalva nem aviso "aprovado com check obrigatório"');
  assert.ok(e.toasts.some((t) => /aprovado sem ressalvas/.test(t)), e.toasts.join(' | '));
});

// o texto que a conta que reprova sozinha publica pelo CI vermelho (desfecho-automatico.js): é o
// do caso de origem, e com o check herdado ele não pode sair
const PEDIDO_PELO_CI = /Os checks obrigatórios `osv` estão falhando no commit/;

test('espera ligada e conta que reprova sozinha: o herdado não vira o pedido de mudanças pelo CI', async () => {
  await revisar(17);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  assert.doesNotMatch(envios[0].body, PEDIDO_PELO_CI);
});

test('espera ligada: o check que só falha no PR continua valendo (pedido pelo CI, ou espera do CI)', async () => {
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  await revisar(11);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES', 'a conta reprova sozinha: o pedido pelo CI de sempre');
  assert.match(envios[0].body, PEDIDO_PELO_CI);
  envios = [];
  const e = await revisar(18, { reprova: 'wait' });
  assert.deepEqual(envios, []);
  assert.deepEqual(pendente(e, 18).esperaCi.checks, [{ nome: 'osv', estado: 'vermelho' }], 'sem reprovar sozinha, a espera do CI de sempre');
});

test('espera ligada: a leitura da base que falha deixa o check valendo como hoje', async () => {
  gh.baseFalha = true;
  await revisar(12);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES');
  envios = [];
  const e = await revisar(19, { reprova: 'wait' });
  assert.deepEqual(envios, []);
  assert.deepEqual(pendente(e, 19).esperaCi.checks, [{ nome: 'osv', estado: 'vermelho' }]);
});

test('espera ligada: sem resultado no head e sem verde na base é herdado; com verde na base segura', async () => {
  gh.rollup = [check('osv', null, 'IN_PROGRESS'), check('test', 'SUCCESS')];
  gh.rollupBase = [check('test', 'SUCCESS')];
  const e = await revisar(13);
  assert.equal(envios.length, 1, 'o osv nunca ficou verde na base: não segura');
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  envios = [];
  const outro = await revisar(14);
  assert.deepEqual(envios, []);
  assert.deepEqual(pendente(outro, 14).esperaCi.checks, [{ nome: 'osv', estado: 'rodando' }]);
});

test('espera armada pelo PR: quando a base passa a falhar no mesmo check, a falha vira herdada e a aprovação sai', async () => {
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  const e = await revisar(15, { reprova: 'wait' });
  assert.ok(pendente(e, 15).esperaCi);
  gh.rollupBase = [check('osv', 'FAILURE'), check('test', 'SUCCESS')];
  e.checksDaBaseCache = new Map();
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 15).status, 'auto_approved');
});

test('espera ligada: o pedido de mudanças só pelo CI herdado não segura nem vai à mesa', async () => {
  const extra = {
    verdict: 'request_changes', decision: 'needs_decision',
    findings: [{ severity: 'blocking', causa: 'ci', title: 'osv vermelho', summary: 'o check osv falha', evidence: 'osv', criteria: { key: 'ci-osv', criterion: 'CI verde', source: 'ruleset', scope: 'Este diff' } }],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'O check osv precisa passar antes do merge.' } },
  };
  const e = await revisar(16, {}, extra);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE', 'o estado que sustentava o pedido é herdado da base');
  assert.equal(resolvida(e, 16).status, 'auto_approved');
});

/* ---------- com a espera do CI desligada (padrão) ---------- */

test('espera desligada: o herdado não vira o aviso "aprovado com check obrigatório vermelho" no card', async () => {
  const e = await revisar(20, { ciObrigatorio: false });
  assert.equal(envios.length, 1);
  assert.deepEqual(textos(resolvida(e, 20).attention), []);
});

test('espera desligada: o check que só falha no PR continua com o aviso de hoje', async () => {
  gh.rollupBase = [check('osv', 'SUCCESS'), check('test', 'SUCCESS')];
  const e = await revisar(21, { ciObrigatorio: false });
  assert.equal(envios.length, 1);
  assert.ok(textos(resolvida(e, 21).attention).some((t) => /aprovado com check obrigatório vermelho no head \(osv\)/.test(t)));
});

/* ---------- o card e o texto ---------- */

test('card na mesa: o herdado aparece numa linha informativa, que não é ressalva', async () => {
  const e = await revisar(30, { ciObrigatorio: false, politica: ['wait', 'wait'] });
  const d = pendente(e, 30);
  const linha = (d.reasons || []).find((r) => /falha também no commit atual da branch base/.test(r.text));
  assert.ok(linha, textos(d.reasons).join(' | '));
  assert.equal(linha.informativo, true);
  assert.match(linha.text, /osv/);
  assert.doesNotMatch(linha.text, /precisa|corrij|antes do merge|esper/i, 'informa, não cobra');
  assert.deepEqual(attentionPoints(null, d).filter((p) => /branch base/.test(p.text)), [], 'a linha nunca conta como ressalva');
  assert.match(textos(d.reasons)[0], /sem ressalvas/, 'a classe é limpa: a política é a do limpo');
});

test('os textos do CI só falam do check que pesa', () => {
  const r = { checksObrigatorios: [], checksHerdados: [{ nome: 'osv', estado: 'vermelho', naBase: 'vermelho' }] };
  assert.equal(motivoDeEspera(r), null);
  assert.deepEqual(avisoDoCi(r), []);
  assert.deepEqual(avisoDaAprovacao(r), []);
  assert.equal(avisoDosHerdados(r).length, 1);
  assert.deepEqual(avisoDosHerdados({ checksObrigatorios: [] }), []);
});

test('prompt: com a espera ligada a sessão sabe que check herdado da base não segura nem vira texto', () => {
  const bloco = ciHerdadoBlock({ aguardarCiParaAprovar: true });
  assert.match(bloco, /branch base/);
  assert.match(bloco, /herdad/);
  assert.match(bloco, /reasons/);
  assert.doesNotMatch(bloco, /—/, 'sem travessão');
  assert.equal(ciHerdadoBlock({ aguardarCiParaAprovar: false }), '', 'desligada, o bloco do CI fora da decisão já cobre');
});
