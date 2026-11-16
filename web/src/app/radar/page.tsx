import type { Metadata } from 'next';
import { EmConstrucao } from '@/componentes/EmConstrucao';

export const metadata: Metadata = { title: 'Radar' };

export default function Radar() {
  return <EmConstrucao titulo="Radar" />;
}
