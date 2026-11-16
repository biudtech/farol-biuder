// A instância única da sessão no navegador, e o gancho com que as telas a leem. Criar não
// toca em localStorage nem em rede: isso só acontece em app.iniciar(), dentro de um efeito.
import { useSyncExternalStore } from 'react';
import { enderecoDoMotor } from '@/transporte/endereco';
import { criarCofreDoToken } from '@/transporte/token';
import { ESTADO_INICIAL, criarApp, type App, type EstadoDoApp } from './app';

export const BASE_DO_MOTOR = enderecoDoMotor();

// O registro da borda: fica no console do navegador. Quem o chama passa só o nome da chave e
// contagens, nunca dado do snapshot.
export function registrarNoConsole(aviso: string): void {
  console.warn(`[farol] ${aviso}`);
}

export const app: App = criarApp({
  base: BASE_DO_MOTOR,
  cofre: criarCofreDoToken(),
  // no servidor não há janela; no navegador é por ela que chega o que as outras abas fazem
  // com o token (só é ouvida a partir de app.iniciar())
  janela: typeof window === 'undefined' ? undefined : window,
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
