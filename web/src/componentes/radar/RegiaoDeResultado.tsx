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
  aoDispensar(): void;
}

// A região de resultado do Radar e do Histórico. Fica sempre montada, para o leitor de tela
// anunciar o que chega: o envio, o que o motor respondeu ao pedido e os avisos dele (evento
// toast), que dizem o desfecho de fato. Recebe o foco quando o botão que o tinha sai da tela.
export function RegiaoDeResultado({ regiao, resultado, recados, aoDispensar }: Props) {
  const haOQueDispensar = (resultado !== null && resultado.tom !== 'info') || recados.length > 0;
  return (
    <div ref={regiao} className={estilos.resultado} role="status" aria-live="polite" aria-label="Resultado da última ação e avisos do motor" tabIndex={-1}>
      {resultado ? (
        <p className={estilos.recado} data-tom={resultado.tom}>
          {ROTULO_DO_RESULTADO[resultado.tom] ? <strong>{ROTULO_DO_RESULTADO[resultado.tom]} </strong> : null}
          {resultado.texto}
        </p>
      ) : null}
      {recados.map((recado) => (
        <p key={recado.n} className={estilos.recado} data-tom={recado.tom}>
          <strong>{ROTULO_DO_RECADO[recado.tom]} </strong>
          {recado.texto}
        </p>
      ))}
      {haOQueDispensar ? (
        <button type="button" className={estilos.botao} onClick={aoDispensar}>Dispensar</button>
      ) : null}
    </div>
  );
}
