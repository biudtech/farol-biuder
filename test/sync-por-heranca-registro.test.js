// A marca de sincronização e o registro da decisão no sync por herança (24/11/2026): com a
// herança medida antes da sessão, a marca `sincronizacao` vem dela (o head de trabalho `sync/*`
// também fica limpo), e a decisão guarda o caminho, a origem, a foto e as contagens.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-registro-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let chamadas = [];
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  chamadas.push(sub);
  if (sub.startsWith('api graphql') && sub.includes('associatedPullRequests')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ number: 7, headRefName: 'production', baseRefName: 'development', isCrossRepository: false, total: 1,
      commits: [{ oid: 'a'.repeat(40), prs: [{ number: 3, base: 'production' }] }] }) };
  }
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { checksEEstadoDoPr } = await import('../lib/engine/estado-desmentido.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { sincronizacaoDoSync, extraDoSync } = await import('../lib/engine/registro-do-sync.js');
const { FOTO } = await import('./helpers/github-do-sync.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const gateReason = (text) => ({ text, kind: 'gate' });
const pr = { key: 'acme/api#7', repo: 'acme/api', number: 7, url: 'https://github.com/acme/api/pull/7', title: 'Sync', author: 'dev', requested: true };
const herancaDoSync = { origem: 'homologation', destino: 'development', foto: FOTO, commits: 4, herdados: ['src/b.ts'], lidos: 1, contextoAlterado: [] };
const resultAprovado = { analysisStatus: 'complete', verdict: 'approve', findings: [], reasons: [], payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
let e;
let logs;

beforeEach(() => {
  chamadas = [];
  logs = [];
  e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => {};
  e.pushState = () => {};
  e.writeMemory = () => {};
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'token-falso';
  e.log = (nivel, texto) => logs.push(`${nivel} ${texto}`);
  e.bloqueadoPorChecks = async () => ({ faltando: [], herdados: [], verifiedHead: 'b'.repeat(40) });
});

test('com a herança do sync, a marca sincronizacao vem da medição e a consulta de depois não roda', async () => {
  const result = { verdict: 'approve', decision: 'needs_decision', cardMet: false, findings: [], approvalEvidence: [], reasons: [], herancaDoSync };
  await checksEEstadoDoPr(e, pr, result, gateReason);
  assert.deepEqual(result.sincronizacao, { origem: 'homologation', destino: 'development', commits: 4, heranca: { foto: FOTO, herdados: 1, lidos: 1 } });
  assert.equal(chamadas.filter((c) => c.includes('associatedPullRequests')).length, 0);
  assert.deepEqual(attentionPoints(e, { ...result, decision: 'auto_approve', reasons: [] }), []);
});

test('sem a herança, a consulta de hoje continua decidindo', async () => {
  const result = { verdict: 'approve', findings: [], reasons: [] };
  await checksEEstadoDoPr(e, pr, result, gateReason);
  assert.ok(chamadas.some((c) => c.includes('associatedPullRequests')));
  assert.deepEqual(result.sincronizacao, { origem: 'production', destino: 'development', commits: 1 });
});

test('sincronizacaoDoSync recusa marca torta', () => {
  assert.equal(sincronizacaoDoSync({}), null);
  assert.equal(sincronizacaoDoSync({ herancaDoSync: { origem: 'x' } }), null);
});

test('a decisão leva o caminho e as contagens, projetados para a tela, com uma linha INFO', () => {
  const d = e.recordDecision(pr, { ...resultAprovado, herancaDoSync }, { status: 'auto_approved', action: 'approve' });
  assert.equal(d.caminho, 'sync_por_heranca');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 1, lidos: 1 });
  assert.equal(logs.filter((l) => l.startsWith('INFO') && l.includes('caminho sync_por_heranca')).length, 1);
});

test('extra com caminho já dado vence e não loga', () => {
  const d = e.recordDecision(pr, { ...resultAprovado, herancaDoSync }, { status: 'auto_approved', action: 'approve', caminho: 'sync_por_heranca_sem_sessao' });
  assert.equal(d.caminho, 'sync_por_heranca_sem_sessao');
  assert.equal(logs.filter((l) => l.includes('caminho sync_por_heranca')).length, 0);
  assert.deepEqual(extraDoSync(e, pr, { ...resultAprovado }, {}), {}, 'sem a marca, nada');
});
