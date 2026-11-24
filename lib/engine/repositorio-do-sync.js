// O que a regra de dependência do sync por herança (dependencia-do-sync.js) precisa saber do
// repositório no head, lido da fonte fixada sem rede nem modelo (24/11/2026):
//   - os pacotes declarados em cada package.json (fora de node_modules) e os do repositório: o nome
//     de cada pacote local, as dependências `workspace:` e as locais (`file:`, `link:`, `portal:`),
//     pela chave;
//   - o caminho do esquema do Prisma declarado em `prisma.schema` do package.json da raiz;
//   - os prefixos de alias (`compilerOptions.paths`) e os primeiros segmentos que existem sob o
//     `baseUrl` de cada tsconfig ou jsconfig, seguindo `extends` relativo. Extends relativo que
//     não dá para ler deixa os dois desconhecidos (null), e a regra fica conservadora;
//   - o texto dos arquivos que a regra lê (o .mdx e o estilo herdados).
// null quando a árvore não veio inteira, falta o package.json da raiz, há package.json demais ou
// algum não deu para ler: aí todo import não relativo sem destino conta como do repositório.
import path from 'node:path';
import { parseJson } from '../io.js';

const TETO_DE_PACOTES = 200;
const TETO_DE_EXTENDS = 5;
// a leitura do texto dos herdados: até 300 arquivos e 30 s no total
const TETO_DE_TEXTOS = 300;
const PRAZO_DOS_TEXTOS_MS = 30_000;
const LOCAL = /^(?:workspace|file|link|portal):/;
const TSCONFIG = /^[tj]sconfig.*\.json$/i;

const nomeDoArquivo = (p) => String(p).split('/').pop();
const pastaDe = (p) => path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
const foraDeNodeModules = (p) => !/(?:^|\/)node_modules\//.test(p);

async function lerTexto(source, caminho) {
  const r = await source.reader.read(caminho, 'head');
  return r?.status === 'available' && typeof r.text === 'string' ? r.text : null;
}

// JSON com comentário e vírgula sobrando, como o tsconfig aceita. Os comentários só saem fora de
// string; null quando não dá para ler.
function lerJsonc(texto) {
  if (typeof texto !== 'string') return null;
  let saida = '';
  let emString = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emString) { saida += c; if (c === '\\') saida += texto[++i] ?? ''; else if (c === '"') emString = false; continue; }
    if (c === '"') { emString = true; saida += c; continue; }
    if (c === '/' && texto[i + 1] === '/') { while (i < texto.length && texto[i] !== '\n') i++; saida += '\n'; continue; }
    if (c === '/' && texto[i + 1] === '*') { i = texto.indexOf('*/', i + 2); if (i < 0) return null; i++; continue; }
    saida += c;
  }
  const v = parseJson(saida.replace(/,(\s*[}\]])/g, '$1'), null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

async function lerPacotes(source, caminhos) {
  const porPasta = {};
  const workspace = new Set();
  let esquemaDoPackage = null;
  for (const caminho of caminhos) {
    const pkg = parseJson(await lerTexto(source, caminho) ?? '', null);
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return null;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    Object.entries(deps).filter(([, v]) => LOCAL.test(String(v))).forEach(([n]) => workspace.add(n));
    if (caminho !== 'package.json' && typeof pkg.name === 'string') workspace.add(pkg.name);
    if (caminho === 'package.json' && typeof pkg.prisma?.schema === 'string') esquemaDoPackage = path.posix.normalize(pkg.prisma.schema);
    porPasta[pastaDe(caminho)] = Object.keys(deps);
  }
  return { porPasta, workspace: [...workspace], esquemaDoPackage };
}

// Os próximos arquivos da cadeia de extends (texto ou lista), só os relativos.
function proximosExtends(atual, ext) {
  const lista = Array.isArray(ext) ? ext : [ext];
  return lista.filter((e) => typeof e === 'string' && e.startsWith('.'))
    .map((e) => path.posix.normalize(path.posix.join(pastaDe(atual), /\.json$/i.test(e) ? e : `${e}.json`)));
}

// O baseUrl e os paths efetivos de um tsconfig, seguindo extends relativo. undefined: não deu para
// ler. Extends de pacote (`@tsconfig/node20`) é tratado como sem baseUrl nem paths.
// A cadeia de extends em ordem de aplicação (o mais base primeiro). undefined: algum não deu para
// ler, ou a cadeia passou do teto.
async function cadeiaDoTsconfig(source, caminho, profundidade = 0) {
  if (profundidade >= TETO_DE_EXTENDS) return undefined;
  const json = lerJsonc(await lerTexto(source, caminho));
  if (!json) return undefined;
  const bases = [];
  for (const proximo of proximosExtends(caminho, json.extends)) {
    const cadeia = await cadeiaDoTsconfig(source, proximo, profundidade + 1);
    if (!cadeia) return undefined;
    bases.push(...cadeia);
  }
  return [...bases, { arquivo: caminho, json }];
}

// O baseUrl e os paths efetivos de um tsconfig (cada chave com os alvos e a pasta de que eles
// partem), seguindo extends relativo. undefined: não deu para ler.
async function opcoesDoTsconfig(source, caminho) {
  const cadeia = await cadeiaDoTsconfig(source, caminho);
  if (!cadeia) return undefined;
  const opcoes = { baseUrl: null, paths: {} };
  for (const { arquivo, json } of cadeia) {
    const c = json.compilerOptions || {};
    if (typeof c.baseUrl === 'string') opcoes.baseUrl = path.posix.normalize(path.posix.join(pastaDe(arquivo), c.baseUrl));
    if (c.paths && typeof c.paths === 'object') Object.assign(opcoes.paths, c.paths);
  }
  const base = opcoes.baseUrl ?? pastaDe(caminho);
  opcoes.aliases = Object.entries(opcoes.paths).filter(([, alvos]) => Array.isArray(alvos))
    .map(([chave, alvos]) => ({ chave, alvos: alvos.filter((a) => typeof a === 'string'), base }));
  return opcoes;
}

function segmentosSob(base, caminhos) {
  const prefixo = base === '.' || base === '' ? '' : `${base}/`;
  return caminhos.filter((p) => p.startsWith(prefixo)).map((p) => p.slice(prefixo.length).split('/')[0].replace(/\.[^.]+$/, ''));
}

// As chaves de `paths` de todos os tsconfig e jsconfig (cruas, com o curinga), com os alvos, e os
// primeiros segmentos sob cada `baseUrl`. Um tsconfig ilegível deixa tudo desconhecido (null).
async function lerTsconfigs(source, tsconfigs, caminhos) {
  const chaves = new Set();
  const aliases = [];
  const segmentos = new Set();
  for (const caminho of tsconfigs) {
    const opcoes = await opcoesDoTsconfig(source, caminho);
    if (!opcoes) return { prefixosDeAlias: null, aliases: null, segmentosDoBaseUrl: null };
    opcoes.aliases.forEach((a) => { chaves.add(a.chave); aliases.push(a); });
    if (opcoes.baseUrl !== null) segmentosSob(opcoes.baseUrl, caminhos).forEach((s) => segmentos.add(s));
  }
  return { prefixosDeAlias: [...chaves], aliases, segmentosDoBaseUrl: [...segmentos] };
}

// O texto dos arquivos pedidos, com teto de quantidade e de tempo: passou do teto, os que faltam
// ficam sem texto, e a regra os devolve à leitura (nunca herança). O texto já conhecido (o que o
// mapa leu) não é lido de novo.
async function lerTextos(source, caminhos, { textosConhecidos = {}, tetoDeTextos = TETO_DE_TEXTOS, prazoDosTextosMs = PRAZO_DOS_TEXTOS_MS, agora = Date.now } = {}) {
  const textos = {};
  const inicio = agora();
  let lidos = 0;
  for (const caminho of caminhos) {
    if (typeof textosConhecidos[caminho] === 'string') { textos[caminho] = textosConhecidos[caminho]; continue; }
    if (lidos >= tetoDeTextos || agora() - inicio > prazoDosTextosMs) break;
    lidos += 1;
    const texto = await lerTexto(source, caminho);
    if (texto !== null) textos[caminho] = texto;
  }
  return textos;
}

async function pacotesDoRepositorio(source, caminhosComTexto = [], opcoes = {}) {
  try {
    const tree = await source?.reader?.tree?.('head');
    if (tree?.complete !== true || !Array.isArray(tree.entries)) return null;
    const caminhos = tree.entries.filter((e) => e && e.type !== 'tree' && typeof e.path === 'string' && foraDeNodeModules(e.path)).map((e) => e.path);
    const pacotes = caminhos.filter((p) => nomeDoArquivo(p) === 'package.json');
    if (!pacotes.includes('package.json') || pacotes.length > TETO_DE_PACOTES) return null;
    const lidos = await lerPacotes(source, pacotes);
    if (!lidos) return null;
    const ts = await lerTsconfigs(source, caminhos.filter((p) => TSCONFIG.test(nomeDoArquivo(p))), caminhos);
    return { ...lidos, ...ts, textos: await lerTextos(source, caminhosComTexto, opcoes) };
  } catch {
    return null; // sem o que ler do repositório, o import não relativo sem destino volta à leitura
  }
}

export { pacotesDoRepositorio, lerJsonc };
