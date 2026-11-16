// Como os dois eventos de estado do motor viram o snapshot do store (lib/http-server.js e
// lib/estado-delta.js, na raiz):
//
// - `state` traz o snapshot inteiro;
// - `state-patch` traz `{ campos, removidos }`: as chaves de topo que mudaram, com o valor
//   novo inteiro, e as que sumiram.
//
// A conferência é aqui, na borda: chave desconhecida é ignorada, e forma errada numa chave
// conhecida não derruba a tela, só é registrada e o valor anterior fica.
import { CHAVES_DO_SNAPSHOT, VALIDADORES, type ChaveDoSnapshot, type Snapshot } from '@/contratos/snapshot';
import { ehListaDeTextos, ehObjeto, type Objeto } from '@/contratos/formas';

export type Registrar = (aviso: string) => void;

type Rascunho = Partial<Record<ChaveDoSnapshot, unknown>>;

const CONHECIDAS: ReadonlySet<string> = new Set(CHAVES_DO_SNAPSHOT);

// Copia para o rascunho as chaves conhecidas de `campos` que passam no validador. A que não
// passa fica como estava no rascunho. Devolve se algo mudou.
function mesclar(rascunho: Rascunho, campos: Objeto, registrar: Registrar): boolean {
  let mudou = false;
  for (const chave of CHAVES_DO_SNAPSHOT) {
    if (!Object.hasOwn(campos, chave)) continue;
    const valor = campos[chave];
    if (!VALIDADORES[chave](valor)) {
      registrar(`snapshot: a chave "${chave}" chegou com forma inesperada e foi mantida como estava`);
      continue;
    }
    rascunho[chave] = valor;
    mudou = true;
  }
  return mudou;
}

export function aplicarEstadoInteiro(anterior: Snapshot | null, bruto: unknown, registrar: Registrar): Snapshot | null {
  if (!ehObjeto(bruto)) {
    registrar('snapshot: o evento state não trouxe um objeto e foi descartado');
    return anterior;
  }
  // Parte só das chaves que vieram: a que o motor deixou de mandar some. A que veio torta
  // começa com o valor anterior, quando havia.
  const rascunho: Rascunho = {};
  for (const chave of CHAVES_DO_SNAPSHOT) {
    if (Object.hasOwn(bruto, chave) && anterior && Object.hasOwn(anterior, chave)) rascunho[chave] = anterior[chave];
  }
  mesclar(rascunho, bruto, registrar);
  return rascunho as Snapshot;
}

export function aplicarPatch(anterior: Snapshot | null, bruto: unknown, registrar: Registrar): Snapshot | null {
  if (!ehObjeto(bruto) || !ehObjeto(bruto.campos) || !ehListaDeTextos(bruto.removidos)) {
    registrar('snapshot: o evento state-patch chegou fora do formato e foi descartado');
    return anterior;
  }
  if (!anterior) {
    registrar('snapshot: state-patch sem estado para mesclar, descartado');
    return null;
  }
  const rascunho: Rascunho = { ...anterior };
  let mudou = mesclar(rascunho, bruto.campos, registrar);
  for (const chave of bruto.removidos) {
    if (!CONHECIDAS.has(chave) || !Object.hasOwn(rascunho, chave)) continue;
    delete rascunho[chave as ChaveDoSnapshot];
    mudou = true;
  }
  return mudou ? (rascunho as Snapshot) : anterior;
}
