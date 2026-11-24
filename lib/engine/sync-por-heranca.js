// O sync por herança (24/11/2026, desenho docs/superpowers/specs/2026-11-24-sync-por-heranca-design.md):
// no PR de sincronização entre branches contínuas, o arquivo idêntico à foto da origem, que a base
// não mexeu, já foi revisado nos PRs de origem e não é relido. Só o resto (a resolução de conflito,
// o trabalho das duas pontas) passa pela sessão.
//
// Um arquivo do diff é HERDADO quando, ao mesmo tempo:
//   1. o conteúdo no head é igual ao da foto (não aparece em `compare <foto>...<head>`);
//   2. a base no momento do merge do sync não mexeu nele desde o ancestral comum com a foto
//      (decisão 1 do dono): o idêntico à origem pode ser o "aceitei o lado da origem" que jogou
//      fora o trabalho da base;
//   3. não depende de algo que o sync mudou (decisão 2 do dono, detalhada em
//      dependencia-do-sync.js): nenhum caminho de imports chega a arquivo a ler ou que a base
//      mudou, a configuração global e o esquema do Prisma não mudaram por baixo dele, e o que
//      não dá para conferir (linguagem fora da lista fechada, import que pode ser do
//      repositório) volta à leitura;
//   4. não tem achado bloqueante aberto de rodada anterior do mesmo PR (decisão 3 do dono).
// Protegido, removido e sem blob vão sempre à leitura. A sessão nunca marca herança.
import { arquivoProtegido } from '../review-source/caminho-protegido.js';
import { lerProcedenciaDoSync } from './procedencia-do-sync.js';
import { compararComAFoto } from './regua-de-heranca.js';
import { arquivosComBloqueioAberto } from './review-rounds.js';
import { juntarHerancas } from './prova-do-repositorio.js';
import { voltamPorDependencia } from './dependencia-do-sync.js';
import { pacotesDoRepositorio } from './repositorio-do-sync.js';
import { ehBranchContinua } from './pr-de-sincronizacao.js';

// o que a regra de dependência lê pelo texto: código, dado, estilo e .mdx herdados
const TEXTO_LIDO = /\.(?:mdx|css|scss|sass|less|json|ya?ml|graphql|gql|[cm]?[jt]s|[jt]sx)$/i;

function ehCandidato(f, fora, bloqueados) {
  if (!f?.path || !f.sha || f.status === 'removed' || arquivoProtegido(f)) return false;
  return ![f.path, f.previousPath].some((p) => p && (fora.has(p) || bloqueados.has(p)));
}

// PURA. Os arquivos do diff que podem herdar: idênticos à foto, a base não mexeu, sem bloqueio
// aberto, com blob, não removidos nem protegidos. Os outros já são a ler.
function candidatosDoSync(arquivos, { diferemDaFoto, mexidosNaBase }, bloqueados) {
  const fora = new Set([...diferemDaFoto, ...mexidosNaBase]);
  return arquivos.filter((f) => ehCandidato(f, fora, bloqueados || new Set())).map((f) => f.path);
}

// PURA. Separa o diff em herdados e a ler. `contextoAlterado` é o que a base mexeu mais o que
// ficou a ler: a régua da evidência de um achado em arquivo herdado (rebaixarHeranca).
function separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados, mapa, pacotes = null }) {
  const caminhos = arquivos.map((f) => f?.path).filter(Boolean);
  const candidatos = candidatosDoSync(arquivos, { diferemDaFoto, mexidosNaBase }, bloqueados);
  const primeiros = new Set(candidatos);
  // o que mudou: o que já é a ler, o que a base mexeu e o que difere da foto, inclusive fora do diff
  // (o arquivo que a resolução do merge devolveu à versão da base some do diff, mas não é a foto), e
  // o caminho antigo de todo renomeado, que deixou de existir
  const antigos = arquivos.map((f) => f?.previousPath).filter(Boolean);
  const alvos = new Set([...caminhos.filter((p) => !primeiros.has(p)), ...antigos, ...mexidosNaBase, ...diferemDaFoto]);
  const voltam = voltamPorDependencia(candidatos, alvos, mapa, pacotes);
  const herdados = candidatos.filter((p) => !voltam.has(p));
  const herdado = new Set(herdados);
  const aLer = caminhos.filter((p) => !herdado.has(p));
  return { herdados, aLer, contextoAlterado: [...new Set([...mexidosNaBase, ...diferemDaFoto, ...aLer])] };
}


// O mapa de importação do head: o do preparo, se houver; senão construído aqui, só depois de achar
// a procedência (PR comum nunca paga o parser) e só sobre a fonte completa. Falha: null.
async function mapaDoHead(engine, prepared, buildMap) {
  if (prepared?.map?.head) return prepared.map.head;
  const source = prepared?.source;
  if (source?.status !== 'complete' || !source.reader || typeof buildMap !== 'function') return null;
  // só o lado do head: o do merge-base não é usado aqui
  try { return (await buildMap(source, { limits: engine.config?.reviewContextLimits, soHead: true }))?.head || null; }
  catch { return null; /* sem mapa, o código volta à leitura */ }
}

// O texto que o mapa já leu, quando ele o guarda.
function textosDoMapa(mapa) {
  return Object.fromEntries((mapa?.files || []).filter((x) => typeof x?.text === 'string').map((x) => [x.path, x.text]));
}

// A herança do sync juntada à que já existe (a terceira fonte de juntarHerancas), com o campo
// `sync`. Qualquer falha, ou nenhum herdado, devolve a combinada intacta: a revisão de hoje.
async function herdarDoSync(engine, pr, head, arquivos, combinada, { prepared, buildMap } = {}) {
  if (!Array.isArray(arquivos) || !arquivos.length || !head) return combinada;
  // a consulta de procedência só roda com a base contínua ou bancada, pelo nome que o preparo leu
  if (!ehBranchContinua(prepared?.source?.inventory?.baseRef ?? pr.baseRefName)) return combinada;
  try {
    const procedencia = await lerProcedenciaDoSync(engine, pr, head);
    if (!procedencia) return combinada;
    const { origem, destino, foto, baseDaResolucao, commits } = procedencia;
    const comparacao = await compararComAFoto(engine, engine.accountForPr(pr), pr.repo, { foto, head, baseDaResolucao });
    const bloqueados = comparacao && arquivosComBloqueioAberto(engine, pr);
    if (!bloqueados) return combinada;
    // sem nenhum candidato não há o que herdar, e nada mais é lido
    const candidatos = candidatosDoSync(arquivos, comparacao, bloqueados);
    if (!candidatos.length) return combinada;
    const mapa = await mapaDoHead(engine, prepared, buildMap);
    // o texto só dos candidatos, aproveitando o que o mapa já leu (sem texto, o candidato volta)
    const pacotes = await pacotesDoRepositorio(prepared?.source, candidatos.filter((p) => TEXTO_LIDO.test(p)), { textosConhecidos: textosDoMapa(mapa) });
    const { herdados, aLer, contextoAlterado } = separarHerdados({ arquivos, ...comparacao, bloqueados, mapa, pacotes });
    if (!herdados.length) return combinada;
    const ja = new Set(combinada.unchanged || []);
    const origens = Object.fromEntries(herdados.filter((p) => !ja.has(p)).map((p) => [p, { origem, foto }]));
    const juntada = juntarHerancas(combinada, { unchanged: Object.keys(origens), alcance: {}, origens }, arquivos);
    return { ...juntada, sync: { origem, destino, foto, baseDaResolucao, commits, herdados, aLer, contextoAlterado } };
  } catch {
    return combinada; // falta de dado nunca vira herança
  }
}

// PURA. Depois da revalidação da herança (o modo assist devolve à leitura o que o contexto
// impacta): os herdados do sync são só os que continuam inalterados; sem nenhum, o campo sai.
function fecharSync(heranca, arquivos) {
  if (!heranca?.sync) return heranca;
  const { sync, ...resto } = heranca;
  const inalterados = new Set(heranca.ativa && Array.isArray(heranca.unchanged) ? heranca.unchanged : []);
  const herdados = sync.herdados.filter((p) => inalterados.has(p));
  if (!herdados.length) return resto;
  const herdado = new Set(herdados);
  const aLer = (arquivos || []).map((f) => f?.path).filter((p) => p && !herdado.has(p));
  return { ...heranca, sync: { ...sync, herdados, aLer, contextoAlterado: [...new Set([...sync.contextoAlterado, ...aLer])] } };
}

export { separarHerdados, candidatosDoSync, voltamPorDependencia, herdarDoSync, fecharSync };
