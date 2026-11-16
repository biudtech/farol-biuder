// O contrato do snapshot: o que o motor manda em GET /api/state e no fluxo /api/events.
//
// As chaves de topo são lista fechada no motor (test/snapshot-chaves.test.js, na raiz), e o
// teste ao lado deste arquivo reprova se as duas listas divergirem. A definição do dado é do
// motor: aqui só se confere a forma, na borda, antes de o valor entrar no store.
//
// Cada lote de tela tipa as chaves que usa: troca o `unknown` da chave em FormasDoSnapshot
// pelo tipo lido do que o motor emite, e o `qualquer` dela em LEITORES pelo leitor. As do
// Radar estão em ./radar, e a do Histórico (`pushbacks`) em ./historico.
import { deGuarda, ehObjeto, ehTexto, type Leitor } from './formas';
import { lerContestacoes, type Contestacao } from './historico';
import {
  lerAtividade, lerBuscasPausadas, lerChavesEmEspera, lerConta, lerDecisoes, lerDetalhesDaEspera, lerErro,
  lerEsperaConflito, lerEstacionados, lerFila, lerInicioAutomatico, lerInstante, lerPrsEmEspera, lerSessoes,
  lerStatus,
  type BuscaPausada, type ContaDoMotor, type Decisoes, type DetalheDaEspera, type EsperaConflito,
  type Estacionado, type InicioAutomatico, type ItemDaFila, type LinhaDoFeed, type PrEmEspera,
  type SessaoAtiva, type StatusDoMotor,
} from './radar';

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
  status: StatusDoMotor;
  error: string | null;
  baseline: unknown;
  account: ContaDoMotor;
  accounts: unknown;
  pushbacks: Record<string, Contestacao>;
  config: unknown;
  jiraSites: unknown;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  buscasPausadas: BuscaPausada[];
  queue: ItemDaFila[];
  inicioAutomatico: InicioAutomatico;
  esperaConflito: EsperaConflito;
  parked: Record<string, Estacionado>;
  reRounds: unknown;
  activeSessions: SessaoAtiva[];
  activity: Record<string, LinhaDoFeed[]>;
  headlessWaiting: string[];
  headlessWaitingPrs: PrEmEspera[];
  headlessWaitingDetails: Record<string, DetalheDaEspera>;
  filaJusta: unknown;
  decisions: Decisoes;
  reviewActions: unknown;
  usage: unknown;
  doctor: unknown;
  paths: unknown;
}

// Toda chave é opcional: forma errada sem valor anterior deixa a chave ausente, e a tela
// precisa saber desenhar sem ela.
export type Snapshot = { readonly [C in ChaveDoSnapshot]?: FormasDoSnapshot[C] };

// Chave ainda sem tipo: passa qualquer valor, e quem a ler recebe `unknown`.
const qualquer: Leitor<unknown> = (valor) => valor;

function ehApp(valor: unknown): valor is AppDoMotor {
  return ehObjeto(valor) && ehTexto(valor.name) && ehTexto(valor.version) && ehTexto(valor.platform);
}

// Um leitor por chave. Devolve o valor conferido, ou `undefined` quando a forma não é a
// esperada (a chave fica como estava). Nas listas e nos mapas o item torto é descartado e
// registrado, e o resto entra.
export const LEITORES: { readonly [C in ChaveDoSnapshot]: Leitor<FormasDoSnapshot[C]> } = {
  app: deGuarda(ehApp),
  modelos: qualquer,
  claudePerfis: qualquer,
  status: lerStatus,
  error: lerErro,
  baseline: qualquer,
  account: lerConta,
  accounts: qualquer,
  pushbacks: lerContestacoes,
  config: qualquer,
  jiraSites: qualquer,
  lastCheckAt: lerInstante,
  nextCheckAt: lerInstante,
  buscasPausadas: lerBuscasPausadas,
  queue: lerFila,
  inicioAutomatico: lerInicioAutomatico,
  esperaConflito: lerEsperaConflito,
  parked: lerEstacionados,
  reRounds: qualquer,
  activeSessions: lerSessoes,
  activity: lerAtividade,
  headlessWaiting: lerChavesEmEspera,
  headlessWaitingPrs: lerPrsEmEspera,
  headlessWaitingDetails: lerDetalhesDaEspera,
  filaJusta: qualquer,
  decisions: lerDecisoes,
  reviewActions: qualquer,
  usage: qualquer,
  doctor: qualquer,
  paths: qualquer,
};
