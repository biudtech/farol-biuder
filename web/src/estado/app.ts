// A sessão do front: liga o cliente do motor ao store. Sem React aqui, para dar para testar
// com um fetch de mentira. A instância que as telas usam está em ./instancia.
import { lerPareamento, lerStatusDaAutenticacao } from '@/contratos/auth';
import { lerRecado, type RecadoDoMotor } from '@/contratos/eventos';
import { lerRevogacao, lerSessoes } from '@/contratos/sistema';
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
// O que aconteceu com a sessão no MOTOR quando este navegador saiu. revogada: o motor a
// revogou, e o token não vale mais lá. nao-confirmada: o pedido de revogação saiu e a resposta
// não chegou (rede, ou o prazo venceu): não dá para dizer se o motor revogou. Nos outros três
// nada foi revogado, e o token só foi esquecido aqui: sem-resposta (não deu para pedir a lista
// de sessões), recusada (a rota respondeu fora do esperado, ou recusou a revogação) e
// nao-encontrada (a lista veio sem a sessão deste navegador).
export type Saida = 'revogada' | 'nao-confirmada' | 'sem-resposta' | 'recusada' | 'nao-encontrada';

// Quanto o Sair espera pelo motor antes de sair só deste navegador.
export const PRAZO_DO_SAIR_MS = 5000;

// Um aviso do motor (evento `toast`) como a tela o guarda: `n` é a ordem de chegada, e
// serve de chave.
export interface RecadoNaTela extends RecadoDoMotor {
  n: number;
}

// Quantos recados do motor ficam na tela: chegando o quarto, o mais antigo sai.
export const TETO_DE_RECADOS = 3;

const SEM_RECADOS: readonly RecadoNaTela[] = Object.freeze([]);

export interface EstadoDoApp {
  sessao: Sessao;
  motor: Motor;
  conexao: Conexao;
  // O primeiro `state` da conexão atual do fluxo já chegou: o snapshot é o do motor de agora.
  // `conexao` vira "conectado" no HTTP 200, antes disso, ainda com o snapshot da conexão
  // anterior; quem vai mandar ao motor algo montado do snapshot olha este sinal.
  estadoEmDia: boolean;
  snapshot: Snapshot | null;
  motivo: MotivoDoPareamento;
  // true quando a casca apareceu no lugar do pareamento (pareou aqui ou em outra aba): a
  // casca leva o foco ao conteúdo. Com token já guardado, na carga da página, é false.
  entrouAgora: boolean;
  // os avisos mais recentes do motor, do mais antigo ao mais novo
  recados: readonly RecadoNaTela[];
  // o Sair está esperando o motor revogar a sessão
  saindo: boolean;
  // o desfecho do último Sair deste navegador; null quando a tela de pareamento não veio dele
  saida: Saida | null;
}

export const ESTADO_INICIAL: EstadoDoApp = Object.freeze({
  sessao: 'carregando',
  motor: 'verificando',
  conexao: 'conectando',
  estadoEmDia: false,
  snapshot: null,
  motivo: 'nenhum',
  entrouAgora: false,
  recados: SEM_RECADOS,
  saindo: false,
  saida: null,
});

export interface App {
  store: Store<EstadoDoApp>;
  cliente: Cliente;
  // Lê o token, decide a tela e passa a ouvir as outras abas. Devolve a função que encerra
  // (fecha o fluxo, aborta as chamadas e para de ouvir).
  iniciar(): () => void;
  verificarMotor(): Promise<void>;
  parear(codigo: string, rotulo: string): Promise<DesfechoDoPareamento>;
  // Aborta as chamadas em curso, pede ao motor que revogue a sessão deste navegador (acha a
  // sessão `atual` em POST /api/auth/sessions e a revoga pelo `id`) e apaga o token daqui (as
  // outras abas vão ao pareamento junto). Falha de rede, de rota ou exceção não impedem o sair
  // local: o desfecho diz se a sessão foi revogada no motor, se não deu para confirmar, ou se
  // ela só foi esquecida aqui. `null` quando a sessão acabou ou mudou por outro caminho no
  // meio (o motor já a recusava, outra aba saiu, ou outra aba pareou de novo e esta segue
  // com o token dela).
  sair(): Promise<Saida | null>;
  // A metade local do Sair, para quem já revogou a própria sessão no motor (a lista de
  // sessões da tela Sistema): apaga o token daqui e vai ao pareamento, com o desfecho dito.
  esquecerSessao(saida: Saida): void;
  // Tira da tela os avisos do motor.
  dispensarRecados(): void;
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
  let recadosRecebidos = 0;
  // o Sair em curso: o segundo clique recebe o mesmo desfecho
  let saindo: Promise<Saida | null> | null = null;

  const cliente = criarCliente({ base, cofre, buscar, registrar, aoNaoAutenticado: () => voltarAoPareamento('nao-autenticado') });

  function fechar(): void {
    fecharFluxo?.();
    fecharFluxo = null;
  }

  function aoEvento(tipo: string, dados: string): void {
    // Os outros eventos do motor (needs-decision, new-prs e afins) ainda não têm quem os
    // leia: entram com as telas. O `activity` é a linha nova do feed de uma sessão, e o
    // `toast` é o aviso com que o motor diz o desfecho de uma ação ou de uma revisão.
    if (tipo !== 'state' && tipo !== 'state-patch' && tipo !== 'activity' && tipo !== 'toast') return;
    let bruto: unknown;
    try { bruto = JSON.parse(dados); } catch {
      registrar(`snapshot: o evento ${tipo} não trouxe JSON e foi descartado`);
      return;
    }
    if (tipo === 'toast') {
      const recado = lerRecado(bruto);
      if (!recado) {
        registrar('fluxo de eventos: um toast chegou fora do formato e foi descartado');
        return;
      }
      recadosRecebidos += 1;
      store.trocar({ recados: [...store.ler().recados, { ...recado, n: recadosRecebidos }].slice(-TETO_DE_RECADOS) });
      return;
    }
    const anterior = store.ler().snapshot;
    const aplicar = { state: aplicarEstadoInteiro, 'state-patch': aplicarPatch, activity: aplicarAtividade }[tipo];
    // o estado inteiro é o primeiro evento de toda conexão (lib/http-server.js, na raiz)
    store.trocar(tipo === 'state' ? { snapshot: aplicar(anterior, bruto, registrar), estadoEmDia: true } : { snapshot: aplicar(anterior, bruto, registrar) });
  }

  function abrirFluxo(): void {
    fechar();
    fecharFluxo = cliente.abrirFluxo({ aoEvento, aoMudarConexao: (conexao) => store.trocar({ conexao, estadoEmDia: false }) });
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
  function voltarAoPareamento(motivo: MotivoDoPareamento, saida: Saida | null = null): void {
    fechar();
    cliente.cancelarChamadas();
    tokenDaSessao = '';
    store.trocar({ sessao: 'pareamento', snapshot: null, conexao: 'conectando', estadoEmDia: false, motivo, entrouAgora: false, recados: SEM_RECADOS, saindo: false, saida });
    void verificarMotor();
  }

  // Pede ao motor que revogue a sessão deste navegador: a lista diz qual é a `atual`, e a
  // revogação vai pelo `id` dela. As duas chamadas dividem um prazo só. Nunca lança: exceção
  // de quem lê a resposta vira o desfecho da fase em que aconteceu. `nao-autenticado`: o motor
  // já recusava o token.
  async function revogarAPropria(): Promise<Saida | 'nao-autenticado'> {
    const prazo = new AbortController();
    const relogio = setTimeout(() => prazo.abort(), PRAZO_DO_SAIR_MS);
    // depois que o pedido de revogação sai, falha de rede ou de prazo não diz se ele chegou
    let pediuARevogacao = false;
    try {
      const lista = await cliente.post('/api/auth/sessions', {}, lerSessoes, { sinal: prazo.signal });
      if (!lista.ok) {
        if (lista.falha === 'nao_autenticado') return 'nao-autenticado';
        return lista.falha === 'rede' || lista.falha === 'cancelado' ? 'sem-resposta' : 'recusada';
      }
      const atual = lista.dados.sessoes.find((sessao) => sessao.atual);
      if (!atual) return 'nao-encontrada';
      pediuARevogacao = true;
      const revogacao = await cliente.post('/api/auth/revoke', { id: atual.id }, lerRevogacao, { sinal: prazo.signal });
      if (!revogacao.ok) {
        if (revogacao.falha === 'nao_autenticado') return 'nao-autenticado';
        return revogacao.falha === 'rede' || revogacao.falha === 'cancelado' ? 'nao-confirmada' : 'recusada';
      }
      return revogacao.dados.ok ? 'revogada' : 'recusada';
    } catch {
      return pediuARevogacao ? 'nao-confirmada' : 'recusada';
    } finally {
      clearTimeout(relogio);
    }
  }

  // Outro token no armazenamento (outra aba pareou de novo): esta aba segue pareada com ele,
  // em vez de ir ao pareamento com um token válido guardado.
  function seguirComOutroToken(token: string): boolean {
    const outro = cofre.sincronizar();
    if (!outro || outro === token) return false;
    cliente.cancelarChamadas();
    entrar(outro, store.ler().entrouAgora);
    return true;
  }

  // A metade local do Sair, depois da resposta do motor.
  function concluirSaida(token: string, saida: Saida | 'nao-autenticado'): Saida | null {
    // A sessão acabou por outro caminho enquanto o motor era consultado (o 401, que já levou a
    // tela ao pareamento, ou o token trocado ou apagado por outra aba): não há o que esquecer.
    if (store.ler().sessao !== 'pareado' || tokenDaSessao !== token) {
      store.trocar({ saindo: false });
      return null;
    }
    // O motor recusou o token e a aba continua pareada: o cliente apagou o token recusado e
    // achou outro no armazenamento, senão já teria levado a tela ao pareamento.
    if (saida === 'nao-autenticado') {
      if (!seguirComOutroToken(token)) voltarAoPareamento('nao-autenticado');
      return null;
    }
    cofre.esquecer(token);
    if (seguirComOutroToken(token)) return null;
    voltarAoPareamento('saiu', saida);
    return saida;
  }

  async function sairDoMotorEDaqui(): Promise<Saida | null> {
    const token = tokenDaSessao;
    let concluido = false;
    try {
      // as chamadas das telas param já: a resposta delas não grava mais nada
      cliente.cancelarChamadas();
      store.trocar({ saindo: true });
      const fim = concluirSaida(token, await revogarAPropria());
      concluido = true;
      return fim;
    } finally {
      // Qualquer exceção no caminho: o sair local acontece do mesmo jeito. O token sai daqui,
      // o botão volta, e a tela não afirma nada sobre o motor.
      if (!concluido) {
        if (store.ler().sessao === 'pareado' && tokenDaSessao === token) {
          cofre.esquecer(token);
          voltarAoPareamento('saiu', 'nao-confirmada');
        } else store.trocar({ saindo: false });
      }
    }
  }

  function entrar(token: string, entrouAgora: boolean): void {
    tokenDaSessao = token;
    store.trocar({ sessao: 'pareado', motivo: 'nenhum', entrouAgora, saindo: false, saida: null });
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
      if (store.ler().sessao !== 'pareado') return Promise.resolve(null);
      // a exceção já foi tratada no finally de lá: quem clicou recebe o desfecho, não um erro
      saindo ??= sairDoMotorEDaqui().catch((): Saida => 'nao-confirmada').finally(() => { saindo = null; });
      return saindo;
    },
    esquecerSessao(saida) {
      if (store.ler().sessao !== 'pareado') return;
      cofre.esquecer(tokenDaSessao);
      voltarAoPareamento('saiu', saida);
    },
    dispensarRecados() {
      store.trocar({ recados: SEM_RECADOS });
    },
  };
}
