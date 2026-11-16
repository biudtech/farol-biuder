import type { Metadata } from 'next';
import { EmConstrucao } from '@/componentes/EmConstrucao';

export const metadata: Metadata = { title: 'Histórico' };

export default function Historico() {
  return <EmConstrucao titulo="Histórico" />;
}
