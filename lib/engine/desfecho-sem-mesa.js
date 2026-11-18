// O desfecho sem mesa (17/11/2026). Regra do dono: o revisor nunca espera decisão de gente.
// Não existe mais "Precisa de você": nenhum desfecho termina parado à espera de um clique.
//
// O que antes ia à mesa por falta de confiança no resultado (análise que não fechou, inventário
// ou rodada abertos, resultado incoerente, origem sem marca, lacuna de prova depois do teto,
// recusa de critérios, bloqueio só de estado do PR) agora segue sozinho, por um caminho que
// também passa pelos portões de postagem:
//   1. o motor revisa de novo, no mesmo commit, até RODADAS_EXTRAS vezes, com recuo entre elas
//      (`semMesa` na pendência, gravado no decisions.json, então sobrevive a reinício). Quem
//      relança é o round automático de sempre, pela marca stale_head no mesmo head, como a busca
//      da prova faz (espera-prova.js);
//   2. esgotado o limite, ou quando outra rodada não muda nada (diff acima do limite do GitHub,
//      arquivo protegido sem projeção, texto que as travas recusaram), o motor posta um COMMENT
//      neutro, montado só pelo motor, dizendo o que foi revisado e o que não deu para concluir.
//      Nunca APPROVE nem REQUEST_CHANGES sem admissibilidade: o COMMENT não aprova nem reprova.
//      Ele passa pelo postReview como qualquer outro texto (instância isolada, credencial,
//      critérios, linguagem, conta sem token, PR fechado);
//   3. o COMMENT que um portão recusa encerra sem postar (`not_posted`), com o motivo no card:
//      não há o que decidir. O que falha por instabilidade vai ao reenvio de sempre.
//
// O PR que saiu do automático (revisão automática desligada para ele, ou gente que já decidiu o
// commit) encerra sem postar: é o motor respeitando o time, não esperando decisão.
//
// A varredura do ciclo também adota toda pendência sem caminho automático (a mesa gravada antes
// desta regra, ou um caminho que ficou sem dono): nenhuma fica parada para sempre.
import io from '../io.js';
import { classify } from '../log-taxonomy.js';
import { liberarAncora } from './rereview-ancora.js';
import { comentarioJaPublicado } from './comentario-proprio.js';
import { politicaDeInicio } from './review-scope.js';
import { MAX_TENTATIVAS_POR_HEAD } from './busca-da-prova.js';

// Rodadas extras no mesmo commit antes do COMMENT neutro (decisão de 17/11/2026), e o recuo
// antes de cada uma. Commit novo zera a conta: é outro código.
const RODADAS_EXTRAS = 2;
const MINUTO = 60_000;
const RECUOS_MS = Object.freeze([15 * MINUTO, 60 * MINUTO]);
// A rodada extra pedida e que não concluiu nesse prazo (o round segurado por rascunho, conflito
// ou conta sem token, por exemplo) conta como esgotada: o desfecho não espera para sempre.
const TETO_DA_RODADA_MS = 6 * 60 * MINUTO;
const TETO_DO_MOTIVO = 300;
// O que é entregue ao desfecho anda na varredura SEGUINTE, nunca na mesma: o card registra a
// recusa ou a espera largada no ciclo em que ela aconteceu, e o COMMENT sai no próximo.
const UM_CICLO_MS = 60_000;

// O teto CONJUNTO de sessões extras por PR e head, somando as rodadas extras daqui e as
// tentativas da busca da prova (espera-prova.js), que sobrevive à troca de pendência: com motivos
// alternados, cada recuperação recomeçava a própria conta e as duas se relançavam sem fim. É o
// mesmo teto que a busca da prova já tinha sozinha; passado ele, o COMMENT neutro.
const TETO_CONJUNTO = MAX_TENTATIVAS_POR_HEAD;
// A adoção da subida escalona as rodadas: no máximo uma por intervalo, nunca todas juntas.
const ESCALONAMENTO_MS = 5 * MINUTO;
// O estacionamento que só uma pessoa desfaz: a recuperação não o desfaz nem relança.
const PARADAS_DE_GENTE = new Set(['cancelado', 'label-retirada']);
const SUFIXO_DA_LABEL = ':revisando';

const STATUS_COMENTADO = 'commented_inconclusive';
const STATUS_SEM_POSTAR = 'not_posted';

// O que não deu para concluir, em texto público: só frases do motor, nunca texto do modelo nem
// motivo interno, para o COMMENT passar pela trava de linguagem sem reconstrução.
const O_QUE_FALTOU = Object.freeze({
  analise_incompleta: 'a análise do código não fechou por completo',
  inventario_incompleto: 'nem todos os arquivos alterados puderam ser conferidos',
  inventario_no_limite: 'o PR tem mais arquivos alterados do que o GitHub lista, e o diff não pôde ser lido por inteiro',
  round_incompleto: 'pontos levantados em rodadas anteriores ficaram sem resposta conferida',
  review_inconsistent: 'a conclusão da leitura ficou inconsistente com os pontos levantados',
  nao_aprovavel: 'a conclusão da leitura não ficou pronta para ser publicada',
  sem_texto: 'a conclusão da leitura não ficou pronta para ser publicada',
  prova_tecnica_incompleta: 'parte da verificação técnica não pôde ser concluída',
  bloqueio_de_estado: 'o pedido de mudanças dependia só do estado do PR (CI, dependência ou arquivo fora do diff), e não de um defeito no código',
  criterios_inconsistentes: 'os critérios da leitura ficaram inconsistentes entre as passadas',
  texto: 'o parecer não pôde ser publicado como foi escrito',
  rodada: 'a nova leitura deste commit não chegou a rodar',
});
const FALTOU_PADRAO = 'a leitura não chegou a uma conclusão segura';

// Motivos em que outra rodada no mesmo commit não muda nada: vão direto ao COMMENT.
const DEFINITIVOS = new Set(['inventario_no_limite', 'texto']);

const curto = (sha) => String(sha || '').slice(0, 7);
const semEspera = (reasons) => (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
const motivoDoCard = (text) => ({ text: String(text || '').slice(0, TETO_DO_MOTIVO), kind: 'gate' });

function recuoDa(rodada) {
  return RECUOS_MS[Math.min(Math.max(rodada, 1), RECUOS_MS.length) - 1];
}

// O COMMENT neutro: o que foi revisado e o que não deu para concluir. Sem o texto do modelo.
function comentarioNeutro(motivo, head, inventario) {
  const arquivos = Number(inventario && inventario.changedFiles) || 0;
  const commit = head ? ` do commit \`${curto(head)}\`` : '';
  const nome = arquivos === 1 ? 'arquivo alterado' : 'arquivos alterados';
  const quantos = arquivos ? ` (${arquivos} ${nome})` : '';
  const faltou = O_QUE_FALTOU[motivo] || FALTOU_PADRAO;
  const body = `Li as mudanças${commit}${quantos}, mas não consegui concluir a revisão com segurança: ${faltou}.\n\n`
    + 'Por isso não aprovo nem peço mudanças neste commit.';
  return { event: 'COMMENT', body, comments: [] };
}

// A marca deste PR no mesmo head, na pendência que a rodada nova vai substituir.
function marcaAnterior(engine, key, head) {
  const d = (engine.decisions?.pending || []).find((x) => x && x.key === key && x.semMesa && x.semMesa.head === head);
  return d ? d.semMesa : null;
}

// Arma a próxima rodada extra, ou devolve null quando o limite acabou, o motivo é definitivo ou
// não há commit lido para ancorar a rodada (e então quem chama encerra com o COMMENT).
function armar(engine, pr, result, motivo) {
  const head = result && result.headSha;
  if (!head || DEFINITIVOS.has(motivo)) return null;
  const ant = marcaAnterior(engine, pr.key, head);
  const rodadas = ant ? Number(ant.rodadas) || 0 : 0;
  if (rodadas >= RODADAS_EXTRAS) return null;
  const marca = { head, motivo, rodadas, desde: Number(ant && ant.desde) || Date.now(), proximaEm: Date.now() + recuoDa(rodadas + 1) };
  const texto = `não deu para concluir com segurança (${O_QUE_FALTOU[motivo] || FALTOU_PADRAO}); reviso de novo sozinho neste commit (rodada extra ${rodadas + 1} de ${RODADAS_EXTRAS}), sem precisar de uma decisão sua`;
  return { extra: { semMesa: marca }, reasons: [{ ...motivoDoCard(texto), espera: true }, ...semEspera(result.reasons)] };
}

// A conta de sessões extras do PR naquele head, guardada no decisions.json (sobrevive à troca
// de pendência e ao reinício).
const chaveDaConta = (key, head) => `${key}@${head}`;
function sessoesExtras(engine, key, head) {
  return Number((engine.decisions?.sessoesExtras || {})[chaveDaConta(key, head)]) || 0;
}
function contarSessaoExtra(engine, key, head) {
  if (!engine.decisions.sessoesExtras || typeof engine.decisions.sessoesExtras !== 'object') engine.decisions.sessoesExtras = {};
  const k = chaveDaConta(key, head);
  engine.decisions.sessoesExtras[k] = (Number(engine.decisions.sessoesExtras[k]) || 0) + 1;
  return engine.decisions.sessoesExtras[k];
}
const noTetoConjunto = (engine, key, head) => !!head && sessoesExtras(engine, key, head) >= TETO_CONJUNTO;

// A conta de quem já saiu das pendências não serve a mais nada: some na varredura.
function podarContas(engine) {
  const conta = engine.decisions?.sessoesExtras;
  if (!conta || typeof conta !== 'object') return;
  const vivas = new Set((engine.decisions.pending || []).map((d) => d && d.key));
  for (const k of Object.keys(conta)) if (!vivas.has(k.slice(0, k.lastIndexOf('@')))) delete conta[k];
}

// O estacionamento por cancelamento ou label retirada: só uma pessoa desfaz.
function paradaDeGente(engine, key) {
  return !!engine.autoReviewParked?.has(key) && PARADAS_DE_GENTE.has(engine.parkedMotivos?.[key]?.tipo);
}

// O que precisa valer AGORA para o COMMENT neutro sair: o PR aberto (estado e head legíveis),
// sem a label de revisão de outra conta e no mesmo head que a revisão leu. Devolve null quando
// pode postar, `{ encerra, texto }` para encerrar sem postar, ou `{ andou }` com o head novo.
const FECHADOS = { MERGED: 'already_merged', CLOSED: 'already_closed' };
async function conferirAntesDoComentario(engine, pr, head) {
  const lido = await engine.prEstadoELabels(pr).catch(() => null);
  if (!lido) return { encerra: STATUS_SEM_POSTAR, texto: 'não deu para ler o estado do PR agora, então nada foi publicado' };
  if (FECHADOS[lido.estado]) return { encerra: FECHADOS[lido.estado], texto: `o PR já está ${lido.estado === 'MERGED' ? 'mesclado' : 'fechado'}, então nada foi publicado` };
  if (lido.estado !== 'OPEN') return { encerra: STATUS_SEM_POSTAR, texto: 'não deu para confirmar o estado do PR agora, então nada foi publicado' };
  const minha = String(engine.accountForPr(pr) || '').toLowerCase();
  const outra = (lido.labels || []).find((l) => l.toLowerCase().endsWith(SUFIXO_DA_LABEL) && l.slice(0, -SUFIXO_DA_LABEL.length).trim().toLowerCase() !== minha);
  if (outra) return { encerra: STATUS_SEM_POSTAR, texto: `outra conta está revisando este PR (${outra}): o PR saiu do automático, nada foi publicado` };
  let agora = '';
  try { agora = await engine.headSha(pr); } catch { agora = ''; }
  if (!agora) return { encerra: STATUS_SEM_POSTAR, texto: 'não deu para ler o commit atual do PR agora, então nada foi publicado' };
  return head && agora !== head ? { andou: agora } : null;
}

// Posta o COMMENT neutro pelo postReview. Devolve { tipo, post, payload }: 'publicado',
// 'reenvio' (falha passageira, o reenvio de sempre tenta de novo) ou 'recusado' (um portão
// recusou, ou a falha não passa com o tempo).
async function publicar(engine, pr, head, payload) {
  if (head && await comentarioJaPublicado(engine, pr, head, payload.body) === true) return { tipo: 'publicado', post: { ok: true }, payload };
  const post = await engine.postReview(pr, head ? { ...payload, commit_id: head } : payload, { via: 'sem-mesa' });
  if (post.ok) return { tipo: 'publicado', post, payload };
  const passageira = post.semToken === true || post.estado === 'nao_enviada' || classify(String(post.error || '')).kind === 'transitorio';
  return { tipo: !post.blocked && passageira ? 'reenvio' : 'recusado', post, payload };
}

const POSTAGEM_PENDENTE = (payload) => ({ postRetry: { event: 'comment', attempts: 0, statusAoPublicar: STATUS_COMENTADO }, payloads: { comment: payload } });

// O desfecho de uma revisão que acabou de rodar e não pode publicar o parecer dela: posta o
// COMMENT neutro e registra. `ctx` é o do desfecho (desfecho-da-revisao.js).
async function encerrarNaRevisao(engine, ctx, motivo) {
  const { pr, result } = ctx;
  const head = ctx.headShaAtual || result.headSha || '';
  const antes = await conferirAntesDoComentario(engine, pr, head);
  if (antes && antes.andou) {
    result.reasons = [motivoDoCard(`chegou commit novo (${curto(head)} -> ${curto(antes.andou)}): nada foi publicado, e a rodada do head novo é a que vale`), ...(result.reasons || [])];
    return engine.recordDecision(pr, result, { status: 'pending', blockedKind: 'stale_head', blockedHead: antes.andou });
  }
  if (antes) {
    result.reasons = [motivoDoCard(antes.texto), ...(result.reasons || [])];
    return engine.recordDecision(pr, result, { status: antes.encerra, action: 'skip' });
  }
  const r = await publicar(engine, pr, head, comentarioNeutro(motivo, head, result.inventarioDiff));
  const payloads = { ...(result.payloads || {}), comment: r.payload };
  if (r.tipo === 'publicado') {
    const item = engine.recordDecision(pr, { ...result, payloads }, { status: STATUS_COMENTADO, action: 'comment' });
    engine.emit('auto-commented', { pr, result: engine.decisionForUi(item) });
    engine.emit('toast', { kind: 'ok', text: `💬 ${pr.key}: não deu para concluir a revisão com segurança, então saiu um comentário neutro.` });
    return item;
  }
  if (r.tipo === 'reenvio') {
    result.reasons = [{ text: `falha ao postar o COMMENT: ${r.post.error || 'erro desconhecido'}`, kind: 'infra' }, ...(result.reasons || [])];
    return engine.recordDecision(pr, { ...result, payloads }, { status: 'pending', ...POSTAGEM_PENDENTE(r.payload) });
  }
  result.reasons = [motivoDoCard(`nada foi publicado: ${r.post.error || 'um portão de postagem recusou o comentário'}`), ...(result.reasons || [])];
  engine.log('INFO', `${pr.key}: desfecho sem mesa encerrado sem postar (${r.post.blocked || 'recusa'}).`);
  return engine.recordDecision(pr, result, { status: STATUS_SEM_POSTAR, action: 'skip' });
}

function indiceDe(engine, d) {
  return engine.decisions.pending.findIndex((x) => x.id === d.id);
}

function resolver(engine, d, extra) {
  const idx = indiceDe(engine, d);
  if (idx < 0) return null;
  engine.decisions.pending.splice(idx, 1);
  const resolvido = { ...d, semMesa: null, blockedKind: undefined, blockedHead: undefined, postRetry: null, ...extra };
  engine.resolveIntoHistory(resolvido);
  engine.saveDecisions();
  return resolvido;
}

// Encerra uma pendência gravada: o COMMENT neutro, ou nada quando o PR saiu do automático.
async function encerrarPendencia(engine, d, motivo) {
  const pr = { ...(d.pr || {}), key: d.key };
  if (d.prProprio === true) {
    return resolver(engine, d, { status: STATUS_SEM_POSTAR, action: 'skip', reasons: [motivoDoCard('o PR é da própria conta que revisa: não há o que decidir, nada foi publicado'), ...semEspera(d.reasons)] });
  }
  if (paradaDeGente(engine, d.key)) {
    return resolver(engine, d, { status: STATUS_SEM_POSTAR, action: 'skip', reasons: [motivoDoCard('a revisão foi cancelada ou a label de revisão foi retirada do PR: nada foi publicado'), ...semEspera(d.reasons)] });
  }
  if (!politicaDeInicio(engine, pr).automatic) {
    return resolver(engine, d, { status: STATUS_SEM_POSTAR, action: 'skip', reasons: [motivoDoCard('a revisão automática está desligada para este PR, então nada foi publicado'), ...semEspera(d.reasons)] });
  }
  const hist = await engine.bloqueadoPorHistorico(pr).catch(() => null);
  if (hist && hist.bloqueado) {
    const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
    return resolver(engine, d, { status: STATUS_SEM_POSTAR, action: 'skip', reasons: [motivoDoCard(`outra pessoa já decidiu este commit (${nomes}): o PR saiu do automático, nada foi publicado`), ...semEspera(d.reasons)] });
  }
  const antes = await conferirAntesDoComentario(engine, pr, d.headSha);
  if (indiceDe(engine, d) < 0) return null;
  if (antes && antes.andou) return largarPorCommitNovo(engine, d, antes.andou) && d;
  if (antes) return resolver(engine, d, { status: antes.encerra, action: 'skip', reasons: [motivoDoCard(antes.texto), ...semEspera(d.reasons)] });
  const r = await publicar(engine, pr, d.headSha, comentarioNeutro(motivo, d.headSha, d.inventarioDiff));
  if (indiceDe(engine, d) < 0) return null;
  if (r.tipo === 'publicado') {
    const resolvido = resolver(engine, d, { status: 'commented_inconclusive', action: 'comment', reasons: semEspera(d.reasons) });
    if (resolvido) engine.emit('auto-commented', { pr, result: engine.decisionForUi(resolvido) });
    return resolvido;
  }
  if (r.tipo === 'reenvio') {
    const payloads = { ...(d.payloads || {}), comment: r.payload };
    Object.assign(d, POSTAGEM_PENDENTE(r.payload), { semMesa: null, payloads });
    d.reasons = [{ text: `falha ao postar o COMMENT: ${r.post.error || 'erro desconhecido'}`, kind: 'infra' }, ...semEspera(d.reasons)];
    engine.saveDecisions();
    return d;
  }
  engine.log('INFO', `${d.key}: desfecho sem mesa encerrado sem postar (${r.post.blocked || 'recusa'}).`);
  return resolver(engine, d, { status: STATUS_SEM_POSTAR, action: 'skip', reasons: [motivoDoCard(`nada foi publicado: ${r.post.error || 'um portão de postagem recusou o comentário'}`), ...semEspera(d.reasons)] });
}

// A pendência tem quem a mova sozinho? O que não tem é adotado pela varredura.
function temCaminhoAutomatico(d) {
  return !!(d.semMesa || d.esperaProva || d.esperaCi || d.postRetry)
    || ['stale_head', 'conflito', 'technical_recheck'].includes(d.blockedKind);
}

// Entrega uma pendência ao desfecho sem mesa: `definitivo` posta o COMMENT neutro na varredura
// seguinte; sem ele, revisa de novo antes, com limite. Sem commit lido não há rodada a ancorar.
function entregar(d, motivo, { definitivo = false } = {}) {
  const rodadas = definitivo || !d.headSha ? RODADAS_EXTRAS : 0;
  d.semMesa = { head: d.headSha || '', motivo, rodadas, desde: Date.now(), proximaEm: Date.now() + UM_CICLO_MS };
  return d;
}

// A mesma entrega, pela pendência gravada: sai do reenvio e vai ao desfecho sem mesa.
function entregarPorId(engine, id, motivo, opcoes) {
  const d = engine.decisions.pending.find((x) => x.id === id);
  if (!d) return;
  d.postRetry = null;
  entregar(d, motivo, opcoes);
  engine.saveDecisions();
}

// O reenvio separa a falha passageira (rede, 5xx, limite de taxa, conta sem token), que segue no
// recuo longo, da recusa permanente (avaliação técnica, critérios, PR próprio, 422 de PR travado
// ou repositório arquivado), que sai do reenvio: no PR próprio encerra sem postar, no resto vai
// ao COMMENT neutro. Devolve true quando tirou a pendência do reenvio.
const MOTIVO_DA_RECUSA = { technical_review: 'prova_tecnica_incompleta', criterios_inconsistentes: 'criterios_inconsistentes', internal_language: 'texto' };
function recusaPermanente(engine, id, post) {
  const passageira = post.semToken === true || (!post.blocked && classify(String(post.error || '')).kind === 'transitorio');
  if (passageira) return false;
  const d = engine.decisions.pending.find((x) => x.id === id);
  if (!d) return false;
  if (post.blocked === 'pr_proprio') d.prProprio = true;
  entregarPorId(engine, id, MOTIVO_DA_RECUSA[post.blocked] || '', { definitivo: true });
  engine.log('INFO', `${d.key}: o reenvio recebeu recusa permanente (${post.blocked || 'erro do GitHub'}); a pendência foi ao desfecho sem mesa.`);
  return true;
}

// A pendência sem caminho automático (a mesa gravada antes de 17/11/2026, ou um caminho que
// ficou sem dono) entra no desfecho sem mesa: revisa de novo e, esgotado, o COMMENT neutro. A
// recusa de credencial gravada (`blockedReason`) vai direto ao COMMENT mínimo.
function adotar(engine) {
  let n = 0;
  for (const d of engine.decisions.pending) {
    if (!d || temCaminhoAutomatico(d)) continue;
    const texto = !!d.blockedReason;
    // a que já passou do teto da prova vai direto ao COMMENT neutro, sem sessão nova
    const noTeto = Number(d.tentativasDaProva) >= MAX_TENTATIVAS_POR_HEAD || noTetoConjunto(engine, d.key, d.headSha);
    entregar(d, texto ? 'texto' : '', { definitivo: texto || noTeto }).semMesa.adotada = true;
    // as que ainda revisam de novo saem escalonadas, uma por intervalo
    d.semMesa.proximaEm = Date.now() + UM_CICLO_MS + n * ESCALONAMENTO_MS;
    delete d.blockedReason;
    engine.log('INFO', `${d.key}: pendência sem caminho automático adotada pelo desfecho sem mesa.`);
    n += 1;
  }
  if (n) engine.saveDecisions();
  return n;
}

function rodadaEmCurso(engine, key) {
  return (engine.headlessQueue || []).some((p) => p.key === key)
    || [...(engine.activeReviews || new Map()).values()].some((s) => (s.keys || []).includes(key))
    || !!engine.retryAfterNet?.has(key);
}

// A leitura do PR no ciclo. null = não deu para provar nada, e quem chama espera.
async function lerPr(engine, d) {
  const pr = { ...d.pr, key: d.key };
  const conta = engine.accountForPr(pr);
  if (!pr.url || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,author'], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  return j && j.state && j.headRefOid ? { estado: String(j.state), head: String(j.headRefOid) } : null;
}

// Pede a rodada extra ao round automático: a marca stale_head no mesmo head, com a âncora do
// head liberada (o mesmo molde da busca da prova, espera-prova.js).
function relancar(engine, d, head) {
  const m = d.semMesa;
  m.rodadas = (Number(m.rodadas) || 0) + 1;
  m.relancadaEm = Date.now();
  contarSessaoExtra(engine, d.key, head);
  if (engine.autoReviewParked?.has(d.key)) {
    engine.autoReviewParked.delete(d.key);
    if (engine.parkedMotivos) delete engine.parkedMotivos[d.key];
    engine.saveAutoReviewParked?.();
  }
  d.blockedKind = 'stale_head';
  d.blockedHead = head;
  d.reasons = [{ ...motivoDoCard(`reviso de novo sozinho neste commit (rodada extra ${m.rodadas} de ${RODADAS_EXTRAS}), sem precisar de uma decisão sua`), espera: true }, ...semEspera(d.reasons)];
  liberarAncora(engine, d.key);
  engine.saveDecisions();
  engine.log('INFO', `${d.key}: desfecho sem mesa relançou a revisão no head ${curto(head)} (rodada extra ${m.rodadas}).`);
  return 1;
}

function largarPorCommitNovo(engine, d, head) {
  d.semMesa = null;
  d.blockedKind = 'stale_head';
  d.blockedHead = head;
  d.reasons = [motivoDoCard(`chegou commit novo (${curto(d.headSha)} -> ${curto(head)}): a rodada do head novo é a que vale`), ...semEspera(d.reasons)];
  engine.saveDecisions();
  return 1;
}

async function umaPendencia(engine, d) {
  const m = d.semMesa;
  if (rodadaEmCurso(engine, d.key)) return 0;
  if (m.relancadaEm) {
    if (Date.now() - m.relancadaEm < TETO_DA_RODADA_MS) return 0;
    return (await encerrarPendencia(engine, d, m.motivo || 'rodada')) ? 1 : 0;
  }
  if (Date.now() < (Number(m.proximaEm) || 0)) return 0;
  if ((Number(m.rodadas) || 0) >= RODADAS_EXTRAS || DEFINITIVOS.has(m.motivo) || !m.head || d.prProprio === true) {
    return (await encerrarPendencia(engine, d, m.motivo)) ? 1 : 0;
  }
  const lido = await lerPr(engine, d);
  // PR fechado ou mergeado é do reconcilePending, que roda antes no ciclo
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (lido.head !== m.head) return largarPorCommitNovo(engine, d, lido.head);
  // cancelamento e label retirada não se relançam; o teto conjunto vai ao COMMENT neutro
  if (paradaDeGente(engine, d.key) || noTetoConjunto(engine, d.key, lido.head) || !politicaDeInicio(engine, { ...d.pr, key: d.key }).automatic) {
    return (await encerrarPendencia(engine, d, m.motivo)) ? 1 : 0;
  }
  return relancar(engine, d, lido.head);
}

// A varredura do ciclo. Devolve quantas pendências andaram.
async function varrer(engine) {
  podarContas(engine);
  adotar(engine);
  let andaram = 0;
  for (const d of engine.decisions.pending.filter((x) => x && x.semMesa)) {
    try { andaram += await umaPendencia(engine, d); }
    catch (err) { engine.log('WARN', `desfecho sem mesa ${d.key}: ${err.message}`); }
  }
  return andaram;
}

export default { TETO_CONJUNTO, PARADAS_DE_GENTE, sessoesExtras, contarSessaoExtra, noTetoConjunto, paradaDeGente, conferirAntesDoComentario, recusaPermanente, UM_CICLO_MS, RODADAS_EXTRAS, RECUOS_MS, TETO_DA_RODADA_MS, STATUS_COMENTADO, STATUS_SEM_POSTAR, comentarioNeutro, armar, entregar, entregarPorId, encerrarNaRevisao, encerrarPendencia, temCaminhoAutomatico, adotar, varrer };
export { TETO_CONJUNTO, PARADAS_DE_GENTE, sessoesExtras, contarSessaoExtra, noTetoConjunto, paradaDeGente, conferirAntesDoComentario, recusaPermanente, UM_CICLO_MS, RODADAS_EXTRAS, RECUOS_MS, TETO_DA_RODADA_MS, STATUS_COMENTADO, STATUS_SEM_POSTAR, comentarioNeutro, armar, entregar, entregarPorId, encerrarNaRevisao, encerrarPendencia, temCaminhoAutomatico, adotar, varrer };
