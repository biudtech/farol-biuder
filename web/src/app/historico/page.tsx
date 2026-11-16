import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Historico } from '@/componentes/historico/Historico';

export const metadata: Metadata = { title: 'Histórico' };

// A tela lê a consulta do endereço (useSearchParams), e o Next pede um limite de Suspense em
// volta de quem faz isso.
export default function PaginaDoHistorico() {
  return (
    <Suspense fallback={null}>
      <Historico />
    </Suspense>
  );
}
