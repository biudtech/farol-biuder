// A régua comum de herança: o que difere de uma foto (commit da origem) e o que a base mexeu
// desde o ancestral comum com ela. Extraída da herança da production para servir também ao sync.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { compararComAFoto, ehAncestral, arquivosDe, TETO_DA_COMPARACAO } = await import('../lib/engine/regua-de-heranca.js');

const FOTO = 'a'.repeat(40), HEAD = 'b'.repeat(40), P1 = 'c'.repeat(40), ANC = 'd'.repeat(40);
const engine = { ghEnv: () => ({}) };
const runReal = io.run;
let gh;

io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (gh.falha && sub.includes(gh.falha)) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
  const m = /compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/.exec(sub);
  const c = m && gh.comparacoes[`${m[1]}...${m[2]}`];
  if (!c) return { ok: false, code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
  return { ok: true, code: 0, stdout: JSON.stringify(c), stderr: '' };
};
after(() => { io.run = runReal; });
beforeEach(() => { gh = { comparacoes: {}, falha: '' }; });

const comparar = () => compararComAFoto(engine, 'eu', 'acme/api', { foto: FOTO, head: HEAD, baseDaResolucao: P1 });

test('foto ancestral do head e base com mudança própria: as duas listas, rename pelos dois caminhos', async () => {
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: FOTO, behind: 0, files: [{ filename: 'a.ts' }] };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: FOTO, mergeBase: ANC, behind: 3, files: [{ filename: 'b.ts', previous_filename: 'b-antigo.ts' }] };
  assert.deepEqual(await comparar(), { diferemDaFoto: ['a.ts'], mexidosNaBase: ['b.ts', 'b-antigo.ts'] });
});

test('head que não contém a foto: null', async () => {
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: ANC, behind: 1, files: [] };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: FOTO, mergeBase: ANC, behind: 3, files: [] };
  assert.equal(await comparar(), null);
});

test('comparação no teto de 300 arquivos: null', async () => {
  const muitos = Array.from({ length: TETO_DA_COMPARACAO }, (_, i) => ({ filename: `f${i}.ts` }));
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: FOTO, behind: 0, files: muitos };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: FOTO, mergeBase: ANC, behind: 3, files: [] };
  assert.equal(await comparar(), null);
});

test('leitura que falha: null', async () => {
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: FOTO, behind: 0, files: [] };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: FOTO, mergeBase: ANC, behind: 3, files: [] };
  gh.falha = `${FOTO}...${P1}`;
  assert.equal(await comparar(), null);
});

test('base cuja comparação não parte da foto: null', async () => {
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: FOTO, behind: 0, files: [] };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: ANC, mergeBase: ANC, behind: 3, files: [] };
  assert.equal(await comparar(), null);
});

test('ehAncestral exige behind 0 e o merge-base na própria ponta', () => {
  assert.equal(ehAncestral({ base: FOTO, mergeBase: FOTO, behind: 0 }, FOTO), true);
  assert.equal(ehAncestral({ base: FOTO, mergeBase: ANC, behind: 0 }, FOTO), false);
  assert.equal(ehAncestral({ base: FOTO, mergeBase: FOTO, behind: 2 }, FOTO), false);
  assert.equal(ehAncestral(null, FOTO), false);
});

test('arquivosDe recusa forma torta', () => {
  assert.equal(arquivosDe({ files: [{ filename: '' }] }), null);
  assert.equal(arquivosDe({}), null);
  assert.deepEqual(arquivosDe({ files: [] }), []);
});
