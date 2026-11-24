// A regra de dependência do sync por herança (decisão 2 do dono, detalhada em 24/11/2026 depois de
// três revisões independentes da implementação; desenho docs/superpowers/specs/
// 2026-11-24-sync-por-heranca-design.md, seção 2). Princípio do MUNDO FECHADO: o arquivo idêntico
// à foto da origem só herda quando a regra sabe, por construção, que nada de que ele depende mudou.
//
// MUDOU é o que difere da foto, está a ler ou foi mexido pela base, dentro ou fora do diff. Cada
// arquivo mudado cai numa classe:
//   - código JS ou TS (fora `.d.ts` e configuração): contamina pelo grafo de imports do mapa;
//   - documentação e imagem: sem efeito;
//   - esquema do Prisma: devolve quem chega pelo grafo a `@prisma/client`;
//   - dado e estilo que algum código importa pelo grafo: contaminam pelo grafo;
//   - QUALQUER OUTRO (configuração de qualquer ferramenta, `.d.ts`, workflow, `.env*`, `.sql` fora
//     do Prisma, script, extensão desconhecida, arquivo sem extensão, e o dado ou estilo que nenhum
//     código importa, como o lido por `fs`): IMPACTO GLOBAL. Todo herdado que não é documentação ou
//     imagem volta à leitura.
// O herdado, por classe:
//   - documentação e imagem: herdam; o .mdx só como texto simples, sem import;
//   - código: volta se alcança pelo grafo algo que mudou, um herdado que voltou, código que o mapa
//     não leu por inteiro ou um import sem destino que pode ser do repositório, se o alias é
//     ambíguo, ou se o texto tem leitura que o mapa não vê (`import.meta.glob`, `require.context`,
//     `new URL(..., import.meta.url)`, `new Worker(`, leitura de arquivo pelo `fs`); sem texto, volta;
//   - estilo: herda só sem nenhuma referência (`@import`, `@use`, `@forward`, `composes: ... from`,
//     `@apply`, `@tailwind`, `url(` que não é `data:`); sem texto, volta;
//   - dado: herda só sem `#import` nem `$ref`; sem texto, volta;
//   - configuração, `.d.ts` e o resto: voltam (sem contaminar: o conteúdo é o revisado na origem).
import path from 'node:path';
import { builtinModules } from 'node:module';

const DOCUMENTACAO = /\.(?:md|txt|png|jpe?g|gif|svg|webp|ico|pdf|csv)$/i;
const MDX = /\.mdx$/i;
const CODIGO = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const DECLARACAO = /\.d\.[cm]?ts$/i;
const ESTILO = /\.(?:css|scss|sass|less)$/i;
const DADO = /\.(?:json|ya?ml|graphql|gql)$/i;
// configuração de ferramenta, pela forma do nome: package.json, os lockfiles pelo nome exato, tsconfig e jsconfig,
// `*.config.*` e os `.algumarc`
const CONFIGURACAO = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|go\.sum|[tj]sconfig[^/]*\.json|[^/]+\.config\.[^/]+|\.[^/]*rc(?:\.[^/]+)?)$/i;
const IMPORT_NO_MDX = /^\s*import[\s{*'"]|^\s*export\s[^\n]*\sfrom\s/m;
const REFERENCIA_DE_ESTILO = /@(?:import|use|forward|apply|tailwind)\b|composes\s*:[^;]*\bfrom\b|url\(\s*(?!['"]?data:)/i;
const REFERENCIA_DE_DADO = /#import\b|\$ref\b/;
const LEITURA_ESCONDIDA = /import\.meta\.glob|require\.context|new\s+URL\([^)]*import\.meta\.url|new\s+Worker\(|readFileSync\(|readFile\(|createReadStream\(|fs\.promises/;
// o import ou require literal: o mapa já resolveu o destino, e o não literal vira import sem destino
const LIMITACOES_TOLERADAS = new Set([
  'Import dinâmico não comprova execução ou conjunto completo de dependências.',
  'CommonJS é candidato sintático; require pode estar sombreado e a resolução exige confirmação.',
]);

const nomeDoArquivo = (p) => String(p).split('/').pop();
const pastaDe = (p) => String(p).split('/').slice(0, -1).join('/');
const ehConfiguracao = (p) => CONFIGURACAO.test(nomeDoArquivo(p));
const ehCodigo = (p) => CODIGO.test(p) && !DECLARACAO.test(p) && !ehConfiguracao(p);
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

// A chave de `paths` casa com o import? Com curinga, pelo prefixo antes dele (colado ou não: `~*`
// casa com `~utils`); sem curinga, só o igual.
function casaChave(spec, chave) {
  const i = chave.indexOf('*');
  return i < 0 ? spec === chave : spec.startsWith(chave.slice(0, i));
}

// O tsconfig diz que o import é do repositório? Chaves desconhecidas (null ou ausentes) caem na
// regra conservadora da limitação de alias; baseUrl desconhecido (null) marca todo import.
function doRepositorioPeloTsconfig(mapa, spec, pacotes) {
  const chaves = pacotes.prefixosDeAlias;
  if (chaves == null ? aliasParcial(mapa) : chaves.some((c) => casaChave(spec, c))) return true;
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

// A chave sem curinga é a mais específica; com curinga, vale o prefixo antes dele.
const comprimentoDaChave = (chave) => (chave.includes('*') ? chave.indexOf('*') : Infinity);

// O destino que a chave mais longa daria ao import, para conferir o que o mapa resolveu. O
// TypeScript aceita no máximo um `*` por alvo: alvo com mais de um é inválido, não dá destino, e o
// import volta à leitura como ambíguo.
function destinoDaChave(spec, alias) {
  const i = alias.chave.indexOf('*');
  const resto = i < 0 ? '' : spec.slice(i);
  return alias.alvos.filter((a) => a.split('*').length <= 2)
    .map((a) => path.posix.normalize(path.posix.join(alias.base, a.replaceAll('*', resto))).replace(/\.[cm]?[jt]sx?$/i, ''));
}

// O import resolvido pelo mapa é ambíguo: casa mais de uma chave de `paths` e o destino não é o da
// chave mais longa (o mapa pega a primeira). Sem as chaves com os alvos, não dá para conferir.
function aliasAmbiguo(r, pacotes) {
  if (typeof r.specifier !== 'string' || relativo(r.specifier) || !pacotes) return false;
  const casam = (pacotes.aliases || []).filter((a) => casaChave(r.specifier, a.chave));
  const chaves = (pacotes.prefixosDeAlias || []).filter((c) => casaChave(r.specifier, c));
  if (chaves.length < 2) return false;
  if (casam.length < 2) return true;
  const maisLonga = casam.reduce((a, b) => (comprimentoDaChave(b.chave) > comprimentoDaChave(a.chave) ? b : a));
  const destino = r.to.replace(/\.[cm]?[jt]sx?$/i, '').replace(/\/index$/, '');
  return !destinoDaChave(r.specifier, maisLonga).some((d) => d === destino || d === `${destino}/index` || d.replace(/\/index$/, '') === destino);
}

function lidoPorInteiro(mapa, p) {
  return (mapa.files || []).some((x) => x.path === p && x.backend !== 'textual'
    && (x.limitations || []).every((l) => LIMITACOES_TOLERADAS.has(l)));
}

const importadosPorCodigo = (mapa) => new Set((mapa?.relations || []).filter((r) => ehCodigo(r.from)).map((r) => r.to));

// A classe do arquivo mudado: 'nenhum', 'prisma', 'grafo' ou 'global'.
// As classes do arquivo mudado ('prisma', 'grafo', 'global'; vazio é sem efeito). O código dentro de
// uma pasta `prisma/` é as duas coisas; a documentação ou imagem que algum código importa (o prompt
// `.md`, o `.svg` do SVGR) contamina pelo grafo.
function classesDoMudado(p, pacotes, importados) {
  if (DOCUMENTACAO.test(p)) return importados.has(p) ? ['grafo'] : [];
  const prisma = ehEsquemaPrisma(p, pacotes);
  if (ehCodigo(p)) return prisma ? ['prisma', 'grafo'] : ['grafo'];
  if (prisma) return ['prisma'];
  if (ehConfiguracao(p)) return ['global'];
  return (ESTILO.test(p) || DADO.test(p)) && importados.has(p) ? ['grafo'] : ['global'];
}

// Os nós do grafo que contaminam quem chega a eles, fora os herdados que voltarem por dependência.
function nosRuins(mapa, mudouNoGrafo, pacotes, esquemaMudou) {
  const ruins = new Set(mudouNoGrafo);
  for (const u of mapa.unresolved || []) {
    if (doRepositorio(mapa, u, pacotes) || (esquemaMudou && usaPrisma(u))) ruins.add(u.from);
  }
  for (const r of mapa.relations || []) {
    if (CODIGO.test(r.to) && !lidoPorInteiro(mapa, r.to)) ruins.add(r.to);
    if (aliasAmbiguo(r, pacotes)) ruins.add(r.from);
  }
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

const semTexto = (textos, p) => typeof textos[p] !== 'string';

// O herdado que volta sem olhar o grafo, pelo que ele é e pelo próprio texto.
function voltaPeloArquivo(p, textos) {
  if (DOCUMENTACAO.test(p)) return false;
  if (MDX.test(p)) return semTexto(textos, p) || IMPORT_NO_MDX.test(textos[p]);
  if (ehConfiguracao(p) || DECLARACAO.test(p)) return true;
  if (ehCodigo(p)) return semTexto(textos, p) || LEITURA_ESCONDIDA.test(textos[p]);
  if (ESTILO.test(p)) return semTexto(textos, p) || REFERENCIA_DE_ESTILO.test(textos[p]);
  if (DADO.test(p)) return semTexto(textos, p) || REFERENCIA_DE_DADO.test(textos[p]);
  return true;
}

const herdaComImpactoGlobal = (p, textos) => DOCUMENTACAO.test(p) || (MDX.test(p) && !voltaPeloArquivo(p, textos));

// PURA. Os candidatos que voltam à leitura. `mudou`: o que difere da foto, o que já é a ler e o que
// a base mexeu, medidos antes da regra. Ponto fixo: o código que volta pelo grafo contamina também.
function voltamPorDependencia(candidatos, mudou, mapa, pacotes = null) {
  const textos = pacotes?.textos || {};
  const importados = importadosPorCodigo(mapa);
  const classes = [...mudou].flatMap((p) => classesDoMudado(p, pacotes, importados).map((c) => [p, c]));
  if (!mapa || classes.some(([, c]) => c === 'global')) return new Set(candidatos.filter((p) => !herdaComImpactoGlobal(p, textos)));
  const peloArquivo = new Set(candidatos.filter((p) => voltaPeloArquivo(p, textos)));
  const codigo = candidatos.filter((p) => ehCodigo(p) && !peloArquivo.has(p));
  const ruins = nosRuins(mapa, classes.filter(([, c]) => c === 'grafo').map(([p]) => p), pacotes, classes.some(([, c]) => c === 'prisma'));
  const arestas = arestasDo(mapa);
  const alcances = new Map(codigo.map((p) => [p, alcance(p, arestas)]));
  const contaminados = new Set([...peloArquivo].filter((p) => ESTILO.test(p) || DADO.test(p) || ehCodigo(p)));
  let mudouAlgo = true;
  while (mudouAlgo) {
    const novos = codigo.filter((p) => !contaminados.has(p) && (!lidoPorInteiro(mapa, p) || [...alcances.get(p)].some((n) => ruins.has(n) || contaminados.has(n))));
    novos.forEach((p) => contaminados.add(p));
    mudouAlgo = novos.length > 0;
  }
  return new Set([...peloArquivo, ...contaminados]);
}

export { CODIGO, ehCodigo, ehConfiguracao, ehEsquemaPrisma, voltamPorDependencia };
