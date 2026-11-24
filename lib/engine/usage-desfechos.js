// Vocabulário do registro de consumo: os DESFECHOS possíveis de uma sessão, quais deles
// significam gasto que não virou resultado, quais origens de custo são desconhecidas, e
// as marcas `farol_*` que o evento carrega para a linha (A1 da operação multidispositivo).
//
// Mora fora de lib/engine/usage.js porque lá o assunto é agregação; aqui é
// só a tabela de significados, folha: a única dependência é a lista dos gatilhos da sessão
// (gatilho-da-sessao.js, outra folha).
import { GATILHOS } from './gatilho-da-sessao.js';

/* Desfechos que significam "este gasto não virou nada":
   - `parcial`: a sessão morreu no meio e nunca entregou resultado;
   - `descartada`: rodou até o fim e o resultado foi jogado fora (commit novo durante a
     análise). Era gravada como `ok` até 31/08/2026, e foi assim que US$ 64,81 de um dia
     só apareceram como sucesso na tela;
   - `cancelada`: você mandou parar;
   - `erro`: terminou em falha;
   - `interrompida`: o processo do Farol morreu com a sessão aberta e o boot seguinte
     registrou o que o diário de tentativas tinha visto.
   `ok` é o único que produziu resultado. */
const DESFECHOS = ['ok', 'erro', 'cancelada', 'parcial', 'descartada', 'interrompida'];
const DESFECHOS_PERDIDOS = new Set(['erro', 'cancelada', 'parcial', 'descartada', 'interrompida']);
// custo cujo valor não se sabe: nunca é zero para o gate nem medido para a auditoria
// (`sem-base` é o nome antigo da mesma coisa, gravado até a v2.59.3)
const ORIGENS_DESCONHECIDAS = new Set(['desconhecido', 'sem-base']);
// desfechos de retomada que a A5 produz e que a linha do consumo guarda
const RESUME_OUTCOMES = ['retomada', 'recusada', 'nova', 'nenhuma'];

// em qual balde da auditoria o custo desta sessão entra
function origemDoCusto(r, s) {
  if (ORIGENS_DESCONHECIDAS.has(s.costSource)) return r.desconhecido;
  return s.costSource === 'estimado' ? r.estimado : r.medido;
}

// Campos da tentativa (lib/engine/usage-tentativas.js) que viajam no evento como marcas
// farol_*, para a assinatura de recordUsage (e da fachada) continuar a mesma. `attemptId`
// é o que o boot usa para não duplicar uma tentativa já registrada.
function camposDaTentativa(ev) {
  const extra = {};
  if (typeof ev.farol_attempt === 'string' && ev.farol_attempt) extra.attemptId = ev.farol_attempt;
  if (Number(ev.farol_iniciada_em) > 0) extra.iniciadaEm = Number(ev.farol_iniciada_em);
  if (ev.farol_provedor_destacado === true) extra.provedorPodeTerContinuado = true;
  if (RESUME_OUTCOMES.includes(ev.farol_resume_outcome)) extra.resumeOutcome = ev.farol_resume_outcome;
  // por que a sessão rodou (redesenho, lote 2): só um dos quatro valores, senão nada
  if (GATILHOS.includes(ev.farol_gatilho)) extra.gatilho = ev.farol_gatilho;
  // o autor do PR (login do GitHub, sem caixa) e a chave do card lido: só na forma, senão nada
  const autor = autorDaSessao(ev.farol_autor);
  if (autor) extra.author = autor;
  const card = cardDaSessao(ev.farol_card);
  if (card) extra.card = card;
  return extra;
}

// PURA: o login do GitHub (até 39 caracteres, letra, dígito e hífen, com o sufixo `[bot]` das
// contas de app), sem caixa, ou ''.
function autorDaSessao(v) {
  const login = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z0-9](?:[a-z0-9-]{0,38})(?:\[bot\])?$/.test(login) ? login : '';
}

// PURA: a chave de um card do Jira (PROJ-123), ou ''.
function cardDaSessao(v) {
  const card = typeof v === 'string' ? v.trim() : '';
  return card.length <= 40 && /^[A-Z][A-Z0-9_]*-[0-9]+$/.test(card) ? card : '';
}

// Fecha a conta do registro nos dois eixos que a auditoria precisa: quanto virou
// resultado x quanto foi perdido, e quanto do total é medido, estimado ou desconhecido.
// PURA. Registro antigo não tem `costSource`, e conta como MEDIDO, que é o que ele era.
function auditoriaVazia() {
  const zero = () => ({ sessions: 0, costUsd: 0 });
  return { total: zero(), util: zero(), perdido: zero(), medido: zero(), estimado: zero(), desconhecido: zero() };
}

// Soma uma sessão na auditoria `r`, depois das que já estão nela: é o que o cache da auditoria
// do diário no banco faz com cada sessão nova (lib/engine/usage-diario.js).
function somarNaAuditoria(r, s) {
  if (!s) return r;
  const custo = Number(s.costUsd) || 0;
  const soma = (b) => { b.sessions += 1; b.costUsd += custo; };
  soma(r.total);
  soma(DESFECHOS_PERDIDOS.has(s.status) ? r.perdido : r.util);
  soma(origemDoCusto(r, s));
  return r;
}

function auditoriaDeConsumo(sessions) {
  const r = auditoriaVazia();
  for (const s of sessions || []) somarNaAuditoria(r, s);
  return r;
}

export default { DESFECHOS, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS, origemDoCusto, camposDaTentativa, autorDaSessao, cardDaSessao, auditoriaDeConsumo, auditoriaVazia, somarNaAuditoria };
export { DESFECHOS, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS, origemDoCusto, camposDaTentativa, autorDaSessao, cardDaSessao, auditoriaDeConsumo, auditoriaVazia, somarNaAuditoria };
