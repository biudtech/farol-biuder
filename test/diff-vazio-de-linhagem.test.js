// PR de diff vazio que só alinha a história (19/11/2026, regra do dono): o sync ou o merge-back do
// GitFlow que não muda nenhum arquivo, mas traz os merge commits das releases. Com a medição
// própria estável no head lido e pelo menos um merge commit, o motor APROVA sem sessão do Claude e
// sem o card; sem merge commit, COMMENT neutro. O resto das regras do motor continua valendo
// (lib/engine/diff-vazio-de-linhagem.js).
//
// Medição de 19/11/2026, antes da regra, com o inventário completo e zero arquivos: toda revisão
// abria a sessão e o desfecho era o do modelo (aprovação, ou REQUEST_CHANGES quando a sessão
// cobrava o card ou declarava a parte do card não entregue); pela rota reserva do inventário
// (`fetchPrInventory`, que dá `unavailable` para lista vazia) a decisão ficava pendente, sem postar.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-diff-vazio-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const BASE = 'b'.repeat(40);
const OUTRO = 'c'.repeat(40);
const sha = (n) => String(n).padStart(40, 'd');

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const runReal = io.run;
let envios = [];
let chamadas = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  chamadas.push(sub);
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (/^api repos\/acme\/api\/pulls\/\d+ --jq \{headSha/.test(sub)) {
    const leitura = gh.leituras.length > 1 ? gh.leituras.shift() : gh.leituras[0];
    return leitura ? { ok: true, code: 0, stdout: JSON.stringify(leitura), stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  }
  if (/^api repos\/acme\/api\/pulls\/\d+\/files --paginate/.test(sub)) return { ok: true, code: 0, stdout: gh.arquivos, stderr: '' };
  if (/^api repos\/acme\/api\/pulls\/\d+\/commits --paginate/.test(sub)) return { ok: true, code: 0, stdout: gh.commits, stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalPublication, approvalRefusal } = await import('../lib/technical-review/publication.js');
const diffVazio = await import('../lib/engine/diff-vazio-de-linhagem.js');

after(() => { io.run = runReal; try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const leitura = (over = {}) => ({ headSha: HEAD, baseSha: BASE, changedFiles: 0, commits: 3, ...over });
const commits = (pais) => JSON.stringify(pais.map((p, i) => ({ sha: sha(i + 1), pais: p })));
beforeEach(() => {
  envios = [];
  chamadas = [];
  gh = { leituras: [leitura()], arquivos: '[]', commits: commits([1, 2, 2]) };
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
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('request_changes'), analysisStatus: 'complete', verdict: 'request_changes',
      decision: 'request_changes', cardMet: false, cardParteDestePr: false, reasons: [], coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'O card pede a tela nova e ela não está neste PR.' } },
      reportMarkdown: '# ok' }), sessionId: 's1' };
  };
  return e;
}

const PR = (n) => ({ key: `acme/api#${n}`, repo: 'acme/api', number: n, url: `https://github.com/acme/api/pull/${n}`,
  title: 'sync homologation into development', author: 'dev', requested: true });
const decisao = (e, n) => [...e.decisions.pending, ...decisoesResolvidas(e)].find((d) => d.key === `acme/api#${n}`);

async function revisar(n, ajuste) {
  const e = motor();
  if (ajuste) ajuste(e);
  await e.runHeadlessReview(PR(n));
  return e;
}

test('merge-back com zero arquivos e merge commit: APPROVE de texto fixo, sem sessão e sem card', async () => {
  const e = await revisar(1);
  assert.equal(e.sessoes, 0, 'nenhuma sessão do modelo');
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(envios[0].body, 'Este PR não muda nenhum arquivo em relação à base (diff vazio no commit `706cc81`); ele só alinha a história, trazendo 2 merge commits. Aprovo.');
  const d = decisao(e, 1);
  assert.equal(d.status, 'auto_approved');
  assert.equal(d.action, 'approve');
  assert.equal(d.caminho, 'diff_vazio_linhagem');
  assert.deepEqual(d.linhagem, { commits: 3, mergeCommits: 2 });
  assert.equal(d.card, null, 'o card não é lido');
  assert.equal(e.decisionForUi(d).caminho, 'diff_vazio_linhagem', 'a marca chega à tela');
  assert.ok(e.logs.some((l) => l.startsWith('INFO') && l.includes('caminho diff_vazio_linhagem')), 'uma linha de log explica a decisão');
  assert.equal(chamadas.filter((c) => c.includes('/commits --paginate')).length, 1, 'os commits lidos uma vez, paginados');
});

test('um merge commit só: o texto fica no singular', async () => {
  gh.commits = commits([2]);
  gh.leituras = [leitura({ commits: 1 })];
  await revisar(2);
  assert.match(envios[0].body, /trazendo 1 merge commit\. Aprovo\.$/);
});

test('zero arquivos sem merge commit: COMMENT neutro, sem aprovar nem pedir mudanças, sem sessão', async () => {
  gh.commits = commits([1, 1, 1]);
  const e = await revisar(3);
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(envios[0].body, 'Este PR não muda nenhum arquivo em relação à base (diff vazio no commit `706cc81`) e não traz merge commit. Por isso não aprovo nem peço mudanças.');
  const d = decisao(e, 3);
  assert.equal(d.status, 'commented_inconclusive');
  assert.equal(d.action, 'comment');
  assert.equal(d.caminho, 'diff_vazio_linhagem');
});

for (const [nome, ajustar] of Object.entries({
  'a leitura do PR falha': () => { gh.leituras = [null]; },
  'o head lido não é o da revisão': () => { gh.leituras = [leitura({ headSha: OUTRO })]; },
  'o head muda durante a medição': () => { gh.leituras = [leitura(), leitura({ headSha: OUTRO })]; },
  'a contagem de arquivos muda durante a medição': () => { gh.leituras = [leitura(), leitura({ changedFiles: 2 })]; },
  'a lista de arquivos não vem vazia': () => { gh.arquivos = '["src/a.js"]'; },
  'a lista de arquivos não é legível': () => { gh.arquivos = 'não é json'; },
  'a lista de commits não fecha com a contagem e não traz merge commit': () => { gh.commits = commits([1, 1]); },
  'a lista de commits é ilegível': () => { gh.commits = '[{"sha":"x"}]'; },
})) {
  test(`medição incompleta ou instável (${nome}): caminho normal, com sessão`, async () => {
    ajustar();
    const e = await revisar(10);
    assert.equal(e.sessoes, 1, 'a revisão segue pela sessão');
    assert.notEqual(decisao(e, 10)?.caminho, 'diff_vazio_linhagem');
  });
}

test('inventário da revisão incompleto com arquivos: caminho normal, sem leitura a mais', async () => {
  const e = await revisar(11, (m) => {
    m.fetchPrInventory = async () => ({ status: 'incomplete', reason: 'o head mudou durante a medição', headSha: HEAD, baseSha: BASE, changedFiles: 5, files: [] });
  });
  assert.equal(e.sessoes, 1);
  assert.equal(chamadas.some((c) => c.includes('/commits --paginate')), false);
});

test('PR com arquivos: caminho normal, sem mudança e sem leitura a mais', async () => {
  const e = await revisar(12, (m) => { m.fetchPrFiles = async () => [{ path: 'src/a.js', sha: 's', status: 'modified', lines: 3 }]; });
  assert.equal(e.sessoes, 1);
  assert.equal(chamadas.some((c) => c.includes('/commits --paginate') || c.includes('{headSha: .head.sha, baseSha: .base.sha, changedFiles: .changed_files, commits')), false);
  assert.notEqual(decisao(e, 12)?.caminho, 'diff_vazio_linhagem');
});

test('a rota reserva do inventário (zero arquivos dá `unavailable`) também entra na regra', async () => {
  const e = await revisar(13, (m) => {
    m.fetchPrInventory = async () => ({ status: 'unavailable', reason: 'a lista paginada de arquivos não pôde ser conferida', headSha: HEAD, baseSha: BASE, changedFiles: 0, files: [] });
  });
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
});

test('decisão de gente no head continua segurando: nada sai, sem sessão', async () => {
  const e = await revisar(20, (m) => { m.bloqueadoPorHistorico = async () => ({ bloqueado: true, head: HEAD, quem: ['ana'], decisivos: [] }); });
  assert.equal(e.sessoes, 0);
  assert.equal(envios.length, 0);
  const d = decisao(e, 20);
  assert.equal(d.status, 'not_posted');
  assert.match(d.reasons.map((r) => r.text).join(' '), /outra pessoa já decidiu este commit \(@ana\)/);
});

test('outra conta revisando (label): nada sai', async () => {
  const e = await revisar(21, (m) => { m.prEstadoELabels = async () => ({ estado: 'OPEN', labels: ['outra:revisando'] }); });
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 21).status, 'not_posted');
});

test('head que andou antes de postar: nada sai, e o head novo fica marcado', async () => {
  let n = 0;
  const e = await revisar(22, (m) => { m.headSha = async () => (n++ < 1 ? HEAD : OUTRO); });
  assert.equal(envios.length, 0);
  const d = decisao(e, 22);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, OUTRO);
});

test('aprovação minha já publicada neste head: não posta de novo', async () => {
  const e = await revisar(23, (m) => { m.myReviewStates = async () => ['APPROVED']; });
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 23).status, 'already_reviewed');
});

test('checks obrigatórios vermelhos: o tratamento de hoje (o APPROVE sai e o card avisa)', async () => {
  const e = await revisar(24, (m) => {
    m.bloqueadoPorChecks = async () => ({ faltando: [{ nome: 'ci', estado: 'vermelho' }], herdados: [], verifiedHead: HEAD });
  });
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.match(decisao(e, 24).attention.map((r) => r.text).join(' '), /aprovado com check obrigatório vermelho no head \(ci\)/);
});

test('PR da própria conta: nada sai e nenhuma sessão abre', async () => {
  const e = motor();
  await e.runHeadlessReview({ ...PR(25), author: 'eu' });
  assert.equal(e.sessoes, 0);
  assert.equal(envios.length, 0);
});

test('origem desconhecida: caminho normal', async () => {
  const e = motor();
  await e.runHeadlessReview({ ...PR(26), requested: false });
  assert.equal(e.sessoes, 1);
});

test('memória de rodadas em enforce: caminho normal', async () => {
  const e = await revisar(27, (m) => { m.config.reviewRoundsMode = 'enforce'; });
  assert.equal(e.sessoes, 1);
});

test('a avaliação técnica na publicação aceita só a prova do motor no mesmo commit', async () => {
  const e = motor();
  const pr = PR(30);
  const isolada = technicalPublication.approvalRefusal;
  try {
    technicalPublication.approvalRefusal = approvalRefusal;
    // uma lacuna na prova: sem a marca do diff vazio, ela recusaria o APPROVE
    e.technicalApprovals = new Map([[pr.key, { report: null, evidence: ['lacuna da fixture'], evidenceVersion: 2, diffVazio: { head: HEAD } }]]);
    assert.equal(await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: HEAD }), null);
    const outro = await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: OUTRO });
    assert.equal(outro.blocked, 'technical_review', 'outro commit não herda a prova');
    e.technicalApprovals = new Map();
    e.decisions.pending = [{ key: pr.key, diffVazio: { head: HEAD }, approvalEvidence: ['lacuna da fixture'] }];
    assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: HEAD }))?.blocked, 'technical_review', 'a marca na pendência gravada não vale: só a prova da memória do motor');
  } finally { technicalPublication.approvalRefusal = isolada; }
});

test('a medição é pura e conservadora', () => {
  const base = { antes: leitura(), depois: leitura(), vazio: true, commits: [{ sha: sha(1), pais: 2 }, { sha: sha(2), pais: 1 }, { sha: sha(3), pais: 1 }], head: HEAD };
  assert.deepEqual(diffVazio.avaliarMedicao(base), { headSha: HEAD, baseSha: BASE, commits: 3, mergeCommits: 1 });
  assert.equal(diffVazio.avaliarMedicao({ ...base, vazio: false }), null);
  assert.equal(diffVazio.avaliarMedicao({ ...base, head: '' }), null);
  assert.equal(diffVazio.avaliarMedicao({ ...base, depois: leitura({ baseSha: 'e'.repeat(40) }) }), null, 'a base mudou');
  const semMerge = Array.from({ length: 250 }, (_, i) => ({ sha: sha(i + 1), pais: 1 }));
  assert.equal(diffVazio.avaliarMedicao({ ...base, antes: leitura({ commits: 250 }), depois: leitura({ commits: 250 }), commits: semMerge }), null,
    'no teto de 250 commits a lista não prova a ausência de merge commit');
  const comMerge = [...semMerge.slice(0, 249), { sha: sha(999), pais: 2 }];
  assert.equal(diffVazio.avaliarMedicao({ ...base, antes: leitura({ commits: 400 }), depois: leitura({ commits: 400 }), commits: comMerge }).mergeCommits, 1,
    'mas prova o merge commit que achou');
  assert.equal(diffVazio.candidato({ changedFiles: 0, headSha: HEAD }, HEAD), true);
  assert.equal(diffVazio.candidato({ changedFiles: 0, headSha: OUTRO }, HEAD), false);
  assert.equal(diffVazio.candidato({ changedFiles: null }, HEAD), false);
  assert.equal(diffVazio.candidato({ changedFiles: 0 }, ''), false);
});
