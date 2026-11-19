// A projeção do estacionamento para a tela (a chave `parked` do snapshot). Saiu de
// lib/engine/review.js em 19/11/2026 (redesenho, lote 2) para abrir espaço lá, sem mudar
// nada do que projeta; o review.js a reexporta.
import { classify } from '../log-taxonomy.js';

// Projeção do estacionamento pra UI: allowlist (at, motivo, tipo), motivo cortado
// (é mensagem de erro, pode carregar stderr), e SÓ keys que estão no Set, que é a
// fonte de verdade de "está estacionado"; motivo sem key é lixo de migração.
// Key SEM motivo (estacionada antes da v2.57.4, quando o arquivo era só a lista)
// também vai pra tela, como `legado`: o que a v2.57.4 corrigiu era o card idêntico
// ao de um PR nunca revisado, e deixar o estoque antigo invisível repetia o defeito
// justamente nos PRs que motivaram o conserto (biud-core#317 ficou assim).
const PARKED_MOTIVO_UI_MAX = 200;
function parkedParaUi(engine) {
  const out = {};
  const motivos = (engine.parkedMotivos && typeof engine.parkedMotivos === 'object') ? engine.parkedMotivos : {};
  for (const k of engine.autoReviewParked || []) {
    const m = motivos[k];
    if (!m) { out[k] = { at: '', motivo: '', tipo: 'legado' }; continue; }
    let tipo = String(m.tipo || 'falha');
    if (['falha', 'esgotado'].includes(tipo) && classify(m.motivo).id === 'oauth-expirado') tipo = 'autenticacao';
    out[k] = { at: String(m.at || ''), motivo: String(m.motivo || '').slice(0, PARKED_MOTIVO_UI_MAX), tipo, ...(m.sessionId ? { sessionId: String(m.sessionId) } : {}) };
  }
  return out;
}

export default { parkedParaUi };
export { parkedParaUi };
