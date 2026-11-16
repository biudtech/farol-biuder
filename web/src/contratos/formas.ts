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

export function ehListaDeTextos(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every(ehTexto);
}
