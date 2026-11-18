// O sinal de vida da sessão (lib/engine/sinal-de-vida.js): o modelo pensando ou escrevendo chega
// como `stream_event`, que não vira linha do feed, e mesmo assim tem de dizer ao cartão do Radar
// que a sessão está viva. O sinal renova no máximo a cada 5 s, e só então empurra o estado.
// Mesmo padrão de test/session-stream.test.js: FAROL_HOME temporário e spawn falso antes do
// import de lib/engine/session.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sinal-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, parseEnvelope } = await import('../lib/engine/session.js');
const { INTERVALO_DO_SINAL_MS, deveRenovar, renovarSinalDeVida } = await import('../lib/engine/sinal-de-vida.js');
const { projectSessions } = await import('../lib/engine/sessao-projecao.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function filhoStream() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4343;
  return child;
}

function engineFalso(rec) {
  const engine = {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    activeReviews: new Map(rec ? [[rec.id, rec]] : []),
    empurroes: 0,
    pushState() { this.empurroes++; },
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'apikey', id: '', apiKey: '', baseUrl: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
  return engine;
}

const STREAM = '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"pensando"}}}\n';
const esperar = () => new Promise((r) => setImmediate(r));

test('deveRenovar: sem sinal, ou com o último sinal a 5 s ou mais', () => {
  assert.equal(INTERVALO_DO_SINAL_MS, 5000);
  assert.equal(deveRenovar(undefined, 1000), true);
  assert.equal(deveRenovar(0, 1000), true);
  assert.equal(deveRenovar(10000, 14999), false);
  assert.equal(deveRenovar(10000, 15000), true);
});

test('renovarSinalDeVida: grava o sinal e empurra o estado, no máximo a cada 5 s, só da revisão em curso', () => {
  const rec = { id: 'a1' };
  const engine = engineFalso(rec);
  assert.equal(renovarSinalDeVida(engine, 'a1', 100000), true);
  assert.equal(rec.ultimoSinalEm, 100000);
  assert.equal(renovarSinalDeVida(engine, 'a1', 104999), false);
  assert.equal(rec.ultimoSinalEm, 100000);
  assert.equal(renovarSinalDeVida(engine, 'a1', 105000), true);
  assert.equal(engine.empurroes, 2);
  assert.equal(renovarSinalDeVida(engine, 'outra', 200000), false);
  assert.equal(renovarSinalDeVida(engine, undefined, 200000), false);
  assert.equal(engine.empurroes, 2);
});

test('o sinal de vida vai para a tela em activeSessions', () => {
  const [sessao] = projectSessions([{ id: 'a1', ultimoSinalEm: 123 }], 200);
  assert.equal(sessao.ultimoSinalEm, 123);
});

test('stream_event da sessão renova o sinal de vida, no máximo a cada 5 s, sem virar linha do feed', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const rec = { id: 'a1' };
  const engine = engineFalso(rec);
  const child = filhoStream();
  spawnImpl = () => child;
  const p = runClaudeStream(engine, 'prompt', { id: 'a1' });
  spawnImpl = null;
  const fim = p.catch(() => {});

  child.stdout.write(STREAM);
  await esperar();
  assert.equal(rec.ultimoSinalEm, 1_000_000, 'o primeiro stream_event renova');
  assert.equal(engine.empurroes, 1);

  // uma rajada dentro dos 5 s não renova nem empurra
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(200);
    child.stdout.write(STREAM);
  }
  await esperar();
  assert.equal(rec.ultimoSinalEm, 1_000_000);
  assert.equal(engine.empurroes, 1);

  t.mock.timers.tick(1000);
  child.stdout.write(STREAM);
  await esperar();
  assert.equal(rec.ultimoSinalEm, 1_005_000, 'passados 5 s, renova de novo');
  assert.equal(engine.empurroes, 2);

  child.stdout.end();
  child.emit('close', 1);
  await fim;
});
