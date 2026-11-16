'use client';

// O erro ao desenhar uma aba: a casca continua de pé e só o conteúdo dá lugar a este aviso.
// A mensagem do erro não vai para a tela, só para o console do navegador.
import { useEffect } from 'react';
import { PaginaDeAviso, classeDaSaida } from '@/componentes/PaginaDeAviso';

interface Props {
  error: unknown;
  retry: () => void;
}

export default function ErroDaAba({ error, retry }: Props) {
  useEffect(() => {
    console.error('[farol] erro ao desenhar a tela', error);
  }, [error]);

  return (
    <PaginaDeAviso titulo="Algo deu errado nesta tela" texto="O Farol não conseguiu desenhar esta tela. O motor não foi afetado: as revisões seguem.">
      <button type="button" className={classeDaSaida} onClick={() => retry()}>Tentar de novo</button>
    </PaginaDeAviso>
  );
}
