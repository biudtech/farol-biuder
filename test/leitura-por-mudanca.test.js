// A leitura que só se repete quando o PR mudou (lib/engine/leitura-por-mudanca.js). É ela que
// poupa a leitura de head novo a cada ciclo (rereview-stale.js), e a regra que não pode
// quebrar é esta: falha de leitura nunca fica guardada como se fosse a resposta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerSeMudou } from '../lib/engine/leitura-por-mudanca.js';

const PR = { key: 'biudtech/engine-ai#314', updatedAt: '2026-10-05T10:00:00Z' };
const valida = (v) => !!(v && v.head);

test('mesmo updatedAt: a segunda leitura sai do cache, sem chamar de novo', async () => {
  const engine = {};
  let lidas = 0;
  const ler = async () => { lidas += 1; return { head: 'h1' }; };
  assert.deepEqual(await lerSeMudou(engine, 'stale', PR, ler, valida), { head: 'h1' });
  assert.deepEqual(await lerSeMudou(engine, 'stale', PR, ler, valida), { head: 'h1' });
  assert.equal(lidas, 1);
});

test('falha de leitura não fica guardada: o ciclo seguinte tenta de novo', async () => {
  const engine = {};
  let lidas = 0;
  let falhar = true;
  const ler = async () => { lidas += 1; return falhar ? { head: '' } : { head: 'h1' }; };
  assert.deepEqual(await lerSeMudou(engine, 'stale', PR, ler, valida), { head: '' });
  falhar = false;
  assert.deepEqual(await lerSeMudou(engine, 'stale', PR, ler, valida), { head: 'h1' }, 'a resposta inválida não virou cache');
  assert.equal(lidas, 2);
});

test('updatedAt novo relê; item sem updatedAt nunca entra no cache', async () => {
  const engine = {};
  let lidas = 0;
  const ler = async () => { lidas += 1; return { head: `h${lidas}` }; };
  await lerSeMudou(engine, 'stale', PR, ler, valida);
  assert.deepEqual(await lerSeMudou(engine, 'stale', { ...PR, updatedAt: '2026-10-05T11:00:00Z' }, ler, valida), { head: 'h2' });
  const semData = { key: 'biudtech/engine-ai#315' };
  await lerSeMudou(engine, 'stale', semData, ler, valida);
  await lerSeMudou(engine, 'stale', semData, ler, valida);
  assert.equal(lidas, 4);
});
