// A checagem em andamento no Radar (17/11/2026, lib/engine/checagem-em-curso.js): a contagem das
// organizações buscadas no ciclo, a busca da vez, o empurrão do estado no máximo uma vez por
// segundo e a chave `checagem` do snapshot, que só existe com o ciclo em curso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarChecagem, buscarOrganizacao, checagemParaTela, INTERVALO_MS } from '../lib/engine/checagem-em-curso.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-checagem-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

function motorDeMentira(respostas = {}) {
  const engine = { checking: true, empurroes: [], buscas: [] };
  engine.pushState = () => engine.empurroes.push(checagemParaTela(engine));
  engine.searchPRs = async (args, user) => {
    engine.buscas.push({ args, user, durante: checagemParaTela(engine) });
    if (respostas[args[1]] === 'falha') return null;
    return [];
  };
  return engine;
}

test('conta as organizações de todas as contas e diz qual está sendo buscada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10 * INTERVALO_MS });
  const engine = motorDeMentira({ biudtech: 'falha' });
  iniciarChecagem(engine, [{ user: 'revisor', owners: ['biudtech', 'outra'] }, { user: 'x', owners: ['terceira'] }]);
  assert.deepEqual(checagemParaTela(engine), { total: 3, feitas: 0 });
  await buscarOrganizacao(engine, 'biudtech', 'revisor');
  assert.deepEqual(engine.buscas[0], { args: ['--owner', 'biudtech'], user: 'revisor', durante: { total: 3, feitas: 0, agora: 'biudtech' } });
  // a busca que falhou também conta: o ciclo segue para a próxima
  assert.deepEqual(checagemParaTela(engine), { total: 3, feitas: 1, agora: 'biudtech' });
  await buscarOrganizacao(engine, 'outra', 'revisor');
  await buscarOrganizacao(engine, 'terceira', 'x');
  // com todas buscadas, a da vez sai e a contagem fica no total
  assert.deepEqual(checagemParaTela(engine), { total: 3, feitas: 3 });
});

test('empurra o estado no máximo uma vez por segundo, e o atrasado leva o valor mais novo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10 * INTERVALO_MS });
  const engine = motorDeMentira();
  iniciarChecagem(engine, [{ user: 'r', owners: ['a', 'b', 'c'] }]);
  assert.equal(engine.empurroes.length, 1);
  await buscarOrganizacao(engine, 'a', 'r');
  await buscarOrganizacao(engine, 'b', 'r');
  // dentro do mesmo segundo: nenhum empurrão a mais, um relógio só esperando
  assert.equal(engine.empurroes.length, 1);
  t.mock.timers.tick(INTERVALO_MS);
  assert.equal(engine.empurroes.length, 2);
  assert.deepEqual(engine.empurroes[1], { total: 3, feitas: 2, agora: 'b' });
  t.mock.timers.tick(INTERVALO_MS * 5);
  assert.equal(engine.empurroes.length, 2);
  await buscarOrganizacao(engine, 'c', 'r');
  // passou mais de um segundo do último: o primeiro passo da busca empurra na hora, o fim espera
  assert.equal(engine.empurroes.length, 3);
  t.mock.timers.tick(INTERVALO_MS);
  assert.deepEqual(engine.empurroes.at(-1), { total: 3, feitas: 3 });
});

test('fora do ciclo a chave vai null, e o snapshot da Engine a leva', () => {
  const engine = motorDeMentira();
  iniciarChecagem(engine, [{ owners: ['a'] }]);
  engine.checking = false;
  assert.equal(checagemParaTela(engine), null);
  assert.equal(checagemParaTela(null), null);
  assert.equal(checagemParaTela({ checking: true }), null);
  const real = new Engine();
  assert.equal(real.snapshot().checagem, null);
  real.checking = true;
  real.checagemEmCurso = { total: 2, feitas: 1, agora: 'biudtech' };
  assert.deepEqual(real.snapshot().checagem, { total: 2, feitas: 1, agora: 'biudtech' });
});

test('conta sem organização e lista torta dão total zero', () => {
  const engine = motorDeMentira();
  iniciarChecagem(engine, [{ owners: null }, null]);
  assert.deepEqual(checagemParaTela(engine), { total: 0, feitas: 0 });
  iniciarChecagem(engine, undefined);
  assert.deepEqual(checagemParaTela(engine), { total: 0, feitas: 0 });
});

// Revisão independente (17/11/2026): a contagem do ciclo anterior não aparece no novo, nem fica
// depois que o ciclo termina, inclusive quando ele cai antes de começar a contar.
test('check() zera a contagem no começo e no fim do ciclo, mesmo quando o ciclo cai', async () => {
  const real = new Engine();
  real.schedule = () => {};
  real.log = () => {};
  real.checagemEmCurso = { total: 3, feitas: 3 };
  let vistoNoCiclo;
  real._coletarPanorama = async () => { vistoNoCiclo = real.snapshot().checagem; throw new Error('gh fora'); };
  await real.check('manual');
  assert.equal(vistoNoCiclo, null, 'no começo do ciclo a contagem velha já saiu');
  assert.equal(real.checagemEmCurso, null);
  assert.equal(real.snapshot().checagem, null);
  real._coletarPanorama = async () => { iniciarChecagem(real, [{ owners: ['a'] }]); throw new Error('caiu no meio'); };
  await real.check('manual');
  assert.equal(real.checagemEmCurso, null, 'o fim do ciclo também zera');
});
