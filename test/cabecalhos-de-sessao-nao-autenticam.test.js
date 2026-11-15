// Com a A4 exigida (config.localAuth 'exigir'), só o Bearer de uma sessão pareada abre a API.
// Até o lote 12 do corte da fase 1, as sessões interativas voltavam ao motor sem Bearer por
// duas credenciais de escopo único (`x-farol-review-cap` e `x-farol-session`), cada uma na
// própria rota. As sessões saíram, e os dois cabeçalhos não podem mais abrir nada: nem as rotas
// que eram delas, nem qualquer outra.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-cabecalhos-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.localAuth = 'exigir';
  engine.config.port = 0;
  server = await new Promise((resolve, reject) => {
    const s = startServer(engine, (url, err) => (err ? reject(err) : resolve(s)));
  });
  porta = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

function pedir(metodo, rota, cabecalhos = {}, corpo) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-farol': '1', 'Content-Type': 'application/json', ...cabecalhos };
    const req = http.request(`http://127.0.0.1:${porta}${rota}`, { method: metodo, headers, timeout: 3000 }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => { req.destroy(new Error(`${metodo} ${rota} ficou sem resposta`)); });
    req.on('error', reject);
    req.end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });
}

const VALOR = 'x'.repeat(43);
const CABECALHOS = [
  { 'x-farol-review-cap': VALOR },
  { 'x-farol-session': VALOR },
  { 'x-farol-review-cap': VALOR, 'x-farol-session': VALOR },
];

test('sem Bearer, as rotas que eram das sessões interativas respondem 401, com ou sem os cabeçalhos antigos', async () => {
  engine.activeReviews.set('a-viva', { id: 'a-viva', keys: ['acme/repo#1'], label: 'x', mode: 'auto', startedAt: Date.now() });
  try {
    for (const rota of ['/api/review/post', '/api/session-exit']) {
      assert.equal((await pedir('POST', rota, {}, { id: 'a-viva', key: 'acme/repo#1' })).status, 401, rota);
      for (const cabecalhos of CABECALHOS) {
        const r = await pedir('POST', rota, cabecalhos, { id: 'a-viva', key: 'acme/repo#1' });
        assert.equal(r.status, 401, `${rota} ${Object.keys(cabecalhos).join('+')}`);
        assert.deepEqual(JSON.parse(r.body), { error: 'nao_autenticado' });
      }
    }
    assert.ok(engine.activeReviews.has('a-viva'), 'nenhuma sessão é encerrada por pedido sem credencial');
  } finally {
    engine.activeReviews.delete('a-viva');
  }
});

test('os cabeçalhos antigos não abrem nenhuma outra rota', async () => {
  for (const cabecalhos of CABECALHOS) {
    assert.equal((await pedir('GET', '/api/state', cabecalhos)).status, 401);
    assert.equal((await pedir('POST', '/api/settings', cabecalhos, { theme: 'light' })).status, 401);
    assert.equal((await pedir('POST', '/api/review', cabecalhos, { urls: ['https://github.com/acme/repo/pull/1'] })).status, 401);
    assert.equal((await pedir('POST', '/api/decide', cabecalhos, { id: 'd1', action: 'approve' })).status, 401);
  }
});

test('corpo que não é objeto recebe a mesma recusa, em vez de ficar pendurado', async () => {
  for (const corpo of ['null', '0', 'false', '""']) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: '/api/session-exit', headers: { 'x-farol': '1', 'content-type': 'application/json' }, timeout: 3000 },
        (res) => { res.resume(); resolve(res.statusCode); });
      req.on('timeout', () => { req.destroy(new Error(`corpo ${corpo} ficou sem resposta`)); });
      req.on('error', reject);
      req.end(corpo);
    });
    assert.equal(status, 401, corpo);
  }
});
