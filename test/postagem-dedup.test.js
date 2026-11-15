// Postagem sem coordenação entre aparelhos (Review Focus 4 do plano da fase 1): dois ciclos
// seguidos no mesmo PR e no mesmo head postam UMA vez só. O `gh` de mentira guarda o que foi
// escrito em `/reviews` e devolve isso na leitura dos meus reviews, como o GitHub faria.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-dedup-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const CORPO = 'Leitura atenta, tudo certo por aqui.';
const ESTADO = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' };

// O "GitHub" do teste: os reviews que a conta já tem no PR e quantas escritas chegaram.
let noGithub = [];
let escritas = 0;
const runReal = io.run;
io.run = async (cmd, args) => {
  const a = [...(args || [])];
  const i = a.indexOf('--input');
  if (cmd === 'gh' && i >= 0 && a[1] === 'repos/o/r/pulls/1/reviews') {
    escritas++;
    const enviado = JSON.parse(fs.readFileSync(a[i + 1], 'utf8'));
    noGithub.push({ state: ESTADO[enviado.event], submitted_at: new Date().toISOString(), commit_id: enviado.commit_id || HEAD, body: enviado.body });
    return { ok: true, code: 0, stdout: `{"id":${escritas}}`, stderr: '' };
  }
  if (cmd === 'gh' && a[1] === 'repos/o/r/pulls/1/reviews') return { ok: true, code: 0, stdout: JSON.stringify(noGithub), stderr: '' };
  return { ok: true, code: 0, stdout: '[]', stderr: '' };
};
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { noGithub = []; escritas = 0; });

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'tok-eu';
  e.token = 'tok-eu';
  e.refreshTokens = async () => { };
  e.ghEnv = () => ({});
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.writeMemory = () => { };
  e.skipComentado = {};
  return e;
}

const aprovacao = () => ({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD });
const pedido = () => ({ event: 'REQUEST_CHANGES', body: 'O teste do caso de borda ainda falha.', comments: [], commit_id: HEAD });

test('dois postReview seguidos no mesmo PR e head: uma escrita em /reviews, a segunda não duplica', async () => {
  const e = motor();
  const primeira = await e.postReview(PR, aprovacao(), { via: 'revisao' });
  const segunda = await e.postReview(PR, aprovacao(), { via: 'revisao' });
  assert.equal(primeira.ok, true);
  assert.equal(primeira.deduped, undefined);
  assert.equal(segunda.ok, true);
  assert.equal(segunda.deduped, true);
  assert.equal(escritas, 1);
  assert.equal(noGithub.length, 1);
});

test('dois postReview disparados juntos no mesmo PR e head: a fila por PR deixa passar um só', async () => {
  const e = motor();
  const [a, b] = await Promise.all([
    e.postReview(PR, aprovacao(), { via: 'revisao' }),
    e.postReview(PR, aprovacao(), { via: 'revisao' }),
  ]);
  assert.equal(a.ok && b.ok, true);
  assert.equal([a, b].filter(r => r.deduped).length, 1);
  assert.equal(escritas, 1);
});

test('segundo ciclo depois de reiniciar (sem a memória do processo): o GitHub já tem o review do head, devolve já revisado', async () => {
  await motor().postReview(PR, aprovacao(), { via: 'revisao' });
  const segunda = await motor().postReview(PR, aprovacao(), { via: 'revisao' });
  assert.equal(segunda.ok, true);
  assert.equal(segunda.deduped, true);
  assert.equal(segunda.alreadyReviewed, true);
  assert.equal(escritas, 1);
});

test('head já decidido: o veredito contrário do ciclo seguinte também não é escrito', async () => {
  const e = motor();
  await e.postReview(PR, aprovacao(), { via: 'revisao' });
  const segunda = await e.postReview(PR, pedido(), { via: 'revisao' });
  assert.equal(segunda.ok, true);
  assert.equal(segunda.alreadyReviewed, true);
  assert.equal(escritas, 1);
  assert.deepEqual(noGithub.map(r => r.state), ['APPROVED']);
});

test('sem conseguir ler os reviews do head, o ciclo automático não posta às cegas', async () => {
  const e = motor();
  e.myReviewStates = async () => null;
  const r = await e.postReview(PR, aprovacao(), { via: 'revisao' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'estado-desconhecido');
  assert.equal(escritas, 0);
});

function pendencia(extra = {}) {
  return {
    id: 'd1', key: PR.key, createdAt: 1, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: PR.url, author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: aprovacao() }, ...extra,
  };
}

test('leitura dos reviews indisponível também segura o reenvio automático', async () => {
  const reenvio = motor();
  reenvio.myReviewStates = async () => null;
  reenvio.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  assert.equal(await reenvio.retryFailedPosts(), 0);
  assert.equal(escritas, 0);
  assert.equal(reenvio.decisions.pending.length, 1, 'a pendência segue na mesa para o próximo ciclo');
});

test('reenvio e clique de um head que já tem o meu review não escrevem de novo', async () => {
  await motor().postReview(PR, aprovacao(), { via: 'revisao' });
  const reenvio = motor();
  reenvio.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  assert.equal(await reenvio.retryFailedPosts(), 1);
  const clique = motor();
  clique.decisions.pending = [pendencia()];
  assert.equal((await clique.decide('d1', 'approve')).ok, true);
  assert.equal(escritas, 1);
});
