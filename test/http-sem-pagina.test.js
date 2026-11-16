// O motor não serve página (16/11/2026): a tela antiga (`ui/`) e o resolvedor dela
// (lib/http-ui.js) saíram, e o front é o pacote `web/`, em outra origem. Este arquivo ocupa o
// lugar de test/http-ui-spa.test.js e prova, no servidor real, o que ficou: fora de /api/ todo
// pedido responde o mesmo 404 em JSON, em qualquer método, sem ler o disco; e as defesas que
// vinham antes da página (allowlist de Host e Origin, porteiro da A4) seguem valendo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-http-sem-pagina-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

const RAIZ = path.join(import.meta.dirname, '..');
let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  porta = server.address().port;
});

after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* já fechado */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// pedido cru: http.request manda o caminho como veio, sem normalizar
function pedir(caminho, { method = 'GET', host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const cabecalhos = { host: host || `127.0.0.1:${porta}`, ...headers };
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method, headers: cabecalhos }, (res) => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, tipo: res.headers['content-type'] || '', cabecalhos: res.headers, corpo }));
    });
    req.on('error', reject);
    req.end();
  });
}

function assertSemPagina(r, caminho) {
  assert.equal(r.status, 404, caminho);
  assert.match(r.tipo, /^application\/json/, caminho);
  assert.equal(r.cabecalhos['cache-control'], 'no-store', caminho);
  assert.deepEqual(JSON.parse(r.corpo), { error: 'not found' }, caminho);
}

test('a raiz e os caminhos da tela antiga respondem 404 em JSON, sem página', async () => {
  for (const p of ['/', '/index.html', '/app.js', '/app.css', '/favicon.svg', '/pure/rota.js', '/telas/rota.js',
    '/radar/pra-mim', '/radar/pra-mim?conta=alice', '/sistema/contas', '/historico', '/api']) {
    const r = await pedir(p);
    assertSemPagina(r, p);
    assert.doesNotMatch(r.corpo, /<html|<script/i, p);
  }
});

test('fora de /api o método não muda a resposta, e o POST não pede x-farol', async () => {
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const r = await pedir('/radar/pra-mim', { method });
    assert.equal(r.status, 404, method);
    assert.match(r.tipo, /^application\/json/, method);
    if (method !== 'HEAD') assert.deepEqual(JSON.parse(r.corpo), { error: 'not found' }, method);
  }
});

test('nenhum caminho entrega arquivo do repositório, com ou sem travessia', async () => {
  const pacote = fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8');
  for (const p of ['/package.json', '/server.js', '/lib/paths.js', '/web/package.json', '/../package.json', '/%2e%2e/package.json',
    '/..%2fpackage.json', '/..%5cpackage.json', '/..\\package.json', '/radar/..%2f..%2fpackage.json', '/%ZZ', '/radar/%']) {
    const r = await pedir(p);
    assert.equal(r.status, 404, p);
    assert.notEqual(r.corpo, pacote, p);
    assert.doesNotMatch(r.corpo, /"name":\s*"farol/, p);
  }
});

test('rota de API que não existe continua sendo recusa da API', async () => {
  const get = await pedir('/api/nada');
  assert.equal(get.status, 405);
  assert.deepEqual(JSON.parse(get.corpo), { error: 'method' });
  const post = await pedir('/api/nada', { method: 'POST', headers: { 'x-farol': '1' } });
  assert.equal(post.status, 404);
  assert.deepEqual(JSON.parse(post.corpo), { error: 'not found' });
  const semCabecalho = await pedir('/api/nada', { method: 'POST' });
  assert.equal(semCabecalho.status, 403, 'o x-farol segue exigido em todo POST de /api');
});

test('a allowlist de Host e Origin vem antes do 404', async () => {
  const host = await pedir('/radar/pra-mim', { host: 'evil.example' });
  assert.equal(host.status, 403);
  assert.equal(JSON.parse(host.corpo).error, 'forbidden');
  const origem = await pedir('/', { headers: { origin: 'https://evil.example' } });
  assert.equal(origem.status, 403);
  assert.equal(origem.cabecalhos['access-control-allow-origin'], undefined, 'recusa sem cabeçalho CORS');
});

test('com a A4 exigindo, a API pede credencial e fora de /api segue 404, sem dado do motor', async () => {
  const antes = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try {
    assertSemPagina(await pedir('/sistema/contas'), '/sistema/contas');
    const api = await pedir('/api/state');
    assert.equal(api.status, 401);
    const saude = await pedir('/api/health');
    assert.equal(saude.status, 200);
    assert.deepEqual(JSON.parse(saude.corpo), { ok: true });
  } finally {
    engine.config.localAuth = antes;
  }
});

test('o motor não tem mais a pasta da tela nem o resolvedor dela', () => {
  assert.equal(fs.existsSync(path.join(RAIZ, 'ui')), false, 'ui/ saiu no lote 14');
  assert.equal(fs.existsSync(path.join(RAIZ, 'lib', 'http-ui.js')), false);
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'http-server.js'), 'utf8');
  assert.doesNotMatch(fonte, /readFileSync|text\/html|UI_DIR/, 'o servidor HTTP não lê arquivo para responder');
});
