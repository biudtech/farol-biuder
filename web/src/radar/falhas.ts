// A sessão que some sem resultado. O motor não manda "falhou": a sessão sai de `activeSessions`
// e, quando deu certo, a decisão dela aparece em `decisions` (resolvida ou guardada). Sem
// decisão do PR depois do começo da sessão, sem cancelamento e sem a sessão de volta, a tela diz
// que ela terminou sem resultado, com o motivo quando o motor deixou um (a parada do PR, de
// `parked`, ou a última linha de aviso do feed). Sem React.
import { lerRevisao } from '@/contratos/historico';
import type { Estacionado, LinhaDoFeed, Pendencia, SessaoAtiva } from '@/contratos/radar';
import { etapaDoProgresso } from './cartao';

// A decisão é gravada no fim do desfecho e pode chegar num estado depois do que tirou a sessão:
// antes disto a sessão que sumiu ainda não conta como falha.
export const CARENCIA_MS = 3000;

// Nenhuma notificação eterna (regra do dono de 20/11/2026): a falha some sozinha, sem botão de
// dispensar. Sai antes quando chega sessão ou decisão nova do PR (falhaSuperada); senão, depois
// deste tempo na tela.
export const VALIDADE_DA_FALHA_MS = 60000;

export interface SessaoVista {
  id: string;
  chave: string;
  url?: string;
  titulo?: string;
  autor?: string;
  inicio?: number;
  etapa: number;
  cancelada: boolean;
  // a última linha de aviso do feed dela
  aviso?: string;
}

export interface Falha extends SessaoVista {
  // na hora do navegador (a carência conta nela)
  sumiuEm: number;
  // a mesma hora no relógio do motor, para medir a duração contra o começo da sessão
  fimNoMotor: number;
}

export function vistaDa(s: SessaoAtiva, feed: readonly LinhaDoFeed[] | undefined, etapaMinima = 0): SessaoVista | null {
  const chave = s.pr?.key ?? s.keys?.[0];
  if (!chave) return null;
  const aviso = [...(feed ?? [])].reverse().find((l) => l.k === 'warn')?.text;
  return {
    id: s.id, chave, url: s.pr?.url, titulo: s.pr?.title, autor: s.pr?.author, inicio: s.startedAt,
    etapa: Math.max(etapaMinima, etapaDoProgresso(s.progresso)), cancelada: s.cancelled === true, aviso,
  };
}

// As vistas de antes que não estão mais entre as sessões de agora, sem as canceladas.
export function sumidas(antes: readonly SessaoVista[], agora: readonly SessaoAtiva[], sumiuEm: number, desvio = 0): Falha[] {
  const ids = new Set(agora.map((s) => s.id));
  return antes.filter((v) => !ids.has(v.id) && !v.cancelada).map((v) => ({ ...v, sumiuEm, fimNoMotor: sumiuEm - desvio }));
}

function depoisDoInicio(instante: number | undefined, inicio: number | undefined): boolean {
  return typeof instante === 'number' && (inicio === undefined || instante >= inicio);
}

// A falha deixa de valer quando o PR volta a ter sessão ou ganha decisão depois do começo dela.
export function falhaSuperada(f: Falha, o: { sessoes: readonly SessaoAtiva[]; pendentes: readonly Pendencia[]; resolvidas: readonly unknown[] }): boolean {
  if (o.sessoes.some((s) => (s.pr?.key ?? s.keys?.[0]) === f.chave)) return true;
  if (o.pendentes.some((p) => p.key === f.chave && depoisDoInicio(p.createdAt, f.inicio))) return true;
  return o.resolvidas.some((bruto) => {
    const r = lerRevisao(bruto);
    return r?.key === f.chave && depoisDoInicio(r.resolvedAt ?? r.createdAt, f.inicio);
  });
}

// O motivo: a parada do PR gravada depois do começo da sessão, senão o último aviso do feed.
export function motivoDaFalha(f: SessaoVista, parada: Estacionado | undefined): string {
  const em = parada?.at ? Date.parse(parada.at) : Number.NaN;
  if (parada?.motivo.trim() && Number.isFinite(em) && depoisDoInicio(em, f.inicio)) return parada.motivo.trim();
  return f.aviso?.trim() ?? '';
}

export function visivel(f: Falha, agora: number): boolean {
  return agora - f.sumiuEm >= CARENCIA_MS && !expirada(f, agora);
}

// A falha que ficou na tela pelo tempo inteiro sai sozinha.
export function expirada(f: Falha, agora: number): boolean {
  return agora - f.sumiuEm >= CARENCIA_MS + VALIDADE_DA_FALHA_MS;
}
