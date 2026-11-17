// PR de sincronização entre branches contínuas, sem atrito (17/11/2026, regra do dono: "merge-back
// também é pra ser algo sem atrito nenhum").
//
// Sincronização é o PR que só leva para uma branch o que já existe noutra: o merge-back da
// production na development, a promoção da bancada para a homologation, a development para a
// homologation. Num PR assim não há card próprio nem trabalho novo do autor, e cobrar card ou item
// de processo só trava o fluxo. O critério é do APP, conservador e verificável numa consulta
// GraphQL só (a sessão nunca marca um PR como sincronização):
//   - origem (head) E destino (base) são branches contínuas do GitFlow da BIUD (`production`,
//     `homologation`, `development`, `main`, `master`) ou bancadas (`release_hmg_*`,
//     `release_prd_*`), e não são a mesma;
//   - o head está no próprio repositório (não é fork): os commits do PR são os da branch de origem
//     remota que o destino ainda não tem, sempre alcançáveis a partir dela;
//   - nenhum commit do PR é exclusivo dele: cada um já entrou por um PR MESCLADO, que não é este
//     (associatedPullRequests com states MERGED). Commit empurrado direto numa branch contínua não
//     tem PR mesclado e desfaz a sincronização;
//   - a lista de commits veio inteira (até 100) e com a contagem fechando.
// Falta de dado, resposta torta ou leitura que falha nunca viram sincronização.
//
// O protocolo da sessão já trata o "sync de linhagem" (workspace-template/CLAUDE.md, item 3bis, e
// prompts/pr-review-auto.md): ali a sessão confere a procedência e não cobra card. Este módulo é o
// lado do motor, e o que ele muda está em ressalvas.js: na sincronização sem defeito o resultado é
// limpo. Os gates de postagem não leem esta marca.
import io from '../io.js';

const CONTINUAS = new Set(['production', 'homologation', 'development', 'main', 'master']);
const BANCADA = /^release_(hmg|prd)_[A-Za-z0-9._-]+$/;
const TETO_DE_COMMITS = 100;
const SHA = /^[0-9a-f]{40}$/;

function ehBranchContinua(nome) {
  const n = typeof nome === 'string' ? nome : '';
  return CONTINUAS.has(n) || BANCADA.test(n);
}

const CONSULTA = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefName baseRefName isCrossRepository commits(first:100){totalCount nodes{commit{oid associatedPullRequests(first:10,states:[MERGED]){nodes{number}}}}}}}}';
const JQ = '.data.repository.pullRequest | {number, headRefName, baseRefName, isCrossRepository, total: .commits.totalCount, commits: [.commits.nodes[].commit | {oid, prs: [.associatedPullRequests.nodes[].number]}]}';

// Um commit que já entrou por outro PR mesclado.
function commitDeOutroPr(c, numero) {
  return !!c && SHA.test(String(c.oid || '')) && Array.isArray(c.prs) && c.prs.some((n) => Number.isInteger(n) && n !== numero);
}

// PURA. O que a consulta devolveu (depois do --jq) é sincronização? Devolve { origem, destino,
// commits } ou null.
function avaliarSincronizacao(dados, numero) {
  if (!dados || typeof dados !== 'object' || dados.number !== numero || dados.isCrossRepository !== false) return null;
  const { headRefName: origem, baseRefName: destino, total, commits } = dados;
  if (!ehBranchContinua(origem) || !ehBranchContinua(destino) || origem === destino) return null;
  if (!Number.isInteger(total) || total < 1 || total > TETO_DE_COMMITS || !Array.isArray(commits) || commits.length !== total) return null;
  if (!commits.every((c) => commitDeOutroPr(c, numero))) return null;
  return { origem, destino, commits: total };
}

// A leitura do GitHub. null quando não é sincronização ou quando não deu para saber.
async function lerSincronizacao(engine, pr) {
  const [owner, name] = String((pr && pr.repo) || '').split('/');
  const numero = Number(pr && pr.number);
  const conta = engine.accountForPr(pr);
  if (!owner || !name || !Number.isInteger(numero) || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['api', 'graphql', '-f', `query=${CONSULTA}`, '-F', `owner=${owner}`, '-F', `name=${name}`,
    '-F', `number=${numero}`, '--jq', JQ], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  return avaliarSincronizacao(io.parseJson(r.stdout, null), numero);
}

export default { ehBranchContinua, avaliarSincronizacao, lerSincronizacao };
export { ehBranchContinua, avaliarSincronizacao, lerSincronizacao };
