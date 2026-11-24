// A regra de dependência do sync por herança (decisão 2 do dono, detalhada em 24/11/2026 depois da
// revisão independente): o herdado volta à leitura quando qualquer caminho de imports, passando por
// qualquer arquivo, dentro ou fora do diff, chega a um arquivo a ler ou que a base mudou; import
// não relativo sem destino só é pacote externo quando o package.json o declara; só o não código de
// uma lista fechada herda sem conferência; configuração global e esquema do Prisma mudados devolvem
// o código que depende deles.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { separarHerdados } = await import('../lib/engine/sync-por-heranca.js');
const { pacotesDoRepositorio } = await import('../lib/engine/dependencia-do-sync.js');

const f = (caminho) => ({ path: caminho, sha: 'e'.repeat(40), status: 'modified' });
const parseado = (paths) => paths.map((p) => ({ path: p, backend: 'babel', limitations: [] }));
const separar = (over) => separarHerdados({ arquivos: [], diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), mapa: null, pacotes: null, ...over });
const PACOTES = { porPasta: { '': ['react', '@prisma/client', '@nestjs/common'] }, workspace: [] };

test('a sonda da revisão: barril fora do diff, import pelo baseUrl e Swift voltam à leitura', () => {
  const arquivos = [f('src/x.ts'), f('src/m.ts'), f('src/y.ts'), f('src/z.swift')];
  const mapa = { files: [{ path: 'src/x.ts', backend: 'tree-sitter' }, { path: 'src/index.ts', backend: 'tree-sitter' }, { path: 'src/y.ts', backend: 'tree-sitter' }],
    relations: [{ from: 'src/x.ts', to: 'src/index.ts' }, { from: 'src/index.ts', to: 'src/m.ts' }], unresolved: [{ from: 'src/y.ts', specifier: 'src/m' }], limitations: [] };
  const r = separar({ arquivos, diferemDaFoto: ['src/m.ts'], mapa });
  assert.deepEqual(r.herdados, []);
  assert.deepEqual(r.aLer.sort(), ['src/m.ts', 'src/x.ts', 'src/y.ts', 'src/z.swift']);
});

test('barril fora do diff que reexporta um arquivo que a base mudou: volta', () => {
  const mapa = { files: parseado(['src/x.ts', 'src/index.ts', 'src/util.ts']), relations: [{ from: 'src/x.ts', to: 'src/index.ts' }, { from: 'src/index.ts', to: 'src/util.ts' }], unresolved: [] };
  assert.deepEqual(separar({ arquivos: [f('src/x.ts')], mexidosNaBase: ['src/util.ts'], mapa, pacotes: PACOTES }).aLer, ['src/x.ts']);
});

test('caminho de imports que passa por arquivo que o mapa não leu: volta', () => {
  const mapa = { files: parseado(['src/x.ts']), relations: [{ from: 'src/x.ts', to: 'src/fora.ts' }], unresolved: [] };
  assert.deepEqual(separar({ arquivos: [f('src/x.ts')], mapa, pacotes: PACOTES }).aLer, ['src/x.ts']);
});

test('caminho inteiro limpo, com pacote declarado e builtin do Node: herda', () => {
  const mapa = { files: parseado(['src/x.ts', 'src/index.ts', 'src/util.ts']),
    relations: [{ from: 'src/x.ts', to: 'src/index.ts' }, { from: 'src/index.ts', to: 'src/util.ts' }],
    unresolved: [{ from: 'src/util.ts', specifier: 'react' }, { from: 'src/util.ts', specifier: 'node:fs' }, { from: 'src/x.ts', specifier: 'path' }, { from: 'src/x.ts', specifier: '@nestjs/common/decorators' }] };
  assert.deepEqual(separar({ arquivos: [f('src/x.ts')], mapa, pacotes: PACOTES }).herdados, ['src/x.ts']);
});

test('import não resolvido que pode ser do repositório: volta', () => {
  const caso = (specifier, pacotes = PACOTES) => separar({ arquivos: [f('src/a.ts')], pacotes,
    mapa: { files: parseado(['src/a.ts']), relations: [], unresolved: [{ from: 'src/a.ts', specifier }] } }).aLer;
  assert.deepEqual(caso('src/common/x'), ['src/a.ts'], 'baseUrl sem paths');
  assert.deepEqual(caso('@biudtech/shared'), ['src/a.ts'], 'pacote não declarado');
  assert.deepEqual(caso('@biudtech/shared', { porPasta: { '': ['@biudtech/shared'] }, workspace: ['@biudtech/shared'] }), ['src/a.ts'], 'pacote do workspace');
  assert.deepEqual(caso('react', null), ['src/a.ts'], 'sem package.json legível');
});

test('o package.json mais próximo vale junto com o da raiz', () => {
  const pacotes = { porPasta: { '': ['react'], 'apps/api': ['@nestjs/core'] }, workspace: [] };
  const mapa = { files: parseado(['apps/api/src/a.ts', 'apps/web/b.ts']), relations: [],
    unresolved: [{ from: 'apps/api/src/a.ts', specifier: '@nestjs/core' }, { from: 'apps/api/src/a.ts', specifier: 'react' }, { from: 'apps/web/b.ts', specifier: '@nestjs/core' }] };
  const r = separar({ arquivos: [f('apps/api/src/a.ts'), f('apps/web/b.ts')], mapa, pacotes });
  assert.deepEqual(r.herdados, ['apps/api/src/a.ts']);
  assert.deepEqual(r.aLer, ['apps/web/b.ts']);
});

test('linguagem fechada por padrão: só o não código da lista herda', () => {
  const herdam = ['docs/a.md', 'docs/b.mdx', 'notas.txt', 'img/a.png', 'img/b.jpg', 'img/c.jpeg', 'img/d.gif', 'img/e.svg', 'img/f.webp', 'favicon.ico', 'manual.pdf', 'dados.csv'];
  const voltam = ['ios/App.swift', 'lib/main.dart', 'src/a.c', 'src/a.h', 'scripts/x.sh', '.github/ci.yml', 'db/x.sql', 'arquivo.desconhecido', 'config/x.json', 'config/y.yaml', 'app/x.py'];
  const r = separar({ arquivos: [...herdam, ...voltam].map(f), pacotes: PACOTES });
  assert.deepEqual(r.herdados, herdam);
  assert.deepEqual(r.aLer, voltam);
});

test('configuração global a ler ou mexida pela base: todo código herdado volta', () => {
  const mapa = { files: parseado(['src/a.ts']), relations: [], unresolved: [] };
  for (const config of ['tsconfig.json', 'tsconfig.build.json', 'package.json', 'apps/api/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml',
    'package-lock.json', 'yarn.lock', 'nest-cli.json', 'next.config.mjs', 'vite.config.ts', 'webpack.config.js', 'babel.config.js']) {
    const misturado = separar({ arquivos: [f('src/a.ts'), f('docs/a.md'), f(config)], diferemDaFoto: [config], mapa, pacotes: PACOTES });
    assert.deepEqual(misturado.herdados, ['docs/a.md'], `${config} misturado`);
    const daBase = separar({ arquivos: [f('src/a.ts')], mexidosNaBase: [config], mapa, pacotes: PACOTES });
    assert.deepEqual(daBase.herdados, [], `${config} mexido pela base`);
  }
});

test('configuração global idêntica à foto não derruba o código herdado (ela mesma vai à leitura)', () => {
  const mapa = { files: parseado(['src/a.ts']), relations: [], unresolved: [] };
  const r = separar({ arquivos: [f('src/a.ts'), f('package.json')], mapa, pacotes: PACOTES });
  assert.deepEqual(r.herdados, ['src/a.ts']);
  assert.deepEqual(r.aLer, ['package.json']);
});

test('esquema do Prisma mudado: volta quem importa @prisma/client e quem chega a ele pelo grafo', () => {
  const mapa = { files: parseado(['src/repo.ts', 'src/servico.ts', 'src/tela.ts']),
    relations: [{ from: 'src/servico.ts', to: 'src/repo.ts' }],
    unresolved: [{ from: 'src/repo.ts', specifier: '@prisma/client' }] };
  const arquivos = [f('prisma/schema.prisma'), f('src/repo.ts'), f('src/servico.ts'), f('src/tela.ts')];
  const r = separar({ arquivos, diferemDaFoto: ['prisma/schema.prisma'], mapa, pacotes: PACOTES });
  assert.deepEqual(r.herdados, ['src/tela.ts']);
  const daBase = separar({ arquivos: arquivos.slice(1), mexidosNaBase: ['apps/api/prisma/schema.prisma'], mapa, pacotes: PACOTES });
  assert.deepEqual(daBase.herdados, ['src/tela.ts']);
  const intocado = separar({ arquivos: arquivos.slice(1), mapa, pacotes: PACOTES });
  assert.deepEqual(intocado.herdados, ['src/repo.ts', 'src/servico.ts', 'src/tela.ts'], 'com o esquema intocado, o Prisma é pacote declarado');
});

function fonte(arvore, completa = true) {
  return { reader: {
    tree: async () => ({ complete: completa, entries: Object.keys(arvore).map((p) => ({ path: p, type: 'blob' })) }),
    read: async (p) => (typeof arvore[p] === 'string' ? { status: 'available', text: arvore[p] } : { status: 'unavailable' }),
  } };
}

test('pacotesDoRepositorio lê cada package.json, os pacotes do workspace e recusa o ilegível', async () => {
  const p = await pacotesDoRepositorio(fonte({
    'package.json': JSON.stringify({ dependencies: { react: '18' }, devDependencies: { '@biudtech/lib': 'workspace:*' } }),
    'apps/api/package.json': JSON.stringify({ name: '@biudtech/api', peerDependencies: { '@nestjs/core': '10' } }),
    'node_modules/x/package.json': JSON.stringify({ name: 'x' }),
    'src/a.ts': 'x',
  }));
  assert.deepEqual(p.porPasta, { '': ['react', '@biudtech/lib'], 'apps/api': ['@nestjs/core'] });
  assert.deepEqual(p.workspace.sort(), ['@biudtech/api', '@biudtech/lib']);
  assert.equal(await pacotesDoRepositorio(fonte({ 'package.json': '{ torto' })), null);
  assert.equal(await pacotesDoRepositorio(fonte({ 'apps/x/package.json': '{}' })), null, 'sem o da raiz');
  assert.equal(await pacotesDoRepositorio(fonte({ 'package.json': '{}' }, false)), null, 'árvore incompleta');
  assert.equal(await pacotesDoRepositorio({}), null);
});
