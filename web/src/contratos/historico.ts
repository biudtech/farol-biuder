// O que a tela Histórico lê do motor (os arquivos citados ficam na raiz do repositório):
// - GET /api/decisions: uma página do histórico (lib/engine/historico-paginado.js);
// - GET /api/decision?key=: a revisão mais recente de um PR (lib/http-server.js);
// - a chave `pushbacks` do snapshot: a contestação registrada por PR (lib/engine/pushback.js).
//
// O item das duas rotas sai pela mesma projeção das pendências (decisionForUi,
// lib/engine/public-review.js) e é lido do mesmo jeito: só `id` e `key` são exigidos, e todo
// outro campo de forma errada conta como ausente.
import {
  campo, ehBooleano, ehNumero, ehObjeto, ehTexto, lerItens, lerRegistro, semAusentes, type LeitorDeItem,
} from './formas';
import { lerCard, lerMotivos, lerPrDaPendencia, lerTecnica, type Motivo, type PrDaPendencia } from './radar';

// O resumo da comparação entre rodadas (roundSummary, lib/engine/review-projection.js).
export interface Rodadas {
  id?: string;
  ordinal?: number;
  // "enforce" quando a comparação barra a publicação; outro valor é observação
  mode?: string;
  parentCount?: number;
  lateCount?: number;
  droppedCount?: number;
  resolvedOnUnchangedCount?: number;
  unresolvedCount?: number;
  unverified?: boolean;
  changedContext?: boolean;
}

// O tempo de cada etapa da sessão (item.stages em decisionForUi).
export interface Etapa {
  id: string;
  label: string;
  ms: number;
}

export interface Etapas {
  totalMs: number;
  stages: Etapa[];
}

// A conferência das afirmações da revisão (checkpointForUi).
export interface Conferencia {
  total: number;
  confirmedCount: number;
  conflictCount: number;
}

// Uma revisão do histórico. `status` e `action` são os valores que o motor grava ao resolver
// (a tabela de rótulos está em src/historico/rotulos.ts); a revisão que ainda espera na mesa,
// que só chega por GET /api/decision, vem sem `resolvedAt`.
export interface Revisao {
  id: string;
  key: string;
  createdAt?: number;
  resolvedAt?: number;
  // como a revisão foi resolvida
  status?: string;
  // o que foi publicado no PR: approve, request_changes, comment ou skip
  action?: string;
  // o parecer da sessão: approve ou request_changes
  verdict?: string;
  card?: string;
  pr?: PrDaPendencia;
  prProprio?: true;
  viaAdmin?: true;
  blockedReason?: string;
  technical?: { state?: string; message: string };
  rounds?: Rodadas;
  stages?: Etapas;
  verificationCheckpoint?: Conferencia;
  // o texto do review do parecer, em markdown (reviewMarkdownForUi)
  reportMarkdown: string;
  reasons: Motivo[];
  attention: Motivo[];
}

function lerRodadas(v: unknown): Rodadas | undefined {
  if (!ehObjeto(v) || v.schema !== 1) return undefined;
  return semAusentes({
    id: campo(v.id, ehTexto), ordinal: campo(v.ordinal, ehNumero), mode: campo(v.mode, ehTexto),
    parentCount: campo(v.parentCount, ehNumero), lateCount: campo(v.lateCount, ehNumero), droppedCount: campo(v.droppedCount, ehNumero),
    resolvedOnUnchangedCount: campo(v.resolvedOnUnchangedCount, ehNumero), unresolvedCount: campo(v.unresolvedCount, ehNumero),
    unverified: campo(v.unverified, ehBooleano), changedContext: campo(v.changedContext, ehBooleano),
  });
}

function lerEtapas(v: unknown): Etapas | undefined {
  if (!ehObjeto(v)) return undefined;
  const stages: Etapa[] = [];
  for (const e of Array.isArray(v.stages) ? v.stages : []) {
    if (ehObjeto(e) && ehNumero(e.ms)) stages.push({ id: campo(e.id, ehTexto) ?? '', label: campo(e.label, ehTexto) ?? '', ms: e.ms });
  }
  const totalMs = campo(v.totalMs, ehNumero) ?? 0;
  return totalMs > 0 || stages.length ? { totalMs, stages } : undefined;
}

function lerConferencia(v: unknown): Conferencia | undefined {
  if (!ehObjeto(v) || !ehNumero(v.total)) return undefined;
  return { total: v.total, confirmedCount: campo(v.confirmedCount, ehNumero) ?? 0, conflictCount: campo(v.conflictCount, ehNumero) ?? 0 };
}

export const lerRevisao: LeitorDeItem<Revisao> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id) || !v.id || !ehTexto(v.key) || !v.key) return undefined;
  return semAusentes({
    id: v.id,
    key: v.key,
    createdAt: campo(v.createdAt, ehNumero),
    resolvedAt: campo(v.resolvedAt, ehNumero),
    status: campo(v.status, ehTexto) || undefined,
    action: campo(v.action, ehTexto) || undefined,
    verdict: campo(v.verdict, ehTexto) || undefined,
    card: lerCard(v.card),
    pr: lerPrDaPendencia(v.pr),
    prProprio: v.prProprio === true ? (true as const) : undefined,
    viaAdmin: v.viaAdmin === true ? (true as const) : undefined,
    blockedReason: campo(v.blockedReason, ehTexto) || undefined,
    technical: lerTecnica(v.technical),
    rounds: lerRodadas(v.rounds),
    stages: lerEtapas(v.stages),
    verificationCheckpoint: lerConferencia(v.verificationCheckpoint),
    reportMarkdown: campo(v.reportMarkdown, ehTexto) ?? '',
    reasons: lerMotivos(v.reasons),
    attention: lerMotivos(v.attention),
  });
};

// A resposta 200 de GET /api/decisions.
export interface PaginaDoHistorico {
  page: number;
  pageSize: number;
  // quantas revisões passaram nos filtros, e em quantas páginas
  total: number;
  pages: number;
  items: Revisao[];
  // os repositórios de todo o histórico, para o seletor
  repos: string[];
  // Não vem do motor: quantos itens da página chegaram sem id ou sem chave e foram
  // descartados aqui. A tela avisa, para a página não parecer menor do que é.
  descartados: number;
}

function ehContagem(valor: unknown): valor is number {
  return ehNumero(valor) && Number.isInteger(valor) && valor >= 0;
}

export function lerPaginaDoHistorico(bruto: unknown): PaginaDoHistorico | null {
  if (!ehObjeto(bruto) || bruto.ok !== true) return null;
  if (!ehContagem(bruto.page) || !ehContagem(bruto.pageSize) || !ehContagem(bruto.total) || !ehContagem(bruto.pages)) return null;
  const lido = lerItens(bruto.items, lerRevisao);
  if (!lido) return null;
  const repos = Array.isArray(bruto.repos) ? bruto.repos.filter((r): r is string => ehTexto(r) && r.length > 0) : [];
  return { page: bruto.page, pageSize: bruto.pageSize, total: bruto.total, pages: bruto.pages, items: lido.itens, repos, descartados: lido.descartados };
}

// A resposta de GET /api/decision?key=: o envelope `{ found, decision }`. A rota devolve a
// pendência do PR quando há uma e, sem ela, a revisão resolvida mais recente.
export type DetalheDaRevisao =
  | { encontrada: true; revisao: Revisao }
  | { encontrada: false };

export function lerDetalheDaRevisao(bruto: unknown): DetalheDaRevisao | null {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.found)) return null;
  if (!bruto.found) return { encontrada: false };
  const revisao = lerRevisao(bruto.decision);
  return revisao ? { encontrada: true, revisao } : null;
}

// `pushbacks`: a contestação registrada de cada PR, por chave (server.js e
// lib/engine/pushback.js). `outcome` é um dos PUSHBACK_OUTCOMES (lib/taxonomy.js); `status`
// "pending" é a suspeita do motor que espera confirmação, e "confirmed" o que já vale;
// `source` diz se veio do motor ("auto") ou de alguém ("manual").
export interface Contestacao {
  outcome: string;
  status?: string;
  note?: string;
  author?: string;
  source?: string;
  at?: number;
}

const lerContestacao: LeitorDeItem<Contestacao> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.outcome) || !v.outcome) return undefined;
  return semAusentes({
    outcome: v.outcome, status: campo(v.status, ehTexto), note: campo(v.note, ehTexto) || undefined,
    author: campo(v.author, ehTexto) || undefined, source: campo(v.source, ehTexto), at: campo(v.at, ehNumero),
  });
};

export const lerContestacoes = lerRegistro('pushbacks', lerContestacao);
