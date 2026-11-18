import { criteriaFixture } from './helpers/criteria-fixture.js';
// PR de sincronização sem atrito (17/11/2026, regra do dono: "merge-back também é pra ser algo sem
// atrito nenhum").
//
// Sincronização é o PR que só leva para uma branch contínua o que já existe noutra: origem E destino
// são branches contínuas do GitFlow da BIUD (`production`, `homologation`, `development`, `main`,
// `master`) ou bancadas (`release_hmg_*`, `release_prd_*`), o PR não vem de fork e todo commit dele
// já entrou na origem por um PR mesclado (nenhum commit é exclusivo do PR). O critério é do app,
// lido do GitHub numa consulta só, e a falta de dado nunca vira sincronização.
//
// Num PR de sincronização a falta de card não vira ressalva, o check herdado da base não segura
// (test/check-herdado-da-base.test.js) e, se a revisão não achou defeito no que entrou, o
// resultado sai LIMPO, pela política da conta para limpo. Defeito real continua valendo como hoje,
// e os gates de postagem não mudam.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sincronizacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const sha = (n) => String(n).padStart(40, 'a');
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-11-17T12:00:00Z' });

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
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
  if (sub.startsWith('api graphql') && sub.includes('associatedPullRequests')) {
    if (gh.syncFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify(gh.pr) };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  }
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const sync = await import('../lib/engine/pr-de-sincronizacao.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { LACUNA_DE_VIOLACAO } = await import('../lib/technical-review/verdict.js');

// um PR mesclado associado a um commit, com a branch em que ele foi mesclado
const mesclado = (number, base) => ({ number, base });

// o que a consulta devolve depois do --jq: um PR de merge-back da production na development
function dados(over = {}) {
  return {
    number: 40, headRefName: 'production', baseRefName: 'development', isCrossRepository: false, total: 2,
    commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [mesclado(32, 'production')] }], ...over,
  };
}

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { pr: dados(), syncFalha: false };
});

/* ---------- o critério ---------- */

test('branches contínuas e bancadas do GitFlow da BIUD', () => {
  for (const b of ['production', 'homologation', 'development', 'main', 'master', 'release_hmg_17', 'release_prd_2026-11-17']) {
    assert.equal(sync.ehBranchContinua(b), true, b);
  }
  for (const b of ['feat/x', 'task/outra', 'hotfix/y', 'release', 'develop', 'release_hmg_', 'production-old', '', null]) {
    assert.equal(sync.ehBranchContinua(b), false, String(b));
  }
});

test('merge-back da production na development, com todo commit vindo de PR mesclado, é sincronização', () => {
  assert.deepEqual(sync.avaliarSincronizacao(dados(), 40), { origem: 'production', destino: 'development', commits: 2 });
  assert.ok(sync.avaliarSincronizacao(dados({ headRefName: 'release_hmg_17', baseRefName: 'homologation' }), 40));
});

test('PR de task para bancada NÃO é sincronização', () => {
  assert.equal(sync.avaliarSincronizacao(dados({ headRefName: 'task/nova-tela', baseRefName: 'release_hmg_17' }), 40), null);
});

test('PR com commit exclusivo entre branches contínuas NÃO é sincronização', () => {
  const exclusivo = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [] }] });
  assert.equal(sync.avaliarSincronizacao(exclusivo, 40), null, 'commit sem PR mesclado é trabalho novo');
  const soEste = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [mesclado(40, 'production')] }] });
  assert.equal(sync.avaliarSincronizacao(soEste, 40), null, 'o próprio PR não conta como origem do commit');
});

test('o PR mesclado que traz o commit precisa ter sido mesclado numa branch contínua ou bancada', () => {
  const rascunho = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [mesclado(32, 'feat/rascunho')] }] });
  assert.equal(sync.avaliarSincronizacao(rascunho, 40), null, 'PR mesclado em branch de rascunho não revisou o commit para a linhagem');
  const semBase = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [{ number: 32 }] }] });
  assert.equal(sync.avaliarSincronizacao(semBase, 40), null, 'sem a base do PR mesclado não há prova');
  const umDosDois = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [mesclado(32, 'feat/rascunho'), mesclado(33, 'release_hmg_17')] }] });
  assert.ok(sync.avaliarSincronizacao(umDosDois, 40), 'basta um PR mesclado numa branch contínua ou bancada');
});

test('o critério é conservador: fork, mesma branch, lista cortada, dado torto ou outro PR não são sincronização', () => {
  assert.equal(sync.avaliarSincronizacao(dados({ isCrossRepository: true }), 40), null);
  assert.equal(sync.avaliarSincronizacao(dados({ baseRefName: 'production' }), 40), null);
  assert.equal(sync.avaliarSincronizacao(dados({ total: 101 }), 40), null, 'mais commits que a consulta traz');
  assert.equal(sync.avaliarSincronizacao(dados({ total: 3 }), 40), null, 'contagem que não fecha com a lista');
  assert.equal(sync.avaliarSincronizacao(dados({ commits: [], total: 0 }), 40), null);
  assert.equal(sync.avaliarSincronizacao(dados({ commits: [{ oid: 'x', prs: [mesclado(31, 'production')] }], total: 1 }), 40), null);
  assert.equal(sync.avaliarSincronizacao(dados(), 41), null, 'a resposta é de outro PR');
  assert.equal(sync.avaliarSincronizacao(null, 40), null);
});

test('leitura que falha não é sincronização', async () => {
  gh.syncFalha = true;
  const e = motor();
  assert.equal(await sync.lerSincronizacao(e, PR(1)), null);
  gh.syncFalha = false;
  assert.deepEqual(await sync.lerSincronizacao(e, PR(40)), { origem: 'production', destino: 'development', commits: 2 });
});

/* ---------- as ressalvas ---------- */

const aprovavel = (over = {}) => ({ verdict: 'approve', decision: 'needs_decision', cardMet: false, reasons: [{ text: 'PR sem card no Jira', kind: 'content' }], approvalEvidence: [], findings: [], ...over });

test('sincronização sem defeito: card ausente e itens de processo não viram ressalva, o resultado é limpo', () => {
  assert.deepEqual(attentionPoints(null, aprovavel({ sincronizacao: { origem: 'production', destino: 'development', commits: 2 } })), []);
});

// O zerar de todas as ressalvas é decisão do dono ("merge-back também é pra ser algo sem atrito
// nenhum") e só se sustenta porque cada commit já foi revisado num PR mesclado numa branch contínua
// (avaliarSincronizacao). Por isso nem a dependência aberta nem o item para quem decide o merge
// viram ressalva numa sincronização reconhecida; o item para quem mergeia segue no texto do APPROVE.
test('sincronização reconhecida: dependência aberta e item para quem mergeia não viram ressalva', () => {
  const s = { origem: 'production', destino: 'development', commits: 2 };
  const r = aprovavel({ sincronizacao: s, dependenciasAbertas: ['acme/infra#9 ainda aberto'], paraQuemMergeia: ['liga em produção sem passo humano'] });
  assert.deepEqual(attentionPoints(null, r), []);
  const fora = attentionPoints(null, aprovavel({ dependenciasAbertas: ['acme/infra#9 ainda aberto'], paraQuemMergeia: ['liga em produção sem passo humano'] }));
  assert.ok(fora.some((p) => /depende de algo que estava em aberto/.test(p.text)), 'fora de sincronização, como hoje');
  assert.ok(fora.some((p) => /Para quem decide o merge/.test(p.text)));
});

test('fora de sincronização, a falta de card continua sendo ressalva, como hoje', () => {
  const pts = attentionPoints(null, aprovavel());
  assert.ok(pts.some((p) => /card não foi totalmente comprovado/.test(p.text)));
  assert.ok(pts.some((p) => p.text === 'PR sem card no Jira'));
});

test('sincronização com defeito real: o comportamento é o de hoje', () => {
  const s = { origem: 'production', destino: 'development', commits: 2 };
  assert.ok(attentionPoints(null, aprovavel({ sincronizacao: s, approvalEvidence: [LACUNA_DE_VIOLACAO] })).length > 0);
  assert.ok(attentionPoints(null, aprovavel({ sincronizacao: s, verdict: 'request_changes' })).length > 0);
});

/* ---------- na revisão ---------- */

// Até 17/11/2026 a conta da fixture esperava nas ressalvas, e era o que separava limpo de com
// ressalvas aqui. O `wait` saiu (o revisor nunca espera decisão de gente): as duas classes aprovam,
// e a diferença se confere pelas ressalvas gravadas na aprovação (`attention`).
function motor(politica = { onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }) {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, ...politica };
  e.config.aguardarCiParaAprovar = false;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.bloqueadoPorChecks = async () => ({ faltando: [], herdados: [], verifiedHead: HEAD });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve',
      decision: 'needs_decision', cardMet: false, reasons: ['PR sem card no Jira'],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: {
        approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' },
        request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' },
      },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n) => ({ key: `acme/api#${n}`, repo: 'acme/api', number: n, url: `https://github.com/acme/api/pull/${n}`, title: 'Merge production into development', author: 'dev', requested: true });
const resolvida = (e, n) => decisoesResolvidas(e).find((x) => x.key === `acme/api#${n}`);

async function revisar(n, { politica, extra } = {}) {
  gh.pr = { ...gh.pr, number: n };
  const e = motor(politica);
  sessao(e, extra);
  await e.runHeadlessReview(PR(n));
  return e;
}

test('sincronização limpa sai como LIMPO: aprova sem ressalva nenhuma', async () => {
  const e = await revisar(40);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  const r = resolvida(e, 40);
  assert.equal(r.status, 'auto_approved');
  assert.deepEqual(r.attention, []);
  assert.deepEqual(r.sincronizacao, { origem: 'production', destino: 'development', commits: 2 });
});

test('o mesmo resultado num PR de task para bancada continua com ressalvas', async () => {
  gh.pr = dados({ headRefName: 'task/nova-tela', baseRefName: 'release_hmg_17' });
  const e = await revisar(41);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  const r = resolvida(e, 41);
  assert.equal(r.status, 'auto_approved');
  assert.ok(r.attention.some((p) => p.text === 'PR sem card no Jira'), 'a falta de card segue ressalva fora da sincronização');
  assert.equal(r.sincronizacao, null);
});

test('o mesmo resultado entre branches contínuas com commit exclusivo também continua com ressalvas', async () => {
  gh.pr = dados({ commits: [{ oid: sha(1), prs: [mesclado(31, 'production')] }, { oid: sha(2), prs: [] }] });
  const e = await revisar(42);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.ok(resolvida(e, 42).attention.length > 0, 'com ressalvas, não limpo');
});

test('a marca de sincronização é só do app: a da sessão é descartada', async () => {
  gh.syncFalha = true;
  const e = await revisar(43, { extra: { sincronizacao: { origem: 'production', destino: 'development', commits: 1 } } });
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  const r = resolvida(e, 43);
  assert.equal(r.sincronizacao, null);
  assert.ok(r.attention.length > 0, 'sem a marca do app, a falta de card segue ressalva');
});

test('sincronização com defeito real: o achado vale e a reprovação sai como hoje', async () => {
  const e = await revisar(44, { extra: { ...criteriaFixture('request_changes'), verdict: 'request_changes', decision: 'needs_decision' } });
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'REQUEST_CHANGES');
  assert.equal(resolvida(e, 44).status, 'auto_rejected');
});
