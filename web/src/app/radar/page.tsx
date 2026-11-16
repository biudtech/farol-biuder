import type { Metadata } from 'next';
import { Radar } from '@/componentes/radar/Radar';

export const metadata: Metadata = { title: 'Radar' };

export default function PaginaDoRadar() {
  return <Radar />;
}
