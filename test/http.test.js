// Smoke da camada HTTP (lib/http-server.js): sobe o servidor com uma Engine real contra
// um FAROL_HOME temporário (sem polling, sem gh) e confere que /api/state responde e que
// fora de /api não há página. Protege a extração do http server. Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-http-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');

let server, base, engine;

before(async () => {
  engine = new Engine();
  engine.config.port = 0; // porta efêmera: evita conflito com o Farol real ou outro teste
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { server && server.close(); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(base + pathname, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: d }));
    }).on('error', reject);
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

// mesmo POST, SEM o header x-farol: o gate global de 403 (defesa contra site
// qualquer postando no engine local) tem que continuar valendo pras rotas novas
function postSemHeader(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('GET /api/state devolve o snapshot serializável', async () => {
  const r = await get('/api/state');
  assert.equal(r.status, 200);
  const snap = JSON.parse(r.body);
  assert.equal(typeof snap, 'object');
  assert.ok(snap.decisions, 'snapshot traz decisions');
  assert.ok(Array.isArray(snap.decisions.resolved), 'resolved é array');
  assert.ok(snap.decisions.resolved.length <= 30, 'payload do SSE respeita o cap de 30 (Revisões recentes)');
});

test('GET / não serve página: responde 404 em JSON', async () => {
  const r = await get('/');
  assert.equal(r.status, 404);
  assert.match(r.type, /application\/json/);
  assert.deepEqual(JSON.parse(r.body), { error: 'not found' });
});

test('GET numa rota /api desconhecida devolve 405 (só POST é aceito além das GET conhecidas)', async () => {
  const r = await get('/api/nao-existe');
  assert.equal(r.status, 405);
  assert.deepEqual(JSON.parse(r.body), { error: 'method' });
});

// A autoanálise e Meus PRs saíram (corte da Fase 1, lote 11): as rotas deles não existem mais.
test('as rotas da autoanálise e de ocultar PR saíram: POST cai no 404, e sem o x-farol segue 403', async () => {
  const saidas = ['/api/self-review', '/api/self-review/restricted', '/api/self-review/merge', '/api/self-review/cancel',
    '/api/self-review/visibility', '/api/self-review/agent/request', '/api/pr/hide', '/api/pr/unhide'];
  for (const rota of saidas) {
    const r = await post(rota, { url: 'https://github.com/acme/app/pull/404', key: 'acme/app#404' });
    assert.equal(r.status, 404, rota);
    assert.deepEqual(JSON.parse(r.body), { error: 'not found' }, rota);
    assert.equal((await postSemHeader(rota, {})).status, 403, `${rota}: o gate global vem antes da rota`);
  }
});

test('POST /api/review sem urls é recusado com 400 (o fallback "fila inteira" morreu)', async () => {
  // achado B22: a UI mandava {} quando a fila visível esvaziava entre o render e o
  // clique, e o servidor interpretava ausência de urls como "revise TUDO", inclusive
  // PRs de outras contas que o escopo escondia
  const r = await post('/api/review', {});
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /urls/);
});

test('POST /api/review com urls vazio ou de tipo errado também é recusado', async () => {
  assert.equal((await post('/api/review', { urls: [] })).status, 400);
  assert.equal((await post('/api/review', { urls: 'https://github.com/a/b/pull/1' })).status, 400);
});

// A sessão de terminal saiu (corte da Fase 1, lote 12): as rotas de volta dela não existem mais.
test('as rotas da sessão interativa saíram: POST cai no 404, e sem o x-farol segue 403', async () => {
  for (const rota of ['/api/review/post', '/api/session-exit']) {
    const r = await post(rota, { id: 't1', key: 'acme/app#404', payload: { event: 'APPROVE', body: 'Texto limpo.', comments: [] } });
    assert.equal(r.status, 404, rota);
    assert.deepEqual(JSON.parse(r.body), { error: 'not found' }, rota);
    assert.equal((await postSemHeader(rota, {})).status, 403, `${rota}: o gate global vem antes da rota`);
  }
});

/* ---------- /api/log/triage: o log agrupado que o Diagnóstico mostra ----------
   A rota crua (/api/log) devolve linha por linha e tem consumidor e teste; esta
   devolve o MESMO tail já triado por lib/log-taxonomy.js, porque quem está fora do motor
   não importa módulo de lib/. */

// linhas REAIS do farol.log de produção, no formato "[ts] [NIVEL] mensagem"
function semeiaLog(linhas) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, linhas.join('\n') + '\n');
}

const LOG_FIXTURE = [
  "[2026-08-07 17:32:15] [ERROR] revisao biudtech/biud-esg#193: sessão retornou erro: You've hit your weekly limit · resets 9pm",
  "[2026-08-07 18:10:00] [ERROR] revisao biudtech/biud-core#262: sessão retornou erro: You've hit your session limit",
  "[2026-08-07 21:28:03] [ERROR] revisao biudtech/biud-esg#193: sessão retornou erro: You've hit your weekly limit",
  '[2026-08-07 13:46:00] [ERROR] sessão retornou erro: Your organization has disabled Claude subscription access for Claude Code',
  '[2026-08-06 09:00:00] [WARN] error connecting to api.github.com',
];

test('GET /api/log/triage devolve os grupos ordenados por volume, com janela e PRs citados', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log/triage');
  assert.equal(r.status, 200);
  const grupos = JSON.parse(r.body);
  assert.ok(Array.isArray(grupos), 'a rota devolve a lista de grupos');
  assert.equal(grupos[0].id, 'limite-plano', 'o grupo mais volumoso vem primeiro');
  assert.equal(grupos[0].count, 3);
  assert.equal(grupos[0].grupo, 'ambiente');
  assert.equal(grupos[0].kind, 'espera-reset');
  assert.equal(grupos[0].first, '2026-08-07 17:32:15');
  assert.equal(grupos[0].last, '2026-08-07 21:28:03');
  assert.deepEqual(grupos[0].refs, ['biudtech/biud-core#262', 'biudtech/biud-esg#193']);
  assert.deepEqual(grupos.map(g => g.id).sort(), ['assinatura-bloqueada', 'limite-plano', 'rede']);
  // 5 linhas viraram 5 eventos em 3 grupos: é a leitura que o painel precisava
  assert.equal(grupos.reduce((a, g) => a + g.count, 0), 5);
});

test('GET /api/log/triage respeita o mesmo parâmetro lines da rota crua', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log/triage?lines=1');
  assert.equal(r.status, 200);
  const grupos = JSON.parse(r.body);
  assert.equal(grupos.length, 1, 'só a última linha entra no tail');
  assert.equal(grupos[0].id, 'rede');
});

test('GET /api/log segue devolvendo linha CRUA (contrato antigo intacto)', async () => {
  semeiaLog(LOG_FIXTURE);
  const r = await get('/api/log');
  assert.equal(r.status, 200);
  const linhas = JSON.parse(r.body);
  assert.ok(Array.isArray(linhas));
  assert.equal(typeof linhas[0], 'string', 'nada de objeto aqui: a rota crua não mudou');
  assert.equal(linhas.length, LOG_FIXTURE.length);
});

test('GET /api/log/triage sem log nenhum devolve lista vazia, sem estourar', async () => {
  try { fs.rmSync(LOG_FILE, { force: true }); } catch { /* ok */ }
  const r = await get('/api/log/triage');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), []);
});

/* A caixa de revisão da tabela de Consumo (v2.40.3) precisa alcançar QUALQUER
   revisão do histórico, não só as 30 que o snapshot manda. Daí a rota por chave:
   o payload do SSE segue enxuto (5,2 KB por decisão com relatório; 3000 delas
   seriam 15 MB a cada ciclo de polling) e o alcance vem da busca sob demanda. */
test('GET /api/decision?key= devolve a revisão do histórico completo', async () => {
  engine.decisions.pending = [];
  engine.decisions.resolved = [];
  // 60 decisões: a de índice 0 fica na posição 59, muito além das 30 do snapshot
  for (let i = 0; i < 60; i++) {
    engine.resolveIntoHistory({ id: 'd' + i, key: `acme/app#${i}`, verdict: 'approve', reportMarkdown: 'relatório ' + i });
  }
  const r = await get('/api/decision?key=' + encodeURIComponent('acme/app#0'));
  assert.equal(r.status, 200);
  const env = JSON.parse(r.body);
  assert.equal(env.found, true);
  assert.equal(env.decision.key, 'acme/app#0');
  assert.equal(env.decision.reportMarkdown, 'relatório 0', 'o relatório é o conteúdo da caixa; sem ele a rota não serve');
});

test('GET /api/decision distingue "nao existe" de "falhou" (envelope, nunca 404)', async () => {
  // o get() da UI e um fetch com .catch(() => null): qualquer falha vira null.
  // Sem o envelope, "nao ha revisao pra esse PR" ficaria identico a "a rede caiu"
  // e o clique seria indistinguivel de bug, que e o M18 com outra roupa.
  const r = await get('/api/decision?key=' + encodeURIComponent('acme/app#99999'));
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { found: false, decision: null });
});

test('GET /api/decision sem chave nao explode', async () => {
  const r = await get('/api/decision');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).found, false);
});

test('GET de caminho de arquivo do repositório nunca entrega o arquivo', async () => {
  for (const caminho of ['/../package.json', '/package.json', '/server.js', '/lib/paths.js', '/web/package.json']) {
    const r = await get(caminho);
    assert.equal(r.status, 404, caminho);
    assert.deepEqual(JSON.parse(r.body), { error: 'not found' }, caminho);
  }
});

/* C0, defeito 2: a rota descartava o retorno de updateSettings e mandava só
   { ok, config }. Os ramos de erro da tela (settingsMap e sites do Jira)
   liam r.ignoradas, que nunca chegava, e a tela dizia "salvo" para o que foi recusado. */
test('POST /api/settings devolve as chaves ignoradas junto da config', async () => {
  const r = await post('/api/settings', { chaveQueNaoExiste: 1 });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.deepEqual(j.ignoradas, ['chaveQueNaoExiste']);
  assert.ok(j.config && typeof j.config === 'object', 'a config continua vindo');
  assert.equal('chaveQueNaoExiste' in j.config, false, 'o que foi ignorado não entra na config');
});

