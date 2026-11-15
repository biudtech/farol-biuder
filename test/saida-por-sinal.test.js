// A saída ordenada do motor (registrarSaidaOrdenada, em lib/engine/saida-ordenada.js e
// reexportada pelo server.js) precisa atender SIGTERM, SIGINT e SIGHUP pelo mesmo caminho:
// o supervisor (systemd, container, terminal que fecha) manda qualquer um dos três, e o SIGHUP
// já foi regressão real. Processo filho de verdade, sem engine completo (nada de polling no gh).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-saida-sinal-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

const SERVER = new URL('../server.js', import.meta.url).href;

function script() {
  return `
    const { registrarSaidaOrdenada } = await import(${JSON.stringify(SERVER)});
    const engine = { syncStop() {}, log() {} };
    registrarSaidaOrdenada(engine);
    process.stdout.write('pronto\\n');
    setInterval(() => {}, 1000);
  `;
}

function rodar(sinal) {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  const env = { ...process.env, FAROL_HOME: home };
  const filho = spawn(process.execPath, ['--input-type=module', '-e', script()], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => { filho.kill('SIGKILL'); reject(new Error(`o motor não saiu com ${sinal}`)); }, 15000);
    let saida = '';
    filho.stdout.on('data', (d) => {
      saida += d;
      if (!saida.includes('pronto')) return;
      saida = '';
      filho.kill(sinal);
    });
    filho.on('exit', (code, signal) => { clearTimeout(limite); resolve({ code, signal }); });
  });
}

for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${sinal} passa pela saída ordenada: sai pelo handler com código 0`, async () => {
    const r = await rodar(sinal);
    assert.equal(r.signal, null, 'saiu pelo handler, não morto pelo sinal');
    assert.equal(r.code, 0);
  });
}
