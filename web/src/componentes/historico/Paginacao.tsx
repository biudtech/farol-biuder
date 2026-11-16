'use client';

import comuns from '../radar/Radar.module.css';
import estilos from './Historico.module.css';

interface Props {
  pagina: number;
  paginas: number;
  total: number;
  // uma carga está no ar: os botões esperam
  ocupado: boolean;
  aoIr(pagina: number): void;
}

// Anterior, próxima e onde se está. Com uma página só os botões aparecem desabilitados, para
// a navegação não mudar de lugar entre uma consulta e outra.
export function Paginacao({ pagina, paginas, total, ocupado, aoIr }: Props) {
  return (
    <nav className={estilos.paginacao} aria-label="Páginas do histórico">
      <button type="button" className={comuns.botao} disabled={ocupado || pagina <= 1} aria-label="Página anterior" onClick={() => aoIr(pagina - 1)}>
        Anterior
      </button>
      <p className={estilos.onde}>
        Página {pagina} de {paginas} · {total} {total === 1 ? 'revisão' : 'revisões'}
      </p>
      <button type="button" className={comuns.botao} disabled={ocupado || pagina >= paginas} aria-label="Próxima página" onClick={() => aoIr(pagina + 1)}>
        Próxima
      </button>
    </nav>
  );
}
