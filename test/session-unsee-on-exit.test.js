// Fechar uma sessão de terminal desfaz o "visto" dos PRs dela, mesmo sem
// saber se a revisão foi de fato postada — é seguro (GitHub já exclui quem revisou da
// lista de pendentes), e sem isso um PR fica escondido da fila pra sempre se a sessão
// fechar sem o /pr-review ter rodado até o fim (achado de bug real, ver o comentário em
// lib/engine/session.js).
// IMPORTANTE: o teste de spawnConsolePosix (mais abaixo) grava um script .command
// de verdade dentro de HOME/sessions - fixar FAROL_HOME num diretório temporário ANTES
// de qualquer require que carregue lib/paths.js (const de nível de módulo, lida uma
// única vez no load), senão o teste escreve dentro do ~/.farol real da máquina (mesmo
// padrão de test/boot.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-unsee-'));
process.env.FAROL_HOME = FAROL_HOME;
fs.mkdirSync(path.join(FAROL_HOME, 'workspace'), { recursive: true });

// Só a abertura de processo é substituída: abrir um terminal visível, mesmo com
// `exit 0`, deixa janelas residuais do emulador de terminal em rodadas repetidas.
// Os scripts e o ciclo de vida da sessão continuam sendo exercitados de verdade.
import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  assert.ok(spawnImpl, 'teste de sessão não pode abrir um terminal real');
  return spawnImpl(...args);
};
import { EventEmitter } from 'node:events';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { spawnConsolePosix, sessionExit, handleSessionExit } = await import('../lib/engine/session.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const LANCADOR = { cmd: 'x-terminal-emulator', args: ['-e'], nome: 'x-terminal-emulator' };

function fakeEngine(overrides) {
  const unseen = [];
  const toasts = [];
  const engine = Object.assign({
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeConfigDir() { return ''; },
    ghEnv() { return { ...process.env }; },
    activeReviews: new Map(),
    sessionSeq: 0,
    unsee(key) { unseen.push(key); },
    checkNow() { this.checkedNow = true; },
    pushState() {},
    emit(kind, payload) { toasts.push({ kind, payload }); },
    log() {},
    buildSessionScript(slash, id, user) { return '#!/bin/bash\nexit 0\n'; }, // script minimo valido
    handleSessionExit(opts) { return handleSessionExit(this, opts); }, // facade, igual server.js
    _unseen: unseen,
    _toasts: toasts,
  }, overrides || {});
  return engine;
}

test('sessionExit (mac): desfaz o visto de todas as keys da sessão registrada', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t1', { id: 't1', keys: ['org/repo#1', 'org/repo#2'], label: 'Revisão de 2 PRs', mode: 'terminal', startedAt: Date.now() });
  const result = sessionExit(engine, 't1');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen.sort(), ['org/repo#1', 'org/repo#2']);
  assert.equal(engine.checkedNow, true); // keys.length > 0 dispara checkNow, como antes
});

test('sessionExit (mac): sessão sem keys (ex.: login dedicado) não chama checkNow nem quebra', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t2', { id: 't2', keys: [], label: 'Login do Claude', mode: 'terminal', startedAt: Date.now() });
  const result = sessionExit(engine, 't2');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen, []);
  assert.equal(engine.checkedNow, undefined); // sem keys, não deve rechecar
});

test('sessionExit: id desconhecido (sessão já não existe) não lança e devolve ok', () => {
  const engine = fakeEngine();
  const result = sessionExit(engine, 'id-que-nao-existe');
  assert.equal(result.ok, true);
  assert.deepEqual(engine._unseen, []);
});

// a lógica do handler de exit foi extraída pra handleSessionExit(engine, { keys, label, id, code }),
// compartilhada com sessionExit — testamos ela diretamente, sem precisar de processo real nenhum
// (ver nota do brief: abordagem 2, recomendada).
test('handleSessionExit: desfaz o visto de todas as keys e dispara checkNow (equivalente ao exit do lançador)', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t3', { id: 't3', keys: ['org/repo#9'], label: 'Revisão de 1 PR', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: ['org/repo#9'], label: 'Revisão de 1 PR', id: 't3', code: 0 });
  assert.deepEqual(engine._unseen, ['org/repo#9']);
  assert.equal(engine.checkedNow, true);
  assert.equal(engine.activeReviews.has('t3'), false);
});

test('handleSessionExit: sem keys (login dedicado) não chama checkNow', () => {
  const engine = fakeEngine();
  engine.activeReviews.set('t4', { id: 't4', keys: [], label: 'Login do Claude', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: [], label: 'Login do Claude', id: 't4', code: 0 });
  assert.deepEqual(engine._unseen, []);
  assert.equal(engine.checkedNow, undefined);
});

test('handleSessionExit: código de saída != 0 loga WARN', () => {
  const engine = fakeEngine();
  let warned = null;
  engine.log = (level, msg) => { if (level === 'WARN') warned = msg; };
  engine.activeReviews.set('t5', { id: 't5', keys: [], label: 'Sessão X', mode: 'terminal', startedAt: Date.now() });
  handleSessionExit(engine, { keys: [], label: 'Sessão X', id: 't5', code: 1 });
  assert.ok(warned && /saiu com codigo 1/.test(warned));
});

// M5: o lançador do terminal retorna na hora; exit 0 = terminal lançado (o fim REAL da
// sessão chega depois, pelo trap EXIT do .command). Exit != 0 = o terminal nunca abriu: sem tratar, o pill fica preso e as keys ficam
// vistas pra sempre, PR sumido da fila (o inflight só cobre sessões auto).
test('spawnConsolePosix: lançador saindo != 0 desfaz o visto, remove a sessão e avisa (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  let scriptGravado = null;
  spawnImpl = (cmd, args) => { scriptGravado = args.at(-1); return fakeChild; }; // spawn(terminal, ['-e', script])
  try {
    spawnConsolePosix(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice', LANCADOR);
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];
  assert.ok(id, 'sessão registrada antes do exit');
  assert.equal(fs.existsSync(scriptGravado), true, 'o .command foi gravado');

  fakeChild.emit('exit', 1);

  assert.equal(engine.activeReviews.size, 0, 'pill não pode ficar preso');
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'sem unsee o PR some da fila pra sempre');
  assert.equal(engine.checkedNow, true, 'a fila precisa ser rechecada');
  assert.ok(engine._toasts.some(t => t.kind === 'toast' && t.payload.kind === 'error'), 'o usuário precisa saber que não abriu');
  assert.equal(fs.existsSync(scriptGravado), false, 'o trap EXIT nunca vai rodar; o script órfão tem que ser apagado');
});

test('spawnConsolePosix: lançador saindo 0 não mexe em nada; o fim real chega pelo trap EXIT (M5)', () => {
  const engine = fakeEngine();
  const fakeChild = new EventEmitter();
  spawnImpl = () => fakeChild;
  try {
    spawnConsolePosix(engine, '/pr-review x', 'Revisão de 1 PR', ['org/repo#7'], 'alice', LANCADOR);
  } finally {
    spawnImpl = null;
  }
  const id = Array.from(engine.activeReviews.keys())[0];

  fakeChild.emit('exit', 0); // open lançou o Terminal e retornou; a sessão segue viva

  assert.equal(engine.activeReviews.has(id), true, 'sessão continua ativa');
  assert.deepEqual(engine._unseen, [], 'não desfaz visto de sessão viva');

  const r = sessionExit(engine, id); // o trap EXIT do .command chama /api/session-exit
  assert.equal(r.ok, true);
  assert.deepEqual(engine._unseen, ['org/repo#7'], 'o ciclo fecha pelo caminho de sempre');
});
