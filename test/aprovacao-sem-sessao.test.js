// A aprovação sem sessão (24/11/2026), extraída do diff vazio de linhagem para servir também ao
// sync por herança sem nada a ler: quem chama dá o texto, o caminho e a prova; o fluxo (portões,
// dedup por head, reenvio da falha passageira e a prova largada na falha permanente) é um só.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-aprovacao-sem-sessao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const BASE = 'b'.repeat(40);

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(payload);
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { ORIGEM_DIFF_VAZIO } = await import('../lib/technical-review/publication.js');
const { resultadoSemSessao } = await import('../lib/engine/aprovacao-sem-sessao.js');
// a boca do APPROVE mora no diff vazio: é a via de postagem conhecida (test/postagem-fiacao-fonte.test.js)
const { aprovarSemSessao } = await import('../lib/engine/diff-vazio-de-linhagem.js');

after(() => { io.run = runReal; try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { envios = []; gh = { postFalha: '' }; });

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.prEstadoELabels = async () => ({ estado: 'OPEN', labels: [] });
  e.bloqueadoPorChecks = async () => ({ faltando: [], herdados: [], verifiedHead: HEAD });
  e.myReviewStates = async () => [];
  return e;
}

const pr = { key: 'acme/api#5', repo: 'acme/api', number: 5, url: 'https://github.com/acme/api/pull/5', title: 'sync', author: 'dev', requested: true };
const inv = { status: 'complete', reason: '', headSha: HEAD, baseSha: BASE, changedFiles: 1, additions: 1, deletions: 0, files: [{ path: 'a.ts', sha: 'd'.repeat(40) }] };
const desfecho = () => ({ headSha: HEAD, baseSha: BASE, inventarioDiff: inv, extra: { caminho: 'teste' }, corpo: 'Corpo fixo. Aprovo.', relatorio: 'r',
  prova: { diffVazio: { head: HEAD, origem: ORIGEM_DIFF_VAZIO } }, toast: 't' });

test('aprova com o desfecho dado: corpo, extra e a prova na memória', async () => {
  const e = motor();
  const item = await aprovarSemSessao(e, pr, desfecho(), 'a1');
  assert.deepEqual(envios.map((p) => [p.event, p.body, p.commit_id]), [['APPROVE', 'Corpo fixo. Aprovo.', HEAD]]);
  assert.equal(item.caminho, 'teste');
  assert.equal(item.status, 'auto_approved');
  assert.equal(item.inventarioDiff.files.length, 1, 'o inventário do desfecho vai à decisão');
  assert.equal(e.technicalApprovals.get(pr.key).diffVazio.head, HEAD);
});

test('já aprovado neste head: already_reviewed, sem postar', async () => {
  const e = motor();
  e.myReviewStates = async () => ['APPROVED'];
  const item = await aprovarSemSessao(e, pr, desfecho(), 'a2');
  assert.equal(item.status, 'already_reviewed');
  assert.equal(envios.length, 0);
});

test('falha passageira vai ao reenvio com o aviso da aprovação; permanente larga a prova', async () => {
  gh.postFalha = 'HTTP 502: Bad Gateway';
  const e = motor();
  const passageira = await aprovarSemSessao(e, pr, desfecho(), 'a3');
  assert.equal(passageira.status, 'pending');
  assert.equal(passageira.postRetry.event, 'approve');
  assert.equal(passageira.caminho, 'teste');
  assert.ok(e.technicalApprovals.has(pr.key), 'o reenvio ainda precisa da prova');
  gh.postFalha = 'HTTP 422: Unprocessable Entity';
  const outro = motor();
  const permanente = await aprovarSemSessao(outro, { ...pr, key: 'acme/api#6', number: 6 }, desfecho(), 'a4');
  assert.notEqual(permanente.status, 'pending');
  assert.equal(permanente.action, 'skip');
  assert.equal(outro.technicalApprovals.has('acme/api#6'), false);
});

test('resultadoSemSessao monta o resultado completo sem modelo', () => {
  const r = resultadoSemSessao(desfecho(), 'approve', {}, 'x');
  assert.equal(r.analysisStatus, 'complete');
  assert.deepEqual(r.findings, []);
  assert.equal(r.inventarioDiff, inv);
});
