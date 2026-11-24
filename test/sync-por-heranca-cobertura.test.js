// Os herdados do sync cobertos pelo motor (24/11/2026): o bloco de prova diz de onde vieram, a
// cobertura os põe em coverage.inherited (mesmo o que a sessão declarou ter lido), o alcance é
// cobrado só dos arquivos a ler, e o índice entre PRs nunca recebe um herdado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-cobertura-'));
process.env.FAROL_HOME = home;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { fileProofBlock, prepararCoberturaParaOGate, coverageGap, salvarProvaDaSessao, readFileProof } = await import('../lib/engine/file-proof.js');
const { registrarNoIndiceDoRepositorio } = await import('../lib/engine/prova-do-repositorio.js');
const { alvosDoAlcance } = await import('../lib/engine/alcance.js');
const { FOTO, P1, HEAD_DO_SYNC: HEAD } = await import('./helpers/github-do-sync.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const pr = { key: 'acme/api#1', repo: 'acme/api', number: 1 };
const arquivo = (p) => ({ path: p, sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' });
const arquivos = [arquivo('src/a.ts'), arquivo('src/b.ts'), arquivo('docs/x.md')];
const sync = { origem: 'homologation', destino: 'development', foto: FOTO, baseDaResolucao: P1, commits: 4, herdados: ['src/b.ts', 'docs/x.md'], aLer: ['src/a.ts'], contextoAlterado: ['src/a.ts'] };
const heranca = { ativa: true, unchanged: ['src/b.ts', 'docs/x.md'], changed: ['src/a.ts'], alcance: {},
  origens: { 'src/b.ts': { origem: 'homologation', foto: FOTO }, 'docs/x.md': { origem: 'homologation', foto: FOTO } }, sync };

test('bloco de prova com a variante do sync e só os a ler como alterados', () => {
  const b = fileProofBlock(heranca, '');
  assert.match(b, /idêntico à ponta da homologation \(commit 158c3d8\), já revisado nos PRs de origem/);
  assert.match(b, /Arquivos herdados do sync \(2\):/);
  assert.match(b, /ALTERADOS desde a leitura anterior \(1\):\n- src\/a\.ts/);
  assert.doesNotMatch(b, /SEM alcance conferido[\s\S]*src\/b\.ts/);
  assert.doesNotMatch(b, /lido em homologation/);
});

test('herdado declarado como lido fica em coverage.inherited e fora do índice', () => {
  const result = { coverage: { total: 3, reviewed: ['src/a.ts', 'src/b.ts'], missing: [] }, analysisStatus: 'complete' };
  prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.deepEqual(result.coverage.inherited.sort(), ['docs/x.md', 'src/b.ts']);
  assert.deepEqual(result.herancaDoSync.herdados.sort(), ['docs/x.md', 'src/b.ts']);
  assert.equal(result.herancaDoSync.lidos, 1);
  assert.deepEqual(result.herancaDoSync.contextoAlterado, ['src/a.ts']);
  assert.equal(registrarNoIndiceDoRepositorio(pr, HEAD, arquivos, result, {}), 1, 'só o lido entra no índice');
});

test('marca de herança do sync escrita pelo modelo é descartada', () => {
  const result = { coverage: { total: 1, reviewed: ['src/a.ts'], missing: [] }, herancaDoSync: { herdados: ['src/a.ts'] }, sincronizacao: { origem: 'x' } };
  prepararCoberturaParaOGate(result, [arquivo('src/a.ts')], { ativa: false, unchanged: [], changed: ['src/a.ts'] });
  assert.equal(result.herancaDoSync, undefined);
});

test('envelope sem cobertura não ganha a herança do sync: continua lacuna', () => {
  const result = { analysisStatus: 'complete' };
  prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.equal(result.herancaDoSync, undefined);
  assert.deepEqual(coverageGap(result).slice(0, 1), ['a revisão não declarou a cobertura da leitura']);
});

test('cobertura sem lacuna com só os lidos declarados, e alcance só dos a ler', () => {
  const result = { coverage: { total: 3, reviewed: ['src/a.ts'], missing: ['src/b.ts', 'docs/x.md'] },
    alcance: [{ alterado: 'src/a.ts', chamadores: [], semChamador: 'sem uso fora do diff nesta fixture' }] };
  prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.deepEqual(alvosDoAlcance(result), ['src/a.ts']);
  assert.deepEqual(coverageGap(result), []);
});

test('a origem do sync sobrevive na prova gravada', () => {
  const resultComHeranca = { coverage: { total: 3, reviewed: ['src/a.ts'], missing: ['src/b.ts', 'docs/x.md'] } };
  prepararCoberturaParaOGate(resultComHeranca, arquivos, heranca);
  salvarProvaDaSessao(pr, HEAD, arquivos, resultComHeranca, null);
  assert.deepEqual(readFileProof(pr.key).origens['src/b.ts'], { origem: 'homologation', foto: FOTO });
});
