// A trava da instância hospedada no processo de verdade: `node server.js` como processo filho,
// com FAROL_INSTANCIA_HOSPEDADA=1, no molde de test/fronteira-hospedada-boot.test.js.
//
// - sem config.json (o volume que não montou): sai com código 1, diz o motivo no stderr sem
//   pilha e não cria nada no HOME, nem o `~/.farol`, nem o `~/.claude.json`;
// - com a fronteira definida: sobe, responde a saúde, exige autenticação e sai com 0 no SIGTERM.
//
// POUCOS casos, de propósito: cada um é um processo. A decisão caso a caso é coberta em
// processo, em test/instancia-hospedada.test.js.
//
// O filho NÃO herda o ambiente do teste (NODE_TEST_CONTEXT desviaria os dados, FAROL_HOME ligaria
// a instância isolada): resolve o ~/.farol a partir do HOME, como no container.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const REPO = path.join(import.meta.dirname, '..');
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-instancia-hospedada-boot-'));
const BIN = path.join(RAIZ, 'bin');
fs.mkdirSync(BIN);
// `gh` sem login e `claude` de mentira, na frente do PATH (ver test/boot-vazio.test.js)
fs.writeFileSync(path.join(BIN, 'gh'), '#!/bin/sh\necho "You are not logged into any GitHub hosts." >&2\nexit 1\n', { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'claude-falso'), '#!/bin/sh\necho \'{"result":"{}"}\'\n', { mode: 0o755 });

const filhos = new Set();
after(() => {
  for (const f of filhos) if (f.exitCode === null && f.signalCode === null) f.kill('SIGKILL');
  fs.rmSync(RAIZ, { recursive: true, force: true });
});

let serie = 0;
function casaNova() {
  const casa = path.join(RAIZ, `casa-${++serie}`);
  for (const pasta of ['home', 'tmp', 'cwd']) fs.mkdirSync(path.join(casa, pasta), { recursive: true });
  return casa;
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function pedir(porta, caminho) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: caminho }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
  });
}

// Sobe o motor com o HOME dado e a variável da instância hospedada, e espera ele escutar ou sair.
function rodar(casa, valor = '1') {
  const env = {
    HOME: path.join(casa, 'home'), TMPDIR: path.join(casa, 'tmp'),
    PATH: [BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    FAROL_HEADLESS_CMD: path.join(BIN, 'claude-falso'),
    FAROL_INSTANCIA_HOSPEDADA: valor,
  };
  const filho = spawn(process.execPath, [path.join(REPO, 'server.js')], { cwd: path.join(casa, 'cwd'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.add(filho);
  const t = { filho, saida: '', erros: '' };
  filho.stdout.on('data', (d) => { t.saida += d; });
  filho.stderr.on('data', (d) => { t.erros += d; });
  t.fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  t.escutando = new Promise((resolve) => {
    const olhar = () => {
      if (t.saida.includes('[farol] monitorando')) return resolve(true);
      if (filho.exitCode !== null || filho.signalCode !== null) return resolve(false);
      setTimeout(olhar, 50);
    };
    olhar();
  });
  return t;
}

test('hospedada e sem config.json: sai com código 1, diz o motivo e não cria nada no HOME', async () => {
  const casa = casaNova();
  const t = rodar(casa);
  assert.equal(await t.escutando, false, 'o motor não pode subir');
  const fim = await t.fim;
  assert.equal(fim.code, 1, t.erros);
  assert.match(t.erros, /instância hospedada \(FAROL_INSTANCIA_HOSPEDADA=1\), o motor não sobe: não há config\.json/);
  assert.ok(t.erros.includes(path.join(casa, 'home', '.farol', 'config.json')), t.erros);
  assert.doesNotMatch(t.erros, /\n\s+at /, 'sem pilha');
  assert.equal(t.erros.trim().split('\n').length, 1, 'uma linha só');
  assert.equal(t.saida, '');
  for (const pasta of ['home', 'tmp', 'cwd']) assert.deepEqual(fs.readdirSync(path.join(casa, pasta)), [], `nada criado em ${pasta}`);
});

test('valor inválido na variável: sai com código 1 e não cria nada', async () => {
  const casa = casaNova();
  const t = rodar(casa, 'true');
  assert.equal(await t.escutando, false);
  assert.equal((await t.fim).code, 1, t.erros);
  assert.match(t.erros, /FAROL_INSTANCIA_HOSPEDADA.*"true"/);
  assert.deepEqual(fs.readdirSync(path.join(casa, 'home')), []);
});

test('hospedada com a fronteira definida: sobe, responde a saúde, exige autenticação e sai com 0 no SIGTERM', async () => {
  const casa = casaNova();
  const porta = await portaLivre();
  const dados = path.join(casa, 'home', '.farol');
  fs.mkdirSync(dados);
  const config = { port: porta, hostPublico: 'farol.exemplo.com', localAuth: 'exigir', conta: { autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } };
  fs.writeFileSync(path.join(dados, 'config.json'), JSON.stringify(config));
  const t = rodar(casa);
  assert.equal(await t.escutando, true, t.erros);
  const saude = await pedir(porta, '/api/health');
  assert.equal(saude.status, 200);
  assert.deepEqual(JSON.parse(saude.corpo), { ok: true });
  assert.equal((await pedir(porta, '/api/state')).status, 401);
  const status = await pedir(porta, '/api/auth/status');
  assert.equal(JSON.parse(status.corpo).exigida, true);
  t.filho.kill('SIGTERM');
  assert.deepEqual(await t.fim, { code: 0, signal: null });
});
