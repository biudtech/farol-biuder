// O que a tela Consumo lê do motor (os arquivos citados ficam na raiz do repositório):
// - a chave `usage` do snapshot (usageSummary, lib/engine/usage.js, pela projeção de
//   lib/engine/snapshot-usage.js): o teto por perfil, as sessões mais recentes e a auditoria
//   do registro inteiro;
// - GET /api/usage (lib/engine/usage-activity.js e lib/usage/report.js): o relatório de um
//   período, com as somas, a série por dia, as quebras e uma página do diário.
//
// Toda soma daqui é do motor. A tela não soma itens: mostra o que veio.
import {
  campo, ehBooleano, ehNumero, ehObjeto, ehTexto, lerItens, semAusentes, type Leitor, type LeitorDeItem,
} from './formas';

function ehQuantia(valor: unknown): valor is number {
  return ehNumero(valor) && valor >= 0;
}

function ehContagem(valor: unknown): valor is number {
  return ehQuantia(valor) && Number.isInteger(valor);
}

function ehTextoComConteudo(valor: unknown): valor is string {
  return ehTexto(valor) && valor !== '';
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function ehDia(valor: unknown): valor is string {
  return ehTexto(valor) && DIA.test(valor);
}

// ---------- a chave `usage` do snapshot ----------

// O teto de um perfil do Claude (linhaDeOrcamento, lib/engine/usage.js). Os valores são em
// dólar. `capHoje` é o teto que vale hoje (o base, o do dia da semana ou o de uma data), e
// `capOrigem` diz de onde ele veio: "data", "semana", "base" ou "nenhum". `today` é o gasto do
// dia do motor, e `sinceCutoff` o gasto desde `budgetSince` (ou de todo o registro, sem ele).
// `blocked` é a mesma conta do gate do motor, e `reason` diz qual teto: "diario", "total",
// "diario-previsto" ou "total-previsto" (a próxima revisão não cabe).
export interface TetoDoPerfil {
  id: string;
  label?: string;
  // "assinatura" ou "apikey"
  kind?: string;
  budgetTotal?: number;
  budgetSince?: string;
  capHoje?: number;
  capOrigem?: string;
  today?: number;
  sinceCutoff?: number;
  blocked?: boolean;
  reason?: string;
  // parte do gasto comparado com o teto é reserva de sessão com custo desconhecido
  parcialmenteEstimado?: boolean;
  // o custo típico de uma revisão, que o gate projeta antes de iniciar a próxima
  tipicoReview?: number;
}

const lerTeto: LeitorDeItem<TetoDoPerfil> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.id)) return undefined;
  return semAusentes({
    id: v.id,
    label: campo(v.label, ehTextoComConteudo),
    kind: campo(v.kind, ehTextoComConteudo),
    budgetTotal: campo(v.budgetTotal, ehQuantia),
    budgetSince: campo(v.budgetSince, ehDia),
    capHoje: campo(v.capHoje, ehQuantia),
    capOrigem: campo(v.capOrigem, ehTextoComConteudo),
    today: campo(v.today, ehQuantia),
    sinceCutoff: campo(v.sinceCutoff, ehQuantia),
    blocked: campo(v.blocked, ehBooleano),
    reason: campo(v.reason, ehTextoComConteudo),
    parcialmenteEstimado: campo(v.parcialmenteEstimado, ehBooleano),
    tipicoReview: campo(v.tipicoReview, ehQuantia),
  });
};

// Uma execução de IA, como a tela a mostra numa linha: é a forma comum da sessão recente do
// snapshot (sessaoParaTela, lib/engine/snapshot-usage.js) e da tentativa do diário
// (normalizeActivity, lib/usage/activity.js). Só a hora (`at`) é exigida.
export interface Execucao {
  at: number;
  // o dia em que o motor pôs a execução (AAAA-MM-DD): no diário, o dia de Brasília
  day?: string;
  // review, pushback, chat, tool ou outro (kindFromId, lib/engine/usage.js)
  kind?: string;
  // ok, erro, cancelada, interrompida, parcial ou descartada (lib/engine/usage-desfechos.js)
  status?: string;
  // a chave do PR (dono/repo#n) ou o rótulo do trabalho
  ref?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  // medido, estimado, desconhecido ou sem-base (o nome antigo de desconhecido)
  costSource?: string;
}

const lerExecucao: LeitorDeItem<Execucao> = (v) => {
  if (!ehObjeto(v) || !ehNumero(v.at) || v.at <= 0) return undefined;
  return semAusentes({
    at: v.at,
    day: campo(v.day, ehDia),
    kind: campo(v.kind, ehTextoComConteudo),
    status: campo(v.status, ehTextoComConteudo),
    ref: campo(v.ref, ehTextoComConteudo),
    model: campo(v.model, ehTextoComConteudo),
    inputTokens: campo(v.inputTokens, ehQuantia),
    outputTokens: campo(v.outputTokens, ehQuantia),
    cacheReadTokens: campo(v.cacheReadTokens, ehQuantia),
    cacheCreationTokens: campo(v.cacheCreationTokens, ehQuantia),
    costUsd: campo(v.costUsd, ehQuantia),
    costSource: campo(v.costSource, ehTextoComConteudo),
  });
};

// Um balde da auditoria: quantas sessões e quanto em dólar.
export interface ParteDaAuditoria {
  sessions: number;
  costUsd: number;
}

// A auditoria do registro inteiro de sessões (auditoriaDeConsumo,
// lib/engine/usage-desfechos.js): quanto virou resultado e quanto se perdeu, e quanto do custo
// foi informado pela sessão, calculado pelo motor ou ficou desconhecido.
export interface Auditoria {
  total: ParteDaAuditoria;
  util?: ParteDaAuditoria;
  perdido?: ParteDaAuditoria;
  medido?: ParteDaAuditoria;
  estimado?: ParteDaAuditoria;
  desconhecido?: ParteDaAuditoria;
}

function lerParte(v: unknown): ParteDaAuditoria | undefined {
  return ehObjeto(v) && ehContagem(v.sessions) && ehQuantia(v.costUsd) ? { sessions: v.sessions, costUsd: v.costUsd } : undefined;
}

function lerAuditoria(v: unknown): Auditoria | undefined {
  if (!ehObjeto(v)) return undefined;
  const total = lerParte(v.total);
  if (!total) return undefined;
  return semAusentes({
    total, util: lerParte(v.util), perdido: lerParte(v.perdido),
    medido: lerParte(v.medido), estimado: lerParte(v.estimado), desconhecido: lerParte(v.desconhecido),
  });
}

// O que a tela guarda da chave `usage`. As séries por dia que a chave também traz (`series`,
// `stackedSeries`, `matrixSeries`) não são guardadas: a tela lê o período em GET /api/usage,
// onde a soma é do motor.
export interface ConsumoDoSnapshot {
  // um por perfil do Claude configurado; ausente quando o motor não mandou a lista
  budgets?: TetoDoPerfil[];
  // as sessões mais recentes do registro (até 100), a mais nova primeiro
  recentSessions?: Execucao[];
  auditoria?: Auditoria;
  // a hora da primeira sessão do registro individual
  sessionsSince?: number;
  // quantas sessões o agregado do motor já contou: serve só para a tela perceber consumo novo
  sessoesContadas?: number;
  // Não vêm do motor: quantos itens de cada lista a tela não leu.
  budgetsDescartados?: number;
  sessoesDescartadas?: number;
}

export const lerConsumoDoSnapshot: Leitor<ConsumoDoSnapshot> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const tetos = lerItens(valor.budgets, lerTeto);
  const sessoes = lerItens(valor.recentSessions, lerExecucao);
  // só a contagem vai ao registro: nem perfil nem referência de PR
  if (tetos?.descartados) registrar(`snapshot: ${tetos.descartados} item(ns) de "usage.budgets" com forma inesperada, descartado(s)`);
  if (sessoes?.descartados) registrar(`snapshot: ${sessoes.descartados} item(ns) de "usage.recentSessions" com forma inesperada, descartado(s)`);
  return semAusentes({
    budgets: tetos?.itens,
    recentSessions: sessoes?.itens,
    auditoria: lerAuditoria(valor.auditoria),
    sessionsSince: campo(valor.sessionsSince, ehQuantia) || undefined,
    sessoesContadas: ehObjeto(valor.totals) ? campo(valor.totals.sessions, ehContagem) : undefined,
    budgetsDescartados: tetos?.descartados || undefined,
    sessoesDescartadas: sessoes?.descartados || undefined,
  });
};

// ---------- GET /api/usage ----------

// As somas de um recorte (zero(), lib/usage/report.js). `attempts` são as execuções (cada
// retentativa conta); `costUsd` soma o custo das que têm valor, e `unknownCost` conta as que
// não têm; `estimatedUsd` é a parte de `costUsd` que o motor calculou.
//
// A modalidade de cada execução entra em um de três lugares, e só em um: `subscription` conta
// as que rodaram por assinatura; as de chave de API não são contadas, só somadas em dólar
// (`apiUsd`, com `apiEstimatedUsd` calculado pelo motor e `apiUnknown` contando as de custo
// desconhecido); `unknownBilling` conta as que não têm modalidade registrada. Por isso
// `subscription` não é "as de assinatura entre todas": o resto pode ser sem registro.
export interface Soma {
  attempts?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  estimatedUsd?: number;
  unknownCost?: number;
  subscription?: number;
  unknownBilling?: number;
  apiUsd?: number;
  apiEstimatedUsd?: number;
  apiUnknown?: number;
}

export interface SomaComNome extends Soma {
  // o dia (AAAA-MM-DD) na série, o tipo na quebra por tipo
  name: string;
}

function lerSoma(v: Record<string, unknown>): Soma {
  return semAusentes({
    attempts: campo(v.attempts, ehContagem),
    inputTokens: campo(v.inputTokens, ehQuantia),
    outputTokens: campo(v.outputTokens, ehQuantia),
    cacheReadTokens: campo(v.cacheReadTokens, ehQuantia),
    cacheCreationTokens: campo(v.cacheCreationTokens, ehQuantia),
    costUsd: campo(v.costUsd, ehQuantia),
    estimatedUsd: campo(v.estimatedUsd, ehQuantia),
    unknownCost: campo(v.unknownCost, ehContagem),
    subscription: campo(v.subscription, ehContagem),
    unknownBilling: campo(v.unknownBilling, ehContagem),
    apiUsd: campo(v.apiUsd, ehQuantia),
    apiEstimatedUsd: campo(v.apiEstimatedUsd, ehQuantia),
    apiUnknown: campo(v.apiUnknown, ehContagem),
  });
}

const lerSomaComNome: LeitorDeItem<SomaComNome> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.name)) return undefined;
  return { name: v.name, ...lerSoma(v) };
};

// A quebra por modelo (aggregateModels): o motor soma execuções e tokens de entrada e de
// saída. Não manda custo nem cache por modelo.
export interface SomaDoModelo {
  name: string;
  attempts?: number;
  inputTokens?: number;
  outputTokens?: number;
}

const lerSomaDoModelo: LeitorDeItem<SomaDoModelo> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.name)) return undefined;
  return semAusentes({
    name: v.name, attempts: campo(v.attempts, ehContagem),
    inputTokens: campo(v.inputTokens, ehQuantia), outputTokens: campo(v.outputTokens, ehQuantia),
  });
};

// Uma operação do diário (groupActivity): os campos são os da tentativa mais recente, e
// `attempts` traz todas, da mais antiga à mais nova, inclusive as que ficaram fora do período
// ou do filtro (a operação entra na página quando ao menos uma tentativa passa). Só a chave é
// exigida.
export interface Operacao extends Partial<Execucao> {
  key: string;
  // a chave canônica do PR, quando o trabalho é de um PR
  pr?: string;
  attempts: Execucao[];
}

const lerOperacao: LeitorDeItem<Operacao> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.key)) return undefined;
  const ultima = lerExecucao(v) ?? {};
  return semAusentes({
    ...ultima,
    key: v.key,
    pr: campo(v.pr, ehTextoComConteudo),
    attempts: lerItens(v.attempts, lerExecucao)?.itens ?? [],
  });
};

// A página do diário (historyOf). `page` começa em zero, e o motor traz 8 operações por
// página; página além do fim volta como a última.
export interface PaginaDoDiario {
  total: number;
  page: number;
  pages: number;
  rows: Operacao[];
  // Não vem do motor: quantas operações da página a tela não leu.
  descartados: number;
}

function lerPaginaDoDiario(v: unknown): PaginaDoDiario | null {
  if (!ehObjeto(v) || !ehContagem(v.total) || !ehContagem(v.page) || !ehContagem(v.pages)) return null;
  const lido = lerItens(v.rows, lerOperacao);
  if (!lido) return null;
  return { total: v.total, page: v.page, pages: v.pages, rows: lido.itens, descartados: lido.descartados };
}

// O que o motor oferece em cada filtro (activityOptions): os valores que existem no registro.
export interface OpcoesDeFiltro {
  kind: string[];
  model: string[];
  repo: string[];
}

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(ehTextoComConteudo) : [];
}

// O relatório de um período (activityReport).
export interface Relatorio {
  // o período que o motor usou, com o dia definido por ele (o fuso de FUSO_DO_DIA,
  // lib/constants.js)
  range: { start: string; end: string };
  totals: Soma;
  // um por dia que teve execução; dia sem execução não vem
  series: SomaComNome[];
  // um por tipo, na ordem do motor, inclusive os zerados
  byKind: SomaComNome[];
  models: SomaDoModelo[];
  history: PaginaDoDiario;
  options: OpcoesDeFiltro;
  // operações concluídas no período: revisões, e PRs distintos entre elas
  completed?: { reviews: number; prs: number };
  retries?: number;
  // execuções sem identidade de operação: entram nas somas, não nas concluídas
  unidentified?: number;
  // o dia do primeiro registro do diário
  sinceDay?: string;
  // o diário tem menos sessões do que o agregado do motor contou
  incomplete?: boolean;
  // Não vem do motor: quantos itens de `series`, `byKind` e `models` a tela não leu.
  descartados: number;
}

// A resposta de GET /api/usage. A rota responde sempre 200: quando não entrega o relatório,
// manda `{ ok: false, motivo }`, com a frase do motor, sem código nem nome de campo.
export type RespostaDoConsumo =
  | { ok: true; relatorio: Relatorio }
  | { ok: false; motivo: string };

function lerConcluidas(v: unknown): { reviews: number; prs: number } | undefined {
  return ehObjeto(v) && ehContagem(v.reviews) && ehContagem(v.prs) ? { reviews: v.reviews, prs: v.prs } : undefined;
}

export function lerRespostaDoConsumo(bruto: unknown): RespostaDoConsumo | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.ok === false) return ehTextoComConteudo(bruto.motivo) ? { ok: false, motivo: bruto.motivo } : null;
  if (bruto.ok !== true) return null;
  if (!ehObjeto(bruto.range) || !ehDia(bruto.range.start) || !ehDia(bruto.range.end) || !ehObjeto(bruto.totals)) return null;
  const history = lerPaginaDoDiario(bruto.history);
  if (!history) return null;
  const series = lerItens(bruto.series, lerSomaComNome);
  const byKind = lerItens(bruto.byKind, lerSomaComNome);
  const models = lerItens(bruto.models, lerSomaDoModelo);
  const opcoes = ehObjeto(bruto.options) ? bruto.options : {};
  const relatorio: Relatorio = semAusentes({
    range: { start: bruto.range.start, end: bruto.range.end },
    totals: lerSoma(bruto.totals),
    series: series?.itens ?? [],
    byKind: byKind?.itens ?? [],
    models: models?.itens ?? [],
    history,
    options: { kind: textos(opcoes.kind), model: textos(opcoes.model), repo: textos(opcoes.repo) },
    completed: lerConcluidas(bruto.completed),
    retries: campo(bruto.retries, ehContagem),
    unidentified: campo(bruto.unidentified, ehContagem),
    sinceDay: campo(bruto.sinceDay, ehDia),
    incomplete: campo(bruto.incomplete, ehBooleano),
    descartados: (series?.descartados ?? 0) + (byKind?.descartados ?? 0) + (models?.descartados ?? 0),
  });
  return { ok: true, relatorio };
}
