import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarCofreDoToken } from '@/transporte/token';
import { criarApp } from './app';

const BASE = 'http://127.0.0.1:47170';
const TOKEN = 't'.repeat(43);
const APP = { name: 'Farol', version: '3.0.0-dev', platform: 'linux' };

interface Pedido { url: string; init: RequestInit }
type Resposta = (p: Pedido) => Response;

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

function fluxoFalso(init: RequestInit) {
  const codificador = new TextEncoder();
  let controle!: ReadableStreamDefaultController<Uint8Array>;
  const corpo = new ReadableStream<Uint8Array>({ start(c) { controle = c; } });
  init.signal?.addEventListener('abort', () => {
    try { controle.error(new DOMException('abortado', 'AbortError')); } catch { /* já encerrado */ }
  });
  return { resposta: new Response(corpo, { status: 200 }), enviar: (texto: string) => controle.enqueue(codificador.encode(texto)) };
}

function montar({ token = '', base = BASE }: { token?: string; base?: string } = {}) {
  const guardado = new Map<string, string>();
  const cofre = criarCofreDoToken(() => ({
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => { guardado.set(k, v); },
    removeItem: (k: string) => { guardado.delete(k); },
  }));
  if (token) cofre.salvar(token);
  const pedidos: Pedido[] = [];
  // uma resposta por caminho; caminho sem resposta é falha de rede
  const rotas = new Map<string, Resposta>();
  const avisos: string[] = [];
  const app = criarApp({
    base,
    cofre,
    registrar: (aviso) => { avisos.push(aviso); },
    buscar: async (url, init = {}) => {
      const pedido = { url: String(url), init };
      pedidos.push(pedido);
      const rota = rotas.get(pedido.url.replace(BASE, ''));
      if (!rota) throw new TypeError('Failed to fetch');
      return rota(pedido);
    },
  });
  return { app, cofre, guardado, pedidos, rotas, avisos };
}

describe('sessão do front', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sem endereço do motor não chama nada e diz que falta configurar', async () => {
    const t = montar({ base: '' });
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().sessao).toBe('sem-endereco');
    expect(t.pedidos).toEqual([]);
  });

  it('sem token vai ao pareamento e sonda o motor, sem abrir o fluxo', async () => {
    const t = montar();
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
    t.app.iniciar();
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'verificando' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().motor).toBe('alcancavel');
    expect(t.pedidos.map((p) => p.url)).toEqual([`${BASE}/api/auth/status`]);
  });

  it('motor que não responde aparece como inalcançável no pareamento', async () => {
    const t = montar();
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'inalcancavel' });
  });

  it('código aceito guarda o token, entra e abre o fluxo', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/auth/pair', () => json({ ok: true, token: TOKEN }));
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    const desfecho = await t.app.parear('ABCDE23456', 'meu navegador');
    expect(desfecho).toBe('pareado');
    expect(t.cofre.ler()).toBe(TOKEN);
    const pair = t.pedidos.find((p) => p.url.endsWith('/api/auth/pair'));
    expect(pair?.init.body).toBe('{"codigo":"ABCDE23456","rotulo":"meu navegador"}');
    expect(new Headers(pair?.init.headers).get('x-farol')).toBe('1');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });

    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP, status: 'ok', chaveNova: 1 })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP, status: 'ok' });

    fluxo.enviar('event: state-patch\ndata: {"campos":{"status":"checking"},"removidos":[]}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP, status: 'checking' });
  });

  it('código recusado não guarda nada e continua no pareamento', async () => {
    const t = montar();
    t.rotas.set('/api/auth/pair', () => json({ ok: false, code: 'codigo_invalido' }));
    t.app.iniciar();
    expect(await t.app.parear('ERRADO2345', '')).toBe('recusado');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'alcancavel' });
  });

  it('pareamento sem resposta, ou com resposta torta, é motor inalcançável', async () => {
    const t = montar();
    t.app.iniciar();
    expect(await t.app.parear('ABCDE23456', '')).toBe('inalcancavel');
    t.rotas.set('/api/auth/pair', () => json({ ok: true, token: 'curto' }));
    expect(await t.app.parear('ABCDE23456', '')).toBe('inalcancavel');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'inalcancavel' });
  });

  it('com token guardado entra direto e abre o fluxo', async () => {
    const t = montar({ token: TOKEN });
    t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });
    expect(new Headers(t.pedidos[0]?.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('401 no fluxo apaga o token e o snapshot e volta ao pareamento', async () => {
    const t = montar({ token: TOKEN });
    t.rotas.set('/api/events', () => json({ error: 'nao_autenticado' }, 401));
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.cofre.ler()).toBe('');
    expect(t.guardado.size).toBe(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', snapshot: null });
  });

  it('sair apaga o token local, fecha o fluxo e volta ao pareamento', async () => {
    const t = montar({ token: TOKEN });
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    t.app.sair();
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', snapshot: null });
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    const antes = t.pedidos.filter((p) => p.url.endsWith('/api/events')).length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.pedidos.filter((p) => p.url.endsWith('/api/events'))).toHaveLength(antes);
  });

  it('evento de estado que não é JSON é registrado e não derruba nada', async () => {
    const t = montar({ token: TOKEN });
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP })}\n\n`);
    fluxo.enviar('event: state\ndata: {quebrado\n\nevent: toast\ndata: {"x":1}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP });
    expect(t.avisos).toHaveLength(1);
  });

  it('encerrar (a função que iniciar devolve) fecha o fluxo', async () => {
    const t = montar({ token: TOKEN });
    t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    const encerrar = t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    encerrar();
    expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
