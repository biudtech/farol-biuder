import { describe, expect, it } from 'vitest';
import {
  AREA_DO_GRAFICO, TETO_DE_BARRAS, alturaDaMarca, barrasDoGrafico, diaMenos, diasDoPeriodo, diasNoPeriodo, escalaDoEixo, indicesDosRotulos, maiorDia,
} from './grafico';

describe('os dias do período', () => {
  it('diaMenos anda no calendário, por mês, ano e fevereiro bissexto', () => {
    expect(diaMenos('2026-11-16', 0)).toBe('2026-11-16');
    expect(diaMenos('2026-11-16', 6)).toBe('2026-11-10');
    expect(diaMenos('2026-11-16', 29)).toBe('2026-10-18');
    expect(diaMenos('2026-01-01', 1)).toBe('2025-12-31');
    expect(diaMenos('2028-03-01', 1)).toBe('2028-02-29');
  });

  it('texto que não é um dia que existe não vira dia', () => {
    for (const torto of ['', 'hoje', '2026-13-01', '2026-02-30', '16/11/2026']) expect(diaMenos(torto, 1), torto).toBe('');
  });

  it('conta os dias com as duas pontas', () => {
    expect(diasNoPeriodo('2026-11-16', '2026-11-16')).toBe(1);
    expect(diasNoPeriodo('2026-10-18', '2026-11-16')).toBe(30);
    expect(diasNoPeriodo('2026-11-16', '2026-11-10')).toBe(0);
    expect(diasNoPeriodo('x', '2026-11-10')).toBe(0);
  });

  it('lista todos os dias, inclusive os que o motor não mandou', () => {
    expect(diasDoPeriodo('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('período longo demais, invertido ou torto não vira gráfico', () => {
    expect(diasDoPeriodo('2026-01-01', '2026-11-16')).toBeNull();
    expect(diasDoPeriodo(diaMenos('2026-11-16', TETO_DE_BARRAS - 1), '2026-11-16')).toHaveLength(TETO_DE_BARRAS);
    expect(diasDoPeriodo(diaMenos('2026-11-16', TETO_DE_BARRAS), '2026-11-16')).toBeNull();
    expect(diasDoPeriodo('2026-11-16', '2026-11-10')).toBeNull();
    expect(diasDoPeriodo('', '')).toBeNull();
  });
});

describe('a escala do eixo vertical', () => {
  it('passo redondo, e o teto cobre o maior valor', () => {
    expect(escalaDoEixo(9.1)).toEqual({ teto: 10, marcas: [0, 2.5, 5, 7.5, 10] });
    expect(escalaDoEixo(100)).toEqual({ teto: 100, marcas: [0, 25, 50, 75, 100] });
    expect(escalaDoEixo(37)).toEqual({ teto: 40, marcas: [0, 10, 20, 30, 40] });
    expect(escalaDoEixo(1234)).toEqual({ teto: 1500, marcas: [0, 500, 1000, 1500] });
    expect(escalaDoEixo(4)).toEqual({ teto: 4, marcas: [0, 1, 2, 3, 4] });
  });

  it('valores pequenos não deixam poeira de ponto flutuante nas marcas', () => {
    expect(escalaDoEixo(0.3)).toEqual({ teto: 0.3, marcas: [0, 0.1, 0.2, 0.3] });
    expect(escalaDoEixo(0.07)).toEqual({ teto: 0.08, marcas: [0, 0.02, 0.04, 0.06, 0.08] });
    expect(escalaDoEixo(0.004)).toEqual({ teto: 0.004, marcas: [0, 0.001, 0.002, 0.003, 0.004] });
  });

  it('sem valor acima de zero o eixo vai de 0 a 1', () => {
    for (const vazio of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(escalaDoEixo(vazio), String(vazio)).toEqual({ teto: 1, marcas: [0, 1] });
  });

  it('o teto nunca fica abaixo do maior valor, e as marcas são crescentes', () => {
    for (const maximo of [0.011, 0.5, 1, 2.6, 7, 12.5, 49.99, 51, 99, 101, 980, 12345.67]) {
      const { teto, marcas } = escalaDoEixo(maximo);
      expect(teto, String(maximo)).toBeGreaterThanOrEqual(maximo);
      expect(marcas[0]).toBe(0);
      expect(marcas.at(-1)).toBe(teto);
      expect(marcas.length, String(maximo)).toBeLessThanOrEqual(7);
      expect(marcas.every((m, i) => i === 0 || m > (marcas[i - 1] as number))).toBe(true);
    }
  });
});

describe('os rótulos do eixo horizontal', () => {
  it('com poucas barras, todas', () => {
    expect(indicesDosRotulos(0)).toEqual([]);
    expect(indicesDosRotulos(1)).toEqual([0]);
    expect(indicesDosRotulos(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('com muitas, a primeira, a última e as do meio espaçadas, sem passar do máximo', () => {
    expect(indicesDosRotulos(7)).toEqual([0, 2, 4, 6]);
    expect(indicesDosRotulos(30)).toEqual([0, 6, 12, 18, 24, 29]);
    expect(indicesDosRotulos(90)).toEqual([0, 18, 36, 54, 72, 89]);
    for (const n of [8, 13, 31, 45, 89, 120]) {
      const indices = indicesDosRotulos(n);
      expect(indices[0]).toBe(0);
      expect(indices.at(-1)).toBe(n - 1);
      expect(indices.length, String(n)).toBeLessThanOrEqual(6);
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it('o penúltimo rótulo não cola no último', () => {
    // 32 barras: passo 7, e o 28 ficaria a 3 do 31
    expect(indicesDosRotulos(32)).toEqual([0, 7, 14, 21, 31]);
  });
});

describe('as barras', () => {
  const area = { largura: 120, altura: 110, esquerda: 20, direita: 0, topo: 10, base: 0 };
  const valores: Record<string, number> = { a: 50, b: 100, d: 0.001 };
  const barras = barrasDoGrafico(['a', 'b', 'c', 'd'], (dia) => valores[dia], 100, area);

  it('a altura é proporcional ao teto, e a barra se apoia no chão', () => {
    expect(barras.map((b) => [b.dia, b.valor, b.altura, b.y])).toEqual([['a', 50, 50, 60], ['b', 100, 100, 10], ['c', 0, 0, 110], ['d', 0.001, 1, 109]]);
  });

  it('cada dia tem a sua faixa, com a barra em 70% dela', () => {
    expect(barras.map((b) => [b.x, b.largura, b.centro])).toEqual([[23.75, 17.5, 32.5], [48.75, 17.5, 57.5], [73.75, 17.5, 82.5], [98.75, 17.5, 107.5]]);
  });

  it('valor ausente, negativo ou que não é número vale zero, e valor acima do teto não passa do topo', () => {
    const tortas = barrasDoGrafico(['a', 'b', 'c', 'd'], (dia) => ({ a: -5, b: Number.NaN, d: 500 } as Record<string, number>)[dia], 100, area);
    expect(tortas.map((b) => b.altura)).toEqual([0, 0, 0, 100]);
  });

  it('sem dias não há barra, e teto zero não divide', () => {
    expect(barrasDoGrafico([], () => 1, 10)).toEqual([]);
    expect(barrasDoGrafico(['a'], () => 0, 0, area)[0]?.altura).toBe(0);
  });

  it('as barras cabem na área padrão', () => {
    const dias = diasDoPeriodo('2026-08-19', '2026-11-16') ?? [];
    const padrao = barrasDoGrafico(dias, () => 3, 4);
    expect(padrao).toHaveLength(90);
    for (const b of padrao) {
      expect(b.x).toBeGreaterThanOrEqual(AREA_DO_GRAFICO.esquerda);
      expect(b.x + b.largura).toBeLessThanOrEqual(AREA_DO_GRAFICO.largura - AREA_DO_GRAFICO.direita);
      expect(b.y).toBeGreaterThanOrEqual(AREA_DO_GRAFICO.topo);
    }
  });

  it('a marca do eixo fica na mesma régua das barras', () => {
    expect(alturaDaMarca(0, 100, area)).toBe(110);
    expect(alturaDaMarca(50, 100, area)).toBe(60);
    expect(alturaDaMarca(100, 100, area)).toBe(10);
    expect(alturaDaMarca(5, 0, area)).toBe(110);
  });
});

describe('o maior dia', () => {
  it('o de maior valor, o primeiro no empate, e null sem valor acima de zero', () => {
    const serie = [{ name: 'a', v: 1 }, { name: 'b', v: 5 }, { name: 'c', v: 5 }, { name: 'd' }];
    expect(maiorDia(serie, (item) => item.v)?.name).toBe('b');
    expect(maiorDia([{ name: 'a', v: 0 }], (item) => item.v)).toBeNull();
    expect(maiorDia([], () => 1)).toBeNull();
  });
});
