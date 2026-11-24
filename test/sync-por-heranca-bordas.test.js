// As bordas do mundo fechado (24/11/2026, revisão do mundo fechado): código dentro de uma pasta
// `prisma/` também contamina pelo grafo, documentação importada por código contamina quando muda,
// o caminho antigo do renomeado conta como mudado, o lockfile é reconhecido pelo nome exato e a
// leitura do texto dos herdados tem teto.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { separarHerdados, candidatosDoSync } = await import('../lib/engine/sync-por-heranca.js');
const { ehCodigo, ehConfiguracao } = await import('../lib/engine/dependencia-do-sync.js');
const { pacotesDoRepositorio } = await import('../lib/engine/repositorio-do-sync.js');

const f = (c) => ({ path: c, sha: 'e'.repeat(40), status: 'modified' });
const parse = (ps) => ps.map((p) => ({ path: p, backend: 'babel', limitations: [] }));
const textos = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? 'export const x = 1;' : undefined) });
const P = { porPasta: { '': ['@prisma/client'] }, workspace: [], prefixosDeAlias: [], aliases: [], segmentosDoBaseUrl: [], textos };
const sep = (o) => separarHerdados({ diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), pacotes: P, ...o });

test('código mudado dentro de uma pasta prisma/ contamina pelo grafo', () => {
  const r = sep({ arquivos: [f('src/orders/orders.service.ts'), f('src/prisma/where-builder.ts')], diferemDaFoto: ['src/prisma/where-builder.ts'],
    mapa: { files: parse(['src/orders/orders.service.ts', 'src/prisma/where-builder.ts']),
      relations: [{ from: 'src/orders/orders.service.ts', to: 'src/prisma/where-builder.ts', specifier: '../prisma/where-builder' }], unresolved: [] } });
  assert.deepEqual(r.herdados, []);
});

test('documentação ou imagem importada por código contamina quando muda; a que ninguém importa não', () => {
  const md = sep({ arquivos: [f('src/agent.ts'), f('src/prompts/system.md')], diferemDaFoto: ['src/prompts/system.md'],
    mapa: { files: parse(['src/agent.ts']), relations: [{ from: 'src/agent.ts', to: 'src/prompts/system.md', specifier: './prompts/system.md' }], unresolved: [] } });
  assert.deepEqual(md.herdados, []);
  const svg = sep({ arquivos: [f('src/Logo.tsx'), f('src/logo.svg')], diferemDaFoto: ['src/logo.svg'],
    mapa: { files: parse(['src/Logo.tsx']), relations: [{ from: 'src/Logo.tsx', to: 'src/logo.svg', specifier: './logo.svg' }], unresolved: [] } });
  assert.deepEqual(svg.herdados, []);
  const solta = sep({ arquivos: [f('src/agent.ts')], diferemDaFoto: ['docs/LEIAME.md'],
    mapa: { files: parse(['src/agent.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(solta.herdados, ['src/agent.ts']);
});

test('o caminho antigo do renomeado conta como mudado: .babelrc renomeado para docs/x.md é impacto global', () => {
  const r = sep({ arquivos: [f('src/a.ts'), { path: 'docs/x.md', previousPath: '.babelrc', sha: 'a'.repeat(40), status: 'renamed' }],
    diferemDaFoto: ['docs/x.md'], mapa: { files: parse(['src/a.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(r.herdados, []);
});

test('lockfile pelo nome exato: clock, Block e redis-lock voltam a ser código', () => {
  for (const p of ['src/clock.ts', 'src/Block.tsx', 'src/redis-lock.service.ts', 'src/lockfile.ts']) {
    assert.equal(ehCodigo(p), true, p);
    assert.equal(ehConfiguracao(p), false, p);
  }
  for (const p of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'composer.lock', 'Gemfile.lock',
    'Cargo.lock', 'poetry.lock', 'go.sum', 'apps/api/package-lock.json', 'src/database.config.ts']) {
    assert.equal(ehConfiguracao(p), true, p);
  }
});

test('candidatosDoSync: só os idênticos, fora do bloqueio e com blob', () => {
  const arquivos = [f('a.ts'), f('b.ts'), f('c.ts'), { path: 'd.ts', sha: '', status: 'modified' }];
  assert.deepEqual(candidatosDoSync(arquivos, { diferemDaFoto: ['b.ts'], mexidosNaBase: [] }, new Set(['c.ts'])), ['a.ts']);
});

function fonte(arvore, lidos = []) {
  return { reader: {
    tree: async () => ({ complete: true, entries: Object.keys(arvore).map((p) => ({ path: p, type: 'blob' })) }),
    read: async (p) => { lidos.push(p); return typeof arvore[p] === 'string' ? { status: 'available', text: arvore[p] } : { status: 'unavailable' }; },
  } };
}

test('teto da leitura dos textos: passou da contagem ou do prazo, os demais ficam sem texto', async () => {
  const arvore = { 'package.json': '{}', 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' };
  const porContagem = await pacotesDoRepositorio(fonte(arvore), ['a.ts', 'b.ts', 'c.ts'], { tetoDeTextos: 2 });
  assert.deepEqual(Object.keys(porContagem.textos), ['a.ts', 'b.ts']);
  let relogio = 0;
  const porPrazo = await pacotesDoRepositorio(fonte(arvore), ['a.ts', 'b.ts', 'c.ts'], { prazoDosTextosMs: 10, agora: () => (relogio += 6) });
  assert.ok(Object.keys(porPrazo.textos).length < 3, 'o prazo corta a leitura');
  const r = sep({ arquivos: [f('a.ts'), f('b.ts'), f('c.ts')], pacotes: { ...P, textos: porContagem.textos },
    mapa: { files: parse(['a.ts', 'b.ts', 'c.ts']), relations: [], unresolved: [] } });
  assert.deepEqual(r.herdados, ['a.ts', 'b.ts'], 'sem texto, volta à leitura');
});

test('o texto que o mapa já tem não é lido de novo', async () => {
  const lidos = [];
  const p = await pacotesDoRepositorio(fonte({ 'package.json': '{}', 'a.ts': 'a', 'b.ts': 'b' }, lidos), ['a.ts', 'b.ts'], { textosConhecidos: { 'a.ts': 'do mapa' } });
  assert.deepEqual(p.textos, { 'a.ts': 'do mapa', 'b.ts': 'b' });
  assert.equal(lidos.includes('a.ts'), false);
});
