import { criteriaFixture } from './helpers/criteria-fixture.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-source-flows-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { PROFILE_FILE } = await import('../lib/technical-review/profiles.js');
const io = (await import('../lib/io.js')).default;
const original = { ...sourceRuntime }, runOriginal = io.run;
afterEach(() => { Object.assign(sourceRuntime, original); io.run = runOriginal; });
after(() => fs.rmSync(home, { recursive: true, force: true }));
const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1, url: 'https://github.com/org/repo/pull/1', author: 'autor', headSha: H, requested: true };
const files = [{ path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }];
function source(status = 'complete') {
  let releases = 0;
  return { status, reason: status === 'complete' ? '' : 'Fixture sem acesso à fonte.',
    manifest: { scope: { account: 'fixture', repo: 'org/repo' }, H, B, M, files, limitations: [] }, reader: {},
    inventory: { status, headSha: H, baseSha: B, files, changedFiles: files.length },
    release: async () => { releases++; }, releases: () => releases };
}
function setup() {
  const e = new Engine();
  e.config = { ...e.config, jiraSites: [], reReviewResume: false, reviewContextMode: 'off',
    conta: { user: 'fixture', owners: ['org'], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } };
  e.accountForPr = () => 'fixture'; e.tokenFor = () => ''; e.resolveClaudeAuth = () => ({ kind: 'apikey', id: '', apiKey: '', baseUrl: '' });
  e.headSha = async () => H;
  e.bloqueadoPorChecks = async () => ({ faltando: [], verifiedHead: H });
  e.myReviewStates = async () => [];
  e.decisions = { pending: [], resolved: [] };
  e.writeMemory = e.writeInflight = e.pushState = e.processHeadless = e.log = () => {};
  e.postReview = async () => { throw new Error('Nenhuma publicação permitida na fixture.'); };
  e.fetchPrInventory = async () => { throw new Error('Não deve repetir inventário preparado.'); };
  io.run = async (_command, args) => {
    if (args.includes('headRefOid')) return { ok: true, stdout: H };
    if (args.includes('--json')) return { ok: true, stdout: JSON.stringify({ headRefOid: H, baseRefOid: B, statusCheckRollup: [] }) };
    if (args.includes('--paginate')) return { ok: true, stdout: '[[]]' };
    return { ok: false, code: 1, stdout: '', stderr: 'Operação externa bloqueada pela fixture.' };
  };
  return e;
}
function reviewResult() {
  return { ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', reasons: [],
    findings: [], reportMarkdown: 'Análise sintética.', reviewMarkdown: 'Análise sintética.',
    coverage: { total: 1, reviewed: [], missing: ['src/a.js'] },
    alcance: [{ alterado: 'src/a.js', chamadores: [], semChamador: 'Fixture não declara consumidor externo.' }],
    contextEvidence: { sourceStatus: 'forged', mode: 'assist' },
    payloads: { approve: { event: 'APPROVE', body: 'Análise sintética.' }, request_changes: { event: 'REQUEST_CHANGES', body: 'Análise sintética.' } } };
}
function assertPrepared(prompt, session) {
  assert.match(prompt, /Fontes e patches preparados/);
  for (const sha of [H, B, M]) assert.ok(prompt.includes(sha));
  assert.equal(fs.readFileSync(path.join(session.scopeRoot, 'src/a.js'), 'utf8'), files[0].patch);
  assert.equal(session.totalArquivos, 1);
}

test('Engine review usa fonte comum sem perfil técnico e persiste diagnóstico que o modelo não pode forjar', async () => {
  const e = setup(), handle = source();
  assert.equal(fs.existsSync(PROFILE_FILE), false);
  sourceRuntime.prepareSources = async () => handle;
  let entered = 0;
  e.runClaudeStream = async (prompt, options) => {
    entered++; assertPrepared(prompt, e.activeReviews.get(options.id));
    return { text: JSON.stringify(reviewResult()) };
  };
  await e.runHeadlessReview({ ...pr });
  assert.equal(entered, 1); assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  const item = e.decisions.pending[0] || e.decisions.resolved[0];
  assert.ok(item); assert.equal(item.contextEvidence.sourceStatus, 'complete'); assert.equal(item.contextEvidence.mode, 'off');
  assert.equal(item.technicalReview.semDeclaracao, true);
});
test('cancelamento na aquisição impede modelo, não publica e devolve a referência da fonte', async () => {
  for (const flow of ['runHeadlessReview']) {
    const e = setup(), handle = source(); let entered, finish, signal, model = 0;
    const acquisition = new Promise(resolve => { entered = resolve; });
    sourceRuntime.prepareSources = (_engine, _pr, options) => {
      signal = options.signal; entered(); return new Promise(resolve => { finish = resolve; });
    };
    e.runClaudeStream = async () => { model++; throw new Error('Não deve executar.'); };
    const running = e[flow]({ ...pr }); await acquisition;
    const id = [...e.activeReviews.keys()][0]; assert.ok(id);
    assert.deepEqual(e.cancelSession(id), { ok: true }); assert.equal(signal.aborted, true);
    finish(handle);
    await assert.rejects(running, error => error.cancelled === true);
    assert.equal(model, 0); assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
    assert.equal(e.decisions.pending.length + e.decisions.resolved.length, 0);
  }
});
test('falha do modelo libera a fonte e não inventa resultado', async () => {
  for (const flow of ['runHeadlessReview']) {
    const e = setup(), handle = source(); sourceRuntime.prepareSources = async () => handle;
    e.runClaudeStream = async () => { throw new Error('Provedor indisponível na fixture.'); };
    await assert.rejects(e[flow]({ ...pr }), /Provedor indisponível/);
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
    assert.equal(e.decisions.pending.length + e.decisions.resolved.length, 0);
  }
});
test('fonte indisponível mantém fallback inconclusivo, sem cobertura ou aprovação fabricadas', async () => {
  for (const flow of ['runHeadlessReview']) {
    const e = setup(), handle = source('unavailable'); sourceRuntime.prepareSources = async () => handle;
    e.fetchPrInventory = async () => ({ status: 'unavailable', reason: 'Fixture sem inventário.', headSha: H, baseSha: B, files: [], changedFiles: null });
    e.runClaudeStream = async prompt => {
      assert.equal(prompt.includes('## Fontes e patches preparados'), false);
      return { text: JSON.stringify(reviewResult()) };
    };
    await e[flow]({ ...pr });
    const item = e.decisions.pending[0];
    assert.ok(item); assert.equal(item.contextEvidence.sourceStatus, 'unavailable');
    assert.equal(item.inventarioDiff.status, 'unavailable');
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  }
});
test('falha do índice em assist permite fluxo existente e registra limitação no resultado', async () => {
  for (const flow of ['runHeadlessReview']) {
    const e = setup(), handle = source(); e.config.reviewContextMode = 'assist';
    sourceRuntime.prepareSources = async () => handle;
    sourceRuntime.buildMap = async () => { throw new Error('Fixture de índice incompleto.'); };
    e.runClaudeStream = async (prompt, options) => {
      assertPrepared(prompt, e.activeReviews.get(options.id));
      assert.equal(prompt.includes('## Navegação do código na revisão fixada'), false);
      return { text: JSON.stringify(reviewResult()) };
    };
    await e[flow]({ ...pr });
    const item = e.decisions.pending[0];
    assert.equal(item.contextEvidence.indexStatus, 'unavailable');
    assert.equal(handle.releases(), 1); assert.equal(e.activeReviews.size, 0);
  }
});

test('observe preserva prompt completo e resultado decisório de off; assist injeta só navegação', async () => {
  for (const flow of ['runHeadlessReview']) {
    const measured = [];
    for (const mode of ['off', 'observe', 'assist']) {
      // Cada modo recebe o mesmo estado inicial da memória comum, em fixture privada.
      fs.rmSync(path.join(home, 'workspace', 'state', 'review-rounds'), { recursive: true, force: true });
      const e = setup(), handle = source(), calls = []; e.config.reviewContextMode = mode;
      sourceRuntime.prepareSources = async () => { calls.push('sources'); return handle; };
      sourceRuntime.buildMap = async () => { calls.push('map'); return { complete: true, head: { metrics: {} }, previous: { metrics: {} } }; };
      sourceRuntime.selectContext = async () => {
        calls.push('selection');
        return { schema: 1, snippets: [], references: [{ path: 'src/caller.js', reason: 'consumidor fixture', origin: 'parser', confidence: 'candidate' }],
          omitted: [], limitations: [], impactedPaths: ['src/caller.js'], metrics: { budgetTokens: 1000, tokenEstimate: 50 } };
      };
      let completePrompt;
      e.runClaudeStream = async (prompt, options) => {
        const session = e.activeReviews.get(options.id), scopeRoot = session.scopeRoot;
        completePrompt = prompt.replaceAll(JSON.stringify(scopeRoot).slice(1, -1), 'FROZEN_SCOPE_ROOT')
          .replaceAll(scopeRoot, 'FROZEN_SCOPE_ROOT').replaceAll(options.id, 'FROZEN_SESSION_ID');
        return { text: JSON.stringify(reviewResult()) };
      };
      await e[flow]({ ...pr });
      const item = e.decisions.pending[0];
      assert.ok(item); assert.equal(handle.releases(), 1);
      measured.push({ prompt: completePrompt, result: { verdict: item.verdict, status: item.status, decision: item.decision,
        approvable: item.approvable, reasons: item.reasons, payloads: item.payloads }, work: item.contextEvidence.work });
      assert.deepEqual(calls, mode === 'off' ? ['sources'] : ['sources', 'map', 'selection']);
    }
    let difference = 0;
    while (difference < measured[0].prompt.length && measured[1].prompt[difference] === measured[0].prompt[difference]) difference++;
    assert.ok(measured[1].prompt === measured[0].prompt,
      `observe alterou prompt em ${difference}: ${JSON.stringify(measured.map(item => item.prompt.slice(Math.max(0, difference - 60), difference + 120)))}`);
    assert.deepEqual(measured[1].result, measured[0].result, 'observe mantém resultado decisório e payload');
    assert.equal(measured[0].prompt.includes('## Navegação do código na revisão fixada'), false);
    assert.equal(measured[1].prompt.includes('## Navegação do código na revisão fixada'), false);
    assert.equal(measured[2].prompt.includes('## Navegação do código na revisão fixada'), true);
    assert.deepEqual(measured[0].work, { sources: true, map: false, selection: false, injection: false });
    assert.deepEqual(measured[1].work, { sources: true, map: true, selection: true, injection: false });
    assert.deepEqual(measured[2].work, { sources: true, map: true, selection: true, injection: true });
  }
});
