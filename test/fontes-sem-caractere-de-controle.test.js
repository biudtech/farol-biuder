// Achado real de 10/09/2026: um script de edição gravou um BACKSPACE (0x08) de verdade onde
// devia ir a sequência "\b" de uma regex. O fonte parecia certo em todo editor e em `grep`,
// o teste falhava sem explicação, e a regex silenciosamente deixou de casar. Caractere de
// controle em fonte é sempre engano.
//
// O caso morava em test/fila-justa-ui.test.js, junto do painel da fila da tela antiga. A tela
// saiu em 16/11/2026 e o invariante ficou, sobre os fontes do motor que ele já cobria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('INVARIANTE: nenhum fonte carrega caractere de controle invisível', () => {
  const raiz = path.join(import.meta.dirname, '..');
  const alvos = ['server.js', 'lib/engine/review.js', 'lib/engine/usage.js', 'lib/parse.js', 'lib/http-server.js'];
  const sujos = [];
  for (const rel of alvos) {
    const src = fs.readFileSync(path.join(raiz, rel), 'utf8');
    // tudo abaixo de 0x20 menos \t e \n (e \r, que o .gitattributes já persegue)
    const m = src.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
    if (m) sujos.push(`${rel}: ${m.length} ocorrência(s), primeira 0x${m[0].charCodeAt(0).toString(16)}`);
  }
  assert.deepEqual(sujos, [], 'caractere de controle no fonte: quase sempre uma sequência de escape que virou o byte de verdade');
});
