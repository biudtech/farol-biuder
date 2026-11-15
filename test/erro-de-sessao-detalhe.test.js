// A mensagem de erro da sessão é cortada em 300 caracteres na origem, e é essa
// mensagem que a taxonomia, o toast e o retry leem. O corte continua; o texto inteiro
// passa a viajar em detalheCompleto, que é o que o registro durável de falha grava.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-detalhe-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function spawnFalso(...args) { return spawnImpl ? spawnImpl(...args) : realSpawn(...args); };

const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filho() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new EventEmitter();
  c.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  c.pid = 4343;
  return c;
}

function engineFalso() {
  return {
    config: {}, running: new Map(), killTree() { }, recordUsage() { },
    ghEnv: () => ({ PATH: '' }), resolveClaudeAuth: () => ({ kind: 'apikey', id: '', apiKey: '', baseUrl: '' }),
    pushActivity() { }, setSessionModel() { }, toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

test('claude que sai com código != 0: mensagem cortada, detalhe inteiro', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(), 'prompt', { id: 'a-det' });
  spawnImpl = null;
  c.stderr.emit('data', 'e'.repeat(2000) + 'CAUDA');
  c.stdout.once('end', () => c.emit('close', 1));
  c.stdout.end();
  await assert.rejects(p, (err) => {
    assert.ok(err.message.length <= 'claude saiu com código 1: '.length + 300);
    assert.ok(err.detalheCompleto.endsWith('CAUDA'));
    return true;
  });
});

test('evento result com is_error: mensagem cortada, detalhe inteiro', async () => {
  const c = filho();
  spawnImpl = () => c;
  const p = runClaudeStream(engineFalso(), 'prompt', { id: 'a-det2' });
  spawnImpl = null;
  c.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'r'.repeat(900) + 'CAUDA' }) + '\n');
  c.stdout.once('end', () => c.emit('close', 0));
  c.stdout.end();
  await assert.rejects(p, (err) => {
    assert.match(err.message, /^sessão retornou erro: r{300}$/);
    assert.ok(err.detalheCompleto.endsWith('CAUDA'));
    return true;
  });
});
