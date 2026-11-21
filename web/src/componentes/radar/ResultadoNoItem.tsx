import type { ResultadoDaAcao } from './useAcoes';
import estilos from './Radar.module.css';

// O resultado de uma ação à vista, no lugar dela (regra do dono de 20/11/2026): o que o motor
// respondeu aparece embaixo dos botões do item e some sozinho (useAcoes). O envio em curso já
// aparece no próprio botão, com o spinner. Para o leitor de tela quem fala é o anúncio da tela
// (AnuncioDaTela): aqui a linha fica fora da árvore de acessibilidade, para não ser lida duas vezes.
export function ResultadoNoItem({ resultado }: { resultado: ResultadoDaAcao | null }) {
  if (!resultado || resultado.tom === 'info') return null;
  return (
    <p className={estilos.resultadoNoItem} data-tom={resultado.tom} aria-hidden="true">
      {resultado.tom === 'erro' ? <strong>Erro: </strong> : null}
      {resultado.texto}
    </p>
  );
}
