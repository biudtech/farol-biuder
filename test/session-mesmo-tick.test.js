// runClaudeStream (lib/engine/session.js) é o estrangulamento por onde passa a sessão de
// IA. Este arquivo trava que o spawn acontece no MESMO tick da chamada (é o que
// test/session-checkpoint-capture.test.js captura) e que a retomada de uma conversa não
// vai para outro perfil ou modelo.
//
// FAROL_HOME antes do import: session.js alcança lib/paths.js, então entra por await import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-session-tick-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
let spawns = 0;
childProcess.spawn = function mockableSpawn(...args) {
  spawns++;
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const session = await import('../lib/engine/session.js');
const { runClaudeStream, parseEnvelope } = session;

const stubAnterior = process.env.FAROL_HEADLESS_CMD;
after(() => {
  childProcess.spawn = realSpawn;
  if (stubAnterior === undefined) delete process.env.FAROL_HEADLESS_CMD;
  else process.env.FAROL_HEADLESS_CMD = stubAnterior;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

beforeEach(() => { spawns = 0; spawnImpl = null; });

function filho() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4343;
  return child;
}

// termina a sessão com um evento result (sucesso) ou com código != 0 (falha)
function encerrar(child, { ok = true } = {}) {
  if (ok) child.stdout.write(JSON.stringify({ type: 'result', result: 'feito', session_id: 's-gate' }) + '\n');
  child.stdout.once('end', () => child.emit('close', ok ? 0 : 1));
  child.stdout.end();
}

function motor({ auth = { kind: 'dir', id: '' } } = {}) {
  const e = {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews: new Map(),
    killTree() { },
    recordUsage() { },
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
  e.resolveClaudeAuth = () => auth;
  return e;
}

test('mudança de perfil ou modelo não envia o sid antigo a outra sessão', async () => {
  const e = motor({ auth: { kind: 'dir', id: 'perfil-a' } });
  spawnImpl = () => { const child = filho(); queueMicrotask(() => encerrar(child)); return child; };
  const first = await runClaudeStream(e, 'primeira', { id: 'perfil', account: 'eu' });
  const before = spawns;
  e.resolveClaudeAuth = () => ({ kind: 'codex', id: 'perfil-b' });
  const opts = { id: 'perfil', account: 'eu', sessionBinding: first.sessionBinding, extraArgs: ['--resume', first.sessionId] };
  await assert.rejects(async () => runClaudeStream(e, 'não executar', opts), /perfil ou modelo mudou/);
  e.resolveClaudeAuth = () => ({ kind: 'dir', id: 'perfil-a' });
  e.config.reviewModel = 'sonnet';
  await assert.rejects(async () => runClaudeStream(e, 'não executar', opts), /perfil ou modelo mudou/);
  assert.equal(spawns, before);
});

test('o spawn acontece no MESMO tick da chamada', async () => {
  delete process.env.FAROL_HEADLESS_CMD;
  const child = filho();
  spawnImpl = () => child;
  const e = motor();
  const p = runClaudeStream(e, 'prompt', { id: 'a1' });
  assert.equal(spawns, 1, 'spawn síncrono, antes de qualquer await');
  encerrar(child);
  const res = await p;
  assert.equal(res.text, 'feito');
  assert.equal('coordination' in res, false);
});
