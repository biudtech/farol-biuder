// As chaves do snapshot que a tela Radar usa, tipadas pelo que o motor emite (os arquivos
// citados ficam na raiz do repositório). Campo que o motor só grava em certos casos é
// opcional aqui. Cada validador confere um item; a lista ou o mapa em volta é lido por
// lerLista e lerRegistro (./formas), que descartam o item torto e seguem.
import {
  deGuarda, ehBooleano, ehListaDeTextos, ehNumero, ehObjeto, ehTexto, lerLista, lerRegistro, opcional,
  type Leitor, type Objeto,
} from './formas';

// `status`: o estado do ciclo de checagem (constructor e setStatus, server.js).
export const STATUS_DO_MOTOR = ['starting', 'checking', 'idle', 'error'] as const;
export type StatusDoMotor = (typeof STATUS_DO_MOTOR)[number];

function ehStatus(valor: unknown): valor is StatusDoMotor {
  return ehTexto(valor) && (STATUS_DO_MOTOR as readonly string[]).includes(valor);
}

// `error`: a mensagem da última checagem que falhou, ou null (lastError, server.js).
function ehErro(valor: unknown): valor is string | null {
  return valor === null || ehTexto(valor);
}

// `lastCheckAt` e `nextCheckAt`: epoch em ms, ou null antes do primeiro ciclo (server.js).
function ehInstanteOuNulo(valor: unknown): valor is number | null {
  return valor === null || ehNumero(valor);
}

// `account`: a conta revisora e se o gh tem token para ela (snapshot(), server.js). `user`
// vazio é motor sem conta configurada nem detectada.
export interface ContaDoMotor {
  user: string;
  tokenOk: boolean;
}

function ehConta(valor: unknown): valor is ContaDoMotor {
  return ehObjeto(valor) && ehTexto(valor.user) && ehBooleano(valor.tokenOk);
}

// `buscasPausadas`: contas com as buscas paradas pelo limite do GitHub, e até quando
// (buscasPausadas, lib/engine/limite-gh.js).
export interface BuscaPausada {
  conta: string;
  ate: number;
}

function ehBuscaPausada(valor: unknown): valor is BuscaPausada {
  return ehObjeto(valor) && ehTexto(valor.conta) && ehNumero(valor.ate);
}

// `queue`: os PRs pedidos à conta (searchPRs, lib/engine/gh-queries.js). O motor acrescenta
// outros campos ao item (labels, account, marcas do ciclo) que o Radar não lê.
export interface ItemDaFila {
  key: string;
  url: string;
  title?: string;
  author?: string;
  repo?: string;
  number?: number;
  updatedAt?: string;
  isDraft?: boolean;
}

function ehItemDaFila(valor: unknown): valor is ItemDaFila {
  return ehObjeto(valor) && ehTexto(valor.key) && ehTexto(valor.url)
    && opcional(valor.title, ehTexto) && opcional(valor.author, ehTexto) && opcional(valor.repo, ehTexto)
    && opcional(valor.number, ehNumero) && opcional(valor.updatedAt, ehTexto) && opcional(valor.isDraft, ehBooleano);
}

// `inicioAutomatico`: por chave de PR da fila, se o motor abre a revisão sozinho ou espera o
// clique (inicioAutomaticoDaFila, server.js).
export type InicioAutomatico = Record<string, boolean>;

// `esperaConflito`: PRs em conflito com a base, por chave (snapshot(), server.js). O Radar só
// usa a presença da chave.
export type EsperaConflito = Record<string, Objeto>;

// `parked`: PR da fila cuja revisão automática parou, com quando e por quê (parkedParaUi,
// lib/engine/review.js). `at` é data ISO, ou vazio no registro antigo.
export interface Estacionado {
  at: string;
  motivo: string;
  tipo: string;
}

function ehEstacionado(valor: unknown): valor is Estacionado {
  return ehObjeto(valor) && ehTexto(valor.at) && ehTexto(valor.motivo) && ehTexto(valor.tipo);
}

// `headlessWaitingPrs`: os PRs que já saíram da fila e esperam vaga de execução
// (prsEmEspera, lib/engine/headless-fila.js).
export interface PrEmEspera {
  key: string;
  url: string;
  title: string;
  author: string;
  repo: string;
  updatedAt: string;
}

function ehPrEmEspera(valor: unknown): valor is PrEmEspera {
  return ehObjeto(valor) && ehTexto(valor.key) && ehTexto(valor.url) && ehTexto(valor.title)
    && ehTexto(valor.author) && ehTexto(valor.repo) && ehTexto(valor.updatedAt);
}

// `headlessWaitingDetails`: a posição e o motivo observado de cada espera (esperaParaTela,
// lib/engine/headless-fila.js). `ocupadas` e `limite` só existem quando o agendador mediu.
export interface DetalheDaEspera {
  posicao: number;
  total: number;
  motivo: string;
  ocupadas?: number;
  limite?: number;
}

function ehDetalheDaEspera(valor: unknown): valor is DetalheDaEspera {
  return ehObjeto(valor) && ehNumero(valor.posicao) && ehNumero(valor.total) && ehTexto(valor.motivo)
    && opcional(valor.ocupadas, ehNumero) && opcional(valor.limite, ehNumero);
}

// `activeSessions`: as sessões em curso (runHeadlessReview, lib/engine/review.js, projetadas
// por lib/engine/sessao-projecao.js). O registro tem mais campos (etapa, modelo, subagentes)
// que este lote não mostra.
export interface PrDaSessao {
  key?: string;
  url?: string;
  title?: string;
  author?: string;
}

export interface SessaoAtiva {
  id: string;
  label: string;
  startedAt: number;
  keys?: string[];
  // false quando o envio do review já começou: o motor recusa o cancelamento
  cancellable?: boolean;
  // true depois que o cancelamento foi aceito e a sessão ainda está encerrando
  cancelled?: boolean;
  pr?: PrDaSessao;
}

function ehPrDaSessao(valor: unknown): valor is PrDaSessao {
  return ehObjeto(valor) && opcional(valor.key, ehTexto) && opcional(valor.url, ehTexto)
    && opcional(valor.title, ehTexto) && opcional(valor.author, ehTexto);
}

function ehSessaoAtiva(valor: unknown): valor is SessaoAtiva {
  return ehObjeto(valor) && ehTexto(valor.id) && ehTexto(valor.label) && ehNumero(valor.startedAt)
    && opcional(valor.keys, ehListaDeTextos) && opcional(valor.cancellable, ehBooleano)
    && opcional(valor.cancelled, ehBooleano) && opcional(valor.pr, ehPrDaSessao);
}

// `activity`: o feed de cada sessão, por id (pushActivity, lib/engine/session.js). `k` é o
// tipo da linha (tool, text, warn, info), `a` o subagente dono dela e `s` a etapa. O motor
// guarda as 120 linhas mais recentes de cada sessão.
export interface LinhaDoFeed {
  t: number;
  k: string;
  text: string;
  a?: string;
  s?: string;
}

export const TETO_DO_FEED = 120;

export function ehLinhaDoFeed(valor: unknown): valor is LinhaDoFeed {
  return ehObjeto(valor) && ehNumero(valor.t) && ehTexto(valor.k) && ehTexto(valor.text)
    && opcional(valor.a, ehTexto) && opcional(valor.s, ehTexto);
}

const lerLinhas = lerLista('activity', ehLinhaDoFeed);

// Por sessão: linha torta é descartada e o feed segue; feed que não é lista sai do mapa.
export const lerAtividade: Leitor<Record<string, LinhaDoFeed[]>> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const entradas: Array<[string, LinhaDoFeed[]]> = [];
  for (const [id, feed] of Object.entries(valor)) {
    const linhas = lerLinhas(feed, registrar);
    if (linhas) entradas.push([id, linhas]);
    else registrar('snapshot: um feed de "activity" não é lista e foi descartado');
  }
  return Object.fromEntries(entradas);
};

// `decisions.pending`: uma pendência da mesa, pela projeção decisionForUi
// (lib/engine/public-review.js). A projeção leva outros campos (rounds, stages,
// verificationCheckpoint, cardMet, viaAdmin) que ficam para o Histórico.
export type TipoDeMotivo = 'gate' | 'content' | 'infra';

export interface Motivo {
  text: string;
  kind: TipoDeMotivo;
}

export interface PrDaPendencia {
  repo?: string;
  number?: number;
  url?: string;
  title?: string;
  author?: string;
}

export interface CheckEsperado {
  nome: string;
  estado: string;
}

export interface Pendencia {
  id: string;
  key: string;
  createdAt?: number;
  // o parecer da sessão: approve ou request_changes
  verdict?: string;
  card?: string | null;
  pr?: PrDaPendencia;
  // PR da própria conta revisora: o GitHub recusa a revisão decisiva do autor
  prProprio?: true;
  // texto fixo do motor: por que o clique não publicou (decide, lib/engine/decision.js)
  blockedReason?: string;
  blockedKind?: string;
  headSha?: string;
  blockedHead?: string;
  // a publicação falhou e o motor ainda tenta sozinho, ou desistiu
  postRetry?: { attempts: number; exhausted: boolean };
  // espera dos checks obrigatórios (lib/engine/espera-ci.js)
  esperaCi?: { desde: number; checks: CheckEsperado[] };
  // recuperação da prova técnica (lib/engine/espera-prova.js)
  esperaProva?: { desde: number; tentativas: number; aguardandoCi: boolean; proximaEm: number; impedimento: string; pedeVoce: boolean };
  // resumo da avaliação técnica (technicalSummary, lib/technical-review/verdict.js)
  technical?: { state: string; message: string };
  // o review como iria ao PR, em markdown
  reportMarkdown: string;
  reasons: Motivo[];
  attention: Motivo[];
}

function ehMotivo(valor: unknown): valor is Motivo {
  return ehObjeto(valor) && ehTexto(valor.text) && (valor.kind === 'gate' || valor.kind === 'content' || valor.kind === 'infra');
}

const ehMotivos = (valor: unknown): valor is Motivo[] => Array.isArray(valor) && valor.every(ehMotivo);

function ehPrDaPendencia(valor: unknown): valor is PrDaPendencia {
  return ehObjeto(valor) && opcional(valor.repo, ehTexto) && opcional(valor.number, ehNumero)
    && opcional(valor.url, ehTexto) && opcional(valor.title, ehTexto) && opcional(valor.author, ehTexto);
}

function ehRetentativa(valor: unknown): valor is NonNullable<Pendencia['postRetry']> {
  return ehObjeto(valor) && ehNumero(valor.attempts) && ehBooleano(valor.exhausted);
}

function ehCheck(valor: unknown): valor is CheckEsperado {
  return ehObjeto(valor) && ehTexto(valor.nome) && ehTexto(valor.estado);
}

function ehEsperaCi(valor: unknown): valor is NonNullable<Pendencia['esperaCi']> {
  return ehObjeto(valor) && ehNumero(valor.desde) && Array.isArray(valor.checks) && valor.checks.every(ehCheck);
}

function ehEsperaProva(valor: unknown): valor is NonNullable<Pendencia['esperaProva']> {
  return ehObjeto(valor) && ehNumero(valor.desde) && ehNumero(valor.tentativas) && ehBooleano(valor.aguardandoCi)
    && ehNumero(valor.proximaEm) && ehTexto(valor.impedimento) && ehBooleano(valor.pedeVoce);
}

function ehTecnica(valor: unknown): valor is NonNullable<Pendencia['technical']> {
  return ehObjeto(valor) && ehTexto(valor.state) && ehTexto(valor.message);
}

const ehCard = (valor: unknown): valor is string | null => valor === null || ehTexto(valor);
const ehVerdadeiro = (valor: unknown): valor is true => valor === true;

export function ehPendencia(valor: unknown): valor is Pendencia {
  return ehObjeto(valor) && ehTexto(valor.id) && ehTexto(valor.key)
    && opcional(valor.createdAt, ehNumero) && opcional(valor.verdict, ehTexto) && opcional(valor.card, ehCard)
    && opcional(valor.pr, ehPrDaPendencia) && opcional(valor.prProprio, ehVerdadeiro)
    && opcional(valor.blockedReason, ehTexto) && opcional(valor.blockedKind, ehTexto)
    && opcional(valor.headSha, ehTexto) && opcional(valor.blockedHead, ehTexto)
    && opcional(valor.postRetry, ehRetentativa) && opcional(valor.esperaCi, ehEsperaCi)
    && opcional(valor.esperaProva, ehEsperaProva) && opcional(valor.technical, ehTecnica)
    && ehTexto(valor.reportMarkdown) && ehMotivos(valor.reasons) && ehMotivos(valor.attention);
}

// `decisions`: as pendências e as 30 resolvidas mais recentes (snapshotDecisions,
// lib/engine/snapshot-decisions.js). As resolvidas são da tela de Histórico e seguem sem tipo.
export interface Decisoes {
  pending: Pendencia[];
  resolved: unknown[];
}

const lerPendencias = lerLista('decisions.pending', ehPendencia);

export const lerDecisoes: Leitor<Decisoes> = (valor, registrar) => {
  if (!ehObjeto(valor) || !Array.isArray(valor.resolved)) return undefined;
  const pending = lerPendencias(valor.pending, registrar);
  return pending ? { pending, resolved: valor.resolved } : undefined;
};

export const lerStatus = deGuarda(ehStatus);
export const lerErro = deGuarda(ehErro);
export const lerInstante = deGuarda(ehInstanteOuNulo);
export const lerConta = deGuarda(ehConta);
export const lerBuscasPausadas = lerLista('buscasPausadas', ehBuscaPausada);
export const lerFila = lerLista('queue', ehItemDaFila);
export const lerInicioAutomatico = lerRegistro('inicioAutomatico', ehBooleano);
export const lerEsperaConflito = lerRegistro('esperaConflito', ehObjeto);
export const lerEstacionados = lerRegistro('parked', ehEstacionado);
export const lerSessoes = lerLista('activeSessions', ehSessaoAtiva);
export const lerChavesEmEspera = deGuarda(ehListaDeTextos);
export const lerPrsEmEspera = lerLista('headlessWaitingPrs', ehPrEmEspera);
export const lerDetalhesDaEspera = lerRegistro('headlessWaitingDetails', ehDetalheDaEspera);
