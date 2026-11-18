// O topo e o botão do Histórico (17/11/2026, lib/engine/historico-csv.js e historico-paginado.js):
//   - `recentes7Dias`: as revisões resolvidas nos últimos 7 dias, hoje incluído, contadas do
//     histórico (no banco e no JSON, o mesmo número);
//   - `formato=csv`: o recorte filtrado inteiro, sem página, com escape de CSV e proteção contra
//     injeção de fórmula, servido como texto pela rota existente, sem escrever no log.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-historico-csv-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const { importarHistorico } = await import('../lib/telemetria/migracao.js');
const { colunasDaBusca } = await import('../lib/engine/busca-do-historico.js');
const { campoCsv, historicoEmCsv, nomeDoArquivo, COLUNAS } = await import('../lib/engine/historico-csv.js');
const { historicoPaginado, primeiroDia } = await import('../lib/engine/historico-paginado.js');

let engine, server, base;
before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => { server = startServer(engine, (url, err) => (err ? reject(err) : resolve())); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(() => resolve())); }
  banco.fecharTodos();
  fs.rmSync(HOME, { recursive: true, force: true });
});

const AGORA = Date.parse('2026-11-17T15:00:00Z'); // 12h em São Paulo
const DIA = 86400000;
function decisao(i, resolvedAt, extra = {}) {
  return { id: `d${i}`, key: `acme/app#${i}`, createdAt: resolvedAt - 1000, resolvedAt, status: 'auto_approved', action: 'approve', verdict: 'approve',
    headSha: 'abcdef0123456789'.padEnd(40, '0'), card: `PROJ-${i}`,
    pr: { repo: 'acme/app', number: i, url: `https://github.com/acme/app/pull/${i}`, title: `Correção ${i}`, author: 'ana' }, ...extra };
}

test('campo de CSV: aspas, vírgula e quebra de linha escapadas; fórmula vira texto', () => {
  assert.equal(campoCsv('simples'), 'simples');
  assert.equal(campoCsv('a, b'), '"a, b"');
  assert.equal(campoCsv('diz "oi"'), '"diz ""oi"""');
  assert.equal(campoCsv('linha\noutra'), '"linha\noutra"');
  for (const perigoso of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
    assert.ok(campoCsv(perigoso).replace(/^"/, '').startsWith("'"), perigoso);
  }
  assert.equal(campoCsv('=1,2'), `"'=1,2"`);
  // espaço no começo não esconde a fórmula: a planilha apara e calcula
  for (const disfarcado of [' =1+1', '  +cmd', ' -2+3', '\t @SUM(A1)', ' \n=1']) {
    assert.ok(campoCsv(disfarcado).replace(/^"/, '').startsWith("'"), JSON.stringify(disfarcado));
  }
  assert.equal(campoCsv(' texto comum'), ' texto comum');
  assert.equal(campoCsv(null), '');
  assert.equal(campoCsv(42), '42');
});

test('o CSV: cabeçalho, uma linha por revisão, rótulos do que foi publicado e hora no fuso do motor', () => {
  const texto = historicoEmCsv([
    decisao(1, AGORA),
    decisao(2, AGORA - DIA, { action: 'skip', verdict: 'request_changes', pr: { repo: 'acme/app', number: 2, title: '=cmd|"/C calc"!A0', author: '@ana' }, card: { key: 'PROJ-2' } }),
    null,
  ]);
  assert.ok(texto.startsWith('﻿'));
  const linhas = texto.slice(1).trimEnd().split('\n');
  assert.equal(linhas[0], COLUNAS.join(','));
  assert.equal(linhas.length, 3);
  assert.equal(linhas[1], '2026-11-17 12:00,acme/app,1,Correção 1,ana,PROJ-1,aprovado,aprovado,auto_approved,abcdef0,https://github.com/acme/app/pull/1');
  assert.equal(linhas[2], `2026-11-16 12:00,acme/app,2,"'=cmd|""/C calc""!A0",'@ana,PROJ-2,não publicado,mudanças pedidas,auto_approved,abcdef0,`);
  assert.equal(nomeDoArquivo(AGORA), 'farol-historico-2026-11-17.csv');
});

function noBanco(resolvidas) {
  const h = banco.abrirBanco(path.join(HOME, `h-${Math.random().toString(16).slice(2)}.db`));
  const r = importarHistorico(h, structuredClone(resolvidas), { colunasDaBusca, teto: 3000 });
  assert.equal(r.ok, true, r.motivo);
  return { historicoH: h, historicoNoBanco: true, decisions: { pending: [], resolved: [] }, log: () => {} };
}
const json = (resolvidas) => ({ decisions: { pending: [], resolved: structuredClone(resolvidas) } });

test('recentes7Dias: hoje e os seis dias antes, no fuso do motor, iguais no banco e no JSON', () => {
  assert.equal(primeiroDia(7, AGORA), '2026-11-11');
  // 02h UTC do dia 17 ainda é dia 16 em São Paulo
  assert.equal(primeiroDia(1, Date.parse('2026-11-17T02:00:00Z')), '2026-11-16');
  const lista = [
    decisao(5, AGORA), decisao(4, Date.parse('2026-11-11T03:00:00Z')), decisao(3, Date.parse('2026-11-11T02:59:00Z')),
    decisao(2, AGORA - 20 * DIA, { action: 'request_changes' }), decisao(1, undefined),
  ];
  for (const modo of [json, noBanco]) {
    const r = historicoPaginado(modo(lista), new URLSearchParams('veredito=request_changes'), AGORA);
    assert.equal(r.body.total, 1, 'o filtro vale para a lista');
    assert.equal(r.body.recentes7Dias, 2, `${modo.name}: o topo não depende do filtro`);
  }
});

test('formato=csv exporta o recorte filtrado inteiro, sem página, igual no banco e no JSON', () => {
  const lista = Array.from({ length: 45 }, (_, i) => decisao(i + 1, AGORA - i * 3600000, { action: i % 2 ? 'approve' : 'comment' }));
  const textos = [json, noBanco].map((modo) => historicoPaginado(modo(lista), new URLSearchParams('formato=csv&veredito=approve&pageSize=5&page=3'), AGORA));
  for (const r of textos) {
    assert.equal(r.status, 200);
    assert.equal(r.nome, 'farol-historico-2026-11-17.csv');
    assert.equal(r.csv.trimEnd().split('\n').length, 1 + 22, 'os 22 aprovados, sem página');
  }
  assert.equal(textos[0].csv, textos[1].csv);
  assert.deepEqual(historicoPaginado(json(lista), new URLSearchParams('formato=pdf')), { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'formato' } });
  assert.deepEqual(historicoPaginado({ ...json(lista), historicoForaDoBanco: true }, new URLSearchParams('formato=csv')).body, { ok: false, code: 'historico_indisponivel' });
});

function tamanhoDoLog() { try { return fs.statSync(LOG_FILE).size; } catch { return 0; } }

test('pela rota: o CSV sai como texto para baixar, e o JSON leva a contagem; nada vai ao log', async () => {
  engine.decisions.resolved = [decisao(2, Date.now()), decisao(1, Date.now() - 30 * DIA)];
  const log = tamanhoDoLog();
  const csv = await fetch(`${base}/api/decisions?formato=csv&q=Corre%C3%A7%C3%A3o%202`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="farol-historico-\d{4}-\d{2}-\d{2}\.csv"$/);
  const corpo = await csv.text();
  assert.equal(corpo.trimEnd().split('\n').length, 2);
  assert.match(corpo, /Correção 2/);
  const pagina = await (await fetch(`${base}/api/decisions`)).json();
  assert.equal(pagina.recentes7Dias, 1);
  const recusa = await fetch(`${base}/api/decisions?formato=xls`);
  assert.equal(recusa.status, 400);
  assert.match(recusa.headers.get('content-type'), /application\/json/);
  assert.equal(tamanhoDoLog(), log);
});
