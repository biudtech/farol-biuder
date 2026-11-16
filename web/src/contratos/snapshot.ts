// O contrato do snapshot: o que o motor manda em GET /api/state e no fluxo /api/events.
//
// As chaves de topo são lista fechada no motor (test/snapshot-chaves.test.js, na raiz), e o
// teste ao lado deste arquivo reprova se as duas listas divergirem. A definição do dado é do
// motor: aqui só se confere a forma, na borda, antes de o valor entrar no store.
//
// Cada lote de tela tipa as chaves que usa: troca o `unknown` da chave em FormasDoSnapshot
// pelo tipo lido do que o motor emite, e o `qualquer` dela em VALIDADORES pelo validador.
import { ehObjeto, ehTexto } from './formas';

export const CHAVES_DO_SNAPSHOT = [
  'app', 'modelos', 'claudePerfis', 'status', 'error', 'baseline', 'account', 'accounts',
  'pushbacks', 'config', 'jiraSites', 'lastCheckAt', 'nextCheckAt', 'buscasPausadas', 'queue',
  'inicioAutomatico', 'esperaConflito', 'parked', 'reRounds', 'activeSessions', 'activity',
  'headlessWaiting', 'headlessWaitingPrs', 'headlessWaitingDetails', 'filaJusta', 'decisions',
  'reviewActions', 'usage', 'doctor', 'paths',
] as const;

export type ChaveDoSnapshot = (typeof CHAVES_DO_SNAPSHOT)[number];

// A identidade do motor: nome, versão e plataforma (snapshot() em server.js).
export interface AppDoMotor {
  name: string;
  version: string;
  platform: string;
}

export interface FormasDoSnapshot {
  app: AppDoMotor;
  modelos: unknown;
  claudePerfis: unknown;
  status: unknown;
  error: unknown;
  baseline: unknown;
  account: unknown;
  accounts: unknown;
  pushbacks: unknown;
  config: unknown;
  jiraSites: unknown;
  lastCheckAt: unknown;
  nextCheckAt: unknown;
  buscasPausadas: unknown;
  queue: unknown;
  inicioAutomatico: unknown;
  esperaConflito: unknown;
  parked: unknown;
  reRounds: unknown;
  activeSessions: unknown;
  activity: unknown;
  headlessWaiting: unknown;
  headlessWaitingPrs: unknown;
  headlessWaitingDetails: unknown;
  filaJusta: unknown;
  decisions: unknown;
  reviewActions: unknown;
  usage: unknown;
  doctor: unknown;
  paths: unknown;
}

// Toda chave é opcional: forma errada sem valor anterior deixa a chave ausente, e a tela
// precisa saber desenhar sem ela.
export type Snapshot = { readonly [C in ChaveDoSnapshot]?: FormasDoSnapshot[C] };

export type Validador<T> = (valor: unknown) => valor is T;

// Chave ainda sem tipo: passa qualquer valor, e quem a ler recebe `unknown`.
const qualquer = (valor: unknown): valor is unknown => valor !== undefined;

function ehApp(valor: unknown): valor is AppDoMotor {
  return ehObjeto(valor) && ehTexto(valor.name) && ehTexto(valor.version) && ehTexto(valor.platform);
}

export const VALIDADORES: { readonly [C in ChaveDoSnapshot]: Validador<FormasDoSnapshot[C]> } = {
  app: ehApp,
  modelos: qualquer,
  claudePerfis: qualquer,
  status: qualquer,
  error: qualquer,
  baseline: qualquer,
  account: qualquer,
  accounts: qualquer,
  pushbacks: qualquer,
  config: qualquer,
  jiraSites: qualquer,
  lastCheckAt: qualquer,
  nextCheckAt: qualquer,
  buscasPausadas: qualquer,
  queue: qualquer,
  inicioAutomatico: qualquer,
  esperaConflito: qualquer,
  parked: qualquer,
  reRounds: qualquer,
  activeSessions: qualquer,
  activity: qualquer,
  headlessWaiting: qualquer,
  headlessWaitingPrs: qualquer,
  headlessWaitingDetails: qualquer,
  filaJusta: qualquer,
  decisions: qualquer,
  reviewActions: qualquer,
  usage: qualquer,
  doctor: qualquer,
  paths: qualquer,
};
