// O que a tela Consumo lê do motor (os arquivos citados ficam na raiz do repositório):
// - a chave `usage` do snapshot (usageSummary, lib/engine/usage.js, pela projeção de
//   lib/engine/snapshot-usage.js): as sessões mais recentes e a auditoria do registro
//   inteiro. O motor não tem teto de gasto (saiu em 16/11/2026): a chave não traz teto nem
//   bloqueio, e a lista de teto por perfil que um motor antigo ainda mande não é lida;
// - GET /api/usage (lib/engine/usage-activity.js e lib/usage/report.js): o relatório de um
//   período, com as somas, a série por dia, as quebras, uma página do diário e as revisões que
//   terminaram sem publicar (`ocorrencias`).
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
  // o perfil do Claude da sessão (`profile` no diário, `profileId` no snapshot)
  profile?: string;
  // por que a sessão rodou: primeira, commit_novo, rodada_extra ou contestacao
  // (lib/engine/gatilho-da-sessao.js); conversa e ferramenta vêm sem ele
  gatilho?: string;
  // o autor do PR, sem caixa, que o motor leu das decisões pelo `ref`
  author?: string;
  // quanto a sessão durou, só quando o motor sabe a hora de início (`durationKnown`)
  duracaoMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
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
    profile: campo(v.profile, ehTextoComConteudo) ?? campo(v.profileId, ehTextoComConteudo),
    gatilho: campo(v.gatilho, ehTextoComConteudo),
    author: campo(v.author, ehTextoComConteudo),
    duracaoMs: v.durationKnown === true ? campo(v.duration, ehQuantia) : undefined,
    inputTokens: campo(v.inputTokens, ehQuantia),
    outputTokens: campo(v.outputTokens, ehQuantia),
    thinkingTokens: campo(v.thinkingTokens, ehQuantia),
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
  // as sessões mais recentes do registro (até 100), a mais nova primeiro
  recentSessions?: Execucao[];
  auditoria?: Auditoria;
  // a hora da primeira sessão do registro individual
  sessionsSince?: number;
  // quantas sessões o agregado do motor já contou: serve só para a tela perceber consumo novo
  sessoesContadas?: number;
  // Não vem do motor: quantas sessões recentes a tela não leu.
  sessoesDescartadas?: number;
}

export const lerConsumoDoSnapshot: Leitor<ConsumoDoSnapshot> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const sessoes = lerItens(valor.recentSessions, lerExecucao);
  // só a contagem vai ao registro, sem a referência do PR
  if (sessoes?.descartados) registrar(`snapshot: ${sessoes.descartados} item(ns) de "usage.recentSessions" com forma inesperada, descartado(s)`);
  return semAusentes({
    recentSessions: sessoes?.itens,
    auditoria: lerAuditoria(valor.auditoria),
    sessionsSince: campo(valor.sessionsSince, ehQuantia) || undefined,
    sessoesContadas: ehObjeto(valor.totals) ? campo(valor.totals.sessions, ehContagem) : undefined,
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
  thinkingTokens?: number;
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
    thinkingTokens: campo(v.thinkingTokens, ehQuantia),
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

// A quebra por repositório (aggregateRepos, lib/usage/report.js): as mesmas somas da quebra
// por tipo. O nome vazio é o que não é de PR (ferramenta, conversa, registro antigo).
const lerSomaDoRepo: LeitorDeItem<SomaComNome> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.name)) return undefined;
  return { name: v.name, ...lerSoma(v) };
};

// A quebra por modelo (aggregateModels): o motor soma execuções, tokens de entrada, de saída e
// de pensamento e, desde 19/11/2026, o custo (o que o provedor mediu por modelo quando fecha com
// a linha, senão o da linha) e as de custo desconhecido. Não manda cache por modelo.
export interface SomaDoModelo {
  name: string;
  attempts?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  costUsd?: number;
  unknownCost?: number;
}

const lerSomaDoModelo: LeitorDeItem<SomaDoModelo> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.name)) return undefined;
  return semAusentes({
    name: v.name, attempts: campo(v.attempts, ehContagem),
    inputTokens: campo(v.inputTokens, ehQuantia), outputTokens: campo(v.outputTokens, ehQuantia),
    thinkingTokens: campo(v.thinkingTokens, ehQuantia), costUsd: campo(v.costUsd, ehQuantia),
    unknownCost: campo(v.unknownCost, ehContagem),
  });
};

// Uma etapa da revisão, da decisão da rodada da linha (etapasDa, lib/engine/consumo-das-sessoes.js).
export interface EtapaDaSessao {
  id: string;
  label?: string;
  ms?: number;
}

const lerEtapa: LeitorDeItem<EtapaDaSessao> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.id)) return undefined;
  return semAusentes({ id: v.id, label: campo(v.label, ehTextoComConteudo), ms: campo(v.ms, ehQuantia) });
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
  // da decisão da rodada (lib/engine/consumo-das-sessoes.js), só na página e só quando a decisão
  // os tem: a revisão que ainda não decidiu e a contestação vêm sem eles
  decisaoId?: string;
  etapas?: EtapaDaSessao[];
  card?: string;
  arquivosLidos?: number;
}

const lerOperacao: LeitorDeItem<Operacao> = (v) => {
  if (!ehObjeto(v) || !ehTextoComConteudo(v.key)) return undefined;
  const ultima = lerExecucao(v) ?? {};
  const etapas = lerItens(v.etapas, lerEtapa)?.itens;
  return semAusentes({
    ...ultima,
    key: v.key,
    pr: campo(v.pr, ehTextoComConteudo),
    attempts: lerItens(v.attempts, lerExecucao)?.itens ?? [],
    decisaoId: campo(v.decisaoId, ehTextoComConteudo),
    etapas: etapas?.length ? etapas : undefined,
    card: campo(v.card, ehTextoComConteudo),
    arquivosLidos: campo(v.arquivosLidos, ehContagem),
  });
};

// A página do diário (historyOf). `page` começa em zero, e o motor traz 8 operações por
// página; página além do fim volta como a última.
export interface PaginaDoDiario {
  total: number;
  page: number;
  pages: number;
  // o tamanho da página que o motor usou (8 sem pedir outro)
  pageSize?: number;
  rows: Operacao[];
  // Não vem do motor: quantas operações da página a tela não leu.
  descartados: number;
}

function lerPaginaDoDiario(v: unknown): PaginaDoDiario | null {
  if (!ehObjeto(v) || !ehContagem(v.total) || !ehContagem(v.page) || !ehContagem(v.pages)) return null;
  const lido = lerItens(v.rows, lerOperacao);
  if (!lido) return null;
  return semAusentes({ total: v.total, page: v.page, pages: v.pages, pageSize: campo(v.pageSize, ehContagem), rows: lido.itens, descartados: lido.descartados });
}

// O que o motor oferece em cada filtro (activityOptions): os valores que existem no registro.
export interface OpcoesDeFiltro {
  kind: string[];
  model: string[];
  repo: string[];
  // os autores (sem caixa) e os perfis do Claude do diário
  author: string[];
  profile: string[];
}

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(ehTextoComConteudo) : [];
}

// Uma revisão que terminou sem publicar e sem decisão no histórico (ocorrencias-da-revisao.js,
// 24/11/2026): o PR mergeado antes de a sessão abrir, o commit novo durante ela, a queda da
// sessão, o cancelamento... `texto` é a frase do motor, em português, que a tela mostra como veio.
export interface Ocorrencia {
  at: number;
  // a chave do PR (dono/repo#n)
  ref: string;
  // nao_iniciada, encerrada, interrompida ou sem_resultado
  tipo: string;
  // o motivo do catálogo do motor (pr_mergeado, commit_novo, sessao_caiu...)
  motivo: string;
  texto: string;
  // retentativa, lote, clique, commit_novo, rodada_extra ou fila
  origem?: string;
  // o id da revisão (a do Consumo), quando ela chegou a ter um
  sessao?: string;
  head?: string;
  etapa?: string;
  // a classe da falha (lib/log-taxonomy.js), na queda e na falha
  classe?: string;
}

const lerOcorrencia: LeitorDeItem<Ocorrencia> = (v) => {
  if (!ehObjeto(v) || !ehNumero(v.at) || v.at <= 0) return undefined;
  if (!ehTextoComConteudo(v.ref) || !ehTextoComConteudo(v.tipo) || !ehTextoComConteudo(v.motivo) || !ehTextoComConteudo(v.texto)) return undefined;
  return semAusentes({
    at: v.at, ref: v.ref, tipo: v.tipo, motivo: v.motivo, texto: v.texto,
    origem: campo(v.origem, ehTextoComConteudo),
    sessao: campo(v.sessao, ehTextoComConteudo),
    head: campo(v.head, ehTextoComConteudo),
    etapa: campo(v.etapa, ehTextoComConteudo),
    classe: campo(v.classe, ehTextoComConteudo),
  });
};

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
  // por repositório, na ordem do motor; ausente quando o motor não manda a quebra
  repos?: SomaComNome[];
  // por gatilho, na ordem do motor; o nome vazio é conversa e ferramenta
  porGatilho?: SomaComNome[];
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
  // as revisões que terminaram sem publicar no período e no repositório, a mais nova primeiro (até
  // 200). Ausente é motor anterior ao registro, e fica null: a tela não afirma "nenhuma" sem o
  // motor ter dito. Lista torta vira vazia, e o item torto fica de fora
  ocorrencias: Ocorrencia[] | null;
  // Não vem do motor: quantos itens de `series`, `byKind`, `models` e `repos` a tela não leu.
  descartados: number;
}

// Os cabeçalhos que o leitor do CSV pede ao cliente (opção `cabecalhos`).
export const CABECALHOS_DO_CSV = ['content-type', 'content-disposition'] as const;

// O CSV de GET /api/usage?formato=csv. `nome` é o do Content-Disposition do motor, ou null quando o
// cabeçalho não chegou ou não traz um nome de arquivo simples.
// O período que o motor não aceita volta como 200 em JSON, com `{ ok: false, motivo }`, também
// com formato=csv: isso não é arquivo, é a frase dele.
export type CsvDoConsumo =
  | { ok: true; csv: string; nome: string | null }
  | { ok: false; motivo: string };

// só um nome de arquivo .csv, sem pasta: o resto não é seguido
const NOME_DO_ARQUIVO = /\bfilename="([A-Za-z0-9._-]+\.csv)"/;

function nomeDoArquivo(disposicao: unknown): string | null {
  if (typeof disposicao !== 'string') return null;
  const nome = NOME_DO_ARQUIVO.exec(disposicao)?.[1];
  return nome && !nome.startsWith('.') ? nome : null;
}

// O que o cliente entrega com `{ texto: true, cabecalhos: CABECALHOS_DO_CSV }`: o texto do corpo
// e os cabeçalhos pedidos.
export function lerCsvDoConsumo(bruto: unknown): CsvDoConsumo | null {
  if (!ehObjeto(bruto) || typeof bruto.corpo !== 'string' || !ehObjeto(bruto.cabecalhos)) return null;
  const { corpo, cabecalhos } = bruto;
  const tipo = typeof cabecalhos['content-type'] === 'string' ? cabecalhos['content-type'] : '';
  if (/json/i.test(tipo) || corpo.trimStart().startsWith('{')) {
    let lido: unknown;
    try { lido = JSON.parse(corpo); } catch { return null; }
    return ehObjeto(lido) && lido.ok === false && ehTextoComConteudo(lido.motivo) ? { ok: false, motivo: lido.motivo } : null;
  }
  return { ok: true, csv: corpo, nome: nomeDoArquivo(cabecalhos['content-disposition']) };
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
  const repos = lerItens(bruto.repos, lerSomaDoRepo);
  const porGatilho = lerItens(bruto.porGatilho, lerSomaDoRepo);
  const opcoes = ehObjeto(bruto.options) ? bruto.options : {};
  const relatorio: Relatorio = semAusentes({
    range: { start: bruto.range.start, end: bruto.range.end },
    totals: lerSoma(bruto.totals),
    series: series?.itens ?? [],
    byKind: byKind?.itens ?? [],
    models: models?.itens ?? [],
    repos: repos?.itens,
    porGatilho: porGatilho?.itens,
    history,
    options: {
      kind: textos(opcoes.kind), model: textos(opcoes.model), repo: textos(opcoes.repo),
      author: textos(opcoes.author), profile: textos(opcoes.profile),
    },
    completed: lerConcluidas(bruto.completed),
    retries: campo(bruto.retries, ehContagem),
    unidentified: campo(bruto.unidentified, ehContagem),
    sinceDay: campo(bruto.sinceDay, ehDia),
    incomplete: campo(bruto.incomplete, ehBooleano),
    ocorrencias: bruto.ocorrencias === undefined ? null : (lerItens(bruto.ocorrencias, lerOcorrencia)?.itens ?? []),
    descartados: (series?.descartados ?? 0) + (byKind?.descartados ?? 0) + (models?.descartados ?? 0) + (repos?.descartados ?? 0) + (porGatilho?.descartados ?? 0),
  });
  return { ok: true, relatorio };
}
