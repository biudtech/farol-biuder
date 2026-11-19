// Os dados do Consumo que o redesenho pede (lote 2, 19/11/2026), todos em GET /api/usage:
//   - os filtros `profile` (o perfil do Claude da sessão) e `author` (o autor do PR, lido do
//     histórico das decisões pelo `ref` da linha);
//   - os tokens de pensamento nos totais, nas linhas e nos modelos, e o custo por modelo;
//   - o gatilho de cada sessão e o agregado `porGatilho`;
//   - `pageSize` (padrão 8, teto 50);
//   - por linha da página, as etapas, o card e os arquivos lidos da decisão do mesmo PR e janela;
//   - `formato=csv`, com o mesmo escape do CSV do Histórico.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-usage-redesenho-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { activityReport } = await import('../lib/usage/report.js');
const { usageActivity, usageDaRota } = await import('../lib/engine/usage-activity.js');
const { decisaoDaLinha } = await import('../lib/engine/consumo-das-sessoes.js');

after(() => { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const NOW = Date.parse('2026-10-26T16:00:00Z');
const query = { start: '2026-10-01', end: '2026-10-26' };
const uuid = (n) => `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, extra = {}) => ({ id: uuid(n), at: NOW - n * 1000, kind: 'review', account: 'dev', profileId: 'p1', ref: 'org/repo#1',
  model: 'Opus', status: 'ok', inputTokens: 10, outputTokens: 5, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  costUsd: 1, costSource: 'medido', ...extra });
const report = (rows, filtros = {}, contexto) => activityReport([{ device: 'local', rows }], { ...query, ...filtros }, NOW, contexto);

test('tokens de pensamento entram nos totais, nas linhas e nos modelos', () => {
  const r = report([row(1, { thinkingTokens: 40 }), row(2, { thinkingTokens: 2, model: 'Sonnet' })]);
  assert.equal(r.totals.thinkingTokens, 42);
  assert.deepEqual(r.history.rows.map((x) => x.thinkingTokens), [40, 2]);
  assert.deepEqual(Object.fromEntries(r.models.map((m) => [m.name, m.thinkingTokens])), { Opus: 40, Sonnet: 2 });
  assert.equal(r.byKind.find((k) => k.name === 'review').thinkingTokens, 42);
});

test('custo por modelo: o medido por modelo quando a linha o tem; senão o custo da linha; o desconhecido não soma', () => {
  const r = report([
    row(1, { costUsd: 3, modelUsage: { 'claude-opus-4-1': { inputTokens: 6, outputTokens: 2, costUSD: 2.5, thinkingTokens: 7 }, 'claude-haiku-4-5': { inputTokens: 4, outputTokens: 3, costUSD: 0.5 } } }),
    row(2, { model: 'Sonnet', costUsd: 1.25 }),
    row(3, { model: 'Sonnet', costUsd: 9, costSource: 'desconhecido' }),
  ]);
  const por = Object.fromEntries(r.models.map((m) => [m.name, m]));
  assert.equal(por.Sonnet.costUsd, 1.25);
  assert.equal(por.Sonnet.unknownCost, 1);
  assert.equal(por.Sonnet.attempts, 2);
  const opus = r.models.find((m) => /opus/i.test(m.name));
  const haiku = r.models.find((m) => /haiku/i.test(m.name));
  assert.equal(opus.costUsd, 2.5);
  assert.equal(opus.thinkingTokens, 7);
  assert.equal(haiku.costUsd, 0.5);
});

test('filtro por perfil do Claude, com as opções', () => {
  const rows = [row(1), row(2, { profileId: 'p2', costUsd: 4 }), row(3, { profileId: 'p2', costUsd: 1 })];
  const r = report(rows, { profile: 'p2' });
  assert.equal(r.totals.attempts, 2);
  assert.equal(r.totals.costUsd, 5);
  assert.deepEqual(r.options.profile, ['p1', 'p2']);
  assert.equal(report(rows, { profile: 'all' }).totals.attempts, 3);
});

test('filtro por autor do PR: o autor vem do contexto pelo ref, sem caixa', () => {
  const autores = new Map([['org/repo#1', 'ana'], ['org/repo#2', 'bia']]);
  const contexto = { autorDe: (ref) => autores.get(String(ref).toLowerCase()) || '' };
  const rows = [row(1), row(2, { ref: 'Org/Repo#2' }), row(3, { ref: 'org/repo#9' }), row(4, { ref: '', kind: 'tool' })];
  const r = report(rows, { author: 'BIA' }, contexto);
  assert.equal(r.totals.attempts, 1);
  assert.equal(r.history.rows[0].author, 'bia');
  assert.deepEqual(r.options.author, ['ana', 'bia']);
  assert.equal(report(rows, {}, contexto).history.rows.find((x) => x.ref === 'org/repo#9').author, '', 'PR sem decisão fica sem autor');
  assert.equal(report(rows, { author: 'ana' }).totals.attempts, 0, 'sem contexto ninguém tem autor');
});

test('o gatilho da linha (o antigo sem marca conta como primeira, o pushback como contestação) e o agregado por gatilho', () => {
  const rows = [row(1), row(2, { gatilho: 'commit_novo', costUsd: 2 }), row(3, { gatilho: 'rodada_extra', costUsd: 3 }),
    row(4, { kind: 'pushback', id: 'pb-00000000-0000-4000-8000-000000000004', costUsd: 0.5 }), row(5, { kind: 'tool', ref: '', costUsd: 0.25 })];
  const r = report(rows);
  assert.deepEqual(r.history.rows.map((x) => x.gatilho), ['primeira', 'commit_novo', 'rodada_extra', 'contestacao', '']);
  const por = Object.fromEntries(r.porGatilho.map((g) => [g.name, [g.attempts, g.costUsd]]));
  assert.deepEqual(por, { primeira: [1, 1], commit_novo: [1, 2], rodada_extra: [1, 3], contestacao: [1, 0.5], '': [1, 0.25] });
});

test('pageSize: padrão 8, teto 50, valor torto vira o padrão', () => {
  const rows = Array.from({ length: 70 }, (_, i) => row(i + 1, { ref: `org/repo#${i + 1}` }));
  assert.equal(report(rows).history.rows.length, 8);
  assert.equal(report(rows).history.pageSize, 8);
  assert.equal(report(rows, { pageSize: '20' }).history.rows.length, 20);
  assert.equal(report(rows, { pageSize: '20' }).history.pages, 4);
  assert.equal(report(rows, { pageSize: '999' }).history.pageSize, 50);
  assert.equal(report(rows, { pageSize: 'x' }).history.pageSize, 8);
  assert.equal(report(rows, { pageSize: '0' }).history.pageSize, 8);
});

/* ---------- a linha com a decisão do mesmo PR e janela ---------- */

const T = Date.now() - 3_600_000;
const decisao = (id, createdAt, extra = {}) => ({ id, key: 'acme/app#7', createdAt, resolvedAt: createdAt + 10, status: 'auto_approved', action: 'approve',
  pr: { repo: 'acme/app', number: 7, title: 't', author: 'Ana' }, ...extra });

test('a decisão de uma linha: a primeira do mesmo PR criada no registro dela ou depois', () => {
  const d1 = decisao('d1', T + 100);
  const d2 = decisao('d2', T + 200);
  const outra = { ...decisao('x', T + 150), key: 'acme/app#8' };
  const decisoes = [d2, outra, d1];
  assert.equal(decisaoDaLinha({ kind: 'review', ref: 'acme/app#7', at: T + 50 }, decisoes).id, 'd1');
  assert.equal(decisaoDaLinha({ kind: 'review', ref: 'ACME/app#7', at: T + 100 }, decisoes).id, 'd1', 'a linha é gravada antes da decisão');
  assert.equal(decisaoDaLinha({ kind: 'review', ref: 'acme/app#7', at: T + 150 }, decisoes).id, 'd2');
  assert.equal(decisaoDaLinha({ kind: 'review', ref: 'acme/app#7', at: T + 250 }, decisoes), null, 'rodada ainda sem decisão');
  assert.equal(decisaoDaLinha({ kind: 'pushback', ref: 'acme/app#7', at: T + 50 }, decisoes), null, 'só a revisão tem decisão');
});

function engineDoConsumo(sessions, resolved, pending = []) {
  return { usage: { totals: { sessions: sessions.length } }, usageSessions: { sessions }, decisions: { pending, resolved } };
}

const linhaDoPr = (n, at, extra = {}) => ({ ...row(n), at, ref: 'acme/app#7', ...extra });

test('a página leva, por linha, as etapas, o card e os arquivos lidos da decisão, e o autor do PR', async () => {
  const d1 = decisao('d1', T + 100, { card: { key: 'PROJ-9' }, stages: { totalMs: 900, stages: [{ id: 'fontes', label: 'Fontes', ms: 300 }, { id: 'codigo', label: 'Código', ms: 600 }] },
    provas: { cobertura: { total: 14, lidos: 12, faltando: 2 } } });
  const d2 = decisao('d2', T + 300, { card: 'PROJ-10' });
  const sessions = [linhaDoPr(1, T + 50), linhaDoPr(2, T + 200), linhaDoPr(3, T + 400), { ...row(4), at: T + 60, ref: 'acme/app#8' }];
  const r = await usageActivity(engineDoConsumo(sessions, [d2, d1]), new URLSearchParams());
  const porAt = Object.fromEntries(r.history.rows.map((x) => [x.at - T, x]));
  assert.deepEqual(porAt[50].etapas, [{ id: 'fontes', label: 'Fontes', ms: 300 }, { id: 'codigo', label: 'Código', ms: 600 }]);
  assert.equal(porAt[50].card, 'PROJ-9');
  assert.equal(porAt[50].arquivosLidos, 12);
  assert.equal(porAt[50].decisaoId, 'd1');
  assert.equal(porAt[50].author, 'ana');
  assert.equal(porAt[200].card, 'PROJ-10');
  assert.equal('etapas' in porAt[200], false, 'decisão sem etapas');
  assert.equal('arquivosLidos' in porAt[200], false, 'decisão sem provas');
  for (const k of ['etapas', 'card', 'arquivosLidos', 'decisaoId']) assert.equal(k in porAt[400], false, `rodada sem decisão: ${k}`);
  assert.equal(porAt[60].author, '', 'PR sem decisão');
  const soAna = await usageActivity(engineDoConsumo(sessions, [d2, d1]), new URLSearchParams('author=ana'));
  assert.equal(soAna.totals.attempts, 3);
});

test('o histórico indisponível não derruba o consumo: a página sai sem os campos da decisão', async () => {
  const d1 = decisao('d1', T + 100, { card: 'PROJ-9' });
  const engine = { ...engineDoConsumo([linhaDoPr(1, T + 50)], [d1]), historicoForaDoBanco: true };
  const r = await usageActivity(engine, new URLSearchParams());
  assert.equal(r.ok, true);
  assert.equal('card' in r.history.rows[0], false);
  assert.equal(r.history.rows[0].author, '');
});

/* ---------- CSV ---------- */

test('formato=csv: todas as sessões do recorte, sem página, com o escape do Histórico', async () => {
  const sessions = Array.from({ length: 12 }, (_, i) => linhaDoPr(i + 1, T + i, { gatilho: 'commit_novo' }));
  sessions.push({ ...row(20), at: T + 50, ref: '=HYPERLINK("x")', kind: 'tool', model: '+cmd' });
  const d = decisao('d1', T + 1000, { card: { key: '@PROJ-1' } });
  const r = await usageDaRota(engineDoConsumo(sessions, [d]), new URLSearchParams('formato=csv&pageSize=5'));
  assert.equal(r.status, 200);
  assert.match(r.nome, /^farol-consumo-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(r.csv.startsWith('﻿'), 'marca de ordem de bytes');
  assert.equal(r.csv.includes('\r'), false, 'linhas em LF');
  const linhas = r.csv.slice(1).trimEnd().split('\n');
  assert.equal(linhas.length, 14, 'cabeçalho e as 13 sessões, sem página');
  assert.match(linhas[0], /^Quando,Tipo,Gatilho,PR,Autor,Card,Modelo,Perfil/);
  assert.ok(linhas.some((l) => l.includes(`"'=HYPERLINK(""x"")"`)), 'fórmula vira texto');
  assert.ok(linhas.some((l) => l.includes(",'+cmd,")), 'campo com + ganha o apóstrofo');
  assert.ok(linhas.some((l) => l.includes(",'@PROJ-1,")), 'o card vem da decisão e também é escapado');
  assert.ok(linhas.filter((l) => l.includes(',commit_novo,')).length >= 12);
});

test('sem formato a rota responde o JSON de sempre; formato desconhecido é 400 com o campo', async () => {
  const engine = engineDoConsumo([linhaDoPr(1, T)], []);
  const json = await usageDaRota(engine, new URLSearchParams());
  assert.equal(json.status, 200);
  assert.equal(json.body.ok, true);
  assert.deepEqual(await usageDaRota(engine, new URLSearchParams('formato=xml')), { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'formato' } });
  const invalido = await usageDaRota(engine, new URLSearchParams('formato=csv&start=2099-01-01'));
  assert.equal(invalido.body.ok, false, 'período inválido segue a resposta de sempre, mesmo no CSV');
});

/* ---------- a rodada de correção do lote 2 ---------- */

const { activityDay } = await import('../lib/usage/activity.js');
const { autoresDosPrs, consumoEmCsv, indiceDasDecisoes, decisoesConhecidas } = await import('../lib/engine/consumo-das-sessoes.js');

// O CSV de um recorte, como mapa de coluna para valor por linha (sem o BOM).
function linhasDoCsv(csv) {
  const [cabecalho, ...corpo] = csv.slice(1).trimEnd().split('\n').map((l) => l.split(','));
  return corpo.map((l) => Object.fromEntries(cabecalho.map((c, i) => [c, l[i]])));
}

test('CSV: a linha da operação soma só as tentativas do período e do filtro, e o CSV fecha com os totais', async () => {
  const id = uuid(70);
  const tentativa = (n, at, extra) => ({ ...row(70), id, attemptId: `t-${n}`, ref: 'acme/app#7', at, iniciadaEm: at - 2000, ...extra });
  const sessions = [
    tentativa(1, T - 3 * 86_400_000, { costUsd: 100, inputTokens: 1000, status: 'erro' }),
    tentativa(2, T, { model: 'Sonnet', costUsd: 2, inputTokens: 20, outputTokens: 4, thinkingTokens: 3, status: 'parcial' }),
    tentativa(3, T + 10, { model: 'Opus', costUsd: 4, inputTokens: 40, outputTokens: 8, thinkingTokens: 5 }),
    { ...row(71), ref: 'acme/app#8', at: T + 20, model: 'Opus', costUsd: 9, costSource: 'desconhecido' },
  ];
  const engine = engineDoConsumo(sessions, []);
  for (const filtro of ['', '&model=Opus']) {
    const params = `start=${activityDay(T)}${filtro}`;
    const json = await usageDaRota(engine, new URLSearchParams(params));
    const csv = await usageDaRota(engine, new URLSearchParams(`${params}&formato=csv`));
    const linhas = linhasDoCsv(csv.csv);
    const soma = (col) => linhas.reduce((n, l) => n + Number(l[col] || 0), 0);
    assert.equal(soma('Tentativas'), json.body.totals.attempts, `tentativas ${filtro}`);
    assert.equal(soma('Custo (USD)'), json.body.totals.costUsd, `custo ${filtro}`);
    assert.equal(soma('Entrada'), json.body.totals.inputTokens, `entrada ${filtro}`);
    assert.equal(soma('Pensamento'), json.body.totals.thinkingTokens, `pensamento ${filtro}`);
  }
  const op = linhasDoCsv((await usageDaRota(engine, new URLSearchParams(`start=${activityDay(T)}&formato=csv`))).csv)
    .find((l) => l.PR === 'acme/app#7');
  assert.deepEqual([op.Tentativas, op['Custo (USD)'], op['Duração (s)'], op.Entrada, op['Saída']], ['2', '6', '4', '60', '12'],
    'duas tentativas do período, sem a de fora');
  const soOpus = linhasDoCsv((await usageDaRota(engine, new URLSearchParams(`start=${activityDay(T)}&model=Opus&formato=csv`))).csv)
    .find((l) => l.PR === 'acme/app#7');
  assert.deepEqual([soOpus.Tentativas, soOpus['Custo (USD)']], ['1', '4'], 'só a tentativa do filtro');
});

test('custo por modelo: medição que não fecha com o custo da linha vira a parte única com o custo da linha', () => {
  const naoFecha = report([row(1, { costUsd: 3, modelUsage: { 'claude-opus-4-1': { inputTokens: 6, outputTokens: 2, costUSD: 2 }, 'claude-haiku-4-5': { inputTokens: 4, outputTokens: 3, costUSD: 0.5 } } })]);
  assert.deepEqual(naoFecha.models.map((m) => [m.name, m.costUsd, m.inputTokens]), [['Sem atribuição por modelo', 3, 10]]);
  const semCusto = report([row(1, { costUsd: 3, modelUsage: { 'claude-opus-4-1': { inputTokens: 6, outputTokens: 2 }, 'claude-haiku-4-5': { inputTokens: 4, outputTokens: 3 } } })]);
  assert.deepEqual(semCusto.models.map((m) => [m.name, m.costUsd]), [['Sem atribuição por modelo', 3]], 'sem custo por modelo não fecha');
  const fecha = report([row(1, { costUsd: 3, modelUsage: { 'claude-opus-4-1': { inputTokens: 6, outputTokens: 2, costUSD: 2.5 }, 'claude-haiku-4-5': { inputTokens: 4, outputTokens: 3, costUSD: 0.5 } } })]);
  assert.equal(fecha.models.reduce((n, m) => n + m.costUsd, 0), fecha.totals.costUsd);
  assert.equal(fecha.models.length, 2);
});

test('o filtro author apara os espaços, e as opções de perfil não têm o vazio', () => {
  const contexto = { autorDe: () => 'ana' };
  const rows = [row(1), row(2, { profileId: '' })];
  assert.equal(report(rows, { author: '  Ana ' }, contexto).totals.attempts, 2);
  assert.deepEqual(report(rows).options.profile, ['p1']);
});

test('as decisões são indexadas por chave uma vez, e o índice dá a mesma decisão que a lista', () => {
  const d1 = decisao('d1', T + 100);
  const d2 = decisao('d2', T + 200);
  const decisoes = [d2, { ...decisao('x', T + 150), key: 'acme/app#8' }, d1];
  const indice = indiceDasDecisoes(decisoes);
  assert.ok(indice instanceof Map);
  for (const at of [T + 50, T + 100, T + 150, T + 250]) {
    const linha = { kind: 'review', ref: 'ACME/app#7', at };
    assert.equal(decisaoDaLinha(linha, indice), decisaoDaLinha(linha, decisoes), `at ${at - T}`);
  }
  assert.equal(autoresDosPrs(decisoes).get('acme/app#7'), 'Ana');
  assert.match(consumoEmCsv([{ ...linhaDoPr(1, T + 50), attempts: [] }], indice), /acme\/app#7/);
});

test('a rota lê as decisões conhecidas uma vez só, também no CSV', async () => {
  let leituras = 0;
  const engine = engineDoConsumo([linhaDoPr(1, T)], []);
  const pendentes = engine.decisions.pending;
  Object.defineProperty(engine.decisions, 'pending', { get() { leituras++; return pendentes; } });
  decisoesConhecidas(engine);
  const umaLeitura = leituras;
  leituras = 0;
  await usageDaRota(engine, new URLSearchParams('formato=csv'));
  assert.ok(umaLeitura > 0);
  assert.equal(leituras, umaLeitura, 'o CSV não relê as decisões');
});
