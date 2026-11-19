// O gatilho de cada sessão no registro de consumo (redesenho, lote 2, 19/11/2026): por que a
// sessão rodou. `primeira` (a revisão pedida, pela fila ou pelo clique), `commit_novo` (o round
// automático depois de um push), `rodada_extra` (o desfecho sem mesa, a busca da prova e a
// reconferência técnica, no mesmo commit) e `contestacao` (a leitura do pushback do autor).
// Gravado daqui em diante; o registro antigo sem marca conta como `primeira` na revisão e
// `contestacao` no pushback. Só informa a tela: nenhuma regra de gate, fila ou postagem lê.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-gatilho-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const spawnReal = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function spawnTrocavel(...args) { return spawnImpl ? spawnImpl(...args) : spawnReal(...args); };

const { GATILHOS, gatilhoDoRound, gatilhoDaLinha } = await import('../lib/engine/gatilho-da-sessao.js');
const { camposDaTentativa } = await import('../lib/engine/usage-desfechos.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');
const reviewMod = (await import('../lib/engine/review.js')).default;
const { classifyPushback } = await import('../lib/engine/pushback.js');
const { launchTechnicalRechecks } = await import('../lib/technical-review/recheck.js');

after(() => {
  childProcess.spawn = spawnReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('os quatro gatilhos, na ordem do desenho', () => {
  assert.deepEqual([...GATILHOS], ['primeira', 'commit_novo', 'rodada_extra', 'contestacao']);
});

test('a linha sem marca: revisão é primeira, pushback é contestação, o resto não tem gatilho', () => {
  assert.equal(gatilhoDaLinha({ kind: 'review' }), 'primeira');
  assert.equal(gatilhoDaLinha({ kind: 'pushback' }), 'contestacao');
  assert.equal(gatilhoDaLinha({ kind: 'review', gatilho: 'commit_novo' }), 'commit_novo');
  assert.equal(gatilhoDaLinha({ kind: 'review', gatilho: 'inventado' }), 'primeira');
  assert.equal(gatilhoDaLinha({ kind: 'tool' }), '');
  assert.equal(gatilhoDaLinha({ kind: 'chat', gatilho: 'commit_novo' }), '', 'conversa e ferramenta não têm gatilho de PR');
});

test('o round automático: commit novo, ou rodada extra quando a pendência pede de novo o mesmo commit', () => {
  assert.equal(gatilhoDoRound(null), 'commit_novo', 'gatilho A, o review postado que ficou para trás');
  assert.equal(gatilhoDoRound({ blockedHead: 'h2', headSha: 'h1' }), 'commit_novo', 'pendência stale_head de commit novo');
  assert.equal(gatilhoDoRound({ blockedHead: 'h1', headSha: 'h1', semMesa: { rodadas: 1 } }), 'rodada_extra');
  assert.equal(gatilhoDoRound({ blockedHead: 'h1', headSha: 'h1', esperaProva: { alvo: 'h1' } }), 'rodada_extra');
  assert.equal(gatilhoDoRound({ blockedHead: 'h2', headSha: 'h1', semMesa: { rodadas: 1 } }), 'commit_novo', 'o commit andou');
  assert.equal(gatilhoDoRound({ blockedHead: 'h1', headSha: 'h1' }), 'commit_novo', 'sem marca de rodada extra');
});

test('a marca do evento vira o campo `gatilho` da linha, só com um dos quatro valores', () => {
  assert.equal(camposDaTentativa({ farol_gatilho: 'rodada_extra' }).gatilho, 'rodada_extra');
  assert.equal('gatilho' in camposDaTentativa({ farol_gatilho: 'qualquer' }), false);
  assert.equal('gatilho' in camposDaTentativa({}), false);
  const eng = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { } };
  usage.recordUsage(eng, 'a-g1', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, farol_gatilho: 'commit_novo' }, 'claude-opus-5', '', 'o/r#1');
  assert.equal(eng.usageSessions.sessions.at(-1).gatilho, 'commit_novo');
  usage.recordUsage(eng, 'a-g2', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1 }, 'claude-opus-5', '', 'o/r#1');
  assert.equal('gatilho' in eng.usageSessions.sessions.at(-1), false, 'sem marca não grava nada');
});

function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4243;
  return child;
}

test('o gatilho do opts da sessão chega ao registro de consumo', async () => {
  const registros = [];
  const engine = {
    config: {}, ghEnv: () => ({ PATH: process.env.PATH }), running: new Map(), killTree() { },
    recordUsage(id, account, ev) { registros.push(ev); },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }), toolSummary: () => '', pushActivity() { }, setSessionModel() { },
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'a-g', account: 'eu', ref: 'o/r#1', gatilho: 'rodada_extra' });
  spawnImpl = null;
  child.stdout.write(JSON.stringify({ type: 'result', result: '{}', usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.01, session_id: 's' }) + '\n');
  child.stdout.once('end', () => child.emit('close', 0));
  child.stdout.end();
  await p.catch(() => { });
  assert.equal(registros.length, 1);
  assert.equal(registros[0].farol_gatilho, 'rodada_extra');
});

const KEY = 'org/app#7';
function engineDoRound(extra = {}) {
  const pr = { key: KEY, url: 'https://github.com/org/app/pull/7', author: 'dev' };
  return {
    panorama: [pr], staleInfo: {}, headQuietoDesde: {}, reReviewLaunched: {},
    decisions: { pending: [], resolved: [] }, autoReviewParked: new Set(), retryAfterNet: new Map(),
    headlessQueue: [], activeReviews: new Map(), enq: [],
    accountForPr: () => 'eu', autoReviewFor: () => true, tokenFor: () => 'tok', outrosRevisando: () => [],
    saveReReviewLaunched() { }, saveDecisions() { }, emit() { }, enqueueHeadless(p) { this.enq.push(p); return { ok: true }; },
    bloqueiaAutomatico: async () => false, bloqueadoPorHistorico: async () => false,
    ...extra,
  };
}

test('o round automático enfileira com o gatilho: commit novo pelo review que ficou para trás', async () => {
  const e = engineDoRound({
    staleInfo: { [KEY]: { stale: true, head: 'sha-novo', lastState: 'CHANGES_REQUESTED' } },
    headQuietoDesde: { [KEY]: { head: 'sha-novo', at: 0 } },
  });
  await reviewMod.launchReReviews(e);
  assert.equal(e.enq.length, 1);
  assert.equal(e.enq[0].gatilho, 'commit_novo');
});

test('o round automático enfileira com o gatilho: rodada extra no mesmo commit do desfecho sem mesa e da busca da prova', async () => {
  for (const marca of [{ semMesa: { rodadas: 1 } }, { esperaProva: { alvo: 'h1', desde: 1 } }]) {
    const pend = { id: 'd1', key: KEY, status: 'pending', createdAt: 1, headSha: 'h1', blockedKind: 'stale_head', blockedHead: 'h1',
      pr: { url: 'https://github.com/org/app/pull/7' }, ...marca };
    const e = engineDoRound({ decisions: { pending: [pend], resolved: [] } });
    await reviewMod.launchReReviews(e);
    assert.equal(e.enq.length, 1, JSON.stringify(marca));
    assert.equal(e.enq[0].gatilho, 'rodada_extra', JSON.stringify(marca));
  }
});

test('a reconferência técnica relança como rodada extra', () => {
  const item = { id: 'd1', key: KEY, technicalRecheck: true, pr: { url: 'https://github.com/org/app/pull/7', requested: true, origem: 'fila' } };
  const enq = [];
  const engine = {
    decisions: { pending: [item] }, config: {}, accountForPr: () => 'eu', autoReviewFor: () => true, tokenFor: () => 'tok', saveDecisions() { },
    enqueueHeadless(p) { enq.push(p); return { ok: true }; },
  };
  launchTechnicalRechecks(engine);
  assert.equal(enq.length, 1);
  assert.equal(enq[0].gatilho, 'rodada_extra');
});

test('a contestação abre a sessão com o gatilho contestacao', async () => {
  const vistos = [];
  const engine = {
    accountForPr: () => 'eu', sessionSeq: 0,
    runClaudeStream: async (_p, opts) => { vistos.push(opts); return { text: '{"isPushback":false,"outcome":"none","confidence":"low","note":""}' }; },
    log() { },
  };
  await classifyPushback(engine, { key: KEY, url: 'https://github.com/org/app/pull/7', author: 'dev' }, 'm').catch(() => null);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].gatilho, 'contestacao');
});
