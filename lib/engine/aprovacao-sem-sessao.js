// A aprovação sem sessão do Claude (24/11/2026), extraída do diff vazio de linhagem
// (diff-vazio-de-linhagem.js) para servir também ao sync por herança sem nenhum arquivo a ler
// (sync-sem-sessao.js). O caminho é um só: a decisão de gente no head, a label de outra conta, o
// PR fechado e o head que andou encerram sem postar; os checks obrigatórios viram aviso no card,
// como em toda aprovação; o dedup por head; a prova da publicação técnica gravada só na memória
// do motor (`technicalApprovals`, nunca a saída de um modelo), e largada quando a postagem não sai
// e não vai ao reenvio; e todos os portões de `postReview`.
//
// `Desfecho` = { headSha, baseSha, inventarioDiff, extra, corpo, relatorio, prova, toast }: quem
// chama diz o texto fixo do APPROVE, o relatório interno, o que a decisão guarda (`extra`, com o
// `caminho`), a prova espalhada na entrada de `technicalApprovals` e o aviso da tela.
import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
import { anexarChecksObrigatorios } from './checks-exigidos.js';
import { avisoDaAprovacao } from './gate-espera.js';
import { falhaPassageira, postarComRetentativas } from './postagem-retentativa.js';
import { classify } from '../log-taxonomy.js';
import semMesa from './desfecho-sem-mesa.js';
import { iniciarPublicacao } from './cancelamento-revisao.js';

const STATUS_DO_FECHADO = { MERGED: 'already_merged', CLOSED: 'already_closed' };

const curto = (sha) => String(sha || '').slice(0, 7);
const motivo = (text) => ({ text, kind: 'gate' });

function resultadoSemSessao(d, verdict, payloads, reportMarkdown) {
  return {
    headSha: d.headSha, verdict, analysisStatus: 'complete', reasons: [], reportMarkdown, payloads,
    inventarioDiff: d.inventarioDiff, approvalEvidence: [], findings: [],
  };
}

// O que impede postar agora: gente no head, cancelamento, PR fechado, label de outra conta, head
// que andou. Devolve null quando pode postar, ou o registro já feito.
async function impedimentoSemSessao(engine, pr, d) {
  const antes = (await semMesa.gentePorPerto(engine, pr)) || await semMesa.conferirAntesDoComentario(engine, pr, d.headSha);
  if (!antes) return null;
  const result = resultadoSemSessao(d, 'approve', {}, '');
  if (antes.andou) {
    result.reasons = [motivo(`chegou commit novo (${curto(d.headSha)} -> ${curto(antes.andou)}): nada foi publicado, e a rodada do head novo é a que vale`)];
    return engine.recordDecision(pr, result, { status: 'pending', blockedKind: 'stale_head', blockedHead: antes.andou, ...d.extra });
  }
  result.reasons = [motivo(antes.texto)];
  return engine.recordDecision(pr, result, { status: antes.encerra, action: 'skip', ...d.extra });
}

const largarProva = (engine, pr) => { engine.technicalApprovals?.delete?.(pr.key); };

// O reenvio de cada evento: o APPROVE volta pelo reenvio normal, com o aviso da aprovação; o COMMENT
// neutro, no formato do desfecho sem mesa, que confere gente, label, estado e head de novo e publica
// com o status do comentário inconclusivo.
function reenvio(evento, result) {
  if (evento === 'approve') return { postRetry: { event: 'approve', attempts: 0, atencaoAoPublicar: avisoDaAprovacao(result) } };
  return semMesa.POSTAGEM_PENDENTE(result.payloads.comment);
}

function falhouSemSessao(engine, pr, result, d, evento, post) {
  const erro = post.error || post.blocked || 'erro desconhecido';
  const passageira = falhaPassageira(post) || post.semToken === true || classify(erro).kind === 'transitorio';
  const nome = evento === 'approve' ? 'APPROVE' : 'COMMENT';
  result.reasons = [{ text: `falha ao postar o ${nome}: ${erro}`, kind: passageira ? 'infra' : 'gate' }];
  if (passageira) return engine.recordDecision(pr, result, { status: 'pending', ...reenvio(evento, result), ...d.extra });
  largarProva(engine, pr);
  const status = STATUS_DO_FECHADO[post.estado] || semMesa.STATUS_SEM_POSTAR;
  return engine.recordDecision(pr, result, { status, action: 'skip', ...d.extra });
}

async function aprovarSemSessao(engine, pr, d, id) {
  const payload = { event: 'APPROVE', body: d.corpo, comments: [] };
  const result = resultadoSemSessao(d, 'approve', { approve: payload }, d.relatorio);
  // os checks obrigatórios, como em toda aprovação: não seguram, viram aviso no card
  await anexarChecksObrigatorios(engine, pr, result);
  const states = await engine.myReviewStates(pr, d.headSha);
  if (decisaoAutomaticaJaPublicada(pr, states) || (Array.isArray(states) && states.includes('APPROVED'))) {
    return engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve', ...d.extra });
  }
  // a prova da publicação, gravada pelo motor e só na memória (a saída de um modelo nunca chega aqui)
  if (!(engine.technicalApprovals instanceof Map)) engine.technicalApprovals = new Map();
  engine.technicalApprovals.set(pr.key, { report: null, evidence: [], criteriaEvidence: null, provaEsgotada: false, evidenceVersion: 2, ...d.prova });
  iniciarPublicacao(engine, id);
  const post = await postarComRetentativas(() => engine.postReview(pr, { ...payload, commit_id: d.headSha }, { via: 'revisao' }));
  if (post.alreadyReviewed) largarProva(engine, pr);
  if (post.alreadyReviewed) return engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve', ...d.extra });
  if (!post.ok) return falhouSemSessao(engine, pr, result, d, 'approve', post);
  const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: avisoDaAprovacao(result), ...d.extra });
  const publico = engine.decisionForUi(item);
  engine.emit('auto-approved', { pr, result: publico, points: publico.attention || [] });
  engine.emit('toast', { kind: 'ok', text: d.toast });
  return item;
}

export { resultadoSemSessao, impedimentoSemSessao, aprovarSemSessao, falhouSemSessao };
