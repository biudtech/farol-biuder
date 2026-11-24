// A regra de dependência do sync por herança depois da segunda revisão independente (24/11/2026):
// o que difere da foto fora do diff contamina, o esquema do Prisma é qualquer arquivo dele, o
// baseUrl e os aliases do tsconfig marcam o import do repositório, a dependência local é do
// repositório, o .mdx com import volta, o dado ou estilo idêntico herda sem contaminar, e o import
// dinâmico literal não deixa o arquivo como não lido.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { separarHerdados } = await import('../lib/engine/sync-por-heranca.js');
const { pacotesDoRepositorio } = await import('../lib/engine/repositorio-do-sync.js');

const f = (caminho) => ({ path: caminho, sha: 'e'.repeat(40), status: 'modified' });
const parse = (ps, limitations = []) => ps.map((p) => ({ path: p, backend: 'babel', limitations }));
const PACOTES = { porPasta: { '': ['react', 'config', '@prisma/client'] }, workspace: [], prefixosDeAlias: [], segmentosDoBaseUrl: [] };
const sep = (o) => separarHerdados({ arquivos: [], diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), mapa: null, pacotes: PACOTES, ...o });
const DINAMICO = 'Import dinâmico não comprova execução ou conjunto completo de dependências.';
const COMMONJS = 'CommonJS é candidato sintático; require pode estar sombreado e a resolução exige confirmação.';

test('A: arquivo que difere da foto fora do diff contamina quem o importa', () => {
  const r = sep({ arquivos: [f('src/x.ts')], diferemDaFoto: ['src/y.ts'],
    mapa: { files: parse(['src/x.ts', 'src/y.ts']), relations: [{ from: 'src/x.ts', to: 'src/y.ts' }], unresolved: [] } });
  assert.deepEqual(r.herdados, []);
});

test('A: package.json devolvido à versão da base (fora do diff, difere da foto) derruba o código', () => {
  const r = sep({ arquivos: [f('src/x.ts'), f('docs/a.md')], diferemDaFoto: ['package.json'],
    mapa: { files: parse(['src/x.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(r.herdados, ['docs/a.md']);
});

test('B: o esquema do Prisma é qualquer arquivo dele', () => {
  const mapa = { files: parse(['src/repo.ts', 'src/tela.ts']), relations: [], unresolved: [{ from: 'src/repo.ts', specifier: '@prisma/client' }] };
  const arquivos = [f('src/repo.ts'), f('src/tela.ts')];
  for (const esquema of ['prisma/schema/user.prisma', 'db/modelos.prisma', 'prisma/migrations/2026_x/migration.sql', 'prisma/seed.ts', 'prisma.config.ts']) {
    assert.deepEqual(sep({ arquivos, diferemDaFoto: [esquema], mapa }).herdados, ['src/tela.ts'], esquema);
  }
  const declarado = { ...PACOTES, esquemaDoPackage: 'db/main.schema' };
  assert.deepEqual(sep({ arquivos, mexidosNaBase: ['db/main.schema'], mapa, pacotes: declarado }).herdados, ['src/tela.ts'], 'prisma.schema do package.json');
  assert.deepEqual(sep({ arquivos, mapa }).herdados, ['src/repo.ts', 'src/tela.ts'], 'esquema intocado');
});

test('C: baseUrl com pasta local vence o pacote declarado de mesmo nome', () => {
  const caso = (pacotes, specifier = 'config/db') => sep({ arquivos: [f('src/a.ts')], pacotes,
    mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [{ from: 'src/a.ts', specifier }] } }).herdados;
  assert.deepEqual(caso({ ...PACOTES, segmentosDoBaseUrl: ['config', 'a'] }), [], 'primeiro segmento existe sob o baseUrl');
  assert.deepEqual(caso({ ...PACOTES, segmentosDoBaseUrl: null }), [], 'baseUrl que não deu para resolver');
  assert.deepEqual(caso({ ...PACOTES, segmentosDoBaseUrl: ['modulos'] }, 'react'), ['src/a.ts'], 'pacote declarado fora do baseUrl');
});

test('D: dependência local (file:, link:, portal:) é do repositório pela chave', () => {
  const r = sep({ arquivos: [f('src/a.ts')], pacotes: { ...PACOTES, porPasta: { '': ['shared'] }, workspace: ['shared'] },
    mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [{ from: 'src/a.ts', specifier: 'shared' }] } });
  assert.deepEqual(r.herdados, []);
});

test('E: .mdx herda só como texto simples, sem import', () => {
  const textos = { 'docs/plain.mdx': '# Título\n\nTexto simples.\n', 'docs/page.mdx': "import Comp from '../src/Comp'\n\n<Comp />\n" };
  const r = sep({ arquivos: [f('docs/plain.mdx'), f('docs/page.mdx'), f('docs/sem-texto.mdx')], pacotes: { ...PACOTES, textos } });
  assert.deepEqual(r.herdados, ['docs/plain.mdx']);
});

test('I: estilo e dado idênticos herdam e não contaminam quem os importa', () => {
  const textos = { 'src/Btn.module.css': '.btn { color: red; }\n' };
  const r = sep({ arquivos: [f('src/Btn.tsx'), f('src/Btn.module.css'), f('src/dados.json')], pacotes: { ...PACOTES, textos },
    mapa: { files: parse(['src/Btn.tsx']), relations: [{ from: 'src/Btn.tsx', to: 'src/Btn.module.css' }, { from: 'src/Btn.tsx', to: 'src/dados.json' }],
      unresolved: [{ from: 'src/Btn.tsx', specifier: 'react' }] } });
  assert.deepEqual(r.herdados, ['src/Btn.tsx', 'src/Btn.module.css', 'src/dados.json']);
});

test('I: dado que mudou contamina quem o importa', () => {
  const r = sep({ arquivos: [f('src/a.ts'), f('src/dados.json')], diferemDaFoto: ['src/dados.json'],
    mapa: { files: parse(['src/a.ts']), relations: [{ from: 'src/a.ts', to: 'src/dados.json' }], unresolved: [] } });
  assert.deepEqual(r.herdados, []);
});

test('I: estilo com @import, @use ou @forward de arquivo que mudou volta', () => {
  const textos = {
    'src/a.scss': "@use 'variaveis';\n.a { color: $cor; }\n",
    'src/b.scss': "@use './limpo';\n",
    'src/c.css': '@import url("./tema.css");\n',
    'src/d.scss': "@use '~bootstrap/scss/x';\n",
    'src/e.scss': "@use 'sass:math';\n.e { width: math.div(1, 2); }\n",
  };
  const r = sep({ arquivos: ['src/a.scss', 'src/b.scss', 'src/c.css', 'src/d.scss', 'src/e.scss', 'src/sem-texto.less'].map(f),
    mexidosNaBase: ['src/_variaveis.scss', 'src/tema.css'], pacotes: { ...PACOTES, textos } });
  assert.deepEqual(r.herdados, ['src/b.scss', 'src/e.scss']);
  assert.deepEqual(r.aLer, ['src/a.scss', 'src/c.css', 'src/d.scss', 'src/sem-texto.less']);
});

test('J: import dinâmico ou require literal resolvido não deixa o arquivo como não lido', () => {
  const mapa = { files: [...parse(['src/page.tsx'], [DINAMICO, COMMONJS]), ...parse(['src/Lazy.tsx'])],
    relations: [{ from: 'src/page.tsx', to: 'src/Lazy.tsx' }], unresolved: [{ from: 'src/page.tsx', specifier: 'react' }] };
  assert.deepEqual(sep({ arquivos: [f('src/page.tsx')], mapa }).herdados, ['src/page.tsx']);
  const naoLiteral = { ...mapa, unresolved: [{ from: 'src/page.tsx', specifier: null, reason: 'dependência dinâmica calculada' }] };
  assert.deepEqual(sep({ arquivos: [f('src/page.tsx')], mapa: naoLiteral }).herdados, [], 'import dinâmico não literal');
  const outraLimitacao = { ...mapa, files: [...parse(['src/page.tsx'], ['erro de parse']), ...parse(['src/Lazy.tsx'])] };
  assert.deepEqual(sep({ arquivos: [f('src/page.tsx')], mapa: outraLimitacao }).herdados, [], 'outra limitação segue derrubando');
});

test('K: com a limitação de alias, os prefixos lidos do tsconfig decidem', () => {
  const LIMITACAO = ['tsconfig.json: extends não expandido; resolução de aliases é parcial.'];
  const caso = (specifier, prefixosDeAlias) => sep({ arquivos: [f('src/a.tsx')], pacotes: { ...PACOTES, prefixosDeAlias },
    mapa: { files: parse(['src/a.tsx']), relations: [], unresolved: [{ from: 'src/a.tsx', specifier }], limitations: LIMITACAO } }).herdados;
  assert.deepEqual(caso('react', ['@app/']), ['src/a.tsx'], 'pacote declarado que não casa com prefixo');
  assert.deepEqual(caso('@app/modulo', ['@app/']), [], 'casa com prefixo');
  assert.deepEqual(caso('react', undefined), [], 'sem tsconfig lido, a regra conservadora');
  assert.deepEqual(caso('react', ['']), [], 'alias curinga "*" casa tudo');
});

function fonte(arvore) {
  return { reader: {
    tree: async () => ({ complete: true, entries: Object.keys(arvore).map((p) => ({ path: p, type: 'blob' })) }),
    read: async (p) => (typeof arvore[p] === 'string' ? { status: 'available', text: arvore[p] } : { status: 'unavailable' }),
  } };
}

test('pacotesDoRepositorio: dependência local, prisma.schema, baseUrl, aliases com extends e textos', async () => {
  const p = await pacotesDoRepositorio(fonte({
    'package.json': JSON.stringify({ dependencies: { shared: 'file:./libs/common', outro: 'link:../x', p3: 'portal:./p', react: '18' }, prisma: { schema: './db/main.prisma' } }),
    'tsconfig.json': '{\n  // comentário\n  "$schema": "https://json.schemastore.org/tsconfig",\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "paths": { "@app/*": ["src/app/*"], },\n  }\n}\n',
    'tsconfig.base.json': '{ /* base */ "extends": "@tsconfig/node20/tsconfig.json", "compilerOptions": { "baseUrl": "src" } }',
    'src/config/db.ts': 'x', 'src/main.ts': 'x', 'docs/a.mdx': '# a',
  }), ['docs/a.mdx']);
  assert.deepEqual(p.workspace.sort(), ['outro', 'p3', 'shared']);
  assert.equal(p.esquemaDoPackage, 'db/main.prisma');
  assert.deepEqual(p.prefixosDeAlias, ['@app/']);
  assert.deepEqual(p.segmentosDoBaseUrl.sort(), ['config', 'main']);
  assert.deepEqual(p.textos, { 'docs/a.mdx': '# a' });
  const quebrado = await pacotesDoRepositorio(fonte({ 'package.json': '{}', 'tsconfig.json': '{ "extends": "./falta.json" }' }));
  assert.equal(quebrado.prefixosDeAlias, null, 'extends relativo que não dá para ler');
  assert.equal(quebrado.segmentosDoBaseUrl, null);
});
