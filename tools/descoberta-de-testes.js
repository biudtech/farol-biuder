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

/** true quando a linha de comando já traz arquivo ou padrão, e a descoberta não se aplica. */
function escolheuArquivo(args) {
  return args.some((arg) => !arg.startsWith('-'));
}

export default { padroesDeDescoberta, escolheuArquivo };
export { padroesDeDescoberta, escolheuArquivo };
