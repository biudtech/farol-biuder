// Padrão de caminho no estilo do CODEOWNERS (gitignore), PURO. O que sobrou do módulo é o
// casamento de padrão, que o roteador de modelo usa para os caminhos sensíveis; o parse do
// arquivo, o dono por caminho e a autoridade serviam à co-assinatura e saíram com ela.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { patternToRegex } = (await import('../lib/engine/codeowners.js')).default;
const casa = (padrao, caminho) => patternToRegex(padrao).test(caminho);

test('patternToRegex: padrão vazio não casa nada', () => {
  assert.equal(patternToRegex(''), null);
  assert.equal(patternToRegex(null), null);
});

test('`*` casa o nome em qualquer nível, mas não atravessa barra no meio do caminho', () => {
  assert.equal(casa('*', 'src/a/b/c.ts'), true);
  assert.equal(casa('*', 'README.md'), true);
  assert.equal(casa('src/*.ts', 'src/a.ts'), true);
  assert.equal(casa('src/*.ts', 'src/a/b.ts'), false);
});

test('`/x` ancora na raiz, `**/x` casa em qualquer nível', () => {
  assert.equal(casa('/package.json', 'package.json'), true);
  assert.equal(casa('/package.json', 'apps/web/package.json'), false, 'aninhado NÃO casa o ancorado');
  assert.equal(casa('**/package.json', 'apps/web/package.json'), true);
  assert.equal(casa('**/package.json', 'package.json'), true, 'e na raiz também');
});

test('diretório com barra no fim pega tudo dentro', () => {
  assert.equal(casa('infra/', 'infra/k8s/deploy.yaml'), true);
  assert.equal(casa('infra/', 'infra.md'), false, 'nome parecido não é o diretório');
});

test('extensão casa em qualquer nível', () => {
  assert.equal(casa('*.sql', 'db/migrations/001.sql'), true);
  assert.equal(casa('*.sql', 'db/migrations/001.ts'), false);
});

test('ponto e outros caracteres de regex são literais', () => {
  assert.equal(casa('a.b', 'axb'), false);
  assert.equal(casa('a.b', 'a.b'), true);
});
