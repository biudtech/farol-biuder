// O cliente único do motor: toda chamada do front passa por aqui. O navegador fala direto com
// a API do motor, com `Authorization: Bearer` quando há token e `x-farol: 1` em todo POST. Não
// há cookie nem rota de API no Next.
//
// Nada aqui lança: get e post devolvem um Resultado, e o corpo só chega a quem chamou depois
// de passar pelo leitor da borda (um dos leitores de src/contratos).
import { OCIOSO_MS, RECUO_INICIAL_MS, proximoRecuo } from './recuo';
import { criarLeitorDeSse } from './sse';
import type { CofreDoToken } from './token';

export type Falha = 'rede' | 'nao_autenticado' | 'recusado' | 'resposta_invalida';

export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: Falha; status: number };

// Confere o corpo cru e devolve o tipo, ou null quando a forma não é a esperada.
export type Leitor<T> = (bruto: unknown) => T | null;

// conectando: primeira tentativa. reconectando: caiu e vai tentar. sem-motor: tentou e o
// motor não respondeu com o fluxo (continua tentando, com recuo).
export type Conexao = 'conectando' | 'conectado' | 'reconectando' | 'sem-motor';

export interface OuvinteDoFluxo {
  aoEvento(tipo: string, dados: string): void;
  aoMudarConexao(conexao: Conexao): void;
}

export interface Cliente {
  get<T>(caminho: string, ler: Leitor<T>): Promise<Resultado<T>>;
  post<T>(caminho: string, corpo: unknown, ler: Leitor<T>): Promise<Resultado<T>>;
  // Abre GET /api/events e mantém aberto. Devolve a função que fecha.
  abrirFluxo(ouvinte: OuvinteDoFluxo): () => void;
}

export interface DependenciasDoCliente {
  // a origem do motor, saneada por enderecoDoMotor
  base: string;
  cofre: CofreDoToken;
  // chamado depois de um 401 apagar o token: quem ouve volta ao pareamento
  aoNaoAutenticado(): void;
  buscar?: typeof fetch;
}

type Desfecho = 'caiu' | 'falhou' | 'nao_autenticado';

export function criarCliente({ base, cofre, aoNaoAutenticado, buscar = (u, i) => globalThis.fetch(u, i) }: DependenciasDoCliente): Cliente {
  function cabecalhos(token: string, extras: Record<string, string>): Record<string, string> {
    return token ? { ...extras, Authorization: `Bearer ${token}` } : extras;
  }

  // 401 em qualquer chamada apaga o token e devolve a tela ao pareamento. Só vale para o
  // token que foi no pedido: a resposta atrasada de um token antigo não derruba o novo.
  function perderCredencial(tokenDoPedido: string): void {
    if (cofre.ler() !== tokenDoPedido) return;
    cofre.esquecer();
    aoNaoAutenticado();
  }

  async function chamar<T>(caminho: string, init: RequestInit, extras: Record<string, string>, ler: Leitor<T>): Promise<Resultado<T>> {
    const token = cofre.ler();
    let resposta: Response;
    try {
      resposta = await buscar(`${base}${caminho}`, { ...init, headers: cabecalhos(token, extras), credentials: 'omit', cache: 'no-store' });
    } catch {
      return { ok: false, falha: 'rede', status: 0 };
    }
    if (resposta.status === 401) {
      perderCredencial(token);
      return { ok: false, falha: 'nao_autenticado', status: 401 };
    }
    if (!resposta.ok) return { ok: false, falha: 'recusado', status: resposta.status };
    let bruto: unknown;
    try { bruto = await resposta.json(); } catch { return { ok: false, falha: 'resposta_invalida', status: resposta.status }; }
    const dados = ler(bruto);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: resposta.status } : { ok: true, dados };
  }

  function abrirFluxo(ouvinte: OuvinteDoFluxo): () => void {
    let fechado = false;
    let controle: AbortController | null = null;
    let espera = RECUO_INICIAL_MS;
    let relogioDoRecuo: ReturnType<typeof setTimeout> | undefined;
    let relogioOcioso: ReturnType<typeof setTimeout> | undefined;

    // Cada pedaço que chega (evento ou batimento) renova o prazo. Estourou, a conexão é
    // derrubada daqui e a leitura cai no caminho de queda.
    function renovarPrazo(): void {
      clearTimeout(relogioOcioso);
      relogioOcioso = setTimeout(() => controle?.abort(), OCIOSO_MS);
    }

    async function ler(sinal: AbortSignal): Promise<Desfecho> {
      const token = cofre.ler();
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
        perderCredencial(token);
        return 'nao_autenticado';
      }
      if (!resposta.ok || !resposta.body) return 'falhou';

      // conexão de pé: o recuo volta ao início, senão uma queda longa deixaria a próxima
      // reconexão lenta pelo resto da sessão
      espera = RECUO_INICIAL_MS;
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
          for (const evento of sse.alimentar(decodificador.decode(value, { stream: true }))) {
            if (!fechado) ouvinte.aoEvento(evento.tipo, evento.dados);
          }
        }
      } catch {
        return 'caiu';
      } finally {
        clearTimeout(relogioOcioso);
      }
    }

    async function tentar(): Promise<void> {
      if (fechado) return;
      controle = new AbortController();
      const desfecho = await ler(controle.signal);
      if (fechado || desfecho === 'nao_autenticado') return;
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
    get: (caminho, ler) => chamar(caminho, { method: 'GET' }, {}, ler),
    post: (caminho, corpo, ler) => chamar(caminho, { method: 'POST', body: JSON.stringify(corpo ?? {}) }, { 'Content-Type': 'application/json', 'x-farol': '1' }, ler),
    abrirFluxo,
  };
}
