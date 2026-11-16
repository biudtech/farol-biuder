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

// Campo opcional: ausente passa, presente tem de ter a forma.
export function opcional<T>(valor: unknown, guarda: Validador<T>): valor is T | undefined {
  return valor === undefined || guarda(valor);
}

export function deGuarda<T>(guarda: Validador<T>): Leitor<T> {
  return (valor) => (guarda(valor) ? valor : undefined);
}

// Lista do motor: o que não é lista é forma errada da chave; item de forma errada é
// descartado e contado no registro, e a lista segue com os outros.
export function lerLista<T>(nome: string, guarda: Validador<T>): Leitor<T[]> {
  return (valor, registrar) => {
    if (!Array.isArray(valor)) return undefined;
    const bons = valor.filter(guarda);
    if (bons.length !== valor.length) registrar(`snapshot: ${valor.length - bons.length} item(ns) de "${nome}" com forma inesperada, descartado(s)`);
    return bons;
  };
}

// Mapa do motor (chave do PR ou id da sessão para um valor): a mesma regra da lista, por
// entrada.
export function lerRegistro<T>(nome: string, guarda: Validador<T>): Leitor<Record<string, T>> {
  return (valor, registrar) => {
    if (!ehObjeto(valor)) return undefined;
    const entradas = Object.entries(valor);
    const boas = entradas.filter((entrada): entrada is [string, T] => guarda(entrada[1]));
    if (boas.length !== entradas.length) registrar(`snapshot: ${entradas.length - boas.length} entrada(s) de "${nome}" com forma inesperada, descartada(s)`);
    // fromEntries define propriedade própria: uma chave "__proto__" não mexe no protótipo
    return Object.fromEntries(boas);
  };
}
