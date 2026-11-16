// A classificação de pushback pela sessão de IA (lib/engine/pushback.js): o que o
// classifyPushback manda para a sessão e devolve, e a ordem em que o scanPushbacks grava
// o marcador e o registro.
//
// Engine real com FAROL_HOME temporário (server.js alcança lib/paths.js, então await
// import); gh roteado por io.run e sessão stubada na instância.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-pushback-classificacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
io.run = async () => ({ ok: true, stdout: '', stderr: '' });

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor(resposta) {
  const e = new Engine();
  e.token = 'x';
  e.config.conta = { user: 'eu', owners: ['acme'] };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.opts = [];
  e.runClaudeStream = async (prompt, opts) => { e.opts.push(opts); return resposta; };
  return e;
}

const PB_OK = JSON.stringify({ isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' });

test('classifyPushback abre a sessão com a conta e a referência do PR e devolve a classificação', async () => {
  const e = motor({ text: PB_OK, sessionId: 's1' });
  const pr = { key: 'o/r#2', repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2', author: 'alice', account: 'eu' };
  const cls = await e.classifyPushback(pr, '2026-09-01T10:00:00Z');
  assert.deepEqual(cls, { isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' });
  assert.equal(e.opts.length, 1);
  assert.equal(e.opts[0].ref, 'o/r#2');
  assert.equal(e.opts[0].account, e.accountForPr(pr));
  assert.match(e.opts[0].id, /^pb-/);
});

test('scanPushbacks grava o marcador antes do registro do pushback', async () => {
  const e = motor(null);
  e.decisions = { pending: [], resolved: [{ key: 'o/r#5', status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  e.panorama = [{ key: 'o/r#5', updatedAt: '2026-09-01T12:00:00Z', author: 'alice' }];
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.config.autoPushback = true;
  e.accountForPr = () => 'eu';
  const ordem = [];
  e.savePushbackScanned = () => ordem.push('marcador');
  e.savePushbacks = () => ordem.push('pushback');
  e.detectAuthorPushback = async () => ({ marker: '2026-09-01T11:00:00Z', hadActivity: true });
  const chamadas = [];
  e.classifyPushback = async (pr, marker) => { chamadas.push([pr.key, marker]); return { isPushback: true, outcome: 'we_right', confidence: 'high', note: 'x' }; };
  await e.scanPushbacks();
  assert.deepEqual(chamadas, [['o/r#5', '2026-09-01T11:00:00Z']], 'o marcador chega à classificação');
  assert.deepEqual(ordem, ['marcador', 'pushback']);
  assert.equal(e.pushbackScanned['o/r#5'], '2026-09-01T11:00:00Z');
  assert.equal(e.pushbacks['o/r#5'].outcome, 'we_right');
});

test('classifyPushback sem JSON devolve null', async () => {
  const e = motor({ text: 'nada aqui', sessionId: 's1' });
  assert.equal(await e.classifyPushback({ key: 'o/r#4', url: 'u', author: 'a' }, 'm'), null);
});
