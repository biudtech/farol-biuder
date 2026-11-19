import { notFound } from 'next/navigation';
import { assuntoDosSegmentos } from '@/sistema/assuntos';

// `/sistema` e `/sistema/<assunto>`. A tela mora no layout (SistemaNaRota): a página só confere
// o endereço, e assunto que não existe mostra a página de não encontrada.
export default async function PaginaDoSistema({ params }: { params: Promise<{ assunto?: string[] }> }) {
  const { assunto } = await params;
  if (!assuntoDosSegmentos(assunto)) notFound();
  return null;
}
