// O sync por herança sem nenhum arquivo a ler (24/11/2026): todo arquivo do diff é idêntico à
// ponta da origem e a base não mexeu em nenhum, então não há o que a sessão revise. O motor
// aprova com texto fixo, sem sessão, pelo mesmo fluxo do diff vazio de linhagem, com a prova da
// publicação gravada só na memória. Cada condição que encerra sem postar continua valendo, e
// qualquer coisa fora da regra (um arquivo a ler, a avaliação técnica que falha ou acha algo fora
// dos herdados) abre a sessão.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-sem-sessao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const { FOTO, BASE_PONTA, HEAD_DO_SYNC: HEAD, cenarioDoSync, respostaDoSync } = await import('./helpers/github-do-sync.js');
const runReal = io.run;
const OUTRO = 'c'.repeat(40);
let envios = [];
let gh;
let cenario;
io.run = async (_cmd, args) => {
  const doSync = respostaDoSync(cenario, args);
  if (doSync) return doSync;
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(payload);
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { textoDaAprovacao, candidato, tecnicaSoNosHerdados } = await import('../lib/engine/sync-sem-sessao.js');

const originalSource = { ...sourceRuntime };
const originalTecnica = { ...technicalRuntime };
let limpezas;
after(() => { io.run = runReal; try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
afterEach(() => { Object.assign(sourceRuntime, originalSource); Object.assign(technicalRuntime, originalTecnica); });

const arquivo = (p) => ({ path: p, sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' });
const ARQUIVOS = [arquivo('docs/a.md'), arquivo('docs/b.md'), arquivo('docs/c.md')];
function fonte() {
  return { status: 'complete', manifest: { H: HEAD, B: BASE_PONTA, M: 'a'.repeat(40), files: ARQUIVOS, limitations: [] }, reader: {},
    inventory: { status: 'complete', headSha: HEAD, baseSha: BASE_PONTA, baseRef: 'development', files: ARQUIVOS, changedFiles: ARQUIVOS.length },
    release: async () => {} };
}

beforeEach(() => {
  envios = [];
  gh = { postFalha: '' };
  cenario = cenarioDoSync();
  limpezas = 0;
  sourceRuntime.prepareSources = async () => fonte();
  sourceRuntime.buildMap = async () => ({ complete: true, head: { files: [], relations: [], unresolved: [] }, previous: { files: [], relations: [], unresolved: [] } });
  // a avaliação técnica aprovada, com regra que rodou: o que a pré-checagem exige (verdict.js)
  technicalRuntime.prepareTechnicalReview = async (_e, pr, head) => ({ repo: pr.repo, head, toolHome: 'fixture', snapshot: 'fixture', base: 'b'.repeat(40),
    initial: { verdict: 'pass', rules: [{ rule: 'fixture', verdict: 'pass' }], findings: [], excerpt: '' } });
  const limpar = technicalRuntime.cleanup;
  technicalRuntime.cleanup = (ctx) => { if (ctx) limpezas += 1; return limpar(ctx); };
});

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.logs = [];
  e.log = (nivel, texto) => e.logs.push(`${nivel} ${texto}`);
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.prEstadoELabels = async () => ({ estado: 'OPEN', labels: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: HEAD, quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ faltando: [], herdados: [], verifiedHead: HEAD });
  e.myReviewStates = async () => [];
  e.sessoes = 0;
  e.runClaudeStream = async () => {
    e.sessoes += 1;
    return { text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve',
      decision: 'needs_decision', cardMet: true, reasons: [], coverage: { total: 3, reviewed: ARQUIVOS.map((f) => f.path), missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } }, reportMarkdown: '# ok' }), sessionId: 's1' };
  };
  return e;
}

const PR = (n) => ({ key: `acme/api#${n}`, repo: 'acme/api', number: n, url: `https://github.com/acme/api/pull/${n}`,
  title: 'sync homologation into development', author: 'dev', requested: true });
const decisao = (e, n) => [...e.decisions.pending, ...decisoesResolvidas(e)].find((d) => d.key === `acme/api#${n}`);

async function revisar(n, ajuste, prDoCaso = PR(n)) {
  cenario.numero = n;
  const e = motor();
  if (ajuste) ajuste(e);
  await e.runHeadlessReview(prDoCaso);
  return e;
}

test('todos herdados: APPROVE de texto fixo, sem sessão, com a prova do motor', async () => {
  const e = await revisar(1);
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(envios[0].body, 'Este PR só leva para a base o que já foi revisado na origem: os 3 arquivos do diff são idênticos à ponta da `homologation` (commit `158c3d8`), e a base não tinha mudança própria neles. Aprovo.');
  const d = decisao(e, 1);
  assert.equal(d.status, 'auto_approved');
  assert.equal(d.caminho, 'sync_por_heranca_sem_sessao');
  assert.equal(d.card, null, 'o card não é lido');
  assert.equal(d.inventarioDiff.files.length, 3, 'o inventário real vai à decisão');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 3, lidos: 0 });
  assert.equal(e.logs.filter((l) => l.startsWith('INFO') && l.includes('caminho sync_por_heranca_sem_sessao')).length, 1);
  assert.equal(e.logs.filter((l) => l.includes('caminho sync_por_heranca)')).length, 0, 'sem a linha do caminho com sessão');
  assert.equal(limpezas, 1, 'o material técnico preparado é liberado');
});

test('o texto no singular', () => {
  assert.match(textoDaAprovacao({ origem: 'homologation', foto: FOTO }, 1), /o único arquivo do diff é idêntico à ponta da `homologation`/);
});

test('a publicação aceita só a prova com a marca do motor', async () => {
  const e = await revisar(2);
  const pr = PR(2);
  const gravada = e.technicalApprovals.get(pr.key);
  assert.equal(gravada.report, null);
  assert.equal(gravada.syncPorHeranca.head, HEAD, 'a prova do sync fica na memória');
  // uma lacuna na prova: sem a marca do sync, ela recusaria o APPROVE
  const prova = { ...gravada, evidence: ['lacuna da fixture'] };
  e.technicalApprovals.set(pr.key, prova);
  assert.equal(await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: HEAD }), null);
  assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: OUTRO }))?.blocked, 'technical_review', 'outro commit não herda a prova');
  e.technicalApprovals.set(pr.key, JSON.parse(JSON.stringify(prova)));
  assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: HEAD }))?.blocked, 'technical_review', 'sem o símbolo do motor, não vale');
});

test('um arquivo a ler: a sessão abre', async () => {
  cenario.comparacoes[`${FOTO}...${HEAD}`] = { behind: 0, mergeBase: FOTO, files: ['docs/a.md'] };
  const e = await revisar(3);
  assert.equal(e.sessoes, 1);
  assert.notEqual(decisao(e, 3)?.caminho, 'sync_por_heranca_sem_sessao');
});

for (const [nome, ajuste, prDoCaso] of [
  ['memória de rodadas em enforce', (e) => { e.config.reviewRoundsMode = 'enforce'; }, PR(10)],
  ['origem desconhecida', null, { ...PR(11), requested: false }],
  ['política que não aprova sozinha', (e) => { e.approvePolicyFor = () => 'request_changes'; }, PR(12)],
  ['avaliação técnica que falha: a sessão abre', () => { technicalRuntime.prepareTechnicalReview = async () => ({ error: 'falhou', failure: 'tool' }); }, PR(13)],
  ['achado técnico fora dos herdados: a sessão abre', () => { technicalRuntime.prepareTechnicalReview = async (_e, pr, head) => ({ repo: pr.repo, head, toolHome: 'fixture', snapshot: 'fixture', base: 'b'.repeat(40), initial: { rules: [], findings: [{ rule: 'r', file: 'outro.ts' }], excerpt: '' } }); }, PR(14)],
]) {
  test(nome, async () => {
    const e = await revisar(prDoCaso.number, ajuste, prDoCaso);
    assert.equal(e.sessoes, 1);
    assert.notEqual(decisao(e, prDoCaso.number)?.caminho, 'sync_por_heranca_sem_sessao');
  });
}

test('achado técnico só nos herdados não impede', async () => {
  technicalRuntime.prepareTechnicalReview = async (_e, pr, head) => ({ repo: pr.repo, head, toolHome: 'fixture', snapshot: 'fixture', base: 'b'.repeat(40), initial: { verdict: 'pass', rules: [{ rule: 'r', verdict: 'pass' }], findings: [{ rule: 'r', file: 'docs/a.md' }], excerpt: '' } });
  const e = await revisar(15);
  assert.equal(e.sessoes, 0);
  assert.equal(decisao(e, 15).caminho, 'sync_por_heranca_sem_sessao');
});

test('PR da própria conta, gente no head e label de outra conta: encerra sem postar', async () => {
  const propria = motor();
  cenario.numero = 16;
  await propria.runHeadlessReview({ ...PR(16), author: 'eu' });
  assert.equal(propria.sessoes, 0);
  const gente = await revisar(17, (m) => { m.bloqueadoPorHistorico = async () => ({ bloqueado: true, head: HEAD, quem: ['ana'], decisivos: [] }); });
  assert.equal(gente.sessoes, 0);
  const label = await revisar(18, (m) => { m.prEstadoELabels = async () => ({ estado: 'OPEN', labels: ['outra:revisando'] }); });
  assert.equal(decisao(label, 18).status, 'not_posted');
  assert.equal(envios.length, 0);
});

test('head que andou: pendente com stale_head', async () => {
  let n = 0;
  const e = await revisar(20, (m) => { m.headSha = async () => (n++ < 1 ? HEAD : OUTRO); });
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 20).blockedKind, 'stale_head');
  assert.equal(decisao(e, 20).caminho, 'sync_por_heranca_sem_sessao');
});

test('já aprovado neste head: already_reviewed, sem postar', async () => {
  const e = await revisar(21, (m) => { m.myReviewStates = async () => ['APPROVED']; });
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 21).status, 'already_reviewed');
});

test('falha passageira ao postar: pendente com reenvio', async () => {
  gh.postFalha = 'HTTP 502: Bad Gateway';
  const e = await revisar(22);
  assert.equal(decisao(e, 22).postRetry.event, 'approve');
});

test('candidato e tecnicaSoNosHerdados são puros e conservadores', () => {
  const sync = { herdados: ['a', 'b'] };
  assert.equal(candidato({ ativa: true, changed: [], sync }, [{ path: 'a' }, { path: 'b' }]), true);
  assert.equal(candidato({ ativa: true, changed: ['b'], sync }, [{ path: 'a' }, { path: 'b' }]), false);
  assert.equal(candidato({ ativa: true, changed: [], sync }, [{ path: 'a' }, { path: 'c' }]), false);
  assert.equal(candidato({ ativa: true, changed: [] }, [{ path: 'a' }]), false);
  assert.equal(candidato({ ativa: true, changed: [], sync }, null), false);
  assert.equal(tecnicaSoNosHerdados({ semDeclaracao: true }, ['a']), true);
  assert.equal(tecnicaSoNosHerdados({ error: 'x' }, ['a']), false);
  assert.equal(tecnicaSoNosHerdados({ initial: { verdict: 'pass', rules: [{ rule: 'r', verdict: 'pass' }], findings: [{ file: 'a' }] } }, ['a']), true);
  assert.equal(tecnicaSoNosHerdados({ initial: { verdict: 'pass', rules: [{ rule: 'r', verdict: 'pass' }], findings: [{ rule: 'sem arquivo' }] } }, ['a']), false);
  assert.equal(tecnicaSoNosHerdados({}, ['a']), false, 'sem o resultado inicial não dá para saber');
});

// Revisão independente de 24/11/2026: a pré-checagem do caminho sem sessão nunca é mais frouxa que o
// caminho normal (technicalGap, lib/technical-review/verdict.js).
test('pré-checagem técnica: erro, regra reprovada sem achado e regra de julgamento pendente barram', () => {
  const herdados = ['docs/a.md'];
  const inicial = (initial) => tecnicaSoNosHerdados({ initial }, herdados);
  assert.equal(inicial({ verdict: 'pass', error: 'falhou', rules: [{ rule: 'core.x', verdict: 'pass' }], findings: [] }), false, 'initial.error');
  assert.equal(inicial({ verdict: 'pass', rules: [{ rule: 'core.x', verdict: 'fail' }], findings: [] }), false, 'regra reprovada sem achado');
  assert.equal(inicial({ verdict: 'fail', rules: [{ rule: 'core.x', verdict: 'fail' }], findings: [{ rule: 'core.x', file: 'docs/a.md' }] }), false, 'veredito fail barra');
  assert.equal(inicial({ verdict: 'pass', rules: [{ rule: 'core.x', verdict: 'not-run' }], findings: [] }), false, 'julgamento pendente');
  assert.equal(inicial({ verdict: 'pass', rules: [{ rule: 'frontend.component.named-structural-branches', verdict: 'not-run' }], findings: [] }), true,
    'regra de organização pendente não segura, como no caminho normal');
  assert.equal(inicial({ verdict: 'pass', rules: [{ rule: 'core.x', verdict: 'pass' }], findings: [] }), true);
  // segunda revisão independente: só o veredito aprovado, com regra que rodou, passa
  assert.equal(inicial({ verdict: 'fail', rules: [{ rule: 'core.x', verdict: 'pass' }], findings: [] }), false, 'veredito fail sem regra reprovada');
  assert.equal(inicial({ verdict: 'not-run', rules: [{ rule: 'core.x', verdict: 'pass' }], findings: [] }), false, 'veredito not-run');
  assert.equal(inicial({ rules: [{ rule: 'core.x', verdict: 'pass' }], findings: [] }), false, 'veredito ausente');
  assert.equal(inicial({ verdict: 'pass', rules: [], findings: [] }), false, 'regras vazias: aplicabilidade não comprovada');
});
