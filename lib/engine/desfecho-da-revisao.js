// O desfecho de uma revisão headless: o que sai no GitHub e o que fica gravado (saiu do
// runHeadlessReview, lib/engine/review.js, em 18/10/2026, junto da decisão sem mesa).
//
// A ordem é a de sempre para o approve e o reject da sessão, e os caminhos novos da v2.73.2
// entram depois deles, todos sob a MESMA conferência do head que andou e o mesmo dedup por
// head (regra do dono: o que a conta configurou para sair sozinho sai sozinho):
//   1. APPROVE (`shouldAutoApprove` ok);
//   2. REQUEST_CHANGES da sessão (`shouldAutoReject`);
//   3. REQUEST_CHANGES por defeito do PR: a sessão concluiu aprovar, mas a avaliação técnica
//      confirmou violação ou achado não resolvido, ou a parte do card deste PR não foi
//      entregue, e a conta reprova sozinha (desfecho-automatico.js monta o texto);
//   (o 4, REQUEST_CHANGES por CI obrigatório vermelho, saiu em 17/11/2026: o revisor nunca
//   espera o CI, e o CI não decide);
//   5. COMMENT em PR da própria conta que revisa (o GitHub recusa APPROVE e REQUEST_CHANGES do
//      autor), quando a política da classe é automática; resolvido como `commented_own_pr`.
// O que não sai segue sozinho, sem mesa (regra do dono de 17/11/2026: o revisor nunca espera
// decisão de gente): as esperas automáticas (prova, conflito, reenvio, commit novo) ou o desfecho
// sem mesa (desfecho-sem-mesa.js), que revisa de novo com limite e, esgotado, posta um COMMENT
// neutro pelos mesmos portões. PR fechado, PR próprio e instância isolada encerram sem postar
// (docs/REVIEW-GATES.md, "A decisão sem mesa").
import { roundGap } from './review-findings.js';
import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
import { inventoryGap } from './pr-inventory.js';
import { reviewCoherenceGap, reprovacaoSoPeloCi } from './review-consistency.js';
import { conferirCancelamento, iniciarPublicacao } from './cancelamento-revisao.js';
import { classify } from '../log-taxonomy.js';
import { reasonText, staleHeadText } from '../format.js';
import { falhaPassageira, postarComRetentativas } from './postagem-retentativa.js';
import { avisoDaAprovacao, avisoDoCi, avisoDosHerdados } from './gate-espera.js';
import { notasDaReprovacao } from './ressalvas.js';
import esperaProva from './espera-prova.js';
import { marcarConflito } from './espera-conflito.js';
import { mergeavelDoPr } from './gh-queries.js';
import { causasDosBloqueios } from './review-findings-contract.js';
import { textoDaRecusa } from './approval-policy.js';
import auto from './desfecho-automatico.js';
import semMesa from './desfecho-sem-mesa.js';
import { ehMeu } from './pr-proprio.js';
import { MAX_TENTATIVAS_POR_HEAD } from './busca-da-prova.js';
import { BLOQUEIO_CREDENCIAL } from './credencial-no-texto.js';
import { comentarioJaPublicado } from './comentario-proprio.js';
import { prepararRecuperacaoDaPublicacao } from './recuperacao-prova.js';
import { provaDaRetirada, retirarPedidoResolvido, temPedidoAutomatico, marcaDaRodada, MOTIVOS_PASSAGEIROS } from './retirada-de-pedido.js';
import { CONCLUIDA, marcarEtapa } from './progresso-revisao.js';
import { trechosDosAchados } from './trecho-do-achado.js';

const gateReason = (text) => ({ text, kind: 'gate' });
const infraReason = (text) => ({ text, kind: 'infra' });
const VEREDITOS = ['approve', 'request_changes'];

// Marcador do reenvio: falha transitória (log-taxonomy.js), recusa passageira da postagem ou a
// conta sem token no gh (o token volta sozinho; o reenvio segue com recuo longo, sem mesa).
function postRetryFor(event, erro, post) {
  if (falhaPassageira(post) || post?.semToken === true) return { event, attempts: 0 };
  return classify(erro).kind === 'transitorio' ? { event, attempts: 0 } : null;
}

// O que a recusa de um portão de postagem deixa para o desfecho (17/11/2026, sem mesa):
//   - texto barrado (credencial, ou linguagem depois da reconstrução): o COMMENT mínimo, montado
//     pelo motor, sem o texto do modelo;
//   - PR fechado ou mesclado, PR da própria conta, instância isolada: encerra sem postar;
//   - critérios inconsistentes: revisa de novo, como a falta de confiança no resultado.
// O portão continua recusando o que recusa: isto só decide o que vem DEPOIS da recusa.
const ENCERRA_SEM_POSTAR = { pr_fechado: true, pr_proprio: true, instancia_isolada: true };
function anotarRecusa(ctx, post) {
  if (!post || post.ok) return;
  if (post.blocked === BLOQUEIO_CREDENCIAL || post.blocked === 'internal_language') ctx.estado.textoRecusado = true;
  else if (ENCERRA_SEM_POSTAR[post.blocked]) ctx.estado.encerrar = post;
  else if (post.blocked === 'criterios_inconsistentes') ctx.estado.motivoSemMesa = 'criterios_inconsistentes';
}

// Posta e, se a trava de linguagem barrar, reconstrói o texto UMA vez (desfecho-automatico.js).
async function postarReconstruindo(engine, ctx, payload) {
  const { pr } = ctx;
  const enviar = (p) => postarComRetentativas(
    () => engine.postReview(pr, { ...p, commit_id: ctx.headShaAtual }, { via: 'revisao', roundReview: ctx.result.roundReview, verdict: ctx.result.verdict }));
  const post = await enviar(payload);
  if (post.ok || post.blocked !== 'internal_language') { anotarRecusa(ctx, post); return { post, payload }; }
  const novo = auto.reconstruirPayload(payload, engine.accountForPr(pr));
  if (!novo) { anotarRecusa(ctx, post); return { post, payload }; }
  engine.log('INFO', `${pr.key}: texto do review reconstruído uma vez depois da trava de linguagem.`);
  const segundo = await enviar(novo);
  anotarRecusa(ctx, segundo);
  return { post: segundo, payload: novo };
}

// Qual dos caminhos novos (3 ou 5) vale para este resultado. null = nenhum.
function caminhoNovo(engine, pr, result, autoDec, canReject) {
  // a coerência é conferida aqui, e não só pelo motivo do approve: resultado incompleto para em
  // analise_incompleta antes de chegar nela, e agora ele pode reprovar (revisão do PR #326)
  if (autoDec.motivo === 'review_inconsistent' || reviewCoherenceGap(result)) return null;
  if (inventoryGap(result) || roundGap(result, engine.config?.reviewRoundsMode, result.verdict)) return null;
  // sem o commit lido confirmado, o texto não tem âncora: o caminho novo não sai (invariante 4)
  if (!auto.origemDoDono(pr) || !auto.analiseSustentaReprovacao(result) || canReject || !result.headSha) return null;
  const conta = engine.accountForPr(pr);
  const reprova = engine.rejectPolicyFor(conta) === 'request_changes';
  if (autoDec.motivo === 'pr_proprio') {
    const limpo = engine.attentionPoints(result).length === 0;
    const automatica = result.verdict === 'approve' ? engine.approvePolicyFor(conta, limpo) === 'approve' : reprova;
    const payload = automatica ? auto.payloadDoPrProprio(result) : null;
    return payload ? { tipo: 'pr_proprio', evento: 'comment', payload } : null;
  }
  if (!reprova || result.verdict !== 'approve') return null;
  const defeitos = auto.defeitosDoPr(result);
  if (defeitos.length) return { tipo: 'defeito', evento: 'request_changes', defeitos, payload: auto.payloadDoDefeito(result, defeitos) };
  return null;
}

const ESTADO_DO_DEDUP = { request_changes: 'CHANGES_REQUESTED' };
const TOAST_NOVO = {
  pr_proprio: (key) => `💬 ${key}: o PR é da própria conta que revisa, então a revisão saiu como comentário.`,
  defeito: (key, item) => `🔴 ${key} reprovado (mudanças pedidas): ${reasonText((item.reasons || [])[0]) || 'defeito confirmado na avaliação técnica'}`,
};

// Caminhos 3 e 5. Devolve 'resolvido' (acabou) ou '' (falhou ao postar; o motivo e o reenvio
// ficam no resultado).
// Já está no PR? REQUEST_CHANGES pelo estado no commit; COMMENT pelo texto, porque um comentário
// anterior e alheio da conta no mesmo commit não pode calar este (comentario-proprio.js).
async function jaEstaNoPr(engine, ctx, novo) {
  if (novo.evento === 'comment') return (await comentarioJaPublicado(engine, ctx.pr, ctx.headShaAtual, novo.payload.body)) === true;
  const states = await engine.myReviewStates(ctx.pr, ctx.headShaAtual);
  return decisaoAutomaticaJaPublicada(ctx.pr, states) || (Array.isArray(states) && states.includes(ESTADO_DO_DEDUP[novo.evento]));
}

async function registrarJaDecidido(engine, ctx, action) {
  engine.activeReviews.get(ctx.id).cancellable = false;
  engine.recordDecision(ctx.pr, ctx.result, { status: 'already_reviewed', action });
  engine.emit('toast', { kind: 'info', text: `${ctx.pr.key}: você já tinha decidido sobre este commit no GitHub; não postei de novo.` });
  return true;
}

async function publicarCaminhoNovo(engine, ctx, novo) {
  const { pr, result, id } = ctx;
  const jaEstava = await jaEstaNoPr(engine, ctx, novo);
  conferirCancelamento(engine, id);
  if (jaEstava) {
    await registrarJaDecidido(engine, ctx, novo.evento);
    return 'resolvido';
  }
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, novo.payload);
  if (post.alreadyReviewed) { await registrarJaDecidido(engine, ctx, novo.evento); return 'resolvido'; }
  result.payloads = { ...(result.payloads || {}), [novo.evento]: payload };
  if (!post.ok) {
    result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o ${novo.evento === 'comment' ? 'COMMENT' : 'REQUEST_CHANGES'}: ${post.error}`)];
    result.postRetry = postRetryFor(novo.evento, post.error, post);
    ctx.estado.postFalhou = true;
    return '';
  }
  if (novo.tipo === 'defeito') result.reasons = auto.comMotivosDoDefeito(result.reasons, novo.defeitos, result);
  const item = engine.recordDecision(pr, result, { status: auto.statusAutomatico(novo.evento), action: novo.evento });
  engine.writeMemory(item, auto.rotuloDaMemoria(novo.evento));
  const publicItem = engine.decisionForUi(item);
  engine.emit(auto.eventoNaTela(novo.evento), { pr, result: publicItem });
  engine.emit('toast', { kind: 'ok', text: TOAST_NOVO[novo.tipo](pr.key, publicItem) });
  return 'resolvido';
}

// O head pode ter andado ENQUANTO a sessão lia o PR (biud-esg#224): nada é postado, e quem
// fecha o PR é o round seguinte, sobre o head certo. Head desconhecido não inventa rodada.
async function headAndou(engine, ctx) {
  let headAgora = '';
  try { headAgora = await engine.headSha(ctx.pr); } catch { /* sem sha não inventa rodada nova */ }
  if (!headAgora || !ctx.headShaAtual || headAgora === ctx.headShaAtual) return false;
  ctx.result.reasons = [gateReason(`${staleHeadText(ctx.headShaAtual, headAgora)}, então não posto: este texto fala do código anterior`),
    ...(ctx.result.reasons || [])];
  ctx.estado.staleHeadNovo = headAgora;
  engine.log('INFO', `${ctx.pr.key}: head andou de ${ctx.headShaAtual.slice(0, 8)} pra ${headAgora.slice(0, 8)} durante a sessão; não postei, a pendência ficou marcada stale_head.`);
  return true;
}

async function postarAprovacao(engine, ctx, pontos, autoDec) {
  const { pr, result, id } = ctx;
  // dedup: aprovação minha DESTE head já existe (biud-frontend#635); de head anterior não conta (#742)
  const states = await engine.myReviewStates(pr, ctx.headShaAtual);
  conferirCancelamento(engine, id);
  if (decisaoAutomaticaJaPublicada(pr, states) || (states && states.includes('APPROVED'))) {
    return registrarJaDecidido(engine, ctx, 'approve');
  }
  // o corpo do APPROVE vai LIMPO; as ressalvas ficam no app (campo attention)
  // CI fora do verde ou repositório sem check obrigatório: o card da aprovação avisa (gate-espera.js),
  // mas só depois que o APPROVE saiu; com a postagem falhando, o motivo segue neutro (avisoDoCi)
  const points = [...pontos, ...avisoDoCi(result)];
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, result.payloads.approve);
  if (post.alreadyReviewed) return registrarJaDecidido(engine, ctx, 'approve');
  // o texto que saiu (ou que o reenvio vai mandar) é o reconstruído, se houve reconstrução
  result.payloads = { ...result.payloads, approve: payload };
  if (post.ok) {
    // a retirada do pedido anterior que ficou para depois (head sem confirmação, falha passageira)
    // viaja na decisão aprovada, para a varredura tentar de novo (retirada-de-pedido.js)
    const marca = ctx.estado.retiradaPendente ? { retiradaPendente: ctx.estado.retiradaPendente } : {};
    const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: [...pontos, ...avisoDaAprovacao(result)], ...marca });
    const publicItem = engine.decisionForUi(item);
    const publicPoints = publicItem.attention || [];
    engine.writeMemory(item, 'APPROVE');
    engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
    engine.emit('toast', {
      kind: 'ok', text: publicPoints.length
        ? `⚠️ ${pr.key} aprovado com ${publicPoints.length} ressalva(s): ${reasonText(publicPoints[0])}`
        : `✅ ${pr.key} aprovado sem ressalvas.`
    });
    return true;
  }
  result.reasons = [...points, infraReason(`falha ao postar o APPROVE: ${post.error}`)];
  // recusa técnica na publicação volta ao funil da recuperação (PR #253, recuperacao-prova.js)
  ctx.estado.postFalhou = prepararRecuperacaoDaPublicacao(result, autoDec, post);
  // falha transitória: o retryFailedPosts reenvia o MESMO payload nos próximos ciclos, e o aviso
  // da aprovação que saiu viaja junto, para entrar no card quando o reenvio publicar
  const retry = postRetryFor('approve', post.error, post);
  result.postRetry = retry && { ...retry, atencaoAoPublicar: [...pontos, ...avisoDaAprovacao(result)] };
  return false;
}

async function postarReprovacao(engine, ctx) {
  const { pr, result, id } = ctx;
  // dedup por head: não re-pede mudanças se já pedi PARA ESTE HEAD (#742)
  const states = await engine.myReviewStates(pr, ctx.headShaAtual);
  conferirCancelamento(engine, id);
  if (decisaoAutomaticaJaPublicada(pr, states) || (states && states.includes('CHANGES_REQUESTED'))) {
    return registrarJaDecidido(engine, ctx, 'request_changes');
  }
  const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body) };
  iniciarPublicacao(engine, id);
  const { post, payload } = await postarReconstruindo(engine, ctx, rc);
  if (post.alreadyReviewed) return registrarJaDecidido(engine, ctx, 'request_changes');
  result.payloads = { ...result.payloads, request_changes: payload };
  if (post.ok) {
    const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
    const publicItem = engine.decisionForUi(item);
    engine.writeMemory(item, 'REQUEST_CHANGES');
    engine.emit('auto-rejected', { pr, result: publicItem });
    engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
    return true;
  }
  result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
  ctx.estado.postFalhou = true;
  result.postRetry = postRetryFor('request_changes', post.error, post);
  return false;
}

// A reprovação que se apoia só no estado do PR (05/11/2026, desfecho-automatico.js): nada da
// revisão vai ao PR. Conflito vai à espera do conflito (espera-conflito.js), que o commit novo
// destrava; CI não segura (o revisor nunca espera o CI, 17/11/2026: o pedido só pelo CI sai do
// caminho com o motivo dito); dependência e arquivo fora do diff seguem o desfecho sem mesa.
// Resultado incoerente ou incompleto segue na recuperação de sempre. O conflito que o modelo
// declarou é conferido no GitHub: MERGEABLE segue o desfecho sem mesa com o motivo, e UNKNOWN
// ou leitura que falha seguem como antes.
async function esperaDeEstado(engine, ctx) {
  const { pr, result } = ctx;
  if (result.postRetry || result.analysisStatus !== 'complete' || reviewCoherenceGap(result) || !auto.reprovacaoSoDeEstado(result)) return null;
  const motivo = gateReason(textoDaRecusa(engine, pr, 'bloqueio_de_estado', result));
  const daRevisao = result.reasons || [];
  const causas = causasDosBloqueios(result);
  const conflito = causas.has('conflito') && result.headSha;
  if (conflito && await mergeavelDoPr(engine, pr).catch(() => null) === 'MERGEABLE') {
    result.reasons = [motivo, gateReason('o relatório fala em conflito, mas o GitHub diz que o PR é mesclável'), ...daRevisao];
    return null;
  }
  if (conflito) {
    // o aviso do conflito é o da própria marca (um por PR e head)
    marcarConflito(engine, pr.key, result.headSha, Date.now(), pr.updatedAt);
    return { extra: { blockedKind: 'conflito' }, reasons: [motivo, ...daRevisao], avisar: () => { } };
  }
  const foraDaDecisao = causas.has('ci') ? [gateReason(textoDaRecusa(engine, pr, 'ci_fora_da_decisao', result))] : [];
  result.reasons = [...foraDaDecisao, motivo, ...daRevisao];
  return null;
}

// O motivo do desfecho sem mesa: o que o COMMENT neutro diz que não deu para concluir.
function motivoSemMesa(ctx, autoDec) {
  if (ctx.estado.textoRecusado) return 'texto';
  if (ctx.estado.motivoSemMesa) return ctx.estado.motivoSemMesa;
  if (auto.reprovacaoSoDeEstado(ctx.result)) return 'bloqueio_de_estado';
  return autoDec.motivo || 'nao_aprovavel';
}

const STATUS_DO_FECHADO = { MERGED: 'already_merged', CLOSED: 'already_closed' };

// O que nenhuma espera automática pegou: encerra sem postar, revisa de novo ou posta o COMMENT
// neutro (desfecho-sem-mesa.js). Nunca fica parado à espera de um clique (17/11/2026).
async function semEspera(engine, ctx, autoDec, pendingExtra) {
  const { pr, result } = ctx;
  const fechado = ctx.estado.encerrar;
  if (fechado || autoDec.motivo === 'pr_proprio' || ehMeu(engine, pr)) {
    const texto = fechado ? `nada foi publicado: ${fechado.error || 'um portão de postagem recusou'}` : 'o PR é da própria conta que revisa: não há o que decidir, nada foi publicado';
    result.reasons = [gateReason(texto), ...(result.reasons || [])];
    const status = (fechado && STATUS_DO_FECHADO[fechado.estado]) || semMesa.STATUS_SEM_POSTAR;
    engine.recordDecision(pr, result, { ...pendingExtra, status, action: 'skip' });
    engine.emit('toast', { kind: 'info', text: `${pr.key}: ${texto}.` });
    return;
  }
  const motivo = motivoSemMesa(ctx, autoDec);
  // o texto barrado sai como COMMENT mínimo na varredura seguinte: o card registra a recusa agora
  if (motivo === 'texto') {
    const marca = { head: result.headSha || '', motivo, rodadas: semMesa.RODADAS_EXTRAS, desde: Date.now(), proximaEm: Date.now() + semMesa.UM_CICLO_MS };
    engine.recordDecision(pr, result, { ...pendingExtra, semMesa: marca });
    engine.emit('toast', { kind: 'info', text: `${pr.key}: o parecer não pôde ser publicado como foi escrito; sai um comentário neutro no próximo ciclo.` });
    return;
  }
  const noTeto = Number(result.tentativasDaProva) >= MAX_TENTATIVAS_POR_HEAD;
  const armada = noTeto ? null : semMesa.armar(engine, pr, result, motivo);
  if (!armada) { await semMesa.encerrarNaRevisao(engine, ctx, motivo); return; }
  result.reasons = armada.reasons;
  engine.recordDecision(pr, result, { ...pendingExtra, ...armada.extra });
  engine.emit('toast', { kind: 'info', text: `↻ ${pr.key}: não deu para concluir a revisão com segurança; reviso de novo sozinho neste commit.` });
}

// Pendência: espera automática (prova, resultado incompleto, estado do PR, reenvio, commit novo)
// ou o desfecho sem mesa. Nenhuma termina à espera de gente.
async function registrarPendencia(engine, ctx, pontos, autoDec) {
  const { pr, result, id } = ctx;
  const recusa = textoDaRecusa(engine, pr, autoDec.motivo, result);
  if (recusa) result.reasons = [gateReason(recusa), ...(result.reasons || [])];
  // o pedido que só o CI vermelho sustenta: o CI não decide (shouldAutoReject o segurou)
  if (reprovacaoSoPeloCi(result)) {
    result.reasons = [gateReason(textoDaRecusa(engine, pr, 'ci_fora_da_decisao', result)), ...(result.reasons || [])];
  }
  const deEstado = await esperaDeEstado(engine, ctx);
  // postagem que falhou por algo passageiro é do reenvio, não de uma espera
  const espera = deEstado || (result.postRetry ? null : esperaProva.armarEspera(engine, pr, autoDec.motivo, result, pontos));
  // a recuperação (PR #253) é o agendador único: a reconferência técnica não corre em paralelo
  if (espera) Object.assign(result, { reasons: espera.reasons, technicalRecheck: false });
  // o check herdado da base, numa linha que só informa (gate-espera.js)
  result.reasons = [...(result.reasons || []), ...avisoDosHerdados(result)];
  conferirCancelamento(engine, id);
  engine.activeReviews.get(id).cancellable = false;
  const pendingExtra = { status: 'pending', ...(espera && espera.extra) };
  if (ctx.estado.retiradaPendente) pendingExtra.retiradaPendente = ctx.estado.retiradaPendente;
  if (result.technicalRecheck) pendingExtra.blockedKind = 'technical_recheck';
  if (ctx.estado.staleHeadNovo) Object.assign(pendingExtra, { blockedKind: 'stale_head', blockedHead: ctx.estado.staleHeadNovo });
  // o que já tem caminho automático (espera, reenvio, commit novo, reconferência) fica com ele
  if (!espera && !result.postRetry && !pendingExtra.blockedKind) return semEspera(engine, ctx, autoDec, pendingExtra);
  const item = engine.recordDecision(pr, result, pendingExtra);
  const publicItem = engine.decisionForUi(item);
  if (espera) return espera.avisar(engine, pr, publicItem);
  const texto = ctx.estado.staleHeadNovo
    ? `↻ ${pr.key}: chegou commit novo durante a revisão, então nada foi postado; reviso o commit novo sozinho.`
    : `⏳ ${pr.key}: ${reasonText((publicItem.reasons || [])[0]) || 'a postagem segue sozinha'}`;
  engine.emit('toast', { kind: 'info', text: texto });
}

// O pedido de mudanças anterior sai antes do desfecho, e o desfecho segue igual: retirar não
// aprova (retirada-de-pedido.js). Cancelamento lança, como em toda postagem.
async function retirarPedidoAnterior(engine, ctx) {
  const { pr, result, id } = ctx;
  conferirCancelamento(engine, id);
  // o headAndou deixa passar a leitura que falha; aqui, sem confirmar o head, a varredura decide
  const atual = await engine.headSha(pr).catch(() => '');
  if (atual !== ctx.headShaAtual) {
    ctx.estado.retiradaPendente = marcaDaRodada(ctx.headShaAtual);
    return;
  }
  const r = await retirarPedidoResolvido(engine, pr, ctx.headShaAtual, {
    antesDeEnviar: () => iniciarPublicacao(engine, id),
  });
  if (r.ok) result.pedidoRetirado = { head: ctx.headShaAtual, at: Date.now() };
  if (MOTIVOS_PASSAGEIROS.has(r.motivo)) ctx.estado.retiradaPendente = marcaDaRodada(ctx.headShaAtual);
}

// A rodada que só rodou para retirar o meu pedido (skip-review.js) não aprova por cima de quem já
// decidiu este commit. Devolve true se resolveu aqui.
async function dispensarAprovacaoEmHeadDecidido(engine, ctx) {
  const { pr, result } = ctx;
  if (pr.manual || !temPedidoAutomatico(engine, pr, result.headSha)) return false;
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist?.decidido) return false;
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  result.reasons = [gateReason(`outra pessoa já decidiu este commit (${nomes}): a aprovação automática não é necessária, nada foi postado`), ...(result.reasons || [])];
  engine.activeReviews.get(ctx.id).cancellable = false;
  // a retirada que ficou para depois não se perde: a varredura a conclui
  const marca = ctx.estado.retiradaPendente;
  engine.recordDecision(pr, result, { status: 'approval_not_needed', action: 'skip', ...(marca ? { retiradaPendente: marca } : {}) });
  engine.emit('toast', { kind: 'info', text: `${pr.key}: outra pessoa já decidiu este commit (${nomes}); a aprovação automática não é necessária.` });
  return true;
}

// ctx: { pr, result, id, headShaAtual }. A porcentagem do cartão (progresso-revisao.js) entra
// na postagem quando o desfecho começa e só chega a 100 quando ele termina, postando ou levando
// à mesa; o desfecho que lança (cancelamento, falha) não conclui.
async function concluirRevisao(engine, ctx) {
  marcarEtapa(engine, ctx.id, 'postagem');
  // o trecho do diff de cada achado, enquanto o escopo da sessão existe (trecho-do-achado.js)
  if (ctx.result) ctx.result.trechosDosAchados = trechosDosAchados(engine.activeReviews?.get(ctx.id)?.scopeRoot, ctx.result.findings);
  await decidirDesfecho(engine, ctx);
  marcarEtapa(engine, ctx.id, CONCLUIDA);
}

async function decidirDesfecho(engine, ctx) {
  const { pr, result } = ctx;
  ctx.estado = { staleHeadNovo: '', postFalhou: false };
  // as ressalvas, lidas UMA vez e antes de qualquer motivo de gate entrar em reasons
  const pontos = engine.attentionPoints(result);
  Object.assign(result, auto.comDefeitoDoApp(result));
  const autoDec = engine.shouldAutoApprove(pr, result);
  let canAuto = autoDec.ok === true;
  if (inventoryGap(result) && result.verdict !== 'approve') result.reasons = [gateReason(inventoryGap(result)), ...(result.reasons || [])];
  if (roundGap(result, engine.config?.reviewRoundsMode, result.verdict) && result.verdict !== 'approve') result.reasons = [gateReason(roundGap(result, engine.config?.reviewRoundsMode, result.verdict)), ...(result.reasons || [])];
  let canReject = engine.shouldAutoReject(pr, result);
  let novo = caminhoNovo(engine, pr, result, autoDec, canReject);
  if (!auto.origemDoDono(pr) && VEREDITOS.includes(result.verdict)) {
    result.reasons = [gateReason('revisão de origem desconhecida (nem a fila, nem você): o parecer não sai sozinho; reviso de novo e, sem conclusão, sai um comentário neutro'),
      ...(result.reasons || [])];
  }
  // só quem tem pedido automático anterior paga a releitura do head
  let retira = temPedidoAutomatico(engine, pr, result.headSha) ? provaDaRetirada(engine, pr, result) : 'nao';
  if ((canAuto || canReject || novo || retira !== 'nao') && await headAndou(engine, ctx)) {
    canAuto = false;
    canReject = false;
    novo = null;
    retira = 'nao';
  }
  if (retira === 'sim') await retirarPedidoAnterior(engine, ctx);
  // reprovação que sai com lacuna, checkpoint divergente ou contestação: o card registra (01/10/2026)
  if (canReject) result.reasons = [...notasDaReprovacao(result).map(gateReason), ...(result.reasons || [])];
  if (canAuto && await dispensarAprovacaoEmHeadDecidido(engine, ctx)) return;
  if (canAuto && await postarAprovacao(engine, ctx, pontos, autoDec)) return;
  if (canReject && await postarReprovacao(engine, ctx)) return;
  if (novo) {
    const r = await publicarCaminhoNovo(engine, ctx, novo);
    if (r === 'resolvido') return;
  }
  await registrarPendencia(engine, ctx, pontos, autoDec);
}

export default { concluirRevisao, postRetryFor };
export { concluirRevisao, postRetryFor, caminhoNovo };
