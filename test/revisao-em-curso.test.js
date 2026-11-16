// Uma revisão local por PR (lib/engine/revisao-em-curso.js): o pedido de revisão de um PR que
// já está na fila headless, na janela anterior ao spawn ou com sessão ativa é recusado como
// duplicado, e o resto do lote segue. A sessão de terminal, que também segurava o PR, saiu no
// corte da fase 1 (lote 12); os casos daqui são os da revisão headless.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-revisao-em-curso-'));
process.env.FAROL_HOME = root;
const { Engine } = await import('../server.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const pr = numero => ({ key: `org/repo#${numero}`, url: `https://github.com/org/repo/pull/${numero}`,
  repo: 'org/repo', number: numero, author: 'dev', account: 'eu', requested: true });

function motor() {
  const engine = new Engine();
  engine.token = 'token-de-teste';
  engine.config.conta = { user: 'eu', owners: ['org'] };
  engine.seen = new Set();
  engine.headlessIniciando = new Set();
  engine.pushState = () => {};
  engine.writeInflight = () => {};
  engine.log = () => {};
  engine.checkNow = () => {};
  // a fila fica parada: o que entra nela continua lá, e a admissão e a exclusão são reais
  engine.processHeadless = () => {};
  engine.bloqueiaAutomatico = async () => false;
  engine.queue = [pr(1), pr(2)];
  return engine;
}

const naFila = e => e.headlessQueue.map(p => p.key);

test('revisão em curso impede outra revisão do mesmo PR', async () => {
  const e = motor();
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, true);
  const segunda = await e.launchReview([pr(1).url], 'auto', 'clique');
  assert.equal(segunda.ok, false);
  assert.deepEqual(segunda.duplicados, [pr(1).key]);
  assert.deepEqual(e.enqueueHeadless(pr(1)), { ok: false, code: 'duplicado' });
  assert.deepEqual(naFila(e), [pr(1).key], 'uma entrada só na fila');
});

test('o clique respeita o headless enfileirado, iniciando e ativo, incluindo caixa diferente no nome', async () => {
  for (const fase of ['fila', 'inicio', 'ativo']) {
    const e = motor();
    if (fase === 'fila') e.headlessQueue.push(pr(1));
    if (fase === 'inicio') e.headlessIniciando.add(pr(1).key);
    if (fase === 'ativo') e.activeReviews.set('headless', { mode: 'auto', keys: ['ORG/Repo#1'] });
    const antes = e.headlessQueue.length;
    const r = await e.launchReview([pr(1).url], 'auto', 'clique');
    assert.equal(r.ok, false, fase);
    assert.deepEqual(r.duplicados, [pr(1).key]);
    assert.equal(e.headlessQueue.length, antes, `${fase}: nada novo na fila`);
    assert.equal(e.queue.some(p => p.key === pr(1).key), true);
    assert.equal(e.seen.has(pr(1).key), false);
  }
});

test('dois pedidos simultâneos do mesmo PR: só um entra na fila', async () => {
  const e = motor();
  const respostas = await Promise.all([
    e.launchReview([pr(1).url], 'auto', 'clique'),
    e.launchReview([pr(1).url], 'auto', 'clique'),
  ]);
  assert.equal(respostas.filter(r => r.ok).length, 1);
  assert.deepEqual(naFila(e), [pr(1).key]);
});

test('lote parcial segue com PR livre e não repete URL duplicada no mesmo comando', async () => {
  const e = motor();
  e.activeReviews.set('headless', { mode: 'auto', keys: [pr(1).key] });
  const r = await e.launchReview([pr(1).url, pr(2).url, pr(2).url], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.deepEqual(naFila(e), [pr(2).key]);
  assert.equal(e.queue.some(p => p.key === pr(1).key), true);
});

test('sessão que termina libera o PR para outra revisão', async () => {
  const e = motor();
  e.activeReviews.set('headless', { id: 'headless', mode: 'auto', keys: [pr(1).key] });
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, false);
  e.activeReviews.delete('headless');
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, true);
  assert.deepEqual(naFila(e), [pr(1).key]);
});

test('regra manual mantém a recusa', async () => {
  const e = motor();
  e.config.conta.reviewRules = { org: { mode: 'manual' } };
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'auto')).ok, false);
  assert.equal((await e.launchReview([pr(1).url], 'auto', 'clique')).ok, true);
});

test('cancelar sessão que não existe ou não é cancelável é recusado, sem soltar o PR', () => {
  const e = motor();
  e.activeReviews.set('sem-run', { id: 'sem-run', mode: 'auto', keys: [pr(1).key] });
  assert.equal(e.cancelSession('sem-run').ok, false);
  assert.equal(e.activeReviews.has('sem-run'), true);
  assert.equal(e.cancelSession('nao-existe').ok, false);
  assert.deepEqual(e.enqueueHeadless({ ...pr(1) }), { ok: false, code: 'duplicado' });
});

test('outra revisão do mesmo PR continua recusada com a revisão automática ativa', () => {
  const e = motor();
  e.activeReviews.set('headless', { id: 'headless', mode: 'auto', keys: [pr(1).key] });
  assert.deepEqual(e.enqueueHeadless({ ...pr(1) }), { ok: false, code: 'duplicado' });
  e.activeReviews.delete('headless');
  assert.notDeepEqual(e.enqueueHeadless({ ...pr(1) }), { ok: false, code: 'duplicado' });
});

test('outra revisão do mesmo PR continua recusada com ele na fila, e outro PR segue livre', () => {
  const e = motor();
  e.headlessQueue.push(pr(1));
  assert.deepEqual(e.enqueueHeadless({ ...pr(1), key: 'ORG/Repo#1' }), { ok: false, code: 'duplicado' });
  assert.notDeepEqual(e.enqueueHeadless({ ...pr(2) }), { ok: false, code: 'duplicado' }, 'outro PR segue livre');
});

test('a identidade do PR é canônica dos dois lados: fila ou revisão ativa em caixa diferente do pedido', () => {
  const e = motor();
  e.headlessQueue.push({ ...pr(1), key: 'ORG/Repo#1' });
  assert.deepEqual(e.enqueueHeadless({ ...pr(1) }), { ok: false, code: 'duplicado' }, 'fila em maiúsculas, pedido em minúsculas');
  const ativa = motor();
  ativa.activeReviews.set('headless', { id: 'headless', mode: 'auto', keys: ['ORG/Repo#1'] });
  assert.deepEqual(ativa.enqueueHeadless({ ...pr(1) }), { ok: false, code: 'duplicado' }, 'revisão ativa em maiúsculas');
});
