import type { RefObject } from 'react';
import type { RecadoNaTela } from '@/estado/app';
import type { ResultadoDaAcao } from './useAcoes';
import estilos from './Radar.module.css';

// O que diferencia erro de informação não é só a cor: cada linha começa dizendo o que é.
const ROTULO_DO_RESULTADO: Record<ResultadoDaAcao['tom'], string> = { erro: 'Erro:', ok: '', info: '' };
const ROTULO_DO_RECADO: Record<RecadoNaTela['tom'], string> = { erro: 'Erro avisado pelo motor:', ok: 'Aviso do motor:', info: 'Aviso do motor:' };

interface Props {
  regiao: RefObject<HTMLDivElement | null>;
  resultado: ResultadoDaAcao | null;
  recados: readonly RecadoNaTela[];
}

// O anúncio discreto da tela (regra do dono de 20/11/2026: nenhuma notificação eterna). Fica
// sempre montado, fora da vista, para o leitor de tela dizer o que chega: o envio, o que o motor
// respondeu ao pedido e os avisos dele (evento toast). O resultado de cada ação aparece à vista
// no lugar dela (ResultadoNoItem); aqui não há botão, e tudo some sozinho: o resultado pelo
// useAcoes, o recado pelo store. Recebe o foco quando o botão que o tinha sai da tela, e só
// então aparece, enquanto tem texto.
export function AnuncioDaTela({ regiao, resultado, recados }: Props) {
  return (
    <div ref={regiao} className={estilos.anuncio} role="status" aria-live="polite" aria-label="Resultado da última ação e avisos do motor" tabIndex={-1}>
      {resultado ? (
        <p data-tom={resultado.tom}>
          {ROTULO_DO_RESULTADO[resultado.tom] ? <strong>{ROTULO_DO_RESULTADO[resultado.tom]} </strong> : null}
          {resultado.texto}
        </p>
      ) : null}
      {recados.map((recado) => (
        <p key={recado.n} data-tom={recado.tom}>
          <strong>{ROTULO_DO_RECADO[recado.tom]} </strong>
          {recado.texto}
        </p>
      ))}
    </div>
  );
}
