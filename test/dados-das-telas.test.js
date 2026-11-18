// Os dados que o redesenho das telas pede e que o motor passou a mandar (17/11/2026):
//   - o período em GET /api/decisions (`desde` e `ate`), validado e filtrado no SQL, igual à lista;
//   - os checks obrigatórios do head nas provas da decisão, e o detalhe por chave com eles e com a
//     execução da sessão lida do diário de consumo (nos dois lugares do diário);
//   - os números de 30 dias por autor, do histórico;
//   - o custo e as tentativas por repositório no relatório do consumo;
//   - a pessoa cadastrada sem papel nem competência.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-dados-das-telas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const banco = await import('../lib/telemetria/banco.js');
const consumo = await import('../lib/telemetria/consumo.js');
const { importarHistorico } = await import('../lib/telemetria/migracao.js');
const { colunasDaBusca, limitesDoPeriodo, diaValido } = await import('../lib/engine/busca-do-historico.js');
const { HIST_LIMIT } = await import('../lib/engine/historico-decisoes.js');
const { historicoPaginado, lerParametros } = await import('../lib/engine/historico-paginado.js');
const { provasDaDecisao } = await import('../lib/engine/provas-da-decisao.js');
const { detalheDaDecisao, execucaoDasLinhas, janelaDaDecisao } = await import('../lib/engine/detalhe-da-decisao.js');
const { numerosPorAutor, numerosDoTime, timeComNumeros } = await import('../lib/engine/numeros-do-time.js');
const { activityReport } = await import('../lib/usage/report.js');
const { parsePeople } = await import('../lib/parse.js');
const { safeStringify } = await import('../lib/io.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

let contador = 0;
function abrir() { return banco.abrirBanco(path.join(FAROL_HOME, `t-${contador++}.db`)); }

/* ---------- período do histórico ---------- */

// meia-noite de 17/11/2026 em São Paulo (UTC-3) é 03:00 UTC
const MEIA_NOITE_17 = Date.parse('2026-11-17T03:00:00Z');
function decisao(i, resolvedAt, extra = {}) {
  return {
    id: `d${i}`, createdAt: resolvedAt - 1000, resolvedAt, key: `acme/app#${i}`, status: 'auto_approved', action: 'approve', verdict: 'approve',
    pr: { repo: 'acme/app', number: i, url: `https://github.com/acme/app/pull/${i}`, title: `T ${i}`, author: 'ana' }, reasons: [], ...extra,
  };
}
// da mais nova para a mais antiga, como o histórico guarda
const RESOLVIDAS = [
  decisao(5, MEIA_NOITE_17 + 86400000),        // 18/11 00:00 em SP
  decisao(4, MEIA_NOITE_17 + 86400000 - 1),    // 17/11 23:59:59.999
  decisao(3, MEIA_NOITE_17),                   // 17/11 00:00
  decisao(2, MEIA_NOITE_17 - 1),               // 16/11 23:59:59.999
  decisao(1, MEIA_NOITE_17 - 5 * 86400000),    // 12/11
];
const SEM_HORA = decisao(9, 0);
delete SEM_HORA.resolvedAt;

const ids = (r) => r.body.items.map((d) => d.id);
const json = (resolved) => ({ decisions: { pending: [], resolved: structuredClone(resolved) } });
function noBanco(resolved) {
  const h = abrir();
  const r = importarHistorico(h, resolved, { colunasDaBusca, teto: HIST_LIMIT });
  assert.equal(r.ok, true, r.motivo);
  return { decisions: { pending: [], resolved: [] }, historicoH: h, historicoNoBanco: true, log: () => {} };
}

test('período: dia de calendário válido é aceito; o resto vira 400 com o campo', () => {
  assert.deepEqual(lerParametros(new URLSearchParams('desde=2026-11-01&ate=2026-11-17')),
    { ok: true, page: 1, pageSize: 30, q: '', veredito: '', repo: '', desde: '2026-11-01', ate: '2026-11-17', formato: '' });
  assert.equal(diaValido('2024-02-29'), true);
  for (const [texto, campo] of [['desde=2026-02-30', 'desde'], ['desde=2026/11/01', 'desde'], ['ate=17-11-2026', 'ate'], ['ate=2026-11-1', 'ate'],
    ['desde=2026-11-01&desde=2026-11-02', 'desde'], ['desde=2026-11-10&ate=2026-11-09', 'ate'], ['desde=%202026-11-01', 'desde']]) {
    assert.deepEqual(lerParametros(new URLSearchParams(texto)), { ok: false, campo }, texto);
    const r = historicoPaginado(json(RESOLVIDAS), new URLSearchParams(texto));
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { ok: false, code: 'parametro_invalido', campo });
  }
});

test('período: os limites são a meia-noite no fuso do motor, com `ate` inclusivo', () => {
  assert.deepEqual(limitesDoPeriodo({ desde: '2026-11-17', ate: '2026-11-17' }), { desdeMs: MEIA_NOITE_17, ateMs: MEIA_NOITE_17 + 86400000 });
  assert.deepEqual(limitesDoPeriodo({}), { desdeMs: null, ateMs: null });
  for (const modo of [json, noBanco]) {
    const pedir = (q) => ids(historicoPaginado(modo([...RESOLVIDAS, SEM_HORA]), new URLSearchParams(q)));
    assert.deepEqual(pedir('desde=2026-11-17&ate=2026-11-17'), ['d4', 'd3'], modo.name);
    assert.deepEqual(pedir('desde=2026-11-17'), ['d5', 'd4', 'd3'], modo.name);
    assert.deepEqual(pedir('ate=2026-11-16'), ['d2', 'd1'], modo.name);
    assert.deepEqual(pedir(''), ['d5', 'd4', 'd3', 'd2', 'd1', 'd9'], 'sem período a decisão sem hora entra');
    const r = historicoPaginado(modo(RESOLVIDAS), new URLSearchParams('desde=2026-11-13&veredito=approve&pageSize=1'));
    assert.equal(r.body.total, 4);
    assert.equal(r.body.pages, 4);
    assert.deepEqual(r.body.repos, ['acme/app'], 'os repositórios continuam sendo os do histórico inteiro');
  }
});

test('período: o banco devolve o mesmo JSON que a lista, combinado com os outros filtros', () => {
  const variadas = Array.from({ length: 60 }, (_, i) => decisao(100 + i, MEIA_NOITE_17 - (i * 7 * 3600 * 1000),
    { action: ['approve', 'request_changes', 'comment', 'skip'][i % 4], pr: { repo: i % 3 ? 'acme/app' : 'outra/lib', number: i, title: `T ${i}`, author: 'bia' } }));
  const [a, b] = [json(variadas), noBanco(variadas)];
  for (const q of ['desde=2026-11-10', 'ate=2026-11-14', 'desde=2026-11-10&ate=2026-11-12', 'desde=2026-11-10&veredito=skip', 'desde=2026-11-01&repo=outra/lib&page=2&pageSize=3',
    'desde=2026-11-10&q=bia', 'desde=2030-01-01', 'ate=2000-01-01']) {
    const p = new URLSearchParams(q);
    assert.equal(safeStringify(historicoPaginado(b, p)), safeStringify(historicoPaginado(a, p)), q);
  }
});

/* ---------- checks do head e detalhe da revisão ---------- */

const HEAD = 'a'.repeat(40);

test('as provas guardam os checks do head como lidos no fim da revisão', () => {
  const p = provasDaDecisao({ headSha: HEAD, checksVerifiedHead: HEAD, checksObrigatorios: [{ nome: 'e2e', estado: 'rodando' }],
    checksHerdados: [{ nome: 'osv', estado: 'vermelho', naBase: 'vermelho' }], semCheckObrigatorio: false });
  assert.deepEqual(p.checks, { conferidoNoHead: true, semExigencia: false, naoVerdes: [{ nome: 'e2e', estado: 'rodando' }], herdados: [{ nome: 'osv', estado: 'vermelho', naBase: 'vermelho' }] });
  assert.equal(provasDaDecisao({ headSha: HEAD }).checks, null, 'sem leitura de checks não há registro');
  assert.equal(provasDaDecisao({ headSha: HEAD, checksVerifiedHead: 'b'.repeat(40), checksObrigatorios: [] }).checks.conferidoNoHead, false, 'lido em outro commit');
  assert.equal(provasDaDecisao({ headSha: '', checksVerifiedHead: null, checksObrigatorios: [] }).checks.conferidoNoHead, false, 'head desconhecido não conta como conferido');
});

const SID = 'f3b1c0de-0000-4000-8000-000000000001';
// uma linha do diário de uma tentativa de revisão do PR acme/app#7, gravada em `at`
const linha = (at, extra = {}) => ({ id: 'a-1', at, iniciadaEm: at - 420_000, kind: 'review', ref: 'acme/app#7', account: 'revisora', model: 'Opus 4.1',
  costUsd: 2, costSource: 'medido', status: 'ok', inputTokens: 1, outputTokens: 1, accounting: { version: 1, sessionId: SID }, ...extra });

test('a execução soma as tentativas; o que alguma tentativa não sabe fica ausente, sem soma parcial', () => {
  assert.equal(execucaoDasLinhas([]), null);
  assert.deepEqual(execucaoDasLinhas([linha(1_000_000), linha(2_000_000, { iniciadaEm: 1_940_000, costUsd: 0.84, model: 'Sonnet 4.5' })]),
    { tentativas: 2, modelos: ['Opus 4.1', 'Sonnet 4.5'], duracaoMs: 480_000, custoUsd: 2.84, custoEstimado: false });
  assert.equal(execucaoDasLinhas([linha(1_000_000, { costSource: 'estimado' })]).custoEstimado, true);
  assert.equal('duracaoMs' in execucaoDasLinhas([linha(1_000_000), linha(2_000_000, { iniciadaEm: undefined })]), false);
  const semCusto = execucaoDasLinhas([linha(1_000_000), linha(2_000_000, { costSource: 'desconhecido' })]);
  assert.equal('custoUsd' in semCusto, false);
  assert.equal('custoEstimado' in semCusto, false);
  assert.deepEqual(execucaoDasLinhas([linha(1_000_000, { model: 'desconhecido' })]).modelos, []);
});

const HORA = 3_600_000;
const T0 = Date.parse('2026-11-17T12:00:00Z');
// rodada 1 decidida em T0, rodada 2 (retomada no MESMO session_id) decidida em T0 + 2h
const RODADA_1 = { ...decisao(70, T0 + 1000), id: 'r1', key: 'acme/app#7', createdAt: T0, sessionId: SID, reportMarkdown: 'r',
  provas: { checks: { conferidoNoHead: true, semExigencia: false, naoVerdes: [], herdados: [{ nome: 'osv', estado: 'vermelho', naBase: 'vermelho' }] } } };
const RODADA_2 = { ...RODADA_1, id: 'r2', createdAt: T0 + 2 * HORA, resolvedAt: T0 + 2 * HORA + 1000, provas: {} };
const DIARIO = [
  linha(T0 - HORA, { costUsd: 1, status: 'erro', accounting: { sessionId: 'sessao-que-caiu' } }), // tentativa da rodada 1 que caiu, outra sessão
  linha(T0 - 60_000, { costUsd: 2 }),                                  // a rodada 1
  linha(T0 + HORA, { costUsd: 5, iniciadaEm: T0 + HORA - 300_000 }),   // a rodada 2, retomada no mesmo session_id
  linha(T0 + HORA + 10, { costUsd: 7, kind: 'pushback' }),             // outro tipo de sessão do mesmo PR
  linha(T0 + HORA + 20, { costUsd: 9, ref: 'acme/app#8' }),            // outro PR
  linha(T0 + 3 * HORA, { costUsd: 11 }),                               // depois da rodada 2
];
const consulta = (q) => new URLSearchParams(q);

function enginesDoDetalhe(resolvidas, pendentes = []) {
  const doJson = { decisions: { pending: structuredClone(pendentes), resolved: structuredClone(resolvidas) }, usageSessions: { sessions: structuredClone(DIARIO) } };
  const h = abrir();
  for (const r of DIARIO) consumo.inserirSessao(h, r);
  const doBanco = { ...noBanco(resolvidas), telemetria: h };
  doBanco.decisions.pending = structuredClone(pendentes);
  return [doJson, doBanco];
}

test('duas rodadas no mesmo session_id: cada decisão mostra só a própria, com a tentativa que caiu na rodada dela', () => {
  for (const engine of enginesDoDetalhe([RODADA_2, RODADA_1])) {
    const ultima = detalheDaDecisao(engine, consulta('key=acme/app%237'));
    assert.equal(ultima.status, 200);
    assert.equal(ultima.body.decision.id, 'r2');
    assert.deepEqual(ultima.body.decision.execucao, { tentativas: 1, modelos: ['Opus 4.1'], duracaoMs: 300_000, custoUsd: 5, custoEstimado: false });
    assert.equal('checks' in ultima.body.decision, false, 'rodada sem checks gravados');
    const primeira = detalheDaDecisao(engine, consulta('key=acme/app%237&id=r1'));
    assert.equal(primeira.body.decision.id, 'r1');
    assert.deepEqual(primeira.body.decision.execucao, { tentativas: 2, modelos: ['Opus 4.1'], duracaoMs: 840_000, custoUsd: 3, custoEstimado: false });
    assert.deepEqual(primeira.body.decision.checks, { conferidoNoHead: true, semExigencia: false, naoVerdes: [], herdados: [{ nome: 'osv', estado: 'vermelho' }] });
    assert.equal(primeira.body.decision.provas, undefined, 'as provas brutas não saem');
    assert.equal(primeira.body.decision.sessionId, undefined, 'o id da sessão não sai');
  }
});

test('o id pede a resolvida mesmo com uma pendente no PR; id de outro PR ou inexistente é found false', () => {
  const pendente = { ...RODADA_2, id: 'p3', createdAt: T0 + 4 * HORA, status: 'pending', resolvedAt: undefined };
  for (const engine of enginesDoDetalhe([RODADA_2, RODADA_1], [pendente])) {
    assert.equal(detalheDaDecisao(engine, consulta('key=acme/app%237')).body.decision.id, 'p3', 'sem id vale a regra de sempre');
    const r2 = detalheDaDecisao(engine, consulta('key=acme/app%237&id=r2')).body.decision;
    assert.equal(r2.id, 'r2');
    assert.equal(r2.execucao.custoUsd, 5);
    assert.equal(detalheDaDecisao(engine, consulta('key=acme/app%237&id=p3')).body.decision.execucao.custoUsd, 11, 'a pendente soma o que veio depois da r2');
    assert.deepEqual(detalheDaDecisao(engine, consulta('key=acme/app%238&id=r1')).body, { found: false, decision: null });
    assert.deepEqual(detalheDaDecisao(engine, consulta('key=acme/app%237&id=nao')).body, { found: false, decision: null });
  }
});

test('id fora da forma ou repetido vira 400 com o campo', () => {
  const [engine] = enginesDoDetalhe([RODADA_1]);
  for (const q of ['key=acme/app%237&id=a%20b', `key=acme/app%237&id=${'a'.repeat(65)}`, 'key=acme/app%237&id=r1&id=r1', 'key=x&id=%2E%2E%2F']) {
    assert.deepEqual(detalheDaDecisao(engine, consulta(q)), { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'id' } }, q);
  }
  assert.equal(detalheDaDecisao(engine, consulta('key=acme/app%237&id=')).body.decision.id, 'r1', 'id vazio é como ausente');
});

test('a janela: sem anterior começa no início; no teto começa na mais antiga guardada e sai marcada', () => {
  assert.deepEqual(janelaDaDecisao(RODADA_1, [RODADA_2, RODADA_1], false), { ref: 'acme/app#7', desde: null, ate: T0, inicioIncerto: false });
  assert.deepEqual(janelaDaDecisao(RODADA_2, [RODADA_2, RODADA_1], false), { ref: 'acme/app#7', desde: T0, ate: T0 + 2 * HORA, inicioIncerto: false });
  const outra = { ...decisao(1, T0 - 5 * HORA), createdAt: T0 - 5 * HORA };
  assert.deepEqual(janelaDaDecisao(RODADA_1, [RODADA_1, outra], true), { ref: 'acme/app#7', desde: T0 - 5 * HORA, ate: T0, inicioIncerto: true });
  assert.equal(janelaDaDecisao({ key: 'a#1' }, [], false), null, 'sem hora não há janela');
});

test('decisão antiga sem checks gravados sai sem a chave; histórico indisponível tira a execução; chave desconhecida é found false', () => {
  const [engine] = enginesDoDetalhe([{ ...RODADA_1, provas: { checksNaoVerdes: [] } }]);
  const d = detalheDaDecisao(engine, consulta('key=acme/app%237')).body.decision;
  assert.equal('checks' in d, false);
  assert.equal(d.execucao.tentativas, 2);
  const torta = { decisions: { pending: [], resolved: [{ ...RODADA_1, provas: { checks: { conferidoNoHead: 'sim' } } }] } };
  assert.equal('checks' in detalheDaDecisao(torta, consulta('key=acme/app%237')).body.decision, false, 'forma torta não sai');
  const fora = { decisions: { pending: [RODADA_1], resolved: [] }, historicoForaDoBanco: true, usageSessions: { sessions: DIARIO } };
  assert.equal('execucao' in detalheDaDecisao(fora, consulta('key=acme/app%237')).body.decision, false);
  assert.deepEqual(detalheDaDecisao({ decisions: { pending: [], resolved: [] } }, consulta('key=nao/existe%231')).body, { found: false, decision: null });
  assert.deepEqual(detalheDaDecisao({ decisions: { pending: [], resolved: [] } }, consulta('')).body, { found: false, decision: null });
});

/* ---------- números de 30 dias por autor ---------- */

const AGORA = Date.parse('2026-11-17T15:00:00Z');
const DIA = 86400000;
function rodada(key, autor, diasAtras, action) {
  return { id: `${key}-${diasAtras}`, key, createdAt: AGORA - diasAtras * DIA, resolvedAt: AGORA - diasAtras * DIA + 1, action, pr: { author: autor } };
}

test('números de 30 dias: PRs cuja primeira revisão publicada caiu na janela, aprovação de primeira e rodadas', () => {
  const lista = [
    rodada('a/r#1', 'Ana', 10, 'request_changes'), rodada('a/r#1', 'ana', 8, 'approve'),   // 2 rodadas, não de primeira
    rodada('a/r#2', 'ana', 5, 'approve'),                                                // de primeira
    rodada('a/r#3', 'ana', 3, 'skip'), rodada('a/r#3', 'ana', 2, 'comment'),             // o skip não conta: 1 rodada, comentário
    rodada('a/r#4', 'ana', 40, 'request_changes'), rodada('a/r#4', 'ana', 1, 'approve'),  // começou antes da janela: fora
    rodada('a/r#5', 'bia', 29, 'approve'),
    rodada('a/r#6', '', 1, 'approve'), { key: 'a/r#7', action: 'approve', pr: { author: 'bia' } }, null,
  ];
  assert.deepEqual(numerosPorAutor(lista, AGORA), {
    ana: { janelaDias: 30, prs: 3, aprovadosDePrimeira: 1, rodadas: 4 },
    bia: { janelaDias: 30, prs: 1, aprovadosDePrimeira: 1, rodadas: 1 },
  });
});

test('números no teto do histórico: o PR da decisão mais antiga não conta, e os números saem marcados', () => {
  const lista = [rodada('a/r#2', 'ana', 5, 'approve'), rodada('a/r#1', 'ana', 20, 'approve')];
  assert.deepEqual(numerosPorAutor(lista, AGORA, { noTeto: true }), { ana: { janelaDias: 30, prs: 1, aprovadosDePrimeira: 1, rodadas: 1, historicoNoTeto: true } });
  assert.equal(numerosPorAutor(lista, AGORA).ana.prs, 2, 'fora do teto o mesmo PR conta');
});

test('GET /api/team leva os números no autor que os tem; histórico indisponível não leva nenhum', () => {
  const lista = [{ login: 'Ana', name: 'Ana', entries: [] }, { login: 'caio', entries: [] }];
  const numeros = numerosDoTime(json([rodada('a/r#2', 'ana', 5, 'approve')]), AGORA);
  assert.deepEqual(timeComNumeros(lista, numeros), [{ login: 'Ana', name: 'Ana', entries: [], numeros: { janelaDias: 30, prs: 1, aprovadosDePrimeira: 1, rodadas: 1 } }, { login: 'caio', entries: [] }]);
  assert.equal(numerosDoTime({ historicoForaDoBanco: true }), null);
  assert.equal(timeComNumeros(lista, null), lista);
});

/* ---------- consumo por repositório ---------- */

test('o relatório do consumo soma custo e tentativas por repositório, com o sem PR à parte', () => {
  const agora = Date.parse('2026-10-26T16:00:00Z');
  const r = (n, extra) => ({ id: `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at: agora, kind: 'review', account: 'dev', model: 'Opus',
    status: 'ok', inputTokens: 1, outputTokens: 1, costUsd: 1, costSource: 'medido', ...extra });
  const rows = [r(1, { ref: 'org/a#1', costUsd: 2 }), r(2, { ref: 'org/a#2', costUsd: 0.5 }), r(3, { ref: 'org/b#1' }), r(4, { ref: '', kind: 'tool' }),
    r(5, { ref: 'org/b#2', costSource: 'desconhecido', costUsd: 7 }), r(6, { ref: 'org/a#3', at: agora - 60 * DIA })];
  const rel = activityReport([{ device: 'local', rows }], { start: '2026-10-01', end: '2026-10-26' }, agora);
  const por = Object.fromEntries(rel.repos.map((x) => [x.name, [x.attempts, x.costUsd, x.unknownCost]]));
  assert.deepEqual(por, { 'org/a': [2, 2.5, 0], 'org/b': [2, 1, 1], '': [1, 1, 0] });
  const filtrado = activityReport([{ device: 'local', rows }], { start: '2026-10-01', end: '2026-10-26', repo: 'org/b' }, agora);
  assert.deepEqual(filtrado.repos.map((x) => x.name), ['org/b'], 'segue os filtros do relatório');
});

/* ---------- pessoa sem papel ---------- */

test('pessoa cadastrada sem papel nem competência fica, se o login tem forma de login do GitHub', () => {
  assert.deepEqual(parsePeople({ 'Ana-Dev': {}, 'x y': {}, '-a': {}, 'a--b': {}, [`${'a'.repeat(40)}`]: {}, ok: { papel: 'senior' }, nada: null }),
    { 'ana-dev': {}, ok: { papel: 'senior' } });
});
