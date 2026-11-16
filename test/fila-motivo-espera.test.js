import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { processHeadless, esperaParaTela } from '../lib/engine/headless-fila.js';
import { queueWaitingCardHtml } from '../ui/pure/radar.js';

beforeEach(t => {
  // A bancada mede memória e vagas de um usuário comum, sem herdar o UID do CI.
  if (typeof process.getuid === 'function') t.mock.method(process, 'getuid', () => 1000);
});
afterEach(() => mock.restoreAll());

const pr = (n, account = 'alice') => ({ key: `acme/app#${n}`, account, title: 'Corrige formulário', author: 'bob' });
function motor() {
  const e = {
    config: { parallelReviews: 1, globalParallelReviews: 2 },
    doctorInfo: { claude: 'pronto' },
    headlessQueue: [pr(1), pr(2)], headlessBusyAccounts: new Map(),
    orgLastStart: new Map(), headlessSeq: 0, iniciadas: [],
    accountForPr: p => p.account, headlessAcct: p => p.account,
    runOneHeadless(p) { e.iniciadas.push(p.key); },
  };
  return e;
}
function detalhes(e) { return esperaParaTela(e).headlessWaitingDetails; }

test('o limite da conta explica a espera sem lançar outra sessão', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  assert.deepEqual(detalhes(e)['acme/app#2'], {
    posicao: 2, total: 2, motivo: 'limite-conta', ocupadas: 1, limite: 1,
  });
  assert.deepEqual(e.iniciadas, []);
  assert.equal(e.headlessBusyAccounts.get('alice'), 1);
});

test('teto global mostra a ocupação efetiva de todas as contas', () => {
  const e = motor();
  e.headlessBusyAccounts = new Map([['alice', 1], ['outra', 1]]);
  processHeadless(e);
  assert.equal(detalhes(e)['acme/app#1'].motivo, 'limite-global');
  assert.equal(detalhes(e)['acme/app#1'].ocupadas, 2);
  assert.deepEqual(e.iniciadas, []);
});

test('ao liberar a conta, o motivo anterior desaparece e as posições são atualizadas', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  e.headlessBusyAccounts.clear();
  processHeadless(e);
  assert.deepEqual(e.iniciadas, ['acme/app#1']);
  assert.equal(detalhes(e)['acme/app#1'], undefined);
  assert.deepEqual(detalhes(e)['acme/app#2'], {
    posicao: 1, total: 1, motivo: 'limite-conta', ocupadas: 1, limite: 1,
  });
});

const mark = { dot: '', chip: '', style: '' };
test('card mostra posição e motivo recebido do agendador', () => {
  const e = motor();
  e.headlessBusyAccounts.set('alice', 1);
  processHeadless(e);
  const html = queueWaitingCardHtml(pr(2), { mark, espera: detalhes(e)['acme/app#2'] });
  assert.match(html, /Posição 2 de 2 na fila local \(ordem de entrada\)/);
  assert.match(html, /Limite de revisões simultâneas desta conta atingido \(1\/1\)/);
  assert.match(html, /alterna organizações/);
  assert.doesNotMatch(html, /act-review|act-ignore/);
});

test('falta de diagnóstico não inventa uma causa nem uma posição', () => {
  const html = queueWaitingCardHtml(pr(1), { mark });
  assert.match(html, /Motivo da espera ainda não confirmado/);
  assert.doesNotMatch(html, /Posição|Limite de revisões simultâneas/);
});
