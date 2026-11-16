// O token da sessão pareada. Mora no localStorage da origem do front, sem cookie. O
// localStorage pode lançar (janela privada, dados do site bloqueados): nesse caso o token
// vale só na memória, até a aba fechar.
//
// O localStorage é um só para todas as abas da origem, e a memória é de cada aba. Por isso
// quem esquece diz qual token está esquecendo: a aba que ainda tem o token antigo na memória
// não apaga o novo que outra aba acabou de guardar.

// a chave do localStorage; o evento `storage` de outra aba chega com ela
export const CHAVE_DO_TOKEN = 'farol-auth-token';
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
  // Limpa a memória desta aba sempre. Do armazenamento só sai o valor que for igual a `token`.
  esquecer(token: string): void;
  // Troca a memória desta aba pelo que está guardado e devolve o resultado. É o que se chama
  // quando outra aba mexeu no armazenamento.
  sincronizar(): string;
}

export function tokenValido(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO.test(valor);
}

export function criarCofreDoToken(obterArmazenamento: () => Armazenamento = () => globalThis.localStorage): CofreDoToken {
  let naMemoria = '';

  function doArmazenamento(): string {
    try {
      const guardado = obterArmazenamento().getItem(CHAVE_DO_TOKEN);
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
      try { obterArmazenamento().setItem(CHAVE_DO_TOKEN, token); } catch { /* fica só na memória */ }
      return true;
    },
    esquecer(token) {
      naMemoria = '';
      if (!token) return;
      try {
        const armazenamento = obterArmazenamento();
        if (armazenamento.getItem(CHAVE_DO_TOKEN) === token) armazenamento.removeItem(CHAVE_DO_TOKEN);
      } catch { /* não havia onde guardar */ }
    },
    sincronizar() {
      try {
        const guardado = obterArmazenamento().getItem(CHAVE_DO_TOKEN);
        naMemoria = tokenValido(guardado) ? guardado : '';
      } catch { /* sem armazenamento, vale o que está na memória */ }
      return naMemoria;
    },
  };
}
