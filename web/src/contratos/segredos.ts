// O que tem cara de segredo não passa da borda. O front não precisa de token, chave, senha
// nem credencial para nada: do segredo a tela só mostra a presença, que o motor manda como
// booleano (`tokenOk`, `temChave`, `hasCredential`). Se uma resposta ou o snapshot trouxer um
// segredo, por defeito do motor ou por alguém no caminho, ele sai aqui, antes de entrar no
// store, e não é devolvido, contado por nome nem registrado.
//
// Duas regras, e as duas erram para os dois lados se forem frouxas, por isso são estreitas:
// - por NOME do campo: só texto é descartado, e só quando o nome é um dos da tabela ou termina
//   num deles, palavra a palavra (`token`, `ghToken`, `anthropicApiKey`). Número e booleano
//   nunca são segredo: `inputTokens`, `tokenOk`, `hasCredential` passam. Nome que só contém o
//   pedaço não casa: `tokens`, `tokenizer`, `secretaria`, `chaveDoCard`, `projectKeys`;
// - por VALOR: os formatos conhecidos de credencial, em qualquer posição do texto. O texto
//   curto que traz um é descartado inteiro; no texto longo, que é o que a tela mostra para
//   ler (review, diagnóstico, erro do motor), só o trecho é trocado por "[segredo omitido]".
import { ehObjeto, ehTexto } from './formas';

// A tabela única dos nomes de campo que guardam segredo, cada um como a sequência de palavras
// em que o nome termina. O nome do campo é partido em palavras no camelCase, no sublinhado e
// no hífen.
export const NOMES_DE_SEGREDO: ReadonlyArray<readonly string[]> = [
  ['token'],
  ['secret'],
  ['segredo'],
  ['password'],
  ['passwd'],
  ['senha'],
  ['credential'],
  ['credencial'],
  ['authorization'],
  ['api', 'key'],
  ['apikey'],
  ['private', 'key'],
  ['access', 'key'],
  ['secret', 'key'],
  ['chave', 'de', 'api'],
];

function palavrasDe(nome: string): string[] {
  return nome.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean).map((p) => p.toLowerCase());
}

export function nomeDeSegredo(nome: string): boolean {
  const palavras = palavrasDe(nome);
  return NOMES_DE_SEGREDO.some((fim) => fim.length <= palavras.length && fim.every((p, i) => palavras[palavras.length - fim.length + i] === p));
}

export const SEGREDO_OMITIDO = '[segredo omitido]';

// Os formatos de credencial. Cada um diz o que do trecho casado é trocado: o trecho inteiro,
// ou só o grupo 1 (a parte secreta de um cabeçalho ou de um endereço).
const FORMATOS: ReadonlyArray<{ re: RegExp; soOGrupo?: true }> = [
  // bloco PEM de chave privada, até o fim do bloco quando ele existe
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?/g },
  // JWT: três partes em base64url, a primeira começando por `eyJ`
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // chave de acesso da AWS
  { re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // tokens do GitLab e do GitHub
  { re: /\bglpat-[A-Za-z0-9_-]{16,}/g },
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g },
  { re: /\bgithub_pat_[A-Za-z0-9_]{16,}/g },
  // chave da Anthropic, e a chave `sk-` de outros provedores: só no formato de chave (longa,
  // sem separador de palavra), para `sk-anthropic-1` não casar
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  // tokens do Slack e do Atlassian
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { re: /\bATATT[A-Za-z0-9_=-]{16,}/g },
  // cabeçalho Bearer ou Basic, em qualquer caixa, seguido de credencial (com dígito ou sinal
  // de base64, para "basic authentication" não casar)
  { re: /\b(?:bearer|basic)\s+((?=[A-Za-z0-9._~+/=-]*[0-9+/=])[A-Za-z0-9._~+/=-]{16,})/gi, soOGrupo: true },
  // endereço com usuário e senha antes do host
  { re: /\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#@:]+:[^\s/?#@]+)@/gi, soOGrupo: true },
];

// O texto com cada trecho em formato de credencial trocado por "[segredo omitido]".
export function mascararSegredos(texto: string): string {
  let saida = texto;
  for (const { re, soOGrupo } of FORMATOS) {
    saida = saida.replace(re, (trecho: string, grupo: unknown) => (soOGrupo && ehTexto(grupo) ? trecho.replace(grupo, SEGREDO_OMITIDO) : SEGREDO_OMITIDO));
  }
  return saida;
}

export function temFormatoDeSegredo(texto: string): boolean {
  return mascararSegredos(texto) !== texto;
}

// Até aqui o texto é um valor (um rótulo, um endereço, um id): com formato de credencial,
// sai inteiro. Acima disso é texto para ler, e só o trecho sai.
export const TETO_DO_TEXTO_CURTO = 200;

// O texto como pode entrar no store: o mesmo, o longo com os trechos trocados, ou `undefined`
// para o curto que traz credencial.
export function textoSemSegredo(texto: string): string | undefined {
  const mascarado = mascararSegredos(texto);
  if (mascarado === texto) return texto;
  return texto.length > TETO_DO_TEXTO_CURTO ? mascarado : undefined;
}

// Texto que a tela mostra, de um campo de forma desconhecida: o que não é texto, ou é texto
// curto com credencial, conta como ausente.
export function textoSeguro(valor: unknown): string | undefined {
  return ehTexto(valor) ? textoSemSegredo(valor) : undefined;
}

// Mensagem do motor que a tela mostra para ler (um erro, um motivo, um aviso, um review, o
// relatório de diagnóstico): nunca some inteira, qualquer que seja o tamanho. Só o trecho em
// formato de credencial é trocado.
export function mensagemSegura(valor: unknown): string | undefined {
  return ehTexto(valor) ? mascararSegredos(valor) : undefined;
}

const FUNDO_MAXIMO = 8;

// Uma cópia do valor sem o que tem cara de segredo, e quantas coisas saíram inteiras. Sai o
// campo de TEXTO cujo nome é de segredo, o texto curto com formato de credencial, e o que
// estiver fundo demais para ser conferido. O texto longo fica, com o trecho trocado (e não
// conta como descartado). Número, booleano e nulo passam sempre.
export function semSegredos(valor: unknown, fundo = 0): { limpo: unknown; descartados: number } {
  if (ehTexto(valor)) {
    const texto = textoSemSegredo(valor);
    return texto === undefined ? { limpo: undefined, descartados: 1 } : { limpo: texto, descartados: 0 };
  }
  if (Array.isArray(valor)) {
    if (fundo >= FUNDO_MAXIMO) return { limpo: [], descartados: valor.length ? 1 : 0 };
    const itens: unknown[] = [];
    let descartados = 0;
    for (const item of valor) {
      const lido = semSegredos(item, fundo + 1);
      descartados += lido.descartados;
      if (lido.limpo !== undefined || item === undefined) itens.push(lido.limpo);
    }
    return { limpo: itens, descartados };
  }
  if (!ehObjeto(valor)) return { limpo: valor, descartados: 0 };
  if (fundo >= FUNDO_MAXIMO) return { limpo: {}, descartados: Object.keys(valor).length ? 1 : 0 };
  const pares: Array<[string, unknown]> = [];
  let descartados = 0;
  for (const [nome, bruto] of Object.entries(valor)) {
    if (ehTexto(bruto) && nomeDeSegredo(nome)) {
      descartados += 1;
      continue;
    }
    const lido = semSegredos(bruto, fundo + 1);
    descartados += lido.descartados;
    if (lido.limpo !== undefined || bruto === undefined) pares.push([nome, lido.limpo]);
  }
  // fromEntries define propriedade própria: um campo "__proto__" não mexe no protótipo
  return { limpo: Object.fromEntries(pares), descartados };
}
