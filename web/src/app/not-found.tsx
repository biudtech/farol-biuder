import type { Metadata } from 'next';
import Link from 'next/link';
import { PaginaDeAviso, classeDaSaida } from '@/componentes/PaginaDeAviso';
import { ABA_INICIAL } from '@/navegacao/abas';

export const metadata: Metadata = { title: 'Página não encontrada' };

// O 404 do front, para todo endereço que não é uma aba. A página embutida do Next não serve:
// usa o atributo style, que a CSP de produção bloqueia, e fala inglês.
export default function NaoEncontrada() {
  return (
    <PaginaDeAviso codigo="404" titulo="Página não encontrada" texto="Este endereço não leva a nenhuma tela do Farol.">
      <Link href={ABA_INICIAL} className={classeDaSaida}>Ir para o Radar</Link>
    </PaginaDeAviso>
  );
}
