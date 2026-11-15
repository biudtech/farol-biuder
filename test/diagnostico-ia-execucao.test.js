// A sessão comum vista pelo PROCESSO que ela abre de verdade: o cmdline.test troca o spawn;
// aqui o spawn é o real, o FAROL_HEADLESS_CMD está ausente e quem responde é um `claude`
// falso no PATH, que grava o argv e o cwd que recebeu. Afirma que a linha é a de sempre,
// sem nenhuma restrição de ferramenta (o modo somente leitura saiu no lote 7 do corte).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-exec-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
delete process.env.FAROL_HEADLESS_CMD;

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { runProvedor, parseEnvelope } = await import('../lib/engine/session.js');
const { WORKSPACE } = await import('../lib/paths.js');

const BIN = path.join(BASE, 'bin');
const REGISTRO = path.join(BASE, 'registro.jsonl');

const FALSO = `
const fs = require('node:fs');
let entrada = '';
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAROL_TESTE_REGISTRO, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), prompt: entrada.length }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', is_error: false, session_id: 'falso' }) + '\\n');
});
`;

before(() => {
  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(BIN, 'claude-falso.cjs'), FALSO);
  fs.writeFileSync(path.join(BIN, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude-falso.cjs" "$@"\n`, { mode: 0o755 });
  process.env.PATH = BIN + path.delimiter + process.env.PATH;
  process.env.FAROL_TESTE_REGISTRO = REGISTRO;
});

after(() => {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function engineFalso() {
  return {
    config: {},
    ghEnv: () => ({ ...process.env }),
    running: new Map(),
    killTree() { },
    recordUsage() { },
    resolveClaudeAuth: () => ({ kind: 'dir', id: '' }),
    toolSummary: () => '',
    parseEnvelope(raw) { return parseEnvelope(this, raw); },
  };
}

// mesmo motivo do perfil-claude-sem-escrita: o shell de login pode reordenar o PATH
async function falsoResolve(t) {
  const r = await io.runShell('command -v claude', { env: { ...process.env } });
  if (r.stdout.trim() === path.join(BIN, 'claude')) return true;
  t.skip(`o shell de login resolve outro claude (${r.stdout.trim()}), o falso não seria o executado`);
  return false;
}

async function execucao(opts) {
  fs.rmSync(REGISTRO, { force: true });
  const res = await runProvedor(engineFalso(), 'prompt de teste', { id: 'f-exec', ...opts });
  const linhas = fs.readFileSync(REGISTRO, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1, 'um processo do claude');
  return { res, reg: JSON.parse(linhas[0]) };
}

test('a sessão comum executa sem nenhuma das restrições', async (t) => {
  if (!await falsoResolve(t)) return;
  const { reg } = await execucao({});
  assert.deepEqual(reg.argv, ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--dangerously-skip-permissions']);
  assert.equal(fs.realpathSync(reg.cwd), fs.realpathSync(WORKSPACE), 'a sessão roda no workspace');
});
