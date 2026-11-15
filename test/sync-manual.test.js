// O clique manual com a coordenação entre aparelhos ligada (D12 do contrato da
// sincronização). O launchReview faz um preflight só de leitura por PR e devolve os
// bloqueados em `coordenacao: [{ key, reason, detail }]`, sem enfileirar nem tirar da
// fila; a tela confirma e reenvia com o override certo. As regras que este arquivo trava:
//   - semCoordenacao contorna SÓ 'indisponivel', ignorarRecibo contorna SÓ 'recibo';
//   - lease de outro aparelho ('alheio') não tem override (nunca toma execução ativa);
//   - override sem bloqueio correspondente cai (a coordenação normal volta a valer);
//   - override vale pra UMA admissão: retry e fila não herdam o contorno;
//   - "Refazer neste aparelho" apaga o recibo do head atual (condicionado ao etag) e
//     relança pelo clique com o override de recibo;
//   - com a coordenação DESLIGADA o launchReview é o de antes.
//
// Engine real com FAROL_HOME temporário (await import) e o banco no dublê em processo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-manual-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';
import { SYNC } from '../lib/constants.js';
import { accountHash, prHash, operationFingerprint } from '../lib/sync/keys.js';

const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const fanout = (await import('../lib/engine/fanout.js')).default;

const TOKEN = 'tok-ok';
const HEAD = 'c'.repeat(40);
const KEY = 'acme/app#1';
const URL_PR = 'https://github.com/acme/app/pull/1';
let fake;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;
before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  fanout.prMetrics = prMetricsOriginal;
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); });

function motor({ coordenacao = true, preflight = null } = {}) {
  const e = new Engine();
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.token = 'tok-eu';
  e.tokens = { eu: 'tok-eu' };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.pushState = () => { };
  e.on('toast', () => { });
  e.bloqueiaAutomatico = async () => false;
  e.queue = [{ key: KEY, url: URL_PR, repo: 'acme/app', number: 1, author: 'dev' }];
  e.enfileirados = [];
  e.enqueueHeadless = (pr) => { e.enfileirados.push(pr); };
  e.preflights = [];
  if (coordenacao) e.config.sync = { ...e.config.sync, enabled: true, coordination: { enabled: true } };
  if (preflight) e.syncPreflightManual = async (pr) => { e.preflights.push(pr.key); return preflight; };
  return e;
}

const bloqueado = (reason, detail = {}) => ({ ok: false, reason, detail });

test('coordenação desligada: launchReview é o de antes (sem preflight e sem campo novo)', async () => {
  const e = motor({ coordenacao: false, preflight: bloqueado('alheio') });
  const r = await e.launchReview([URL_PR], 'auto', 'clique', { semCoordenacao: true });
  assert.deepEqual(r, { ok: true, mode: 'auto' });
  assert.equal(e.preflights.length, 0);
  assert.equal(e.enfileirados.length, 1);
});

/* ---------- Refazer neste aparelho ---------- */

function cliente() {
  return createRtdbClient({ databaseUrl: fake.url, getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
}

const IDS = { accountHash: accountHash('eu'), prHash: prHash(KEY) };
const FP = operationFingerprint('review', HEAD);

function recibo() {
  return {
    operationKind: 'review', materialVersion: HEAD, deviceId: 'dVelho', leaseId: 'LV', completedAt: 1000,
    lastVerifiedAt: 1000, expiresAt: Date.now() + SYNC.RECEIPT_TTL_MS, outcome: 'completed',
    publicationState: 'pending', reviewId: '', farolVersion: '1.0.0',
  };
}

function reciboNoBanco() {
  const t = fake.tree() || {};
  const r = (((t.users || {}).u1 || {}).receipts || {})[IDS.accountHash];
  return r && r[IDS.prHash] && r[IDS.prHash][FP];
}

function motorConectado() {
  const e = motor();
  e.sync.status = 'conectado';
  e.sync.uid = 'u1';
  e.sync.client = cliente();
  e.sync.recibosVistos[KEY] = { at: 1000, deviceId: 'dVelho', orfao: 'orfao' };
  // o "Refazer" só vale para recibo ÓRFÃO: o aparelho que fez a análise precisa estar
  // parado há mais de ORPHAN_AFTER_MS, senão a prova de uma análise viva seria apagada
  e.sync.devices = { dVelho: { name: 'Velho', lastSeenAt: Date.now() - 2 * SYNC.ORPHAN_AFTER_MS } };
  e.headSha = async () => HEAD;
  e.relancados = [];
  e.launchReview = async (urls, mode, origem, extras) => { e.relancados.push({ urls, mode, origem, extras }); return { ok: true, mode }; };
  return e;
}

// "Refazer" existe para destravar a análise que ficou pela metade num aparelho que
// sumiu. Apagar o recibo de uma análise PUBLICADA jogaria fora a prova dela, e a mesma
// análise seria paga de novo em todo aparelho que a encontrasse.
test('redoReceipt recusa recibo publicado e recibo de aparelho ainda ativo, sem apagar nada', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: { ...recibo(), publicationState: 'published' } } } } } } });
  const e = motorConectado();
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.match(r.motivo, /foi publicada/);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e.relancados.length, 0);

  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e2 = motorConectado();
  e2.sync.devices = { dVelho: { name: 'Velho', lastSeenAt: Date.now() } };
  const r2 = await e2.syncRedoReceipt(KEY);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'conflito');
  assert.match(r2.motivo, /continua ativo/);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e2.relancados.length, 0);
});

test('redoReceipt sem recibo nenhum recusa em vez de relançar', async () => {
  fake.setTree(null);
  const e = motorConectado();
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'nao_encontrado');
  assert.equal(e.relancados.length, 0);
});

// Apagar antes de saber se o clique passaria deixava, com um lease alheio no caminho, o
// recibo destruído e nenhuma análise no lugar dele.
test('redoReceipt não apaga o recibo quando o clique seria barrado por outro motivo', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e = motorConectado();
  e.syncPreflightManual = async () => bloqueado('alheio', { deviceId: 'd9', deviceName: 'Notebook', since: 1, operationKind: 'review' });
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'conflito');
  assert.match(r.motivo, /Notebook/);
  assert.ok(reciboNoBanco(), 'o recibo só some quando o relançamento vai mesmo acontecer');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt não apaga o recibo quando há revisão deste PR em curso neste aparelho', async () => {
  for (const sessao of [{ mode: 'auto', keys: [KEY] }]) {
    fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
    const e = motorConectado();
    e.activeReviews.set('viva', { id: 'viva', ...sessao });
    const r = await e.syncRedoReceipt(KEY);
    assert.equal(r.ok, false, sessao.mode);
    assert.equal(r.code, 'conflito');
    assert.match(r.motivo, /em curso deste PR neste aparelho/);
    assert.ok(reciboNoBanco(), 'o recibo só some quando o relançamento vai mesmo acontecer');
    assert.equal(e.relancados.length, 0);
  }
});

test('redoReceipt sem conexão não toca o banco nem relança', async () => {
  const e = motorConectado();
  e.sync.status = 'erro';
  e.sync.lastError = { code: 'indisponivel', motivo: 'sem rede', at: 1 };
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'indisponivel');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt com a coordenação desligada recusa', async () => {
  const e = motorConectado();
  e.config.sync = { ...e.config.sync, coordination: { enabled: false } };
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'desligado');
  assert.equal(e.relancados.length, 0);
});

test('redoReceipt sem head conhecido não apaga nada', async () => {
  fake.setTree({ users: { u1: { receipts: { [IDS.accountHash]: { [IDS.prHash]: { [FP]: recibo() } } } } } });
  const e = motorConectado();
  e.headSha = async () => '';
  const r = await e.syncRedoReceipt(KEY);
  assert.equal(r.ok, false);
  assert.ok(reciboNoBanco(), 'recibo intacto');
  assert.equal(e.relancados.length, 0);
});

/* ---------- rotas ---------- */

test('rotas: /api/review repassa os overrides só quando === true, e /api/sync/redo responde allowlist', async () => {
  const { startServer } = await import('../lib/http-server.js');
  const e = motor({ coordenacao: false });
  const chamadas = [];
  e.launchReview = async (urls, mode, origem, extras) => { chamadas.push({ urls, mode, origem, extras }); return { ok: true, mode }; };
  e.syncRedoReceipt = async (key) => { chamadas.push({ redo: key }); return { ok: false, code: 'conflito', motivo: 'outro aparelho alterou o mesmo registro', uid: 'u1-que-nao-volta' }; };
  // porta 0: o sistema escolhe uma livre, sem disputar a do Farol que estiver aberto
  e.config.port = 0;
  const server = startServer(e);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo) => {
    const res = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1' }, body: JSON.stringify(corpo || {}) });
    return JSON.parse(await res.text());
  };
  try {
    await post('/api/review', { urls: [URL_PR], semCoordenacao: 'true', ignorarRecibo: true, lote: 'true' });
    assert.deepEqual(chamadas[0], { urls: [URL_PR], mode: 'auto', origem: 'clique', extras: { semCoordenacao: false, ignorarRecibo: true, lote: false } });
    const r = await post('/api/sync/redo', { key: KEY });
    assert.deepEqual(chamadas[1], { redo: KEY });
    assert.deepEqual(r, { ok: false, code: 'conflito', motivo: 'outro aparelho alterou o mesmo registro' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
