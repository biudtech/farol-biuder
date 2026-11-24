// O mundo fechado da regra de dependência do sync por herança (24/11/2026, depois da revisão final):
// o arquivo mudado que não é código, documentação, esquema do Prisma nem dado ou estilo importado
// por código tem impacto global; o estilo, o dado e o código herdados só herdam sem nenhuma
// referência que o mapa não vê; o alias ambíguo volta. Cada forma da sonda da revisão é um caso.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { separarHerdados } = await import('../lib/engine/sync-por-heranca.js');
const { pacotesDoRepositorio } = await import('../lib/engine/repositorio-do-sync.js');

const f = (caminho) => ({ path: caminho, sha: 'e'.repeat(40), status: 'modified' });
const parse = (ps) => ps.map((p) => ({ path: p, backend: 'babel', limitations: [] }));
const TEXTO = 'export const x = 1;\n';
const textosPadrao = () => new Proxy({}, { get: (_, k) => (typeof k === 'string' ? TEXTO : undefined) });
const PACOTES = { porPasta: { '': ['react', 'bootstrap'] }, workspace: [], prefixosDeAlias: [], aliases: [], segmentosDoBaseUrl: [] };
const MAPA_VAZIO = { files: [], relations: [], unresolved: [] };
const sep = (o) => separarHerdados({ arquivos: [], diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), mapa: MAPA_VAZIO,
  pacotes: { ...PACOTES, textos: textosPadrao() }, ...o });
const comTextos = (textos) => ({ ...PACOTES, textos });

test('estilo herdado com qualquer referência volta (as formas da sonda)', () => {
  for (const [arquivo, texto] of [
    ['src/a.css', '@import url(./b.css);\n.a{}'],
    ['src/a.scss', "@import 'x', 'b';"],
    ['src/a.less', '@import (reference) "b.less";'],
    ['src/a.sass', '@import b\n.a\n  color: red'],
    ['src/a.module.css', ".btn { composes: base from './base.module.css'; }"],
    ['src/components/a.scss', '@use "@/styles/tokens";'],
    ['src/components/b.css', '@import "/src/styles/b.css";'],
    ['src/c.scss', '@import "bootstrap/scss/bootstrap";'],
    ['src/d.css', '@tailwind base; .a{@apply p-4;}'],
    ['src/e.scss', "@forward 'tokens';"],
    ['src/f.css', '.a { background: url(img/fundo.png); }'],
  ]) {
    assert.deepEqual(sep({ arquivos: [f(arquivo)], pacotes: comTextos({ [arquivo]: texto }) }).herdados, [], arquivo);
  }
  assert.deepEqual(sep({ arquivos: [f('src/g.css')], pacotes: comTextos({ 'src/g.css': '.a { background: url(data:image/png;base64,AAA); color: red; }' }) }).herdados,
    ['src/g.css'], 'url(data:) não é referência');
  assert.deepEqual(sep({ arquivos: [f('src/h.css')], pacotes: comTextos({}) }).herdados, [], 'sem texto, volta');
});

test('dado herdado com #import ou $ref volta', () => {
  const textos = { 'api/q.graphql': '#import "./fragmento.graphql"\nquery Q { a }\n', 'api/openapi.yaml': "paths:\n  /a:\n    $ref: './a.yaml'\n",
    'api/limpo.json': '{"a": 1}' };
  const r = sep({ arquivos: [f('api/q.graphql'), f('api/openapi.yaml'), f('api/limpo.json')], pacotes: comTextos(textos) });
  assert.deepEqual(r.herdados, ['api/limpo.json']);
});

test('código herdado com leitura que o mapa não vê volta', () => {
  for (const texto of ["const m = import.meta.glob('./*.ts');", "const ctx = require.context('./x', true);",
    "const u = new URL('./w.js', import.meta.url);", "const w = new Worker(caminho);", "fs.readFileSync('dados.json');",
    "await readFile(p);", "createReadStream(p);", 'await fs.promises.stat(p);']) {
    const r = sep({ arquivos: [f('src/a.ts')], pacotes: comTextos({ 'src/a.ts': texto }), mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [] } });
    assert.deepEqual(r.herdados, [], texto);
  }
  const limpo = sep({ arquivos: [f('src/a.ts')], mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(limpo.herdados, ['src/a.ts']);
  const semTexto = sep({ arquivos: [f('src/a.ts')], pacotes: comTextos({}), mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(semTexto.herdados, [], 'sem texto, volta');
});

test('impacto global: configuração de qualquer ferramenta, .d.ts, workflow, .env, script, extensão desconhecida', () => {
  const arquivos = [f('src/a.ts'), f('src/a.css'), f('dados/x.json'), f('docs/a.md'), f('img/a.png')];
  const mapa = { files: parse(['src/a.ts']), relations: [], unresolved: [] };
  for (const mudado of ['jsconfig.json', 'tsconfig.json', '.babelrc', '.swcrc', 'tailwind.config.js', 'postcss.config.cjs', '.eslintrc.json',
    'vite.config.ts', 'next.config.mjs', 'webpack.config.js', 'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'pnpm-workspace.yaml',
    'src/types/global.d.ts', '.github/workflows/x.yml', '.env.production', 'db/consulta.sql', 'scripts/deploy.sh', 'Dockerfile', 'arquivo.desconhecido',
    'src/a.mdx']) {
    assert.deepEqual(sep({ arquivos, diferemDaFoto: [mudado], mapa }).herdados, ['docs/a.md', 'img/a.png'], mudado);
  }
});

test('só documentação no diff e um workflow mudado: o código herdado volta', () => {
  const r = sep({ arquivos: [f('docs/a.md'), f('docs/b.md'), f('src/a.ts')], mexidosNaBase: ['.github/workflows/x.yml'],
    mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(r.herdados, ['docs/a.md', 'docs/b.md']);
});

test('dado mudado: só o importado por código contamina pelo grafo; o que ninguém importa é global', () => {
  const mapa = { files: parse(['src/a.ts', 'src/b.ts']), relations: [{ from: 'src/a.ts', to: 'src/dados.json' }], unresolved: [] };
  const importado = sep({ arquivos: [f('src/a.ts'), f('src/b.ts')], diferemDaFoto: ['src/dados.json'], mapa });
  assert.deepEqual(importado.herdados, ['src/b.ts']);
  const lidoPorFs = sep({ arquivos: [f('src/a.ts'), f('src/b.ts')], diferemDaFoto: ['config/regras.json'], mapa });
  assert.deepEqual(lidoPorFs.herdados, []);
});

test('documentação mudada não tem efeito; .d.ts e configuração herdados voltam sem derrubar ninguém', () => {
  const mapa = { files: parse(['src/a.ts']), relations: [], unresolved: [] };
  assert.deepEqual(sep({ arquivos: [f('src/a.ts')], diferemDaFoto: ['ARCHITECTURE.md'], mapa }).herdados, ['src/a.ts']);
  const r = sep({ arquivos: [f('src/a.ts'), f('src/types/global.d.ts'), f('package.json')], mapa });
  assert.deepEqual(r.herdados, ['src/a.ts']);
});

test('alias ambíguo: mais de uma chave casa e o destino do mapa não é o da chave mais longa', () => {
  const aliases = [{ chave: '@/*', alvos: ['src/*'], base: '' }, { chave: '@/components/*', alvos: ['libs/ui/*'], base: '' }];
  const pacotes = { ...PACOTES, prefixosDeAlias: aliases.map((a) => a.chave), aliases, textos: textosPadrao() };
  const caso = (to) => sep({ arquivos: [f('src/a.ts')], pacotes,
    mapa: { files: parse(['src/a.ts', to]), relations: [{ from: 'src/a.ts', to, specifier: '@/components/botao' }], unresolved: [] } }).herdados;
  assert.deepEqual(caso('src/components/botao.ts'), [], 'o mapa pegou a primeira chave');
  assert.deepEqual(caso('libs/ui/botao.ts'), ['src/a.ts'], 'destino da chave mais longa');
  const semAlvos = { ...pacotes, aliases: null };
  assert.deepEqual(sep({ arquivos: [f('src/a.ts')], pacotes: semAlvos,
    mapa: { files: parse(['src/a.ts', 'libs/ui/botao.ts']), relations: [{ from: 'src/a.ts', to: 'libs/ui/botao.ts', specifier: '@/components/botao' }], unresolved: [] } }).herdados,
    [], 'sem os alvos, não dá para conferir');
});

test('chave "~*" sem barra casa com qualquer import que comece com ~', () => {
  const r = sep({ arquivos: [f('src/a.ts')], pacotes: { ...PACOTES, porPasta: { '': ['~utils'] }, prefixosDeAlias: ['~*'], textos: textosPadrao() },
    mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [{ from: 'src/a.ts', specifier: '~utils' }] } });
  assert.deepEqual(r.herdados, []);
});

function fonte(arvore) {
  return { reader: {
    tree: async () => ({ complete: true, entries: Object.keys(arvore).map((p) => ({ path: p, type: 'blob' })) }),
    read: async (p) => (typeof arvore[p] === 'string' ? { status: 'available', text: arvore[p] } : { status: 'unavailable' }),
  } };
}

test('tsconfig com extends em lista: as chaves e o baseUrl da base valem', async () => {
  const p = await pacotesDoRepositorio(fonte({
    'package.json': JSON.stringify({ dependencies: { '@org/ui': '^2.0.0' } }),
    'tsconfig.json': JSON.stringify({ extends: ['./tsconfig.base.json'] }),
    'tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@org/ui': ['libs/ui/src/index.ts'] } } }),
    'libs/ui/src/index.ts': 'export {}',
  }));
  assert.deepEqual(p.prefixosDeAlias, ['@org/ui']);
  assert.deepEqual(p.aliases[0], { chave: '@org/ui', alvos: ['libs/ui/src/index.ts'], base: '.' });
  assert.ok(p.segmentosDoBaseUrl.includes('libs'));
  const r = separarHerdados({ arquivos: [f('apps/web/a.ts')], diferemDaFoto: ['libs/ui/src/index.ts'], mexidosNaBase: [], bloqueados: new Set(),
    pacotes: { ...p, textos: textosPadrao() }, mapa: { files: parse(['apps/web/a.ts']), relations: [], unresolved: [{ from: 'apps/web/a.ts', specifier: '@org/ui' }] } });
  assert.deepEqual(r.herdados, [], 'o pacote declarado e local é do repositório');
});
