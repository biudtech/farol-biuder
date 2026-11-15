// A sessão comum vista pela LINHA DE COMANDO que o Claude recebe de verdade: nenhuma
// restrição de ferramenta (--tools, --safe-mode). O modo somente leitura saiu com o
// diagnóstico por IA (corte da fase 1, lote 7).
// Mesmo padrão do session-stream: spawn trocado antes do import.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-cmdline-'));
process.env.FAROL_HOME = FAROL_HOME;
delete process.env.FAROL_HEADLESS_CMD;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
const chamadas = [];
childProcess.spawn = function spawnCapturado(cmd, args) {
  chamadas.push([cmd, ...(args || [])].join(' '));
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4343;
  child.kill = () => { };
  const saida = '{"result":"ok","is_error":false}' + String.fromCharCode(10);
  setImmediate(() => {
    child.stdout.end(saida);
    child.stderr.end();
    setImmediate(() => child.emit('close', 0));
  });
  return child;
};

const { runProvedor, parseEnvelope } = await import('../lib/engine/session.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function engineFalso() {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'apikey', id: '', apiKey: '', baseUrl: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

async function linhaDe(opts) {
  chamadas.length = 0;
  await runProvedor(engineFalso(), 'prompt', { id: 'f-teste', ...opts }).catch(() => undefined);
  const sessoes = chamadas.slice();
  assert.equal(sessoes.length, 1, 'uma sessão, um processo');
  return sessoes[0];
}

test('Claude: sessão comum não ganha restrição nenhuma', async () => {
  const linha = await linhaDe({});
  assert.doesNotMatch(linha, /--tools|--strict-mcp-config|--safe-mode|--disable-slash-commands/);
});
