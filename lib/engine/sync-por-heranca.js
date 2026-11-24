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
//   3. não depende de algo que o sync mudou (decisão 2 do dono): não importa arquivo a ler nem
//      arquivo que a base mudou, até o ponto fixo; código cuja dependência não deu para conferir
//      volta à leitura;
//   4. não tem achado bloqueante aberto de rodada anterior do mesmo PR (decisão 3 do dono).
// Protegido, removido e sem blob vão sempre à leitura. A sessão nunca marca herança.
import { arquivoProtegido } from '../review-source/caminho-protegido.js';
import { lerProcedenciaDoSync } from './procedencia-do-sync.js';
import { compararComAFoto } from './regua-de-heranca.js';
import { arquivosComBloqueioAberto } from './review-rounds.js';
import { juntarHerancas } from './prova-do-repositorio.js';

// o que o mapa de review-context lê, e o código que ele não lê (sem grafo de import)
const CODIGO_DO_MAPA = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const CODIGO_SEM_MAPA = /\.(?:py|go|java|kt|rb|php|cs|rs|vue|svelte)$/i;
// import relativo (ou sem especificador) que ficou sem destino aponta arquivo do repositório, e o
// alias do repositório também: o que casou um alias sem achar destino (`alias`, do mapa) e, com os
// aliases não interpretados pelo mapa, qualquer import não relativo sem destino
const relativo = (s) => s == null || /^[./]/.test(s);
const aliasParcial = (mapa) => (mapa.limitations || []).some((l) => /aliases/i.test(String(l)));
const doRepositorio = (mapa, u) => relativo(u.specifier) || u.alias === true || aliasParcial(mapa);

function conferivel(mapa, p) {
  return !!mapa && mapa.files.some((x) => x.path === p && x.backend !== 'textual' && !x.limitations?.length);
}

function importaAlterado(mapa, p, alvos, voltam) {
  return mapa.relations.some((r) => r.from === p && (alvos.has(r.to) || voltam.has(r.to)))
    || mapa.unresolved.some((u) => u.from === p && doRepositorio(mapa, u));
}

function volta(mapa, p, alvos, voltam) {
  if (CODIGO_SEM_MAPA.test(p)) return true;
  if (!CODIGO_DO_MAPA.test(p)) return false;
  return !conferivel(mapa, p) || importaAlterado(mapa, p, alvos, voltam);
}

// PURA. Os candidatos que voltam à leitura por dependência. Ponto fixo: o que volta vira alvo, e
// quem importa o que voltou volta também.
function voltamPorDependencia(candidatos, alvos, mapa) {
  const voltam = new Set();
  let mudou = true;
  while (mudou) {
    const novos = candidatos.filter((p) => !voltam.has(p) && volta(mapa, p, alvos, voltam));
    novos.forEach((p) => voltam.add(p));
    mudou = novos.length > 0;
  }
  return voltam;
}

function ehCandidato(f, fora, bloqueados) {
  if (!f?.path || !f.sha || f.status === 'removed' || arquivoProtegido(f)) return false;
  return ![f.path, f.previousPath].some((p) => p && (fora.has(p) || bloqueados.has(p)));
}

// PURA. Separa o diff em herdados e a ler. `contextoAlterado` é o que a base mexeu mais o que
// ficou a ler: a régua da evidência de um achado em arquivo herdado (rebaixarHeranca).
function separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados, mapa }) {
  const fora = new Set([...diferemDaFoto, ...mexidosNaBase]);
  const caminhos = arquivos.map((f) => f?.path).filter(Boolean);
  const candidatos = arquivos.filter((f) => ehCandidato(f, fora, bloqueados || new Set())).map((f) => f.path);
  const primeiros = new Set(candidatos);
  const alvos = new Set([...caminhos.filter((p) => !primeiros.has(p)), ...mexidosNaBase]);
  const voltam = voltamPorDependencia(candidatos, alvos, mapa);
  const herdados = candidatos.filter((p) => !voltam.has(p));
  const herdado = new Set(herdados);
  const aLer = caminhos.filter((p) => !herdado.has(p));
  return { herdados, aLer, contextoAlterado: [...new Set([...mexidosNaBase, ...aLer])] };
}


// O mapa de importação do head: o do preparo, se houver; senão construído aqui, só depois de achar
// a procedência (PR comum nunca paga o parser) e só sobre a fonte completa. Falha: null.
async function mapaDoHead(engine, prepared, buildMap) {
  if (prepared?.map?.head) return prepared.map.head;
  const source = prepared?.source;
  if (source?.status !== 'complete' || !source.reader || typeof buildMap !== 'function') return null;
  try { return (await buildMap(source, { limits: engine.config?.reviewContextLimits }))?.head || null; }
  catch { return null; /* sem mapa, o código volta à leitura */ }
}

// A herança do sync juntada à que já existe (a terceira fonte de juntarHerancas), com o campo
// `sync`. Qualquer falha, ou nenhum herdado, devolve a combinada intacta: a revisão de hoje.
async function herdarDoSync(engine, pr, head, arquivos, combinada, { prepared, buildMap } = {}) {
  if (!Array.isArray(arquivos) || !arquivos.length || !head) return combinada;
  try {
    const procedencia = await lerProcedenciaDoSync(engine, pr, head);
    if (!procedencia) return combinada;
    const { origem, destino, foto, baseDaResolucao, commits } = procedencia;
    const comparacao = await compararComAFoto(engine, engine.accountForPr(pr), pr.repo, { foto, head, baseDaResolucao });
    const bloqueados = comparacao && arquivosComBloqueioAberto(engine, pr);
    if (!bloqueados) return combinada;
    const mapa = await mapaDoHead(engine, prepared, buildMap);
    const { herdados, aLer, contextoAlterado } = separarHerdados({ arquivos, ...comparacao, bloqueados, mapa });
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

export { separarHerdados, voltamPorDependencia, herdarDoSync, fecharSync };
