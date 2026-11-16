// Quais arquivos o `npm test` do motor entrega ao `node --test` quando ninguém escolheu um.
//
// Sem arquivo na linha de comando, o Node procura teste na árvore inteira, e desde que ele
// lê TypeScript a procura inclui `.test.ts`. Os testes do front (`web/`) são `.test.ts`,
// rodam com o Vitest e têm gate próprio: no runner do motor eles reprovariam por não acharem
// o Vitest. Por isso o executor passa os padrões pasta a pasta, sem a `web` da raiz.
//
// Os nomes são os da descoberta padrão do Node (`test.js`, tudo o que mora numa pasta
// `test/`, `test-*.js`, `*.test.js`, `*-test.js`, `*_test.js`), nas extensões de JavaScript.
import fs from 'node:fs';
import { FRONT } from './nao-e-fonte.js';

const NOMES = '{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs}';
// O Node pula `node_modules` sozinho em qualquer nível; aqui é só para não gerar padrão à toa.
const FORA = new Set([FRONT, 'node_modules']);

/** Os padrões de glob: um para os arquivos da raiz e um por pasta da raiz, menos o front. */
function padroesDeDescoberta(raiz) {
  const pastas = fs.readdirSync(raiz, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !FORA.has(item.name))
    .map((item) => item.name)
    .sort();
  return [NOMES, ...pastas.map((pasta) => `${pasta}/**/${NOMES}`)];
}

// As flags do Node que pedem valor e o aceitam separado por espaço (`--test-name-pattern x`).
// O argumento seguinte a uma delas é o valor, não um arquivo. Com `=` o valor já vem junto.
const FLAGS_COM_VALOR = new Set([
  '--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination',
  '--test-concurrency', '--test-timeout', '--test-shard', '--test-isolation', '--test-global-setup',
  '--test-rerun-failures', '--test-coverage-include', '--test-coverage-exclude',
  '--test-coverage-branches', '--test-coverage-functions', '--test-coverage-lines',
  '--import', '--require', '-r', '--loader', '--experimental-loader', '--conditions', '-C',
  '--env-file', '--env-file-if-exists', '--watch-path', '--input-type', '--disable-warning',
  '--redirect-warnings', '--stack-trace-limit', '--title',
]);

/** true quando a linha de comando já traz arquivo ou padrão, e a descoberta não se aplica. */
function escolheuArquivo(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // depois de `--` tudo é arquivo
    if (arg === '--') return i + 1 < args.length;
    if (FLAGS_COM_VALOR.has(arg)) { i++; continue; }
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

export default { padroesDeDescoberta, escolheuArquivo };
export { padroesDeDescoberta, escolheuArquivo };
