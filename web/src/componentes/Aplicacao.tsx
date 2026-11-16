'use client';

// A porta de entrada: decide, pela sessão, se o que aparece é o pareamento ou a casca com a
// aba pedida. Sem token não há casca, e nada do motor é desenhado.
import { useEffect, type ReactNode } from 'react';
import { app, useApp } from '@/estado/instancia';
import { Casca } from './Casca';
import { Pareamento } from './Pareamento';
import estilos from './Aplicacao.module.css';

export function Aplicacao({ children }: { children: ReactNode }) {
  const sessao = useApp((e) => e.sessao);

  // iniciar devolve a função que fecha o fluxo: é a limpeza do efeito
  useEffect(() => app.iniciar(), []);

  if (sessao === 'pareado') return <Casca>{children}</Casca>;
  if (sessao === 'pareamento') return <Pareamento />;
  return (
    <main className={estilos.aviso}>
      {sessao === 'sem-endereco' ? (
        <p role="alert">
          Falta o endereço do motor: defina <code>NEXT_PUBLIC_FAROL_API</code> com a origem dele e gere o front de novo.
        </p>
      ) : (
        <p role="status">Carregando.</p>
      )}
    </main>
  );
}
