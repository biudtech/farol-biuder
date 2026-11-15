import { criteriaFixture } from './helpers/criteria-fixture.js';
// A label de revisando e a marca do round automático na revisão headless.
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import) e sessão stubada no padrão de test/dedup-round.test.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-revisao-rodada-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();

const reviewMod = (await import('../lib/engine/review.js')).default;
const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;

// fan-out neutro (sem gh) e o gh da label de "revisando" gravado em vez de rodar
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
let ghCalls = [];
io.run = async (cmd, args) => { ghCalls.push([cmd, ...args].join(' ')); return { ok: true, code: 0, stdout: '', stderr: '' }; };

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { ghCalls = []; });

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key, extra = {}) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, ...extra });

function envelopeApprove() {
  return {
    protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } },
  };
}

// sessão stubada: devolve `resposta` e guarda os opts que o runHeadlessReview mandou
function motor({ resposta, policy = 'approve' } = {}) {
  const e = new Engine();
  e.config.claudeProfiles = [{ id: 'ka', label: 'Chave A', kind: 'apikey', apiKey: 'sk-fixture-retomada', baseUrl: '' }];
  e.config.claudeProfileId = 'ka';
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.isMuted = () => false;
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => [];
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.postados = [];
  e.postReview = async (pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => { e.opts.push(opts); return resposta; };
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  return e;
}

const resultado = (envelope) => ({ text: JSON.stringify({ result: JSON.stringify(envelope) }), sessionId: 's1' });

test('não existe teto diário local de reviews', () => {
  assert.equal(reviewMod.MAX_RODADAS_AUTO_DIA, undefined);
});

test('a label de revisando entra e sai na revisão automática', async () => {
  const e = motor({ resposta: resultado(envelopeApprove()) });
  await e.runHeadlessReview(prDe('o/r#21'));
  assert.ok(ghCalls.some((c) => c.includes('--add-label')));
  assert.ok(ghCalls.some((c) => c.includes('--remove-label')));
  assert.equal(e.postados.length, 1);
});

// O retry transitório e a fila de volta reusam o MESMO objeto de PR: a marca que ficasse
// nele faria a rodada seguinte soltar a âncora de um round que já rodou.
test('a marca do round automático vale para uma sessão só', async () => {
  const e = motor({ resposta: resultado(envelopeApprove()) });
  const pr = prDe('o/r#22', { rodadaAutomatica: true });
  await e.runHeadlessReview(pr);
  assert.equal(pr.rodadaAutomatica, false);
  assert.equal('operationKind' in e.opts[0], false);
  assert.equal('coordination' in e.opts[0], false);
});

test('launchReReviews carimba rodadaAutomatica no PR enfileirado', async () => {
  const pr = prDe('org/app#8');
  const enq = [];
  const e = {
    panorama: [pr],
    staleInfo: { [pr.key]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [pr.key]: { head: 'sha-novo', at: 0 } },
    reReviewLaunched: {}, decisions: { pending: [], resolved: [] },
    autoReviewParked: new Set(), retryAfterNet: new Map(), headlessQueue: [], activeReviews: new Map(),
    accountForPr: () => 'eu', isMuted: () => false, autoReviewFor: () => true, tokenFor: () => 'tok',
    budgetBlockedFor: () => null, outrosRevisando: () => [], skipComentado: {},
    saveReReviewLaunched() { }, emit() { }, enqueueHeadless(p) { enq.push(p); },
    bloqueiaAutomatico: async () => false, fetchPrFiles: async () => null,
  };
  await reviewMod.launchReReviews(e);
  assert.equal(enq.length, 1);
  assert.equal(enq[0].rodadaAutomatica, true);
});
