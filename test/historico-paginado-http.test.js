// GET /api/decisions no servidor real (fase 2b): a rota responde a página do histórico,
// recusa parâmetro inválido com 400 (nunca 500), exige credencial quando o modo exige, não
// altera engine.decisions e não grava linha no log. FAROL_HOME temporário antes de importar
// o server.js (os caminhos são constantes de módulo), e HOME junto: o boot da Engine
// escreve ~/.claude.json e teste nenhum pode mexer no arquivo real.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-historico-paginado-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const { emitirSessao } = await import('../lib/local-auth/sessoes.js');
const { decisionForUi } = await import('../lib/engine/public-review.js');

let engine, server, base;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
  }
  fs.rmSync(HOME, { recursive: true, force: true });
});

async function pedir(consulta = '', opcoes = {}) {
  const r = await fetch(`${base}/api/decisions${consulta}`, opcoes);
  const texto = await r.text();
  return { status: r.status, tipo: r.headers.get('content-type') || '', texto, json: JSON.parse(texto) };
}

function item(i, extra = {}) {
  return {
    id: `d${i}`, createdAt: 1000 + i, resolvedAt: 2000 + i, key: `acme/app#${i}`,
    pr: { repo: i % 2 ? 'acme/app' : 'acme/api', number: i, url: `https://github.com/acme/app/pull/${i}`, title: `Correção ${i}`, author: 'ana', account: 'revisora' },
    card: `PROJ-${i}`, verdict: i % 3 ? 'approve' : 'request_changes', status: 'auto_approved', action: 'approve',
    reasons: [], reviewMarkdown: `Revisão ${i}`, reportMarkdown: `RELATORIO-BRUTO ${i}`,
    payloads: { approve: { event: 'APPROVE', body: `CORPO-DO-PAYLOAD ${i}`, comments: [] } },
    memory: { notes: `MEMORIA-DO-TIME ${i}` },
    ...extra,
  };
}

// Direto na lista, sem resolveIntoHistory: o item fica com os campos brutos que um
// decisions.json antigo pode trazer, e a rota tem de segurar mesmo assim.
function semear(n) {
  engine.decisions.pending = [item(9000, { status: 'pending', key: 'acme/app#9000' })];
  engine.decisions.resolved = Array.from({ length: n }, (_, i) => item(n - i));
}

function tamanhoDoLog() { try { return fs.statSync(LOG_FILE).size; } catch { return 0; } }

test('sem parâmetro: a primeira página de 30, com o total e os repositórios', async () => {
  semear(65);
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.match(r.tipo, /application\/json/);
  assert.deepEqual(Object.keys(r.json).sort(), ['items', 'ok', 'page', 'pageSize', 'pages', 'repos', 'total']);
  assert.deepEqual([r.json.ok, r.json.page, r.json.pageSize, r.json.total, r.json.pages], [true, 1, 30, 65, 3]);
  assert.equal(r.json.items.length, 30);
  assert.equal(r.json.items[0].id, 'd65', 'a mais nova vem primeiro');
  assert.deepEqual(r.json.repos, ['acme/api', 'acme/app']);
});

test('a última página é parcial e a página além do fim responde 200 vazio', async () => {
  semear(65);
  const ultima = await pedir('?page=3');
  assert.deepEqual(ultima.json.items.map(d => d.id), ['d5', 'd4', 'd3', 'd2', 'd1']);
  const alem = await pedir('?page=4');
  assert.equal(alem.status, 200);
  assert.deepEqual([alem.json.page, alem.json.total, alem.json.pages, alem.json.items], [4, 65, 3, []]);
});

test('alcança o histórico inteiro, além das 30 do snapshot', async () => {
  semear(3000);
  const r = await pedir('?page=30&pageSize=100');
  assert.deepEqual([r.json.total, r.json.pages, r.json.items.length], [3000, 30, 100]);
  assert.equal(r.json.items.at(-1).id, 'd1');
});

test('filtros e busca pela URL, com acento codificado', async () => {
  semear(65);
  const porRepo = await pedir('?repo=ACME/API&pageSize=100');
  assert.equal(porRepo.json.total, 32);
  assert.ok(porRepo.json.items.every(d => d.pr.repo === 'acme/api'));
  const porVeredito = await pedir('?veredito=request_changes&pageSize=100');
  assert.equal(porVeredito.json.total, 21);
  assert.ok(porVeredito.json.items.every(d => d.verdict === 'request_changes'));
  const porBusca = await pedir(`?q=${encodeURIComponent('CORRECAO 41')}`);
  assert.deepEqual(porBusca.json.items.map(d => d.id), ['d41']);
  const porCard = await pedir('?q=proj-17&repo=acme/app&veredito=approve');
  assert.deepEqual(porCard.json.items.map(d => d.id), ['d17']);
});

test('os itens saem pela projeção segura: payloads, memória e relatório bruto ficam no motor', async () => {
  semear(40);
  const r = await pedir('?pageSize=100');
  assert.deepEqual(r.json.items, JSON.parse(JSON.stringify(engine.decisions.resolved.map(decisionForUi))));
  assert.doesNotMatch(r.texto, /RELATORIO-BRUTO|CORPO-DO-PAYLOAD|MEMORIA-DO-TIME|"payloads"|"memory"|"reviewMarkdown"/);
  assert.equal(r.json.items[0].reportMarkdown, 'Revisão 40');
});

test('a pendente não aparece na rota', async () => {
  semear(3);
  const r = await pedir('?q=9000');
  assert.equal(r.json.total, 0);
  assert.doesNotMatch((await pedir()).texto, /d9000/);
});

test('parâmetro inválido responde 400 com o campo, e nunca 500', async () => {
  semear(5);
  const casos = [
    ['?page=0', 'page'], ['?page=-3', 'page'], ['?page=abc', 'page'], ['?page=1&page=2', 'page'],
    ['?pageSize=101', 'pageSize'], ['?pageSize=0', 'pageSize'], ['?pageSize=x', 'pageSize'],
    [`?q=${'a'.repeat(201)}`, 'q'], ['?q=a&q=b', 'q'],
    ['?veredito=aprovado', 'veredito'], ['?veredito=approve&veredito=approve', 'veredito'],
    ['?repo=a/b&repo=c/d', 'repo'],
  ];
  for (const [consulta, campo] of casos) {
    const r = await pedir(consulta);
    assert.equal(r.status, 400, consulta);
    assert.deepEqual(r.json, { ok: false, code: 'parametro_invalido', campo }, consulta);
  }
});

test('consulta estranha na URL não derruba a rota', async () => {
  semear(5);
  for (const consulta of ['?', '?&&&', '?=', '?page', '?q=%E0%A4%A', '?q=%00', '?__proto__=1', '?q[]=a', '?page[]=2']) {
    const r = await pedir(consulta);
    assert.ok(r.status === 200 || r.status === 400, `${consulta} respondeu ${r.status}`);
    assert.equal(typeof r.json.ok, 'boolean', consulta);
  }
});

test('só leitura: engine.decisions fica igual e nenhuma linha entra no log', async () => {
  semear(65);
  const antes = structuredClone(engine.decisions);
  const lista = engine.decisions.resolved;
  const log = tamanhoDoLog();
  for (const consulta of ['', '?page=2', '?q=ana&veredito=approve&repo=acme/app', '?page=99', '?page=0', '?veredito=nao']) await pedir(consulta);
  assert.deepEqual(engine.decisions, antes);
  assert.equal(engine.decisions.resolved, lista);
  assert.equal(tamanhoDoLog(), log, 'a rota escreveu no farol.log');
});

test('só GET: POST no mesmo caminho não devolve o histórico', async () => {
  semear(3);
  const r = await fetch(`${base}/api/decisions`, { method: 'POST', headers: { 'x-farol': '1', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 404);
  assert.doesNotMatch(await r.text(), /items/);
});

test('quando o modo exige, sem credencial é 401 sem dado; com a sessão responde', async () => {
  semear(3);
  const anterior = engine.config.localAuth;
  engine.config.localAuth = 'exigir';
  try {
    for (const consulta of ['', '?page=0', '?q=ana']) {
      const sem = await pedir(consulta);
      assert.equal(sem.status, 401, `sem credencial em ${consulta || '(sem consulta)'}`);
      assert.deepEqual(sem.json, { error: 'nao_autenticado' });
    }
    const falso = await pedir('', { headers: { Authorization: 'Bearer token-que-nao-existe' } });
    assert.equal(falso.status, 401);
    const headers = { Authorization: `Bearer ${emitirSessao('teste histórico')}` };
    const com = await pedir('', { headers });
    assert.equal(com.status, 200);
    assert.equal(com.json.total, 3);
    const invalido = await pedir('?page=0', { headers });
    assert.equal(invalido.status, 400);
    const fora = await pedir('', { headers: { ...headers, Origin: 'https://externo.invalid' } });
    assert.equal(fora.status, 403, 'origem fora da allowlist não lê o histórico nem com sessão');
  } finally {
    engine.config.localAuth = anterior;
  }
});

test('quando o modo não exige, a rota responde sem credencial', async () => {
  semear(2);
  assert.notEqual(engine.config.localAuth, 'exigir');
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 2);
});
