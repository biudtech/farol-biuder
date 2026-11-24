// O PR pode ter sido mergeado ou fechado enquanto esperava a vez na fila (conta ocupada com outra
// revisão, fan-out grande, etc.): revisar e postar review num PR já mergeado é ruído puro. Saiu do
// runOneHeadless (lib/engine/review.js) em 24/11/2026, junto com o registro da ocorrência
// (ocorrencias-da-revisao.js): até ali só sobrava um toast, e ninguém conseguia remontar depois
// por que a revisão não aconteceu.
//
// null (sem prova, rede/token) NUNCA cancela, só MERGED de verdade pula a revisão (mesma regra do
// reconcilePending em decision.js). Fechado sem merge também pula (30/10/2026): o vigia já encerra
// a sessão de PR fechado, e abrir para matar três minutos depois só pagava a sessão.
import retomadaMod from './retomada-duravel.js';
import { registrarOcorrencia } from './ocorrencias-da-revisao.js';

// Devolve true quando a revisão não deve abrir: quem chama encerra sem sessão.
async function fechadoAntesDaFila(engine, pr) {
  let estado = '';
  try { estado = (await engine.prState(pr)) || ''; }
  catch (err) { engine.log('WARN', `estado de ${pr.key} antes da revisão: ${err.message}`); }
  if (estado !== 'MERGED' && estado !== 'CLOSED') return false;
  const mergeado = estado === 'MERGED';
  engine.emit('toast', { kind: 'info', text: mergeado
    ? `${pr.key} já foi mergeado; cancelei a revisão antes de começar.`
    : `${pr.key} foi fechado; cancelei a revisão antes de começar.` });
  // PR mergeado não volta: a referência de retomada dele é desfecho, não espera
  retomadaMod.consumirRetomada(engine, pr.key);
  registrarOcorrencia(engine, { pr, tipo: 'nao_iniciada', motivo: mergeado ? 'pr_mergeado' : 'pr_fechado', etapa: 'fila' });
  return true;
}

export default { fechadoAntesDaFila };
export { fechadoAntesDaFila };
