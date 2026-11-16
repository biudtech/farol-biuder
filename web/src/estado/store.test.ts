import { describe, expect, it, vi } from 'vitest';
import { criarStore } from './store';

describe('store mínimo', () => {
  it('lê o estado inicial e o trocado', () => {
    const store = criarStore({ a: 1, b: 'x' });
    expect(store.ler()).toEqual({ a: 1, b: 'x' });
    store.trocar({ a: 2 });
    expect(store.ler()).toEqual({ a: 2, b: 'x' });
  });

  it('avisa os assinantes a cada troca, e para de avisar quem saiu', () => {
    const store = criarStore({ a: 1 });
    const ouvinte = vi.fn();
    const sair = store.assinar(ouvinte);
    store.trocar({ a: 2 });
    expect(ouvinte).toHaveBeenCalledTimes(1);
    sair();
    store.trocar({ a: 3 });
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('troca que não muda nada mantém a referência e não avisa', () => {
    const store = criarStore({ a: 1, lista: [1] });
    const antes = store.ler();
    const ouvinte = vi.fn();
    store.assinar(ouvinte);
    store.trocar({ a: 1, lista: antes.lista });
    expect(store.ler()).toBe(antes);
    expect(ouvinte).not.toHaveBeenCalled();
  });
});
