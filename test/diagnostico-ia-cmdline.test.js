// A sessão comum vista pela LINHA DE COMANDO que cada provedor recebe de verdade: nenhuma
// restrição de ferramenta (--tools, --safe-mode) nem sandbox explícito do Codex. O modo
// somente leitura saiu com o diagnóstico por IA (corte da fase 1, lote 7).
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
  // a checagem de login do Codex roda antes do exec e precisa ver o plano ChatGPT
  const saida = (args || []).join(' ') === 'login status' ? 'Logged in using ChatGPT\n' : '{"result":"ok","is_error":false}\n';
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

function engineFalso(kind) {
  return {
    config: {},
    ghEnv: () => ({ PATH: process.env.PATH }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind, id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

async function linhaDe(kind, opts) {
  chamadas.length = 0;
  await runProvedor(engineFalso(kind), 'prompt', { id: 'f-teste', ...opts }).catch(() => undefined);
  // o Codex confere o login antes: a sessão é a chamada que não é essa conferência
  const sessoes = chamadas.filter((c) => !/ login status$/.test(c));
  assert.equal(sessoes.length, 1, 'uma sessão, um processo');
  return sessoes[0];
}

test('Claude: sessão comum não ganha restrição nenhuma', async () => {
  const linha = await linhaDe('dir', {});
  assert.doesNotMatch(linha, /--tools|--strict-mcp-config|--safe-mode|--disable-slash-commands/);
});

test('Codex: sessão comum não ganha sandbox explícito', async () => {
  const linha = await linhaDe('codex', {});
  assert.match(linha, / exec /, 'a linha capturada é mesmo a do exec');
  assert.doesNotMatch(linha, /--sandbox/);
});
