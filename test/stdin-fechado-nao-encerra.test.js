// O motor roda com stdin fechado sob systemd e em container: o fim do stdin não pode
// encerrá-lo. Processo filho de verdade, `node server.js` com porta livre e sem revisão
// automática.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-stdin-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
const SERVER = path.join(import.meta.dirname, '..', 'server.js');

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function esperar(promessa, ms) {
  return Promise.race([promessa, new Promise(r => setTimeout(() => r('tempo'), ms))]);
}

test('fechar o stdin NÃO encerra o motor', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: await portaLivre(), autoReview: false }));
  const filho = spawn(process.execPath, [SERVER], { env: { ...process.env, FAROL_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  const fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  const inicio = Date.now();
  while (!saida.includes('monitorando')) {
    if (Date.now() - inicio > 30000) { filho.kill('SIGKILL'); throw new Error(`o motor não subiu: ${saida}`); }
    if (filho.exitCode !== null) throw new Error(`o motor saiu antes de subir: ${saida}`);
    await new Promise(r => setTimeout(r, 50));
  }
  filho.stdin.end();
  const r = await esperar(fim, 2000);
  assert.equal(r, 'tempo', 'o motor seguiu vivo depois do EOF');
  filho.kill('SIGTERM');
  await esperar(fim, 15000);
});
