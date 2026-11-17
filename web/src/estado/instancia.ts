// A instância única da sessão no navegador, e o gancho com que as telas a leem. Criar não
// toca em localStorage nem em rede: isso só acontece em app.iniciar(), dentro de um efeito.
import { useSyncExternalStore } from 'react';
import { enderecoDoMotor } from '@/transporte/endereco';
import { criarCofreDoToken } from '@/transporte/token';
import { ESTADO_INICIAL, criarApp, type App, type EstadoDoApp, type JanelaDoPortao } from './app';

export const BASE_DO_MOTOR = enderecoDoMotor();

// O registro da borda: fica no console do navegador. Quem o chama passa só o nome da chave e
// contagens, nunca dado do snapshot.
export function registrarNoConsole(aviso: string): void {
  console.warn(`[farol] ${aviso}`);
}

// A hora da última recarga por 401 na sessão pelo portão, por janela (sessionStorage). Sem
// armazenamento (janela privada, dados bloqueados), vale 0, e a tela de Entrar de novo aparece
// no lugar da segunda recarga só enquanto a aba estiver aberta.
const CHAVE_DA_RECARGA = 'farol-portao-recarga';
let recargaNaMemoria = 0;

const janelaDoPortao: JanelaDoPortao | undefined = typeof window === 'undefined' ? undefined : {
  // navegação de verdade, não a do roteador do Next: o pedido tem de passar pelo portão, que
  // responde a raiz com o login
  irParaARaiz: () => window.location.assign(new URL('/', window.location.origin).href),
  lerUltimaRecarga: () => {
    try { return Number(window.sessionStorage.getItem(CHAVE_DA_RECARGA)) || recargaNaMemoria; } catch { return recargaNaMemoria; }
  },
  gravarUltimaRecarga: (quando) => {
    recargaNaMemoria = quando;
    try { window.sessionStorage.setItem(CHAVE_DA_RECARGA, String(quando)); } catch { /* fica na memória */ }
  },
};

export const app: App = criarApp({
  base: BASE_DO_MOTOR,
  cofre: criarCofreDoToken(),
  // no servidor não há janela; no navegador é por ela que chega o que as outras abas fazem
  // com o token (só é ouvida a partir de app.iniciar())
  janela: typeof window === 'undefined' ? undefined : window,
  portao: janelaDoPortao,
  registrar: registrarNoConsole,
});

// O seletor devolve um primitivo ou uma referência que já está no store (nunca um objeto
// novo), senão o React redesenha sem parar.
export function useApp<T>(seletor: (estado: EstadoDoApp) => T, instancia: App = app): T {
  return useSyncExternalStore(
    instancia.store.assinar,
    () => seletor(instancia.store.ler()),
    () => seletor(ESTADO_INICIAL),
  );
}
