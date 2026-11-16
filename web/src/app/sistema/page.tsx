import type { Metadata } from 'next';
import { EmConstrucao } from '@/componentes/EmConstrucao';

export const metadata: Metadata = { title: 'Sistema' };

export default function Sistema() {
  return <EmConstrucao titulo="Sistema" />;
}
