// O store do front: um objeto, uma lista de assinantes. É o que useSyncExternalStore pede, e
// basta para o snapshot. Sem biblioteca de estado de propósito.

export interface Store<T extends object> {
  ler(): T;
  trocar(parte: Partial<T>): void;
  assinar(ouvinte: () => void): () => void;
}

export function criarStore<T extends object>(inicial: T): Store<T> {
  let estado = inicial;
  const ouvintes = new Set<() => void>();
  return {
    ler: () => estado,
    trocar(parte) {
      const chaves = Object.keys(parte) as Array<keyof T>;
      // troca que não muda nada mantém a referência: quem assina não redesenha à toa
      if (chaves.every((chave) => Object.is(estado[chave], parte[chave]))) return;
      estado = { ...estado, ...parte };
      for (const ouvinte of [...ouvintes]) ouvinte();
    },
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => { ouvintes.delete(ouvinte); };
    },
  };
}
