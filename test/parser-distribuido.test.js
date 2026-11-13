import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-parser-distribuido-'));
process.env.FAROL_HOME = path.join(scratch, 'home');
const raiz = path.resolve(import.meta.dirname, '..');
const { validarParserDistribuido, carregarParserDistribuido } = await import('../lib/parser-runtime.js');
const { packageElectronRequirement } = await import('../lib/electron-runtime.js');
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function novaPasta(nome) { return fs.mkdtempSync(path.join(scratch, nome)); }
function escrever(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function pacote() {
  const dir = novaPasta('pacote-');
  const engines = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).engines;
  escrever(dir, 'package.json', JSON.stringify({ name: 'farol', type: 'module', version: '9.9.9', engines, dependencies: { electron: '^44.1.0' } }));
  escrever(dir, 'server.js', '// entrada sintética');
  fs.cpSync(path.join(raiz, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.cpSync(path.join(raiz, 'assets/third-party'), path.join(dir, 'assets/third-party'), { recursive: true });
  return dir;
}

test('artefato oficial tem versão, bytes, hash e licença fixados, sem dependência npm de runtime', () => {
  const manifest = validarParserDistribuido(raiz, true);
  assert.equal(manifest.version, '7.28.5');
  assert.equal(manifest.files['dist/parser.cjs'].bytes, 512279);
  assert.equal(manifest.files['dist/parser.cjs'].sha256, '4fad5d076afb8c346159a06bb942d6e14c6167d590082b7c3bdebd4c108af201');
  assert.equal(manifest.files.LICENSE.sha256, '2e97627cb278aa7556fb9e8817368302301a595b6c7582512b8d74c57b773652');
  const parser = carregarParserDistribuido();
  const ast = parser.parse("import type { Props } from './props'; export const View = (p: Props) => <div>{p.label}</div>",
    { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  assert.equal(ast.program.body[0].importKind, 'type');
  assert.equal(ast.program.body.length, 2);
});

test('artefato ausente, alterado ou de versão incorreta é recusado pelo requisito de runtime do pacote', () => {
  for (const defect of ['ausente', 'alterado', 'versao']) {
    const source = pacote();
    const artifact = path.join(source, 'assets/third-party/babel-parser/dist/parser.cjs');
    if (defect === 'ausente') fs.unlinkSync(artifact);
    if (defect === 'alterado') fs.appendFileSync(artifact, '\n// corrupção sintética');
    if (defect === 'versao') {
      const file = path.join(source, 'assets/third-party/babel-parser/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); manifest.version = '0.0.0';
      fs.writeFileSync(file, JSON.stringify(manifest));
    }
    assert.throws(() => packageElectronRequirement(path.join(source, 'package.json')), /Parser distribuído ausente ou inválido/);
  }
});

// engine-ai#1031 (11/11/2026): controller NestJS caía no modo textual e negava dívida anterior.
test('TypeScript com decorators é lido pelo parser, e não pelo modo textual', async () => {
  const { parseFile } = await import('../lib/review-context/syntax.js');
  const text = ["import { Controller, Get } from '@nestjs/common';", "import { ler } from './ler';", '',
    "@Controller('turno')", 'export class TurnoController {', "  @Get(':id')", '  ler() { return ler(); }', '}'].join('\n');
  const r = parseFile({ path: 'turno.controller.ts', blob: 'a'.repeat(40), text });
  assert.notEqual(r.backend, 'textual');
  assert.deepEqual(r.imports.map((i) => i.specifier).sort(), ['./ler', '@nestjs/common']);
});
