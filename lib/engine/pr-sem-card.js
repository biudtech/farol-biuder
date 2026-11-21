// PR sem card (regra do dono de 20/11/2026): o Farol revisa o código pelo mérito, e a falta de card
// não diminui a revisão nem vira ressalva, motivo ou marca de "com ressalvas" no Panorama.
//
// Quem diz que o PR não tem card é a leitura que o MOTOR fez (`cardLeitura`, review.js), nunca a
// palavra da sessão: sem chave de card no título, na branch e no corpo. Com o Jira desligado, ou
// sem site para a organização, o motor não procura a chave, e aí vale o envelope sem `card`. Card
// com chave que não deu para ler (credencial, rede, card inexistente) continua com a régua de hoje.
const SEM_BUSCA_DE_CHAVE = ['desligado', 'site_nao_configurado'];

// O motivo que só fala da falta do card do Jira: "sem card", "card do Jira", "card do PR", "chave
// do card" ou o próprio Jira. Estreito de propósito: "card" sozinho é também nome de componente de
// front ("o card de produto não trata o erro"), e esse motivo é técnico e fica.
const MOTIVO_DE_CARD = /\bsem card\b|\bcard\s+(?:d[oe]|no)\s+(?:jira|pr)\b|\bchave\s+d[oe]\s+card\b|\bjira\b/i;

function prSemCard(result) {
  const leitura = result && result.cardLeitura;
  if (!leitura || typeof leitura !== 'object' || leitura.ok === true) return false;
  if (leitura.code === 'sem_chave') return true;
  return SEM_BUSCA_DE_CHAVE.includes(leitura.code) && !String(result.card || '').trim();
}

function textoDoMotivo(r) {
  if (typeof r === 'string') return r;
  return (r && typeof r === 'object') ? String(r.text || '') : '';
}

function ehMotivoDeCard(r) {
  return MOTIVO_DE_CARD.test(textoDoMotivo(r));
}

// No PR sem card, tira do resultado o que só fala da falta dele: o `cardMet` false (o Panorama lê
// `cardMet === false` como ressalva, decision.js) vira null, e os motivos de falta de card saem.
// Muta o resultado de propósito, como os outros passos do runHeadlessReview, antes de a decisão
// ser gravada; devolve quantos motivos saíram. Com card, não mexe em nada.
function semFaltaDeCard(result) {
  if (!prSemCard(result)) return 0;
  if (result.cardMet === false) result.cardMet = null;
  if (!Array.isArray(result.reasons)) return 0;
  const antes = result.reasons.length;
  result.reasons = result.reasons.filter((r) => !ehMotivoDeCard(r));
  return antes - result.reasons.length;
}

export default { prSemCard, ehMotivoDeCard, semFaltaDeCard };
export { prSemCard, ehMotivoDeCard, semFaltaDeCard };
