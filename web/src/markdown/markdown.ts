// O leitor de markdown do front: transforma o texto de um review numa árvore de blocos e
// trechos, que o componente Markdown desenha com elementos do React. Sem dependência e sem
// HTML: a árvore só tem texto, então marcação crua no review (`<script>`, `<img onerror>`)
// aparece como texto. Do texto saem três valores que viram atributo, cada um filtrado: o
// `href` (linkSeguro), a linguagem do bloco de código e o número inicial da lista.
//
// É um subconjunto, de propósito: títulos, parágrafos, listas, citação, bloco de código com
// cerca, régua, negrito, itálico, código em linha e link https. Tabela, imagem, HTML, nota de
// rodapé e bloco de código por recuo não são lidos: aparecem como o texto que são.
//
// Entrada de fora: o custo da leitura é limitado (nenhuma expressão regular com retrocesso
// sobre a linha inteira, e toda busca de fecho que falha é lembrada), e há teto de tamanho e
// de profundidade. O pior caso é o `)` de cada `[texto](`, procurado em até TETO_DA_URL + 300
// caracteres: tamanho do texto vezes isso.

// O teto do texto, contado depois da expansão das tabulações. O que passar é cortado, e o
// documento diz que foi. O motor limita em 60.000 o corpo do payload que publica
// (MAX_REVIEW_BODY, lib/engine/public-review.js, na raiz), mas o texto da projeção pode vir
// de outra fonte, sem esse teto.
export const TETO_DE_TEXTO = 100_000;
// citação e lista, uma dentro da outra
export const TETO_DE_PROFUNDIDADE = 6;
// negrito, itálico e texto de link, um dentro do outro
export const TETO_DE_ENFASE = 6;
export const TETO_DA_URL = 2048;

export type Trecho =
  | { t: 'texto'; v: string }
  | { t: 'codigo'; v: string }
  | { t: 'forte'; f: Trecho[] }
  | { t: 'enfase'; f: Trecho[] }
  | { t: 'link'; href: string; f: Trecho[] }
  | { t: 'quebra' };

export type Bloco =
  | { t: 'titulo'; nivel: 1 | 2 | 3 | 4 | 5 | 6; f: Trecho[] }
  | { t: 'paragrafo'; f: Trecho[] }
  | { t: 'lista'; ordenada: boolean; inicio?: number; itens: Bloco[][] }
  | { t: 'citacao'; f: Bloco[] }
  | { t: 'codigo'; v: string; linguagem?: string }
  | { t: 'regua' };

export interface Documento {
  blocos: Bloco[];
  // o texto passou de TETO_DE_TEXTO e só o começo foi lido
  cortado: boolean;
}

// https, duas barras e o host logo depois
const COMECO_DE_URL = /^https:\/\/[^/?#]/;
// espaço, controle, aspas, e os controles de direção do texto (U+202A a U+202E e U+2066 a
// U+2069), que fazem o endereço parecer outro na tela
const PROIBIDO_NA_URL = /[\s\u0000-\u001f\u007f<>"'`\\‪-‮⁦-⁩]/;
// a autoridade: do fim de `https://` até a primeira barra, interrogação ou cerquilha
const AUTORIDADE = /^https:\/\/([^/?#]*)/;

// O único endereço que vira link: https, com host, sem arroba na autoridade (nem usuário e
// senha vazios, como em `https://@host`), sem espaço, controle nem controle de direção.
// Devolve o endereço normalizado, ou null. Destino local (`https://localhost`, endereço de
// rede interna) passa: é https, e quem abre é a pessoa, com o endereço à vista.
export function linkSeguro(url: string): string | null {
  if (url.length > TETO_DA_URL || !COMECO_DE_URL.test(url) || PROIBIDO_NA_URL.test(url)) return null;
  if (AUTORIDADE.exec(url)?.[1]?.includes('@') !== false) return null;
  let lido: URL;
  try { lido = new URL(url); } catch { return null; }
  if (lido.protocol !== 'https:' || !lido.hostname || lido.username || lido.password) return null;
  return lido.href;
}

const ALFANUMERICO = /[\p{L}\p{N}]/u;
const ESCAPAVEL = '\\`*_{}[]()<>#+-.!|~';
const FIM_DE_URL = ' \n\t<>"\'`';
const SOBRA_DE_URL = '.,;:!?)]*_';

function ehAlfanumerico(c: string | undefined): boolean {
  return c !== undefined && ALFANUMERICO.test(c);
}

function ehEspaco(c: string | undefined): boolean {
  return c === undefined || c === ' ' || c === '\n';
}

// As posições de cada sequência de crases, por tamanho, e até onde cada lista já foi usada:
// achar o fecho de um código em linha não relê o texto.
function sequenciasDeCrase(texto: string): Map<number, { onde: number[]; usado: number }> {
  const mapa = new Map<number, { onde: number[]; usado: number }>();
  let i = texto.indexOf('`');
  while (i >= 0) {
    let fim = i;
    while (texto[fim] === '`') fim += 1;
    const tamanho = fim - i;
    const lista = mapa.get(tamanho) ?? { onde: [], usado: 0 };
    lista.onde.push(i);
    mapa.set(tamanho, lista);
    i = texto.indexOf('`', fim);
  }
  return mapa;
}

function lerTrechos(texto: string, prof: number, dentroDeLink: boolean): Trecho[] {
  const saida: Trecho[] = [];
  let pendente = '';
  const despejar = (): void => {
    if (pendente) saida.push({ t: 'texto', v: pendente });
    pendente = '';
  };
  let crases: Map<number, { onde: number[]; usado: number }> | null = null;
  // marcas de ênfase cuja busca de fecho já foi até o fim sem achar: não se busca de novo
  const semFecho = new Set<string>();
  const n = texto.length;

  function fechoDaCrase(inicio: number, tamanho: number): number {
    crases ??= sequenciasDeCrase(texto);
    const lista = crases.get(tamanho);
    if (!lista) return -1;
    while (lista.usado < lista.onde.length && (lista.onde[lista.usado] as number) <= inicio) lista.usado += 1;
    return lista.onde[lista.usado] ?? -1;
  }

  // O fecho de `*`, `_`, `**` ou `__` aberto em `inicio`, ou -1. A marca abre colada no texto
  // e fecha colada no texto; o sublinhado não vale no meio de palavra (foo_bar_baz).
  function fechoDaEnfase(inicio: number, marca: string): number {
    const sinal = marca[0] as string;
    const tamanho = marca.length;
    if (ehEspaco(texto[inicio + tamanho])) return -1;
    if (sinal === '_' && ehAlfanumerico(texto[inicio - 1])) return -1;
    if (semFecho.has(marca)) return -1;
    let j = inicio + tamanho + 1;
    while (j < n) {
      j = texto.indexOf(sinal, j);
      if (j < 0) break;
      let fim = j;
      while (texto[fim] === sinal) fim += 1;
      const seguidos = fim - j;
      const serve = tamanho === 1 ? seguidos === 1 : seguidos >= 2;
      if (serve && !ehEspaco(texto[j - 1]) && texto[j - 1] !== '\\' && (sinal !== '_' || !ehAlfanumerico(texto[fim]))) return j;
      j = fim;
    }
    semFecho.add(marca);
    return -1;
  }

  // `[texto](destino)`: o `]` é o primeiro colchete depois do `[` (texto de link não tem
  // colchete dentro), e o destino vai até o `)`, na mesma linha.
  function formaDoLink(inicio: number): { fecha: number; fim: number } | null {
    let fecha = inicio + 1;
    while (fecha < n && texto[fecha] !== ']' && texto[fecha] !== '[' && texto[fecha] !== '\n') fecha += texto[fecha] === '\\' ? 2 : 1;
    if (texto[fecha] !== ']' || texto[fecha + 1] !== '(') return null;
    const limite = Math.min(n, fecha + 2 + TETO_DA_URL + 300);
    let fim = fecha + 2;
    let abertos = 0;
    for (; fim < limite; fim += 1) {
      const c = texto[fim];
      if (c === '\n') return null;
      if (c === '(') abertos += 1;
      else if (c === ')') {
        if (abertos === 0) break;
        abertos -= 1;
      }
    }
    return texto[fim] === ')' ? { fecha, fim } : null;
  }

  function lerLink(inicio: number): { no: Trecho; fim: number } | null {
    const forma = formaDoLink(inicio);
    if (!forma) return null;
    const { fecha, fim } = forma;
    // o título opcional (`"..."` depois do endereço) é ignorado
    const destino = texto.slice(fecha + 2, fim).trim().split(' ')[0] ?? '';
    const href = linkSeguro(destino);
    if (!href) return null;
    const rotulo = texto.slice(inicio + 1, fecha);
    const filhos = rotulo.trim() ? lerTrechos(rotulo, prof + 1, true) : [{ t: 'texto' as const, v: href }];
    return { no: { t: 'link', href, f: filhos }, fim: fim + 1 };
  }

  let i = 0;
  while (i < n) {
    const c = texto[i] as string;

    if (c === '\\' && i + 1 < n && ESCAPAVEL.includes(texto[i + 1] as string)) {
      pendente += texto[i + 1];
      i += 2;
      continue;
    }

    if (c === '\n') {
      despejar();
      saida.push({ t: 'quebra' });
      i += 1;
      continue;
    }

    if (c === '`') {
      let fim = i;
      while (texto[fim] === '`') fim += 1;
      const tamanho = fim - i;
      const fecho = fechoDaCrase(i, tamanho);
      if (fecho < 0) {
        pendente += texto.slice(i, fim);
        i = fim;
        continue;
      }
      let codigo = texto.slice(fim, fecho).replace(/\n/g, ' ');
      if (codigo.length > 1 && codigo.startsWith(' ') && codigo.endsWith(' ') && codigo.trim()) codigo = codigo.slice(1, -1);
      despejar();
      saida.push({ t: 'codigo', v: codigo });
      i = fecho + tamanho;
      continue;
    }

    if ((c === '*' || c === '_') && prof < TETO_DE_ENFASE) {
      let fim = i;
      while (texto[fim] === c) fim += 1;
      const seguidos = fim - i;
      // um sinal é itálico, dois é negrito; três ou mais ficam como texto
      if (seguidos <= 2) {
        const marca = c.repeat(seguidos);
        const fecho = fechoDaEnfase(i, marca);
        if (fecho >= 0) {
          despejar();
          saida.push({ t: seguidos === 2 ? 'forte' : 'enfase', f: lerTrechos(texto.slice(i + seguidos, fecho), prof + 1, dentroDeLink) });
          i = fecho + seguidos;
          continue;
        }
      }
      pendente += texto.slice(i, fim);
      i = fim;
      continue;
    }

    // Imagem (`![texto](endereço)`) não é desenhada nem vira link: aparece inteira, como o
    // texto que é, e o endereço dela não é lido como endereço solto.
    if (c === '!' && texto[i + 1] === '[') {
      const forma = formaDoLink(i + 1);
      if (forma) {
        pendente += texto.slice(i, forma.fim + 1);
        i = forma.fim + 1;
        continue;
      }
    }

    if (c === '[' && !dentroDeLink && prof < TETO_DE_ENFASE) {
      const link = lerLink(i);
      if (link) {
        despejar();
        saida.push(link.no);
        i = link.fim;
        continue;
      }
    }

    if (c === 'h' && !dentroDeLink && texto.startsWith('https://', i) && !ehAlfanumerico(texto[i - 1])) {
      // O endereço vai até o primeiro espaço, aspas ou sinal de menor ou maior. Se ele passa
      // do teto, ou encosta no fim de um texto que foi cortado, não se sabe onde ele acaba:
      // fica texto inteiro, em vez de virar link para um pedaço (que pode ser outro host).
      let acaba = i + 8;
      while (acaba < n && !FIM_DE_URL.includes(texto[acaba] as string)) acaba += 1;
      const semFim = acaba === n && caudaCortada !== null && texto.endsWith(caudaCortada);
      if (acaba - i > TETO_DA_URL || semFim) {
        pendente += texto.slice(i, acaba);
        i = acaba;
        continue;
      }
      let fim = acaba;
      while (fim > i + 8 && SOBRA_DE_URL.includes(texto[fim - 1] as string)) fim -= 1;
      const href = linkSeguro(texto.slice(i, fim));
      if (href) {
        despejar();
        // o texto visível é o endereço normalizado: é para lá que o link vai
        saida.push({ t: 'link', href, f: [{ t: 'texto', v: href }] });
        i = fim;
        continue;
      }
    }

    pendente += c;
    i += 1;
  }
  despejar();
  return saida;
}

function recuoDa(linha: string): number {
  let i = 0;
  while (linha[i] === ' ') i += 1;
  return i;
}

function ehVazia(linha: string): boolean {
  return recuoDa(linha) === linha.length;
}

const CERCA = /^ {0,3}(`{3,}|~{3,})/;
const TITULO = /^ {0,3}(#{1,6})(?: |$)/;
const CITACAO = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?: |$)/;

// Três ou mais `-`, `*` ou `_` na linha, com espaço entre eles ou não, e mais nada.
function ehRegua(linha: string): boolean {
  if (recuoDa(linha) > 3) return false;
  let sinal = '';
  let quantos = 0;
  for (const c of linha) {
    if (c === ' ') continue;
    if (c !== '-' && c !== '*' && c !== '_') return false;
    if (sinal && c !== sinal) return false;
    sinal = c;
    quantos += 1;
  }
  return quantos >= 3;
}

function lerTitulo(linha: string, marca: RegExpExecArray): Bloco {
  let fim = linha.length;
  while (fim > 0 && linha[fim - 1] === ' ') fim -= 1;
  // os `#` do fim saem quando vêm depois de um espaço
  let semCerquilha = fim;
  while (semCerquilha > 0 && linha[semCerquilha - 1] === '#') semCerquilha -= 1;
  if (semCerquilha < fim && (semCerquilha === 0 || linha[semCerquilha - 1] === ' ')) fim = semCerquilha;
  const texto = linha.slice(Math.min(marca[0].length, fim), fim).trim();
  return { t: 'titulo', nivel: (marca[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6, f: lerTrechos(texto, 0, false) };
}

function lerBlocos(linhas: readonly string[], prof: number): Bloco[] {
  const blocos: Bloco[] = [];
  const podeAninhar = prof < TETO_DE_PROFUNDIDADE;
  // o que encerra um parágrafo sem linha em branco antes
  const abreBloco = (linha: string): boolean => (
    CERCA.test(linha) || TITULO.test(linha) || ehRegua(linha) || (podeAninhar && (CITACAO.test(linha) || ITEM.test(linha)))
  );
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i] as string;
    if (ehVazia(linha)) {
      i += 1;
      continue;
    }

    const cerca = CERCA.exec(linha);
    if (cerca) {
      const marca = cerca[1] as string;
      const linguagem = /^[\w+#.-]{1,40}/.exec(linha.slice(cerca[0].length).trim())?.[0];
      const corpo: string[] = [];
      i += 1;
      while (i < linhas.length) {
        const atual = linhas[i] as string;
        const fecho = CERCA.exec(atual);
        if (fecho && (fecho[1] as string)[0] === marca[0] && (fecho[1] as string).length >= marca.length && ehVazia(atual.slice(fecho[0].length))) break;
        corpo.push(atual);
        i += 1;
      }
      i += 1;
      blocos.push(linguagem ? { t: 'codigo', v: corpo.join('\n'), linguagem } : { t: 'codigo', v: corpo.join('\n') });
      continue;
    }

    const titulo = TITULO.exec(linha);
    if (titulo) {
      blocos.push(lerTitulo(linha, titulo));
      i += 1;
      continue;
    }

    if (ehRegua(linha)) {
      blocos.push({ t: 'regua' });
      i += 1;
      continue;
    }

    if (podeAninhar && CITACAO.test(linha)) {
      const dentro: string[] = [];
      while (i < linhas.length) {
        const marca = CITACAO.exec(linhas[i] as string);
        if (!marca) break;
        const resto = (linhas[i] as string).slice(marca[0].length);
        dentro.push(resto.startsWith(' ') ? resto.slice(1) : resto);
        i += 1;
      }
      blocos.push({ t: 'citacao', f: lerBlocos(dentro, prof + 1) });
      continue;
    }

    const primeiro = podeAninhar ? ITEM.exec(linha) : null;
    if (primeiro) {
      const base = (primeiro[1] as string).length;
      const ordenada = /\d/.test((primeiro[2] as string)[0] as string);
      const itens: string[][] = [];
      let atual: string[] | null = null;
      let coluna = 0;
      let anteriorVazia = false;
      while (i < linhas.length) {
        const l = linhas[i] as string;
        if (ehVazia(l)) {
          // a sequência de linhas em branco é decidida de uma vez, pela linha que vem depois
          let proxima = i;
          while (proxima < linhas.length && ehVazia(linhas[proxima] as string)) proxima += 1;
          if (proxima >= linhas.length || !atual) break;
          const seguinte = linhas[proxima] as string;
          const marca = ITEM.exec(seguinte);
          const continua = recuoDa(seguinte) >= base + 2;
          const irmao = !ehRegua(seguinte) && marca !== null && /\d/.test((marca[2] as string)[0] as string) === ordenada;
          if (!continua && !irmao) break;
          if (continua) atual.push('');
          i = proxima;
          anteriorVazia = true;
          continue;
        }
        const recuo = recuoDa(l);
        if (atual && recuo >= base + 2) {
          atual.push(l.slice(Math.min(recuo, coluna)));
        } else {
          const marca = ehRegua(l) ? null : ITEM.exec(l);
          if (marca && /\d/.test((marca[2] as string)[0] as string) === ordenada) {
            coluna = (marca[1] as string).length + (marca[2] as string).length + 1;
            atual = [l.slice(marca[0].length)];
            itens.push(atual);
          } else if (atual && !anteriorVazia && !marca && !abreBloco(l)) {
            // continuação sem recuo do parágrafo do item
            atual.push(l.slice(recuo));
          } else break;
        }
        anteriorVazia = false;
        i += 1;
      }
      const numero = ordenada ? Number.parseInt(primeiro[2] as string, 10) : 1;
      const lista: Bloco = { t: 'lista', ordenada, itens: itens.map((item) => lerBlocos(item, prof + 1)) };
      if (ordenada && numero !== 1) lista.inicio = numero;
      blocos.push(lista);
      continue;
    }

    // parágrafo: sempre consome ao menos a linha atual
    const texto: string[] = [linha.trim()];
    i += 1;
    while (i < linhas.length && !ehVazia(linhas[i] as string) && !abreBloco(linhas[i] as string)) {
      texto.push((linhas[i] as string).trim());
      i += 1;
    }
    blocos.push({ t: 'paragrafo', f: lerTrechos(texto.join('\n'), 0, false) });
  }
  return blocos;
}

// Corta no teto sem partir um par substituto (um emoji, por exemplo, são duas unidades).
function cortarNoTeto(texto: string): string {
  if (texto.length <= TETO_DE_TEXTO) return texto;
  const ultimo = texto.charCodeAt(TETO_DE_TEXTO - 1);
  return texto.slice(0, ultimo >= 0xd800 && ultimo <= 0xdbff ? TETO_DE_TEXTO - 1 : TETO_DE_TEXTO);
}

// O último pedaço sem espaço de um texto que foi cortado: o que estiver nele pode estar pela
// metade. Só vale durante uma leitura (lerMarkdown é síncrona e o repõe ao sair).
let caudaCortada: string | null = null;

export function lerMarkdown(texto: string): Documento {
  // O teto vale para o texto já normalizado: a tabulação vira quatro espaços, e o que ela
  // faz crescer conta. O primeiro corte só limita o trabalho da normalização.
  const normalizado = cortarNoTeto(texto).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const base = cortarNoTeto(normalizado);
  const cortado = texto.length > TETO_DE_TEXTO || normalizado.length > TETO_DE_TEXTO;
  let ultimoEspaco = base.length - 1;
  while (ultimoEspaco >= 0 && base[ultimoEspaco] !== ' ' && base[ultimoEspaco] !== '\n') ultimoEspaco -= 1;
  const cauda = base.slice(ultimoEspaco + 1);
  caudaCortada = cortado && cauda ? cauda : null;
  try {
    return { blocos: lerBlocos(base.split('\n'), 0), cortado };
  } finally {
    caudaCortada = null;
  }
}
