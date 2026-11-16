// A sessão do front: liga o cliente do motor ao store. Sem React aqui, para dar para testar
// com um fetch de mentira. A instância que as telas usam está em ./instancia.
import { lerPareamento, lerStatusDaAutenticacao } from '@/contratos/auth';
import type { Snapshot } from '@/contratos/snapshot';
import { criarCliente, type Cliente, type Conexao } from '@/transporte/cliente';
import { aplicarEstadoInteiro, aplicarPatch, type Registrar } from '@/transporte/estado';
import type { CofreDoToken } from '@/transporte/token';
import { criarStore, type Store } from './store';

// carregando: antes de ler o token (o servidor e o primeiro desenho do navegador).
// sem-endereco: NEXT_PUBLIC_FAROL_API ausente ou inválida no build.
export type Sessao = 'carregando' | 'sem-endereco' | 'pareamento' | 'pareado';
// o que a tela de pareamento sabe do motor
export type Motor = 'verificando' | 'alcancavel' | 'inalcancavel';
export type DesfechoDoPareamento = 'pareado' | 'recusado' | 'inalcancavel';

export interface EstadoDoApp {
  sessao: Sessao;
  motor: Motor;
  conexao: Conexao;
  snapshot: Snapshot | null;
}

export const ESTADO_INICIAL: EstadoDoApp = Object.freeze({
  sessao: 'carregando',
  motor: 'verificando',
  conexao: 'conectando',
  snapshot: null,
});

export interface App {
  store: Store<EstadoDoApp>;
  cliente: Cliente;
  // Lê o token e decide a tela. Devolve a função que encerra (fecha o fluxo).
  iniciar(): () => void;
  verificarMotor(): Promise<void>;
  parear(codigo: string, rotulo: string): Promise<DesfechoDoPareamento>;
  // Apaga o token deste navegador. Não revoga a sessão no motor.
  sair(): void;
}

export interface DependenciasDoApp {
  base: string;
  cofre: CofreDoToken;
  registrar: Registrar;
  buscar?: typeof fetch;
}

export function criarApp({ base, cofre, registrar, buscar }: DependenciasDoApp): App {
  const store = criarStore<EstadoDoApp>(ESTADO_INICIAL);
  let fecharFluxo: (() => void) | null = null;

  const cliente = criarCliente({ base, cofre, buscar, aoNaoAutenticado: voltarAoPareamento });

  function fechar(): void {
    fecharFluxo?.();
    fecharFluxo = null;
  }

  function aoEvento(tipo: string, dados: string): void {
    // Os outros eventos do motor (toast, activity, needs-decision e afins) ainda não têm
    // quem os leia: entram com as telas.
    if (tipo !== 'state' && tipo !== 'state-patch') return;
    let bruto: unknown;
    try { bruto = JSON.parse(dados); } catch {
      registrar(`snapshot: o evento ${tipo} não trouxe JSON e foi descartado`);
      return;
    }
    const anterior = store.ler().snapshot;
    const aplicar = tipo === 'state' ? aplicarEstadoInteiro : aplicarPatch;
    store.trocar({ snapshot: aplicar(anterior, bruto, registrar) });
  }

  function abrirFluxo(): void {
    fechar();
    fecharFluxo = cliente.abrirFluxo({ aoEvento, aoMudarConexao: (conexao) => store.trocar({ conexao }) });
  }

  async function verificarMotor(): Promise<void> {
    store.trocar({ motor: 'verificando' });
    const r = await cliente.get('/api/auth/status', lerStatusDaAutenticacao);
    store.trocar({ motor: r.ok ? 'alcancavel' : 'inalcancavel' });
  }

  // O snapshot sai junto com o token: a tela de pareamento não fica com dado do motor atrás.
  function voltarAoPareamento(): void {
    fechar();
    store.trocar({ sessao: 'pareamento', snapshot: null, conexao: 'conectando' });
    void verificarMotor();
  }

  return {
    store,
    cliente,
    verificarMotor,
    iniciar() {
      if (!base) {
        store.trocar({ sessao: 'sem-endereco' });
        return fechar;
      }
      if (cofre.ler()) {
        store.trocar({ sessao: 'pareado' });
        abrirFluxo();
      } else {
        voltarAoPareamento();
      }
      return fechar;
    },
    async parear(codigo, rotulo) {
      const r = await cliente.post('/api/auth/pair', { codigo, rotulo }, lerPareamento);
      if (!r.ok) {
        store.trocar({ motor: 'inalcancavel' });
        return 'inalcancavel';
      }
      store.trocar({ motor: 'alcancavel' });
      if (!r.dados.ok) return 'recusado';
      cofre.salvar(r.dados.token);
      store.trocar({ sessao: 'pareado' });
      abrirFluxo();
      return 'pareado';
    },
    sair() {
      cofre.esquecer();
      voltarAoPareamento();
    },
  };
}
