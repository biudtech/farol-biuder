// O contrato do snapshot: o que o motor manda em GET /api/state e no fluxo /api/events.
//
// As chaves de topo são lista fechada no motor (test/snapshot-chaves.test.js, na raiz), e o
// teste ao lado deste arquivo reprova se as duas listas divergirem. A definição do dado é do
// motor: aqui só se confere a forma, na borda, antes de o valor entrar no store.
//
// Cada lote de tela tipa as chaves que usa: troca o `unknown` da chave em FormasDoSnapshot
// pelo tipo lido do que o motor emite, e o `qualquer` dela em LEITORES pelo leitor. As do
// Radar estão em ./radar, a do Histórico (`pushbacks`) em ./historico, a do Time (`config`,
// os perfis de review) em ./time, a do Consumo (`usage`) em ./consumo e as do Sistema
// (`accounts`, `doctor`, `modelos`, `claudePerfis`, `jiraSites` e o resto de `config`) em
// ./sistema.
import { lerConsumoDoSnapshot, type ConsumoDoSnapshot } from './consumo';
import { ehObjeto, ehTexto, type Leitor } from './formas';
import { lerContestacoes, type Contestacao } from './historico';
import {
  lerAtividade, lerBuscasPausadas, lerChavesEmEspera, lerConta, lerDecisoes, lerDetalhesDaEspera, lerErro,
  lerEsperaConflito, lerEstacionados, lerFila, lerInicioAutomatico, lerInstante, lerPrsEmEspera, lerSessoes,
  lerStatus,
  type BuscaPausada, type ContaDoMotor, type Decisoes, type DetalheDaEspera, type EsperaConflito,
  type Estacionado, type InicioAutomatico, type ItemDaFila, type LinhaDoFeed, type PrEmEspera,
  type SessaoAtiva, type StatusDoMotor,
} from './radar';
import { semSegredos } from './segredos';
import {
  lerContas, lerModelos, lerPerfisDoClaude, lerSaude, lerSitesDoJira,
  type ContaRevisora, type Modelos, type PerfisDoClaude, type Saude, type SiteDoJira,
} from './sistema';
import { lerConfig, type ConfigDoMotor } from './time';

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
  modelos: Modelos;
  claudePerfis: PerfisDoClaude;
  status: StatusDoMotor;
  error: string | null;
  baseline: unknown;
  account: ContaDoMotor;
  accounts: ContaRevisora[];
  pushbacks: Record<string, Contestacao>;
  config: ConfigDoMotor;
  jiraSites: SiteDoJira[];
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
  usage: ConsumoDoSnapshot;
  doctor: Saude | null;
  paths: unknown;
}

// Toda chave é opcional: forma errada sem valor anterior deixa a chave ausente, e a tela
// precisa saber desenhar sem ela.
export type Snapshot = { readonly [C in ChaveDoSnapshot]?: FormasDoSnapshot[C] };

// Chave ainda sem tipo: quem a ler recebe `unknown`. O valor entra sem o que tiver cara de
// segredo (./segredos), porque ninguém conferiu a forma dele.
const qualquer: Leitor<unknown> = (valor) => semSegredos(valor).limpo;

// montada campo a campo: o que mais vier junto não entra no store
const lerApp: Leitor<AppDoMotor> = (valor) => (
  ehObjeto(valor) && ehTexto(valor.name) && ehTexto(valor.version) && ehTexto(valor.platform)
    ? { name: valor.name, version: valor.version, platform: valor.platform }
    : undefined
);

// Um leitor por chave. Devolve o valor conferido, ou `undefined` quando a forma não é a
// esperada (a chave fica como estava). Nas listas e nos mapas o item torto é descartado e
// registrado, e o resto entra.
export const LEITORES: { readonly [C in ChaveDoSnapshot]: Leitor<FormasDoSnapshot[C]> } = {
  app: lerApp,
  modelos: lerModelos,
  claudePerfis: lerPerfisDoClaude,
  status: lerStatus,
  error: lerErro,
  baseline: qualquer,
  account: lerConta,
  accounts: lerContas,
  pushbacks: lerContestacoes,
  config: lerConfig,
  jiraSites: lerSitesDoJira,
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
  usage: lerConsumoDoSnapshot,
  doctor: lerSaude,
  paths: qualquer,
};
