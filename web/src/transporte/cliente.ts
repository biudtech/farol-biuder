// O cliente único do motor: toda chamada do front passa por aqui. O navegador fala direto com
// a API do motor, com `Authorization: Bearer` quando há token e `x-farol: 1` em todo POST. Não
// há cookie nem rota de API no Next.
//
// Nada aqui lança: get e post devolvem um Resultado, e o corpo só chega a quem chamou depois
// de passar pelo leitor da borda (um dos leitores de src/contratos).
import { OCIOSO_MS, RECUO_INICIAL_MS, proximoRecuo } from './recuo';
import { criarLeitorDeSse } from './sse';
import type { CofreDoToken } from './token';

// cancelado: quem chamou abortou (o AbortSignal dele) ou a sessão acabou (cancelarChamadas).
// Não é falha do motor, e quem recebe não deve gravar nada por causa dela.
export type Falha = 'rede' | 'nao_autenticado' | 'recusado' | 'resposta_invalida' | 'cancelado';

export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: Falha; status: number };

// Confere o corpo cru e devolve o tipo, ou null quando a forma não é a esperada.
export type Leitor<T> = (bruto: unknown) => T | null;

export interface OpcoesDaChamada {
  // aborta só esta chamada
  sinal?: AbortSignal;
}

// conectando: primeira tentativa. reconectando: caiu e vai tentar. sem-motor: tentou e o
// motor não respondeu com o fluxo (continua tentando, com recuo).
export type Conexao = 'conectando' | 'conectado' | 'reconectando' | 'sem-motor';

export interface OuvinteDoFluxo {
  // Se lançar, o evento é descartado e o fluxo segue (a exceção é registrada uma vez).
  aoEvento(tipo: string, dados: string): void;
  aoMudarConexao(conexao: Conexao): void;
}

export interface Cliente {
  get<T>(caminho: string, ler: Leitor<T>, opcoes?: OpcoesDaChamada): Promise<Resultado<T>>;
  post<T>(caminho: string, corpo: unknown, ler: Leitor<T>, opcoes?: OpcoesDaChamada): Promise<Resultado<T>>;
  // Aborta todo get e post em curso: cada um devolve `cancelado`, e a resposta que ainda
  // chegar não é lida. O que for chamado depois segue normal. Não mexe no fluxo de eventos.
  cancelarChamadas(): void;
  // Abre GET /api/events e mantém aberto. Devolve a função que fecha.
  abrirFluxo(ouvinte: OuvinteDoFluxo): () => void;
}

export interface DependenciasDoCliente {
  // a origem do motor, saneada por enderecoDoMotor
  base: string;
  cofre: CofreDoToken;
  // chamado quando o 401 deixa esta aba sem token: quem ouve volta ao pareamento
  aoNaoAutenticado(): void;
  // o registro da borda (console do navegador); nunca recebe dado de evento nem token
  registrar?: (aviso: string) => void;
  buscar?: typeof fetch;
}

type Desfecho = 'caiu' | 'falhou' | 'nao_autenticado' | 'outro_token';

const CANCELADO = Object.freeze({ ok: false, falha: 'cancelado', status: 0 }) satisfies Resultado<never>;

export function criarCliente({ base, cofre, aoNaoAutenticado, registrar = () => {}, buscar = (u, i) => globalThis.fetch(u, i) }: DependenciasDoCliente): Cliente {
  // o sinal comum a todo get e post em curso; cancelarChamadas aborta este e abre outro
  let chamadas = new AbortController();

  function cabecalhos(token: string, extras: Record<string, string>): Record<string, string> {
    return token ? { ...extras, Authorization: `Bearer ${token}` } : extras;
  }

  // 401 num get ou post apaga o token do pedido e, se a aba ficou sem token, devolve a tela ao
  // pareamento. Três casos em que nada acontece:
  // - o pedido foi sem token: não há credencial a perder, e avisar faria laço (o pareamento
  //   sonda /api/auth/status, e um proxy que respondesse 401 ali chamaria o pareamento de novo);
  // - o cofre já tem outro token: é a resposta atrasada de um token antigo;
  // - depois de esquecer, o cofre ainda tem token (o que outra aba guardou): a sessão segue.
  function perderCredencial(tokenDoPedido: string): void {
    if (!tokenDoPedido || cofre.ler() !== tokenDoPedido) return;
    cofre.esquecer(tokenDoPedido);
    if (!cofre.ler()) aoNaoAutenticado();
  }

  async function chamar<T>(caminho: string, init: RequestInit, extras: Record<string, string>, ler: Leitor<T>, opcoes?: OpcoesDaChamada): Promise<Resultado<T>> {
    const daSessao = chamadas.signal;
    const deQuemChamou = opcoes?.sinal;
    const cancelado = (): boolean => daSessao.aborted || deQuemChamou?.aborted === true;
    if (cancelado()) return CANCELADO;

    // um controle por chamada, abortado por qualquer um dos dois sinais
    const controle = new AbortController();
    const abortar = (): void => controle.abort();
    daSessao.addEventListener('abort', abortar);
    deQuemChamou?.addEventListener('abort', abortar);
    try {
      const token = cofre.ler();
      let resposta: Response;
      try {
        resposta = await buscar(`${base}${caminho}`, { ...init, headers: cabecalhos(token, extras), credentials: 'omit', cache: 'no-store', signal: controle.signal });
      } catch {
        return cancelado() ? CANCELADO : { ok: false, falha: 'rede', status: 0 };
      }
      // A resposta que chega depois do cancelamento não vale: nem o 401 dela mexe no token.
      if (cancelado()) return CANCELADO;
      if (resposta.status === 401) {
        perderCredencial(token);
        return { ok: false, falha: 'nao_autenticado', status: 401 };
      }
      if (!resposta.ok) return { ok: false, falha: 'recusado', status: resposta.status };
      let bruto: unknown;
      try { bruto = await resposta.json(); } catch {
        return cancelado() ? CANCELADO : { ok: false, falha: 'resposta_invalida', status: resposta.status };
      }
      if (cancelado()) return CANCELADO;
      const dados = ler(bruto);
      return dados === null ? { ok: false, falha: 'resposta_invalida', status: resposta.status } : { ok: true, dados };
    } finally {
      daSessao.removeEventListener('abort', abortar);
      deQuemChamou?.removeEventListener('abort', abortar);
    }
  }

  function abrirFluxo(ouvinte: OuvinteDoFluxo): () => void {
    let fechado = false;
    let controle: AbortController | null = null;
    let espera = RECUO_INICIAL_MS;
    let relogioDoRecuo: ReturnType<typeof setTimeout> | undefined;
    let relogioOcioso: ReturnType<typeof setTimeout> | undefined;
    let leitorJaLancou = false;

    // O prazo de silêncio começa no pedido, antes dos cabeçalhos (um proxy que aceita a
    // conexão e segura a resposta não deixa o fetch pendurado sem limite), e cada pedaço que
    // chega (evento ou batimento) o renova. Estourou, o pedido é abortado daqui e a leitura
    // cai no caminho de queda.
    function renovarPrazo(): void {
      clearTimeout(relogioOcioso);
      relogioOcioso = setTimeout(() => controle?.abort(), OCIOSO_MS);
    }

    // Exceção de quem lê o evento é defeito de tela, não queda de conexão: o evento é
    // descartado, o fluxo segue, e o registro sai uma vez só (sem o dado do evento).
    function entregar(tipo: string, dados: string): void {
      try {
        ouvinte.aoEvento(tipo, dados);
      } catch (erro) {
        if (leitorJaLancou) return;
        leitorJaLancou = true;
        const nome = erro instanceof Error ? erro.name : 'erro';
        registrar(`fluxo de eventos: quem lê o evento "${tipo.slice(0, 40)}" lançou (${nome}); o evento foi descartado e o fluxo segue. Este aviso não se repete`);
      }
    }

    async function ler(sinal: AbortSignal): Promise<Desfecho> {
      const token = cofre.ler();
      renovarPrazo();
      try {
        let resposta: Response;
        try {
          resposta = await buscar(`${base}/api/events`, {
            method: 'GET',
            headers: cabecalhos(token, { Accept: 'text/event-stream' }),
            credentials: 'omit',
            cache: 'no-store',
            signal: sinal,
          });
        } catch {
          return 'falhou';
        }
        if (resposta.status === 401) {
          // Só apaga o token que foi no pedido. Depois olha o que o cofre tem AGORA: outro
          // token (outra aba pareou de novo) é tentado; vazio (este 401 o apagou, ou outra
          // aba já tinha apagado) é o pareamento. O que não pode é sair daqui calado.
          if (cofre.ler() === token) cofre.esquecer(token);
          const atual = cofre.ler();
          return atual && atual !== token ? 'outro_token' : 'nao_autenticado';
        }
        if (!resposta.ok || !resposta.body) return 'falhou';

        ouvinte.aoMudarConexao('conectado');
        const leitor = resposta.body.getReader();
        const decodificador = new TextDecoder();
        const sse = criarLeitorDeSse();
        renovarPrazo();
        try {
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) return 'caiu';
            renovarPrazo();
            // o leitor de SSE lança quando o evento passa do teto: cai no caminho de queda
            for (const evento of sse.alimentar(decodificador.decode(value, { stream: true }))) {
              if (fechado) break;
              // O recuo só volta ao início quando o fluxo entrega um evento (o motor manda o
              // `state` assim que aceita). No 200 ainda não: um motor que aceita e fecha em
              // seguida seria martelado a cada 3 s para sempre.
              espera = RECUO_INICIAL_MS;
              entregar(evento.tipo, evento.dados);
            }
          }
        } catch {
          return 'caiu';
        }
      } finally {
        clearTimeout(relogioOcioso);
      }
    }

    async function tentar(): Promise<void> {
      if (fechado) return;
      const destaTentativa = new AbortController();
      controle = destaTentativa;
      const desfecho = await ler(destaTentativa.signal);
      // solta o que sobrou do pedido: corpo que não foi lido, fluxo que o leitor recusou
      destaTentativa.abort();
      if (fechado) return;
      if (desfecho === 'outro_token') {
        void tentar();
        return;
      }
      if (desfecho === 'nao_autenticado') {
        fechado = true;
        aoNaoAutenticado();
        return;
      }
      ouvinte.aoMudarConexao(desfecho === 'caiu' ? 'reconectando' : 'sem-motor');
      const agora = espera;
      espera = proximoRecuo(espera);
      relogioDoRecuo = setTimeout(() => { void tentar(); }, agora);
    }

    ouvinte.aoMudarConexao('conectando');
    void tentar();

    return () => {
      fechado = true;
      clearTimeout(relogioDoRecuo);
      clearTimeout(relogioOcioso);
      controle?.abort();
    };
  }

  return {
    get: (caminho, ler, opcoes) => chamar(caminho, { method: 'GET' }, {}, ler, opcoes),
    post: (caminho, corpo, ler, opcoes) => chamar(caminho, { method: 'POST', body: JSON.stringify(corpo ?? {}) }, { 'Content-Type': 'application/json', 'x-farol': '1' }, ler, opcoes),
    cancelarChamadas() {
      chamadas.abort();
      chamadas = new AbortController();
    },
    abrirFluxo,
  };
}
