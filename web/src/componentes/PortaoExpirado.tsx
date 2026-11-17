'use client';

// A sessão pelo portão acabou de novo logo depois de uma recarga: em vez de recarregar a página
// sem parar, a tela diz o que houve e deixa a próxima tentativa com quem está aqui. O botão leva
// à raiz, onde o login da frente aparece (src/estado/app.ts, perdeuOPortao).
import type { App } from '@/estado/app';
import { app as appDoNavegador } from '@/estado/instancia';
import estilos from './Aplicacao.module.css';

export function PortaoExpirado({ app = appDoNavegador }: { app?: App }) {
  return (
    <main className={estilos.aviso}>
      <p role="alert">
        A sessão do login da frente acabou, e a página já foi recarregada uma vez sem resolver. Entre de novo para continuar.
      </p>
      <button type="button" onClick={() => app.entrarDeNovo()}>Entrar de novo</button>
    </main>
  );
}
