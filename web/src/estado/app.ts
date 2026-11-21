// A sessão do front: liga o cliente do motor ao store. Sem React aqui, para dar para testar
// com um fetch de mentira. A instância que as telas usam está em ./instancia.
import { lerPareamento, lerStatusDaAutenticacao } from '@/contratos/auth';
import { lerRecado, type RecadoDoMotor } from '@/contratos/eventos';
import { lerRevogacao, lerSessoes } from '@/contratos/sistema';
import type { Snapshot } from '@/contratos/snapshot';
import { criarCliente, type Cliente, type Conexao, type FluxoAberto } from '@/transporte/cliente';
import { aplicarAtividade, aplicarEstadoInteiro, aplicarPatch, type Registrar } from '@/transporte/estado';
import { CHAVE_DO_TOKEN, type CofreDoToken } from '@/transporte/token';
import { criarStore, type Store } from './store';

// carregando: antes de ler o token (o servidor e o primeiro desenho do navegador).
// sem-endereco: NEXT_PUBLIC_FAROL_API ausente ou inválida no build.
// portao-expirado: a sessão do login da frente acabou duas vezes seguidas na mesma janela de
// tempo; em vez de recarregar de novo (laço), a tela pede o clique em Entrar de novo.
export type Sessao = 'carregando' | 'sem-endereco' | 'pareamento' | 'pareado' | 'portao-expirado';
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

// Na sessão pelo portão, o 401 recarrega a página na raiz (onde o portão mostra o login) no
// máximo uma vez por esta janela; o segundo 401 dentro dela leva à tela de Entrar de novo.
export const JANELA_DA_RECARGA_MS = 60000;
// A rota do portão que encerra o login da frente (revoga a sessão do motor e apaga o cookie).
// Mesma origem da página, sem o motor no caminho.
export const ROTA_DE_SAIDA_DO_PORTAO = '/auth/logout';

// Um aviso do motor (evento `toast`) como a tela o guarda: `n` é a ordem de chegada, e
// serve de chave.
export interface RecadoNaTela extends RecadoDoMotor {
  n: number;
}

// Quantos recados do motor ficam na tela: chegando o quarto, o mais antigo sai.
export const TETO_DE_RECADOS = 3;
// Nenhuma notificação eterna (regra do dono de 20/11/2026): o recado sai sozinho depois disto,
// sem botão de dispensar.
export const DURACAO_DO_RECADO_MS = 8000;

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
  // a sessão vem do portão (o login da frente injeta a credencial): este navegador não guarda
  // token, e a casca diz de onde vem a sessão
  viaPortao: boolean;
  // A queda do fluxo, medida aqui: quando a conexão caiu (a primeira queda desde o último
  // "conectado") e quando sai a próxima tentativa, pelo recuo do cliente. null fora da queda, e
  // `proximaTentativaEm` null também enquanto uma tentativa está no ar (automática ou do clique).
  quedaEm: number | null;
  proximaTentativaEm: number | null;
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
  viaPortao: false,
  quedaEm: null,
  proximaTentativaEm: null,
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
  // Na tela de sessão do portão expirada: volta à raiz, onde o portão mostra o login.
  entrarDeNovo(): void;
  // Com o fluxo caído e esperando o recuo, tenta de novo agora. Fora disso não faz nada.
  tentarReconectar(): void;
}

// O que a sessão pelo portão usa da janela: ir à raiz (location.assign) e lembrar, nesta janela
// (sessionStorage), quando foi a última recarga causada por 401.
export interface JanelaDoPortao {
  irParaARaiz(): void;
  lerUltimaRecarga(): number;
  gravarUltimaRecarga(quando: number): void;
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
  // ausente no servidor; sem ela a sessão pelo portão não recarrega nada
  portao?: JanelaDoPortao;
  agora?: () => number;
}

// Guarda um recado do motor na tela e agenda a saída dele: some sozinho depois de
// DURACAO_DO_RECADO_MS, sem clique. Se outro estado já o tirou (o teto, a volta ao pareamento),
// nada muda. Exportada para o teste da tela provar o caminho de verdade.
export function guardarRecado(store: Store<EstadoDoApp>, recado: RecadoNaTela): void {
  store.trocar({ recados: [...store.ler().recados, recado].slice(-TETO_DE_RECADOS) });
  setTimeout(() => {
    const atuais = store.ler().recados;
    if (atuais.some((r) => r.n === recado.n)) store.trocar({ recados: atuais.filter((r) => r.n !== recado.n) });
  }, DURACAO_DO_RECADO_MS);
}

export function criarApp({ base, cofre, registrar, janela, buscar, portao, agora = () => Date.now() }: DependenciasDoApp): App {
  const store = criarStore<EstadoDoApp>(ESTADO_INICIAL);
  let fecharFluxo: FluxoAberto | null = null;
  // o token com que esta aba abriu o fluxo: é com ele que se compara o que outra aba gravou
  let tokenDaSessao = '';
  // só a sondagem mais recente grava o resultado
  let sondagem = 0;
  let recadosRecebidos = 0;
  // o Sair em curso: o segundo clique recebe o mesmo desfecho
  let saindo: Promise<Saida | null> | null = null;

  const cliente = criarCliente({
    base, cofre, buscar, registrar,
    viaPortao: () => store.ler().viaPortao,
    aoNaoAutenticado: () => (store.ler().viaPortao ? perdeuOPortao() : voltarAoPareamento('nao-autenticado')),
  });

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
      guardarRecado(store, { ...recado, n: recadosRecebidos });
      return;
    }
    const anterior = store.ler().snapshot;
    const aplicar = { state: aplicarEstadoInteiro, 'state-patch': aplicarPatch, activity: aplicarAtividade }[tipo];
    // o estado inteiro é o primeiro evento de toda conexão (lib/http-server.js, na raiz)
    store.trocar(tipo === 'state' ? { snapshot: aplicar(anterior, bruto, registrar), estadoEmDia: true } : { snapshot: aplicar(anterior, bruto, registrar) });
  }

  function abrirFluxo(): void {
    fechar();
    fecharFluxo = cliente.abrirFluxo({ aoEvento, aoMudarConexao, aoTentar: () => store.trocar({ proximaTentativaEm: null }) });
  }

  function aoMudarConexao(conexao: Conexao, esperaMs?: number): void {
    if (conexao === 'conectado' || conexao === 'conectando') {
      store.trocar({ conexao, estadoEmDia: false, quedaEm: null, proximaTentativaEm: null });
      return;
    }
    const quando = agora();
    store.trocar({ conexao, estadoEmDia: false, quedaEm: store.ler().quedaEm ?? quando, proximaTentativaEm: esperaMs === undefined ? null : quando + esperaMs });
  }

  // A faixa sai de "próxima tentativa às" no começo da tentativa, pelo aoTentar do fluxo: vale
  // para a que o relógio do recuo dispara e para a do clique.
  function tentarReconectar(): void {
    if (!fecharFluxo || store.ler().proximaTentativaEm === null) return;
    fecharFluxo.tentarAgora();
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
    store.trocar({ sessao: 'pareamento', snapshot: null, conexao: 'conectando', estadoEmDia: false, motivo, entrouAgora: false, recados: SEM_RECADOS, saindo: false, saida, viaPortao: false, quedaEm: null, proximaTentativaEm: null });
    void verificarMotor();
  }

  /* ---------- a sessão pelo portão ----------
     Um login na frente do motor e do front, na mesma origem, injeta o Bearer de uma sessão do
     motor em todo pedido que repassa. O navegador não vê esse token e não guarda nada. A única
     prova de que há alguém na frente é o motor dizer `autenticado: true` a um pedido que saiu
     daqui SEM token: sem portão, o motor responde `autenticado: false`, e o caminho é o
     pareamento de sempre. */

  // Sem token guardado: pergunta ao motor. Só entra sem token com `exigida` e `autenticado`
  // verdadeiros naquela resposta, e se nenhum token apareceu no meio (outra aba pareou).
  async function sondarAEntrada(): Promise<void> {
    const minha = ++sondagem;
    store.trocar({ motor: 'verificando' });
    const r = await cliente.get('/api/auth/status', lerStatusDaAutenticacao, { comCookie: true });
    if (minha !== sondagem || (!r.ok && r.falha === 'cancelado') || store.ler().sessao !== 'carregando') return;
    const outro = cofre.ler();
    if (outro) { entrar(outro, false); return; }
    if (r.ok && r.dados.exigida && r.dados.autenticado) { entrarPeloPortao(); return; }
    // Sem o voltarAoPareamento: não há sessão a desfazer, e cancelar as chamadas mataria um
    // pareamento que alguém já tenha disparado.
    store.trocar({ sessao: 'pareamento', motivo: 'nenhum', motor: r.ok ? 'alcancavel' : 'inalcancavel' });
  }

  function entrarPeloPortao(): void {
    tokenDaSessao = '';
    store.trocar({ sessao: 'pareado', viaPortao: true, motor: 'alcancavel', motivo: 'nenhum', entrouAgora: false, saindo: false, saida: null });
    abrirFluxo();
  }

  // O 401 na sessão pelo portão: não há token a apagar, e o pareamento não adianta (o portão o
  // bloqueia). A página volta à raiz, onde o portão mostra o login, uma vez por janela de tempo;
  // o segundo 401 dentro dela mostra a tela de Entrar de novo, em vez do laço de recargas.
  function perdeuOPortao(): void {
    if (store.ler().sessao !== 'pareado') return;
    fechar();
    cliente.cancelarChamadas();
    const ultima = portao?.lerUltimaRecarga() ?? 0;
    const quando = agora();
    const base = { snapshot: null, conexao: 'conectando' as const, estadoEmDia: false, recados: SEM_RECADOS, saindo: false, quedaEm: null, proximaTentativaEm: null };
    if (!portao || (ultima > 0 && quando - ultima < JANELA_DA_RECARGA_MS)) {
      store.trocar({ ...base, sessao: 'portao-expirado' });
      return;
    }
    store.trocar({ ...base, sessao: 'carregando' });
    portao.gravarUltimaRecarga(quando);
    portao.irParaARaiz();
  }

  // O Sair na sessão pelo portão: a rota de saída do portão (mesma origem, sem o motor), que
  // revoga a sessão do motor e apaga o cookie, e depois a raiz. A ida à raiz acontece com
  // qualquer resposta: se o portão não encerrou, ele mesmo decide o que mostrar lá.
  async function sairDoPortao(): Promise<Saida> {
    cliente.cancelarChamadas();
    store.trocar({ saindo: true });
    const prazo = new AbortController();
    const relogio = setTimeout(() => prazo.abort(), PRAZO_DO_SAIR_MS);
    let saida: Saida = 'nao-confirmada';
    try {
      const resposta = await (buscar ?? ((u, i) => globalThis.fetch(u, i)))(ROTA_DE_SAIDA_DO_PORTAO, {
        method: 'POST', headers: { 'x-farol': '1' }, credentials: 'same-origin', cache: 'no-store', signal: prazo.signal,
      });
      saida = resposta.ok ? 'revogada' : 'recusada';
    } catch { /* rede ou prazo: não dá para dizer se o portão encerrou */ } finally {
      clearTimeout(relogio);
    }
    fechar();
    portao?.irParaARaiz();
    return saida;
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
    store.trocar({ sessao: 'pareado', motivo: 'nenhum', entrouAgora, saindo: false, saida: null, viaPortao: false });
    abrirFluxo();
  }

  // Outra aba gravou ou apagou o token. Daqui nada é escrito no armazenamento: a aba que
  // escreveu não recebe o próprio evento, e a que recebe não escreve, então não há laço.
  function aoMudarOArmazenamento(evento: { key: string | null }): void {
    // chave nula é o localStorage.clear()
    if (evento.key !== null && evento.key !== CHAVE_DO_TOKEN) return;
    const { sessao, entrouAgora, viaPortao } = store.ler();
    if (sessao !== 'pareado' && sessao !== 'pareamento') return;
    const atual = cofre.sincronizar();
    if (!atual) {
      // na sessão pelo portão não há token daqui a perder: o que outra aba apagou não muda nada
      if (sessao === 'pareado' && !viaPortao) voltarAoPareamento('outra-aba');
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
      // com token guardado, o de sempre; sem token, o motor diz se há um portão na frente
      if (token) entrar(token, false);
      else void sondarAEntrada();
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
      if (store.ler().viaPortao) {
        saindo ??= sairDoPortao().finally(() => { saindo = null; });
        return saindo;
      }
      // a exceção já foi tratada no finally de lá: quem clicou recebe o desfecho, não um erro
      saindo ??= sairDoMotorEDaqui().catch((): Saida => 'nao-confirmada').finally(() => { saindo = null; });
      return saindo;
    },
    esquecerSessao(saida) {
      if (store.ler().sessao !== 'pareado') return;
      // na sessão pelo portão, revogar a sessão atual é sair: o login da frente também acaba
      if (store.ler().viaPortao) {
        saindo ??= sairDoPortao().finally(() => { saindo = null; });
        return;
      }
      cofre.esquecer(tokenDaSessao);
      voltarAoPareamento('saiu', saida);
    },
    tentarReconectar,
    entrarDeNovo() {
      portao?.gravarUltimaRecarga(agora());
      portao?.irParaARaiz();
    },
  };
}
