'use client';

import { Botao, ui } from '../ui';
import estilos from './Historico.module.css';

interface Props {
  pagina: number;
  paginas: number;
  total: number;
  // uma carga está no ar: os botões esperam
  ocupado: boolean;
  aoIr(pagina: number): void;
}

// Anterior, próxima e onde se está. Paginação, e não "Carregar mais": a página mora no
// endereço, e uma página é um pedido ao motor. Com "Carregar mais", o endereço da terceira
// carga teria de refazer três pedidos, o voltar do navegador não desfaria nada e o Atualizar
// do aviso de revisões novas não teria uma página para pedir de novo.
// Com uma página só os botões aparecem desabilitados, para a navegação não mudar de lugar.
export function Paginacao({ pagina, paginas, total, ocupado, aoIr }: Props) {
  return (
    <nav className={estilos.paginacao} aria-label="Páginas do histórico">
      <Botao pequeno disabled={ocupado || pagina <= 1} aria-label="Página anterior" onClick={() => aoIr(pagina - 1)}>
        Anterior
      </Botao>
      <p className={ui.mini}>
        Página {pagina} de {paginas} · {total} {total === 1 ? 'revisão' : 'revisões'}
      </p>
      <Botao pequeno disabled={ocupado || pagina >= paginas} aria-label="Próxima página" onClick={() => aoIr(pagina + 1)}>
        Próxima
      </Botao>
    </nav>
  );
}
