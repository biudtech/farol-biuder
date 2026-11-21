// A escala única de espaçamento (20/11/2026): margin, padding e gap dos CSS modules saem das
// variáveis --esp-* de globals.css, e não de valor solto em px. Só o traço de 1 px fica literal.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(import.meta.dirname, '..');
const GLOBAIS = fs.readFileSync(path.join(RAIZ, 'app/globals.css'), 'utf8');

function modulos(pasta: string): string[] {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(pasta, e.name);
    if (e.isDirectory()) return modulos(caminho);
    return e.name.endsWith('.module.css') ? [caminho] : [];
  });
}

const PROPRIEDADE = /(?<![\w-])((?:margin|padding)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*([^;{}]+)/g;

describe('escala de espaçamento', () => {
  it('globals.css define a escala e os quatro espaços de nome próprio', () => {
    for (const [nome, valor] of [['meio', '2px'], ['1', '4px'], ['2', '8px'], ['3', '12px'], ['4', '16px'], ['5', '20px'], ['6', '24px'], ['7', '32px'], ['8', '48px'], ['9', '64px']]) {
      expect(GLOBAIS).toContain(`--esp-${nome}: ${valor};`);
    }
    for (const [nome, passo] of [['secoes', '6'], ['cartoes', '3'], ['cartao', '5'], ['cabecalho', '6']]) expect(GLOBAIS).toContain(`--esp-${nome}: var(--esp-${passo});`);
  });

  it('nenhum CSS module usa valor solto em px para margin, padding ou gap', () => {
    const soltos: string[] = [];
    for (const arquivo of modulos(path.join(RAIZ, 'componentes'))) {
      const css = fs.readFileSync(arquivo, 'utf8');
      for (const m of css.matchAll(PROPRIEDADE)) {
        const px = (m[2] ?? '').match(/\d+(?:\.\d+)?px/g) ?? [];
        if (px.some((v) => v !== '1px')) soltos.push(`${path.relative(RAIZ, arquivo)}: ${m[0]}`);
      }
    }
    expect(soltos).toEqual([]);
  });

  it('cartão, lista de cartões, página e cabeçalho usam os espaços de nome próprio', () => {
    const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    expect(ler('componentes/ui/ui.module.css')).toContain('gap: var(--esp-secoes);');
    expect(ler('componentes/cartao/Cartao.module.css')).toContain('padding: var(--esp-cartao);');
    expect(ler('componentes/radar/Radar.module.css')).toContain('.cartoes { display: flex; flex-direction: column; gap: var(--esp-cartoes); }');
    expect(ler('componentes/Casca.module.css')).toContain('padding: 0 var(--esp-cabecalho);');
  });
});
