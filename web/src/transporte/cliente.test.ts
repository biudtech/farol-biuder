import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarCliente, type Conexao } from './cliente';
import { criarCofreDoToken } from './token';

const BASE = 'https://farol.exemplo.com';
const TOKEN = 't'.repeat(43);

interface Pedido { url: string; init: RequestInit }

function cofreCom(token: string) {
  const dados = new Map<string, string>();
  const cofre = criarCofreDoToken(() => ({
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v); },
    removeItem: (k: string) => { dados.delete(k); },
  }));
  if (token) cofre.salvar(token);
  return cofre;
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

const objeto = (bruto: unknown) => (bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : null);

// Um stream de SSE controlado pelo teste: `enviar` empurra texto, `fim` encerra, e o abort do
// pedido derruba a leitura, como no navegador.
function fluxoFalso(init: RequestInit) {
  const codificador = new TextEncoder();
  let controle!: ReadableStreamDefaultController<Uint8Array>;
  const corpo = new ReadableStream<Uint8Array>({ start(c) { controle = c; } });
  init.signal?.addEventListener('abort', () => {
    try { controle.error(new DOMException('abortado', 'AbortError')); } catch { /* já encerrado */ }
  });
  return {
    resposta: new Response(corpo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    enviar: (texto: string) => controle.enqueue(codificador.encode(texto)),
    fim: () => controle.close(),
  };
}

function montar(token = TOKEN) {
  const pedidos: Pedido[] = [];
  const respostas: Array<(p: Pedido) => Response | Promise<Response>> = [];
  const cofre = cofreCom(token);
  const aoNaoAutenticado = vi.fn();
  const cliente = criarCliente({
    base: BASE,
    cofre,
    aoNaoAutenticado,
    buscar: async (url, init = {}) => {
      const pedido = { url: String(url), init };
      pedidos.push(pedido);
      const proxima = respostas.shift();
      if (!proxima) throw new TypeError('Failed to fetch');
      return proxima(pedido);
    },
  });
  return { cliente, pedidos, respostas, cofre, aoNaoAutenticado };
}

const cabecalhos = (p: Pedido | undefined) => new Headers(p?.init.headers);

describe('get e post', () => {
  it('get manda o Bearer e não manda x-farol', async () => {
    const t = montar();
    t.respostas.push(() => json({ a: 1 }));
    const r = await t.cliente.get('/api/team', objeto);
    expect(r).toEqual({ ok: true, dados: { a: 1 } });
    expect(t.pedidos[0]?.url).toBe(`${BASE}/api/team`);
    expect(t.pedidos[0]?.init.method).toBe('GET');
    expect(cabecalhos(t.pedidos[0]).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(cabecalhos(t.pedidos[0]).has('x-farol')).toBe(false);
  });

  it('post manda x-farol: 1, o Bearer e o corpo em JSON', async () => {
    const t = montar();
    t.respostas.push(() => json({ ok: true }));
    await t.cliente.post('/api/check', { a: 'b' }, objeto);
    const h = cabecalhos(t.pedidos[0]);
    expect(t.pedidos[0]?.init.method).toBe('POST');
    expect(h.get('x-farol')).toBe('1');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(t.pedidos[0]?.init.body).toBe('{"a":"b"}');
  });

  it('sem token não manda Authorization, e nunca manda cookie', async () => {
    const t = montar('');
    t.respostas.push(() => json({ ok: true }));
    await t.cliente.post('/api/auth/pair', { codigo: 'X' }, objeto);
    expect(cabecalhos(t.pedidos[0]).has('authorization')).toBe(false);
    expect(t.pedidos[0]?.init.credentials).toBe('omit');
  });

  it('401 apaga o token e avisa', async () => {
    const t = montar();
    t.respostas.push(() => json({ error: 'nao_autenticado' }, 401));
    const r = await t.cliente.get('/api/team', objeto);
    expect(r).toEqual({ ok: false, falha: 'nao_autenticado', status: 401 });
    expect(t.cofre.ler()).toBe('');
    expect(t.aoNaoAutenticado).toHaveBeenCalledTimes(1);
  });

  it('401 de um pedido feito com token antigo não apaga o token novo', async () => {
    const t = montar();
    const novo = 'n'.repeat(43);
    t.respostas.push(() => { t.cofre.salvar(novo); return json({ error: 'nao_autenticado' }, 401); });
    await t.cliente.get('/api/team', objeto);
    expect(t.cofre.ler()).toBe(novo);
    expect(t.aoNaoAutenticado).not.toHaveBeenCalled();
  });

  it('falha de rede não apaga o token', async () => {
    const t = montar();
    const r = await t.cliente.get('/api/team', objeto);
    expect(r).toEqual({ ok: false, falha: 'rede', status: 0 });
    expect(t.cofre.ler()).toBe(TOKEN);
  });

  it('outro status de erro vira recusa, com o status', async () => {
    const t = montar();
    t.respostas.push(() => json({ error: 'forbidden' }, 403));
    expect(await t.cliente.post('/api/check', {}, objeto)).toEqual({ ok: false, falha: 'recusado', status: 403 });
  });

  it('corpo que não é JSON, ou que o leitor da borda recusa, não chega a quem chamou', async () => {
    const t = montar();
    t.respostas.push(() => new Response('<html>', { status: 200 }));
    t.respostas.push(() => json([1, 2]));
    expect(await t.cliente.get('/api/team', objeto)).toEqual({ ok: false, falha: 'resposta_invalida', status: 200 });
    expect(await t.cliente.get('/api/team', () => null)).toEqual({ ok: false, falha: 'resposta_invalida', status: 200 });
  });
});

describe('fluxo de eventos', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function abrir(t: ReturnType<typeof montar>) {
    const eventos: Array<[string, string]> = [];
    const conexoes: Conexao[] = [];
    const fechar = t.cliente.abrirFluxo({
      aoEvento: (tipo, dados) => { eventos.push([tipo, dados]); },
      aoMudarConexao: (c) => { conexoes.push(c); },
    });
    return { eventos, conexoes, fechar };
  }

  it('lê /api/events por fetch com o Bearer e entrega os eventos', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { eventos, conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pedidos[0]?.url).toBe(`${BASE}/api/events`);
    expect(cabecalhos(t.pedidos[0]).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(cabecalhos(t.pedidos[0]).get('accept')).toBe('text/event-stream');
    fluxo.enviar('event: state\ndata: {"status":"ok"}\n\nevent: pi');
    fluxo.enviar('ng\ndata: 1\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos).toEqual([['state', '{"status":"ok"}'], ['ping', '1']]);
    expect(conexoes).toEqual(['conectando', 'conectado']);
    fechar();
  });

  it('queda vira reconectando; motor que não responde vira sem-motor, com recuo de 3 a 30 s', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    fluxo.fim();
    await vi.advanceTimersByTimeAsync(0);
    expect(conexoes).toEqual(['conectando', 'conectado', 'reconectando']);

    // sem resposta programada, toda tentativa falha: 3, 6, 12, 24, 30, 30 segundos
    const esperas = [3000, 6000, 12000, 24000, 30000, 30000];
    for (const [i, espera] of esperas.entries()) {
      await vi.advanceTimersByTimeAsync(espera - 1);
      expect(t.pedidos).toHaveLength(1 + i);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.pedidos).toHaveLength(2 + i);
    }
    expect(conexoes.at(-1)).toBe('sem-motor');

    // voltou: o recuo recomeça em 3 s na queda seguinte
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    await vi.advanceTimersByTimeAsync(30000);
    expect(conexoes.at(-1)).toBe('conectado');
    fluxo.fim();
    await vi.advanceTimersByTimeAsync(0);
    const antes = t.pedidos.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.pedidos).toHaveLength(antes + 1);
    fechar();
  });

  it('90 s sem nada do motor derruba a conexão e reconecta; o batimento renova o prazo', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(80000);
    fluxo.enviar('event: ping\ndata: 1\n\n');
    await vi.advanceTimersByTimeAsync(80000);
    expect(conexoes.at(-1)).toBe('conectado');
    await vi.advanceTimersByTimeAsync(10000);
    expect(conexoes.at(-1)).toBe('reconectando');
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    fechar();
  });

  it('401 no fluxo apaga o token, avisa e não tenta de novo', async () => {
    const t = montar();
    t.respostas.push(() => json({ error: 'nao_autenticado' }, 401));
    abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.cofre.ler()).toBe('');
    expect(t.aoNaoAutenticado).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.pedidos).toHaveLength(1);
  });

  it('resposta que não é o fluxo (403, 500) conta como motor fora e tenta de novo', async () => {
    const t = montar();
    t.respostas.push(() => json({ error: 'forbidden' }, 403));
    const { conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(conexoes).toEqual(['conectando', 'sem-motor']);
    expect(t.cofre.ler()).toBe(TOKEN);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.pedidos).toHaveLength(2);
    fechar();
  });

  it('fechar aborta o pedido e encerra as tentativas', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { conexoes, eventos, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    fechar();
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200000);
    expect(t.pedidos).toHaveLength(1);
    expect(conexoes).toEqual(['conectando', 'conectado']);
    expect(eventos).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
