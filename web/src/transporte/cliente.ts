// O cliente único do motor: toda chamada do front passa por aqui. O navegador fala direto com
// a API do motor, com `Authorization: Bearer` quando há token e `x-farol: 1` em todo POST. Não
// há rota de API no Next, e o motor não lê cookie.
//
// A sessão pelo portão (um login na frente, na mesma origem, que injeta o Bearer de uma sessão do
// motor em todo pedido que repassa; ver web/README.md): o portão reconhece quem está logado pelo
// cookie DELE, então nesse modo, e na sondagem que descobre o modo, o pedido leva o cookie da
// própria origem (`same-origin`, que nunca vai a outra origem). Fora disso, `omit`. E o 401 de um
// pedido sem token, que no modo do pareamento não avisa ninguém, no modo do portão avisa: é a
// sessão do login da frente que acabou.
//
// Nada aqui lança: get e post devolvem um Resultado, e o corpo só chega a quem chamou depois
// de passar pelo leitor da borda (um dos leitores de src/contratos).
import { OCIOSO_MS, RECUO_INICIAL_MS, proximoRecuo } from './recuo';
import { criarLeitorDeSse } from './sse';
import type { CofreDoToken } from './token';

// cancelado: quem chamou abortou (o AbortSignal dele) ou a sessão acabou (cancelarChamadas).
// Não é falha do motor, e quem recebe não deve gravar nada por causa dela.
export type Falha = 'rede' | 'nao_autenticado' | 'recusado' | 'resposta_invalida' | 'cancelado';

// O que o motor diz no corpo de uma recusa (o 400 de GET /api/decisions, por exemplo): o
// código (`code`) e, quando ele manda, o campo recusado (`campo`). Só esses dois saem do
// corpo, e só com forma de identificador: o resto da recusa não chega a quem chamou.
export interface DetalheDaRecusa {
  codigo: string;
  campo?: string;
}

export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: Falha; status: number; detalhe?: DetalheDaRecusa };

// Confere o corpo cru e devolve o tipo, ou null quando a forma não é a esperada.
export type Leitor<T> = (bruto: unknown) => T | null;

export interface OpcoesDaChamada {
  // aborta só esta chamada
  sinal?: AbortSignal;
  // leva o cookie da própria origem mesmo fora do modo do portão (a sondagem que descobre o modo)
  comCookie?: boolean;
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
  // true quando a sessão vem do portão: os pedidos levam o cookie da origem e o 401 sem token avisa
  viaPortao?: () => boolean;
}

type Desfecho = 'caiu' | 'falhou' | 'nao_autenticado' | 'outro_token';

// O código e o campo de uma recusa são identificadores do motor: letra, depois letras,
// dígitos, sublinhado ou hífen, até 80 (`parametro_invalido`, `pageSize`, `codigo-invalido`).
// Texto de outra forma não vira detalhe.
const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

function identificador(valor: unknown): string | undefined {
  return typeof valor === 'string' && IDENTIFICADOR.test(valor) ? valor : undefined;
}

// O corpo de uma resposta fora de 2xx vem de quem recusou, que pode não ser o motor (um proxy
// no caminho). Só é lido quando se declara JSON, até este tamanho e dentro deste prazo:
// corpo maior, sem fim ou parado é largado, e a recusa segue só com o status.
export const TETO_DO_CORPO_DA_RECUSA = 16 * 1024;
export const PRAZO_DO_CORPO_DA_RECUSA_MS = 2000;
const TIPO_JSON = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i;

async function corpoDaRecusa(resposta: Response): Promise<unknown> {
  if (!TIPO_JSON.test(resposta.headers.get('content-type') ?? '') || !resposta.body) return undefined;
  const leitor = resposta.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((resolver) => { relogio = setTimeout(() => resolver(null), PRAZO_DO_CORPO_DA_RECUSA_MS); });
  try {
    for (;;) {
      const lido = await Promise.race([leitor.read(), prazo]);
      if (lido === null) return undefined;
      if (lido.done) break;
      total += lido.value.byteLength;
      if (total > TETO_DO_CORPO_DA_RECUSA) return undefined;
      pedacos.push(lido.value);
    }
    const bytes = new Uint8Array(total);
    let onde = 0;
    for (const pedaco of pedacos) {
      bytes.set(pedaco, onde);
      onde += pedaco.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(relogio);
    // solta o que sobrou do corpo; o cancelamento que falha não muda nada
    void leitor.cancel().catch(() => {});
  }
}

// Lê o código e o campo do corpo de uma recusa. Corpo que não foi lido, que não é objeto ou
// que não traz código não vira detalhe: a recusa segue só com o status.
async function detalheDaRecusa(resposta: Response): Promise<DetalheDaRecusa | undefined> {
  const bruto = await corpoDaRecusa(resposta);
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return undefined;
  const { code, campo } = bruto as Record<string, unknown>;
  const codigo = identificador(code);
  if (!codigo) return undefined;
  const lido = identificador(campo);
  return lido ? { codigo, campo: lido } : { codigo };
}

const CANCELADO = Object.freeze({ ok: false, falha: 'cancelado', status: 0 }) satisfies Resultado<never>;

export function criarCliente({ base, cofre, aoNaoAutenticado, registrar = () => {}, buscar = (u, i) => globalThis.fetch(u, i), viaPortao = () => false }: DependenciasDoCliente): Cliente {
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
  // No modo do portão o pedido vai sem token, e o 401 é a sessão do login da frente que acabou:
  // avisa sempre (quem ouve protege contra o laço).
  function perderCredencial(tokenDoPedido: string): void {
    if (!tokenDoPedido && viaPortao()) { aoNaoAutenticado(); return; }
    if (!tokenDoPedido || cofre.ler() !== tokenDoPedido) return;
    cofre.esquecer(tokenDoPedido);
    if (!cofre.ler()) aoNaoAutenticado();
  }

  function credenciais(comCookie = false): RequestCredentials {
    return comCookie || viaPortao() ? 'same-origin' : 'omit';
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
        resposta = await buscar(`${base}${caminho}`, { ...init, headers: cabecalhos(token, extras), credentials: credenciais(opcoes?.comCookie), cache: 'no-store', signal: controle.signal });
      } catch {
        return cancelado() ? CANCELADO : { ok: false, falha: 'rede', status: 0 };
      }
      // A resposta que chega depois do cancelamento não vale: nem o 401 dela mexe no token.
      if (cancelado()) return CANCELADO;
      if (resposta.status === 401) {
        perderCredencial(token);
        return { ok: false, falha: 'nao_autenticado', status: 401 };
      }
      if (!resposta.ok) {
        const detalhe = await detalheDaRecusa(resposta);
        if (cancelado()) return CANCELADO;
        return detalhe ? { ok: false, falha: 'recusado', status: resposta.status, detalhe } : { ok: false, falha: 'recusado', status: resposta.status };
      }
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
            credentials: credenciais(),
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
