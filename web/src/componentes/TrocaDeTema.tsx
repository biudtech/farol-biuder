'use client';

import { definirTema, useTema } from '@/tema/tema';
import estilos from './Casca.module.css';

// O nome do botão diz o que o clique faz. O ícone é o do tema para onde ele leva.
export function TrocaDeTema() {
  const tema = useTema();
  const destino = tema === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`${estilos.botao} ${estilos.icone}`}
      onClick={() => definirTema(destino)}
      aria-label={destino === 'light' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {destino === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
