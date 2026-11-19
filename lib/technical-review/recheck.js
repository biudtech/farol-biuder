import { origemDoDono } from '../engine/desfecho-automatico.js';
import { politicaDeInicio } from '../engine/review-scope.js';

// Uma mudança comprovada de contexto pede revisão nova, sem reaproveitar a aprovação.
function needsTechnicalRecheck(item) {
  return item?.technicalRecheck === true || item?.blockedKind === 'technical_recheck';
}

function requestRecheck(engine, pr) {
  const item = engine.decisions?.pending?.find(d => d.key === pr.key);
  if (!item || item.technicalRecheck) return;
  item.technicalRecheck = true;
  item.blockedKind = 'technical_recheck';
  engine.saveDecisions();
}

function launchTechnicalRechecks(engine) {
  for (const item of engine.decisions?.pending || []) {
    // a reconferência relança o que o dono mandou revisar (fila, clique, admin, comando,
    // distribuição); o que está em recuperação (esperaProva) é do agendador único
    if (!item.technicalRecheck || item.esperaProva || !origemDoDono(item.pr)) continue;
    // o mesmo PR revisado de novo por mudança de contexto: rodada extra (gatilho-da-sessao.js)
    const pr = { ...item.pr, key: item.key, gatilho: 'rodada_extra' };
    const account = engine.accountForPr(pr);
    // Manual na organização segura a reconferência; Automático nela relança com a conta só na fila
    if (!politicaDeInicio(engine, pr).automatic || !engine.tokenFor(account)) continue;
    const queued = engine.enqueueHeadless(pr);
    if (!queued?.ok) continue;
    item.technicalRecheck = false;
    engine.saveDecisions();
  }
}

export { requestRecheck, launchTechnicalRechecks, needsTechnicalRecheck };
