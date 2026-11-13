// lib/engine/diagnostico.js: leitura do log de falhas (a cauda que alimenta o
// diagnóstico e o triage). Antes morava em lib/workspace.js.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-diagnostico-log-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { STATE_DIR, LOG_FILE } = await import('../lib/paths.js');
const { tailLog } = await import('../lib/engine/diagnostico.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

beforeEach(() => {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
});

/* ---------- tailLog ---------- */

test('tailLog: sem arquivo devolve lista vazia, não lança', () => {
  assert.deepEqual(tailLog(), []);
});

test('tailLog: devolve as últimas N linhas, sem as vazias', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, ['l1', 'l2', '', 'l3', 'l4', ''].join('\n'));
  assert.deepEqual(tailLog(2), ['l3', 'l4']);
  assert.deepEqual(tailLog(), ['l1', 'l2', 'l3', 'l4']);
});

test('tailLog: pedir mais linhas do que existe devolve tudo', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, 'unica\n');
  assert.deepEqual(tailLog(500), ['unica']);
});

test('tailLog: aceita CRLF (log gravado no Windows)', () => {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, 'a\r\nb\r\nc\r\n');
  assert.deepEqual(tailLog(), ['a', 'b', 'c']);
});
