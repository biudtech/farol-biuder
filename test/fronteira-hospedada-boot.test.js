// A recusa de boot no processo de verdade: `node server.js` como processo filho, no molde de
// test/boot-vazio.test.js. Dois motivos impedem o motor de subir:
//
// - hostPublico ou origensPermitidas com valor inválido (vazio seria "não hospedado", e atrás de
//   um proxy que reescreve o Host isso é a API inteira sem autenticação);
// - config.json presente e ilegível (não é JSON, ou é JSON que não é objeto): subir com os
//   padrões seria uma instância em loopback puro, sem autenticação e com a política padrão da
//   conta, que age sozinha.
//
// Nos dois o processo sai com código diferente de zero, diz o motivo no stderr sem pilha, não
// escuta em porta nenhuma e deixa o config.json byte a byte como estava, sem cópia ao lado.
//
// Aqui ficam POUCOS casos, de propósito: cada um é um processo, e a suíte tem testes sensíveis a
// tempo. A decisão "recusa ou não" é coberta caso a caso, em processo, em
// test/fronteira-hospedada-config.test.js; este arquivo prova a saída do processo.
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
  fs.mkdirSync(path.join(casa, '.farol', 'workspace', 'state'), { recursive: true });
  // o farol.log já existe, para a recusa ter onde ser registrada
  fs.writeFileSync(path.join(casa, '.farol', 'workspace', 'state', 'farol.log'), '');
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

// Sobe o motor com o conteúdo dado no config.json (texto, gravado como veio) e espera ele
// escutar ou sair.
async function rodar(conteudo, porta = 0) {
  const casa = casaNova();
  const arquivo = path.join(casa, '.farol', 'config.json');
  fs.writeFileSync(arquivo, conteudo);
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
  t.fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
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
  // a saída com 0 no SIGTERM é provada em test/boot-vazio.test.js; aqui só não pode sobrar processo
  t.encerrar = async () => {
    if (filho.exitCode === null && filho.signalCode === null) filho.kill('SIGTERM');
    const forcar = setTimeout(() => filho.kill('SIGKILL'), 10000);
    await t.fim;
    clearTimeout(forcar);
  };
  return t;
}

// Config válido, com a porta. A porta é escolhida e solta antes de o filho escutar, e outro
// arquivo da suíte pode pegá-la nesse intervalo: só essa falha ganha outra tentativa.
async function subir(config) {
  for (let tentativa = 1; ; tentativa++) {
    const porta = await portaLivre();
    const t = await rodar(JSON.stringify({ port: porta, ...config }, null, 2), porta);
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

// O que toda recusa de boot tem em comum, qualquer que seja o motivo.
async function assertRecusou(t, padrao) {
  if (t.subiu) await t.encerrar();
  assert.equal(t.subiu, false, `o motor subiu\nstdout: ${t.saida}`);
  const fim = await t.fim;
  assert.equal(fim.signal, null);
  assert.equal(fim.code, 1, 'código de saída da recusa');
  assert.match(t.erros, padrao, t.erros);
  assert.match(t.erros, /o motor não sobe/);
  assert.ok(t.erros.includes(t.arquivo), `o stderr diz qual arquivo corrigir\n${t.erros}`);
  assert.doesNotMatch(t.erros, /\n\s+at |node:internal|Node\.js v/, `a mensagem é limpa, sem pilha\n${t.erros}`);
  assert.doesNotMatch(t.saida, /monitorando/);
  if (t.porta) assert.equal(await escuta(t.porta), false, 'nenhuma porta escutando');
  assert.deepEqual(fs.readFileSync(t.arquivo), t.antes, 'o config.json fica byte a byte como estava');
  assert.deepEqual(fs.readdirSync(path.dirname(t.arquivo)).sort(), ['config.json', 'workspace'], 'nada ao lado do config.json: nem cópia .bad, nem arquivo novo');
  assert.deepEqual(fs.readdirSync(path.join(t.casa, 'tmp')), []);
  assert.deepEqual(fs.readdirSync(path.join(t.casa, 'cwd')), []);
  const log = fs.readFileSync(path.join(t.casa, '.farol', 'workspace', 'state', 'farol.log'), 'utf8');
  assert.match(log, /\[ERROR\].*o motor não sobe/, 'a recusa também fica no farol.log, quando ele já existe');
}

/* ---------- valor inválido na fronteira ---------- */

test('hostPublico inválido: o motor não sobe', async () => {
  const porta = await portaLivre();
  const t = await rodar(JSON.stringify({ port: porta, hostPublico: 'https://farol.exemplo.com' }), porta);
  await assertRecusou(t, /"hostPublico" tem valor recusado: "https:\/\/farol\.exemplo\.com"/);
  assert.match(t.erros, /Formato aceito/);
});

test('origensPermitidas com um item inválido entre válidos: o motor não sobe', async () => {
  const porta = await portaLivre();
  const t = await rodar(JSON.stringify({ port: porta, hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com', 'https://outro.exemplo.com/', 'http://localhost:3000'] }), porta);
  await assertRecusou(t, /"origensPermitidas" tem valor recusado: "https:\/\/outro\.exemplo\.com\/"/);
  assert.doesNotMatch(t.erros, /"hostPublico" tem valor/, 'a chave certa não é citada');
});

/* ---------- config.json presente e ilegível ---------- */

const ILEGIVEIS = [
  ['lixo', 'isto não é json'],
  ['truncado no meio', '{\n  "port": 47170,\n  "hostPublico": "farol.exemplo.com",\n  "conta": { "user": "revisora", "onClean": "wa'],
  ['lista', '[]'],
  ['texto', '"texto"'],
  ['vazio (zero bytes)', ''],
];

for (const [nome, conteudo] of ILEGIVEIS) {
  test(`config.json ilegível (${nome}): o motor não sobe`, async () => {
    const t = await rodar(conteudo);
    await assertRecusou(t, /config\.json ilegível/);
  });
}

/* ---------- controles ---------- */

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

// O arquivo AUSENTE (instalação nova) é provado em processo, em
// test/fronteira-hospedada-config.test.js: sem arquivo o filho escutaria na porta padrão, que
// outro processo da máquina pode estar usando. Aqui o arquivo traz só a porta.
test('controle: sem as chaves da fronteira o motor sobe em loopback puro, sem exigir Bearer', async () => {
  const t = await subir({});
  try {
    assert.equal(t.subiu, true, `o motor não subiu\nstderr: ${t.erros}`);
    assert.equal((await pedir(t.porta, '/api/state')).status, 200);
    assert.deepEqual(JSON.parse((await pedir(t.porta, '/api/auth/status')).body), { exigida: false, autenticado: false });
    assert.equal((await pedir(t.porta, '/api/state', { host: 'farol.exemplo.com' })).status, 403);
  } finally {
    await t.encerrar();
  }
});
