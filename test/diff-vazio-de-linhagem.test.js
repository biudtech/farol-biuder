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
const MB = 'a'.repeat(40);
const TREE = 'e589266' + '0'.repeat(33);
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
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(payload);
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (/^api repos\/acme\/api\/pulls\/\d+ --jq \{headSha/.test(sub)) {
    const leitura = gh.leituras.length > 1 ? gh.leituras.shift() : gh.leituras[0];
    return leitura ? { ok: true, code: 0, stdout: JSON.stringify(leitura), stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  }
  if (/^api repos\/acme\/api\/pulls\/\d+\/files --paginate/.test(sub)) return { ok: true, code: 0, stdout: gh.arquivos, stderr: '' };
  if (/^api repos\/acme\/api\/pulls\/\d+\/commits --paginate/.test(sub)) return { ok: true, code: 0, stdout: gh.commits, stderr: '' };
  const compare = /^api repos\/acme\/api\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40}) --jq \.merge_base_commit\.sha$/.exec(sub);
  if (compare) return gh.mergeBase ? { ok: true, code: 0, stdout: `${gh.mergeBase}\n`, stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  const arvore = /^api repos\/acme\/api\/git\/commits\/([0-9a-f]{40}) --jq \.tree\.sha$/.exec(sub);
  if (arvore) {
    const t = gh.trees[arvore[1]];
    return t ? { ok: true, code: 0, stdout: `${t}\n`, stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'HTTP 404' };
  }
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalPublication, approvalRefusal, ORIGEM_DIFF_VAZIO } = await import('../lib/technical-review/publication.js');
const diffVazio = await import('../lib/engine/diff-vazio-de-linhagem.js');

after(() => { io.run = runReal; try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const leitura = (over = {}) => ({ headSha: HEAD, baseSha: BASE, changedFiles: 0, commits: 3, ...over });
const commits = (pais) => JSON.stringify(pais.map((p, i) => ({ sha: sha(i + 1), pais: p })));
beforeEach(() => {
  envios = [];
  chamadas = [];
  gh = { leituras: [leitura()], arquivos: '[]', commits: commits([1, 2, 2]), mergeBase: MB, trees: { [HEAD]: TREE, [MB]: TREE }, postFalha: '' };
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
    e.technicalApprovals = new Map([[pr.key, { report: null, evidence: ['lacuna da fixture'], evidenceVersion: 2, diffVazio: { head: HEAD, origem: ORIGEM_DIFF_VAZIO } }]]);
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

// Revisão independente de 19/11/2026, item 2: a contagem do GitHub não basta; a tree do head tem de
// ser a tree do merge-base com a base.
test('trees do head e do merge-base iguais: aprova, lendo as trees pela conta do PR', async () => {
  const e = await revisar(40);
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.ok(chamadas.includes(`api repos/acme/api/git/commits/${HEAD} --jq .tree.sha`), 'a tree do head é lida');
  assert.ok(chamadas.includes(`api repos/acme/api/git/commits/${MB} --jq .tree.sha`), 'a tree do merge-base é lida');
});

test('o merge-base do preparo, na mesma base, dispensa o compare', async () => {
  const e = await revisar(41, (m) => {
    m.fetchPrInventory = async () => ({ status: 'unavailable', reason: 'x', headSha: HEAD, baseSha: BASE, mergeBaseSha: MB, changedFiles: 0, files: [] });
  });
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(chamadas.some((c) => c.includes('/compare/')), false);
});

for (const [nome, ajustar] of Object.entries({
  'trees diferentes com a contagem 0': () => { gh.trees = { [HEAD]: TREE, [MB]: 'f'.repeat(40) }; },
  'a tree do head não é legível': () => { gh.trees = { [MB]: TREE }; },
  'a tree do merge-base não é legível': () => { gh.trees = { [HEAD]: TREE }; },
  'o merge-base não é legível': () => { gh.mergeBase = ''; },
})) {
  test(`prova das trees que não fecha (${nome}): caminho normal, com sessão`, async () => {
    ajustar();
    const e = await revisar(42);
    assert.equal(e.sessoes, 1, 'a revisão segue pela sessão');
    assert.notEqual(decisao(e, 42)?.caminho, 'diff_vazio_linhagem');
    assert.equal(envios.some((p) => /diff vazio/.test(p.body || '')), false);
  });
}

// Item 1: o reenvio do COMMENT neutro passa pelas conferências do primeiro envio e publica com o
// status do comentário inconclusivo, sem escrever no dossiê.
async function comentarioQueFalhou(n) {
  gh.commits = commits([1, 1, 1]);
  gh.postFalha = 'HTTP 502: Bad Gateway';
  let dossie = 0;
  const e = await revisar(n, (m) => { m.writeMemory = () => { dossie += 1; }; });
  gh.postFalha = '';
  const d = decisao(e, n);
  assert.equal(d.status, 'pending');
  assert.deepEqual(d.postRetry, { event: 'comment', attempts: 0, statusAoPublicar: 'commented_inconclusive' });
  assert.equal(d.payloads.comment.event, 'COMMENT');
  return { e, dossie: () => dossie };
}

test('reenvio do COMMENT neutro com decisão de gente surgida no head: barra, nada sai', async () => {
  const { e, dossie } = await comentarioQueFalhou(50);
  e.bloqueadoPorHistorico = async () => ({ bloqueado: true, head: HEAD, quem: ['ana'], decisivos: [] });
  await e.retryFailedPosts();
  assert.equal(envios.length, 0);
  const d = decisao(e, 50);
  assert.equal(d.status, 'not_posted');
  assert.equal(d.postRetry, null);
  assert.equal(dossie(), 0);
});

test('reenvio do COMMENT neutro que sai: commented_inconclusive, sem dossiê', async () => {
  const { e, dossie } = await comentarioQueFalhou(51);
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(decisao(e, 51).status, 'commented_inconclusive');
  assert.equal(dossie(), 0, 'o comentário neutro não diz nada do autor');
});

// O reenvio do APPROVE é o reenvio normal: head conferido, dedup, portões e o aviso da aprovação.
async function aprovacaoQueFalhou(n, ajuste) {
  gh.postFalha = 'HTTP 502: Bad Gateway';
  const e = await revisar(n, ajuste);
  gh.postFalha = '';
  const d = decisao(e, n);
  assert.equal(d.status, 'pending');
  assert.equal(d.postRetry.event, 'approve');
  assert.equal(d.postRetry.statusAoPublicar, undefined, 'o APPROVE volta pelo reenvio normal');
  return e;
}

test('reenvio do APPROVE que sai: auto_approved com o aviso da aprovação', async () => {
  const e = await aprovacaoQueFalhou(52, (m) => {
    m.bloqueadoPorChecks = async () => ({ faltando: [{ nome: 'ci', estado: 'vermelho' }], herdados: [], verifiedHead: HEAD });
  });
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  const d = decisao(e, 52);
  assert.equal(d.status, 'auto_approved');
  assert.match(d.attention.map((r) => r.text).join(' '), /aprovado com check obrigatório vermelho no head \(ci\)/);
});

test('reenvio do APPROVE com head andado: nada sai, commit novo marcado', async () => {
  const e = await aprovacaoQueFalhou(53);
  e.headSha = async () => OUTRO;
  await e.retryFailedPosts();
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 53).blockedKind, 'stale_head');
});

test('reenvio do APPROVE com aprovação minha já no head: não posta de novo', async () => {
  const e = await aprovacaoQueFalhou(54);
  e.myReviewStates = async () => ['APPROVED'];
  await e.retryFailedPosts();
  assert.equal(envios.length, 0);
});

// Item 3: a prova em memória só vive enquanto pode servir ao APPROVE desta regra.
test('postagem recusada de vez: a prova técnica em memória é apagada', async () => {
  gh.postFalha = 'HTTP 422: Unprocessable Entity (pull request is locked)';
  const e = await revisar(60);
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 60).postRetry ?? null, null, 'não vai ao reenvio');
  assert.equal(e.technicalApprovals?.has('acme/api#60') === true, false);
});

test('APPROVE já publicado na postagem: a prova técnica em memória é apagada', async () => {
  const e = await revisar(61, (m) => {
    let n = 0;
    m.myReviewStates = async () => (n++ ? ['APPROVED'] : []);
  });
  assert.equal(envios.length, 0);
  assert.equal(decisao(e, 61).status, 'already_reviewed');
  assert.equal(e.technicalApprovals?.has('acme/api#61') === true, false);
});

test('a exceção da publicação exige relatório nulo e a marca de origem do motor', async () => {
  const e = motor();
  const pr = PR(62);
  const isolada = technicalPublication.approvalRefusal;
  try {
    technicalPublication.approvalRefusal = approvalRefusal;
    const prova = (extra) => new Map([[pr.key, { report: null, evidence: ['lacuna da fixture'], evidenceVersion: 2, ...extra }]]);
    e.technicalApprovals = prova({ diffVazio: { head: HEAD } });
    assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: HEAD }))?.blocked, 'technical_review', 'sem a marca de origem não vale');
    e.technicalApprovals = prova({ diffVazio: { head: HEAD, origem: 'diff_vazio_linhagem' } });
    assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: HEAD }))?.blocked, 'technical_review', 'marca serializável não vale');
    e.technicalApprovals = prova({ report: { head: HEAD }, diffVazio: { head: HEAD, origem: ORIGEM_DIFF_VAZIO } });
    assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', body: 'ok', commit_id: HEAD }))?.blocked, 'technical_review', 'com relatório de modelo não vale');
  } finally { technicalPublication.approvalRefusal = isolada; }
});
