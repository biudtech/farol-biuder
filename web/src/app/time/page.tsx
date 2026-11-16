import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Time } from '@/componentes/time/Time';

export const metadata: Metadata = { title: 'Time' };

// A tela lê do endereço o dossiê aberto (useSearchParams), e o Next pede um limite de
// Suspense em volta de quem faz isso.
export default function PaginaDoTime() {
  return (
    <Suspense fallback={null}>
      <Time />
    </Suspense>
  );
}
