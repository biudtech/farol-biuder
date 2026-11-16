import { describe, expect, it } from 'vitest';
import { criarCofreDoToken } from './token';

const TOKEN = 'a'.repeat(43);

function armazenamentoFalso(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v); },
    removeItem: (k: string) => { dados.delete(k); },
  };
}

const QUEBRADO = {
  getItem: () => { throw new Error('bloqueado'); },
  setItem: () => { throw new Error('bloqueado'); },
  removeItem: () => { throw new Error('bloqueado'); },
};

describe('cofre do token', () => {
  it('guarda, lê e esquece', () => {
    const armazenamento = armazenamentoFalso();
    const cofre = criarCofreDoToken(() => armazenamento);
    expect(cofre.ler()).toBe('');
    expect(cofre.salvar(TOKEN)).toBe(true);
    expect(criarCofreDoToken(() => armazenamento).ler()).toBe(TOKEN);
    cofre.esquecer();
    expect(cofre.ler()).toBe('');
    expect(armazenamento.dados.size).toBe(0);
  });

  it('só aceita a forma que o motor emite: 43 caracteres de base64url', () => {
    const cofre = criarCofreDoToken(() => armazenamentoFalso());
    for (const torto of ['', 'curto', 'a'.repeat(44), `${'a'.repeat(42)}!`, null, 12, {}]) {
      expect(cofre.salvar(torto)).toBe(false);
    }
    expect(cofre.ler()).toBe('');
  });

  it('valor torto já guardado não vira credencial', () => {
    const cofre = criarCofreDoToken(() => armazenamentoFalso({ 'farol-auth-token': 'lixo' }));
    expect(cofre.ler()).toBe('');
  });

  it('armazenamento que lança não derruba: o token vale na memória até a aba fechar', () => {
    const cofre = criarCofreDoToken(() => QUEBRADO);
    expect(cofre.ler()).toBe('');
    expect(cofre.salvar(TOKEN)).toBe(true);
    expect(cofre.ler()).toBe(TOKEN);
    cofre.esquecer();
    expect(cofre.ler()).toBe('');
  });

  it('sem armazenamento nenhum (servidor) lê vazio', () => {
    expect(criarCofreDoToken(() => { throw new Error('sem window'); }).ler()).toBe('');
  });
});
