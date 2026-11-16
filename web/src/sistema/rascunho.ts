// O rascunho refeito, sem React: como refazer a edição de alguém sobre o valor novo do
// motor sem reverter o que outra pessoa mudou (useRascunho, src/componentes/sistema).

export interface Refeito<T> {
  valor: T;
  // os campos que a pessoa e o motor mudaram, cada um para um valor diferente
  conflitos: readonly string[];
}

// Como refazer um rascunho de campos soltos: o campo que a pessoa não tocou (igual à partida)
// pega o valor novo do motor; o que ela tocou fica, e entra em `conflitos` se o motor também
// o mudou, para outro valor.
export function refazerCampos<T extends object>(partida: T, rascunho: T, nova: T, igual: (a: unknown, b: unknown) => boolean = Object.is): Refeito<T> {
  const valor = { ...nova };
  const conflitos: string[] = [];
  for (const campo of Object.keys(rascunho) as Array<keyof T & string>) {
    if (igual(rascunho[campo], partida[campo])) continue;
    valor[campo] = rascunho[campo];
    if (!igual(nova[campo], partida[campo]) && !igual(nova[campo], rascunho[campo])) conflitos.push(campo);
  }
  return { valor, conflitos };
}
