import type { Metadata } from 'next';
import { EmConstrucao } from '@/componentes/EmConstrucao';

export const metadata: Metadata = { title: 'Time' };

export default function Time() {
  return <EmConstrucao titulo="Time" />;
}
