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

// O anúncio da tela (regra do dono de 20/11/2026: nenhuma notificação ETERNA, o que não quer dizer
// nenhuma notificação visível). Fica sempre montado, como role="status", para o leitor de tela dizer
// o que chega. Os recados do motor (evento toast, como "Falha ao postar em a/b#2: rede") aparecem à
// vista, num aviso discreto no pé da tela, e saem sozinhos depois de DURACAO_DO_RECADO_MS (o store,
// guardarRecado). O resultado da ação já aparece à vista no lugar dela (ResultadoNoItem): aqui ele
// fica fora da vista, só para o leitor de tela, e aparece quando o anúncio recebe o foco (o botão
// que tinha o foco saiu da tela). Não há botão: nada depende de clique para sumir.
export function AnuncioDaTela({ regiao, resultado, recados }: Props) {
  return (
    <div ref={regiao} className={estilos.anuncio} role="status" aria-live="polite" aria-label="Resultado da última ação e avisos do motor" tabIndex={-1}>
      {resultado ? (
        <p className={estilos.anuncioOculto} data-tom={resultado.tom} data-visivel="foco">
          {ROTULO_DO_RESULTADO[resultado.tom] ? <strong>{ROTULO_DO_RESULTADO[resultado.tom]} </strong> : null}
          {resultado.texto}
        </p>
      ) : null}
      {recados.map((recado) => (
        <p key={recado.n} className={estilos.recado} data-tom={recado.tom} data-visivel="sim">
          <strong>{ROTULO_DO_RECADO[recado.tom]} </strong>
          {recado.texto}
        </p>
      ))}
    </div>
  );
}
