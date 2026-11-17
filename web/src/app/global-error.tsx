'use client';

// O erro que derruba o próprio layout da raiz. Esta página substitui o layout: desenha o
// documento inteiro e traz o globals.css por conta própria. O script do tema não roda aqui,
// então ela sai no tema claro, que é o padrão das variáveis.
import { useEffect } from 'react';
import { PaginaDeAviso, classeDaPaginaInteira, classeDaSaida } from '@/componentes/PaginaDeAviso';
import './globals.css';

interface Props {
  error: unknown;
  retry: () => void;
}

export default function ErroGlobal({ error, retry }: Props) {
  useEffect(() => {
    console.error('[farol] erro ao desenhar a página', error);
  }, [error]);

  return (
    <html lang="pt-BR" data-theme="light">
      <body>
        <title>Algo deu errado · Farol</title>
        <main className={classeDaPaginaInteira}>
          <PaginaDeAviso titulo="Algo deu errado" texto="O Farol não conseguiu desenhar a página. O motor não foi afetado: as revisões seguem.">
            <button type="button" className={classeDaSaida} onClick={() => retry()}>Tentar de novo</button>
          </PaginaDeAviso>
        </main>
      </body>
    </html>
  );
}
