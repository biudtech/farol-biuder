// A fronteira hospedada no BOOT de verdade: `node server.js` como processo filho, no molde de
// test/boot-vazio.test.js. Valor inválido em hostPublico ou origensPermitidas não vira vazio em
// silêncio (com o motor em loopback atrás de um proxy que reescreve o Host, "vazio" é a API
// inteira sem autenticação): o motor NÃO SOBE. Sai com código diferente de zero, diz no stderr
// qual chave, qual valor e qual formato vale, não escuta em porta nenhuma e deixa o config.json
// byte a byte como estava. Os controles: valor válido sobe e exige Bearer; chave ausente ou
// vazia sobe em loopback puro, como sempre.
//
// O filho NÃO herda o ambiente do teste (NODE_TEST_CONTEXT desviaria os dados, FAROL_HOME ligaria
// a instância isolada): resolve o ~/.farol a partir do HOME, como em produção.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const REPO = path.join(import.meta.dirname, '..');
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-fronteira-boot-'));
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
  fs.mkdirSync(path.join(casa, '.farol'), { recursive: true });
  for (const irma of ['tmp', 'cwd']) fs.mkdirSync(path.join(casa, irma));
  return casa;
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function escuta(porta) {
  return new Promise((resolve) => {
    const s = net.connect(porta, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

// Sobe o motor com o config.json dado (mais a porta) e espera ele escutar ou sair.
async function rodar(config) {
  const casa = casaNova();
  const porta = await portaLivre();
  const arquivo = path.join(casa, '.farol', 'config.json');
  fs.writeFileSync(arquivo, JSON.stringify({ port: porta, ...config }, null, 2));
  const antes = fs.readFileSync(arquivo);
  const env = {
    HOME: casa, TMPDIR: path.join(casa, 'tmp'),
    PATH: [BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    FAROL_HEADLESS_CMD: path.join(BIN, 'claude-falso'),
  };
  const filho = spawn(process.execPath, [path.join(REPO, 'server.js')], { cwd: path.join(casa, 'cwd'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.add(filho);
  const t = { casa, porta, arquivo, antes, filho, saida: '', erros: '' };
  filho.stdout.on('data', (d) => { t.saida += d; });
  filho.stderr.on('data', (d) => { t.erros += d; });
  const fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  const escutando = new Promise((resolve) => {
    const olhar = () => {
      if (t.saida.includes('[farol] monitorando')) return resolve(true);
      if (filho.exitCode !== null || filho.signalCode !== null) return resolve(false);
      setTimeout(olhar, 50);
    };
    olhar();
  });
  const limite = new Promise((_, reject) => setTimeout(() => reject(new Error(`o motor nem subiu nem saiu em 30 s\nstdout: ${t.saida}\nstderr: ${t.erros}`)), 30000).unref());
  t.subiu = await Promise.race([escutando, limite]);
  t.fim = fim;
  // a saída com 0 no SIGTERM é provada em test/boot-vazio.test.js; aqui só não pode sobrar processo
  t.encerrar = async () => {
    if (filho.exitCode === null && filho.signalCode === null) filho.kill('SIGTERM');
    const forcar = setTimeout(() => filho.kill('SIGKILL'), 10000);
    await fim;
    clearTimeout(forcar);
  };
  return t;
}

// A porta é escolhida e solta antes de o filho escutar, e outro arquivo da suíte pode pegá-la
// nesse intervalo. Só essa falha ganha outra tentativa, com outra porta.
async function subir(config) {
  for (let tentativa = 1; ; tentativa++) {
    const t = await rodar(config);
    if (t.subiu || tentativa >= 3 || !t.erros.includes('EADDRINUSE')) return t;
  }
}

function pedir(porta, rota, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: 'GET', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

const TORTOS = [
  [{ hostPublico: 'https://farol.exemplo.com' }, ['hostPublico']],
  [{ hostPublico: 'farol.exemplo.com:443' }, ['hostPublico']],
  [{ hostPublico: 'farol.exemplo.com.' }, ['hostPublico']],
  [{ hostPublico: { nome: 'farol.exemplo.com' } }, ['hostPublico']],
  [{ hostPublico: 42 }, ['hostPublico']],
  [{ origensPermitidas: 'https://painel.exemplo.com' }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com/'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com/app'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com:443'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['*'] }, ['origensPermitidas']],
  [{ origensPermitidas: { 0: 'https://painel.exemplo.com' } }, ['origensPermitidas']],
  [{ origensPermitidas: [['https://painel.exemplo.com']] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com', 'https://outro.exemplo.com/', 'http://localhost:3000'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com\r\nSet-Cookie: a=b'] }, ['origensPermitidas']],
  [{ hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com/'] }, ['origensPermitidas']],
  [{ hostPublico: 'https://farol.exemplo.com', origensPermitidas: 'https://painel.exemplo.com' }, ['hostPublico', 'origensPermitidas']],
];

for (const [torto, chaves] of TORTOS) {
  test(`valor inválido: o motor não sobe, diz a chave no stderr, não escuta e não toca no config.json: ${JSON.stringify(torto)}`, async () => {
    const t = await rodar(torto);
    assert.equal(t.subiu, false, `o motor subiu com valor inválido\nstdout: ${t.saida}`);
    const fim = await t.fim;
    assert.equal(fim.signal, null);
    assert.ok(Number.isInteger(fim.code) && fim.code !== 0, `código de saída ${fim.code}`);
    for (const chave of chaves) assert.match(t.erros, new RegExp(`"${chave}" tem valor recusado`), `o stderr cita ${chave}\n${t.erros}`);
    assert.match(t.erros, /o motor não sobe/);
    assert.match(t.erros, /Formato aceito/);
    assert.ok(t.erros.includes(t.arquivo), `o stderr diz qual arquivo corrigir\n${t.erros}`);
    assert.doesNotMatch(t.erros, /\n\s+at |node:internal|Node\.js v/, `a mensagem é limpa, sem pilha\n${t.erros}`);
    assert.doesNotMatch(t.saida, /monitorando/);
    assert.equal(await escuta(t.porta), false, 'nenhuma porta escutando');
    assert.deepEqual(fs.readFileSync(t.arquivo), t.antes, 'o config.json fica byte a byte como estava');
    assert.deepEqual(fs.readdirSync(path.join(t.casa, 'tmp')), []);
    assert.deepEqual(fs.readdirSync(path.join(t.casa, 'cwd')), []);
  });
}

test('a recusa também fica no farol.log quando o log já existe', async () => {
  const casa = casaNova();
  const estado = path.join(casa, '.farol', 'workspace', 'state');
  fs.mkdirSync(estado, { recursive: true });
  fs.writeFileSync(path.join(estado, 'farol.log'), '');
  fs.writeFileSync(path.join(casa, '.farol', 'config.json'), JSON.stringify({ port: await portaLivre(), hostPublico: 'farol.exemplo.com:443' }));
  const env = { HOME: casa, TMPDIR: path.join(casa, 'tmp'), PATH: [BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':') };
  const filho = spawn(process.execPath, [path.join(REPO, 'server.js')], { cwd: path.join(casa, 'cwd'), env, stdio: 'ignore' });
  filhos.add(filho);
  const fim = await new Promise((resolve) => filho.on('exit', (code) => resolve(code)));
  assert.notEqual(fim, 0);
  const log = fs.readFileSync(path.join(estado, 'farol.log'), 'utf8');
  assert.match(log, /\[ERROR\].*"hostPublico" tem valor recusado/);
});

test('controle: valor válido sobe, exige Bearer em /api/state e responde a saúde', async () => {
  const t = await subir({ hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'] });
  try {
    assert.equal(t.subiu, true, `o motor não subiu\nstderr: ${t.erros}`);
    for (const host of [`127.0.0.1:${t.porta}`, 'farol.exemplo.com']) {
      const estado = await pedir(t.porta, '/api/state', { host });
      assert.equal(estado.status, 401, host);
      assert.deepEqual(JSON.parse(estado.body), { error: 'nao_autenticado' });
    }
    assert.deepEqual(JSON.parse((await pedir(t.porta, '/api/auth/status')).body), { exigida: true, autenticado: false });
    assert.equal((await pedir(t.porta, '/api/health', { host: '10.0.31.7' })).body, '{"ok":true}');
    const gravado = JSON.parse(fs.readFileSync(t.arquivo, 'utf8'));
    assert.equal(gravado.hostPublico, 'farol.exemplo.com', 'o boot não apaga a chave válida');
    assert.deepEqual(gravado.origensPermitidas, ['https://painel.exemplo.com']);
  } finally {
    await t.encerrar();
  }
});

for (const vazio of [{}, { hostPublico: '', origensPermitidas: [] }, { hostPublico: null, origensPermitidas: null }]) {
  test(`controle: chave ausente ou vazia sobe em loopback puro, sem exigir Bearer: ${JSON.stringify(vazio)}`, async () => {
    const t = await subir(vazio);
    try {
      assert.equal(t.subiu, true, `o motor não subiu\nstderr: ${t.erros}`);
      assert.equal((await pedir(t.porta, '/api/state')).status, 200);
      assert.deepEqual(JSON.parse((await pedir(t.porta, '/api/auth/status')).body), { exigida: false, autenticado: false });
      assert.equal((await pedir(t.porta, '/api/state', { host: 'farol.exemplo.com' })).status, 403);
    } finally {
      await t.encerrar();
    }
  });
}
