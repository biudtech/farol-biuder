// POST /api/review só lança revisão headless. O modo interativo saiu no corte da fase 1:
// pedir outro modo é erro do chamador, respondido com 400 antes de qualquer sessão existir.
// Sobe o servidor real com uma Engine contra FAROL_HOME temporário (sem polling, sem gh),
// no molde do test/http-host-allowlist.test.js. O lançamento é espionado: a recusa tem que
// chegar com ZERO chamadas, e o controle sem modo prova que o espião está no caminho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-http-review-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');

const URL_DO_PR = 'https://github.com/acme/api/pull/7';
let engine, server, porta;
let lancamentos = [];

function iniciar(eng) {
  return new Promise((resolve, reject) => {
    const s = startServer(eng, (url, err) => (err ? reject(err) : resolve(s)));
  });
}

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  engine.launchReview = async (urls, mode, origem) => { lancamentos.push({ urls, mode, origem }); return { ok: true, mode }; };
  server = await iniciar(engine);
  porta = server.address().port;
});

after(() => {
  try { server.close(); } catch { /* já fechado */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function postJson(pathname, corpo) {
  const body = JSON.stringify(corpo || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: porta, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-farol': '1' },
    }, res => {
      let texto = '';
      res.on('data', c => (texto += c));
      res.on('end', () => resolve({ status: res.statusCode, corpo: JSON.parse(texto || '{}') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('POST /api/review com mode terminal responde 400 modo_invalido e não cria sessão', async () => {
  lancamentos = [];
  const r = await postJson('/api/review', { urls: [URL_DO_PR], mode: 'terminal' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.error, 'modo_invalido');
  assert.equal(lancamentos.length, 0, 'o lançamento não pode ser chamado');
  assert.equal(engine.activeReviews.size, 0, 'nenhuma sessão registrada');
  assert.equal(engine.headlessQueue.length, 0, 'nada entra na fila headless');
});

test('POST /api/review com qualquer modo que não seja o automático também é recusado', async () => {
  lancamentos = [];
  for (const mode of ['interativo', '', 0, null, {}]) {
    const r = await postJson('/api/review', { urls: [URL_DO_PR], mode });
    assert.equal(r.status, 400, `mode ${JSON.stringify(mode)}`);
    assert.equal(r.corpo.error, 'modo_invalido');
  }
  assert.equal(lancamentos.length, 0);
});

test('POST /api/review sem modo, ou com mode auto, lança a revisão headless do clique', async () => {
  lancamentos = [];
  const semModo = await postJson('/api/review', { urls: [URL_DO_PR] });
  const comAuto = await postJson('/api/review', { urls: [URL_DO_PR], mode: 'auto' });
  assert.equal(semModo.status, 200);
  assert.equal(comAuto.status, 200);
  assert.deepEqual(lancamentos.map(l => [l.urls, l.mode, l.origem]), [
    [[URL_DO_PR], 'auto', 'clique'],
    [[URL_DO_PR], 'auto', 'clique'],
  ]);
});
