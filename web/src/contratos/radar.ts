// As chaves do snapshot que a tela Radar usa, tipadas pelo que o motor emite (os arquivos
// citados ficam na raiz do repositório).
//
// Cada item é lido campo a campo: o que identifica o item é obrigatório, e sem ele o item é
// descartado; todo o resto é opcional, e campo de forma errada (inclusive null) conta como
// ausente. O item aparece na tela com o que deu para ler, em vez de sumir por causa de um
// campo. A lista ou o mapa em volta é lido por lerLista e lerRegistro (./formas).
import {
  campo, deGuarda, ehBooleano, ehListaDeTextos, ehNumero, ehObjeto, ehTexto, itemDe, lerItens, lerLista, lerRegistro,
  semAusentes, type Leitor, type LeitorDeItem, type Objeto,
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

const lerBuscaPausada: LeitorDeItem<BuscaPausada> = (v) => (
  ehObjeto(v) && ehTexto(v.conta) && ehNumero(v.ate) ? { conta: v.conta, ate: v.ate } : undefined
);

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

const lerItemDaFila: LeitorDeItem<ItemDaFila> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.key) || !ehTexto(v.url)) return undefined;
  return semAusentes({
    key: v.key, url: v.url, title: campo(v.title, ehTexto), author: campo(v.author, ehTexto), repo: campo(v.repo, ehTexto),
    number: campo(v.number, ehNumero), updatedAt: campo(v.updatedAt, ehTexto), isDraft: campo(v.isDraft, ehBooleano),
  });
};

// `inicioAutomatico`: por chave de PR da fila, se o motor abre a revisão sozinho ou espera o
// clique (inicioAutomaticoDaFila, server.js).
export type InicioAutomatico = Record<string, boolean>;

// `esperaConflito`: PRs em conflito com a base, por chave (snapshot(), server.js). O Radar só
// usa a presença da chave.
export type EsperaConflito = Record<string, Objeto>;

// `parked`: PR da fila cuja revisão automática parou, com quando e por quê (parkedParaUi,
// lib/engine/review.js). `at` é data ISO, ou vazio no registro antigo. A entrada que existe
// já diz que parou: o que faltar nela vira vazio, e o tipo desconhecido cai na frase de falha.
export interface Estacionado {
  at: string;
  motivo: string;
  tipo: string;
}

const lerEstacionado: LeitorDeItem<Estacionado> = (v) => (
  ehObjeto(v) ? { at: campo(v.at, ehTexto) ?? '', motivo: campo(v.motivo, ehTexto) ?? '', tipo: campo(v.tipo, ehTexto) ?? '' } : undefined
);

// `headlessWaitingPrs`: os PRs que já saíram da fila e esperam vaga de execução
// (prsEmEspera, lib/engine/headless-fila.js).
export interface PrEmEspera {
  key: string;
  url?: string;
  title?: string;
  author?: string;
}

const lerPrEmEspera: LeitorDeItem<PrEmEspera> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.key)) return undefined;
  return semAusentes({ key: v.key, url: campo(v.url, ehTexto), title: campo(v.title, ehTexto), author: campo(v.author, ehTexto) });
};

// `headlessWaitingDetails`: a posição e o motivo observado de cada espera (esperaParaTela,
// lib/engine/headless-fila.js). `ocupadas` e `limite` só existem quando o agendador mediu.
export interface DetalheDaEspera {
  posicao?: number;
  total?: number;
  motivo?: string;
  ocupadas?: number;
  limite?: number;
}

const lerDetalheDaEspera: LeitorDeItem<DetalheDaEspera> = (v) => {
  if (!ehObjeto(v)) return undefined;
  return semAusentes({
    posicao: campo(v.posicao, ehNumero), total: campo(v.total, ehNumero), motivo: campo(v.motivo, ehTexto),
    ocupadas: campo(v.ocupadas, ehNumero), limite: campo(v.limite, ehNumero),
  });
};

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
  label?: string;
  startedAt?: number;
  keys?: string[];
  // false quando o envio do review já começou: o motor recusa o cancelamento
  cancellable?: boolean;
  // true depois que o cancelamento foi aceito e a sessão ainda está encerrando
  cancelled?: boolean;
  pr?: PrDaSessao;
}

function lerPrDaSessao(v: unknown): PrDaSessao | undefined {
  if (!ehObjeto(v)) return undefined;
  return semAusentes({ key: campo(v.key, ehTexto), url: campo(v.url, ehTexto), title: campo(v.title, ehTexto), author: campo(v.author, ehTexto) });
}

const lerSessaoAtiva: LeitorDeItem<SessaoAtiva> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id)) return undefined;
  return semAusentes({
    id: v.id, label: campo(v.label, ehTexto), startedAt: campo(v.startedAt, ehNumero), keys: campo(v.keys, ehListaDeTextos),
    cancellable: campo(v.cancellable, ehBooleano), cancelled: campo(v.cancelled, ehBooleano), pr: lerPrDaSessao(v.pr),
  });
};

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

export const lerLinhaDoFeed: LeitorDeItem<LinhaDoFeed> = (v) => {
  if (!ehObjeto(v) || !ehNumero(v.t) || !ehTexto(v.text)) return undefined;
  return semAusentes({ t: v.t, k: campo(v.k, ehTexto) ?? 'info', text: v.text, a: campo(v.a, ehTexto), s: campo(v.s, ehTexto) });
};

const lerLinhas = lerLista('activity', lerLinhaDoFeed);

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

export interface EsperaDoCi {
  // 0 quando o motor não mandou desde quando
  desde: number;
  checks: CheckEsperado[];
}

export interface EsperaDaProva {
  desde: number;
  tentativas: number;
  aguardandoCi: boolean;
  proximaEm: number;
  impedimento: string;
  pedeVoce: boolean;
}

export interface Pendencia {
  id: string;
  key: string;
  createdAt?: number;
  // o parecer da sessão: approve ou request_changes
  verdict?: string;
  // a chave do card do Jira
  card?: string;
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
  esperaCi?: EsperaDoCi;
  // recuperação da prova técnica (lib/engine/espera-prova.js)
  esperaProva?: EsperaDaProva;
  // resumo da avaliação técnica (technicalSummary, lib/technical-review/verdict.js)
  technical?: { state?: string; message: string };
  // O texto do review do PARECER, em markdown (reviewMarkdownForUi). Não é o texto de cada
  // ação: o que o motor publica em cada botão fica em `payloads`, que a projeção não expõe.
  reportMarkdown: string;
  reasons: Motivo[];
  attention: Motivo[];
}

const TIPOS_DE_MOTIVO: readonly string[] = ['gate', 'content', 'infra'];

// Motivo sem texto sai; tipo que este front não conhece vale como ponto da revisão, que é
// o padrão do motor (REASON_KINDS, lib/engine/public-review.js).
function lerMotivos(valor: unknown): Motivo[] {
  if (!Array.isArray(valor)) return [];
  const motivos: Motivo[] = [];
  for (const m of valor) {
    if (!ehObjeto(m) || !ehTexto(m.text) || !m.text) continue;
    motivos.push({ text: m.text, kind: ehTexto(m.kind) && TIPOS_DE_MOTIVO.includes(m.kind) ? (m.kind as TipoDeMotivo) : 'content' });
  }
  return motivos;
}

function lerPrDaPendencia(v: unknown): PrDaPendencia | undefined {
  if (!ehObjeto(v)) return undefined;
  return semAusentes({
    repo: campo(v.repo, ehTexto), number: campo(v.number, ehNumero), url: campo(v.url, ehTexto),
    title: campo(v.title, ehTexto), author: campo(v.author, ehTexto),
  });
}

// A chave do card chega como texto ou, em registro antigo, como objeto com `key` (cardDe,
// lib/engine/historico-paginado.js). null é "sem card".
function lerCard(v: unknown): string | undefined {
  if (ehTexto(v)) return v || undefined;
  return ehObjeto(v) && ehTexto(v.key) && v.key ? v.key : undefined;
}

function lerRetentativa(v: unknown): Pendencia['postRetry'] {
  return ehObjeto(v) && ehNumero(v.attempts) && ehBooleano(v.exhausted) ? { attempts: v.attempts, exhausted: v.exhausted } : undefined;
}

// As duas esperas decidem em que bloco a pendência aparece e se a tela oferece Aprovar. Por
// isso a marca que veio, mesmo torta, continua valendo como espera, com o que deu para ler:
// largar a marca levaria o item para "Precisa de você" com os botões de decisão.
function lerEsperaCi(v: unknown): EsperaDoCi | undefined {
  if (v === undefined || v === null) return undefined;
  if (!ehObjeto(v)) return { desde: 0, checks: [] };
  const checks: CheckEsperado[] = [];
  for (const c of Array.isArray(v.checks) ? v.checks : []) {
    if (ehObjeto(c)) checks.push({ nome: campo(c.nome, ehTexto) ?? '', estado: campo(c.estado, ehTexto) ?? '' });
  }
  return { desde: campo(v.desde, ehNumero) ?? 0, checks };
}

function lerEsperaProva(v: unknown): EsperaDaProva | undefined {
  if (v === undefined || v === null) return undefined;
  if (!ehObjeto(v)) return { desde: 0, tentativas: 0, aguardandoCi: false, proximaEm: 0, impedimento: '', pedeVoce: false };
  return {
    desde: campo(v.desde, ehNumero) ?? 0, tentativas: campo(v.tentativas, ehNumero) ?? 0, aguardandoCi: v.aguardandoCi === true,
    proximaEm: campo(v.proximaEm, ehNumero) ?? 0, impedimento: campo(v.impedimento, ehTexto) ?? '', pedeVoce: v.pedeVoce === true,
  };
}

function lerTecnica(v: unknown): Pendencia['technical'] {
  return ehObjeto(v) && ehTexto(v.message) && v.message ? semAusentes({ state: campo(v.state, ehTexto), message: v.message }) : undefined;
}

// Só `id` e `key` são exigidos: sem o id não há o que mandar ao motor, e sem a chave não há
// como dizer de qual PR é a pendência.
export const lerPendencia: LeitorDeItem<Pendencia> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id) || !v.id || !ehTexto(v.key) || !v.key) return undefined;
  return semAusentes({
    id: v.id,
    key: v.key,
    createdAt: campo(v.createdAt, ehNumero),
    verdict: campo(v.verdict, ehTexto),
    card: lerCard(v.card),
    pr: lerPrDaPendencia(v.pr),
    prProprio: v.prProprio === true ? (true as const) : undefined,
    blockedReason: campo(v.blockedReason, ehTexto),
    blockedKind: campo(v.blockedKind, ehTexto),
    headSha: campo(v.headSha, ehTexto),
    blockedHead: campo(v.blockedHead, ehTexto),
    postRetry: lerRetentativa(v.postRetry),
    esperaCi: lerEsperaCi(v.esperaCi),
    esperaProva: lerEsperaProva(v.esperaProva),
    technical: lerTecnica(v.technical),
    reportMarkdown: campo(v.reportMarkdown, ehTexto) ?? '',
    reasons: lerMotivos(v.reasons),
    attention: lerMotivos(v.attention),
  });
};

// `decisions`: as pendências e as 30 resolvidas mais recentes (snapshotDecisions,
// lib/engine/snapshot-decisions.js). As resolvidas são da tela de Histórico e seguem sem tipo.
export interface Decisoes {
  pending: Pendencia[];
  resolved: unknown[];
  // Não vem do motor: quantos itens de `pending` chegaram sem id ou sem chave e foram
  // descartados aqui. A tela avisa, para "nenhuma pendência" não esconder uma que existe.
  ilegiveis: number;
}

export const lerDecisoes: Leitor<Decisoes> = (valor, registrar) => {
  if (!ehObjeto(valor)) return undefined;
  const lido = lerItens(valor.pending, lerPendencia);
  if (!lido) return undefined;
  if (lido.descartados) registrar(`snapshot: ${lido.descartados} item(ns) de "decisions.pending" sem id ou sem chave, descartado(s)`);
  return { pending: lido.itens, resolved: Array.isArray(valor.resolved) ? valor.resolved : [], ilegiveis: lido.descartados };
};

export const lerStatus = deGuarda(ehStatus);
export const lerErro = deGuarda(ehErro);
export const lerInstante = deGuarda(ehInstanteOuNulo);
export const lerConta = deGuarda(ehConta);
export const lerBuscasPausadas = lerLista('buscasPausadas', lerBuscaPausada);
export const lerFila = lerLista('queue', lerItemDaFila);
export const lerInicioAutomatico = lerRegistro('inicioAutomatico', itemDe(ehBooleano));
export const lerEsperaConflito = lerRegistro('esperaConflito', itemDe(ehObjeto));
export const lerEstacionados = lerRegistro('parked', lerEstacionado);
export const lerSessoes = lerLista('activeSessions', lerSessaoAtiva);
export const lerChavesEmEspera = deGuarda(ehListaDeTextos);
export const lerPrsEmEspera = lerLista('headlessWaitingPrs', lerPrEmEspera);
export const lerDetalhesDaEspera = lerRegistro('headlessWaitingDetails', lerDetalheDaEspera);
