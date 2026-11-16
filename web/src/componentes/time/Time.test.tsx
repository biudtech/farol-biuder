// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { Resultado } from '@/transporte/cliente';
import { voltarPara } from '../historico/apoio-de-teste';
import { Time } from './Time';

vi.mock('next/navigation', async () => (await import('../historico/apoio-de-teste')).navegacaoDeMentira);

type Falha = Extract<Resultado<never>, { ok: false }>;
// O que o motor de mentira devolve: o corpo cru (que passa pelo leitor da borda, como no
// cliente de verdade) ou uma falha do transporte.
type Resposta = { corpo: unknown } | Falha;

const corpo = (valor: unknown): Resposta => ({ corpo: valor });
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };

// Os dossiês como parseTeam (lib/workspace.js) os emite: a entrada mais recente primeiro.
const ANA = {
  login: 'Ana-Souza',
  name: 'Ana Souza',
  entries: [
    { date: '2026-11-16', ref: 'dono/repo#12', verdict: 'APPROVE', bullets: ['Cobriu o caso de borda com `Map`.', 'Teste novo para o **limite**.'] },
    { date: '2026-11-10', ref: 'dono/repo#7', verdict: 'REQUEST CHANGES', bullets: [] },
  ],
};
const BRUNO = { login: 'bruno', name: 'bruno', entries: [{ date: '2026-11-02', ref: 'dono/outro#3', verdict: 'COMMENT', bullets: ['Faltou o card.'] }] };
const TIME = [ANA, BRUNO];

// `config.people` como parsePeople (lib/parse.js) o guarda: login em minúsculas.
const PESSOAS = {
  'ana-souza': { papel: 'senior', dominios: { backend: 'avancado' } },
  bruno: { papel: 'junior' },
  caio: { papel: 'pleno' },
};

function resolvidas(...ids: string[]) {
  return { pending: [], resolved: ids.map((id, i) => ({ id, resolvedAt: 1000 - i })), ilegiveis: 0 };
}

const SNAPSHOT: Snapshot = { decisions: resolvidas('d1'), config: { people: PESSOAS }, pushbacks: {} };

interface Montagem {
  url?: string;
  responder?: (caminho: string) => Resposta | Promise<Resposta>;
  // o corpo cru que cada POST devolve
  aoPostar?: (rota: string, enviado: unknown) => Resposta;
  snapshot?: Snapshot | null;
  conexao?: EstadoDoApp['conexao'];
}

function montar({ url = '/time', responder = () => corpo(TIME), aoPostar = () => corpo({ ok: true }), snapshot = SNAPSHOT, conexao = 'conectado' }: Montagem = {}) {
  window.history.replaceState(null, '', url);
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao, snapshot });
  const ler = (r: Resposta, leitor: (bruto: unknown) => unknown) => {
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  };
  const sinais: AbortSignal[] = [];
  const get = vi.fn(async (caminho: string, leitor: (bruto: unknown) => unknown, opcoes?: { sinal?: AbortSignal }) => {
    if (opcoes?.sinal) sinais.push(opcoes.sinal);
    return ler(await responder(caminho), leitor);
  });
  const post = vi.fn(async (rota: string, enviado: unknown, leitor: (bruto: unknown) => unknown) => ler(aoPostar(rota, enviado), leitor));
  const app = { store, cliente: { get, post }, dispensarRecados: () => store.trocar({ recados: [] }) } as unknown as App;
  const tela = render(<Time app={app} />);
  const pedidos = (): string[] => get.mock.calls.map(([caminho]) => caminho);
  const trocarSnapshot = (novo: Snapshot) => act(() => { store.trocar({ snapshot: novo }); });
  return { store, get, post, sinais, pedidos, trocarSnapshot, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };
const escolher = (rotulo: string, valor: string) => { act(() => { fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } }); }); };
const anuncio = () => screen.getByRole('status', { name: 'Resultado da lista' }).textContent;
const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
const titulosDosCartoes = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const campos = (item: Element | null | undefined) => [...(item?.querySelectorAll('dl > div') ?? [])].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);
const dossie = () => screen.getByRole('region', { name: /^Dossiê de @/ });

beforeEach(() => { window.history.replaceState(null, '', '/time'); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Time: a lista', () => {
  it('carrega a lista inteira de GET /api/team e mostra na ordem do motor', async () => {
    const t = montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Time' })).toBeTruthy();
    expect(anuncio()).toBe('Carregando o Time.');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/team']);
    expect(anuncio()).toBe('3 pessoas');
    // quem só tem perfil gravado vem depois dos dossiês
    expect(titulosDosCartoes()).toEqual(['@Ana-SouzaAna Souza', '@bruno', '@caio']);
  });

  it('cada cartão diz as entradas, a última, o papel e a competência, com o que o motor trouxe', async () => {
    montar();
    await assentar();
    const [ana, bruno, caio] = screen.getAllByRole('listitem');
    expect(campos(ana)).toEqual([
      'Entradas de memória: 2',
      'Última entrada: 16/11/2026, PR #12 de dono/repo, Aprovação',
      'Papel: Sênior',
      'Competência: Backend: Avançado',
    ]);
    expect(campos(bruno)).toEqual(['Entradas de memória: 1', 'Última entrada: 02/11/2026, PR #3 de dono/outro, Comentário', 'Papel: Júnior', 'Competência: Não informada']);
    // sem dossiê não há contagem de entradas a afirmar
    expect(campos(caio)).toEqual(['Papel: Pleno', 'Competência: Não informada']);
    expect(within(ana as HTMLElement).getByRole('button', { name: 'Ver o dossiê de @Ana-Souza' })).toBeTruthy();
  });

  it('autor só com login aparece com o que há, e sem o snapshot dos perfis o papel fica não informado', async () => {
    montar({ responder: () => corpo([{ login: 'dora' }]), snapshot: { decisions: resolvidas('d1') } });
    await assentar();
    expect(campos(screen.getByRole('listitem'))).toEqual(['Entradas de memória: Nenhuma', 'Papel: Não informado', 'Competência: Não informada']);
  });

  it('pessoa que chega sem login fica de fora, contada e avisada', async () => {
    montar({ responder: () => corpo([ANA, { name: 'sem login' }, 7]) });
    await assentar();
    expect(screen.getByText(/2 pessoa\(s\) chegaram do motor em formato que esta tela não lê/)).toBeTruthy();
    expect(titulosDosCartoes()).toContain('@Ana-SouzaAna Souza');
  });

  it('a busca filtra nesta página, sem pedir nada ao motor e sem ir ao endereço', async () => {
    const t = montar();
    await assentar();
    act(() => { fireEvent.change(screen.getByLabelText('Buscar por nome ou login'), { target: { value: 'souza' } }); });
    expect(titulosDosCartoes()).toEqual(['@Ana-SouzaAna Souza']);
    expect(anuncio()).toBe('1 de 3 pessoas passa pela busca');
    expect(t.pedidos()).toEqual(['/api/team']);
    expect(window.location.search).toBe('');
  });

  it('busca sem resultado tem texto próprio e o Limpar', async () => {
    montar();
    await assentar();
    act(() => { fireEvent.change(screen.getByLabelText('Buscar por nome ou login'), { target: { value: 'zzz' } }); });
    expect(screen.getByText('Ninguém do Time passa pela busca.')).toBeTruthy();
    expect(anuncio()).toBe('Ninguém passa pela busca, de 3 pessoas');
    await clicar('Limpar a busca');
    expect(titulosDosCartoes()).toHaveLength(3);
  });

  it('Time vazio diz que o motor ainda não tem ninguém', async () => {
    montar({ responder: () => corpo([]), snapshot: { decisions: resolvidas(), config: { people: {} } } });
    await assentar();
    expect(anuncio()).toBe('Ninguém no Time');
    expect(screen.getByText(/O motor ainda não tem ninguém no Time/)).toBeTruthy();
    expect(screen.queryByText('Ninguém do Time passa pela busca.')).toBeNull();
  });

  it('falha de rede tem Tentar de novo, que pede a lista outra vez', async () => {
    let falhar = true;
    const t = montar({ responder: () => (falhar ? REDE : corpo(TIME)) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    expect(titulosDosCartoes()).toEqual([]);
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/team', '/api/team']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(titulosDosCartoes()).toHaveLength(3);
  });

  it('recusa do motor aparece com o código, e resposta fora do formato também é erro', async () => {
    montar({ responder: () => ({ ok: false, falha: 'recusado', status: 403, detalhe: { codigo: 'origem_recusada' } }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O motor recusou o pedido (HTTP 403, origem_recusada).');
    cleanup();
    montar({ responder: () => corpo({ ok: true }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O motor respondeu fora do formato esperado.');
  });

  it('quando o motor resolve revisão nova, avisa e só recarrega no Atualizar', async () => {
    const t = montar();
    await assentar();
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
    t.trocarSnapshot({ ...SNAPSHOT, decisions: resolvidas('d2', 'd1') });
    expect(t.pedidos()).toEqual(['/api/team']);
    await clicar('Atualizar');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/team', '/api/team']);
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
  });

  it('texto de fora é texto', async () => {
    const marcado = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = montar({ responder: () => corpo([{ login: 'ana', name: marcado, entries: [{ date: marcado, ref: marcado, verdict: marcado, bullets: [marcado] }] }]) });
    await assentar();
    await clicar('Ver o dossiê de @ana');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getAllByText(marcado, { exact: false }).length).toBeGreaterThan(0);
  });

  it('nada do Time vai ao armazenamento do navegador nem ao console', async () => {
    const gravar = vi.spyOn(Storage.prototype, 'setItem');
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((nivel) => vi.spyOn(console, nivel).mockImplementation(() => {}));
    montar({ responder: () => corpo([ANA, { name: 'sem login' }]) });
    await assentar();
    await clicar('Ver o dossiê de @Ana-Souza');
    escolher('Papel', 'techlead');
    await clicar('Salvar papel e competência de @Ana-Souza');
    await assentar();
    expect(gravar).not.toHaveBeenCalled();
    for (const espiao of consoles) expect(espiao).not.toHaveBeenCalled();
    // do endereço só consta o login que o motor já usa
    expect(window.location.search).toBe('?autor=Ana-Souza');
  });

  it('sair da página aborta a carga em curso', async () => {
    const t = montar({ responder: () => new Promise<Resposta>(() => {}) });
    t.unmount();
    expect(t.sinais.map((s) => s.aborted)).toEqual([true]);
  });
});

describe('Time: o dossiê', () => {
  it('abre na própria página, com o login no endereço e o foco no título', async () => {
    montar();
    await assentar();
    await clicar('Ver o dossiê de @Ana-Souza');
    expect(window.location.search).toBe('?autor=Ana-Souza');
    const titulo = screen.getByRole('heading', { level: 2, name: 'Dossiê de @Ana-Souza' });
    expect(document.activeElement).toBe(titulo);
    expect(campos(dossie())).toEqual(['Nome: Ana Souza', 'Login no GitHub: Ana-Souza', 'Entradas de memória: 2', 'Papel: Sênior', 'Competência: Backend: Avançado']);
    // a lista continua montada, escondida
    expect(screen.queryByRole('button', { name: 'Ver o dossiê de @bruno' })).toBeNull();
  });

  it('lista as entradas de memória uma a uma, com o dia, o PR e o que foi publicado, e os pontos em markdown', async () => {
    montar({ url: '/time?autor=Ana-Souza' });
    await assentar();
    const entradas = within(dossie()).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(entradas).toEqual(['16/11/2026, PR #12 de dono/repo, Aprovação', '10/11/2026, PR #7 de dono/repo, Pedido de mudanças']);
    const primeira = within(dossie()).getAllByRole('listitem').find((li) => li.textContent?.includes('caso de borda')) as HTMLElement;
    expect(primeira.querySelector('code')?.textContent).toBe('Map');
    expect(primeira.querySelector('strong')?.textContent).toBe('limite');
    expect(within(dossie()).getByText('Sem pontos anotados nesta revisão.')).toBeTruthy();
  });

  it('Escape e Voltar à lista fecham, e o foco volta ao botão que abriu', async () => {
    montar();
    await assentar();
    await clicar('Ver o dossiê de @bruno');
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('heading', { level: 2, name: /Dossiê/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver o dossiê de @bruno' }));
    await clicar('Ver o dossiê de @bruno');
    await clicar('Voltar à lista');
    expect(window.location.search).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver o dossiê de @bruno' }));
  });

  it('Escape dentro de um seletor é do seletor, e não fecha o dossiê', async () => {
    montar({ url: '/time?autor=bruno' });
    await assentar();
    act(() => { fireEvent.keyDown(screen.getByLabelText('Papel'), { key: 'Escape' }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Dossiê de @bruno' })).toBeTruthy();
  });

  it('o voltar do navegador fecha o dossiê', async () => {
    montar();
    await assentar();
    await clicar('Ver o dossiê de @bruno');
    act(() => { voltarPara('/time'); });
    expect(screen.queryByRole('heading', { level: 2, name: /Dossiê/ })).toBeNull();
  });

  it('endereço colado abre o dossiê, sem diferenciar a caixa do login', async () => {
    montar({ url: '/time?autor=ana-souza' });
    expect(screen.getByText('Carregando o dossiê.')).toBeTruthy();
    await assentar();
    expect(screen.getByRole('heading', { level: 2, name: 'Dossiê de @Ana-Souza' })).toBeTruthy();
  });

  it('login que o motor não conhece diz que não há dossiê nem perfil', async () => {
    montar({ url: '/time?autor=ninguem' });
    await assentar();
    expect(screen.getByText(/O motor não tem dossiê nem perfil de @ninguem/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
  });

  it('sem dossiê e sem entradas têm textos diferentes', async () => {
    montar({ url: '/time?autor=caio' });
    await assentar();
    expect(screen.getByText(/O motor não tem dossiê de @caio/)).toBeTruthy();
    cleanup();
    montar({ url: '/time?autor=dora', responder: () => corpo([{ login: 'dora', entries: [] }]) });
    await assentar();
    expect(screen.getByText('O dossiê de @dora existe, mas está sem entradas.')).toBeTruthy();
  });

  it('se a lista falha com o dossiê aberto, o erro tem Tentar de novo', async () => {
    let falhar = true;
    montar({ url: '/time?autor=bruno', responder: () => (falhar ? REDE : corpo(TIME)) });
    await assentar();
    expect(within(dossie()).getByRole('alert').textContent).toContain('falha de rede');
    falhar = false;
    await act(async () => { fireEvent.click(within(dossie()).getByRole('button', { name: 'Tentar de novo' })); });
    await assentar();
    expect(campos(dossie())).toContain('Papel: Júnior');
  });

  it('mostra as contestações que o motor guarda dos PRs da pessoa', async () => {
    montar({
      url: '/time?autor=bruno',
      snapshot: {
        ...SNAPSHOT,
        pushbacks: {
          'dono/outro#3': { outcome: 'author_right', status: 'confirmed', author: 'bruno', note: 'era intencional' },
          'dono/outro#4': { outcome: 'mixed', status: 'pending', author: 'Bruno' },
          'dono/repo#12': { outcome: 'we_right', status: 'confirmed', author: 'ana-souza' },
        },
      },
    });
    await assentar();
    const secao = screen.getByRole('region', { name: 'Contestações registradas' });
    expect(within(secao).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'PR #3 de dono/outro: O autor tinha razão. Nota: era intencional',
      'PR #4 de dono/outro: suspeita do motor, ainda sem confirmação',
    ]);
  });
});

describe('Time: papel e competência', () => {
  it('diz o efeito real do perfil nas revisões', async () => {
    montar({ url: '/time?autor=bruno' });
    await assentar();
    expect(screen.getByText(/entram no prompt das revisões dos PRs desta pessoa/).textContent).toContain('Não mudam a decisão: os gates e a política da conta não leem esses campos.');
    expect(screen.getByRole('group', { name: 'Papel e competência de @bruno' })).toBeTruthy();
  });

  it('as opções são as do motor, e o valor gravado aparece escolhido', async () => {
    montar({ url: '/time?autor=Ana-Souza' });
    await assentar();
    const papel = screen.getByLabelText('Papel') as HTMLSelectElement;
    expect(papel.value).toBe('senior');
    expect([...papel.options].map((o) => o.textContent)).toEqual(['Sem papel', 'Estágio', 'Júnior', 'Pleno', 'Sênior', 'Tech Lead', 'Arquiteto', 'Especialista']);
    const backend = screen.getByLabelText('Competência em Backend') as HTMLSelectElement;
    expect(backend.value).toBe('avancado');
    expect([...backend.options].map((o) => o.textContent)).toEqual(['Sem informação', 'Básico', 'Intermediário', 'Avançado', 'Autoridade']);
    expect((screen.getByLabelText('Competência em Infra/DevOps') as HTMLSelectElement).value).toBe('');
    // sem alteração não há o que salvar
    expect(screen.getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
  });

  it('salvar manda a lista inteira de perfis do snapshot, com a pessoa alterada, e diz o que o motor gravou', async () => {
    const gravado = { ...PESSOAS, 'ana-souza': { papel: 'techlead', dominios: { backend: 'avancado', dados: 'basico' } } };
    const t = montar({ url: '/time?autor=Ana-Souza', aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: gravado } }) });
    await assentar();
    escolher('Papel', 'techlead');
    escolher('Competência em Dados', 'basico');
    await clicar('Salvar papel e competência de @Ana-Souza');
    await assentar();
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/settings', {
      people: {
        bruno: { papel: 'junior' },
        caio: { papel: 'pleno' },
        'ana-souza': { papel: 'techlead', dominios: { backend: 'avancado', dados: 'basico' } },
      },
    }]);
    expect(regiao().textContent).toContain('O motor gravou o perfil de @Ana-Souza: papel Tech Lead; Backend: Avançado; Dados: Básico.');
    expect(document.activeElement).toBe(regiao());
    // a tela não muda por conta própria: o perfil mostrado só troca com o estado do motor
    expect(campos(dossie())).toContain('Papel: Sênior');
    t.trocarSnapshot({ ...SNAPSHOT, config: { people: gravado } });
    expect(campos(dossie())).toContain('Papel: Tech Lead');
    expect(screen.getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('o salvar usa a lista de perfis do momento do clique, não a de quando o dossiê abriu', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', 'pleno');
    // outra aba gravou o perfil de outra pessoa, e o estado chegou aqui
    t.trocarSnapshot({ ...SNAPSHOT, config: { people: { ...PESSOAS, dora: { papel: 'arquiteto' } } } });
    await clicar('Salvar papel e competência de @bruno');
    expect(t.post.mock.calls[0]?.[1]).toEqual({ people: { 'ana-souza': PESSOAS['ana-souza'], caio: PESSOAS.caio, dora: { papel: 'arquiteto' }, bruno: { papel: 'pleno' } } });
  });

  it('tirar o papel e a competência tira a pessoa da lista enviada', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', '');
    await clicar('Salvar papel e competência de @bruno');
    expect(t.post.mock.calls[0]?.[1]).toEqual({ people: { 'ana-souza': PESSOAS['ana-souza'], caio: PESSOAS.caio } });
  });

  it('a tela diz que o salvar manda a lista inteira e o que isso faz com outra aba', async () => {
    montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', 'pleno');
    expect(screen.getByText(/o salvar a substitui inteira/).textContent).toContain('Alteração de perfil feita em outra aba que ainda não chegou aqui é sobrescrita.');
  });

  it('perfil que muda no motor com a edição aberta vira aviso, e dá para descartar a edição', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', 'pleno');
    t.trocarSnapshot({ ...SNAPSHOT, config: { people: { ...PESSOAS, bruno: { papel: 'senior' } } } });
    expect(screen.getByText(/o perfil de @bruno mudou no motor enquanto você editava/)).toBeTruthy();
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('pleno');
    await clicar('Descartar a edição e usar o perfil do motor');
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('senior');
    expect(screen.queryByText(/mudou no motor enquanto você editava/)).toBeNull();
  });

  it('sem edição aberta, o formulário acompanha o perfil do motor', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    t.trocarSnapshot({ ...SNAPSHOT, config: { people: { ...PESSOAS, bruno: { papel: 'senior' } } } });
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('senior');
    expect(screen.queryByText(/mudou no motor/)).toBeNull();
  });

  it('sem o estado do motor em dia o salvar fica fechado, dizendo por quê', async () => {
    const t = montar({ url: '/time?autor=bruno', conexao: 'reconectando' });
    await assentar();
    escolher('Papel', 'pleno');
    expect(screen.getByText(/^Bloqueado: Esta aba está sem o estado do motor em dia \(conexão: reconectando\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
    act(() => { t.store.trocar({ conexao: 'conectado' }); });
    expect(screen.getByRole('button', { name: 'Salvar papel e competência de @bruno' })).toBeTruthy();
  });

  it('com perfil ilegível, ou sem a lista de perfis, o salvar fica fechado', async () => {
    montar({ url: '/time?autor=bruno', snapshot: { ...SNAPSHOT, config: { people: PESSOAS, peopleIlegiveis: 1 } } });
    await assentar();
    escolher('Papel', 'pleno');
    expect(screen.getByText(/^Bloqueado: 1 perfil\(is\) chegaram do motor em formato que esta tela não lê/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
    cleanup();
    montar({ url: '/time?autor=bruno', snapshot: { decisions: resolvidas('d1') } });
    await assentar();
    expect(screen.getByText(/^Bloqueado: O motor não mandou a lista de perfis/)).toBeTruthy();
  });

  it('valor gravado que a tela não conhece aparece como opção, dito como desconhecido', async () => {
    montar({ url: '/time?autor=bruno', snapshot: { ...SNAPSHOT, config: { people: { bruno: { papel: 'papel_novo' } } } } });
    await assentar();
    const papel = screen.getByLabelText('Papel') as HTMLSelectElement;
    expect(papel.value).toBe('papel_novo');
    expect(papel.selectedOptions[0]?.textContent).toBe('papel_novo (valor que esta tela não conhece)');
  });

  it('recusa do motor aparece com a frase dele, e falha de rede não afirma que gravou', async () => {
    montar({ url: '/time?autor=bruno', aoPostar: () => corpo({ ok: false, code: 'chave_exigida', erro: 'Para mudar o endereço deste perfil, digite a chave de novo.' }) });
    await assentar();
    escolher('Papel', 'pleno');
    await clicar('Salvar papel e competência de @bruno');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor recusou: Para mudar o endereço deste perfil, digite a chave de novo.');
    cleanup();
    montar({ url: '/time?autor=bruno', aoPostar: () => REDE });
    await assentar();
    escolher('Papel', 'pleno');
    await clicar('Salvar papel e competência de @bruno');
    await assentar();
    expect(regiao().textContent).toContain('Não dá para saber se o pedido chegou');
  });
});

describe('Time: remover do Time', () => {
  const comContestacao: Snapshot = { ...SNAPSHOT, pushbacks: { 'dono/repo#12': { outcome: 'we_right', status: 'confirmed', author: 'ana-souza' } } };

  it('pergunta antes, dizendo o que é apagado, que não desfaz e o efeito nas próximas revisões', async () => {
    const t = montar({ url: '/time?autor=Ana-Souza', snapshot: comContestacao });
    await assentar();
    await clicar('Remover @Ana-Souza do Time');
    const pergunta = screen.getByRole('group', { name: 'Remover @Ana-Souza do Time?' });
    expect(pergunta.textContent).toContain('o dossiê (2 entradas de memória nesta tela)');
    expect(pergunta.textContent).toContain('o papel e a competência configurados');
    expect(pergunta.textContent).toContain('todos os registros de contestação dos PRs dela (1 nesta tela)');
    expect(pergunta.textContent).toContain('Não dá para desfazer, porque o motor não guarda cópia.');
    expect(pergunta.textContent).toContain('Nas próximas revisões dos PRs dela a sessão não encontra histórico');
    expect(document.activeElement).toBe(within(pergunta).getByRole('button', { name: 'Voltar sem enviar' }));
    expect(t.post).not.toHaveBeenCalled();
  });

  it('cancelar não envia nada, e o foco volta ao botão', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    await clicar('Remover @bruno do Time');
    await clicar('Voltar sem enviar');
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: /Remover @bruno/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remover @bruno do Time' }));
  });

  it('Escape na pergunta fecha a pergunta, não o dossiê', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    await clicar('Remover @bruno do Time');
    act(() => { fireEvent.keyDown(screen.getByRole('button', { name: 'Voltar sem enviar' }), { key: 'Escape' }); });
    expect(screen.queryByRole('group', { name: /Remover @bruno/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Dossiê de @bruno' })).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('confirmar manda só o login como o motor o listou, diz o resultado e pede a lista de novo', async () => {
    let removida = false;
    const t = montar({
      url: '/time?autor=ana-souza',
      snapshot: comContestacao,
      responder: () => corpo(removida ? [BRUNO] : TIME),
      aoPostar: () => { removida = true; return corpo({ ok: true, removed: true }); },
    });
    await assentar();
    await clicar('Remover @Ana-Souza do Time');
    await clicar('Apagar tudo desta pessoa: @Ana-Souza');
    await assentar();
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/team/remove', { login: 'Ana-Souza' }]);
    expect(regiao().textContent).toContain('O motor apagou o que guardava sobre @Ana-Souza: dossiê, perfil e contestações. Não há como desfazer.');
    expect(t.pedidos()).toEqual(['/api/team', '/api/team']);
    // o perfil e as contestações saem com o estado que o motor empurra
    t.trocarSnapshot({ decisions: resolvidas('d1'), config: { people: { bruno: PESSOAS.bruno, caio: PESSOAS.caio } }, pushbacks: {} });
    expect(screen.getByText(/O motor não tem dossiê nem perfil de @ana-souza/)).toBeTruthy();
    await clicar('Voltar à lista');
    expect(titulosDosCartoes()).toEqual(['@bruno', '@caio']);
  });

  it('recusa do motor aparece e a lista não é pedida de novo', async () => {
    const t = montar({ url: '/time?autor=bruno', aoPostar: () => corpo({ ok: false, error: 'login inválido' }) });
    await assentar();
    await clicar('Remover @bruno do Time');
    await clicar('Apagar tudo desta pessoa: @bruno');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor recusou: login inválido');
    expect(t.pedidos()).toEqual(['/api/team']);
  });

  it('quando o motor não tinha nada, a tela diz isso em vez de afirmar que apagou', async () => {
    montar({ url: '/time?autor=caio', aoPostar: () => corpo({ ok: true, removed: false }) });
    await assentar();
    await clicar('Remover @caio do Time');
    expect(screen.getByRole('group', { name: 'Remover @caio do Time?' }).textContent).toContain('o dossiê, se houver');
    await clicar('Apagar tudo desta pessoa: @caio');
    await assentar();
    expect(regiao().textContent).toContain('O motor não tinha nada guardado sobre @caio: nada foi apagado.');
  });
});
