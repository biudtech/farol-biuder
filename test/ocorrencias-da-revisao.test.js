// As ocorrências da revisão (24/11/2026): toda revisão que termina sem publicar e sem decisão no
// histórico deixa um registro durável (a tabela `ocorrencias` do banco da telemetria, ou a memória
// sem o banco) e uma linha INFO no farol.log, com o motivo em português e a origem.
//
// O caso que motivou: biudtech/guia-do-selo#64. A sessão caiu por SIGABRT, o retry foi segurado
// por uma aprovação de gente no head, o dono clicou "tentar novamente", a revisão parou nas fontes
// e o PR foi mergeado antes de a sessão abrir. Nada disso deixou rastro: nem log, nem consumo,
// nem banco.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { criteriaFixture } from './helpers/criteria-fixture.js';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-ocorrencias-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = 'a'.repeat(40);
const HEAD_NOVO = 'b'.repeat(40);
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
// o gh desta suíte: pedido aberto à conta, PR aberto no head, nenhum review
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (sub.includes('--json reviewRequests,reviews')) return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ reviewRequests: [{ __typename: 'User', login: 'eu' }], reviews: [] }) };
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, labels: [] }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const banco = await import('../lib/telemetria/banco.js');
const ocorrenciasDb = await import('../lib/telemetria/ocorrencias.js');
const oc = (await import('../lib/engine/ocorrencias-da-revisao.js')).default;
const { iniciarConsumo, fecharTelemetria } = await import('../lib/engine/telemetria-do-motor.js');
const { pendentes } = await import('../lib/engine/telemetria-pendentes.js');
const reviewMod = (await import('../lib/engine/review.js')).default;
const vigia = (await import('../lib/engine/vigia-sessao.js')).default;
const falhas = (await import('../lib/engine/falhas.js')).default;
const { registrarRecusaNaBoca } = await import('../lib/engine/skip-review.js');
const { repescarRetry } = await import('../lib/engine/review-retry.js');
const { fechadoAntesDaFila } = await import('../lib/engine/estado-antes-da-fila.js');
const { usageDaRota } = await import('../lib/engine/usage-activity.js');
const { activityDay } = await import('../lib/usage/activity.js');
const { LOG_FILE } = await import('../lib/paths.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  io.run = runReal;
  fanout.prMetrics = prMetricsOriginal;
  banco.fecharTodos();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const PR = (n, marcas = { requested: true }) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', ...marcas });

// motor mínimo, sem banco: as ocorrências ficam em memória; o log é capturado
function motorDeBolso() {
  const linhas = [];
  return { linhas, log: (nivel, msg) => linhas.push(`[${nivel}] ${msg}`), retryAfterNet: new Map(), autoReviewParked: new Set(), parkedMotivos: {}, saveAutoReviewParked() { }, marcarDesfecho: () => true };
}

let sessoes;
beforeEach(() => { sessoes = 0; });

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'] };
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.on('toast', () => { });
  e.writeInflight = () => { };
  e.runClaudeStream = async () => {
    sessoes += 1;
    return { sessionId: 's1', text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] }, findings: [],
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } }, reportMarkdown: '# ok',
    }) };
  };
  return e;
}

const linhasDoLog = () => (fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n') : []);

/* ---------- a tabela ---------- */

test('a migração 3 cria a tabela ocorrencias com o índice por hora, e o teto poda as mais antigas', () => {
  const pasta = fs.mkdtempSync(path.join(FAROL_HOME, 'b-'));
  const h = banco.abrirBanco(path.join(pasta, 'telemetria.db'));
  try {
    assert.equal(banco.VERSAO_DO_ESQUEMA, 3);
    assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, 3);
    const indices = h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ocorrencias'").all().map((r) => r.name);
    assert.ok(indices.includes('ocorrencias_por_at'));
    for (let i = 1; i <= 5; i++) ocorrenciasDb.inserirOcorrencia(h, { at: i * 1000, ref: `o/r#${i}`, tipo: 'nao_iniciada', motivo: 'pr_mergeado', texto: 't', origem: 'fila' }, 3);
    assert.equal(ocorrenciasDb.contarOcorrencias(h), 3);
    const lidas = ocorrenciasDb.ocorrenciasEntre(h, 0, 10_000, 10);
    assert.deepEqual(lidas.map((r) => r.ref), ['o/r#5', 'o/r#4', 'o/r#3'], 'da mais nova para a mais antiga; as mais antigas saíram');
    assert.equal(lidas[0].origem, 'fila', 'o campo sem coluna volta de extra, sem perda');
    assert.deepEqual(ocorrenciasDb.ocorrenciasEntre(h, 3500, 4500, 10).map((r) => r.ref), ['o/r#4'], 'só o período');
  } finally { banco.fecharBanco(h); }
});

/* ---------- o registro ---------- */

test('com o banco: grava a linha, escreve uma linha INFO no farol.log e a leitura do período a traz', () => {
  const e = new Engine();
  iniciarConsumo(e);
  try {
    e.telemetria.db.exec('DELETE FROM ocorrencias');
    const r = oc.registrarOcorrencia(e, { pr: PR(1, { manual: true, headLido: HEAD }), tipo: 'nao_iniciada', motivo: 'pr_mergeado', etapa: 'fila' });
    assert.equal(r.texto, 'A revisão não chegou a abrir a sessão do Claude: o PR já tinha sido mergeado.');
    assert.equal(r.origem, 'clique');
    const linha = e.telemetria.db.prepare('SELECT * FROM ocorrencias').get();
    assert.equal(linha.ref, 'acme/app#1');
    assert.equal(linha.tipo, 'nao_iniciada');
    assert.equal(linha.motivo, 'pr_mergeado');
    const log = linhasDoLog().filter((l) => l.includes('acme/app#1') && l.includes('terminou sem publicar'));
    assert.equal(log.length, 1, 'uma linha por ocorrência');
    assert.match(log[0], /\[INFO\].*o PR já tinha sido mergeado.*origem: clique/);
    const lidas = oc.ocorrenciasDoPeriodo(e, 0, Date.now() + 1000);
    assert.deepEqual(lidas, [{ at: r.at, ref: 'acme/app#1', tipo: 'nao_iniciada', motivo: 'pr_mergeado', texto: r.texto, origem: 'clique', head: HEAD, etapa: 'fila' }]);
  } finally { fecharTelemetria(e); }
});

test('o banco recusa: a ocorrência fica na fila, a leitura já a mostra, e entra na gravação seguinte', () => {
  const e = new Engine();
  iniciarConsumo(e);
  try {
    const db = e.telemetria.db;
    db.exec('DELETE FROM ocorrencias');
    db.exec("CREATE TRIGGER disco_cheio BEFORE INSERT ON ocorrencias BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;");
    oc.registrarOcorrencia(e, { pr: PR(2), tipo: 'encerrada', motivo: 'commit_novo' });
    assert.equal(pendentes(e, 'ocorrencias').length, 1);
    assert.deepEqual(oc.ocorrenciasDoPeriodo(e, 0, Date.now() + 1000).map((o) => o.ref), ['acme/app#2']);
    db.exec('DROP TRIGGER disco_cheio');
    oc.registrarOcorrencia(e, { pr: PR(3), tipo: 'encerrada', motivo: 'ja_revisado' });
    assert.equal(pendentes(e, 'ocorrencias').length, 0);
    assert.deepEqual(db.prepare('SELECT ref FROM ocorrencias ORDER BY seq').all().map((l) => l.ref), ['acme/app#2', 'acme/app#3']);
  } finally { fecharTelemetria(e); }
});

test('sem o banco: fica em memória com teto de 200; tipo ou motivo fora do catálogo não grava; nunca lança', () => {
  const e = motorDeBolso();
  for (let i = 0; i < 205; i++) oc.registrarOcorrencia(e, { pr: PR(i), tipo: 'sem_resultado', motivo: 'falha_permanente' });
  assert.equal(e.ocorrenciasEmMemoria.length, 200);
  assert.equal(e.ocorrenciasEmMemoria[0].ref, 'acme/app#5', 'as mais antigas saem');
  assert.equal(oc.registrarOcorrencia(e, { pr: PR(1), tipo: 'inventado', motivo: 'pr_mergeado' }), null);
  assert.equal(oc.registrarOcorrencia(e, { pr: PR(1), tipo: 'encerrada', motivo: 'inventado' }), null);
  assert.equal(oc.registrarOcorrencia({ get ocorrenciasEmMemoria() { throw new Error('x'); }, telemetria: null }, { pr: PR(1), tipo: 'encerrada', motivo: 'commit_novo' }), null);
  const lidas = oc.ocorrenciasDoPeriodo(e, 0, Date.now() + 1000, { repo: 'outro/repo' });
  assert.deepEqual(lidas, [], 'o filtro do repositório é exato');
  assert.equal(oc.ocorrenciasDoPeriodo(e, 0, Date.now() + 1000, { repo: 'acme/app' }).length, 200);
});

test('a origem vem dos sinais do PR, e o detalhe sai sem segredo', () => {
  assert.equal(oc.origemDe({ manual: true }), 'clique');
  assert.equal(oc.origemDe({ manual: true, lote: true }), 'lote');
  assert.equal(oc.origemDe({ manual: true, automaticRetry: true }), 'retentativa');
  assert.equal(oc.origemDe({ rodadaAutomatica: true }), 'commit_novo');
  assert.equal(oc.origemDe({ gatilho: 'commit_novo' }), 'commit_novo');
  assert.equal(oc.origemDe({ gatilho: 'rodada_extra' }), 'rodada_extra');
  assert.equal(oc.origemDe({ requested: true }), 'fila');
  const e = motorDeBolso();
  const r = oc.registrarOcorrencia(e, { pr: PR(1), tipo: 'sem_resultado', motivo: 'falha_permanente', detalhe: { classe: 'x', erro: `falhou com ghp_${'a'.repeat(36)}` } });
  assert.doesNotMatch(r.erro, /ghp_a{36}/);
});

/* ---------- os ganchos ---------- */

test('PR mergeado antes da fila: não abre sessão e registra nao_iniciada com o motivo', async () => {
  const e = motor();
  e.log = () => { };
  e.prState = async () => 'MERGED';
  await e.runOneHeadless(PR(10), 'eu');
  assert.equal(sessoes, 0);
  const [o] = e.ocorrenciasEmMemoria;
  assert.deepEqual([o.ref, o.tipo, o.motivo, o.origem], ['acme/app#10', 'nao_iniciada', 'pr_mergeado', 'fila']);
  const f = motorDeBolso();
  Object.assign(f, { prState: async () => 'CLOSED', emit() { } });
  assert.equal(await fechadoAntesDaFila(f, PR(11)), true);
  assert.equal(f.ocorrenciasEmMemoria[0].motivo, 'pr_fechado');
  Object.assign(f, { prState: async () => { throw new Error('rede'); } });
  assert.equal(await fechadoAntesDaFila(f, PR(12)), false, 'falta de dado nunca cancela');
  assert.equal(f.ocorrenciasEmMemoria.length, 1);
});

// o caso real: clique do dono, fontes preparadas, PR mergeado antes de a sessão abrir
test('conferência antes de abrir a sessão: PR mergeado nas fontes lança cancelado, cai no abandono do vigia e não abre sessão', async () => {
  const e = motor();
  e.log = () => { };
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  e.prState = async () => 'OPEN';
  e.prEstadoELabels = async () => ({ estado: 'MERGED', labels: [] });
  let cancelamentos = 0;
  e.cancelSession = () => { cancelamentos += 1; };
  const pr = PR(20, { manual: true, requested: false });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(sessoes, 0, 'a sessão do Claude nem abriu');
  assert.equal(cancelamentos, 0, 'não há sessão para cancelar');
  assert.equal(vigia.abandonoDe(e, pr.key), '', 'o tratarAbandonoDoVigia consumiu o abandono');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'abandono do vigia não estaciona');
  assert.ok(toasts.some((t) => t.includes('mergeado ou fechado')), 'o toast do abandono do vigia saiu');
  const [o] = e.ocorrenciasEmMemoria;
  assert.deepEqual([o.tipo, o.motivo, o.origem, o.etapa], ['nao_iniciada', 'pr_mergeado', 'clique', 'antes_da_sessao']);
  assert.match(o.sessao, /^a-/, 'o id da revisão que não abriu');
  assert.equal(e.ocorrenciasEmMemoria.length, 1, 'uma ocorrência só');
});

test('conferência antes de abrir a sessão: leitura que falha nunca abandona, e o clique revisa um head já revisado', async () => {
  const e = motor();
  e.log = () => { };
  e.prState = async () => 'OPEN';
  e.prEstadoELabels = async () => { throw new Error('rede'); };
  e.headSha = async () => HEAD;
  e.myReviewStates = async () => ['APPROVED'];
  e.postReview = async () => ({ ok: true });
  await e.runOneHeadless(PR(21, { manual: true, requested: false }), 'eu');
  assert.equal(sessoes, 1);
  assert.equal(e.ocorrenciasEmMemoria, undefined);
  const f = motorDeBolso();
  Object.assign(f, { headSha: async () => HEAD, prEstadoELabels: async () => ({ estado: 'OPEN', labels: [] }), myReviewStates: async () => ['APPROVED'] });
  await assert.rejects(vigia.conferirAntesDeAbrir(f, PR(22), 'a-1', HEAD), (err) => err.cancelled === true);
  assert.equal(vigia.abandonoDe(f, 'acme/app#22'), vigia.MOTIVOS.REVISADO);
  assert.equal(f.ocorrenciasEmMemoria[0].motivo, 'ja_revisado');
  assert.deepEqual(await vigia.conferirAntesDeAbrir(f, PR(23, { manual: true }), 'a-2', HEAD), { abandonar: false, motivo: '' });
});

test('vigia durante a sessão: commit novo, já revisado e PR fechado viram encerrada; label retirada fica para o estacionamento', async () => {
  const casos = [
    [{ headSha: async () => HEAD_NOVO }, 'commit_novo'],
    [{ myReviewStates: async () => ['CHANGES_REQUESTED'] }, 'ja_revisado'],
    [{ prEstadoELabels: async () => ({ estado: 'CLOSED', labels: [] }) }, 'pr_fechado'],
    [{ prEstadoELabels: async () => ({ estado: 'MERGED', labels: [] }) }, 'pr_mergeado'],
  ];
  for (const [stub, motivo] of casos) {
    const f = Object.assign(motorDeBolso(), {
      headSha: async () => HEAD, prEstadoELabels: async () => ({ estado: 'OPEN', labels: ['eu:revisando'] }), myReviewStates: async () => [],
      pushActivity() { }, cancelSession() { }, activeReviews: new Map([['a-9', { etapa: 'codigo' }]]),
    }, stub);
    await vigia.conferir(f, PR(30), 'a-9', HEAD, () => 'eu:revisando');
    const [o] = f.ocorrenciasEmMemoria;
    assert.deepEqual([o.tipo, o.motivo, o.sessao, o.etapa], ['encerrada', motivo, 'a-9', 'codigo'], motivo);
    assert.ok(f.linhas.some((l) => l.startsWith('[INFO]') && l.includes('acme/app#30')), motivo);
  }
  const f = Object.assign(motorDeBolso(), {
    headSha: async () => HEAD, prEstadoELabels: async () => ({ estado: 'OPEN', labels: [] }), myReviewStates: async () => [],
    pushActivity() { }, cancelSession() { },
  });
  assert.equal((await vigia.conferir(f, PR(31), 'a-9', HEAD, () => 'eu:revisando')).motivo, vigia.MOTIVOS.LABEL);
  assert.equal(f.ocorrenciasEmMemoria, undefined, 'a label retirada é registrada pelo estacionar');
});

test('estacionar registra cancelado, label retirada, esgotado e falha; outro tipo não', () => {
  const e = motorDeBolso();
  reviewMod.estacionar(e, 'acme/app#40', 'cancelada por você', 'cancelado', HEAD, undefined, PR(40, { manual: true }));
  reviewMod.estacionar(e, 'acme/app#41', 'a label de revisão foi retirada do PR', 'label-retirada', HEAD, undefined, PR(41));
  e.retryAfterNet.set('acme/app#42', { tries: 3, pr: PR(42, { automaticRetry: true }) });
  reviewMod.estacionar(e, 'acme/app#42', 'ECONNRESET ao falar com a API', 'esgotado', HEAD, 'a-42');
  reviewMod.estacionar(e, 'acme/app#43', 'Claude Code process exited with code 1', 'falha', HEAD, 'a-43', PR(43));
  reviewMod.estacionar(e, 'acme/app#44', 'x', 'outro', HEAD);
  const vistos = e.ocorrenciasEmMemoria.map((o) => [o.ref, o.tipo, o.motivo, o.origem]);
  assert.deepEqual(vistos, [
    ['acme/app#40', 'encerrada', 'cancelada_por_voce', 'clique'],
    ['acme/app#41', 'encerrada', 'label_retirada', 'fila'],
    ['acme/app#42', 'sem_resultado', 'tentativas_esgotadas', 'retentativa'],
    ['acme/app#43', 'sem_resultado', 'falha_permanente', 'fila'],
  ]);
  const esgotado = e.ocorrenciasEmMemoria[2];
  assert.equal(esgotado.sessao, 'a-42');
  assert.equal(esgotado.classe, 'rede');
  assert.equal(esgotado.erro, 'ECONNRESET ao falar com a API');
  // esgotado e falha permanente já têm o ERROR do runOneHeadless: a ocorrência não escreve outra linha
  assert.equal(e.linhas.filter((l) => l.startsWith('[INFO]')).length, 2);
});

test('queda da sessão: a passageira vira interrompida com a classe; a permanente fica para o estacionamento', () => {
  const e = Object.assign(motorDeBolso(), { accountForPr: () => 'eu' });
  const err = Object.assign(new Error('ECONNRESET: socket hang up'), { sessaoFarol: 'a-50', etapas: { totalMs: 9, stages: [{ id: 'fontes', label: 'Fontes', ms: 9 }] } });
  falhas.registrarFalhaDaRevisao(e, PR(50, { automaticRetry: true }), err, 'review', true);
  const [o] = e.ocorrenciasEmMemoria;
  assert.deepEqual([o.tipo, o.motivo, o.sessao, o.classe, o.retentativa, o.origem, o.etapa], ['interrompida', 'sessao_caiu', 'a-50', 'rede', true, 'retentativa', 'fontes']);
  falhas.registrarFalhaDaRevisao(e, PR(51), new Error('Claude Code process exited with code 1'), 'review');
  // a passageira que não vai ao retry (teto de tentativas) fica para o `sem_resultado` do estacionamento
  falhas.registrarFalhaDaRevisao(e, PR(52), Object.assign(new Error('ECONNRESET: socket hang up'), { sessaoFarol: 'a-52' }), 'review', false);
  assert.equal(e.ocorrenciasEmMemoria.length, 1);
  assert.equal(e.linhas.filter((l) => l.startsWith('[INFO]')).length, 0, 'a queda já tem o WARN do runOneHeadless');
});

// revisão independente de 24/11/2026: a última queda gravava "vai ser tentada de novo" e, logo
// depois, "tentativas esgotadas", para o mesmo evento
test('queda passageira no teto de tentativas: só sem_resultado, sem a interrompida que promete retry', async () => {
  for (const [tries, esperado] of [[0, [['interrompida', 'sessao_caiu']]], [3, [['sem_resultado', 'tentativas_esgotadas']]]]) {
    const e = motor();
    e.log = () => { };
    e.prState = async () => 'OPEN';
    e.prEstadoELabels = async () => ({ estado: 'OPEN', labels: [] });
    e.headSha = async () => HEAD;
    e.myReviewStates = async () => [];
    e.runClaudeStream = async () => { sessoes += 1; throw new Error('ECONNRESET: socket hang up'); };
    const pr = PR(70 + tries);
    if (tries) e.retryAfterNet.set(pr.key, { tries, pr });
    await e.runOneHeadless(pr, 'eu');
    assert.deepEqual((e.ocorrenciasEmMemoria || []).map((o) => [o.tipo, o.motivo]), esperado, `tentativas=${tries}`);
  }
});

test('recusa na boca: pedido retirado e decisão de gente viram nao_iniciada', () => {
  const e = motorDeBolso();
  assert.equal(registrarRecusaNaBoca(e, PR(60), true, null), true);
  assert.equal(registrarRecusaNaBoca(e, PR(61), false, { bloqueado: true, head: HEAD, decisivos: [] }), true);
  assert.equal(registrarRecusaNaBoca(e, PR(62), false, null), false);
  assert.deepEqual(e.ocorrenciasEmMemoria.map((o) => [o.ref, o.tipo, o.motivo]), [
    ['acme/app#60', 'nao_iniciada', 'pedido_retirado'], ['acme/app#61', 'nao_iniciada', 'decisao_de_gente'],
  ]);
});

test('retentativa segurada por gente no head ou com o PR mergeado: a entrada morre e fica a ocorrência', async () => {
  const e = Object.assign(motorDeBolso(), {
    retryTargets: () => [PR(70), PR(71)], emit() { }, enqueueHeadless() { }, markSeen() { }, queue: [],
    prState: async (pr) => (pr.number === 70 ? 'MERGED' : 'OPEN'), bloqueiaAutomatico: async () => true,
  });
  e.retryAfterNet.set('acme/app#70', { tries: 1, pr: PR(70) });
  e.retryAfterNet.set('acme/app#71', { tries: 1, pr: PR(71) });
  await repescarRetry(e, [], new Set());
  assert.equal(e.retryAfterNet.size, 0);
  assert.deepEqual(e.ocorrenciasEmMemoria.map((o) => [o.ref, o.motivo, o.origem]), [
    ['acme/app#70', 'pr_mergeado', 'retentativa'], ['acme/app#71', 'decisao_de_gente', 'retentativa'],
  ]);
});

/* ---------- a rota ---------- */

test('GET /api/usage traz as ocorrências do período e do repositório; o CSV não', async () => {
  const e = new Engine();
  iniciarConsumo(e);
  try {
    e.telemetria.db.exec('DELETE FROM ocorrencias');
    const hoje = activityDay(Date.now());
    ocorrenciasDb.inserirOcorrencia(e.telemetria, { at: Date.now() - 40 * 86_400_000, ref: 'acme/app#80', tipo: 'nao_iniciada', motivo: 'pr_mergeado', texto: 'antiga', origem: 'fila' }, 5000);
    oc.registrarOcorrencia(e, { pr: PR(81, { headLido: HEAD }), tipo: 'sem_resultado', motivo: 'falha_permanente', detalhe: { classe: 'x', erro: 'boom' } });
    oc.registrarOcorrencia(e, { pr: { ...PR(82), key: 'outro/repo#82' }, tipo: 'encerrada', motivo: 'commit_novo' });
    const r = await usageDaRota(e, new URLSearchParams(`start=${hoje}&end=${hoje}`));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.ocorrencias.map((o) => o.ref), ['outro/repo#82', 'acme/app#81'], 'só as do período, da mais nova');
    const doRepo = await usageDaRota(e, new URLSearchParams(`start=${hoje}&end=${hoje}&repo=acme/app`));
    assert.deepEqual(doRepo.body.ocorrencias.map((o) => o.ref), ['acme/app#81']);
    const [o] = doRepo.body.ocorrencias;
    assert.deepEqual(Object.keys(o).sort(), ['at', 'classe', 'head', 'motivo', 'origem', 'ref', 'texto', 'tipo'].sort(), 'só os campos do contrato, sem o erro');
    const periodoLongo = await usageDaRota(e, new URLSearchParams(''));
    assert.ok(!periodoLongo.body.ocorrencias.some((x) => x.ref === 'acme/app#80'), 'fora dos 30 dias padrão');
    const csv = await usageDaRota(e, new URLSearchParams(`start=${hoje}&end=${hoje}&formato=csv`));
    assert.doesNotMatch(csv.csv, /terminou sem publicar|falha_permanente/);
  } finally { fecharTelemetria(e); }
});
