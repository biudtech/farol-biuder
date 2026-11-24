// Herdados e a ler no sync por herança (24/11/2026): herda o arquivo idêntico à foto da origem que
// a base não mexeu, que não depende de algo que o sync mudou e que não tem bloqueio aberto de
// rodada anterior. Todo o resto vai à leitura.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-separacao-'));
process.env.FAROL_HOME = home;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { separarHerdados, voltamPorDependencia } = await import('../lib/engine/sync-por-heranca.js');
const { arquivosComBloqueioAberto } = await import('../lib/engine/review-rounds.js');
const store = await import('../lib/engine/review-round-store.js');
const { STATE_DIR } = await import('../lib/paths.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const f = (caminho, extra = {}) => ({ path: caminho, sha: 'e'.repeat(40), status: 'modified', ...extra });
const mapaLimpo = (paths, extra = {}) => ({ files: paths.map((p) => ({ path: p, backend: 'babel', limitations: [] })), relations: [], unresolved: [], ...extra });
const separar = (over) => separarHerdados({ arquivos: [], diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), mapa: null, ...over });

test('idêntico à foto e base intocada: herdado', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa: mapaLimpo(['src/a.ts']) }).herdados, ['src/a.ts']);
});

test('idêntico à foto com a base tendo mexido: a ler (o sobrescrito)', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mexidosNaBase: ['src/a.ts'], mapa: mapaLimpo(['src/a.ts']) }).aLer, ['src/a.ts']);
});

test('diferente da foto: a ler', () => {
  assert.deepEqual(separar({ arquivos: [f('x.json')], diferemDaFoto: ['x.json'] }).aLer, ['x.json']);
});

test('renomeado: conta pelo caminho novo e pelo antigo', () => {
  assert.deepEqual(separar({ arquivos: [f('novo.md', { status: 'renamed', previousPath: 'velho.md' })], mexidosNaBase: ['velho.md'] }).aLer, ['novo.md']);
  assert.deepEqual(separar({ arquivos: [f('novo.md', { status: 'renamed', previousPath: 'velho.md' })] }).herdados, ['novo.md']);
});

test('protegido: a ler mesmo idêntico', () => {
  assert.deepEqual(separar({ arquivos: [f('.env.example')] }).aLer, ['.env.example']);
});

test('removido ou sem blob: a ler', () => {
  assert.deepEqual(separar({ arquivos: [f('velho.json', { status: 'removed', sha: '' })] }).aLer, ['velho.json']);
  assert.deepEqual(separar({ arquivos: [f('sem-blob.json', { sha: '' })] }).aLer, ['sem-blob.json']);
});

test('importa um misturado: volta à leitura', () => {
  const mapa = mapaLimpo(['src/guard.ts', 'src/mapa.ts'], { relations: [{ from: 'src/guard.ts', to: 'src/mapa.ts' }] });
  const r = separar({ arquivos: [f('src/guard.ts'), f('src/mapa.ts')], diferemDaFoto: ['src/mapa.ts'], mapa });
  assert.deepEqual(r.aLer.sort(), ['src/guard.ts', 'src/mapa.ts']);
});

test('importa arquivo que a base apagou (import relativo sem destino): volta à leitura', () => {
  const mapa = mapaLimpo(['src/painel.ts'], { unresolved: [{ from: 'src/painel.ts', specifier: './quadros-do-turno' }] });
  assert.deepEqual(separar({ arquivos: [f('src/painel.ts')], mexidosNaBase: ['src/quadros-do-turno.ts'], mapa }).aLer, ['src/painel.ts']);
});

test('importa arquivo que a base mudou, fora do diff: volta à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts'], { relations: [{ from: 'src/a.ts', to: 'src/util.ts' }] });
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mexidosNaBase: ['src/util.ts'], mapa }).aLer, ['src/a.ts']);
});

test('pacote externo não resolvido, declarado no package.json, não devolve à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts'], { unresolved: [{ from: 'src/a.ts', specifier: 'react' }] });
  const pacotes = { porPasta: { '': ['react'] }, workspace: [] };
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa, pacotes }).herdados, ['src/a.ts']);
});

test('dependência transitiva: importa um herdado que voltou à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts', 'src/b.ts', 'src/m.ts'], { relations: [{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/b.ts', to: 'src/m.ts' }] });
  assert.deepEqual(separar({ arquivos: [f('src/a.ts'), f('src/b.ts'), f('src/m.ts')], diferemDaFoto: ['src/m.ts'], mapa }).herdados, []);
});

test('código sem conferência de dependência volta; só o não código da lista fechada herda', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts'), f('app/x.py'), f('prisma/schema.prisma'), f('docs/x.md')], mapa: null }).herdados,
    ['docs/x.md']);
  const textual = { files: [{ path: 'src/a.ts', backend: 'textual', limitations: [] }], relations: [], unresolved: [] };
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa: textual }).aLer, ['src/a.ts']);
  const degradado = { files: [{ path: 'src/a.ts', backend: 'babel', limitations: ['parse-error'] }], relations: [], unresolved: [] };
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa: degradado }).aLer, ['src/a.ts']);
});

test('achado bloqueante aberto de rodada anterior: volta à leitura', () => {
  assert.deepEqual(separar({ arquivos: [f('x.json')], bloqueados: new Set(['x.json']) }).aLer, ['x.json']);
});

test('contextoAlterado junta o que a base mexeu e o que ficou a ler', () => {
  assert.deepEqual(separar({ arquivos: [f('x.json')], diferemDaFoto: ['x.json'], mexidosNaBase: ['y.ts'] }).contextoAlterado.sort(), ['x.json', 'y.ts']);
});

test('voltamPorDependencia é pura e chega ao ponto fixo', () => {
  const mapa = mapaLimpo(['a.ts', 'b.ts'], { relations: [{ from: 'a.ts', to: 'b.ts' }, { from: 'b.ts', to: 'c.ts' }] });
  assert.deepEqual([...voltamPorDependencia(['a.ts', 'b.ts'], new Set(['c.ts']), mapa)].sort(), ['a.ts', 'b.ts']);
  assert.deepEqual([...voltamPorDependencia(['a.ts'], new Set(), mapaLimpo(['a.ts']))], []);
});

test('arquivosComBloqueioAberto: os arquivos dos bloqueios da fronteira; memória ilegível dá null', () => {
  const engine = { accountForPr: () => 'eu' };
  const pr = { key: 'acme/api#1', repo: 'acme/api', number: 1 };
  assert.deepEqual([...arquivosComBloqueioAberto(engine, pr)], [], 'sem memória, nenhum bloqueio');
  const scope = store.scopeFor(pr.key, 'eu');
  const bloqueio = { id: `${'a'.repeat(32)}:f1`, file: 'src/a.ts', line: 1, severity: 'blocking', title: 'Contrato', summary: 'O consumidor falha.', ref: null, status: null, evidence: '' };
  const semArquivo = { ...bloqueio, id: `${'a'.repeat(32)}:f2`, file: '' };
  store.saveRound({ schema: 1, id: 'a'.repeat(32), scope, parents: [], headSha: 'h1', baseSha: 'b1', at: 1,
    findings: [bloqueio, semArquivo], unresolved: [bloqueio, semArquivo], files: [{ path: 'src/a.ts', sha: 'blob1' }] });
  assert.deepEqual([...arquivosComBloqueioAberto(engine, pr)], ['src/a.ts']);
  const outro = { key: 'acme/api#2', repo: 'acme/api', number: 2 };
  const pasta = path.join(STATE_DIR, 'review-rounds');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, encodeURIComponent(store.scopeFor(outro.key, 'eu'))), 'não é pasta');
  assert.equal(arquivosComBloqueioAberto(engine, outro), null);
});

// Revisão final de 24/11/2026: import por alias que o mapa não resolveu é dependência do repositório
// que não deu para conferir (o arquivo que a base apagou, importado pelo alias), e não pacote externo.
test('import por alias que o mapa não resolveu: volta à leitura', () => {
  const mapa = mapaLimpo(['src/guard.ts'], { unresolved: [{ from: 'src/guard.ts', specifier: '@common/mapa-de-zonas', alias: true }] });
  assert.deepEqual(separar({ arquivos: [f('src/guard.ts')], mapa }).aLer, ['src/guard.ts']);
});

test('mapa com alias não interpretado: import não relativo sem destino volta à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts'], { unresolved: [{ from: 'src/a.ts', specifier: '@app/qualquer' }],
    limitations: ['tsconfig.json: extends não expandido; resolução de aliases é parcial.'] });
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa }).aLer, ['src/a.ts']);
});

test('o mapa marca o import que casou um alias e não achou destino', async () => {
  const { buildMap } = await import('../lib/review-context/map.js');
  const { createHash } = await import('node:crypto');
  const digest = (t) => createHash('sha1').update(t).digest('hex');
  const arvore = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@common/*': ['common/*'] } } }),
    'src/guard.ts': "import { zonas } from '@common/apagado'; import React from 'react'; export const g = zonas;",
  };
  const fonte = { manifest: { scope: { host: 'github.com', account: 'f', repo: 'o/r', repositoryId: 1 }, H: 'a'.repeat(40), B: 'b'.repeat(40), M: 'c'.repeat(40) },
    reader: {
      tree: async () => ({ complete: true, entries: Object.entries(arvore).map(([p, t]) => ({ path: p, blob: digest(t), type: 'blob', size: t.length })) }),
      read: async (p) => (typeof arvore[p] === 'string' ? { status: 'available', text: arvore[p], path: p, blob: digest(arvore[p]), commit: 'a'.repeat(40) } : { status: 'unavailable' }),
    } };
  const mapa = await buildMap(fonte);
  const alias = mapa.head.unresolved.find((u) => u.specifier === '@common/apagado');
  const pacote = mapa.head.unresolved.find((u) => u.specifier === 'react');
  assert.equal(alias.alias, true);
  assert.equal(pacote.alias, undefined);
});
