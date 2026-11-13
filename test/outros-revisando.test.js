// Outra pessoa revisando: o aviso na fila e o gate que ela segura (02/10/2026).
//
// Pedido do dono: "Se caso tiver alguém já com a label de revisando no GitHub, precisamos
// indicar pra quem vê a fila que já tem alguém revisando". Vale o "um Farol por PR" de
// sempre: quem está revisando segura o automático. (A chave que mandava revisar junto
// mesmo assim, e com ela a co-assinatura, saíram no corte da fase 1.)
//
// No mesmo dia apareceu o segundo silêncio da fila: a assinatura do Claude no limite do
// plano segurava a revisão automática até o reset, e o card não dizia nada. O motor passou
// a entregar as duas coisas para a tela; o desenho do card vem do Claude Design.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-revisar-junto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const skip = await import('../lib/engine/skip-review.js');
const { Engine } = await import('../server.js');
const contasGh = (await import('../lib/engine/contas-gh.js')).default;

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor(config = {}) {
  const e = new Engine();
  e.config = { ...e.config, ...config };
  e.outrosRevisando = () => ['ana'];
  e.skipComentado = {};
  return e;
}

test('quem está revisando segura o automático', () => {
  const e = motor();
  assert.deepEqual(skip.outrosQueSeguram(e, { key: 'o/r#1' }), ['ana']);
  const pulados = [];
  assert.equal(e._registraPulo({ key: 'o/r#1' }, pulados), true);
  assert.deepEqual(pulados.map((p) => p.outros), [['ana']]);
});

test('a trava do round automático e a do comando remoto leem a mesma resposta', async () => {
  const fila = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'sync-comandos-fila.js'), 'utf8');
  const review = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  assert.match(fila, /outrosQueSeguram\(engine, pr\)/);
  assert.match(review, /outrosQueSeguram\(engine, pr\)/);
});

test('cada PR leva a lista de quem mais está revisando', () => {
  const e = motor();
  e.outrosRevisando = (pr) => (pr.key === 'o/r#1' ? ['ana', 'bia'] : []);
  const um = { key: 'o/r#1' };
  const dois = { key: 'o/r#2' };
  e.skipComentado = { 'o/r#2': { quem: ['carla'], at: 5, head: 'abc' } };
  skip.anotarOutrosRevisando(e, [um, dois, um, null]);
  assert.deepEqual(um.outrosRevisando, ['ana', 'bia']);
  assert.equal(um.foraDeCena, null);
  assert.deepEqual(dois.outrosRevisando, []);
  assert.deepEqual(dois.foraDeCena, { quem: ['carla'], desde: 5 }, 'só o que a tela usa: nem o head');
});

test('cada conta que a tela recebe diz até quando a assinatura dela está no limite do plano', () => {
  const e = motor();
  e.accountList = () => [{ user: 'eu', owners: [] }, { user: 'outra', owners: [] }];
  e.limiteDoPlanoAte = (conta) => (conta === 'eu' ? 1790985600000 : 0);
  const contas = contasGh.projecaoDasContas(e);
  assert.deepEqual(contas.map((a) => [a.user, a.limitePlanoAte]), [['eu', 1790985600000], ['outra', 0]]);
  assert.deepEqual(e.snapshot().accounts.map((a) => a.limitePlanoAte), [1790985600000, 0], 'e é isso que o snapshot leva');
});
