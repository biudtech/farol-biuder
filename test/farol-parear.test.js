// Comando local de pareamento (A4, spec 7.A4 itens 3 e 4). O código sai SÓ na saída do
// terminal: nunca em farol.log, spawns.log, arquivo em claro ou linha de comando de outro
// processo. O comando honra FAROL_HOME, porque roda na máquina ao lado do engine.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-farol-parear-'));
process.env.FAROL_HOME = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const { consumirCodigo, criarCodigo } = await import('../lib/local-auth/pareamento.js');
const { emitirSessao, verificarSessao, listarSessoes } = await import('../lib/local-auth/sessoes.js');
const { LOG_FILE, LOCAL_AUTH_DIR } = await import('../lib/paths.js');
const { SPAWN_LOG_FILE } = await import('../lib/spawnlog.js');
const { executar } = await import('../tools/farol-parear.js');

const RAIZ = path.join(import.meta.dirname, '..');
const CLI = path.join(RAIZ, 'tools', 'farol-parear.js');

function rodar(args = []) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, FAROL_HOME: HOME } });
}

function arquivosDe(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosDe(p) : [p];
  });
}

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('imprime um código que funciona uma vez, só no stdout e só dentro do FAROL_HOME', () => {
  const r = rodar();
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/Código de pareamento: ([A-Z2-7]{10})\n/);
  assert.ok(m, `saída inesperada: ${r.stdout}`);
  const codigo = m[1];
  assert.match(r.stdout, /Vale por 10 minutos e funciona uma vez só\./);
  assert.equal(r.stderr, '');
  for (const arq of arquivosDe(HOME)) {
    assert.equal(fs.readFileSync(arq, 'utf8').includes(codigo), false, `código em claro em ${arq}`);
  }
  assert.equal(fs.existsSync(LOG_FILE), false, 'o comando não escreve farol.log');
  assert.equal(fs.existsSync(SPAWN_LOG_FILE), false, 'o comando não escreve spawns.log');
  assert.ok(fs.existsSync(path.join(LOCAL_AUTH_DIR, 'pareamentos.json')), 'o pareamento fica no FAROL_HOME do teste');
  assert.equal(consumirCodigo(codigo), true);
  assert.equal(consumirCodigo(codigo), false);
});

test('--revogar-todas derruba sessões e códigos pendentes', () => {
  const token = emitirSessao('navegador');
  const codigo = criarCodigo();
  const r = rodar(['--revogar-todas']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /revogados/);
  assert.equal(verificarSessao(token), false);
  assert.equal(consumirCodigo(codigo), false);
});

test('argumento desconhecido não gera código nem mexe em nada', () => {
  const r = rodar(['--codigo', 'ABCDEFGHIJ']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Uso: node tools\/farol-parear\.js \[--revogar-todas\]/);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(LOCAL_AUTH_DIR), false);
});

// Em processo (o executar exportado), para a cobertura e o teste de mutação enxergarem o ramo.
function executarAqui(args) {
  const saida = []; const erro = [];
  const codigo = executar(args, { write: (t) => saida.push(t) }, { write: (t) => erro.push(t) });
  return { codigo, stdout: saida.join(''), stderr: erro.join('') };
}

// A flag do agente saiu com a autoanálise: pedir por ela é uso errado, e nenhuma sessão nasce.
test('--autoanalise deixou de existir: uso errado, nada no stdout e nenhuma sessão emitida', () => {
  for (const args of [['--autoanalise'], ['--autoanalise', 'laptop'], ['--outra']]) {
    const errado = executarAqui(args);
    assert.equal(errado.codigo, 2, args.join(' '));
    assert.equal(errado.stdout, '');
    assert.match(errado.stderr, /Uso: node tools\/farol-parear\.js \[--revogar-todas\]/);
  }
  assert.deepEqual(listarSessoes(), []);
  assert.equal(executarAqui(['--revogar-todas']).codigo, 0);
});

