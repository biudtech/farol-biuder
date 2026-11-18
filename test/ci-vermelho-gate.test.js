// Check OBRIGATÓRIO vermelho no head nunca sai como APPROVE sozinho, em nenhuma
// política. Caso medido (biudtech/biud-frontend#896, 02/09/2026): a sessão devolveu
// needs_decision e escreveu no relatório que o merge estava travado pelo ruleset, e a
// política de "aprovável com ressalvas" aprovou por cima, porque a regra de CI só
// existia no prompt. Três minutos depois o PR foi mergeado por bypass de admin com o
// `audit` vermelho. O gate mora em shouldAutoApprove, no mesmo padrão de coverageGap e
// checkpointGap: PURO, só olha `result.checksObrigatorios`, que runHeadlessReview
// preenche com o `faltando` do bloqueadoPorChecks antes de chamar o gate.
//
// 30/09/2026: o gate continuava NÃO aprovando com CI vermelho ou em andamento, com espera
// automática (lib/engine/espera-ci.js). 17/11/2026, regra do dono: o revisor nunca espera o CI,
// nem para aprovar. O CI vermelho, rodando ou não lido não segura o gate em configuração
// nenhuma: o merge continua barrado pelo GitHub onde o check é obrigatório no ruleset, e o card
// da aprovação diz com que CI ela saiu. Dependência em aberto é ressalva.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-ci-vermelho-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { provenResult } = await import('./helpers/technical-proof.js');

const { checksVermelhos } = await import('../lib/engine/decision.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return provenResult({
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  });
}

function engineWithPolicy(policy) {
  const e = new Engine();
  e.config.autoApproveAll = true;
  // um config antigo com a chave ligada não religa a espera
  e.config.aguardarCiParaAprovar = true;
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

// 30/09/2026: a política da conta é a ÚNICA coisa que decide entre postar e esperar você, e
// ela responde por CLASSE (limpo = nenhum ponto de atenção; com ressalvas = um ou mais).
function enginePorClasse(limpo, comRessalvas) {
  const e = engineWithPolicy('approve');
  e.approvePolicyFor = (_conta, semPontos) => (semPontos ? limpo : comRessalvas);
  return e;
}

test('checksVermelhos: só o estado vermelho conta; rodando e ausente não provam reprovação', () => {
  assert.deepEqual(checksVermelhos({}), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: null }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'lint', estado: 'rodando' }, { nome: 'build', estado: 'ausente' }] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }, { nome: 'test', estado: 'rodando' }] }), ['audit']);
});

test('obrigatório vermelho não segura o APPROVE: o revisor nunca espera o CI', () => {
  const e = engineWithPolicy('approve');
  // o envelope real do #896: verdict approve, needs_decision, ressalvas, e audit vermelho
  const r = approvableResult({
    decision: 'needs_decision', cardMet: null,
    reasons: [{ text: 'audit obrigatório em FAILURE', kind: 'content' }],
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: true, motivo: null });
  assert.deepEqual(e.shouldAutoApprove(PR, approvableResult({ checksObrigatorios: [{ nome: 'build', estado: 'vermelho' }] })), { ok: true, motivo: null });
});

test('check ainda rodando, que nem começou ou não conferido no head também não segura', () => {
  const e = engineWithPolicy('approve');
  for (const extra of [{ checksObrigatorios: [{ nome: 'test', estado: 'rodando' }] }, { checksObrigatorios: [{ nome: 'e2e', estado: 'ausente' }] },
    { checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }, { nome: 'test', estado: 'rodando' }] }, { checksVerifiedHead: null }]) {
    assert.deepEqual(e.shouldAutoApprove(PR, approvableResult(extra)), { ok: true, motivo: null }, JSON.stringify(extra));
  }
});

// De 27 a 30/09/2026 a dependência em aberto devolvia { ok: false, motivo: 'dependencia' } em
// qualquer política; de 16 a 17/10/2026 (PR #244) era lacuna obrigatória. Desde 17/10/2026 é
// de novo ressalva com o texto da dependência: a dependência aberta costuma ser o PR irmão do
// mesmo card, também esperando aprovação. Até 17/11/2026 a conta em espera a segurava (motivo
// `politica`); o `wait` saiu, e nem o stub antigo segura mais.
test('dependência em aberto declarada pela revisão é ressalva e não segura o APPROVE', () => {
  const r = approvableResult({ dependenciasAbertas: ['biudtech/infra-k8s#189 ainda aberto'] });
  assert.deepEqual(enginePorClasse('approve', 'approve').shouldAutoApprove(PR, r), { ok: true, motivo: null });
  assert.deepEqual(enginePorClasse('approve', 'wait').shouldAutoApprove(PR, r), { ok: true, motivo: null });
  const pts = enginePorClasse('approve', 'approve').attentionPoints(r);
  assert.equal(pts.length, 1);
  assert.match(pts[0].text, /depende de algo que estava em aberto na leitura: biudtech\/infra-k8s#189 ainda aberto/);
  const e = enginePorClasse('approve', 'approve');
  assert.deepEqual(e.attentionPoints(approvableResult({ dependenciasAbertas: [] })), [], 'lista vazia é limpo');
  assert.deepEqual(e.attentionPoints(approvableResult({ dependenciasAbertas: ['', '   ', 7] })), [], 'item vazio ou torto não conta');
});

test('o estado do CI vira nota do card, sem texto de espera', async () => {
  const gate = await import('../lib/engine/gate-espera.js');
  assert.equal('textoDaEspera' in gate, false, 'o texto de espera do CI saiu com a espera');
  assert.equal(gate.motivoDeEspera({ dependenciasAbertas: ['x'] }), null);
  assert.deepEqual(gate.avisoDoCi({ checksObrigatorios: [] }), []);
  assert.deepEqual(gate.avisoDoCi({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] }), [{ text: 'check obrigatório vermelho no head (audit)', kind: 'gate' }]);
  assert.match(gate.avisoDaAprovacao({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] })[0].text, /aprovado com check obrigatório vermelho no head \(audit\)/);
});

test('campo ausente (leitura que falhou, repo sem exigência) não inventa CI vermelho', () => {
  const e = engineWithPolicy('approve');
  assert.equal(e.shouldAutoApprove(PR, approvableResult()).ok, true);
  assert.equal(e.shouldAutoApprove(PR, approvableResult({ checksObrigatorios: [] })).ok, true);
});

test('reprovar sozinho não é afetado: CI vermelho não impede REQUEST_CHANGES', () => {
  const e = engineWithPolicy('approve');
  const r = {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', reasons: [],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'bloqueio real' } },
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  };
  assert.equal(e.shouldAutoReject(PR, r), true);
});
