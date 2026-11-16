// O bloqueio do GitHub tem que APARECER. Antes disto ele existia só no farol.log, e a
// tela seguia exibindo o panorama velho como se fosse o de agora: 38 bloqueios medidos na
// máquina do Wanderson em poucos dias, nenhum visível para quem olhava o painel.
// Aqui fica a projeção do motor (`buscasPausadas`, que vai no snapshot); o aviso é do front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import limiteGh from '../lib/engine/limite-gh.js';

/* ---------- a projeção que alimenta a tela ---------- */

test('buscasPausadas projeta as contas paradas, e só elas', () => {
  const agora = 1_000_000;
  const engine = { limitesDeBuscaGh: new Map([['ana', agora + 60_000], ['bia', agora - 1]]) };
  const fora = limiteGh.buscasPausadas(engine, agora);
  assert.deepEqual(fora, [{ conta: 'ana', ate: agora + 60_000 }],
    'prazo vencido não é bloqueio: a conta volta a buscar sozinha');
});

test('buscasPausadas devolve lista vazia quando ninguém está parado', () => {
  assert.deepEqual(limiteGh.buscasPausadas({}), []);
});

test('buscasPausadas ordena pela conta que volta primeiro', () => {
  const agora = 1_000_000;
  const engine = { limitesDeBuscaGh: new Map([['ana', agora + 90_000], ['bia', agora + 30_000]]) };
  assert.deepEqual(limiteGh.buscasPausadas(engine, agora).map(x => x.conta), ['bia', 'ana']);
});
