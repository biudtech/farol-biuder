// A regra de dependência do sync por herança (decisão 2 do dono, detalhada em 24/11/2026 depois da
// revisão independente da implementação; desenho docs/superpowers/specs/
// 2026-11-24-sync-por-heranca-design.md, seção 2). O arquivo idêntico à foto da origem só herda
// quando nada de que ele depende mudou. Fechado por padrão: o que não dá para conferir volta à
// leitura.
//   - código que o mapa lê (JS e TS): volta se QUALQUER caminho de imports do mapa, passando por
//     qualquer arquivo, dentro ou fora do diff, chega a um arquivo a ler, a um arquivo que a base
//     mudou, a um herdado que voltou, a um arquivo de código que o mapa não leu por inteiro, ou a um
//     import sem destino que pode ser do repositório (relativo, alias, ou não relativo que o
//     package.json mais próximo e o da raiz não declaram como pacote externo; pacote do workspace
//     é do repositório);
//   - configuração global (tsconfig, package.json, workspace do pnpm, lockfiles, nest-cli e as
//     configurações de build) misturada, bloqueada ou mexida pela base: todo código herdado volta;
//   - esquema do Prisma misturado, bloqueado ou mexido pela base: volta quem importa
//     `@prisma/client` ou chega pelo grafo a quem o importa;
//   - herdam sem conferência só os arquivos de uma lista fechada de não código (documento, texto,
//     imagem, PDF e CSV). Todo o resto volta, inclusive `.json`, `.yaml` e `.yml`: o código pode
//     lê-los em execução sem import que o mapa veja.
import { builtinModules } from 'node:module';
import { parseJson } from '../io.js';

const NAO_CODIGO = /\.(?:md|mdx|txt|png|jpe?g|gif|svg|webp|ico|pdf|csv)$/i;
const CODIGO_DO_MAPA = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const CONFIG_GLOBAL = /^(?:tsconfig.*\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|nest-cli\.json|(?:next|vite|webpack|babel)\.config\.[^/]+)$/i;
const TETO_DE_PACOTES = 200;

const nomeDoArquivo = (p) => String(p).split('/').pop();
const pastaDe = (p) => String(p).split('/').slice(0, -1).join('/');
const ehConfigGlobal = (p) => CONFIG_GLOBAL.test(nomeDoArquivo(p));
const ehEsquemaPrisma = (p) => nomeDoArquivo(p) === 'schema.prisma';
const usaPrisma = (u) => typeof u.specifier === 'string' && (u.specifier === '@prisma/client' || u.specifier.startsWith('@prisma/client/'));
const relativo = (s) => s == null || /^[./]/.test(s);
const aliasParcial = (mapa) => (mapa.limitations || []).some((l) => /aliases/i.test(String(l)));

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

function pacoteExterno(spec, from, pacotes) {
  if (spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0])) return true;
  if (!pacotes) return false;
  const nome = nomeDoPacote(spec);
  return !pacotes.workspace.includes(nome) && declaradosPara(from, pacotes).has(nome);
}

// O import sem destino que pode ser de um arquivo do repositório.
function doRepositorio(mapa, u, pacotes) {
  return relativo(u.specifier) || u.alias === true || aliasParcial(mapa) || !pacoteExterno(u.specifier, u.from, pacotes);
}

function lidoPorInteiro(mapa, p) {
  return (mapa.files || []).some((x) => x.path === p && x.backend !== 'textual' && !x.limitations?.length);
}

// Os nós do grafo que contaminam quem chega a eles, fora os herdados que voltarem depois.
function nosRuins(mapa, alvos, pacotes, esquemaMudou) {
  const ruins = new Set(alvos);
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

// PURA. Os candidatos que voltam à leitura. `alvos`: os arquivos do diff que já são a ler e os que
// a base mexeu, medidos antes da regra (a configuração e o esquema só contam se estão entre eles:
// a configuração idêntica à foto vai à leitura, mas não derruba o código que herda).
function voltamPorDependencia(candidatos, alvos, mapa, pacotes = null) {
  const voltam = new Set(candidatos.filter((p) => !NAO_CODIGO.test(p) && !CODIGO_DO_MAPA.test(p)));
  const codigo = candidatos.filter((p) => CODIGO_DO_MAPA.test(p));
  if (!mapa || [...alvos].some(ehConfigGlobal)) {
    codigo.forEach((p) => voltam.add(p));
    return voltam;
  }
  codigo.filter((p) => !lidoPorInteiro(mapa, p)).forEach((p) => voltam.add(p));
  const ruins = nosRuins(mapa, alvos, pacotes, [...alvos].some(ehEsquemaPrisma));
  const arestas = arestasDo(mapa);
  const alcances = new Map(codigo.map((p) => [p, alcance(p, arestas)]));
  let mudou = true;
  while (mudou) {
    const novos = codigo.filter((p) => !voltam.has(p) && [...alcances.get(p)].some((n) => ruins.has(n) || voltam.has(n)));
    novos.forEach((p) => voltam.add(p));
    mudou = novos.length > 0;
  }
  return voltam;
}

async function lerPacote(source, caminho) {
  const r = await source.reader.read(caminho, 'head');
  const pkg = r?.status === 'available' ? parseJson(r.text, null) : null;
  return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
}

// Os pacotes declarados em cada package.json do head (fora de node_modules) e os do workspace (o
// nome de cada pacote do repositório e as dependências `workspace:`). null quando a árvore não veio
// inteira, falta o da raiz, há package.json demais ou algum não deu para ler: aí todo import não
// relativo sem destino conta como do repositório.
async function pacotesDoRepositorio(source) {
  try {
    const tree = await source?.reader?.tree?.('head');
    if (tree?.complete !== true || !Array.isArray(tree.entries)) return null;
    const caminhos = tree.entries.filter((e) => e?.type !== 'tree' && nomeDoArquivo(e.path) === 'package.json'
      && !/(?:^|\/)node_modules\//.test(e.path)).map((e) => e.path);
    if (!caminhos.includes('package.json') || caminhos.length > TETO_DE_PACOTES) return null;
    const porPasta = {};
    const workspace = new Set();
    for (const caminho of caminhos) {
      const pkg = await lerPacote(source, caminho);
      if (!pkg) return null;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      Object.entries(deps).filter(([, v]) => String(v).startsWith('workspace:')).forEach(([n]) => workspace.add(n));
      if (caminho !== 'package.json' && typeof pkg.name === 'string') workspace.add(pkg.name);
      porPasta[pastaDe(caminho)] = Object.keys(deps);
    }
    return { porPasta, workspace: [...workspace] };
  } catch {
    return null; // sem os pacotes, o import não relativo sem destino volta à leitura
  }
}

export { NAO_CODIGO, CODIGO_DO_MAPA, ehConfigGlobal, ehEsquemaPrisma, voltamPorDependencia, pacotesDoRepositorio };
