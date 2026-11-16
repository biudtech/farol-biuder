import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Consumo } from '@/componentes/consumo/Consumo';

export const metadata: Metadata = { title: 'Consumo' };

// A tela lê a consulta do endereço (useSearchParams), e o Next pede um limite de Suspense em
// volta de quem faz isso.
export default function PaginaDoConsumo() {
  return (
    <Suspense fallback={null}>
      <Consumo />
    </Suspense>
  );
}
