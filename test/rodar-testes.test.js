import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { escolheuArquivo, padroesDeDescoberta } from '../tools/descoberta-de-testes.js';

const executor = path.resolve(import.meta.dirname, '../tools/rodar-testes.js');

function rodar(t, fonte, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-runner-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const arquivo = path.join(dir, 'fixture.mjs');
  fs.writeFileSync(arquivo, fonte);
  return spawnSync(process.execPath, [executor, ...args, arquivo], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, FAROL_TEST_CONCORRENCIA: '1' },
  });
}

test('o executor propaga uma falha real de teste', (t) => {
  const r = rodar(t, "import test from 'node:test'; test('falha de prova', () => { throw new Error('falha esperada'); });");
  assert.ifError(r.error);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /falha esperada/);
});

test('o executor encaminha os argumentos usados pela matriz e pela seleção de casos', (t) => {
  const r = rodar(t, `import test from 'node:test';
    test('selecionado', () => {});
    test('fora da seleção', () => { throw new Error('não deveria executar'); });`,
  ['--no-test-force-exit', '--test-name-pattern=selecionado']);
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selecionado/);
});

test('o executor não força o encerramento, que truncava o relatório dos arquivos de teste', () => {
  const fonte = fs.readFileSync(executor, 'utf8');
  assert.doesNotMatch(fonte, /'--test-force-exit'/);
});

// Sem arquivo na linha de comando, o `node --test` procura teste na árvore inteira, e desde
// que o Node lê TypeScript isso inclui `.test.ts`: os testes do front (web/, que rodam com o
// Vitest e têm gate próprio) seriam executados pelo runner do motor e reprovariam por não
// acharem o Vitest. O executor passa os padrões pasta a pasta, sem a `web` da raiz.
test('os padrões de descoberta cobrem a raiz e cada pasta, menos o front e o node_modules', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-padroes-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  for (const pasta of ['test', 'lib', 'web', 'node_modules', '.github']) fs.mkdirSync(path.join(dir, pasta));
  fs.writeFileSync(path.join(dir, 'server.js'), '');
  const padroes = padroesDeDescoberta(dir);
  const NOMES = '{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs}';
  assert.deepEqual(padroes, [NOMES, `.github/**/${NOMES}`, `lib/**/${NOMES}`, `test/**/${NOMES}`]);
});

test('os padrões acham o que a descoberta padrão do Node acha em JavaScript, e nada do front', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-padroes-glob-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const escrever = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '');
  };
  const doMotor = ['a.test.js', 'test/b.test.js', 'test/helpers/c.js', 'test/fixtures/d.mjs', 'lib/e.test.js', 'lib/fundo/test/f.cjs', 'tools/test-g.js', 'lib/h_test.js', 'lib/web/i.test.js'];
  const foraDaDescoberta = ['server.js', 'lib/real.js', 'web/src/x.test.ts', 'web/src/y.test.js', 'web/test/z.js', 'test/w.test.ts'];
  [...doMotor, ...foraDaDescoberta].forEach(escrever);
  const achados = fs.globSync(padroesDeDescoberta(dir), { cwd: dir })
    .filter((p) => fs.statSync(path.join(dir, p)).isFile())
    .map((p) => p.split(path.sep).join('/')).sort();
  assert.deepEqual(achados, doMotor.slice().sort());
});

test('o executor só passa os padrões quando ninguém escolheu arquivo', () => {
  assert.equal(escolheuArquivo(['--test-name-pattern=x', '--no-test-force-exit']), false);
  assert.equal(escolheuArquivo([]), false);
  assert.equal(escolheuArquivo(['--test-name-pattern=x', 'test/http.test.js']), true);
});
