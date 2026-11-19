// "De fora da fila" e a retentativa por PR: as duas chaves do snapshot que o motor monta em
// lib/engine/de-fora.js (redesenho de 19/11/2026, lote 1) e que o Radar lê.
//
// `deFora` é projeção do que o motor já decide: os PRs pedidos à conta que ele não vai revisar
// sozinho, cada um com o motivo. A tela só tira estes PRs da Fila e da contagem
// (fatiarFila, src/radar/fatias.ts) e escreve o motivo em frase (src/radar/de-fora.ts).
//
// Cada item é lido campo a campo: a chave e o motivo identificam o item, e sem eles (ou com um
// motivo que este front não conhece) o item é descartado com registro. Todo o resto é opcional,
// e o detalhe é montado por motivo, só com os campos que o motor documenta.
import {
  campo, ehNumero, ehObjeto, ehTexto, lerLista, lerRegistro, semAusentes, type LeitorDeItem,
} from './formas';
import { mascararSegredos } from './segredos';

// Os motivos, na ordem de precedência do motor (motivoDoPr, lib/engine/de-fora.js).
export const MOTIVOS_DE_FORA = [
  'estacionado', 'outra_conta', 'decisao_de_gente', 'pedido_retirado', 'regra_manual', 'auto_desligado', 'ignorado',
] as const;
export type MotivoDeFora = (typeof MOTIVOS_DE_FORA)[number];

function ehMotivo(valor: unknown): valor is MotivoDeFora {
  return ehTexto(valor) && (MOTIVOS_DE_FORA as readonly string[]).includes(valor);
}

// Quem aprovou ou pediu mudanças no head, com o estado do GitHub (APPROVED, CHANGES_REQUESTED) e
// o `submitted_at` do review, em ISO.
export interface Decisivo {
  quem: string;
  estado?: string;
  em?: string;
}

// O detalhe de cada motivo (deForaParaTela): o que não se aplica ao motivo fica ausente.
export interface DetalheDeFora {
  // estacionado: o tipo da parada (parkedParaUi) e a mensagem, cortada pelo motor
  tipo?: string;
  motivo?: string;
  // outra_conta: `saida_de_cena` (o comentário durável de outra conta) ou `label`
  fonte?: string;
  // decisao_de_gente
  decisivos?: Decisivo[];
  // regra_manual: a origem da regra (politicaDeInicio, lib/engine/review-scope.js)
  source?: string;
  organization?: string;
  author?: string;
}

export interface PrDeFora {
  key: string;
  motivo: MotivoDeFora;
  url?: string;
  title?: string;
  author?: string;
  repo?: string;
  number?: number;
  detalhe: DetalheDeFora;
  // epoch em ms; ausente quando o motor manda null
  desde?: number;
  head?: string;
  // outra_conta e decisao_de_gente: os logins de quem segura
  quem?: string[];
}

const texto = (v: unknown): string | undefined => (ehTexto(v) && v ? v : undefined);
const instante = (v: unknown): number | undefined => (ehNumero(v) && v > 0 ? v : undefined);

function lerDecisivos(v: unknown): Decisivo[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const lidos: Decisivo[] = [];
  for (const d of v) {
    if (!ehObjeto(d) || !texto(d.quem)) continue;
    lidos.push(semAusentes({ quem: d.quem as string, estado: texto(d.estado), em: texto(d.em) }));
  }
  return lidos;
}

function lerDetalhe(motivo: MotivoDeFora, v: unknown): DetalheDeFora {
  if (!ehObjeto(v)) return {};
  switch (motivo) {
    // a mensagem da parada é erro do motor, que pode carregar stderr: a máscara passa por ela
    case 'estacionado': return semAusentes({ tipo: texto(v.tipo), motivo: texto(v.motivo) && mascararSegredos(v.motivo as string) });
    case 'outra_conta': return semAusentes({ fonte: texto(v.fonte) });
    case 'decisao_de_gente': return semAusentes({ decisivos: lerDecisivos(v.decisivos) });
    case 'regra_manual': return semAusentes({ source: texto(v.source), organization: texto(v.organization), author: texto(v.author) });
    default: return {};
  }
}

const lerPrDeFora: LeitorDeItem<PrDeFora> = (v) => {
  if (!ehObjeto(v) || !texto(v.key) || !ehMotivo(v.motivo)) return undefined;
  const quem = Array.isArray(v.quem) ? v.quem.filter((q): q is string => Boolean(texto(q))) : undefined;
  return semAusentes({
    key: v.key as string,
    motivo: v.motivo,
    url: texto(v.url),
    title: texto(v.title),
    author: texto(v.author),
    repo: texto(v.repo),
    number: campo(v.number, (n: unknown): n is number => ehNumero(n) && n > 0),
    detalhe: lerDetalhe(v.motivo, v.detalhe),
    desde: instante(v.desde),
    head: texto(v.head),
    quem: quem?.length ? quem : undefined,
  });
};

export const lerDeFora = lerLista('deFora', lerPrDeFora);

// A retentativa automática por PR (engine.retryAfterNet): quantas tentativas e a hora a partir
// da qual a próxima roda (o reset do limite do plano), ou null quando já pode.
export interface Retentativa {
  tentativas: number;
  aPartirDe: number | null;
}

const lerRetentativa: LeitorDeItem<Retentativa> = (v) => (
  ehObjeto(v)
    ? { tentativas: ehNumero(v.tentativas) && v.tentativas >= 0 ? Math.floor(v.tentativas) : 0, aPartirDe: instante(v.aPartirDe) ?? null }
    : undefined
);

export const lerEmRetentativa = lerRegistro('emRetentativa', lerRetentativa);
