// O que sustentou cada decisão, guardado junto dela (03/10/2026).
//
// Até aqui o recordDecision descartava `decision`, `coverage`, `alcance` e o estado dos
// checks obrigatórios: medido em 03/10/2026, nenhuma das 60 aprovações automáticas desde
// 30/09 preservava esses campos, e 47 dos 60 relatórios nem mencionavam o `pr-reviewer`.
// Não dava para reconstruir se uma aprovação cumpriu o protocolo nem com que prova saiu.
//
// Aqui fica um RESUMO, não o envelope inteiro: o histórico guarda 3000 decisões, e a lista
// completa de arquivos de um PR grande multiplicaria o decisions.json. Contagens mais uma
// amostra limitada bastam para auditar ("aprovou com 83 lacunas" é o fato que importa).
// PURO: só lê o resultado que o runHeadlessReview já completou.
import { coverageGap } from './file-proof.js';
import { itensParaQuemMergeia } from './para-quem-mergeia.js';
import { criteriosDoCard } from './criterios-do-card.js';
import { trechosGravados } from './trecho-do-achado.js';

const AMOSTRA = 10;

function contar(v) {
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function textos(lista) {
  return (Array.isArray(lista) ? lista : []).map((x) => String((x && x.nome) || x || '').slice(0, 200)).filter(Boolean);
}

// O que a sessão declarou sobre o protocolo (`protocolo.prReviewer`): rodou, dispensou (com o
// motivo) ou não disse. Valor fora disso vira "nao_declarado", nunca "rodou".
function protocoloDeclarado(result) {
  const p = (result && result.protocolo) || {};
  const estado = ['rodou', 'dispensado'].includes(p.prReviewer) ? p.prReviewer : 'nao_declarado';
  return { prReviewer: estado, motivo: String(p.motivo || '').trim().slice(0, 300) };
}

// null = o campo nem chegou (sessão sem leitura de checks); lista vazia = todos verdes,
// sem exigência ou leitura que falhou (anexarChecksObrigatorios grava [] nesse caso)
function checksNaoVerdes(r) {
  if (!Array.isArray(r.checksObrigatorios)) return null;
  return r.checksObrigatorios.map((c) => `${String((c && c.nome) || '?').slice(0, 120)}:${String((c && c.estado) || '?')}`);
}

// Os checks obrigatórios do head como o motor os leu no fim da revisão (anexarChecksObrigatorios,
// checks-exigidos.js), para o detalhe da revisão mostrar (17/11/2026): se a leitura foi no commit
// revisado, se o ruleset da base exige check, o que faltava no head e o que faltava por herança da
// base (o check obrigatório que também falha no commit atual da base, que não pesa na decisão).
// null = a leitura nem chegou ao resultado. Sem a lista dos verdes: o motor só guarda o que falta.
const TETO_DOS_CHECKS = 20;
function checkLido(c) {
  return { nome: String((c && c.nome) || '?').slice(0, 120), estado: String((c && c.estado) || '?').slice(0, 20) };
}

function checksDoHead(r) {
  if (!Array.isArray(r.checksObrigatorios)) return null;
  const herdados = Array.isArray(r.checksHerdados) ? r.checksHerdados : [];
  return {
    conferidoNoHead: typeof r.headSha === 'string' && r.headSha !== '' && r.checksVerifiedHead === r.headSha,
    semExigencia: r.semCheckObrigatorio === true,
    naoVerdes: r.checksObrigatorios.slice(0, TETO_DOS_CHECKS).map(checkLido),
    herdados: herdados.slice(0, TETO_DOS_CHECKS).map((c) => ({ ...checkLido(c), naBase: String((c && c.naBase) || '').slice(0, 20) })),
  };
}

// O que a sessão disse do card (17/10/2026): o card inteiro (`cardMet`) e a parte que cabe a
// ESTE PR (`cardParteDestePr`). Só booleano vale; o resto vira null. Só a parte falsa bloqueia
// a aprovação (approvalGaps); o card inteiro não comprovado é ressalva.
const booleanoOuNull = (v) => (typeof v === 'boolean' ? v : null);

// O card na decisão: o inteiro, a parte deste PR e, quando a sessão os declarou (o campo opcional
// `criteriosDoCard`, 17/11/2026), os critérios um a um. Os critérios só informam o detalhe da
// revisão (GET /api/decision): nada no motor decide por eles (criterios-do-card.js).
function cardDeclarado(r) {
  const card = { inteiro: booleanoOuNull(r.cardMet), parteDestePr: booleanoOuNull(r.cardParteDestePr) };
  const criterios = criteriosDoCard(r.criteriosDoCard);
  if (criterios) card.criterios = criterios;
  const leitura = leituraDoCard(r.cardLeitura);
  if (leitura) card.leitura = leitura;
  return card;
}

// A leitura do card pelo MOTOR, antes da sessão (review.js, 19/11/2026): lido (e se veio do
// cache) ou o código de por que não. Até aqui só a falha deixava rastro, num WARN do log, e não
// dava para contar as revisões com card lido. Só informa: nada no motor decide por este campo
// (quem segura a decisão continua sendo o motivo de gate "card não lido no Jira").
function leituraDoCard(l) {
  if (!l || typeof l !== 'object' || typeof l.ok !== 'boolean') return null;
  return l.ok ? { lido: true, cache: l.fromCache === true } : { lido: false, codigo: String(l.code || '').slice(0, 60) };
}

// Quem pediu a revisão (B1), com a forma fixa { por, em, time }; qualquer outra coisa vira null.
function pedidoDeclarado(p) {
  if (!p || typeof p.por !== 'string' || typeof p.em !== 'string') return null;
  return { por: p.por, em: p.em, time: p.time === true };
}

// A leitura herdada de OUTRO PR do repositório (prova-do-repositorio.js), com a origem, só pela
// lista que o engine montou (result.coberturaEntrePrs): "lido em org/repo#N, commit X".
function coberturaEntrePrs(r) {
  const lista = Array.isArray(r.coberturaEntrePrs) ? r.coberturaEntrePrs.filter((c) => c && c.arquivo) : [];
  return { herdados: lista.length,
    amostra: lista.slice(0, AMOSTRA).map((c) => `${c.arquivo}: lido em ${c.pr}, commit ${c.head}`.slice(0, 200)) };
}

function provasDaDecisao(result) {
  const r = result || {};
  const cov = r.coverage || {};
  const lacunas = coverageGap(r);
  const decision = ['auto_approve', 'needs_decision'].includes(r.decision) ? r.decision : '';
  return {
    decision,
    cobertura: {
      total: contar(cov.total),
      lidos: contar(cov.reviewed),
      faltando: contar(cov.missing),
      lacunas: lacunas.length,
      amostra: lacunas.slice(0, AMOSTRA).map((t) => String(t).slice(0, 200)),
      entrePrs: coberturaEntrePrs(r),
    },
    // herdados: declarações de arquivo inalterado que vieram da prova anterior (alcance.js)
    alcance: { declarados: Array.isArray(r.alcance) ? r.alcance.length : 0, herdados: contar(r.alcanceHerdado) },
    checksNaoVerdes: checksNaoVerdes(r),
    checks: checksDoHead(r),
    dependenciasAbertas: textos(r.dependenciasAbertas).slice(0, AMOSTRA),
    card: cardDeclarado(r),
    paraQuemMergeia: itensParaQuemMergeia(r),
    protocolo: protocoloDeclarado(r),
    pedido: pedidoDeclarado(r.pedido),
    // o trecho do diff de cada achado com arquivo e linha, lido no desfecho (trecho-do-achado.js,
    // 17/11/2026): só informa o detalhe da revisão, nada decide por ele
    trechos: trechosGravados(r.trechosDosAchados),
  };
}

export default { provasDaDecisao };
export { provasDaDecisao };
