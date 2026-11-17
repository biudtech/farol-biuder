// Projeção canônica do histórico recente, preservando dados da caixa de revisão.
import { decisionForUi } from './public-review.js';
import { reviewActions } from './decision.js';
import { historico } from './historico-decisoes.js';

const RECENTES = 30;

function snapshotDecisions(engine) {
  return { pending: engine.decisions.pending.map(decisionForUi),
    resolved: historico(engine).recentes(RECENTES).map(decisionForUi) };
}

// A indicação de última ação acompanha os PRs que a tela conhece. O histórico
// completo continua disponível no engine e na consulta de revisão por chave. Lê o recorte leve
// de cada decisão (historico-decisoes.js), que traz tudo o que reviewActions usa.
function snapshotReviewActions(engine) {
  const todas = historico(engine).leves();
  const visiveis = [...(engine.panorama || []), ...(engine.queue || []),
    ...engine.decisions.pending, ...todas.slice(0, RECENTES)];
  const keys = new Set(visiveis.map(pr => pr.key));
  return reviewActions(engine, todas.filter(d => keys.has(d.key)));
}

export { snapshotDecisions, snapshotReviewActions };
