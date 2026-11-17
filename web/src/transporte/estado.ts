// Como os dois eventos de estado do motor viram o snapshot do store (lib/http-server.js e
// lib/estado-delta.js, na raiz):
//
// - `state` traz o snapshot inteiro;
// - `state-patch` traz `{ campos, removidos }`: as chaves de topo que mudaram, com o valor
//   novo inteiro, e as que sumiram.
//
// A conferência é aqui, na borda: chave desconhecida é ignorada, e forma errada numa chave
// conhecida não derruba a tela, só é registrada e o valor anterior fica.
import { CHAVES_DO_SNAPSHOT, LEITORES, type ChaveDoSnapshot, type Snapshot } from '@/contratos/snapshot';
import { ehListaDeTextos, ehObjeto, ehTexto, type Objeto, type Registrar } from '@/contratos/formas';
import { TETO_DO_FEED, lerLinhaDoFeed, lerProgresso, type LinhaDoFeed, type SessaoAtiva } from '@/contratos/radar';

export type { Registrar };

type Rascunho = Partial<Record<ChaveDoSnapshot, unknown>>;

const CONHECIDAS: ReadonlySet<string> = new Set(CHAVES_DO_SNAPSHOT);

// Copia para o rascunho as chaves conhecidas de `campos` que o leitor da chave aceita, já
// sem os itens tortos. A que o leitor recusa fica como estava no rascunho. Devolve se algo mudou.
function mesclar(rascunho: Rascunho, campos: Objeto, registrar: Registrar): boolean {
  let mudou = false;
  for (const chave of CHAVES_DO_SNAPSHOT) {
    if (!Object.hasOwn(campos, chave)) continue;
    const valor = LEITORES[chave](campos[chave], registrar);
    if (valor === undefined) {
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

// O evento `activity` do motor: uma linha nova do feed de uma sessão, `{ id, item }`
// (pushActivity, lib/engine/session.js). O snapshot só traz o feed inteiro quando o estado é
// empurrado por outro motivo; entre um e outro, a linha chega por aqui. Ela entra no fim do
// feed daquela sessão, com o mesmo teto que o motor guarda, e o próximo `state` ou
// `state-patch` que trouxer `activity` substitui tudo.
export function aplicarAtividade(anterior: Snapshot | null, bruto: unknown, registrar: Registrar): Snapshot | null {
  if (!anterior) return anterior;
  const item = ehObjeto(bruto) ? lerLinhaDoFeed(bruto.item) : undefined;
  if (!ehObjeto(bruto) || !ehTexto(bruto.id) || !item) {
    registrar('snapshot: o evento activity chegou fora do formato e foi descartado');
    return anterior;
  }
  const { id } = bruto;
  const feeds: Array<[string, LinhaDoFeed[]]> = Object.entries(anterior.activity ?? {});
  const feed = feeds.find(([sessao]) => sessao === id)?.[1] ?? [];
  const novo = [...feed, item].slice(-TETO_DO_FEED);
  // fromEntries define propriedade própria: um id "__proto__" não mexe no protótipo
  const activity = Object.fromEntries([...feeds.filter(([sessao]) => sessao !== id), [id, novo]]);
  return { ...anterior, activity, ...comProgresso(anterior.activeSessions, id, lerProgresso(bruto.progresso)) };
}

// O progresso que veio com a linha (progressoDaSessao, lib/engine/progresso-revisao.js) troca o da
// sessão dela; os arquivos lidos não publicam estado, e sem isto a barra esperaria o próximo
// `state-patch`. Ausente ou torto, as sessões ficam como estavam.
function comProgresso(sessoes: SessaoAtiva[] | undefined, id: string, progresso: SessaoAtiva['progresso']): { activeSessions?: SessaoAtiva[] } {
  if (!progresso || !sessoes?.some((s) => s.id === id)) return {};
  return { activeSessions: sessoes.map((s) => (s.id === id ? { ...s, progresso } : s)) };
}
