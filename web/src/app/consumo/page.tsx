import type { Metadata } from 'next';
import { EmConstrucao } from '@/componentes/EmConstrucao';

export const metadata: Metadata = { title: 'Consumo' };

export default function Consumo() {
  return <EmConstrucao titulo="Consumo" />;
}
