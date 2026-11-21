// Contrato externo e fronteira de recusa: nenhum motor ou install é iniciado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { packageNodeRequirement, nodeVersionSatisfies, assertExternalNodeRuntime, plataformaSuportada } from '../lib/node-runtime.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-node-runtime-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('contrato suporta piso 24.22.1 e patches da linha 24, sem prometer Node 22 ou majors futuras', () => {
  const range = packageNodeRequirement();
  assert.equal(range, '>=24.22.1 <25');
  for (const version of ['24.22.1', '24.22.2', '24.23.0']) assert.equal(nodeVersionSatisfies(version, range), true, version);
  for (const version of ['22.12.0', '24.0.0', '24.14.9', '24.15.0', '24.15.9', '24.16.0', '24.19.0', '24.22.0', '25.0.0', '26.0.0', '24.22.1-rc.1', 'indisponivel']) {
    assert.equal(nodeVersionSatisfies(version, range), false, version);
    assert.throws(() => assertExternalNodeRuntime({ version }), /Node.*incompatível.*Node >=24\.22\.1 <25.*nvm install/);
  }
});

test('CLI recusa runtime incompatível com mensagem acionável e código 1', () => {
  const manifest = path.join(scratch, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ engines: { node: '>=99.0.0 <100' } }));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'lib/node-runtime.js'), manifest], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /incompatível.*nvm install.*instalação existente foi preservada/);
  assert.equal(result.stdout, '');
});

test('manifesto ausente ou range aberto não é aceito como suporte', () => {
  const manifest = path.join(scratch, 'invalid.json');
  for (const engines of [{}, { node: '>=24.22.1' }, { node: '24' }]) {
    fs.writeFileSync(manifest, JSON.stringify({ engines }));
    assert.throws(() => packageNodeRequirement(manifest), /Contrato Node ausente ou inválido/);
  }
});

test('lockfile, versão local e CI preservam o piso e o Linux', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].engines.node, packageNodeRequirement());
  assert.equal(fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(), '24.22.1');
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  // cinco jobs: o gate do motor, o do front (web), a imagem do container, o agregador `ci`, que
  // exige os três, e o pacote do front para a hospedagem compartilhada, só na main. O Node do job
  // `imagem` é o do Dockerfile, travado em test/imagem-do-motor.test.js, e não um setup-node.
  assert.equal((workflow.match(/node-version: '24\.22\.1'/g) || []).length, 3);
  assert.equal((workflow.match(/runs-on: ubuntu-latest/g) || []).length, 5);
  assert.doesNotMatch(workflow, /windows-latest|macos-latest/);
  assert.match(workflow, /needs: \[gate, web, imagem\]/);
  assert.match(workflow, /needs\.gate\.result/);
  assert.match(workflow, /needs\.web\.result/);
  assert.match(workflow, /needs\.imagem\.result/);
});

test('o job da imagem constrói e prova, e nada no workflow publica', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /^  imagem:\n    name: imagem\n    runs-on: ubuntu-latest\n    timeout-minutes: \d+\n    permissions:\n      contents: read$/m);
  assert.match(workflow, /bash tools\/provar-imagem\.sh farol-biuder-motor:ci/);
  // sem push, sem login em registro e sem permissão de escrita em lugar nenhum
  assert.doesNotMatch(workflow, /docker (push|login)|--push|packages: write|id-token: write|contents: write|secrets\./);
  assert.equal((workflow.match(/^\s+permissions:$/gm) || []).length + (workflow.match(/^permissions:$/gm) || []).length, 2, 'só o do topo e o do job da imagem');
  // as ações são as que o arquivo já usava, na mesma versão, mais o upload do pacote do front,
  // que fica como artefato do próprio run e não vai para registro nenhum
  const acoes = [...new Set([...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(acoes, ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/upload-artifact@v7']);
  const script = fs.readFileSync(path.join(ROOT, 'tools/provar-imagem.sh'), 'utf8');
  assert.equal(script.includes(String.fromCharCode(13)), false, 'script de shell com CRLF não roda em Linux');
  assert.doesNotMatch(script, /docker (push|login)/);
});

test('o motor roda só em Linux: win32 e darwin são recusados', () => {
  assert.equal(plataformaSuportada('win32'), false);
  assert.equal(plataformaSuportada('darwin'), false);
  assert.equal(plataformaSuportada('linux'), true);
  assert.throws(() => assertExternalNodeRuntime({ version: '24.22.1', plataforma: 'win32' }), /O motor do Farol roda só em Linux\./);
  assert.throws(() => assertExternalNodeRuntime({ version: '24.22.1', plataforma: 'darwin' }), /O motor do Farol roda só em Linux\./);
  assert.equal(assertExternalNodeRuntime({ version: '24.22.1', plataforma: 'linux' }), '24.22.1');
});
