import { describe, expect, it } from 'vitest';
import { resumoDosCriterios, textoDoCriterio } from './detalhe';

describe('critérios do card no detalhe', () => {
  it('o resumo conta os atendidos e diz quantos ficaram sem conferir', () => {
    expect(resumoDosCriterios([{ texto: 'a', atende: true }, { texto: 'b', atende: true }, { texto: 'c', atende: false }])).toBe('2 de 3 atendidos');
    expect(resumoDosCriterios([{ texto: 'a', atende: true }, { texto: 'b', atende: null }])).toBe('1 de 2 atendidos · 1 sem conferir');
    expect(resumoDosCriterios([{ texto: 'a', atende: false }])).toBe('0 de 1 atendidos');
  });

  it('o estado de cada critério em texto', () => {
    expect([true, false, null].map(textoDoCriterio)).toEqual(['Atende', 'Não atende', 'Não conferido']);
  });
});
