// A procedência do sync por herança (24/11/2026, desenho docs/superpowers/specs/
// 2026-11-24-sync-por-heranca-design.md): de que branch contínua o PR de sincronização traz o que
// já foi revisado, e qual é a foto (o commit dessa branch) contra a qual o diff é comparado.
//
// Dois casos, os dois com a base contínua ou bancada e o PR fora de fork:
//   - head contínuo (o critério de pr-de-sincronizacao.js): a origem é o head, a foto é a ponta
//     dele e a régua da base é a base do PR;
//   - head de trabalho (`sync/*` ou qualquer nome): a foto é o segundo pai do merge commit mais
//     recente do PR, cujo primeiro pai está na linhagem da base, e a origem é a branch contínua ou
//     bancada que contém a foto. A régua da base é o primeiro pai (a base no momento do merge,
//     decisão 1 do dono): é contra ela que quem fez o sync resolveu os conflitos. A foto só vale
//     como estado revisado da origem: a ponta atual dela, ou o merge commit de um PR mesclado nela
//     (decisão do dono de 24/11/2026, depois da revisão final); commit no meio da história da origem
//     não é foto, e a revisão é a de hoje.
// Os outros commits seguem a regra de hoje: cada um já entrou por um PR mesclado, que não é este,
// numa branch contínua ou bancada. Leitura que falha, resposta torta, mais de 100 commits: null, e
// a revisão é a de hoje. A medição não loga (falta de dado volta à revisão de hoje em silêncio).
import io from '../io.js';
import { SHA } from '../review-source/contract.js';
import { ehBranchContinua, commitDeOutroPr, ORDEM_DAS_CONTINUAS, TETO_DE_COMMITS } from './pr-de-sincronizacao.js';
import { ler, comparar, ehAncestral, NAO_EXISTE } from './regua-de-heranca.js';

// quantas branches a busca da origem confere, no máximo (uma leitura de ref e uma comparação cada)
const TETO_DE_CANDIDATAS = 8;

const CONSULTA = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefName baseRefName headRefOid baseRefOid isCrossRepository commits(first:100){totalCount nodes{commit{oid messageHeadline parents(first:3){nodes{oid}} associatedPullRequests(first:10,states:[MERGED]){nodes{number baseRefName}}}}}}}}';
const JQ = '.data.repository.pullRequest | {number, headRefName, baseRefName, headRefOid, baseRefOid, isCrossRepository, total: .commits.totalCount, commits: [.commits.nodes[].commit | {oid, mensagem: .messageHeadline, pais: [.parents.nodes[].oid], prs: [.associatedPullRequests.nodes[] | {number, base: .baseRefName}]}]}';

const shaValido = (s) => SHA.test(String(s || ''));
const ehMerge = (c) => Array.isArray(c?.pais) && c.pais.length === 2 && c.pais.every(shaValido);

// PURA. As branches contínuas ou bancadas que a mensagem do merge cita, na ordem em que aparecem.
function branchesCitadas(mensagem) {
  const citadas = [];
  for (const pedaco of String(mensagem || '').split(/[\s'"`]+/)) {
    const nome = [pedaco, pedaco.replace(/^origin\//, ''), pedaco.split('/').pop()].find(ehBranchContinua);
    if (nome && !citadas.includes(nome)) citadas.push(nome);
  }
  return citadas;
}

// PURA. Onde procurar a origem: as citadas, a ordem fixa das contínuas e as bancadas em ordem
// alfabética, sem repetição, sem o destino e com teto.
function ordemDasCandidatas(citadas, destino, bancadas) {
  const ordem = [...citadas, ...ORDEM_DAS_CONTINUAS, ...[...bancadas].sort()];
  return [...new Set(ordem)].filter((n) => n !== destino && ehBranchContinua(n)).slice(0, TETO_DE_CANDIDATAS);
}

function formaValida(dados, numero, head) {
  if (!dados || typeof dados !== 'object' || dados.number !== numero || dados.isCrossRepository !== false) return false;
  if (dados.headRefOid !== head || !shaValido(head) || !shaValido(dados.baseRefOid) || !ehBranchContinua(dados.baseRefName)) return false;
  const { total, commits } = dados;
  return Number.isInteger(total) && total >= 1 && total <= TETO_DE_COMMITS && Array.isArray(commits)
    && commits.length === total && commits.every((c) => shaValido(c?.oid));
}

// PURA. O que a consulta devolveu (depois do --jq) é sync com procedência? O caso do merge ainda
// precisa das leituras de lerProcedenciaDoSync (a linhagem do primeiro pai e a origem da foto).
function avaliarProcedencia(dados, numero, head) {
  if (!formaValida(dados, numero, head)) return null;
  const { headRefName, baseRefName: destino, baseRefOid, total, commits } = dados;
  if (ehBranchContinua(headRefName) && headRefName !== destino) {
    if (!commits.every((c) => commitDeOutroPr(c, numero))) return null;
    return { tipo: 'continuo', origem: headRefName, destino, foto: head, baseDaResolucao: baseRefOid, commits: total };
  }
  const indice = commits.findLastIndex(ehMerge);
  if (indice < 0) return null;
  if (!commits.every((c, i) => i === indice || commitDeOutroPr(c, numero))) return null;
  const merge = commits[indice];
  const [primeiroPai, foto] = merge.pais;
  return { tipo: 'merge', destino, baseOid: baseRefOid, commits: total,
    merge: { oid: merge.oid, primeiroPai, foto, citadas: branchesCitadas(merge.mensagem) } };
}

// A ponta da branch, null quando ela não existe (404) e undefined quando a leitura falhou.
async function pontaDe(engine, conta, repo, nome) {
  const r = await ler(engine, conta, [`repos/${repo}/git/ref/heads/${nome}`, '--jq', '{sha: .object.sha}']);
  if (r === NAO_EXISTE) return null;
  return shaValido(r?.sha) ? r.sha : undefined;
}

// Os PRs mesclados associados ao commit da foto, com a base e o merge commit de cada um. null:
// leitura que falhou ou veio torta.
const CONSULTA_DA_FOTO = 'query($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{associatedPullRequests(first:10,states:[MERGED]){nodes{number baseRefName mergeCommit{oid}}}}}}}';
const JQ_DA_FOTO = '[.data.repository.object.associatedPullRequests.nodes[] | {number, base: .baseRefName, mergeCommit: .mergeCommit.oid}]';
const prValido = (p) => !!p && Number.isInteger(p.number) && typeof p.base === 'string' && (p.mergeCommit == null || typeof p.mergeCommit === 'string');

async function prsDaFoto(engine, conta, repo, foto) {
  const [owner, name] = repo.split('/');
  const r = await io.run('gh', ['api', 'graphql', '-f', `query=${CONSULTA_DA_FOTO}`, '-F', `owner=${owner}`, '-F', `name=${name}`,
    '-F', `oid=${foto}`, '--jq', JQ_DA_FOTO], { env: engine.ghEnv(conta) });
  const prs = r.ok ? io.parseJson(r.stdout, null) : null;
  return Array.isArray(prs) && prs.every(prValido) ? prs : null;
}

// A foto é um estado revisado da origem (decisão do dono de 24/11/2026): a ponta atual dela, ou o
// merge commit de um PR mesclado nela. Commit no meio da história da origem não é foto. Os PRs da
// foto são lidos uma vez só (`memo`). true, false, ou undefined quando a leitura falhou.
async function fotoRevisada(engine, conta, repo, { foto, nome, ponta, memo }) {
  if (ponta === foto) return true;
  if (!('prs' in memo)) memo.prs = await prsDaFoto(engine, conta, repo, foto);
  if (!memo.prs) return undefined;
  return memo.prs.some((p) => p.base === nome && p.mergeCommit === foto);
}

// A primeira candidata cuja ponta contém a foto e de que a foto é um estado revisado. null:
// nenhuma; undefined: leitura que falhou.
async function primeiraQueContem(engine, conta, repo, foto, candidatas, memo = {}) {
  for (const nome of candidatas) {
    const ponta = await pontaDe(engine, conta, repo, nome);
    if (ponta === undefined) return undefined;
    if (ponta === null) continue;
    const comparacao = await comparar(engine, conta, repo, foto, ponta);
    if (!comparacao) return undefined;
    if (!ehAncestral(comparacao, foto)) continue;
    const revisada = await fotoRevisada(engine, conta, repo, { foto, nome, ponta, memo });
    if (revisada !== false) return revisada ? nome : undefined;
  }
  return null;
}

async function bancadasDe(engine, conta, repo) {
  const r = await ler(engine, conta, [`repos/${repo}/git/matching-refs/heads/release_`, '--jq', '[.[].ref | sub("^refs/heads/"; "")]']);
  return Array.isArray(r) && r.every((n) => typeof n === 'string') ? r : null;
}

async function origemDaFoto(engine, conta, repo, avaliado) {
  const { citadas, foto } = avaliado.merge;
  const primeiras = ordemDasCandidatas(citadas, avaliado.destino, []);
  const memo = {};
  const achada = await primeiraQueContem(engine, conta, repo, foto, primeiras, memo);
  if (achada !== null) return achada || null;
  const bancadas = await bancadasDe(engine, conta, repo);
  if (!bancadas) return null;
  const resto = ordemDasCandidatas(citadas, avaliado.destino, bancadas).filter((n) => !primeiras.includes(n));
  return (await primeiraQueContem(engine, conta, repo, foto, resto, memo)) || null;
}

async function procedenciaDoMerge(engine, conta, repo, avaliado) {
  const { primeiroPai, foto } = avaliado.merge;
  if (!ehAncestral(await comparar(engine, conta, repo, primeiroPai, avaliado.baseOid), primeiroPai)) return null;
  const origem = await origemDaFoto(engine, conta, repo, avaliado);
  if (!origem) return null;
  return { origem, destino: avaliado.destino, foto, baseDaResolucao: primeiroPai, commits: avaliado.commits, viaMerge: true };
}

// A leitura do GitHub. null quando não é sync com procedência ou quando não deu para saber.
async function lerProcedenciaDoSync(engine, pr, head) {
  try {
    const [owner, name] = String(pr?.repo || '').split('/');
    const numero = Number(pr?.number);
    const conta = engine.accountForPr(pr);
    if (!owner || !name || !Number.isInteger(numero) || !shaValido(head) || !engine.tokenFor(conta)) return null;
    const r = await io.run('gh', ['api', 'graphql', '-f', `query=${CONSULTA}`, '-F', `owner=${owner}`, '-F', `name=${name}`,
      '-F', `number=${numero}`, '--jq', JQ], { env: engine.ghEnv(conta) });
    if (!r.ok) return null;
    const avaliado = avaliarProcedencia(io.parseJson(r.stdout, null), numero, head);
    if (!avaliado) return null;
    if (avaliado.tipo === 'continuo') {
      const { origem, destino, foto, baseDaResolucao, commits } = avaliado;
      return { origem, destino, foto, baseDaResolucao, commits, viaMerge: false };
    }
    return await procedenciaDoMerge(engine, conta, pr.repo, avaliado);
  } catch {
    return null; // qualquer exceção é falta de dado, e falta de dado nunca vira herança
  }
}

export { TETO_DE_CANDIDATAS, avaliarProcedencia, branchesCitadas, ordemDasCandidatas, lerProcedenciaDoSync };
