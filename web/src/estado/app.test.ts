import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_DO_TOKEN, criarCofreDoToken } from '@/transporte/token';
import { JANELA_DA_RECARGA_MS, PRAZO_DO_SAIR_MS, criarApp, type JanelaDoPortao } from './app';

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
  return {
    resposta: new Response(corpo, { status: 200 }),
    enviar: (texto: string) => controle.enqueue(codificador.encode(texto)),
    // o motor fechou a conexão
    cair: () => controle.close(),
  };
}

interface Montagem { token?: string; base?: string; guardado?: Map<string, string>; aoGravar?: () => void; portao?: JanelaDoPortao; agora?: () => number }

// `guardado` faz as vezes do localStorage: duas montagens sobre o mesmo mapa são duas abas.
// `aoGravar` é chamado depois de cada escrita, como o navegador faz com as outras abas.
function montar({ token = '', base = BASE, guardado = new Map<string, string>(), aoGravar = () => {}, portao, agora }: Montagem = {}) {
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
    portao,
    agora,
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
    // a sondagem diz se há um portão na frente antes de a tela decidir
    expect(t.app.store.ler()).toMatchObject({ sessao: 'carregando', motor: 'verificando' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'alcancavel' });
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

  it('o toast do motor vira recado na tela: no máximo três, o torto é descartado, e sair os apaga', async () => {
    const t = montar();
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/auth/pair', () => json({ ok: true, token: TOKEN }));
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    await t.app.parear('ABCDE23456', '');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().recados).toEqual([]);

    const toast = (corpo: unknown) => fluxo.enviar(`event: toast\ndata: ${JSON.stringify(corpo)}\n\n`);
    toast({ kind: 'info', text: 'a/b#1: já havia um APPROVE seu neste PR; não postei de novo.' });
    toast({ kind: 'ok' });
    toast({ kind: 'error', text: 'Falha ao postar em a/b#2: rede' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().recados).toEqual([
      { n: 1, tom: 'info', texto: 'a/b#1: já havia um APPROVE seu neste PR; não postei de novo.' },
      { n: 2, tom: 'erro', texto: 'Falha ao postar em a/b#2: rede' },
    ]);
    expect(t.avisos.some((a) => a.includes('toast'))).toBe(true);

    toast({ kind: 'ok', text: 'três' });
    toast({ kind: 'ok', text: 'quatro' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().recados.map((r) => r.n)).toEqual([2, 3, 4]);

    t.app.dispensarRecados();
    expect(t.app.store.ler().recados).toEqual([]);
    toast({ kind: 'ok', text: 'cinco' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().recados).toHaveLength(1);
    await t.app.sair();
    expect(t.app.store.ler().recados).toEqual([]);
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
    await t.app.sair();
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
    fluxo.enviar('event: state\ndata: {quebrado\n\nevent: needs-decision\ndata: {"x":1}\n\n');
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

      await a.app.sair();
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

      const saindo = t.app.sair();
      // as chamadas das telas são abortadas na hora, antes de o motor responder ao Sair
      expect(emCurso.map((p) => (p.init.signal as AbortSignal).aborted)).toEqual([true, true]);
      await saindo;
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

describe('o estado desta conexão já chegou', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const estado = (valor: object) => `event: state\ndata: ${JSON.stringify(valor)}\n\n`;

  it('só vale depois do primeiro state de cada conexão, e cai junto com ela', async () => {
    const t = montar({ token: TOKEN });
    const fluxos: Array<ReturnType<typeof fluxoFalso>> = [];
    t.rotas.set('/api/events', (p) => { const f = fluxoFalso(p.init); fluxos.push(f); return f.resposta; });
    const encerrar = t.app.iniciar();
    expect(t.app.store.ler().estadoEmDia).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    // o motor aceitou a conexão, mas o estado ainda não veio
    expect(t.app.store.ler()).toMatchObject({ conexao: 'conectado', estadoEmDia: false });

    fluxos[0]?.enviar(estado({ app: APP, status: 'idle' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'conectado', estadoEmDia: true });

    fluxos[0]?.cair();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'reconectando', estadoEmDia: false });

    // a conexão nova abre com o snapshot velho na tela: conectado, e o estado ainda não é o dela
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fluxos).toHaveLength(2);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'conectado', estadoEmDia: false });
    expect(t.app.store.ler().snapshot?.status).toBe('idle');

    // um patch não é o estado inteiro
    fluxos[1]?.enviar(`event: state-patch\ndata: ${JSON.stringify({ set: {}, del: [] })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().estadoEmDia).toBe(false);

    fluxos[1]?.enviar(estado({ app: APP, status: 'checking' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'conectado', estadoEmDia: true });
    encerrar();
  });

  it('a queda guarda desde quando e a próxima tentativa; tentar de novo adianta e a volta limpa as duas', async () => {
    let relogio = 1_000_000;
    const t = montar({ token: TOKEN, agora: () => relogio });
    const fluxos: Array<ReturnType<typeof fluxoFalso>> = [];
    t.rotas.set('/api/events', (p) => { const f = fluxoFalso(p.init); fluxos.push(f); return f.resposta; });
    const encerrar = t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    fluxos[0]?.enviar(estado({ app: APP, status: 'idle' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ quedaEm: null, proximaTentativaEm: null });
    t.app.tentarReconectar();
    expect(fluxos).toHaveLength(1);

    fluxos[0]?.cair();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'reconectando', quedaEm: 1_000_000, proximaTentativaEm: 1_003_000 });

    // sem rota, a próxima tentativa falha: a queda continua a mesma, a espera dobra
    t.rotas.delete('/api/events');
    relogio = 1_001_000;
    t.app.tentarReconectar();
    expect(t.app.store.ler().proximaTentativaEm).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'sem-motor', quedaEm: 1_000_000, proximaTentativaEm: 1_007_000 });

    t.rotas.set('/api/events', (p) => { const f = fluxoFalso(p.init); fluxos.push(f); return f.resposta; });
    await vi.advanceTimersByTimeAsync(6000);
    expect(t.app.store.ler()).toMatchObject({ conexao: 'conectado', quedaEm: null, proximaTentativaEm: null });
    encerrar();
  });

  it('sair leva o sinal embora com o snapshot', async () => {
    const t = montar({ token: TOKEN });
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    const encerrar = t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    fluxo.enviar(estado({ app: APP }));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().estadoEmDia).toBe(true);
    await t.app.sair();
    expect(t.app.store.ler()).toMatchObject({ snapshot: null, estadoEmDia: false });
    encerrar();
  });
});

// O Sair revoga a própria sessão no motor antes de apagar o token: acha a sessão `atual` em
// POST /api/auth/sessions e manda o `id` dela a POST /api/auth/revoke
// (lib/local-auth/acesso.js, na raiz).
describe('sair revoga a sessão no motor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const ATUAL = '0123456789abcdef';
  const OUTRA = 'fedcba9876543210';
  const SESSOES = { ok: true, sessoes: [
    { id: OUTRA, rotulo: 'Outro', criadoEm: 1, ultimoUsoEm: 2, atual: false },
    { id: ATUAL, rotulo: 'Este', criadoEm: 3, ultimoUsoEm: 4, atual: true },
  ] };

  async function pareado() {
    const t = montar({ token: TOKEN });
    t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().sessao).toBe('pareado');
    return t;
  }

  const caminho = (p: Pedido): string => p.url.replace(BASE, '');
  const dasRotasDeSessao = (t: Awaited<ReturnType<typeof pareado>>) => t.pedidos.filter((p) => ['/api/auth/sessions', '/api/auth/revoke'].includes(caminho(p)));
  const corpoDe = (p: Pedido): unknown => JSON.parse(String(p.init.body));

  it('acha a sessão atual na lista, revoga pelo id, e só então apaga o token e vai ao pareamento', async () => {
    const t = await pareado();
    const ordem: string[] = [];
    t.rotas.set('/api/auth/sessions', () => { ordem.push(`sessions:${t.cofre.ler() ? 'com token' : 'sem token'}`); return json(SESSOES); });
    t.rotas.set('/api/auth/revoke', () => { ordem.push(`revoke:${t.cofre.ler() ? 'com token' : 'sem token'}`); return json({ ok: true, eraAtual: true }); });

    const saindo = t.app.sair();
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: true });
    expect(await saindo).toBe('revogada');

    const chamadas = dasRotasDeSessao(t);
    expect(chamadas.map((p) => [caminho(p), p.init.method, corpoDe(p)])).toEqual([
      ['/api/auth/sessions', 'POST', {}],
      ['/api/auth/revoke', 'POST', { id: ATUAL }],
    ]);
    // as duas foram com o Bearer e o x-farol, antes de o token sair deste navegador
    for (const p of chamadas) expect(p.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'x-farol': '1' });
    expect(ordem).toEqual(['sessions:com token', 'revoke:com token']);
    expect(t.cofre.ler()).toBe('');
    expect(t.guardado.has(CHAVE_DO_TOKEN)).toBe(false);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'revogada', saindo: false, snapshot: null });
  });

  it('falha de rede não impede o sair local, e a tela fica sabendo que a sessão só foi esquecida aqui', async () => {
    const t = await pareado();
    // sem rota: o fetch de mentira lança, como numa queda de rede
    expect(await t.app.sair()).toBe('sem-resposta');
    expect(dasRotasDeSessao(t).map(caminho)).toEqual(['/api/auth/sessions']);
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'sem-resposta' });
  });

  it('rede que cai depois de o pedido de revogação sair: sai daqui, e a tela não afirma se o motor revogou', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    expect(await t.app.sair()).toBe('nao-confirmada');
    expect(dasRotasDeSessao(t)).toHaveLength(2);
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', saida: 'nao-confirmada', saindo: false });
  });

  it('prazo que vence na segunda chamada (a revogação): não dá para confirmar, e o sair local acontece', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', (p) => new Promise<Response>((_resolver, rejeitar) => {
      p.init.signal?.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')));
    }));
    const saindo = t.app.sair();
    await vi.advanceTimersByTimeAsync(PRAZO_DO_SAIR_MS - 1);
    expect(dasRotasDeSessao(t).map(caminho)).toEqual(['/api/auth/sessions', '/api/auth/revoke']);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: true });
    expect(t.cofre.ler()).toBe(TOKEN);
    await vi.advanceTimersByTimeAsync(1);
    expect(await saindo).toBe('nao-confirmada');
    expect((dasRotasDeSessao(t)[1]?.init.signal as AbortSignal).aborted).toBe(true);
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'nao-confirmada', saindo: false });
  });

  // Um corpo que lança quando o leitor o toca: o cliente não segura a exceção do leitor.
  const corpoQueLanca = (): Response => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    // `then` passa, para o corpo chegar ao leitor em vez de falhar na leitura do JSON
    json: async () => new Proxy({}, { get(_alvo, campo) { if (campo === 'then') return undefined; throw new Error('leitor quebrado'); } }),
  }) as unknown as Response;

  it('exceção no leitor da lista: o token local é apagado e o botão volta, sem erro para quem clicou', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', corpoQueLanca);
    expect(await t.app.sair()).toBe('recusada');
    expect(dasRotasDeSessao(t).map(caminho)).toEqual(['/api/auth/sessions']);
    expect(t.cofre.ler()).toBe('');
    expect(t.guardado.has(CHAVE_DO_TOKEN)).toBe(false);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'recusada', saindo: false });
  });

  it('exceção no leitor da revogação: o pedido saiu, então a tela diz que não deu para confirmar', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', corpoQueLanca);
    expect(await t.app.sair()).toBe('nao-confirmada');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', saida: 'nao-confirmada', saindo: false });
  });

  it('exceção fora das chamadas (um assinante do store que lança): o finally apaga o token e solta o botão', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', () => json({ ok: true, eraAtual: true }));
    let lancar = true;
    t.app.store.assinar(() => {
      // lança uma vez só, quando o Sair marca "saindo"
      if (lancar && t.app.store.ler().saindo) { lancar = false; throw new Error('assinante quebrado'); }
    });
    expect(await t.app.sair()).toBe('nao-confirmada');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'nao-confirmada', saindo: false });
  });

  it('evento storage no meio do Sair (outra aba pareou de novo): esta aba segue pareada com o token novo', async () => {
    const t = await pareado();
    const novo = 'n'.repeat(43);
    let soltar!: (r: Response) => void;
    t.rotas.set('/api/auth/sessions', () => new Promise<Response>((resolver) => { soltar = resolver; }));
    const saindo = t.app.sair();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: true });
    // a outra aba grava o token novo, e o navegador avisa esta
    t.guardado.set(CHAVE_DO_TOKEN, novo);
    t.janela.disparar(CHAVE_DO_TOKEN);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: false });
    soltar(json(SESSOES));
    expect(await saindo).toBeNull();
    // nada foi revogado nem apagado: a sessão é a da outra aba
    expect(dasRotasDeSessao(t).map(caminho)).toEqual(['/api/auth/sessions']);
    expect(t.cofre.ler()).toBe(novo);
    expect(t.guardado.get(CHAVE_DO_TOKEN)).toBe(novo);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: false, saida: null });
  });

  it('401 no Sair com outro token já gravado por outra aba: não vai ao pareamento, segue pareado com o novo', async () => {
    const t = await pareado();
    const novo = 'n'.repeat(43);
    // a outra aba pareou de novo, e o evento storage ainda não chegou a esta
    t.rotas.set('/api/auth/sessions', () => { t.guardado.set(CHAVE_DO_TOKEN, novo); return json({ error: 'nao_autenticado' }, 401); });
    expect(await t.app.sair()).toBeNull();
    expect(t.cofre.ler()).toBe(novo);
    expect(t.guardado.get(CHAVE_DO_TOKEN)).toBe(novo);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: false, saida: null });
    // o fluxo reabriu com o token novo
    await vi.advanceTimersByTimeAsync(0);
    const fluxos = t.pedidos.filter((p) => caminho(p) === '/api/events');
    expect(fluxos.at(-1)?.init.headers).toMatchObject({ Authorization: `Bearer ${novo}` });
  });

  it('revogou, e outra aba gravou outro token nesse meio: o token velho sai, e esta aba segue com o novo', async () => {
    const t = await pareado();
    const novo = 'n'.repeat(43);
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', () => { t.guardado.set(CHAVE_DO_TOKEN, novo); return json({ ok: true, eraAtual: true }); });
    expect(await t.app.sair()).toBeNull();
    expect(t.guardado.get(CHAVE_DO_TOKEN)).toBe(novo);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: false });
  });

  it('rota que não existe, ou resposta fora do formato, não impede o sair local', async () => {
    for (const resposta of [() => json({ error: 'not found' }, 404), () => json({ ok: true, sessoes: 'x' }), () => new Response('<html>', { status: 200 })]) {
      const t = await pareado();
      t.rotas.set('/api/auth/sessions', resposta);
      expect(await t.app.sair()).toBe('recusada');
      expect(t.cofre.ler()).toBe('');
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'recusada' });
    }
  });

  it('sessão atual que não está na lista: nada é revogado, e o sair local acontece', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json({ ok: true, sessoes: [{ id: OUTRA, rotulo: 'Outro', criadoEm: 1, ultimoUsoEm: 2, atual: false }] }));
    t.rotas.set('/api/auth/revoke', () => json({ ok: true, eraAtual: false }));
    expect(await t.app.sair()).toBe('nao-encontrada');
    // a sessão de outro navegador nunca é revogada no lugar da atual
    expect(dasRotasDeSessao(t).map(caminho)).toEqual(['/api/auth/sessions']);
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', saida: 'nao-encontrada' });
  });

  it('o motor recusa a revogação (a sessão já não existia): sai daqui e diz que não revogou', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', () => json({ ok: false, code: 'sessao_inexistente' }));
    expect(await t.app.sair()).toBe('recusada');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', saida: 'recusada' });
  });

  it('motor que não responde: o prazo vence, as chamadas são abortadas e o sair local acontece', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', (p) => new Promise<Response>((_resolver, rejeitar) => {
      p.init.signal?.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')));
    }));
    const saindo = t.app.sair();
    await vi.advanceTimersByTimeAsync(PRAZO_DO_SAIR_MS - 1);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saindo: true });
    expect(t.cofre.ler()).toBe(TOKEN);
    await vi.advanceTimersByTimeAsync(1);
    expect(await saindo).toBe('sem-resposta');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', saida: 'sem-resposta', saindo: false });
  });

  it('o motor já recusava o token (401): a tela vai ao pareamento pelo 401, e o Sair não diz que revogou', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json({ error: 'nao_autenticado' }, 401));
    expect(await t.app.sair()).toBeNull();
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'nao-autenticado', saida: null, saindo: false });
  });

  it('dois cliques no Sair fazem um pedido só', async () => {
    const t = await pareado();
    t.rotas.set('/api/auth/sessions', () => json(SESSOES));
    t.rotas.set('/api/auth/revoke', () => json({ ok: true, eraAtual: true }));
    const [um, dois] = [t.app.sair(), t.app.sair()];
    expect(await um).toBe('revogada');
    expect(await dois).toBe('revogada');
    expect(dasRotasDeSessao(t)).toHaveLength(2);
    // depois de sair, outro Sair não faz nada
    expect(await t.app.sair()).toBeNull();
    expect(dasRotasDeSessao(t)).toHaveLength(2);
  });

  it('parear de novo apaga o desfecho do Sair anterior', async () => {
    const t = await pareado();
    await t.app.sair();
    expect(t.app.store.ler().saida).toBe('sem-resposta');
    t.rotas.set('/api/auth/pair', () => json({ ok: true, token: 'n'.repeat(43) }));
    expect(await t.app.parear('ABCDE23456', '')).toBe('pareado');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', saida: null });
  });

  it('esquecerSessao é a metade local: apaga o token e vai ao pareamento com o desfecho, sem chamar o motor', async () => {
    const t = await pareado();
    const antes = t.pedidos.length;
    t.app.esquecerSessao('revogada');
    expect(t.cofre.ler()).toBe('');
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motivo: 'saiu', saida: 'revogada', snapshot: null });
    // só a sondagem do pareamento saiu depois
    expect(t.pedidos.slice(antes).map(caminho)).toEqual(['/api/auth/status']);
  });
});

// A sessão pelo portão: um login na frente, na mesma origem, injeta o Bearer de uma sessão do
// motor. O front só entra sem token quando o motor responde `autenticado: true` a um pedido
// que saiu sem token.
describe('sessão pelo portão', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function portaoFalso(ultima = 0) {
    const estado = { ultima, idas: 0 };
    const portao: JanelaDoPortao = {
      irParaARaiz: () => { estado.idas += 1; },
      lerUltimaRecarga: () => estado.ultima,
      gravarUltimaRecarga: (quando) => { estado.ultima = quando; },
    };
    return { portao, estado };
  }

  const semAuthorization = (p: Pedido | undefined) => !new Headers(p?.init.headers).has('authorization');

  it('motor sem portão, sem token: continua indo ao pareamento, com uma sondagem só', async () => {
    const p = portaoFalso();
    const t = montar({ portao: p.portao });
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: false }));
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', motor: 'alcancavel', viaPortao: false });
    expect(t.pedidos.map((x) => x.url)).toEqual([`${BASE}/api/auth/status`]);
    expect(p.estado.idas).toBe(0);
  });

  it('status diz autenticado sem token: entra sem gravar nada, sem Authorization, e o fluxo leva o cookie da origem', async () => {
    const t = montar({ portao: portaoFalso().portao });
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: true }));
    let fluxo!: ReturnType<typeof fluxoFalso>;
    t.rotas.set('/api/events', (p) => { fluxo = fluxoFalso(p.init); return fluxo.resposta; });
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', viaPortao: true, conexao: 'conectado' });
    expect(t.escritas.total).toBe(0);
    expect(t.guardado.size).toBe(0);
    const [status, eventos] = t.pedidos;
    expect(status?.init.credentials).toBe('same-origin');
    expect(semAuthorization(status) && semAuthorization(eventos)).toBe(true);
    expect(eventos?.init.credentials).toBe('same-origin');
    fluxo.enviar(`event: state\ndata: ${JSON.stringify({ app: APP, status: 'idle' })}\n\n`);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().snapshot).toEqual({ app: APP, status: 'idle' });
  });

  it('não entra sem o motor dizer autenticado: exigida false, resposta torta ou falha de rede vão ao pareamento', async () => {
    for (const resposta of [() => json({ exigida: false, autenticado: true }), () => json({ autenticado: true }), () => json({ exigida: true, autenticado: 'sim' }), null]) {
      const t = montar({ portao: portaoFalso().portao });
      if (resposta) t.rotas.set('/api/auth/status', resposta);
      t.app.iniciar();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.app.store.ler()).toMatchObject({ sessao: 'pareamento', viaPortao: false });
      expect(t.pedidos.some((x) => x.url.endsWith('/api/events'))).toBe(false);
    }
  });

  it('com token guardado o comportamento não muda: entra com o token, sem sondar o portão', async () => {
    const t = montar({ token: TOKEN, portao: portaoFalso().portao });
    t.rotas.set('/api/events', (p) => fluxoFalso(p.init).resposta);
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', viaPortao: false });
    expect(t.pedidos.map((x) => x.url)).toEqual([`${BASE}/api/events`]);
    expect(new Headers(t.pedidos[0]?.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(t.pedidos[0]?.init.credentials).toBe('omit');
  });

  async function entrarPeloPortao(p: ReturnType<typeof portaoFalso>, agora = () => 1_000_000) {
    const t = montar({ portao: p.portao, agora });
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: true }));
    t.rotas.set('/api/events', (x) => fluxoFalso(x.init).resposta);
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.app.store.ler().viaPortao).toBe(true);
    return t;
  }

  it('401 num pedido: recarrega na raiz uma vez e guarda a hora, sem ir ao pareamento', async () => {
    const p = portaoFalso();
    const t = await entrarPeloPortao(p);
    t.rotas.set('/api/team', () => json({ error: 'google_login_required' }, 401));
    const r = await t.app.cliente.get('/api/team', (b) => b);
    expect(r).toMatchObject({ ok: false, falha: 'nao_autenticado' });
    expect(p.estado).toEqual({ idas: 1, ultima: 1_000_000 });
    expect(t.app.store.ler().sessao).toBe('carregando');
    expect(t.pedidos.some((x) => x.url.endsWith('/api/auth/pair'))).toBe(false);
  });

  it('401 no fluxo também recarrega, e dois 401 juntos recarregam uma vez só', async () => {
    const p = portaoFalso();
    const t = montar({ portao: p.portao, agora: () => 5_000_000 });
    t.rotas.set('/api/auth/status', () => json({ exigida: true, autenticado: true }));
    t.rotas.set('/api/events', () => json({ error: 'google_login_required' }, 401));
    t.rotas.set('/api/team', () => json({ error: 'google_login_required' }, 401));
    t.app.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    void t.app.cliente.get('/api/team', (b) => b);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.estado.idas).toBe(1);
    expect(t.app.store.ler().sessao).toBe('carregando');
  });

  it('o segundo 401 dentro da janela mostra a tela de Entrar de novo, sem recarregar; fora da janela recarrega', async () => {
    const dentro = portaoFalso(1_000_000 - JANELA_DA_RECARGA_MS + 1);
    const t = await entrarPeloPortao(dentro);
    t.rotas.set('/api/team', () => json({}, 401));
    await t.app.cliente.get('/api/team', (b) => b);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'portao-expirado', snapshot: null });
    expect(dentro.estado.idas).toBe(0);
    t.app.entrarDeNovo();
    expect(dentro.estado).toEqual({ idas: 1, ultima: 1_000_000 });

    const fora = portaoFalso(1_000_000 - JANELA_DA_RECARGA_MS);
    const t2 = await entrarPeloPortao(fora);
    t2.rotas.set('/api/team', () => json({}, 401));
    await t2.app.cliente.get('/api/team', (b) => b);
    expect(fora.estado.idas).toBe(1);
  });

  it('Sair: POST /auth/logout na mesma origem com x-farol, sem o motor, e depois a raiz', async () => {
    const p = portaoFalso();
    const t = await entrarPeloPortao(p);
    t.rotas.set('/auth/logout', () => new Response(null, { status: 204 }));
    expect(await t.app.sair()).toBe('revogada');
    const logout = t.pedidos.find((x) => x.url === '/auth/logout');
    expect(logout?.init.method).toBe('POST');
    expect(new Headers(logout?.init.headers).get('x-farol')).toBe('1');
    expect(semAuthorization(logout)).toBe(true);
    expect(logout?.init.credentials).toBe('same-origin');
    expect(t.pedidos.some((x) => /\/api\/auth\/(sessions|revoke)/.test(x.url))).toBe(false);
    expect(p.estado.idas).toBe(1);
    expect(t.escritas.total).toBe(0);
  });

  it('Sair com o portão fora do ar ainda vai à raiz, e o desfecho não afirma a revogação', async () => {
    const p = portaoFalso();
    const t = await entrarPeloPortao(p);
    expect(await t.app.sair()).toBe('nao-confirmada');
    expect(p.estado.idas).toBe(1);
  });

  it('revogar a sessão atual pela tela Sistema equivale a sair', async () => {
    const p = portaoFalso();
    const t = await entrarPeloPortao(p);
    t.rotas.set('/auth/logout', () => new Response(null, { status: 204 }));
    t.app.esquecerSessao('revogada');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.pedidos.some((x) => x.url === '/auth/logout')).toBe(true);
    expect(p.estado.idas).toBe(1);
    expect(t.app.store.ler().sessao).not.toBe('pareamento');
  });

  it('outra aba apagando o token não tira a sessão pelo portão; outra aba pareando troca para o token', async () => {
    const t = await entrarPeloPortao(portaoFalso());
    t.janela.disparar(CHAVE_DO_TOKEN);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', viaPortao: true });
    t.guardado.set(CHAVE_DO_TOKEN, TOKEN);
    t.janela.disparar(CHAVE_DO_TOKEN);
    expect(t.app.store.ler()).toMatchObject({ sessao: 'pareado', viaPortao: false });
  });
});
