// O estado do PR que o gate lê do envelope, e não do texto: CI obrigatório e dependência.
//
// PURO: só lê o envelope da revisão, que o runHeadlessReview completa antes do gate
// (`checksObrigatorios`, a mesma leitura do gate de lançamento em checks-exigidos.js) ou
// que a própria sessão preenche (`dependenciasAbertas`).
//
// O CI OBRIGATÓRIO É INFORMAÇÃO, NUNCA ESPERA (regra do dono de 17/11/2026: o revisor nunca
// espera o CI, nem para começar nem para aprovar). A chave `aguardarCiParaAprovar` ("CI
// obrigatório antes da aprovação") saiu, e com ela a espera automática (o antigo
// lib/engine/espera-ci.js ficou só com a liberação das esperas gravadas antes). O estado do CI
// não segura, não adia e não barra a decisão: sem espera, sem lacuna de CI, sem REQUEST_CHANGES
// só pelo CI, e o estado da pipe vira nota registrada no app (`avisoDoCi`, `avisoDaAprovacao`),
// que nunca vai para o PR. O merge continua barrado pelo GitHub quando o check é obrigatório no
// ruleset; num repositório sem check obrigatório, o card da aprovação avisa.
//
// Dependência em aberto (`dependenciasAbertas`: PR, deploy ou aplicação que a sessão conferiu
// estar em aberto, caso engine-ai#266 com infra-k8s#189) é RESSALVA: vira ponto de atenção em
// lib/engine/ressalvas.js e a política da conta decide.
// Falta de dado não inventa nada: campo ausente ou lista vazia deixam passar.
const TETO_DE_DEPENDENCIAS = 10;
const TETO_DO_ITEM = 200;

function checksNoEstado(result, estados) {
  const lista = result && result.checksObrigatorios;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((c) => c && estados.includes(String(c.estado || '')))
    .map((c) => String(c.nome || '').trim())
    .filter(Boolean);
}

// Checks obrigatórios em FAILURE no head (a regra de biud-frontend#896). Reexportada pelo
// decision.js para a fachada do server.js.
function checksVermelhos(result) {
  return checksNoEstado(result, ['vermelho']);
}

function dependenciasAbertas(result) {
  const lista = result && result.dependenciasAbertas;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((d) => typeof d === 'string')
    .map((d) => d.trim().slice(0, TETO_DO_ITEM))
    .filter(Boolean)
    .slice(0, TETO_DE_DEPENDENCIAS);
}

function checksPendentes(result) {
  return checksNoEstado(result, ['rodando', 'ausente']);
}

// O estado do CI, para a lacuna informativa de evidence.js. Vermelho é o mais forte: com um check reprovando, os que ainda rodam não mudam nada.
function motivoDeEspera(result) {
  if (checksVermelhos(result).length) return 'ci_vermelho';
  if (checksPendentes(result).length) return 'ci_em_andamento';
  return null;
}

// O estado do CI como nota do card de um desfecho que não publicou a aprovação: quem lê o
// histórico precisa saber que a pipe não estava verde. Devolve a lista de motivos
// ({ text, kind }) pronta para entrar em reasons: vazia com CI verde.
function avisoDoCi(result) {
  const vermelhos = checksVermelhos(result);
  if (vermelhos.length) return [{ text: `check obrigatório vermelho no head (${vermelhos.join(', ')})`, kind: 'gate' }];
  const pendentes = checksPendentes(result);
  return pendentes.length ? [{ text: `check obrigatório ainda sem resultado no head (${pendentes.join(', ')})`, kind: 'gate' }] : [];
}

// O aviso no card de uma APROVAÇÃO que saiu (06/11/2026), nunca no PR. Dois casos em que o
// GitHub pode não segurar o que o Farol aprovou:
//   - o ruleset da branch de destino não exige check nenhum (`semCheckObrigatorio`, lido por
//     anexarChecksObrigatorios): o merge não é barrado nem com o CI vermelho;
//   - o check obrigatório vermelho ou sem resultado no head: a aprovação saiu assim (o revisor
//     não espera o CI), e o GitHub segura o merge até ele passar.
// O endpoint de rules não vê a proteção clássica da branch, por isso o primeiro texto condiciona;
// exigência que não deu para ler (null) não gera aviso, para o card não afirmar o que não sabe.
const TETO_DE_CHECKS_NO_AVISO = 10;
function avisoDaAprovacao(result) {
  const r = result || {};
  const avisos = [];
  if (r.semCheckObrigatorio === true) {
    const todos = Array.isArray(r.checksForaDoRuleset) ? r.checksForaDoRuleset : [];
    const fora = todos.slice(0, TETO_DE_CHECKS_NO_AVISO).map((c) => `${String(c.nome).slice(0, 60)} ${c.estado === 'vermelho' ? 'vermelho' : 'sem resultado'}`);
    if (todos.length > fora.length) fora.push(`mais ${todos.length - fora.length}`);
    avisos.push({ kind: 'gate', text: `aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge${fora.length ? `, e o CI não está verde no head (${fora.join(', ')})` : ''}` });
  }
  const vermelhos = checksVermelhos(r);
  const pendentes = checksPendentes(r);
  if (vermelhos.length) avisos.push({ kind: 'gate', text: `aprovado com check obrigatório vermelho no head (${vermelhos.join(', ')}): o ruleset segura o merge até ele passar, salvo bypass` });
  else if (pendentes.length) avisos.push({ kind: 'gate', text: `aprovado com check obrigatório ainda sem resultado no head (${pendentes.join(', ')}): o ruleset segura o merge até ele passar, salvo bypass` });
  return avisos;
}

// A linha informativa do card sobre o check obrigatório herdado da base
// (17/11/2026, checks-exigidos.js). Informa, não cobra: o herdado não pesa em nada, e a marca
// `informativo` é o que garante que a linha nunca entra na contagem das ressalvas (ressalvas.js).
// Sem herdado, lista vazia.
function avisoDosHerdados(result) {
  const herdados = Array.isArray(result && result.checksHerdados) ? result.checksHerdados : [];
  const nomes = herdados.map((c) => String((c && c.nome) || '').trim().slice(0, 60)).filter(Boolean).slice(0, TETO_DE_CHECKS_NO_AVISO);
  if (!nomes.length) return [];
  const sujeito = nomes.length === 1 ? `o check obrigatório ${nomes[0]} falha` : `os checks obrigatórios ${nomes.join(', ')} falham`;
  return [{ kind: 'gate', informativo: true, text: `para contexto: ${sujeito} também no commit atual da branch base (herdado da base), e por isso não pesa nesta decisão` }];
}

export default { avisoDosHerdados, motivoDeEspera, avisoDoCi, avisoDaAprovacao, dependenciasAbertas, checksVermelhos };
export { avisoDosHerdados, motivoDeEspera, avisoDoCi, avisoDaAprovacao, dependenciasAbertas, checksVermelhos };
