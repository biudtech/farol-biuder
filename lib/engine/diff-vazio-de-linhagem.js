// O PR de diff vazio que só alinha a história (19/11/2026, regra do dono).
//
// Um PR de sync ou merge-back do GitFlow ("sync homologation into development", o merge-back da
// production na development) pode não mudar nenhum arquivo: `changed_files` 0 no GitHub e o diff
// de três pontos vazio. Ele não é vazio: traz os merge commits das releases para a branch de
// destino ficar com a de origem como ancestral. Num PR assim não há código para o modelo ler, e
// o card do Jira (o nome da branch costuma trazer uma chave) podia levar a pedir mudanças num PR
// que não muda nada. A regra é do motor, determinística, sem sessão do Claude e sem o card:
//   - medição própria e estável no head lido: a leitura do PR (head, base, arquivos e commits),
//     a lista paginada de arquivos vazia, a lista paginada de commits com os pais de cada um e a
//     mesma leitura do PR de novo, igual à primeira. Qualquer falha, divergência ou head que não é
//     o da revisão devolve null, e a revisão segue o caminho normal;
//   - a prova independente da contagem do GitHub: a tree do head é a tree do merge-base com a base
//     (o merge-base do preparo quando ele mediu a mesma base, senão o do compare). Tree diferente,
//     leitura que falha ou merge-base ausente devolvem null;
//   - com pelo menos um merge commit (dois ou mais pais): APPROVE com texto fixo, curto;
//   - sem merge commit: é PR vazio por engano, e sai um COMMENT neutro, sem aprovar nem pedir
//     mudanças.
// Continua valendo o que é regra do motor: a origem do dono, o PR da própria conta, a decisão de
// gente no head, a label de outra conta, o PR fechado, o head que andou, o dedup por head, a
// política da conta para o parecer limpo e todos os portões de `postReview`. Os checks
// obrigatórios recebem o tratamento de sempre: o revisor não os espera, e o estado deles vai
// como aviso no card da aprovação. Com `reviewRoundsMode: "enforce"` a memória de rodadas é
// portão de postagem, e a revisão segue o caminho normal.
//
// A avaliação técnica na publicação (`lib/technical-review/publication.js`) não tem o que avaliar
// num diff vazio: ela aceita o APPROVE quando a prova gravada na memória do motor por este módulo
// (`technicalApprovals`, nunca a saída de um modelo) traz `diffVazio` com a marca de origem, sem
// relatório e no mesmo commit do payload. A prova sai da memória quando a postagem não sai e não
// vai ao reenvio: só o reenvio do mesmo APPROVE ainda precisa dela.
import io, { parseJson } from '../io.js';
import { ORIGEM_DIFF_VAZIO } from '../technical-review/publication.js';
import { origemDoDono } from './desfecho-automatico.js';
import { ehMeu } from './pr-proprio.js';
import { comentarioJaPublicado } from './comentario-proprio.js';
import semMesa from './desfecho-sem-mesa.js';
import { conferirCancelamento, iniciarPublicacao } from './cancelamento-revisao.js';
import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
import { anexarChecksObrigatorios } from './checks-exigidos.js';
import { avisoDaAprovacao } from './gate-espera.js';
import { postarComRetentativas } from './postagem-retentativa.js';
import { resultadoSemSessao, impedimentoSemSessao, falhouSemSessao, largarProva } from './aprovacao-sem-sessao.js';

const CAMINHO = 'diff_vazio_linhagem';
const SHA = /^[0-9a-f]{40}$/;
// A lista de commits de um PR no GitHub para em 250: acima disso ela só prova o merge commit que
// achar, nunca a ausência dele.
const TETO_DE_COMMITS = 250;

// o estado do inventário, fora do literal: a tela lê os literais de `status:` deste arquivo como
// status de decisão (web/src/historico/rotulos.test.ts)
const INVENTARIO_COMPLETO = 'complete';

const curto = (sha) => String(sha || '').slice(0, 7);
const motivo = (text) => ({ text, kind: 'gate' });

async function lerPr(engine, pr, env) {
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}`,
    '--jq', '{headSha: .head.sha, baseSha: .base.sha, changedFiles: .changed_files, commits: .commits}'], { env });
  const v = r.ok ? parseJson(r.stdout, null) : null;
  if (!v || !SHA.test(String(v.headSha || '')) || !SHA.test(String(v.baseSha || ''))) return null;
  if (!Number.isInteger(v.changedFiles) || v.changedFiles < 0 || !Number.isInteger(v.commits) || v.commits < 1) return null;
  return v;
}

// Cada página impressa pelo --paginate é uma linha. Devolve as páginas lidas, ou null.
function paginas(stdout) {
  const linhas = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const lidas = linhas.map((l) => parseJson(l, null));
  return lidas.every(Array.isArray) ? lidas : null;
}

async function arquivosVazios(engine, pr, env) {
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/files`, '--paginate', '--jq', '[.[] | .filename]'], { env });
  const lidas = r.ok ? paginas(r.stdout) : null;
  return !!lidas && lidas.every((p) => p.length === 0);
}

async function commitsDoPr(engine, pr, env) {
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/commits`, '--paginate',
    '--jq', '[.[] | {sha: .sha, pais: (.parents | length)}]'], { env });
  const lidas = r.ok ? paginas(r.stdout) : null;
  if (!lidas) return null;
  const commits = lidas.flat();
  if (!commits.every((c) => c && SHA.test(String(c.sha || '')) && Number.isInteger(c.pais) && c.pais >= 1)) return null;
  return commits;
}

async function lerTexto(args, env) {
  const r = await io.run('gh', args, { env });
  const v = r.ok ? String(r.stdout || '').trim() : '';
  return SHA.test(v) ? v : null;
}

// A tree do head é a do merge-base com a base? O merge-base do preparo vale quando ele mediu a
// mesma base; sem ele, o do compare.
async function mesmaTreeDoMergeBase(pr, m, inventario, env) {
  const doPreparo = inventario && inventario.baseSha === m.baseSha && SHA.test(String(inventario.mergeBaseSha || '')) ? inventario.mergeBaseSha : null;
  const mergeBase = doPreparo || await lerTexto(['api', `repos/${pr.repo}/compare/${m.baseSha}...${m.headSha}`, '--jq', '.merge_base_commit.sha'], env);
  if (!mergeBase) return false;
  const tree = (sha) => lerTexto(['api', `repos/${pr.repo}/git/commits/${sha}`, '--jq', '.tree.sha'], env);
  const doHead = await tree(m.headSha);
  const daBase = doHead ? await tree(mergeBase) : null;
  return !!doHead && doHead === daBase;
}

// PURA. A medição fecha? Devolve { headSha, baseSha, commits, mergeCommits } ou null.
function avaliarMedicao({ antes, depois, vazio, commits, head }) {
  if (!antes || !depois || !vazio || !Array.isArray(commits) || !commits.length || !head) return null;
  if (antes.headSha !== head || depois.headSha !== head) return null;
  if (['headSha', 'baseSha', 'changedFiles', 'commits'].some((k) => antes[k] !== depois[k])) return null;
  if (antes.changedFiles !== 0) return null;
  const mergeCommits = commits.filter((c) => c.pais >= 2).length;
  // a lista que não fecha com a contagem só prova o merge commit que achou
  const listaInteira = commits.length === antes.commits && commits.length < TETO_DE_COMMITS;
  if (!listaInteira && !mergeCommits) return null;
  return { headSha: head, baseSha: antes.baseSha, commits: antes.commits, mergeCommits };
}

// A medição no GitHub, pela conta do PR. null = não deu para provar o diff vazio.
async function medir(engine, pr, head, inventario = null) {
  const conta = engine.accountForPr(pr);
  if (!pr?.repo || !pr.number || !head || !engine.tokenFor(conta)) return null;
  const env = engine.ghEnv(conta);
  try {
    const antes = await lerPr(engine, pr, env);
    if (!antes || antes.changedFiles !== 0 || antes.headSha !== head) return null;
    const vazio = await arquivosVazios(engine, pr, env);
    const commits = vazio ? await commitsDoPr(engine, pr, env) : null;
    const depois = commits ? await lerPr(engine, pr, env) : null;
    const m = avaliarMedicao({ antes, depois, vazio, commits, head });
    return m && await mesmaTreeDoMergeBase(pr, m, inventario, env) ? m : null;
  } catch { return null; }
}

// O inventário da revisão aponta zero arquivos neste head? Só então a medição própria roda: o PR
// com arquivos não paga leitura nenhuma a mais.
function candidato(inventario, head) {
  return !!head && !!inventario && inventario.changedFiles === 0 && (!inventario.headSha || inventario.headSha === head);
}

function textoDaAprovacao(m) {
  const n = m.mergeCommits;
  return `Este PR não muda nenhum arquivo em relação à base (diff vazio no commit \`${curto(m.headSha)}\`); `
    + `ele só alinha a história, trazendo ${n} merge commit${n === 1 ? '' : 's'}. Aprovo.`;
}

function textoDoComentario(m) {
  return `Este PR não muda nenhum arquivo em relação à base (diff vazio no commit \`${curto(m.headSha)}\`) e não traz merge commit. `
    + 'Por isso não aprovo nem peço mudanças.';
}

const extraDoCaminho = (m) => ({ caminho: CAMINHO, linhagem: { commits: m.commits, mergeCommits: m.mergeCommits } });

// O desfecho do diff vazio para o fluxo comum da aprovação sem sessão (aprovacao-sem-sessao.js).
function desfecho(m) {
  return {
    headSha: m.headSha, baseSha: m.baseSha, extra: extraDoCaminho(m), corpo: textoDaAprovacao(m),
    inventarioDiff: { status: INVENTARIO_COMPLETO, reason: '', headSha: m.headSha, baseSha: m.baseSha, changedFiles: 0, additions: 0, deletions: 0, files: [] },
    relatorio: `Diff vazio no commit ${curto(m.headSha)}, com ${m.mergeCommits} merge commit(s) de ${m.commits} commit(s): aprovado sem sessão.`,
    prova: { diffVazio: { head: m.headSha, origem: ORIGEM_DIFF_VAZIO } },
    toast: '',
  };
}

const resultadoBase = (m, verdict, payloads, reportMarkdown) => resultadoSemSessao(desfecho(m), verdict, payloads, reportMarkdown);

// A aprovação sem sessão, uma boca só para o diff vazio e para o sync por herança sem nada a ler
// (sync-sem-sessao.js). `m` é o desfecho (aprovacao-sem-sessao.js): o texto fixo, o caminho, a
// prova da publicação e o aviso da tela.
async function aprovarSemSessao(engine, pr, m, id) {
  const payload = { event: 'APPROVE', body: m.corpo, comments: [] };
  const result = resultadoSemSessao(m, 'approve', { approve: payload }, m.relatorio);
  // os checks obrigatórios, como em toda aprovação: não seguram, viram aviso no card
  await anexarChecksObrigatorios(engine, pr, result);
  const states = await engine.myReviewStates(pr, m.headSha);
  if (decisaoAutomaticaJaPublicada(pr, states) || (Array.isArray(states) && states.includes('APPROVED'))) {
    return engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve', ...m.extra });
  }
  // a prova da publicação, gravada pelo motor e só na memória (a saída de um modelo nunca chega aqui)
  if (!(engine.technicalApprovals instanceof Map)) engine.technicalApprovals = new Map();
  engine.technicalApprovals.set(pr.key, { report: null, evidence: [], criteriaEvidence: null, provaEsgotada: false, evidenceVersion: 2, ...m.prova });
  iniciarPublicacao(engine, id);
  const post = await postarComRetentativas(() => engine.postReview(pr, { ...payload, commit_id: m.headSha }, { via: 'revisao' }));
  if (post.alreadyReviewed) largarProva(engine, pr);
  if (post.alreadyReviewed) return engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve', ...m.extra });
  if (!post.ok) return falhouSemSessao(engine, pr, result, m, 'approve', post);
  const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: avisoDaAprovacao(result), ...m.extra });
  const publico = engine.decisionForUi(item);
  engine.emit('auto-approved', { pr, result: publico, points: publico.attention || [] });
  engine.emit('toast', { kind: 'ok', text: m.toast });
  return item;
}

function aprovar(engine, pr, m, id) {
  const toast = `✅ ${pr.key} aprovado: não muda nenhum arquivo e só alinha a história.`;
  return aprovarSemSessao(engine, pr, { ...desfecho(m), toast }, id);
}

async function comentar(engine, pr, m, id) {
  const payload = { event: 'COMMENT', body: textoDoComentario(m), comments: [] };
  const result = resultadoBase(m, 'comment', { comment: payload }, `Diff vazio no commit ${curto(m.headSha)}, sem merge commit em ${m.commits} commit(s): comentário neutro, sem sessão.`);
  const jaSaiu = async () => await comentarioJaPublicado(engine, pr, m.headSha, payload.body) === true;
  iniciarPublicacao(engine, id);
  const post = await engine.postReview(pr, { ...payload, commit_id: m.headSha }, { via: 'sem-mesa', jaSaiu });
  if (!post.ok) return falhouSemSessao(engine, pr, result, desfecho(m), 'comment', post);
  const item = engine.recordDecision(pr, result, { status: semMesa.STATUS_COMENTADO, action: 'comment', ...extraDoCaminho(m) });
  engine.emit('auto-commented', { pr, result: engine.decisionForUi(item) });
  engine.emit('toast', { kind: 'info', text: `💬 ${pr.key}: o PR não muda nenhum arquivo e não traz merge commit; saiu um comentário neutro.` });
  return item;
}

// A regra na revisão. Devolve true quando decidiu (a sessão do modelo não abre), false quando a
// revisão segue o caminho normal.
async function decidirSemSessao(engine, { pr, id, headShaAtual, inventario }) {
  if (!candidato(inventario, headShaAtual)) return false;
  if (engine.config?.reviewRoundsMode === 'enforce' || !origemDoDono(pr)) return false;
  // a política da conta para o parecer limpo é o destino desta regra; hoje ela só aprova
  if (engine.approvePolicyFor(engine.accountForPr(pr), true) !== 'approve') return false;
  const m = await medir(engine, pr, headShaAtual, inventario);
  if (!m) return false;
  conferirCancelamento(engine, id);
  if (ehMeu(engine, pr)) {
    const result = resultadoBase(m, 'approve', {}, '');
    result.reasons = [motivo('o PR é da própria conta que revisa: não há o que decidir, nada foi publicado')];
    engine.recordDecision(pr, result, { status: semMesa.STATUS_SEM_POSTAR, action: 'skip', ...extraDoCaminho(m) });
    return true;
  }
  if (await impedimentoSemSessao(engine, pr, desfecho(m))) return true;
  const item = m.mergeCommits ? await aprovar(engine, pr, m, id) : await comentar(engine, pr, m, id);
  engine.log('INFO', `${pr.key}: diff vazio no head ${curto(m.headSha)}, ${m.mergeCommits} merge commit(s); desfecho ${item.status} sem sessão (caminho ${CAMINHO}).`);
  return true;
}

export default { CAMINHO, avaliarMedicao, medir, candidato, decidirSemSessao, textoDaAprovacao, textoDoComentario, aprovarSemSessao };
export { CAMINHO, avaliarMedicao, medir, candidato, decidirSemSessao, textoDaAprovacao, textoDoComentario, aprovarSemSessao };
