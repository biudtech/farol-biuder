// Os tijolos dos validadores de borda. Tudo o que chega do motor entra como `unknown` e só
// vira tipo depois de conferido por uma destas funções.

export type Objeto = Record<string, unknown>;

export function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export function ehTexto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

export function ehBooleano(valor: unknown): valor is boolean {
  return typeof valor === 'boolean';
}

export function ehNumero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

export function ehListaDeTextos(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every(ehTexto);
}

export type Validador<T> = (valor: unknown) => valor is T;

// O registro da borda: recebe só o nome da chave e a contagem, nunca o dado.
export type Registrar = (aviso: string) => void;

// Lê o valor de uma chave do snapshot. `undefined` quer dizer forma errada: quem chama mantém
// o valor anterior. Qualquer outro retorno (inclusive null) é o valor conferido.
export type Leitor<T> = (valor: unknown, registrar: Registrar) => T | undefined;

// Lê um item de lista ou de mapa. Devolve o item montado só com os campos conferidos, ou
// `undefined` quando falta o que identifica o item (aí ele é descartado).
export type LeitorDeItem<T> = (valor: unknown) => T | undefined;

export function deGuarda<T>(guarda: Validador<T>): Leitor<T> {
  return (valor) => (guarda(valor) ? valor : undefined);
}

// Campo opcional de um item: o que não tem a forma (inclusive null) conta como ausente. O
// item segue sem o campo, em vez de ser descartado por causa dele.
export function campo<T>(valor: unknown, guarda: Validador<T>): T | undefined {
  return guarda(valor) ? valor : undefined;
}

// Tira as propriedades sem valor, para o item não carregar chave com `undefined`.
export function semAusentes<T extends object>(item: T): T {
  return Object.fromEntries(Object.entries(item).filter(([, valor]) => valor !== undefined)) as T;
}

// Os itens de uma lista do motor, e quantos foram descartados. `undefined` quando o valor
// não é lista.
export function lerItens<T>(valor: unknown, ler: LeitorDeItem<T>): { itens: T[]; descartados: number } | undefined {
  if (!Array.isArray(valor)) return undefined;
  const itens: T[] = [];
  for (const bruto of valor) {
    const item = ler(bruto);
    if (item !== undefined) itens.push(item);
  }
  return { itens, descartados: valor.length - itens.length };
}

// Lista do motor: o que não é lista é forma errada da chave; item que não dá para ler é
// descartado e contado no registro, e a lista segue com os outros.
export function lerLista<T>(nome: string, ler: LeitorDeItem<T>): Leitor<T[]> {
  return (valor, registrar) => {
    const lido = lerItens(valor, ler);
    if (!lido) return undefined;
    if (lido.descartados) registrar(`snapshot: ${lido.descartados} item(ns) de "${nome}" com forma inesperada, descartado(s)`);
    return lido.itens;
  };
}

// Mapa do motor (chave do PR ou id da sessão para um valor): a mesma regra da lista, por
// entrada.
export function lerRegistro<T>(nome: string, ler: LeitorDeItem<T>): Leitor<Record<string, T>> {
  return (valor, registrar) => {
    if (!ehObjeto(valor)) return undefined;
    const entradas = Object.entries(valor);
    const boas: Array<[string, T]> = [];
    for (const [chave, bruto] of entradas) {
      const item = ler(bruto);
      if (item !== undefined) boas.push([chave, item]);
    }
    if (boas.length !== entradas.length) registrar(`snapshot: ${entradas.length - boas.length} entrada(s) de "${nome}" com forma inesperada, descartada(s)`);
    // fromEntries define propriedade própria: uma chave "__proto__" não mexe no protótipo
    return Object.fromEntries(boas);
  };
}

// Um item que é o próprio valor (um booleano, um objeto qualquer): passa ou é descartado.
export function itemDe<T>(guarda: Validador<T>): LeitorDeItem<T> {
  return (valor) => (guarda(valor) ? valor : undefined);
}
