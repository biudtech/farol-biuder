import { criteriaFixture } from './helpers/criteria-fixture.js';
// Retentativa da postagem da revisão automática.
//
// A leitura dos meus reviews do head que falha no GitHub recusa a postagem sem nada ter
// saído. Duas camadas: até 3 retentativas com 2 s entre elas dentro da própria sessão, e,
// se ainda assim não sair, o reenvio dos ciclos seguintes armado. Só para recusa que NÃO
// chegou à rede; o que pode ter chegado ao GitHub nunca repete aqui.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-retentativa-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();

const fanout = (await import('../lib/engine/fanout.js')).default;
const io = (await import('../lib/io.js')).default;
const retentativaMod = (await import('../lib/engine/postagem-retentativa.js')).default;
const { TEMPOS } = await import('../lib/constants.js');

const esperas = [];
const esperarOriginal = retentativaMod.retentativa.esperar;
retentativaMod.retentativa.esperar = async (ms) => { esperas.push(ms); };

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
const runOriginal = io.run;
io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
after(() => {
  fanout.prMetrics = prMetricsOriginal;
  retentativaMod.retentativa.esperar = esperarOriginal;
  io.run = runOriginal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const prDe = (key) => ({ key, repo: key.split('#')[0], number: Number(key.split('#')[1]), url: `https://github.com/${key.replace('#', '/pull/')}`, author: 'dev', requested: true, account: 'eu' });

function envelope(tipo) {
  if (tipo === 'approve') {
    return { protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [], reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.' } } };
  }
  return { protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('request_changes'), analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', cardMet: true, reasons: ['bloqueio real'], reportMarkdown: 'relatório', payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Tem um problema na validação do redirect.' } } };
}

function motor(post, tipo) {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokenFor = () => 'tok-eu';
  e.logs = [];
  e.log = (nivel, msg) => { e.logs.push(`${nivel} ${msg}`); };
  e.prState = async () => 'OPEN';
  e.headSha = async () => HEAD;
  e.fetchPrFiles = async () => [];
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta';
  e.writeMemory = () => { };
  e.myReviewsWithTime = async () => [];
  e.chamadas = [];
  // lista = uma resposta por chamada, e a última se repete; objeto = sempre a mesma
  const fila = Array.isArray(post) ? [...post] : [post];
  e.postReview = async (pr, payload, opcoes) => {
    e.chamadas.push({ payload, opcoes });
    if (fila.length > 1) return fila.shift();
    return fila[0];
  };
  e.runClaudeStream = async () => ({ text: JSON.stringify({ result: JSON.stringify(envelope(tipo)) }), sessionId: 's1' });
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t));
  return e;
}


const DESCONHECIDO = { ok: false, estado: 'nao_enviada', motivo: 'estado-desconhecido', attempted: false, error: 'Não foi possível conferir as decisões deste commit no GitHub.' };
const NA_REDE = { ok: false, attempted: true, error: 'gh: HTTP 502' };
const FECHADO = { ok: false, blocked: 'pr_fechado', attempted: false, estado: 'MERGED', error: 'o PR já foi mergeado, então o review não foi postado' };
const OK = { ok: true };

for (const tipo of ['approve', 'request_changes']) {
  test(`${tipo}: estado desconhecido duas vezes e depois sai; espera 2 s entre as tentativas`, async () => {
    esperas.length = 0;
    const e = motor([DESCONHECIDO, DESCONHECIDO, OK], tipo);
    await e.runHeadlessReview(prDe('o/r#10'));
    assert.equal(e.chamadas.length, 3);
    assert.deepEqual(esperas, [TEMPOS.POSTAGEM_RETENTATIVA_MS, TEMPOS.POSTAGEM_RETENTATIVA_MS]);
    assert.equal(TEMPOS.POSTAGEM_RETENTATIVA_MS, 2000);
    assert.equal(e.decisions.pending.some((d) => d.key === 'o/r#10'), false, 'saiu, então não sobra pendência');
  });

  test(`${tipo}: no máximo 3 retentativas; depois vira pendência com o reenvio dos ciclos armado`, async () => {
    esperas.length = 0;
    const e = motor(DESCONHECIDO, tipo);
    await e.runHeadlessReview(prDe('o/r#11'));
    assert.equal(e.chamadas.length, 4, 'a primeira e mais 3');
    assert.equal(esperas.length, 3);
    const item = e.decisions.pending.find((d) => d.key === 'o/r#11');
    assert.ok(item);
    assert.equal(item.postRetry && item.postRetry.event, tipo, 'o retryFailedPosts reenvia nos próximos ciclos');
  });
}

test('falha que chegou à rede nunca repete dentro da sessão: pode ter chegado ao GitHub', async () => {
  esperas.length = 0;
  const e = motor(NA_REDE, 'approve');
  await e.runHeadlessReview(prDe('o/r#12'));
  assert.equal(e.chamadas.length, 1);
  assert.equal(esperas.length, 0);
});

// infra-aws#366, 18/11/2026: o APPROVE falhou com HTTP 500 do GitHub, a falha era classificada
// como permanente e nenhum reenvio foi armado; o PR foi mesclado 8 minutos depois sem o review.
test('HTTP 500 do GitHub na postagem não repete na sessão e arma o reenvio dos ciclos seguintes', async () => {
  esperas.length = 0;
  const e = motor({ ok: false, attempted: true, error: 'gh: Unprocessable Entity (HTTP 500) · An internal error occurred, please try again.' }, 'approve');
  await e.runHeadlessReview(prDe('o/r#14'));
  assert.equal(e.chamadas.length, 1, 'pode ter chegado ao GitHub: quem repete é o reenvio, que confere o head antes');
  assert.equal(esperas.length, 0);
  const item = e.decisions.pending.find((d) => d.key === 'o/r#14');
  assert.equal(item && item.postRetry && item.postRetry.event, 'approve');
});

test('PR fechado não repete nem arma reenvio', async () => {
  esperas.length = 0;
  const e = motor(FECHADO, 'request_changes');
  await e.runHeadlessReview(prDe('o/r#13'));
  assert.equal(e.chamadas.length, 1);
  assert.equal(esperas.length, 0);
  const item = e.decisions.pending.find((d) => d.key === 'o/r#13');
  assert.ok(!(item && item.postRetry));
});

test('falhaPassageira: só a recusa que não chegou à rede e cuja causa passa sozinha', () => {
  const { falhaPassageira } = retentativaMod;
  assert.equal(falhaPassageira(DESCONHECIDO), true);
  assert.equal(falhaPassageira({ ...DESCONHECIDO, attempted: true }), false);
  assert.equal(falhaPassageira({ ...DESCONHECIDO, motivo: 'outro-motivo' }), false);
  assert.equal(falhaPassageira(NA_REDE), false);
  assert.equal(falhaPassageira(FECHADO), false);
  assert.equal(falhaPassageira(OK), false);
  assert.equal(falhaPassageira(null), false);
});
