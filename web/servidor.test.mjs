// O servidor do front no socket Unix (servidor.mjs, `npm run start:socket`), com um build de
// verdade: rode `npm run build` antes (`npm run test:servidor`). Só Linux.
//
// Prova: sem a variável recusa; sobe no socket com permissão 600; `/` leva a `/radar` e
// `/radar` responde 200 com a CSP por nonce (o nonce do cabeçalho é o dos scripts da página);
// socket órfão é removido, socket vivo recusa, arquivo comum no caminho não é apagado; SIGTERM
// e SIGINT removem o socket.
//
// Com NEXT_PUBLIC_FAROL_API no ambiente (o mesmo valor do build), confere também que o
// connect-src é a própria origem mais ela: no caso da mesma origem atrás do proxy, a origem
// pública.
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { motivoDoCaminho } from './servidor.mjs';

const AQUI = import.meta.dirname;
const SERVIDOR = path.join(AQUI, 'servidor.mjs');
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-web-sock-'));
const filhos = new Set();

after(() => {
  for (const f of filhos) if (f.exitCode === null && f.signalCode === null) f.kill('SIGKILL');
  fs.rmSync(RUN, { recursive: true, force: true });
});

let serie = 0;
const caminhoNovo = () => path.join(RUN, `w${++serie}.sock`);

function rodar(env) {
  const ambiente = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  delete ambiente.FAROL_WEB_SOCKET;
  const filho = spawn(process.execPath, [SERVIDOR], { cwd: AQUI, env: { ...ambiente, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.add(filho);
  const t = { filho, saida: '', erros: '' };
  filho.stdout.on('data', (d) => { t.saida += d; });
  filho.stderr.on('data', (d) => { t.erros += d; });
  t.fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  t.subiu = new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error(`nem subiu nem saiu em 60 s\nstdout: ${t.saida}\nstderr: ${t.erros}`)), 60000);
    const olhar = () => {
      if (t.saida.includes('[farol-web] escutando')) { clearTimeout(limite); return resolve(true); }
      if (filho.exitCode !== null || filho.signalCode !== null) { clearTimeout(limite); return resolve(false); }
      setTimeout(olhar, 50);
    };
    olhar();
  });
  return t;
}

function pedir(socketPath, rota) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: rota, headers: { host: 'farol.exemplo.invalid' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function encerrar(t, sinal = 'SIGTERM') {
  t.filho.kill(sinal);
  return t.fim;
}

test('há um build de produção (rode npm run build antes deste teste)', () => {
  assert.ok(fs.existsSync(path.join(AQUI, '.next', 'BUILD_ID')), 'falta o build: npm run build');
});

test('sem FAROL_WEB_SOCKET o servidor recusa, com a mensagem, e não sobe', async () => {
  for (const valor of [undefined, '', 'web.sock']) {
    const t = rodar(valor === undefined ? {} : { FAROL_WEB_SOCKET: valor });
    assert.equal(await t.subiu, false);
    const fim = await t.fim;
    assert.equal(fim.code, 1);
    assert.match(t.erros, /o servidor não sobe/);
    assert.match(t.erros, valor === 'web.sock' ? /não é um caminho absoluto/ : /FAROL_WEB_SOCKET não está definida/);
    assert.match(t.erros, /npm start/);
  }
});

test('motivoDoCaminho: limite do sun_path e a pasta do socket', () => {
  const base = `${RUN}/`;
  const cabe = base + 'x'.repeat(107 - Buffer.byteLength(base));
  assert.equal(motivoDoCaminho(cabe), '');
  assert.match(motivoDoCaminho(`${cabe}x`), /108 bytes/);
  assert.match(motivoDoCaminho(`${RUN}/nao/web.sock`), /não existe/);
  const aberta = fs.mkdtempSync(path.join(RUN, 'aberta-'));
  fs.chmodSync(aberta, 0o777);
  assert.match(motivoDoCaminho(`${aberta}/web.sock`), /gravável pelo grupo ou pelos outros/);
  assert.match(motivoDoCaminho(`${RUN}/a\0b`), /nulo/);
});

test('sobe no socket com 600, / leva a /radar, /radar sai 200 com a CSP por nonce, e o SIGTERM remove o socket', async () => {
  const caminho = caminhoNovo();
  const t = rodar({ FAROL_WEB_SOCKET: caminho });
  assert.equal(await t.subiu, true, t.erros);
  try {
    assert.equal(fs.lstatSync(caminho).mode & 0o777, 0o600);
    const raiz = await pedir(caminho, '/');
    assert.equal(raiz.status, 307, raiz.body);
    assert.equal(raiz.headers.location, '/radar');
    const radar = await pedir(caminho, '/radar');
    assert.equal(radar.status, 200);
    const csp = radar.headers['content-security-policy'];
    assert.ok(csp, 'a página sai com CSP');
    const nonce = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1];
    assert.ok(nonce, csp);
    assert.ok(radar.body.includes(`nonce="${nonce}"`), 'os scripts da página levam o nonce do cabeçalho');
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/, 'produção, sem as folgas do next dev');
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1];
    const api = process.env.NEXT_PUBLIC_FAROL_API;
    if (api) assert.equal(connect, `'self' ${new URL(api).origin}`);
    else assert.match(connect, /^'self'/);
    const outro = await pedir(caminho, '/radar');
    assert.notEqual(/'nonce-([^']+)'/.exec(outro.headers['content-security-policy'])?.[1], nonce, 'um nonce por pedido');
  } finally {
    const fim = await encerrar(t);
    assert.equal(fim.code, 0, t.erros);
  }
  assert.equal(fs.existsSync(caminho), false, 'o SIGTERM removeu o socket');
});

test('socket órfão é removido e o servidor sobe; o SIGINT também remove o socket', async () => {
  const caminho = caminhoNovo();
  const morto = await new Promise((resolve) => {
    const f = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(caminho)}, () => process.kill(process.pid, 'SIGKILL'))`]);
    f.on('exit', resolve);
  });
  assert.equal(morto, null);
  assert.ok(fs.lstatSync(caminho).isSocket(), 'o órfão está no disco');
  const t = rodar({ FAROL_WEB_SOCKET: caminho });
  assert.equal(await t.subiu, true, t.erros);
  assert.equal((await pedir(caminho, '/radar')).status, 200);
  const fim = await encerrar(t, 'SIGINT');
  assert.equal(fim.code, 0);
  assert.equal(fs.existsSync(caminho), false);
});

test('socket vivo recusa a subida e fica intacto; arquivo comum no caminho também recusa e não é apagado', async () => {
  const caminho = caminhoNovo();
  const vivo = net.createServer((c) => c.end());
  await new Promise((r) => vivo.listen(caminho, r));
  try {
    const ino = fs.lstatSync(caminho).ino;
    const t = rodar({ FAROL_WEB_SOCKET: caminho });
    assert.equal(await t.subiu, false);
    assert.equal((await t.fim).code, 1);
    assert.match(t.erros, /já está em uso/);
    assert.equal(fs.lstatSync(caminho).ino, ino);
  } finally { await new Promise((r) => vivo.close(() => r())); }
  const arquivo = caminhoNovo();
  fs.writeFileSync(arquivo, 'dado');
  const t2 = rodar({ FAROL_WEB_SOCKET: arquivo });
  assert.equal(await t2.subiu, false);
  assert.equal((await t2.fim).code, 1);
  assert.match(t2.erros, /não é um socket/);
  assert.equal(fs.readFileSync(arquivo, 'utf8'), 'dado');
});
