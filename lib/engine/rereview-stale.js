// Detecção de head novo em PR que a conta já revisou: peça da RE-REVISÃO (calcula `staleInfo` e
// carimba o relógio de PR quieto). Morava junto da autoanálise, que saiu; o corpo não mudou.
import io, { parseJson } from '../io.js';
import { observarHead } from './head-novo.js';
import { lerSeMudou } from './leitura-por-mudanca.js';
import { historico } from './historico-decisoes.js';

// Recalcula quais PRs que EU revisei ganharam commit novo depois da minha review.
// Só pros PRs abertos do panorama que eu revisei (aprovei/pedi mudanças via Farol,
// ou o GitHub marcou como revisado por mim): poucos, então o custo é limitado.
async function refreshStaleStates(engine, agora = Date.now()) {
  const acts = engine.reviewActions();
  const targets = (engine.panorama || []).filter(pr => {
    const a = acts[pr.key];
    // o COMMENT neutro do desfecho sem mesa (17/11/2026) também abre rodada no commit novo
    return pr.reviewedByMe || (a && (a.kind === 'approve' || a.kind === 'request_changes' || a.inconclusivo === true));
  });
  // staleInfo carrega head + estado do último review meu pro gate de re-revisão
  // automática (reReviewTargets em review.js)
  const nextInfo = {};
  for (const pr of targets) {
    let info;
    try { info = await lerSeMudou(engine, 'stale', pr, () => engine.staleForReview(pr), (v) => !!(v && v.head)); }
    catch { info = { stale: false, head: '', lastState: '' }; }
    nextInfo[pr.key] = info || { stale: false, head: '', lastState: '' };
    // head visto: relógio de PR quieto e saída de cena de commit anterior (head-novo.js)
    observarHead(engine, pr.key, (nextInfo[pr.key] || {}).head || '', agora);
  }
  engine.staleInfo = nextInfo;
}

// Entrou commit novo depois da SUA última review (approve/changes) neste PR?
// Devolve { stale, head, lastState }: head é o sha atual do PR e lastState o estado
// do último review meu que valeu (APPROVED/CHANGES_REQUESTED), pro relançamento
// automático saber SE relança (só pedido de mudanças) e ancorar POR QUAL head.
// Vem da MESMA chamada gh que já decidia o stale: a re-revisão não custa IO extra.
// Best-effort: qualquer incerteza (rede, sem commit registrado na review) devolve
// stale false, pra NUNCA reintroduzir o "Re-revisar" (nem relançar) num PR estável.
const STALE_INDETERMINADO = { stale: false, head: '', lastState: '' };
async function staleForReview(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me) return STALE_INDETERMINADO;
  if (!engine.tokenFor(acc)) return STALE_INDETERMINADO; // incerteza NUNCA reativa o Re-revisar
  const env = engine.ghEnv(acc);
  const headR = await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env });
  if (!headR.ok) return STALE_INDETERMINADO;
  const head = (headR.stdout || '').trim();
  // minha última review que valeu como aprovação ou pedido de mudança: o commit
  // dela dá o stale, o estado dela dá o tipo do round aberto. DISMISSED entra desde
  // 02/10/2026: em repositório que dispensa aprovação no push, a minha aprovação vira
  // DISMISSED no commit seguinte, e sem ela aqui o Farol caía em indeterminado e nunca
  // revisava de novo, justamente no PR que tinha perdido a minha aprovação (medido em
  // cinco PRs numa semana). O commit dela continua sendo o que a revisão leu.
  const revR = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
    '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED")] | sort_by(.submitted_at) | last // {} | {state: (.state // ""), commit: (.commit_id // ""), id: (.id // 0)}`], { env });
  if (!revR.ok) return STALE_INDETERMINADO;
  let rev;
  try { rev = JSON.parse(revR.stdout || '{}'); } catch { return STALE_INDETERMINADO; }
  const revSha = String((rev && rev.commit) || '');
  if (head && !revSha) return inconclusivoNoHead(engine, pr, head);
  if (!head || !revSha) return STALE_INDETERMINADO;
  const lastState = String((rev && rev.state) || '');
  if (head === revSha && lastState === 'DISMISSED') return dispensaNoMesmoCommit(env, repo, number, rev.id, me, head);
  return { stale: head !== revSha, head, lastState };
}

// Review meu dispensado no MESMO commit (regra do dono de 23/11/2026: "se teve dismiss no
// review, logo deveria receber uma segunda análise"). Medido no mesmo dia: aprovações
// dispensadas sem commit novo ("The merge-base changed after approval.") e pedidos de
// mudança dispensados por um colega com o motivo escrito ficavam sem análise nenhuma, porque
// só commit novo abria rodada. Abre a segunda análise quando quem dispensou foi OUTRA pessoa:
// a dispensa da própria conta é a retirada automática do pedido de mudanças
// (retirada-de-pedido.js), e reabrir ali seria revisar de novo o que acabou de ser
// conferido. Sem saber quem dispensou (timeline que falha, evento ausente), não relança. Uma
// vez por commit: a âncora do relançamento (explicaReRound, review.js) segura a terceira.
const MENSAGEM_MAX = 500;
async function dispensaNoMesmoCommit(env, repo, number, reviewId, me, head) {
  const semGatilho = { stale: false, head, lastState: 'DISMISSED' };
  const id = Number(reviewId);
  if (!Number.isSafeInteger(id) || id <= 0) return semGatilho;
  const r = await io.run('gh', ['api', '--paginate', `repos/${repo}/issues/${number}/timeline?per_page=100`,
    '--jq', `.[] | select(.event == "review_dismissed" and .dismissed_review.review_id == ${id}) | {por: (.actor.login // ""), mensagem: (.dismissed_review.dismissal_message // "")}`], { env });
  if (!r.ok) return semGatilho;
  const linhas = String(r.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  const ultima = parseJson(linhas[linhas.length - 1] || 'null', null);
  const por = String((ultima && ultima.por) || '');
  if (!por || por.toLowerCase() === me) return semGatilho;
  return { stale: true, head, lastState: 'DISMISSED', dispensa: { por, mensagem: String(ultima.mensagem || '').slice(0, MENSAGEM_MAX) } };
}

// Sem review decisivo da conta, a última decisão do PR pode ser o COMMENT neutro do desfecho sem
// mesa (`commented_inconclusive`, 17/11/2026): o commit dela é o que a revisão leu, e commit novo
// abre rodada automática, como o stale_head fazia quando o resultado ficava na mesa.
function inconclusivoNoHead(engine, pr, head) {
  let d = null;
  try { d = historico(engine).ultimaDaChave(pr.key); } catch { d = null; }
  if (!d || d.status !== 'commented_inconclusive' || !d.headSha) return STALE_INDETERMINADO;
  return { stale: head !== d.headSha, head, lastState: 'INCONCLUSIVO' };
}

// O relançamento (launchReReviews, review.js) pergunta se a rodada vem da dispensa no mesmo
// commit: muda o gatilho do consumo, o aviso e a linha INFO que explica a rodada.
function dispensadoNoMesmoCommit(engine, pr) {
  return !!(((engine.staleInfo || {})[pr.key] || {}).dispensa);
}

function avisarRelancamento(engine, elegiveis) {
  const motivoDoUm = (pr) => (dispensadoNoMesmoCommit(engine, pr) ? 'teve a sua revisão dispensada' : 'recebeu commit novo depois da sua revisão');
  engine.emit('toast', {
    kind: 'info',
    text: elegiveis.length === 1
      ? `↻ ${elegiveis[0].key} ${motivoDoUm(elegiveis[0])}: revisando de novo.`
      : `↻ ${elegiveis.length} PRs receberam commit novo ou tiveram a revisão dispensada: revisando de novo.`
  });
  // explica uma decisão que alguém vai perguntar depois: uma linha por rodada, nunca por ciclo
  for (const pr of elegiveis.filter(p => dispensadoNoMesmoCommit(engine, p))) {
    engine.log('INFO', `${pr.key}: revisão dispensada por @${engine.staleInfo[pr.key].dispensa.por} no mesmo commit; segunda análise do head ${String(pr._headRound || '').slice(0, 8)}.`);
  }
}

export { refreshStaleStates, staleForReview, dispensadoNoMesmoCommit, avisarRelancamento };
export default { refreshStaleStates, staleForReview, dispensadoNoMesmoCommit, avisarRelancamento };
