// A lista de falhas do Diagnostico estava ilegivel (23/09/2026).
//
// Medido na máquina do dono: 19 registros, dos quais 15 sao o MESMO limite de plano
// no MESMO PR (biud-frontend#1050), um por tentativa entre 17:12 e 18:02. Cada um vira um
// cartao inteiro e ABERTO na tela (titulo, chip, "o que fazer", bloco com hora, sessao,
// referencia e o texto cru, mais o botao de copiar), entao quatro falhas ocupam a tela
// inteira e as duas que pedem acao ficam enterradas.
//
// Duas causas, uma correcao cada:
//   1. a fusao de repeticao so acontecia na ESCRITA, e esses 15 sao anteriores a ela. Quem
//      le passa a fundir pela MESMA regra, entao o historico antigo colapsa junto;
//   2. o cartao nascia aberto. Passa a nascer fechado, com uma linha de resumo, EXCETO a
//      falha que precisa de voce: essa e a que pede acao, e esconder seria o defeito.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-falhas-poluicao-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const falhasMod = (await import('../lib/engine/falhas.js')).default;
const diag = (await import('../lib/engine/diagnostico.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const BASE = Date.parse('2026-09-17T20:12:41Z');
const MOTIVO_LIMITE = 'sessão retornou erro: You' + "'" + 've hit your weekly limit · resets 2am (America/Sao_Paulo)';

// o registro real que repetiu 15 vezes
const limite = (i) => ({
  id: 'f' + i, at: BASE + i * 60000, kind: 'pushback', classe: 'limite-plano',
  ref: 'biudtech/biud-frontend#1050', account: 'contabiuder', motivo: MOTIVO_LIMITE,
});
const invalido = (i) => ({
  id: 'r' + i, at: BASE + i * 60000, kind: 'review', classe: 'resultado-invalido',
  ref: 'biudtech/tenant-company#126', account: 'contabiuder',
  motivo: 'revisão não concluída: a sessão terminou sem entregar o resultado estruturado',
  sessionId: 'a-21b64dbd-2fb0-4e4f-b92d-da78c7c9e775',
});

function engineCom(registros) {
  const e = new Engine();
  e.log = () => { };
  e.falhasSessao = registros;
  return e;
}

/* ---------- 1) a repetição antiga colapsa na leitura ---------- */

test('15 registros idênticos viram UMA linha, com a contagem e desde quando', () => {
  const e = engineCom(Array.from({ length: 15 }, (_, i) => limite(i)));
  const lidas = falhasMod.falhasRecentes(e, { limite: 50 });
  assert.equal(lidas.length, 1, '15 cartões iguais eram 15 cópias da mesma notícia');
  assert.equal(lidas[0].ocorrencias, 15);
  assert.equal(lidas[0].primeiraAt, BASE, 'a contagem começa na PRIMEIRA vez');
  assert.equal(lidas[0].at, BASE + 14 * 60000, 'e a linha fala da última');
});

test('falha que PRECISA DE VOCÊ nunca funde: cada uma tem sessão própria para investigar', () => {
  const e = engineCom([invalido(0), invalido(1)]);
  assert.equal(falhasMod.falhasRecentes(e, { limite: 50 }).length, 2);
});

test('a leitura funde pela MESMA regra da escrita: PR diferente é falha diferente', () => {
  const e = engineCom([limite(0), { ...limite(1), ref: 'biudtech/engine-ai#216' }, limite(2)]);
  const lidas = falhasMod.falhasRecentes(e, { limite: 50 });
  assert.equal(lidas.length, 2);
  assert.deepEqual(lidas.map(f => f.ocorrencias || 1).sort(), [1, 2]);
});

test('o limite pedido conta LINHAS da tela, não registros crus', () => {
  const e = engineCom([...Array.from({ length: 15 }, (_, i) => limite(i)), invalido(99)]);
  const lidas = falhasMod.falhasRecentes(e, { limite: 2 });
  assert.equal(lidas.length, 2, 'duas notícias, e não duas cópias da mesma');
  assert.equal(lidas[0].classe, 'resultado-invalido', 'a mais recente primeiro');
});

test('a projeção da tela herda a fusão', () => {
  const e = engineCom(Array.from({ length: 15 }, (_, i) => limite(i)));
  const tela = diag.falhasParaTela(e);
  assert.equal(tela.length, 1);
  assert.equal(tela[0].ocorrencias, 15);
});
