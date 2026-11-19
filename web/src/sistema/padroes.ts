// Os padrões do time, sem React: o texto que o time combinou e quer que o revisor considere em
// todo PR (lib/engine/padroes-do-time.js, na raiz). Mora na conta (`padroesRevisao`) e muda pela
// mesma operação dos outros campos dela (`POST /api/accounts/edit`, `tipo: "editar"`). Texto
// vazio tira o campo. O motor grava até TETO_GRAVADO caracteres, sem espaço nas pontas, e põe
// no prompt só os primeiros TETO_NO_PROMPT: o resto é cortado com aviso, nunca descartado.

// Cópias conferidas por teste contra o motor (TETO_PADROES_GRAVADO, lib/parse.js, e
// TETO_NO_PROMPT, lib/engine/padroes-do-time.js).
export const TETO_GRAVADO = 20000;
export const TETO_NO_PROMPT = 6000;

const numero = (n: number): string => n.toLocaleString('pt-BR');

// Como o motor grava o texto.
export function padroesComoGravados(texto: string): string {
  return texto.trim().slice(0, TETO_GRAVADO);
}

// A marca do rascunho: dois textos que o motor gravaria igual são o mesmo.
export function marcaDosPadroes(texto: string): string {
  return padroesComoGravados(texto);
}

// O contador abaixo do campo.
export function contagemDosPadroes(texto: string): string {
  const tamanho = padroesComoGravados(texto).length;
  if (tamanho > TETO_NO_PROMPT) return `${numero(tamanho)} caracteres: só os primeiros ${numero(TETO_NO_PROMPT)} entram na revisão, e o resto fica gravado sem uso.`;
  return `${numero(tamanho)} de ${numero(TETO_NO_PROMPT)} caracteres que entram na revisão.`;
}

// Quantos padrões há: uma linha não vazia, um padrão.
export function quantosPadroes(texto: string | undefined): number {
  return (texto ?? '').split(/\r?\n/).filter((linha) => linha.trim()).length;
}

export function resumoDosPadroes(texto: string | undefined): string {
  const n = quantosPadroes(texto);
  if (!n) return 'Nenhum padrão';
  return n === 1 ? '1 padrão' : `${n} padrões`;
}

// O que o salvar diz depois do aceite: tirar, ou gravar com tanto de texto.
export function textoDosPadroes(texto: string): string {
  const gravado = padroesComoGravados(texto);
  if (!gravado) return 'os padrões do time foram tirados: a revisão segue sem eles';
  return `os padrões do time agora têm ${resumoDosPadroes(gravado).toLowerCase()} (${numero(gravado.length)} caracteres)`;
}
