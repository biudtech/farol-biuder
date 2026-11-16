import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRAZO_DO_CORPO_DA_RECUSA_MS, TETO_DO_CORPO_DA_RECUSA, criarCliente, type Conexao } from './cliente';
import { LIMITE_DO_EVENTO } from './sse';
import { criarCofreDoToken } from './token';

const BASE = 'https://farol.exemplo.com';
const TOKEN = 't'.repeat(43);

interface Pedido { url: string; init: RequestInit }

// `dados` faz as vezes do localStorage: dois cofres sobre o mesmo mapa são duas abas.
function cofreCom(token: string, dados = new Map<string, string>()) {
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
    enviarBytes: (bytes: Uint8Array) => controle.enqueue(bytes),
    fim: () => controle.close(),
  };
}

function montar(token = TOKEN, dados = new Map<string, string>()) {
  const pedidos: Pedido[] = [];
  const respostas: Array<(p: Pedido) => Response | Promise<Response>> = [];
  const cofre = cofreCom(token, dados);
  const aoNaoAutenticado = vi.fn();
  const registros: string[] = [];
  const cliente = criarCliente({
    base: BASE,
    cofre,
    aoNaoAutenticado,
    registrar: (aviso) => { registros.push(aviso); },
    buscar: async (url, init = {}) => {
      const pedido = { url: String(url), init };
      pedidos.push(pedido);
      const proxima = respostas.shift();
      if (!proxima) throw new TypeError('Failed to fetch');
      return proxima(pedido);
    },
  });
  return { cliente, pedidos, respostas, cofre, aoNaoAutenticado, dados, registros };
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

  it('401 num pedido sem token não avisa: sem credencial não há o que perder', async () => {
    const t = montar('');
    t.respostas.push(() => json({ error: 'nao_autenticado' }, 401));
    const r = await t.cliente.get('/api/auth/status', objeto);
    expect(r).toEqual({ ok: false, falha: 'nao_autenticado', status: 401 });
    expect(t.aoNaoAutenticado).not.toHaveBeenCalled();
  });

  it('duas abas: o 401 do token antigo, que esta aba tem na memória, não apaga o token novo que a outra guardou', async () => {
    const t = montar();
    const novo = 'n'.repeat(43);
    // a outra aba pareou de novo: o armazenamento passa a ter o token novo
    cofreCom('', t.dados).salvar(novo);
    expect(t.cofre.ler()).toBe(TOKEN);
    t.respostas.push(() => json({ error: 'nao_autenticado' }, 401));
    await t.cliente.get('/api/team', objeto);
    expect(t.dados.get('farol-auth-token')).toBe(novo);
    expect(t.cofre.ler()).toBe(novo);
    expect(t.aoNaoAutenticado).not.toHaveBeenCalled();
  });

  it('get e post levam o AbortSignal de quem chamou, e o cancelamento não vira falha de rede', async () => {
    const t = montar();
    const controle = new AbortController();
    const pendura = (p: Pedido) => new Promise<Response>((_, recusar) => {
      p.init.signal?.addEventListener('abort', () => recusar(new DOMException('abortado', 'AbortError')));
    });
    t.respostas.push(pendura, pendura);
    const g = t.cliente.get('/api/team', objeto, { sinal: controle.signal });
    const p = t.cliente.post('/api/check', {}, objeto, { sinal: controle.signal });
    controle.abort();
    expect(await g).toEqual({ ok: false, falha: 'cancelado', status: 0 });
    expect(await p).toEqual({ ok: false, falha: 'cancelado', status: 0 });
    expect(t.cofre.ler()).toBe(TOKEN);
  });

  it('sinal já abortado nem chega a pedir', async () => {
    const t = montar();
    const controle = new AbortController();
    controle.abort();
    expect(await t.cliente.get('/api/team', objeto, { sinal: controle.signal })).toEqual({ ok: false, falha: 'cancelado', status: 0 });
    expect(t.pedidos).toHaveLength(0);
  });

  it('cancelarChamadas aborta o que está em curso, e a resposta que chega depois não é lida nem derruba o token', async () => {
    const t = montar();
    let soltar!: (r: Response) => void;
    const leitor = vi.fn(objeto);
    // um motor que responde mesmo depois do abort: o 401 atrasado não pode valer
    t.respostas.push(() => new Promise<Response>((resolver) => { soltar = resolver; }));
    const g = t.cliente.get('/api/team', leitor);
    await Promise.resolve();
    t.cliente.cancelarChamadas();
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    soltar(json({ error: 'nao_autenticado' }, 401));
    expect(await g).toEqual({ ok: false, falha: 'cancelado', status: 0 });
    expect(leitor).not.toHaveBeenCalled();
    expect(t.cofre.ler()).toBe(TOKEN);
    expect(t.aoNaoAutenticado).not.toHaveBeenCalled();

    // o que é chamado depois do cancelamento segue normal
    t.respostas.push(() => json({ a: 1 }));
    expect(await t.cliente.get('/api/team', objeto)).toEqual({ ok: true, dados: { a: 1 } });
  });

  it('corpo que chega depois do cancelamento não passa pelo leitor', async () => {
    const t = montar();
    const leitor = vi.fn(objeto);
    t.respostas.push(() => {
      const resposta = json({ a: 1 });
      // o cancelamento acontece entre os cabeçalhos e o corpo
      vi.spyOn(resposta, 'json').mockImplementation(async () => { t.cliente.cancelarChamadas(); return { a: 1 }; });
      return resposta;
    });
    expect(await t.cliente.get('/api/team', leitor)).toEqual({ ok: false, falha: 'cancelado', status: 0 });
    expect(leitor).not.toHaveBeenCalled();
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

  it('a recusa com código no corpo entrega o código e o campo, e só eles', async () => {
    const t = montar();
    t.respostas.push(() => json({ ok: false, code: 'parametro_invalido', campo: 'veredito', sobra: 'x' }, 400));
    expect(await t.cliente.get('/api/decisions?veredito=x', objeto)).toEqual({
      ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'veredito' },
    });
    // código sem campo, e campo de forma errada, que conta como ausente
    t.respostas.push(() => json({ code: 'modo_invalido' }, 400));
    t.respostas.push(() => json({ code: 'parametro_invalido', campo: 7 }, 400));
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'modo_invalido' } });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido' } });
  });

  it('recusa sem código, com corpo que não é JSON ou com texto longo demais não leva detalhe', async () => {
    const t = montar();
    t.respostas.push(() => new Response('<html>', { status: 502 }));
    t.respostas.push(() => json({ code: 'c'.repeat(81), campo: 'q' }, 400));
    t.respostas.push(() => json({ code: 'parametro_invalido', campo: 'c'.repeat(81) }, 400));
    t.respostas.push(() => json(['parametro_invalido'], 400));
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 502 });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400 });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido' } });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400 });
  });

  it('código e campo só valem com a forma de identificador que o motor usa', async () => {
    const t = montar();
    const recusa = async (corpo: unknown) => {
      t.respostas.push(() => json(corpo, 400));
      return t.cliente.get('/api/x', objeto);
    };
    const semDetalhe = { ok: false, falha: 'recusado', status: 400 };
    // os campos do motor (CAMPOS, lib/engine/historico-paginado.js) e um código com hífen
    expect(await recusa({ code: 'parametro_invalido', campo: 'pageSize' })).toEqual({ ...semDetalhe, detalhe: { codigo: 'parametro_invalido', campo: 'pageSize' } });
    expect(await recusa({ code: 'codigo-invalido' })).toEqual({ ...semDetalhe, detalhe: { codigo: 'codigo-invalido' } });
    for (const torto of ['Parâmetro inválido', 'tem espaco', '<b>x</b>', '9comeca_com_digito', '_x', 'a.b', 'a\u202eb', '']) {
      expect(await recusa({ code: torto, campo: 'q' }), torto).toEqual(semDetalhe);
      expect(await recusa({ code: 'parametro_invalido', campo: torto }), torto).toEqual({ ...semDetalhe, detalhe: { codigo: 'parametro_invalido' } });
    }
  });

  it('corpo de recusa que não se declara JSON não é lido', async () => {
    const t = montar();
    const corpo = JSON.stringify({ code: 'parametro_invalido', campo: 'q' });
    t.respostas.push(() => new Response(corpo, { status: 400, headers: { 'Content-Type': 'text/html' } }));
    t.respostas.push(() => new Response(corpo, { status: 400 }));
    t.respostas.push(() => new Response(corpo, { status: 400, headers: { 'Content-Type': 'application/problem+json; charset=utf-8' } }));
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400 });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400 });
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'q' } });
  });

  it('corpo de recusa acima do teto é largado, sem detalhe', async () => {
    const t = montar();
    t.respostas.push(() => json({ code: 'parametro_invalido', campo: 'q', sobra: 'x'.repeat(TETO_DO_CORPO_DA_RECUSA) }, 400));
    expect(await t.cliente.get('/api/x', objeto)).toEqual({ ok: false, falha: 'recusado', status: 400 });
  });

  it('corpo de recusa sem fim não prende a chamada: a leitura para no teto e o corpo é cancelado', async () => {
    const t = montar();
    let puxadas = 0;
    let cancelado = false;
    const semFim = new ReadableStream<Uint8Array>({
      pull(controle) {
        puxadas += 1;
        controle.enqueue(new Uint8Array(4096).fill(0x20));
      },
      cancel() { cancelado = true; },
    });
    t.respostas.push(() => new Response(semFim, { status: 502, headers: { 'Content-Type': 'application/json' } }));
    expect(await t.cliente.post('/api/review', {}, objeto)).toEqual({ ok: false, falha: 'recusado', status: 502 });
    expect(puxadas).toBeLessThan(10);
    expect(cancelado).toBe(true);
  });

  it('corpo de recusa que abre e não manda nada é largado no prazo', async () => {
    vi.useFakeTimers();
    const t = montar();
    let cancelado = false;
    const parado = new ReadableStream<Uint8Array>({ cancel() { cancelado = true; } });
    t.respostas.push(() => new Response(parado, { status: 502, headers: { 'Content-Type': 'application/json' } }));
    try {
      const chamada = t.cliente.post('/api/review', {}, objeto);
      let resolvida = false;
      void chamada.then(() => { resolvida = true; });
      await vi.advanceTimersByTimeAsync(PRAZO_DO_CORPO_DA_RECUSA_MS - 1);
      expect(resolvida).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await chamada).toEqual({ ok: false, falha: 'recusado', status: 502 });
      expect(cancelado).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

    // voltou e entregou evento: o recuo recomeça em 3 s na queda seguinte
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    await vi.advanceTimersByTimeAsync(30000);
    expect(conexoes.at(-1)).toBe('conectado');
    fluxo.enviar('event: ping\ndata: 1\n\n');
    await vi.advanceTimersByTimeAsync(0);
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

  // Duas abas com o mesmo token revogado: a primeira leva o 401 e apaga o armazenamento. A
  // segunda nunca gravou o token na memória (leu do armazenamento) e leva o 401 com o cofre
  // já vazio. Ela também tem de ir ao pareamento, e não ficar sem timer e sem tela.
  it('401 no fluxo com o cofre já esvaziado por outra aba avisa e não deixa timer', async () => {
    const dados = new Map<string, string>([['farol-auth-token', TOKEN]]);
    const t = montar('', dados);
    t.respostas.push(() => { dados.delete('farol-auth-token'); return json({ error: 'nao_autenticado' }, 401); });
    const { fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(cabecalhos(t.pedidos[0]).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(t.aoNaoAutenticado).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.pedidos).toHaveLength(1);
    fechar();
  });

  it('401 no fluxo com OUTRO token no cofre tenta de novo com o atual, sem ir ao pareamento', async () => {
    const dados = new Map<string, string>([['farol-auth-token', TOKEN]]);
    const t = montar('', dados);
    const novo = 'n'.repeat(43);
    let fluxo!: ReturnType<typeof fluxoFalso>;
    // enquanto o pedido com o token antigo estava no ar, a outra aba pareou de novo
    t.respostas.push(() => { dados.set('farol-auth-token', novo); return json({ error: 'nao_autenticado' }, 401); });
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { conexoes, eventos, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pedidos).toHaveLength(2);
    expect(cabecalhos(t.pedidos[1]).get('authorization')).toBe(`Bearer ${novo}`);
    expect(t.aoNaoAutenticado).not.toHaveBeenCalled();
    expect(dados.get('farol-auth-token')).toBe(novo);
    expect(conexoes.at(-1)).toBe('conectado');
    fluxo.enviar('event: ping\ndata: 1\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos).toEqual([['ping', '1']]);
    fechar();
  });

  it('se o token atual também é recusado, apaga e vai ao pareamento', async () => {
    const dados = new Map<string, string>([['farol-auth-token', TOKEN]]);
    const t = montar('', dados);
    const novo = 'n'.repeat(43);
    t.respostas.push(() => { dados.set('farol-auth-token', novo); return json({ error: 'nao_autenticado' }, 401); });
    t.respostas.push(() => json({ error: 'nao_autenticado' }, 401));
    abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pedidos).toHaveLength(2);
    expect(dados.size).toBe(0);
    expect(t.aoNaoAutenticado).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('401 no fluxo com o armazenamento que não deixa apagar vai ao pareamento, sem laço de pedidos', async () => {
    const pedidos: Pedido[] = [];
    const aoNaoAutenticado = vi.fn();
    const cliente = criarCliente({
      base: BASE,
      aoNaoAutenticado,
      cofre: criarCofreDoToken(() => ({
        getItem: () => TOKEN,
        setItem: () => { throw new Error('bloqueado'); },
        removeItem: () => { throw new Error('bloqueado'); },
      })),
      buscar: async (url, init = {}) => { pedidos.push({ url: String(url), init }); return json({ error: 'nao_autenticado' }, 401); },
    });
    cliente.abrirFluxo({ aoEvento: () => {}, aoMudarConexao: () => {} });
    await vi.advanceTimersByTimeAsync(120000);
    expect(pedidos).toHaveLength(1);
    expect(aoNaoAutenticado).toHaveBeenCalledTimes(1);
  });

  it('o prazo de silêncio vale antes dos cabeçalhos: pedido que não responde em 90 s é derrubado e tentado de novo', async () => {
    const t = montar();
    // um proxy que aceita a conexão e segura a resposta
    t.respostas.push((p) => new Promise<Response>((_, recusar) => {
      p.init.signal?.addEventListener('abort', () => recusar(new DOMException('abortado', 'AbortError')));
    }));
    const { conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(89999);
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(false);
    expect(conexoes).toEqual(['conectando']);
    await vi.advanceTimersByTimeAsync(1);
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    expect(conexoes).toEqual(['conectando', 'sem-motor']);
    await vi.advanceTimersByTimeAsync(2999);
    expect(t.pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.pedidos).toHaveLength(2);
    fechar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('motor que aceita e fecha em seguida não zera o recuo: a espera cresce de 3 a 30 s', async () => {
    const t = montar();
    const aceitaEFecha = (p: Pedido) => { const f = fluxoFalso(p.init); f.fim(); return f.resposta; };
    for (let i = 0; i < 7; i++) t.respostas.push(aceitaEFecha);
    const { conexoes, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    expect(conexoes).toEqual(['conectando', 'conectado', 'reconectando']);
    const esperas = [3000, 6000, 12000, 24000, 30000, 30000];
    for (const [i, espera] of esperas.entries()) {
      await vi.advanceTimersByTimeAsync(espera - 1);
      expect(t.pedidos, `antes da espera ${i}`).toHaveLength(1 + i);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.pedidos, `depois da espera ${i}`).toHaveLength(2 + i);
    }
    fechar();
  });

  it('exceção de quem lê o evento não derruba a conexão: é registrada uma vez e o fluxo segue', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const recebidos: string[] = [];
    const conexoes: Conexao[] = [];
    const fechar = t.cliente.abrirFluxo({
      aoEvento: (tipo, dados) => {
        if (tipo === 'ruim') throw new TypeError(`leitor quebrou com ${dados}`);
        recebidos.push(dados);
      },
      aoMudarConexao: (c) => { conexoes.push(c); },
    });
    await vi.advanceTimersByTimeAsync(0);
    fluxo.enviar('event: ruim\ndata: segredo\n\nevent: bom\ndata: 1\n\nevent: ruim\ndata: 2\n\n');
    fluxo.enviar('event: ruim\ndata: 3\n\nevent: bom\ndata: 4\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(recebidos).toEqual(['1', '4']);
    expect(conexoes).toEqual(['conectando', 'conectado']);
    expect(t.pedidos).toHaveLength(1);
    expect(t.registros).toHaveLength(1);
    expect(t.registros[0]).toContain('ruim');
    // o registro não leva o dado do evento
    expect(t.registros[0]).not.toContain('segredo');
    fechar();
  });

  it('evento que passa do teto do leitor derruba a conexão e reconecta', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { conexoes, eventos, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    const pedaco = `data: ${'x'.repeat(1024 * 1024)}`;
    for (let i = 0; i <= LIMITE_DO_EVENTO / pedaco.length + 1; i++) fluxo.enviar(pedaco);
    await vi.advanceTimersByTimeAsync(0);
    expect(conexoes.at(-1)).toBe('reconectando');
    expect(eventos).toEqual([]);
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.pedidos).toHaveLength(2);
    fechar();
  });

  it('caractere UTF-8 partido entre dois pedaços chega inteiro', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.respostas.push((p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const { eventos, fechar } = abrir(t);
    await vi.advanceTimersByTimeAsync(0);
    const bytes = new TextEncoder().encode('event: toast\ndata: revisão concluída, 100 € 🚨\n\n');
    // um byte por pedaço: todo caractere de mais de um byte é partido
    for (const byte of bytes) fluxo.enviarBytes(Uint8Array.of(byte));
    await vi.advanceTimersByTimeAsync(0);
    expect(eventos).toEqual([['toast', 'revisão concluída, 100 € 🚨']]);
    fechar();
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
