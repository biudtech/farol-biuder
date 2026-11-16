// O token da sessão pareada. Mora no localStorage da origem do front, sem cookie. O
// localStorage pode lançar (janela privada, dados do site bloqueados): nesse caso o token
// vale só na memória, até a aba fechar.

const CHAVE = 'farol-auth-token';
// a forma que o motor emite e exige no Bearer (lib/local-auth/acesso.js)
const FORMATO = /^[A-Za-z0-9_-]{43}$/;

export interface Armazenamento {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export interface CofreDoToken {
  ler(): string;
  salvar(token: unknown): boolean;
  esquecer(): void;
}

export function tokenValido(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO.test(valor);
}

export function criarCofreDoToken(obterArmazenamento: () => Armazenamento = () => globalThis.localStorage): CofreDoToken {
  let naMemoria = '';

  function doArmazenamento(): string {
    try {
      const guardado = obterArmazenamento().getItem(CHAVE);
      return tokenValido(guardado) ? guardado : '';
    } catch {
      return '';
    }
  }

  return {
    ler() {
      return naMemoria || doArmazenamento();
    },
    salvar(token) {
      if (!tokenValido(token)) return false;
      naMemoria = token;
      try { obterArmazenamento().setItem(CHAVE, token); } catch { /* fica só na memória */ }
      return true;
    },
    esquecer() {
      naMemoria = '';
      try { obterArmazenamento().removeItem(CHAVE); } catch { /* não havia onde guardar */ }
    },
  };
}
