// A herança do sync na leitura da revisão (24/11/2026): medida antes da sessão, ela entra como
// terceira fonte de herança, com a origem e a foto, e flui pelo que a herança já alimenta (o
// fan-out, o escopo materializado e a prova). Medição que falha deixa a revisão de hoje.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-leitura-'));
process.env.FAROL_HOME = home;

import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const analysis = await import('../lib/engine/analysis-source.js');
const { splitByProof, saveFileProof } = await import('../lib/engine/file-proof.js');
const { metricsIncrementais } = await import('../lib/engine/fanout.js');
const { FOTO, P1, BASE_PONTA, HEAD_DO_SYNC: HEAD, cenarioDoSync, stubDoSync } = await import('./helpers/github-do-sync.js');

const { prepareReviewReading, sourceRuntime } = analysis;
const original = { ...sourceRuntime };
const runReal = io.run;
afterEach(() => { Object.assign(sourceRuntime, original); io.run = runReal; });
after(() => fs.rmSync(home, { recursive: true, force: true }));

const pr = { key: 'acme/api#1', repo: 'acme/api', number: 1 };
const arquivo = (p, extra = {}) => ({ path: p, sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available', ...extra });
const ARQUIVOS = [arquivo('src/a.ts'), arquivo('src/b.ts'), arquivo('docs/x.md')];
let cenario;
let baseDoPr;
let opcoesDoMapa;
let chamadasDoMapa;
let e;
const id = 's1';

function fonte() {
  return { status: 'complete', manifest: { H: HEAD, B: BASE_PONTA, M: 'c'.repeat(40), files: ARQUIVOS, limitations: [] }, reader: {},
    inventory: { status: 'complete', headSha: HEAD, baseSha: BASE_PONTA, baseRef: baseDoPr, files: ARQUIVOS, changedFiles: ARQUIVOS.length },
    release: async () => {} };
}
const mapa = (complete = true) => ({ complete, head: { files: [{ path: 'src/a.ts', backend: 'babel', limitations: [] }, { path: 'src/b.ts', backend: 'babel', limitations: [] }],
  relations: [], unresolved: [], metrics: { files: 2 } }, previous: { files: [], relations: [], unresolved: [], metrics: { files: 0 } }, limitations: [] });

function motor() {
  return { config: { reviewContextMode: 'off' }, activeReviews: new Map([[id, { mode: 'auto', cancellable: true }]]), running: new Map(),
    decisions: { pending: [], resolved: [] }, log() {}, pushState() {}, killTree() {},
    accountForPr: () => 'eu', tokenFor: () => 'token', ghEnv: () => ({}) };
}

beforeEach(() => {
  cenario = cenarioDoSync();
  cenario.comparacoes[`${FOTO}...${HEAD}`] = { behind: 0, mergeBase: FOTO, files: ['src/a.ts'] };
  chamadasDoMapa = 0;
  baseDoPr = 'development';
  opcoesDoMapa = null;
  io.run = stubDoSync(cenario);
  sourceRuntime.prepareSources = async () => fonte();
  sourceRuntime.buildMap = async (_fonte, opcoes) => { chamadasDoMapa += 1; opcoesDoMapa = opcoes; return mapa(); };
  e = motor();
  fs.rmSync(path.join(home, 'workspace', 'state', 'file-proof'), { recursive: true, force: true });
});

test('sync com herdados: a terceira fonte entra com a origem e a foto', async () => {
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.deepEqual(r.inheritance.unchanged.sort(), ['docs/x.md', 'src/b.ts']);
  assert.deepEqual(r.inheritance.changed, ['src/a.ts']);
  assert.deepEqual(r.inheritance.origens['src/b.ts'], { origem: 'homologation', foto: FOTO });
  assert.deepEqual(r.inheritance.sync.aLer, ['src/a.ts']);
  assert.equal(r.inheritance.sync.origem, 'homologation');
  assert.ok(cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${P1}`)), 'a régua é o primeiro pai');
  assert.ok(!cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${BASE_PONTA}`)), 'nunca a ponta atual da base');
});

test('o escopo materializado só tem os arquivos a ler, e a sessão guarda os herdados', async () => {
  const r = await prepareReviewReading(e, pr, id, HEAD);
  const s = e.activeReviews.get(id);
  assert.equal(s.totalArquivos, 1);
  assert.deepEqual(s.herancaDoSync.sort(), ['docs/x.md', 'src/b.ts']);
  assert.equal(fs.existsSync(path.join(r.scope.root, 'src/b.ts')), false);
  assert.equal(fs.existsSync(path.join(r.scope.root, 'src/a.ts')), true);
  const fonteGravada = JSON.parse(fs.readFileSync(r.scope.root + '.source.json', 'utf8'));
  assert.equal(fonteGravada.files.length, 3, 'a consulta da fonte segue com todos os arquivos');
});

test('metricsIncrementais conta só os arquivos a ler', async () => {
  const heranca = (await prepareReviewReading(e, pr, id, HEAD)).inheritance;
  const m = metricsIncrementais({ lines: 30, changedFiles: 3, files: [{ path: 'src/a.ts', lines: 10 }, { path: 'src/b.ts', lines: 10 }, { path: 'docs/x.md', lines: 10 }] }, heranca);
  assert.deepEqual([m.changedFiles, m.lines], [1, 10]);
});

test('medição que falha: a herança de hoje, sem sync e sem mapa a mais', async () => {
  cenario.falhas = ['graphql'];
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(r.inheritance.ativa, false);
  assert.equal(chamadasDoMapa, 0);
  assert.equal(e.activeReviews.get(id).totalArquivos, 3);
});

test('relançamento no mesmo head fora da complementar: sem sync', async () => {
  saveFileProof(pr.key, { head: HEAD, at: Date.now(), files: ARQUIVOS, reviewed: ['src/a.ts'], alcance: {}, observados: [], origens: {} });
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(cenario.chamadas.length, 0, 'nem mede');
});

test('modo assist com mapa incompleto: os herdados voltam e o sync sai', async () => {
  e.config.reviewContextMode = 'assist';
  sourceRuntime.buildMap = async () => { chamadasDoMapa += 1; return mapa(false); };
  sourceRuntime.selectContext = async () => ({ schema: 1, snippets: [], references: [], omitted: [], limitations: [], impactedPaths: [], metrics: {} });
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(e.activeReviews.get(id).herancaDoSync, undefined);
});

test('prova com origem do sync não herda pela prova do PR', () => {
  const prova = { head: 'f'.repeat(40), files: [arquivo('src/b.ts')], reviewed: ['src/b.ts'], origens: { 'src/b.ts': { origem: 'homologation', foto: FOTO } } };
  assert.deepEqual(splitByProof([arquivo('src/b.ts')], prova).changed, ['src/b.ts']);
});

// Revisão independente de 24/11/2026: o PR comum não paga a consulta de procedência nem o mapa.
test('base que não é contínua nem bancada: nem consulta a procedência', async () => {
  baseDoPr = 'feat/qualquer';
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(cenario.chamadas.length, 0);
  assert.equal(chamadasDoMapa, 0);
});

test('sem o nome da base no preparo: nem consulta a procedência', async () => {
  baseDoPr = undefined;
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(cenario.chamadas.length, 0);
});

test('com o contexto desligado, o mapa do sync monta só o lado do head', async () => {
  await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(opcoesDoMapa.soHead, true);
});
