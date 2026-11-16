// A sessão do front: liga o cliente do motor ao store. Sem React aqui, para dar para testar
// com um fetch de mentira. A instância que as telas usam está em ./instancia.
import { lerPareamento, lerStatusDaAutenticacao } from '@/contratos/auth';
import type { Snapshot } from '@/contratos/snapshot';
import { criarCliente, type Cliente, type Conexao } from '@/transporte/cliente';
import { aplicarAtividade, aplicarEstadoInteiro, aplicarPatch, type Registrar } from '@/transporte/estado';
import { CHAVE_DO_TOKEN, type CofreDoToken } from '@/transporte/token';
import { criarStore, type Store } from './store';

// carregando: antes de ler o token (o servidor e o primeiro desenho do navegador).
// sem-endereco: NEXT_PUBLIC_FAROL_API ausente ou inválida no build.
export type Sessao = 'carregando' | 'sem-endereco' | 'pareamento' | 'pareado';
// o que a tela de pareamento sabe do motor
export type Motor = 'verificando' | 'alcancavel' | 'inalcancavel';
// cancelado: a sessão mudou enquanto o pedido estava no ar (a tela não mostra nada por isso)
export type DesfechoDoPareamento = 'pareado' | 'recusado' | 'inalcancavel' | 'cancelado';
// Por que a tela de pareamento apareceu, quando não foi por escolha de quem está nesta aba.
// nao-autenticado: o motor recusou o token (401). outra-aba: o token saiu do armazenamento
// por outra aba (alguém saiu nela, ou ela levou o 401 antes). saiu: o Sair desta aba, que não
// pede explicação, só o foco no campo do código. nenhum: a página abriu sem token.
export type MotivoDoPareamento = 'nenhum' | 'saiu' | 'nao-autenticado' | 'outra-aba';

export interface EstadoDoApp {
  sessao: Sessao;
  motor: Motor;
  conexao: Conexao;
  snapshot: Snapshot | null;
  motivo: MotivoDoPareamento;
  // true quando a casca apareceu no lugar do pareamento (pareou aqui ou em outra aba): a
  // casca leva o foco ao conteúdo. Com token já guardado, na carga da página, é false.
  entrouAgora: boolean;
}

export const ESTADO_INICIAL: EstadoDoApp = Object.freeze({
  sessao: 'carregando',
  motor: 'verificando',
  conexao: 'conectando',
  snapshot: null,
  motivo: 'nenhum',
  entrouAgora: false,
});

export interface App {
  store: Store<EstadoDoApp>;
  cliente: Cliente;
  // Lê o token, decide a tela e passa a ouvir as outras abas. Devolve a função que encerra
  // (fecha o fluxo, aborta as chamadas e para de ouvir).
  iniciar(): () => void;
  verificarMotor(): Promise<void>;
  parear(codigo: string, rotulo: string): Promise<DesfechoDoPareamento>;
  // Aborta as chamadas em curso e apaga o token deste navegador (as outras abas vão ao
  // pareamento junto). Não revoga a sessão no motor.
  sair(): void;
}

// O pedaço da janela que a sessão usa: o evento `storage`, que o navegador dispara nas OUTRAS
// abas da origem quando uma grava ou apaga no localStorage (nunca na que escreveu).
export interface JanelaDoArmazenamento {
  addEventListener(tipo: 'storage', ouvinte: (evento: { key: string | null }) => void): void;
  removeEventListener(tipo: 'storage', ouvinte: (evento: { key: string | null }) => void): void;
}

export interface DependenciasDoApp {
  base: string;
  cofre: CofreDoToken;
  registrar: Registrar;
  // ausente no servidor e em quem não quer ouvir as outras abas
  janela?: JanelaDoArmazenamento;
  buscar?: typeof fetch;
}

export function criarApp({ base, cofre, registrar, janela, buscar }: DependenciasDoApp): App {
  const store = criarStore<EstadoDoApp>(ESTADO_INICIAL);
  let fecharFluxo: (() => void) | null = null;
  // o token com que esta aba abriu o fluxo: é com ele que se compara o que outra aba gravou
  let tokenDaSessao = '';
  // só a sondagem mais recente grava o resultado
  let sondagem = 0;

  const cliente = criarCliente({ base, cofre, buscar, registrar, aoNaoAutenticado: () => voltarAoPareamento('nao-autenticado') });

  function fechar(): void {
    fecharFluxo?.();
    fecharFluxo = null;
  }

  function aoEvento(tipo: string, dados: string): void {
    // Os outros eventos do motor (toast, needs-decision e afins) ainda não têm quem os leia:
    // entram com as telas. O `activity` é a linha nova do feed de uma sessão (Radar).
    if (tipo !== 'state' && tipo !== 'state-patch' && tipo !== 'activity') return;
    let bruto: unknown;
    try { bruto = JSON.parse(dados); } catch {
      registrar(`snapshot: o evento ${tipo} não trouxe JSON e foi descartado`);
      return;
    }
    const anterior = store.ler().snapshot;
    const aplicar = { state: aplicarEstadoInteiro, 'state-patch': aplicarPatch, activity: aplicarAtividade }[tipo];
    store.trocar({ snapshot: aplicar(anterior, bruto, registrar) });
  }

  function abrirFluxo(): void {
    fechar();
    fecharFluxo = cliente.abrirFluxo({ aoEvento, aoMudarConexao: (conexao) => store.trocar({ conexao }) });
  }

  async function verificarMotor(): Promise<void> {
    const minha = ++sondagem;
    store.trocar({ motor: 'verificando' });
    const r = await cliente.get('/api/auth/status', lerStatusDaAutenticacao);
    // resposta de uma sondagem que já foi trocada por outra, ou abortada, não grava nada
    if (minha !== sondagem || (!r.ok && r.falha === 'cancelado')) return;
    store.trocar({ motor: r.ok ? 'alcancavel' : 'inalcancavel' });
  }

  // Toda saída da sessão passa aqui: o sair, o 401 e o token apagado por outra aba. As
  // chamadas em curso são abortadas (a resposta delas não grava mais nada), e o snapshot sai
  // junto com o token: a tela de pareamento não fica com dado do motor atrás.
  function voltarAoPareamento(motivo: MotivoDoPareamento): void {
    fechar();
    cliente.cancelarChamadas();
    tokenDaSessao = '';
    store.trocar({ sessao: 'pareamento', snapshot: null, conexao: 'conectando', motivo, entrouAgora: false });
    void verificarMotor();
  }

  function entrar(token: string, entrouAgora: boolean): void {
    tokenDaSessao = token;
    store.trocar({ sessao: 'pareado', motivo: 'nenhum', entrouAgora });
    abrirFluxo();
  }

  // Outra aba gravou ou apagou o token. Daqui nada é escrito no armazenamento: a aba que
  // escreveu não recebe o próprio evento, e a que recebe não escreve, então não há laço.
  function aoMudarOArmazenamento(evento: { key: string | null }): void {
    // chave nula é o localStorage.clear()
    if (evento.key !== null && evento.key !== CHAVE_DO_TOKEN) return;
    const { sessao, entrouAgora } = store.ler();
    if (sessao !== 'pareado' && sessao !== 'pareamento') return;
    const atual = cofre.sincronizar();
    if (!atual) {
      if (sessao === 'pareado') voltarAoPareamento('outra-aba');
      return;
    }
    if (sessao === 'pareado' && atual === tokenDaSessao) return;
    // Pareou em outra aba, ou trocou de token nela. Quem estava no pareamento entra; quem já
    // estava dentro só reabre o fluxo com o token novo.
    cliente.cancelarChamadas();
    entrar(atual, sessao === 'pareamento' ? true : entrouAgora);
  }

  function encerrar(): void {
    janela?.removeEventListener('storage', aoMudarOArmazenamento);
    fechar();
    cliente.cancelarChamadas();
  }

  return {
    store,
    cliente,
    verificarMotor,
    iniciar() {
      if (!base) {
        store.trocar({ sessao: 'sem-endereco' });
        return encerrar;
      }
      janela?.addEventListener('storage', aoMudarOArmazenamento);
      const token = cofre.ler();
      if (token) entrar(token, false);
      else voltarAoPareamento('nenhum');
      return encerrar;
    },
    async parear(codigo, rotulo) {
      const r = await cliente.post('/api/auth/pair', { codigo, rotulo }, lerPareamento);
      if (!r.ok) {
        if (r.falha === 'cancelado') return 'cancelado';
        store.trocar({ motor: 'inalcancavel' });
        return 'inalcancavel';
      }
      store.trocar({ motor: 'alcancavel' });
      if (!r.dados.ok) return 'recusado';
      cofre.salvar(r.dados.token);
      entrar(r.dados.token, true);
      return 'pareado';
    },
    sair() {
      cofre.esquecer(cofre.ler());
      voltarAoPareamento('saiu');
    },
  };
}
