// A regra de dependência do sync por herança (decisão 2 do dono, detalhada em 24/11/2026 depois de
// duas revisões independentes da implementação; desenho docs/superpowers/specs/
// 2026-11-24-sync-por-heranca-design.md, seção 2). O arquivo idêntico à foto da origem só herda
// quando nada de que ele depende mudou. Fechado por padrão: o que não dá para conferir volta.
//   - MUDOU é o que difere da foto (dentro ou fora do diff), o que está a ler e o que a base mexeu.
//   - código que o mapa lê (JS e TS): volta se QUALQUER caminho de imports do mapa, passando por
//     qualquer arquivo, dentro ou fora do diff, chega a algo que mudou, a um herdado que voltou por
//     dependência, a código que o mapa não leu por inteiro (o import ou require literal não conta)
//     ou a um import sem destino que pode ser do repositório: relativo, alias (marcado pelo mapa ou
//     casando um prefixo dos `paths` do tsconfig), primeiro segmento que existe sob o `baseUrl`, ou
//     pacote que o package.json mais próximo e o da raiz não declaram, ou que é do repositório;
//   - configuração global mudada: todo código herdado volta;
//   - esquema do Prisma mudado (qualquer `.prisma`, a pasta `prisma/`, `prisma.config.*` e o
//     `prisma.schema` do package.json): volta quem chega pelo grafo a `@prisma/client`;
//   - dado e estilo (JSON fora da configuração global, YAML, CSS e afins, GraphQL) idênticos herdam e
//     não contaminam quem os importa; o estilo com @import, @use ou @forward de algo que mudou volta;
//   - .mdx herda só como texto simples, sem import;
//   - herdam sem conferência só documento, texto, imagem, PDF e CSV. O resto volta.
import path from 'node:path';
import { builtinModules } from 'node:module';

const NAO_CODIGO = /\.(?:md|txt|png|jpe?g|gif|svg|webp|ico|pdf|csv)$/i;
const DADO_OU_ESTILO = /\.(?:json|ya?ml|css|scss|sass|less|graphql|gql)$/i;
const ESTILO = /\.(?:css|scss|sass|less)$/i;
const MDX = /\.mdx$/i;
const CODIGO_DO_MAPA = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const CONFIG_GLOBAL = /^(?:tsconfig.*\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|nest-cli\.json|(?:next|vite|webpack|babel)\.config\.[^/]+)$/i;
const IMPORT_NO_MDX = /^\s*import[\s{*'"]|^\s*export\s[^\n]*\sfrom\s/m;
const IMPORT_DE_ESTILO = /@(?:import|use|forward)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;
const EXTENSOES_DE_ESTILO = ['', '.css', '.scss', '.sass', '.less'];
// o import ou require literal: o mapa já resolveu o destino, e o não literal vira import sem destino
const LIMITACOES_TOLERADAS = new Set([
  'Import dinâmico não comprova execução ou conjunto completo de dependências.',
  'CommonJS é candidato sintático; require pode estar sombreado e a resolução exige confirmação.',
]);

const nomeDoArquivo = (p) => String(p).split('/').pop();
const pastaDe = (p) => String(p).split('/').slice(0, -1).join('/');
const ehConfigGlobal = (p) => CONFIG_GLOBAL.test(nomeDoArquivo(p));
const usaPrisma = (u) => typeof u.specifier === 'string' && (u.specifier === '@prisma/client' || u.specifier.startsWith('@prisma/client/'));
const relativo = (s) => s == null || /^[./]/.test(s);
const aliasParcial = (mapa) => (mapa.limitations || []).some((l) => /aliases/i.test(String(l)));
const builtin = (spec) => spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]);

function ehEsquemaPrisma(p, pacotes) {
  return /\.prisma$/i.test(p) || /(?:^|\/)prisma\//.test(p) || /^prisma\.config\.[^/]+$/i.test(nomeDoArquivo(p))
    || (!!pacotes?.esquemaDoPackage && p === pacotes.esquemaDoPackage);
}

function nomeDoPacote(spec) {
  const partes = spec.split('/');
  return spec.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0];
}

// Os pacotes declarados para quem importa: o package.json mais próximo, junto com o da raiz.
function declaradosPara(from, pacotes) {
  const raiz = pacotes.porPasta[''] || [];
  const pastas = pastaDe(from).split('/').filter(Boolean);
  for (let i = pastas.length; i > 0; i--) {
    const proprios = pacotes.porPasta[pastas.slice(0, i).join('/')];
    if (proprios) return new Set([...proprios, ...raiz]);
  }
  return new Set(raiz);
}

const casaPrefixo = (spec, p) => p === '' || spec === p.replace(/\/$/, '') || spec.startsWith(p.endsWith('/') ? p : `${p}/`);

// O tsconfig diz que o import é do repositório? Prefixos desconhecidos (null ou ausentes) caem na
// regra conservadora da limitação de alias; baseUrl desconhecido (null) marca todo import.
function doRepositorioPeloTsconfig(mapa, spec, pacotes) {
  const prefixos = pacotes.prefixosDeAlias;
  if (prefixos == null ? aliasParcial(mapa) : prefixos.some((p) => casaPrefixo(spec, p))) return true;
  const segmentos = pacotes.segmentosDoBaseUrl;
  return segmentos === null || (Array.isArray(segmentos) && segmentos.includes(spec.split('/')[0]));
}

// O import sem destino que pode ser de um arquivo do repositório.
function doRepositorio(mapa, u, pacotes) {
  const spec = u.specifier;
  if (relativo(spec) || u.alias === true) return true;
  if (pacotes && doRepositorioPeloTsconfig(mapa, spec, pacotes)) return true;
  if (builtin(spec)) return false;
  if (!pacotes) return true;
  const nome = nomeDoPacote(spec);
  return pacotes.workspace.includes(nome) || !declaradosPara(u.from, pacotes).has(nome);
}

function lidoPorInteiro(mapa, p) {
  return (mapa.files || []).some((x) => x.path === p && x.backend !== 'textual'
    && (x.limitations || []).every((l) => LIMITACOES_TOLERADAS.has(l)));
}

// Os nós do grafo que contaminam quem chega a eles, fora os herdados que voltarem por dependência.
function nosRuins(mapa, mudou, pacotes, esquemaMudou) {
  const ruins = new Set(mudou);
  for (const u of mapa.unresolved || []) {
    if (doRepositorio(mapa, u, pacotes) || (esquemaMudou && usaPrisma(u))) ruins.add(u.from);
  }
  for (const r of mapa.relations || []) if (CODIGO_DO_MAPA.test(r.to) && !lidoPorInteiro(mapa, r.to)) ruins.add(r.to);
  return ruins;
}

// Tudo o que um arquivo alcança pelos imports do mapa, ele incluído.
function alcance(origem, arestas) {
  const vistos = new Set([origem]);
  const fila = [origem];
  while (fila.length) {
    for (const prox of arestas.get(fila.shift()) || []) if (!vistos.has(prox)) { vistos.add(prox); fila.push(prox); }
  }
  return vistos;
}

function arestasDo(mapa) {
  const arestas = new Map();
  for (const r of mapa.relations || []) arestas.set(r.from, [...(arestas.get(r.from) || []), r.to]);
  return arestas;
}

// Os destinos possíveis de um @import, @use ou @forward, ou null quando ele aponta para fora do
// alcance da conferência (`~pacote`). `sass:` e URL externa não dependem do repositório.
function destinosDoEstilo(arquivo, alvo) {
  if (/^(?:sass:|https?:|\/\/)/.test(alvo)) return [];
  if (alvo.startsWith('~')) return null;
  const base = path.posix.normalize(path.posix.join(pastaDe(arquivo), alvo));
  const parcial = path.posix.join(path.posix.dirname(base), `_${path.posix.basename(base)}`);
  return [base, parcial, `${base}/index`, `${base}/_index`].flatMap((b) => EXTENSOES_DE_ESTILO.map((e) => b + e));
}

// O estilo depende de algo que mudou? Sem o texto, não dá para saber.
function estiloDependeDeMudanca(arquivo, texto, mudou) {
  if (typeof texto !== 'string') return true;
  for (const [, alvo] of texto.matchAll(IMPORT_DE_ESTILO)) {
    const destinos = destinosDoEstilo(arquivo, alvo);
    if (!destinos || destinos.some((d) => mudou.has(d))) return true;
  }
  return false;
}

// Quem volta pela categoria, sem olhar o grafo: o que não tem conferência possível, a configuração
// global idêntica e o .mdx com import ou sem texto. Não contamina quem o importa.
function voltaPelaCategoria(p, textos) {
  if (NAO_CODIGO.test(p) || CODIGO_DO_MAPA.test(p)) return false;
  if (MDX.test(p)) return typeof textos[p] !== 'string' || IMPORT_NO_MDX.test(textos[p]);
  return ehConfigGlobal(p) || !DADO_OU_ESTILO.test(p);
}

function voltamPeloGrafo(codigo, mapa, mudou, pacotes, contaminados) {
  const ruins = nosRuins(mapa, mudou, pacotes, [...mudou].some((p) => ehEsquemaPrisma(p, pacotes)));
  const arestas = arestasDo(mapa);
  const alcances = new Map(codigo.map((p) => [p, alcance(p, arestas)]));
  return codigo.filter((p) => !lidoPorInteiro(mapa, p) || [...alcances.get(p)].some((n) => ruins.has(n) || contaminados.has(n)));
}

// PURA. Os candidatos que voltam à leitura. `mudou`: o que difere da foto, o que já é a ler e o que
// a base mexeu, medidos antes da regra. Ponto fixo: quem volta por dependência contamina também.
function voltamPorDependencia(candidatos, mudou, mapa, pacotes = null) {
  const textos = pacotes?.textos || {};
  const pelaCategoria = candidatos.filter((p) => voltaPelaCategoria(p, textos));
  const codigo = candidatos.filter((p) => CODIGO_DO_MAPA.test(p));
  const estilos = candidatos.filter((p) => ESTILO.test(p) && !ehConfigGlobal(p));
  const configMudou = [...mudou].some(ehConfigGlobal);
  const contaminados = new Set();
  let mudouAlgo = true;
  while (mudouAlgo) {
    const alcancados = new Set([...mudou, ...contaminados]);
    const voltamCodigo = !mapa || configMudou ? codigo : voltamPeloGrafo(codigo, mapa, mudou, pacotes, contaminados);
    const voltamEstilo = estilos.filter((p) => estiloDependeDeMudanca(p, textos[p], alcancados));
    const novos = [...voltamCodigo, ...voltamEstilo].filter((p) => !contaminados.has(p));
    novos.forEach((p) => contaminados.add(p));
    mudouAlgo = novos.length > 0;
  }
  return new Set([...pelaCategoria, ...contaminados]);
}

export { NAO_CODIGO, CODIGO_DO_MAPA, ehConfigGlobal, ehEsquemaPrisma, voltamPorDependencia };
