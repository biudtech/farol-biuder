import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_DO_TOKEN, criarCofreDoToken } from '@/transporte/token';
import { criarApp } from './app';

const BASE = 'http://127.0.0.1:47170';
const TOKEN = 't'.repeat(43);
const APP = { name: 'Farol', version: '3.0.0-dev', platform: 'linux' };

interface Pedido { url: string; init: RequestInit }
type Resposta = (p: Pedido) => Response | Promise<Response>;
type OuvinteDeArmazenamento = (evento: { key: string | null }) => void;

// Faz as vezes da janela: guarda quem ouve o evento storage e deixa o teste dispará-lo.
function janelaFalsa() {
  const ouvintes = new Set<OuvinteDeArmazenamento>();
  return {
    ouvintes,
    addEventListener: (_tipo: 'storage', ouvinte: OuvinteDeArmazenamento) => { ouvintes.add(ouvinte); },
    removeEventListener: (_tipo: 'storage', ouvinte: OuvinteDeArmazenamento) => { ouvintes.delete(ouvinte); },
    disparar: (key: string | null) => { for (const ouvinte of [...ouvintes]) ouvinte({ key }); },
  };
}

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

interface Montagem { token?: string; base?: string; guardado?: Map<string, string>; aoGravar?: () => void }

// `guardado` faz as vezes do localStorage: duas montagens sobre o mesmo mapa são duas abas.
// `aoGravar` é chamado depois de cada escrita, como o navegador faz com as outras abas.
function montar({ token = '', base = BASE, guardado = new Map<string, string>(), aoGravar = () => {} }: Montagem = {}) {
  const escritas = { total: 0 };
  const cofre = criarCofreDoToken(() => ({
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => { guardado.set(k, v); escritas.total += 1; aoGravar(); },
    removeItem: (k: string) => { guardado.delete(k); escritas.total += 1; aoGravar(); },
  }));
  if (token) guardado.set(CHAVE_DO_TOKEN, token);
  const janela = janelaFalsa();
  const pedidos: Pedido[] = [];
  // uma resposta por caminho; caminho sem resposta é falha de rede
  const rotas = new Map<string, Resposta>();
  const avisos: string[] = [];
  const app = criarApp({
    base,
    cofre,
    janela,
    registrar: (aviso) => { avisos.push(aviso); },
    buscar: async (url, init = {}) => {
      const pedido = { url: String(url), init };
      pedidos.push(pedido);
      const rota = rotas.get(pedido.url.replace(BASE, ''));
      if (!rota) throw new TypeError('Failed to fetch');
      return rota(pedido);
    },
  });
  return { app, cofre, guardado, pedidos, rotas, avisos, janela, escritas };
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

    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP, status: 'idle', chaveNova: 1 })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP, status: 'idle' });

    fluxo.enviar('event: state-patch\ndata: {"campos":{"status":"checking"},"removidos":[]}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP, status: 'checking' });

    // a linha nova do feed de uma sessão chega no evento activity, entre um estado e outro
    fluxo.enviar('event: activity\ndata: {"id":"a1","item":{"t":5,"k":"tool","text":"lendo o diff"},"lidos":2}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot?.activity).toEqual({ a1: [{ t: 5, k: 'tool', text: 'lendo o diff' }] });
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
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', snapshot: null, motivo: 'nao-autenticado' });
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
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', snapshot: null, motivo: 'saiu' });
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
    expect(t.janela.ouvintes.size).toBe(0);
  });

  it('401 em /api/auth/status sem token não faz laço: uma sondagem só, e o motor aparece como inalcançável', async () => {
    const t = montar();
    // um proxy na frente do motor que responde 401 até na rota pública
    t.rotas.set('/api/auth/status', () => json({ error: 'nao_autenticado' }, 401));
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(120000);
    expect(t.pedidos).toHaveLength(1);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'inalcancavel', motivo: 'nenhum' });
  });

  it('entrar direto com token guardado não pede foco; parear pede', async () => {
    const direto = montar({ token: TOKEN });
    direto.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    direto.app.iniciar();
    expect(direto.app.store.ler().entrouAgora).toBe(false);

    const t = montar();
    t.rotas.set('/api/auth/pair', () => json({ ok: true, token: TOKEN }));
    t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    t.app.iniciar();
    await t.app.parear('ABCDE23456', '');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', entrouAgora: true, motivo: 'nenhum' });
  });

  describe('outra aba mexeu no token (evento storage)', () => {
    it('o token sumiu: esta aba fecha o fluxo e vai ao pareamento, dizendo por quê', async () => {
      const t = montar({ token: TOKEN });
      let fluxo!: ReturnType<typeof fluxoFalso>;
      t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
      t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP })}\n\n`);
      await vi.advanceTimersByTimeAsync(0);

      t.guardado.delete(CHAVE_DO_TOKEN);
      t.janela.disparar(CHAVE_DO_TOKEN);
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', snapshot: null, motivo: 'outra-aba' });
      expect((t.pedidos[0]?.init.signal as AbortSignal).aborted).toBe(true);
      expect(t.cofre.ler()).toBe('');
      // quem ouve não escreve no armazenamento: é o que impede o laço entre abas
      expect(t.escritas.total).toBe(0);
      await vi.advanceTimersByTimeAsync(120000);
      expect(t.pedidos.filter((p) => p.url.endsWith('/api/events'))).toHaveLength(1);
    });

    it('localStorage.clear() em outra aba (chave nula) vale como o token ter sumido', async () => {
      const t = montar({ token: TOKEN });
      t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      t.guardado.clear();
      t.janela.disparar(null);
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'outra-aba' });
    });

    it('mudança em outra chave não mexe em nada', async () => {
      const t = montar({ token: TOKEN });
      t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      t.guardado.set('farol-tema', 'light');
      t.janela.disparar('farol-tema');
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });
      expect(t.pedidos).toHaveLength(1);
    });

    it('pareou em outra aba: esta sai do pareamento e abre o fluxo com o token novo', async () => {
      const t = montar();
      t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.app.store.ler().sessao).toBe('pareamento');

      t.guardado.set(CHAVE_DO_TOKEN, TOKEN);
      t.janela.disparar(CHAVE_DO_TOKEN);
      await vi.advanceTimersByTimeAsync(0);
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado', motivo: 'nenhum', entrouAgora: true });
      const fluxo = t.pedidos.find((p) => p.url.endsWith('/api/events'));
      expect(new Headers(fluxo?.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(t.escritas.total).toBe(0);
    });

    it('o token trocou em outra aba: o fluxo reabre com o novo, sem passar pelo pareamento', async () => {
      const t = montar({ token: TOKEN });
      const novo = 'n'.repeat(43);
      t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      t.guardado.set(CHAVE_DO_TOKEN, novo);
      t.janela.disparar(CHAVE_DO_TOKEN);
      await vi.advanceTimersByTimeAsync(0);
      const fluxos = t.pedidos.filter((p) => p.url.endsWith('/api/events'));
      expect(fluxos).toHaveLength(2);
      expect((fluxos[0]?.init.signal as AbortSignal).aborted).toBe(true);
      expect(new Headers(fluxos[1]?.init.headers).get('authorization')).toBe(`Bearer ${novo}`);
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });

      // o mesmo evento de novo (o navegador pode repetir) não reabre nada
      t.janela.disparar(CHAVE_DO_TOKEN);
      await vi.advanceTimersByTimeAsync(0);
      expect(t.pedidos.filter((p) => p.url.endsWith('/api/events'))).toHaveLength(2);
    });

    it('sem endereço do motor ninguém ouve o armazenamento', () => {
      const t = montar({ base: '' });
      t.app.iniciar();
      expect(t.janela.ouvintes.size).toBe(0);
    });

    // Duas abas de verdade: o que uma grava dispara o evento na outra, como no navegador.
    it('duas abas: sair numa leva a outra ao pareamento, parear numa conecta a outra, e ninguém entra em laço', async () => {
      const guardado = new Map<string, string>([[CHAVE_DO_TOKEN, TOKEN]]);
      const novo = 'n'.repeat(43);
      // eslint-disable-next-line prefer-const
      let b: ReturnType<typeof montar>;
      const a = montar({ guardado, aoGravar: () => { b.janela.disparar(CHAVE_DO_TOKEN); } });
      b = montar({ guardado, aoGravar: () => { a.janela.disparar(CHAVE_DO_TOKEN); } });
      for (const t of [a, b]) {
        t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
        t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
        t.app.iniciar();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect([a.app.store.ler().sessao, b.app.store.ler().sessao]).toEqual(['pareado', 'pareado']);

      a.app.sair();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu' });
      expect(b.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'outra-aba' });
      expect([a.escritas.total, b.escritas.total]).toEqual([1, 0]);

      b.rotas.set('/api/auth/pair', () => json({ ok: true, token: novo }));
      expect(await b.app.parear('ABCDE23456', '')).toBe('pareado');
      await vi.advanceTimersByTimeAsync(0);
      expect(a.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });
      expect(b.app.store.ler()).toMatchObject({ sessao: 'pareado', conexao: 'conectado' });
      expect([a.escritas.total, b.escritas.total]).toEqual([1, 1]);
      const pedidosAntes = a.pedidos.length + b.pedidos.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(a.pedidos.length + b.pedidos.length).toBe(pedidosAntes);
    });

    it('duas abas com o token revogado: a primeira leva o 401 e apaga, a segunda também chega ao pareamento', async () => {
      const guardado = new Map<string, string>([[CHAVE_DO_TOKEN, TOKEN]]);
      // eslint-disable-next-line prefer-const
      let b: ReturnType<typeof montar>;
      const a = montar({ guardado, aoGravar: () => { b.janela.disparar(CHAVE_DO_TOKEN); } });
      b = montar({ guardado, aoGravar: () => { a.janela.disparar(CHAVE_DO_TOKEN); } });
      for (const t of [a, b]) {
        t.rotas.set('/api/events', () => json({ error: 'nao_autenticado' }, 401));
        t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
        t.app.iniciar();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(a.app.store.ler().sessao).toBe('pareamento');
      expect(b.app.store.ler().sessao).toBe('pareamento');
      expect(guardado.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('sair com chamada em curso', () => {
    it('aborta a chamada, e a resposta que chega depois não grava nada no store', async () => {
      const t = montar({ token: TOKEN });
      t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);

      // uma sondagem pendurada, que só responde depois do sair
      const soltar: Array<(r: Response) => void> = [];
      t.rotas.set('/api/auth/status', () => new Promise<Response>((resolver) => { soltar.push(resolver); }));
      const antiga = t.app.verificarMotor();
      const outra = t.app.cliente.get('/api/auth/status', (bruto) => bruto);
      await vi.advanceTimersByTimeAsync(0);
      const emCurso = t.pedidos.filter((p) => p.url.endsWith('/api/auth/status'));
      expect(emCurso).toHaveLength(2);

      t.app.sair();
      expect(emCurso.map((p) => (p.init.signal as AbortSignal).aborted)).toEqual([true, true]);
      // a resposta antiga chega: dizia que o motor estava alcançável
      soltar[0]?.(json({ exigida: true, autenticado: true }));
      soltar[1]?.(json({ exigida: true, autenticado: true }));
      await antiga;
      expect(await outra).toEqual({ ok: false, falha: 'cancelado', status: 0 });
      // quem manda no estado é a sondagem nova (a que o pareamento abriu), ainda sem resposta
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'verificando', snapshot: null });
      soltar[2]?.(json({ exigida: true, autenticado: false }));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.app.store.ler().motor).toBe('alcancavel');
    });

    it('pareamento cancelado no meio não guarda token nem muda a tela', async () => {
      const t = montar();
      let soltar!: (r: Response) => void;
      t.rotas.set('/api/auth/pair', () => new Promise<Response>((resolver) => { soltar = resolver; }));
      const encerrar = t.app.iniciar();
      const pareando = t.app.parear('ABCDE23456', '');
      await vi.advanceTimersByTimeAsync(0);
      encerrar();
      soltar(json({ ok: true, token: TOKEN }));
      expect(await pareando).toBe('cancelado');
      expect(t.guardado.size).toBe(0);
      expect(t.app.store.ler().sessao).toBe('pareamento');
    });
  });

  it('exceção ao ler um evento chega ao registro e não derruba a conexão', async () => {
    const t = montar({ token: TOKEN });
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    // um assinante do store que quebra ao redesenhar
    const parar = t.app.store.assinar(() => { throw new Error('tela quebrou'); });
    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    parar();
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]).toMatch(/^fluxo de eventos:/);
    expect(t.app.store.ler().conexao).toBe('conectado');
    expect(t.pedidos.filter((p) => p.url.endsWith('/api/events'))).toHaveLength(1);
  });
});
