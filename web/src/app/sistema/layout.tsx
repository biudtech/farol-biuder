import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SistemaNaRota } from '@/componentes/sistema/SistemaNaRota';

export const metadata: Metadata = { title: 'Sistema' };

// A tela mora no layout, e não na página: trocar de assunto (`/sistema/<assunto>`) troca só a
// página, e o layout fica montado com o que foi digitado em cada assunto.
export default function LayoutDoSistema({ children }: { children: ReactNode }) {
  return <SistemaNaRota>{children}</SistemaNaRota>;
}
