import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contraste AA (WCAG 2.1) dos pares que a casca e o pareamento usam, lido das variáveis de
// src/app/globals.css nos dois temas. Texto pede 4,5:1; anel de foco e contorno de campo, 3:1.

type Cor = [number, number, number, number];

const CSS = fs.readFileSync(path.resolve(import.meta.dirname, '../app/globals.css'), 'utf8');

function variaveis(seletor: string): Map<string, string> {
  const inicio = CSS.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`bloco ${seletor} não encontrado`);
  const bloco = CSS.slice(inicio, CSS.indexOf('}', inicio));
  return new Map([...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

function cor(texto: string): Cor {
  const hex = /^#([0-9a-f]{6})$/i.exec(texto);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(texto);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`cor fora do formato esperado: ${texto}`);
}

// cor com transparência pintada sobre um fundo opaco
function sobre(frente: Cor, fundo: Cor): Cor {
  const a = frente[3];
  return [0, 1, 2].map((i) => (frente[i] as number) * a + (fundo[i] as number) * (1 - a)).concat(1) as Cor;
}

function luminancia(c: Cor): number {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: Cor, b: Cor): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

const TEMAS: Array<[string, Map<string, string>]> = [
  ['escuro', variaveis(':root')],
  ['claro', new Map([...variaveis(':root'), ...variaveis(':root[data-theme="light"]')])],
];

describe.each(TEMAS)('contraste AA no tema %s', (_nome, v) => {
  const de = (nome: string) => cor(v.get(nome) as string);
  const fundos = ['--bg', '--surface', '--surface-2'];

  it('texto e texto secundário sobre os três fundos: 4,5:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--text'), de(fundo)), `--text sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(de('--muted'), de(fundo)), `--muted sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('botão primário: 4,5:1', () => {
    expect(contraste(de('--accent-ink'), de('--accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('texto de estado sobre o fundo suave dele, em cima de cada fundo: 4,5:1', () => {
    for (const estado of ['ok', 'danger', 'info']) {
      for (const fundo of fundos) {
        const suave = sobre(de(`--${estado}-soft`), de(fundo));
        expect(contraste(de(`--${estado}-texto`), suave), `--${estado}-texto sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('link sobre os fundos: 4,5:1', () => {
    for (const fundo of fundos) expect(contraste(de('--info-texto'), de(fundo)), fundo).toBeGreaterThanOrEqual(4.5);
  });

  it('anel de foco e contorno de campo: 3:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--foco'), de(fundo)), `--foco sobre ${fundo}`).toBeGreaterThanOrEqual(3);
      expect(contraste(de('--borda-campo'), de(fundo)), `--borda-campo sobre ${fundo}`).toBeGreaterThanOrEqual(3);
    }
  });
});
