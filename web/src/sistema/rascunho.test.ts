import { describe, expect, it } from 'vitest';
import { refazerCampos } from './rascunho';

interface Chaves { a: number; b: string; c: boolean }

describe('refazerCampos: a edição de alguém sobre o valor novo do motor', () => {
  const partida: Chaves = { a: 1, b: 'x', c: true };

  it('campo que a pessoa não tocou pega o valor novo; o que ela tocou fica', () => {
    expect(refazerCampos(partida, { ...partida, b: 'meu' }, { a: 9, b: 'x', c: false })).toEqual({ valor: { a: 9, b: 'meu', c: false }, conflitos: [] });
  });

  it('campo mexido pelos dois, cada um para um valor, é conflito, e fica o da pessoa', () => {
    expect(refazerCampos(partida, { ...partida, b: 'meu' }, { ...partida, b: 'dele' })).toEqual({ valor: { a: 1, b: 'meu', c: true }, conflitos: ['b'] });
  });

  it('os dois para o mesmo valor não é conflito', () => {
    expect(refazerCampos(partida, { ...partida, a: 2 }, { ...partida, a: 2 })).toEqual({ valor: { a: 2, b: 'x', c: true }, conflitos: [] });
  });

  it('sem edição o refeito é o valor novo, e nada do que recebeu é mexido', () => {
    const nova: Chaves = { a: 5, b: 'y', c: false };
    const refeito = refazerCampos(partida, { ...partida }, nova);
    expect(refeito).toEqual({ valor: nova, conflitos: [] });
    expect(refeito.valor).not.toBe(nova);
    expect(partida).toEqual({ a: 1, b: 'x', c: true });
  });
});
