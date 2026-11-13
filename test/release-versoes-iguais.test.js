// Plano 4 do Farol nativo, Task 5 (decisão R-F): as versões das duas cascas andam juntas.
// A casca do macOS (MARKETING_VERSION e CURRENT_PROJECT_VERSION, que a Sparkle usa para
// ordenar) e a do Windows (Identity/@Version, quarto campo 0) têm a MESMA versão. As duas
// travas que ligavam essa versão ao motor (engines.farolShell e major igual) saíram com o
// pacote de distribuição.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function extrair(texto, regex, onde) {
  const m = regex.exec(texto);
  assert.ok(m, `${onde}: linha de versao ausente`);
  return m[1];
}

function versoes() {
  const yml = ler('shell/mac/project.yml');
  const marketing = extrair(yml, /^\s*MARKETING_VERSION:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m, 'project.yml MARKETING_VERSION');
  const build = extrair(yml, /^\s*CURRENT_PROJECT_VERSION:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m, 'project.yml CURRENT_PROJECT_VERSION');
  const identidade = extrair(ler('shell/win/Farol.App/Package.appxmanifest'), /<Identity\b([^>]*)>/, 'Package.appxmanifest Identity');
  const win = extrair(identidade, /\bVersion="(\d+\.\d+\.\d+\.\d+)"/, 'Package.appxmanifest Identity/@Version');
  return { marketing, build, win };
}

test('as duas cascas tem a mesma versao, e o quarto campo do Windows e 0', () => {
  const v = versoes();
  assert.equal(v.marketing, v.build, 'MARKETING_VERSION e CURRENT_PROJECT_VERSION andam juntas');
  const [a, b, c, d] = v.win.split('.');
  assert.equal(`${a}.${b}.${c}`, v.marketing, 'Package.appxmanifest e project.yml divergem');
  assert.equal(d, '0', 'o quarto campo da Version do MSIX e sempre 0');
});
