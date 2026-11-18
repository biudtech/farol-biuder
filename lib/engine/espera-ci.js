// A liberação das esperas do CI gravadas antes de 17/11/2026.
//
// De 30/09 a 17/11/2026 a aprovação podia esperar o CI obrigatório ("CI obrigatório antes da
// aprovação", `aguardarCiParaAprovar`): o resultado aprovável ficava como pendência com a marca
// `esperaCi` e saía sozinho quando o CI fechava verde no mesmo head. A regra do dono de 17/11/2026
// tirou a espera: o revisor nunca espera o CI, nem para começar nem para aprovar. Nenhuma espera
// nova é armada, e este módulo só termina as que ficaram gravadas no decisions.json:
//   - a aprovação que esperava sai pelo caminho de sempre (consciência, dedup por head,
//     postReview), com o CI não verde como nota no card; o head continua conferido, e nunca
//     posta em commit que a sessão não leu;
//   - head diferente: larga a espera e marca a pendência como commit novo, que devolve o PR ao
//     round automático;
//   - o pedido de mudanças que esperava o CI não sai, porque o CI não decide: vai ao desfecho
//     sem mesa, que posta o COMMENT neutro (desfecho-sem-mesa.js).
// A leitura única do PR (`lerCi`) continua servindo à retirada do pedido (retirada-de-pedido.js).
import io from '../io.js';
import { classify } from '../log-taxonomy.js';
import { checksExigidosDoRepo, checksExigidosVerdes, semHerdados } from './checks-exigidos.js';
import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
import { BLOQUEIO_CREDENCIAL } from './credencial-no-texto.js';
import { reconstruirPayload } from './desfecho-automatico.js';
import { avisoDaAprovacao, avisoDoCi } from './gate-espera.js';
import { varrerRetiradas } from './retirada-de-pedido.js';
import { entregar } from './desfecho-sem-mesa.js';

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

// A leitura única do ciclo. null = não deu pra provar nada, e quem chama espera.
async function lerCi(engine, item) {
  const pr = { ...item.pr, key: item.key };
  const conta = engine.accountForPr(pr);
  if (!pr.url || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,baseRefName,statusCheckRollup'], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  if (!j || !j.state || !j.headRefOid) return null;
  const lido = { estado: String(j.state), head: String(j.headRefOid), faltando: null };
  if (!Array.isArray(j.statusCheckRollup)) return lido;
  const exigidos = await checksExigidosDoRepo(engine, pr.repo || String(item.key).split('#')[0], j.baseRefName);
  if (!Array.isArray(exigidos)) return lido;
  // o herdado da base não segura a espera (checks-exigidos.js); a leitura da base que falha, sim.
  // Esta leitura decide o APPROVE e a retirada do pedido: a base é lida fresca, nunca do cache
  const repo = pr.repo || String(item.key).split('#')[0];
  const naoVerdes = checksExigidosVerdes(j.statusCheckRollup, exigidos).faltando;
  lido.faltando = (await semHerdados(engine, conta, repo, j.baseRefName, naoVerdes, { fresco: true })).faltando;
  return lido;
}

function indiceDe(engine, item) {
  return engine.decisions.pending.findIndex((d) => d.id === item.id);
}

// Larga a espera e deixa a pendência com o motivo dito. O commit novo vira round automático; o
// resto (a falha permanente ao postar, o pedido só pelo CI e a pendência gravada sem o commit
// lido ou sem o APPROVE) vai ao desfecho sem mesa (17/11/2026), nunca a uma pessoa.
function largar(engine, item, motivo, extra) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return null;
  const d = engine.decisions.pending[idx];
  d.esperaCi = null;
  d.reasons = [motivo, ...semMotivoDaEspera(d.reasons)];
  Object.assign(d, extra || {});
  engine.saveDecisions();
  return d;
}

// A pendência largada vai ao desfecho sem mesa (desfecho-sem-mesa.js): `definitivo` posta o
// COMMENT neutro na varredura seguinte; sem ele, revisa de novo antes, com limite.
function paraODesfechoSemMesa(engine, d, motivo, opcoes) {
  if (!d) return;
  entregar(d, motivo, opcoes);
  engine.saveDecisions();
}

const curto = (sha) => String(sha || '').slice(0, 7) || '?';

function largarPorCommitNovo(engine, item, head) {
  const motivo = { text: `o autor empurrou commit novo enquanto a aprovação esperava o CI (${curto(item.headSha)} -> ${curto(head)}), então não posto: este texto fala do código anterior`, kind: 'gate' };
  const d = largar(engine, item, motivo, { blockedKind: 'stale_head', blockedHead: head });
  if (!d) return;
  engine.log('INFO', `${item.key}: head andou de ${curto(item.headSha)} pra ${curto(head)} na espera do CI; larguei a espera, a pendência ficou marcada stale_head.`);
  engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo enquanto eu esperava o CI, então nada foi postado; o card mostra quando reviso de novo.` });
}

function resolver(engine, item, extra) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return null;
  engine.decisions.pending.splice(idx, 1);
  const resolvido = { ...item, esperaCi: null, reasons: semMotivoDaEspera(item.reasons), ...extra };
  engine.resolveIntoHistory(resolvido);
  engine.saveDecisions();
  return resolvido;
}

async function encerrarJaDecidido(engine, item, action) {
  return !!resolver(engine, item, { status: 'already_reviewed', action });
}

function falhaAoPostar(engine, item, post, atencaoAoPublicar) {
  // estado desconhecido no GitHub ou PR fechado: nada a concluir, o próximo ciclo decide. A
  // recusa por credencial não passa com o tempo: esperar o próximo ciclo prenderia o card.
  if (post.estado && post.estado !== 'recusada' && post.blocked !== BLOQUEIO_CREDENCIAL) return;
  // falha passageira passa a ser assunto do reenvio de sempre (retryFailedPosts); falha
  // permanente (texto barrado, credencial) vai ao desfecho sem mesa, e o card diz qual foi
  const transitoria = classify(String(post.error || '')).kind === 'transitorio' || post.semToken === true;
  // o texto reconstruído depois da trava de linguagem substitui o barrado: o reenvio manda ele
  const usado = post.payloadUsado ? { payloads: { ...item.payloads, approve: { ...post.payloadUsado, commit_id: undefined } } } : {};
  const d = largar(engine, item, { text: `falha ao postar o APPROVE: ${post.error || 'erro desconhecido'}`, kind: 'infra' },
    { postRetry: transitoria ? { event: 'approve', attempts: 0, atencaoAoPublicar } : null, ...usado });
  if (!transitoria) paraODesfechoSemMesa(engine, d, BLOQUEIOS_DE_TEXTO.has(post.blocked) ? 'texto' : 'nao_aprovavel', { definitivo: BLOQUEIOS_DE_TEXTO.has(post.blocked) });
}
const BLOQUEIOS_DE_TEXTO = new Set([BLOQUEIO_CREDENCIAL, 'internal_language']);

// Duas aprovações de gente neste commit chegaram durante a espera: a aprovação automática não
// é necessária. Resolve sem postar e sem mesa (18/10/2026). Os nomes vêm do
// bloqueadoPorHistorico, que já tirou ferramenta (acrity) e a própria conta.
async function dispensar(engine, item, hist) {
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  const motivo = { text: `outra pessoa já decidiu este commit (${nomes}) enquanto eu esperava o CI: a aprovação automática não é necessária, nada foi postado`, kind: 'gate' };
  const resolvido = resolver(engine, item, { status: 'approval_not_needed', action: 'skip', reasons: [motivo, ...semMotivoDaEspera(item.reasons)] });
  if (!resolvido) return 0;
  engine.emit('toast', { kind: 'info', text: `${item.key}: outra pessoa já decidiu este commit (${nomes}); a aprovação automática não é necessária.` });
  return 1;
}

// O gate de consciência, na hora em que o post acontece de verdade: 'posta', 'dispensada' ou
// 'espera' (head não confirmado: o próximo ciclo decide com a leitura única de sempre).
async function consciencia(engine, item, pr) {
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist || hist.head !== item.headSha) return 'espera';
  if (!hist.decidido) return 'posta';
  engine.log('INFO', `${item.key}: espera do CI resolvida sem postar, decisão de gente no head ${curto(item.headSha)} (${(hist.quem || []).join(', ')})`);
  return (await dispensar(engine, item, hist)) ? 'dispensada' : 'espera';
}

// A trava de linguagem barrou o texto: reconstrói UMA vez (desfecho-automatico.js). Sem
// reconstrução possível, a falha é permanente e vai para o card como infra (falhaAoPostar).
async function postarReconstruindo(engine, pr, payload, item) {
  const post = await engine.postReview(pr, payload, { via: 'espera-ci', continuidade: item });
  if (post.ok || post.blocked !== 'internal_language') return post;
  const novo = reconstruirPayload(payload, engine.accountForPr(pr));
  if (!novo) return post;
  // o texto que de fato foi tentado viaja junto: é ele que o reenvio precisa mandar (achado 7)
  return { ...(await engine.postReview(pr, novo, { via: 'espera-ci', continuidade: item })), payloadUsado: novo };
}

function textoDaAprovacao(key, ressalvas) {
  const com = ressalvas ? `, com ${ressalvas} ressalva(s)` : '';
  return `✅ ${key}: a espera do CI saiu, então a aprovação que esperava saiu sozinha${com}.`;
}

// A aprovação que esperava, com a política mandando aprovar: posta pelo caminho de sempre.
// `ciNaoVerde` é a lista de checks obrigatórios que ainda não fecharam verdes (ou null, se não
// deu pra ler), e vira nota no card.
async function postar(engine, item, ciNaoVerde) {
  const pr = { ...item.pr, key: item.key };
  const vez = await consciencia(engine, item, pr);
  if (vez !== 'posta') return vez === 'dispensada' ? 1 : 0;
  // dedup por head, e aqui null NÃO libera: a espera pode ter durado horas e você pode ter
  // aprovado por fora nesse meio tempo; sem conseguir conferir, tenta no próximo ciclo
  const states = await engine.myReviewStates(pr, item.headSha);
  if (states === null) return 0;
  if (decisaoAutomaticaJaPublicada(pr, states) || states.includes('APPROVED')) {
    if (!await encerrarJaDecidido(engine, item, 'approve')) return 0;
    engine.emit('toast', { kind: 'info', text: `${item.key}: você já tinha decidido sobre este commit no GitHub; não postei de novo.` });
    return 1;
  }
  const pontos = [...(item.esperaCi.pontos || []), ...avisoDaLiberacao(item, ciNaoVerde)];
  const post = await postarReconstruindo(engine, pr, { ...item.payloads.approve, commit_id: item.headSha }, item);
  // o reenvio publica com os mesmos pontos que este card teria (retryFailedPosts, decision.js)
  if (!post.ok) { falhaAoPostar(engine, item, post, pontos); return 0; }
  if (post.alreadyReviewed) return await encerrarJaDecidido(engine, item, 'approve') ? 1 : 0;
  const resolvido = resolver(engine, item, { status: 'auto_approved', action: 'approve', attention: pontos });
  if (!resolvido) return 0;
  engine.writeMemory(resolvido, 'APPROVE');
  const publico = engine.decisionForUi(resolvido);
  engine.emit('auto-approved', { pr: { ...item.pr, key: item.key }, result: publico, points: publico.attention || [] });
  engine.emit('toast', {
    kind: 'ok', text: textoDaAprovacao(item.key, pontos.length),
  });
  return 1;
}

async function umaEspera(engine, item) {
  const pedeMudancas = item.verdict === 'request_changes';
  if ((!pedeMudancas && (!item.payloads || !item.payloads.approve)) || !item.headSha) {
    // sem o APPROVE gravado ou sem o head que a sessão leu não há como provar de que código
    // o texto fala: não posta às cegas (pendência corrompida ou de leitura de head que falhou)
    paraODesfechoSemMesa(engine, largar(engine, item, { text: 'a revisão ficou sem o commit lido ou sem o texto da aprovação gravados, então a aprovação não sai sozinha depois do CI', kind: 'gate' }), 'nao_aprovavel');
    return 0;
  }
  const lido = await lerCi(engine, item);
  // PR fechado ou mergeado é do reconcilePending, que roda antes e resolve a pendência
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (lido.head !== item.headSha) { largarPorCommitNovo(engine, item, lido.head); return 0; }
  // "A revisão ainda está pedida a mim?" NÃO é conferido aqui, de propósito: o GitHub tira a
  // conta de reviewRequests assim que ela posta um review, e no round 2 a lista vem sem mim.
  return liberarSemCi(engine, item, lido.faltando, pedeMudancas);
}

// O aviso do card de uma aprovação liberada. Com a releitura deste ciclo
// em mãos, o texto diz que a aprovação saiu com o CI fora do verde (avisoDaAprovacao); com a
// releitura falhando (null), o dado é o de quando a espera armou, então o texto fica neutro.
// Não passa `semCheckObrigatorio` de propósito: a espera só armava quando havia check obrigatório
// fora do verde, então o repositório sem exigência nunca chega aqui.
function avisoDaLiberacao(item, ciNaoVerde) {
  if (ciNaoVerde) return avisoDaAprovacao({ checksObrigatorios: ciNaoVerde });
  return avisoDoCi({ checksObrigatorios: item.esperaCi.checks });
}

// A espera gravada antes de 17/11/2026. A aprovação sai pelo caminho de sempre (consciência,
// dedup por head, postReview), com o CI não verde como nota; o pedido de mudanças só pelo CI
// não sai, porque o CI não decide. Nada aqui volta a armar a espera: sem laço.
const CI_FORA_DA_DECISAO = 'a espera do CI saiu (o revisor nunca espera o CI), e a revisão pediu mudanças só pelo estado do CI: nada foi publicado';
function liberarSemCi(engine, item, faltando, pedeMudancas) {
  if (pedeMudancas) {
    paraODesfechoSemMesa(engine, largar(engine, item, { text: CI_FORA_DA_DECISAO, kind: 'gate' }), 'bloqueio_de_estado', { definitivo: true });
    return 0;
  }
  return postar(engine, item, faltando);
}

// A varredura do ciclo. Devolve quantas esperas se resolveram.
async function aprovarQuandoOCiFechar(engine) {
  await varrerRetiradas(engine, lerCi);
  const esperando = engine.decisions.pending.filter((d) => d && d.esperaCi);
  let resolvidas = 0;
  for (const item of esperando) {
    try { resolvidas += await umaEspera(engine, item); }
    catch (err) { engine.log('WARN', `espera do CI ${item.key}: ${err.message}`); }
  }
  return resolvidas;
}

export default { aprovarQuandoOCiFechar, lerCi };
export { aprovarQuandoOCiFechar, lerCi };
