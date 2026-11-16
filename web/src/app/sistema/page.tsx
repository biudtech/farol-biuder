import type { Metadata } from 'next';
import { Sistema } from '@/componentes/sistema/Sistema';

export const metadata: Metadata = { title: 'Sistema' };

export default function PaginaDoSistema() {
  return <Sistema />;
}
