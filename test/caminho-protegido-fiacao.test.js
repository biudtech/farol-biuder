// A fiação do caminho protegido nas sessões de verdade (06/11/2026, revisão do PR #350): o que o
// lançador RECEBE (guardas e MCP), e a leitura observada que chega ao gate da revisão.
// Os testes dirigem runHeadlessReview e launchReview com o lançador dublado,
// no mesmo molde de test/analysis-source-flows.test.js: nada aqui lê o fonte.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-protegido-fiacao-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { observeReadEvent, observarLeitura } = await import('../lib/engine/read-evidence.js');
const { ARQUIVO_DE_GUARDAS } = await import('../lib/engine/guardas-da-sessao.js');
const { arquivoMaterializado } = await import('../lib/engine/pr-scope.js');
const io = (await import('../lib/io.js')).default;
const original = { ...sourceRuntime }, runOriginal = io.run;
afterEach(() => { Object.assign(sourceRuntime, original); io.run = runOriginal; });
after(() => fs.rmSync(home, { recursive: true, force: true }));

const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1', author: 'autor', headSha: H, requested: true };
const PROJECAO = '# projeção redigida\n+DEBUG=true\n';
const files = [
  { path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' },
  { path: '.env.example', sha: 'e'.repeat(40), status: 'modified', patch: PROJECAO, patchStatus: 'available' },
];
const GUARDAS = ['--settings', `"${ARQUIVO_DE_GUARDAS}"`];

// A execução isolada lê pela fonte (reader); as outras não precisam dele.
function source(arquivos = files, comLeitor = false, status = 'complete') {
  const reader = comLeitor ? { tree: async () => ({ complete: true, entries: arquivos.map((f) => ({ path: f.path, readable: true, mode: '100644' })) }),
    read: async () => ({ status: 'available', text: 'source' }) } : {};
  return { status, reason: status === 'complete' ? '' : 'Fixture sem acesso à fonte.', reader,
    manifest: { scope: { account: 'fixture', repo: 'org/repo' }, H, B, M, files: arquivos, limitations: [] },
    inventory: { status, headSha: H, baseSha: B, files: arquivos, changedFiles: arquivos.length },
    release: async () => {} };
}
function setup({ jira = true } = {}) {
  const e = new Engine();
  e.config = { ...e.config, reReviewResume: false, reviewContextMode: 'off',
    jiraSites: jira ? [{ id: 'site-fixture', baseUrl: 'https://fixture.example.invalid', owners: ['outra-org'] }] : [],
    conta: { user: 'fixture', owners: ['org'], autoReview: false } };
  e.accountForPr = () => 'fixture'; e.tokenFor = () => 'fixture-token'; e.resolveClaudeAuth = () => ({ kind: 'dir' });
  e.headSha = async () => H;
  e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: H });
  e.myReviewStates = async () => [];
  e.decisions = { pending: [], resolved: [] };
  e.writeMemory = e.writeInflight = e.pushState = e.processHeadless = e.log = () => {};
  // desde 17/11/2026 a conta não espera mais (o `wait` saiu), então a revisão tenta postar: a
  // fixture recusa como falha passageira do GitHub, nada sai e a decisão fica gravada para leitura
  e.postReview = async () => ({ ok: false, attempted: true, error: 'HTTP 502: Bad Gateway' });
  io.run = async (_command, args) => {
    if (args.includes('headRefOid')) return { ok: true, stdout: H };
    if (args.includes('--json')) return { ok: true, stdout: JSON.stringify({ headRefOid: H, baseRefOid: B, statusCheckRollup: [] }) };
    if (args.includes('--paginate')) return { ok: true, stdout: '[[]]' };
    return { ok: false, code: 1, stdout: '', stderr: 'Operação externa bloqueada pela fixture.' };
  };
  sourceRuntime.prepareSources = async () => source();
  return e;
}

// A leitura da projeção redigida como o stream do Claude a entrega: pedido e retorno conferível.
function lerProjecao(e, opts, comRetorno, caminho = '.env.example') {
  const session = e.activeReviews.get(opts.id);
  const filePath = arquivoMaterializado(session.scopeRoot, caminho);
  assert.equal(fs.readFileSync(filePath, 'utf8'), PROJECAO, 'a projeção está no nome redigido');
  const block = { type: 'tool_use', id: 'r-env', name: 'Read', input: { file_path: filePath } };
  observeReadEvent(e, opts, { type: 'assistant', message: { content: [block] } });
  observarLeitura(e, opts, block);
  if (!comRetorno) return;
  const linhas = PROJECAO.split('\n');
  observeReadEvent(e, opts, { type: 'user', tool_use_result: { type: 'text', file: { filePath, content: PROJECAO, startLine: 1, numLines: linhas.length } },
    message: { content: [{ type: 'tool_result', tool_use_id: 'r-env', content: linhas.map((l, i) => `${i + 1}→${l}`).join('\n') }] } });
}

function reviewResult(revisados = ['src/a.js', '.env.example']) {
  return { ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', reasons: [],
    findings: [], reportMarkdown: 'Análise sintética.', reviewMarkdown: 'Análise sintética.',
    coverage: { total: revisados.length, reviewed: revisados, missing: [] },
    alcance: [{ alterado: 'src/a.js', chamadores: [], semChamador: 'Fixture não declara consumidor externo.' }],
    payloads: { approve: { event: 'APPROVE', body: 'Análise sintética.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Análise sintética.' } } };
}
const LACUNA = /caminho protegido sem leitura observada da projeção redigida: \.env\.example/;
const motivosDe = (item) => JSON.stringify(item);

test('a revisão headless entrega ao lançador o MCP do Jira e as guardas juntos', async () => {
  const e = setup();
  let args = null;
  e.runClaudeStream = async (_prompt, opts) => { args = opts.extraArgs; return { text: JSON.stringify(reviewResult()) }; };
  await e.runHeadlessReview({ ...pr });
  assert.ok(Array.isArray(args), 'o lançador foi chamado');
  assert.ok(args.includes('--mcp-config') && args.includes('--strict-mcp-config'), JSON.stringify(args));
  const i = args.indexOf('--settings');
  assert.deepEqual(args.slice(i, i + 2), GUARDAS, 'as guardas da sessão chegam ao lançador');
});

test('a revisão headless sem Jira cadastrado ainda recebe as guardas', async () => {
  const e = setup({ jira: false });
  let args = null;
  e.runClaudeStream = async (_prompt, opts) => { args = opts.extraArgs; return { text: JSON.stringify(reviewResult()) }; };
  await e.runHeadlessReview({ ...pr });
  assert.deepEqual(args, GUARDAS);
});

test('a leitura observada da projeção chega ao gate da revisão (leiturasProvadas)', async () => {
  for (const comRetorno of [false, true]) {
    const e = setup();
    e.runClaudeStream = async (_prompt, opts) => { lerProjecao(e, opts, comRetorno); return { text: JSON.stringify(reviewResult()) }; };
    await e.runHeadlessReview({ ...pr });
    const item = e.decisions.pending[0] || decisoesResolvidas(e)[0];
    assert.ok(item, 'a decisão foi registrada');
    if (comRetorno) assert.doesNotMatch(motivosDe(item), LACUNA, 'leitura conferida cobre o protegido');
    else assert.match(motivosDe(item), LACUNA, 'só o pedido, sem entrega conferida, é lacuna');
  }
});

/* ---------- o protocolo ---------- */

test('o protocolo do pr-reviewer descreve o nome achatado da projeção', () => {
  const agente = fs.readFileSync(path.join(import.meta.dirname, '..', 'workspace-template', '.claude', 'agents', 'pr-reviewer.md'), 'utf8');
  assert.match(agente, /_farol_redigido_\/_apps%2Fweb%2F\.env\.local\.redigido/);
});

/* ---------- rename vindo de caminho protegido (revisão do head 3f580395) ---------- */

// `.env.example` renomeado para `config.txt`: o destino tem nome comum, mas o patch traz o
// conteúdo de antes. A prova de leitura tem de olhar os dois lados do rename.
const RENOMEADO = { path: 'config.txt', previousPath: '.env.example', sha: 'f'.repeat(40), status: 'renamed', patch: PROJECAO, patchStatus: 'available' };
const COM_RENAME = [files[0], RENOMEADO];
const LACUNA_DO_RENAME = /caminho protegido sem leitura observada da projeção redigida: config\.txt/;

test('rename de .env.example para config.txt: a revisão só cobre o destino com a entrega conferida', async () => {
  for (const comRetorno of [false, true]) {
    const e = setup();
    sourceRuntime.prepareSources = async () => source(COM_RENAME);
    e.runClaudeStream = async (_prompt, opts) => {
      lerProjecao(e, opts, comRetorno, 'config.txt');
      return { text: JSON.stringify(reviewResult(['src/a.js', 'config.txt'])) };
    };
    await e.runHeadlessReview({ ...pr });
    const item = e.decisions.pending[0] || decisoesResolvidas(e)[0];
    if (comRetorno) assert.doesNotMatch(motivosDe(item), LACUNA_DO_RENAME);
    else assert.match(motivosDe(item), LACUNA_DO_RENAME, 'só o pedido do Read no destino do rename é lacuna');
  }
});

test('rename de .env.example para config.txt: o inventário medido pelo gh guarda o lado de antes e a revisão o trata como protegido', async () => {
  const e = setup();
  sourceRuntime.prepareSources = async () => source(COM_RENAME, false, 'unavailable');
  const chamadas = [];
  io.run = async (_command, args) => {
    const linha = args.join(' ');
    chamadas.push(linha);
    if (linha.includes('pulls/1/files')) {
      return { ok: true, stdout: JSON.stringify([
        { path: 'src/a.js', sha: files[0].sha, status: 'modified', lines: 2, previousPath: null },
        { path: 'config.txt', sha: RENOMEADO.sha, status: 'renamed', lines: 2, previousPath: '.env.example' }]) };
    }
    if (linha.includes('repos/org/repo/pulls/1 ') || linha.endsWith('repos/org/repo/pulls/1')) {
      return { ok: true, stdout: JSON.stringify({ headSha: H, baseSha: B, changedFiles: 2 }) };
    }
    if (args.includes('headRefOid')) return { ok: true, stdout: H };
    if (args.includes('--json')) return { ok: true, stdout: JSON.stringify({ headRefOid: H, baseRefOid: B, statusCheckRollup: [] }) };
    return { ok: false, code: 1, stdout: '', stderr: 'Operação externa bloqueada pela fixture.' };
  };
  e.runClaudeStream = async () => ({ text: JSON.stringify(reviewResult(['src/a.js', 'config.txt'])) });
  await e.runHeadlessReview({ ...pr });
  assert.ok(chamadas.some((c) => c.includes('pulls/1/files') && c.includes('previous_filename')), 'o jq pede o lado de antes do rename');
  const item = e.decisions.pending[0] || decisoesResolvidas(e)[0];
  assert.match(motivosDe(item), LACUNA_DO_RENAME, 'declarado sem leitura observada, o destino do rename é lacuna');
});

/* ---------- representação sem conteúdo integral (revisão do head b97f27f4) ---------- */

// Patch ausente (protegido sem projeção, binário) ou truncado: o escopo grava um marcador ou um
// fragmento, e ler isso inteiro nunca pode virar cobertura, nem do protegido nem do comum.
const SEM_PATCH = [
  { path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' },
  { path: '.env.example', sha: 'e'.repeat(40), status: 'modified', patch: '', patchStatus: 'unavailable' },
  { path: 'img/logo.png', sha: '1'.repeat(40), status: 'modified', patch: '', patchStatus: 'unavailable' },
  { path: 'src/grande.js', sha: '2'.repeat(40), status: 'modified', patch: '@@ -1,900 +1,900 @@\n-x\n+y', patchStatus: 'partial' },
];
const INCOMPLETOS = ['.env.example', 'img/logo.png', 'src/grande.js'];

// Lê do escopo o que estiver gravado (marcador, fragmento ou patch), com a entrega inteira conferível.
function lerTudoDoEscopo(e, opts, caminhos) {
  const session = e.activeReviews.get(opts.id);
  for (const [i, caminho] of caminhos.entries()) {
    const filePath = arquivoMaterializado(session.scopeRoot, caminho);
    // o protegido sem projeção não tem arquivo nenhum: a entrega simulada é a de um marcador
    const texto = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : 'marcador\n';
    const block = { type: 'tool_use', id: `r-${i}`, name: 'Read', input: { file_path: filePath } };
    observeReadEvent(e, opts, { type: 'assistant', message: { content: [block] } });
    observarLeitura(e, opts, block);
    const linhas = texto.replace(/\n$/, '').split('\n');
    observeReadEvent(e, opts, { type: 'user', tool_use_result: { type: 'text', file: { filePath, content: linhas.join('\n'), startLine: 1, numLines: linhas.length } },
      message: { content: [{ type: 'tool_result', tool_use_id: `r-${i}`, content: linhas.map((l, n) => `${n + 1}→${l}`).join('\n') }] } });
  }
}

test('patch ausente ou truncado: na revisão, ler o marcador ou o fragmento inteiro não cobre, e o declarado vira lacuna', async () => {
  const e = setup();
  sourceRuntime.prepareSources = async () => source(SEM_PATCH);
  e.runClaudeStream = async (_prompt, opts) => {
    lerTudoDoEscopo(e, opts, SEM_PATCH.map((f) => f.path));
    return { text: JSON.stringify(reviewResult(SEM_PATCH.map((f) => f.path))) };
  };
  await e.runHeadlessReview({ ...pr });
  const motivos = motivosDe(e.decisions.pending[0] || decisoesResolvidas(e)[0]);
  assert.match(motivos, /caminho protegido sem leitura observada da projeção redigida: \.env\.example/, 'o marcador do protegido não é projeção');
  assert.match(motivos, /arquivo sem conteúdo integral no escopo \(patch ausente, binário ou truncado\): img\/logo\.png/);
  assert.match(motivos, /arquivo sem conteúdo integral no escopo \(patch ausente, binário ou truncado\): src\/grande\.js/);
  assert.doesNotMatch(motivos, /sem conteúdo integral no escopo \(patch ausente, binário ou truncado\): src\/a\.js/);
});
