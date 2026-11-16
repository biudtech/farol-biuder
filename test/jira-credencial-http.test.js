// A credencial do Jira pela API, de ponta a ponta: POST /api/jira/credential grava e
// POST /api/jira/credential/remove tira. As duas rotas ficaram sem tela (a tela antiga saiu em
// 16/11/2026 e o front não tem campo para segredo), e o guia manda usá-las por chamada direta
// (docs/CONFIGURATION.md, Jira). Aqui está o que quem chama recebe e o que fica no disco.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-jira-credencial-http-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const cred = await import('../lib/jira/credentials.js');

const TOKEN = 'JIRATOKENFALSO-remove-0123456789';
const ARQUIVO = path.join(HOME, 'jira-credentials.json');
let server, base, engine;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try { server.closeAllConnections(); await new Promise((r) => server.close(() => r())); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function post(rota, corpo, { semXFarol = false } = {}) {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo || {});
    const headers = { Connection: 'close', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) };
    if (!semXFarol) headers['x-farol'] = '1';
    const req = http.request(base + rota, { method: 'POST', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: d, json: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.end(dados);
  });
}

const temCredencialNoSnapshot = () => engine.snapshot().jiraSites.find((s) => s.id === 'site1').hasCredential;
const noDisco = () => (fs.existsSync(ARQUIVO) ? fs.readFileSync(ARQUIVO, 'utf8') : '');

test('a credencial entra por POST /api/jira/credential e a resposta não a ecoa', async () => {
  const sites = await post('/api/settings', { jiraSites: [{ id: 'site1', label: 'Jira', baseUrl: 'https://exemplo.atlassian.net', owners: ['acme'], projectKeys: ['BT'] }] });
  assert.equal(sites.json.ok, true);
  assert.equal(temCredencialNoSnapshot(), false);

  const incompleta = await post('/api/jira/credential', { siteId: 'site1', email: 'pessoa@exemplo.com' });
  assert.deepEqual([incompleta.status, incompleta.json], [200, { ok: false, error: 'dados incompletos' }]);
  assert.equal(cred.hasCredential('site1'), false);

  const r = await post('/api/jira/credential', { siteId: 'site1', email: 'pessoa@exemplo.com', token: TOKEN });
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  assert.equal(r.corpo.includes(TOKEN), false);
  assert.equal(cred.hasCredential('site1'), true);
  assert.equal(temCredencialNoSnapshot(), true);
  assert.ok(noDisco().includes(TOKEN), 'a credencial fica no arquivo próprio, fora do config.json');
  assert.equal(JSON.stringify(engine.config).includes(TOKEN), false);
});

test('POST /api/jira/credential/remove tira a credencial do site, e só a dele', async () => {
  await post('/api/jira/credential', { siteId: 'outro', email: 'outra@exemplo.com', token: 'JIRATOKENFALSO-fica-0123456789' });

  const semCabecalho = await post('/api/jira/credential/remove', { siteId: 'site1' }, { semXFarol: true });
  assert.equal(semCabecalho.status, 403, 'sem x-farol não remove');
  assert.equal(cred.hasCredential('site1'), true);

  const semSite = await post('/api/jira/credential/remove', {});
  assert.deepEqual([semSite.status, semSite.json], [200, { ok: false }]);
  assert.equal(cred.hasCredential('site1'), true);

  const r = await post('/api/jira/credential/remove', { siteId: 'site1' });
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  assert.equal(cred.hasCredential('site1'), false);
  assert.equal(temCredencialNoSnapshot(), false, 'o snapshot deixa de dizer que há credencial');
  assert.equal(noDisco().includes(TOKEN), false, 'o token sai do disco');
  assert.equal(cred.hasCredential('outro'), true, 'a credencial do outro site fica');

  const deNovo = await post('/api/jira/credential/remove', { siteId: 'site1' });
  assert.deepEqual([deNovo.status, deNovo.json], [200, { ok: false }], 'remover o que não existe diz que não removeu');
});
