// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { lerConfig, type ConfigDoMotor } from '@/contratos/time';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { registrarNoConsole } from '@/estado/instancia';
import { criarStore } from '@/estado/store';
import type { Resultado } from '@/transporte/cliente';
import { voltarPara } from '../historico/apoio-de-teste';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Dossie } from './Dossie';
import { idDoBotao } from './ListaDoTime';
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

// A chave `config` como entra no store: o `config` do motor passado pelo leitor da borda de
// verdade, com o registro de verdade (o console do navegador).
function config(people: unknown): ConfigDoMotor {
  const lida = lerConfig({ intervalSeconds: 300, people }, registrarNoConsole);
  if (!lida) throw new Error('config de teste fora da forma');
  return lida;
}

function resolvidas(...ids: string[]) {
  return { pending: [], resolved: ids.map((id, i) => ({ id, resolvedAt: 1000 - i })), ilegiveis: 0 };
}

const SNAPSHOT: Snapshot = { decisions: resolvidas('d1'), config: config(PESSOAS), pushbacks: {} };
const comPerfis = (people: unknown): Snapshot => ({ ...SNAPSHOT, config: config(people) });

interface Montagem {
  url?: string;
  responder?: (caminho: string) => Resposta | Promise<Resposta>;
  // o corpo cru que cada POST devolve
  aoPostar?: (rota: string, enviado: unknown) => Resposta | Promise<Resposta>;
  snapshot?: Snapshot | null;
  conexao?: EstadoDoApp['conexao'];
  estadoEmDia?: boolean;
  // o `config.people` que GET /api/state devolve na releitura antes de gravar; sem ele, o do
  // snapshot do store (o motor igual ao que a tela tem)
  pessoasNoMotor?: () => Resposta;
}

function montar({ url = '/time', responder = () => corpo(TIME), aoPostar = () => corpo({ ok: true }), snapshot = SNAPSHOT, conexao = 'conectado', estadoEmDia = true, pessoasNoMotor }: Montagem = {}) {
  window.history.replaceState(null, '', url);
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao, estadoEmDia, snapshot });
  const ler = (r: Resposta, leitor: (bruto: unknown) => unknown) => {
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  };
  const sinais: AbortSignal[] = [];
  const get = vi.fn(async (caminho: string, leitor: (bruto: unknown) => unknown, opcoes?: { sinal?: AbortSignal }) => {
    if (opcoes?.sinal) sinais.push(opcoes.sinal);
    if (caminho === '/api/state') return ler(pessoasNoMotor ? pessoasNoMotor() : corpo({ config: { people: store.ler().snapshot?.config?.peopleCru ?? {} } }), leitor);
    return ler(await responder(caminho), leitor);
  });
  const post = vi.fn(async (rota: string, enviado: unknown, leitor: (bruto: unknown) => unknown) => ler(await aoPostar(rota, enviado), leitor));
  const app = { store, cliente: { get, post } } as unknown as App;
  const tela = render(<Time app={app} />);
  const pedidos = (): string[] => get.mock.calls.map(([caminho]) => caminho);
  const trocarSnapshot = (novo: Snapshot) => act(() => { store.trocar({ snapshot: novo }); });
  return { store, get, post, sinais, pedidos, trocarSnapshot, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };
const escolher = (rotulo: string, valor: string) => { act(() => { fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } }); }); };
const anuncio = () => screen.getByRole('status', { name: 'Resultado da lista' }).textContent;
const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
// os cartões da grade, um por pessoa, e o nome de cada um (o título do cartão)
const cartoes = (): HTMLElement[] => {
  const lista = screen.queryByRole('list', { name: 'Pessoas do Time' });
  return lista ? within(lista).queryAllByRole('article') : [];
};
const nomes = () => cartoes().map((c) => c.querySelector('h2')?.textContent ?? '');
const cartaoDe = (nome: string) => screen.getByRole('article', { name: nome });
const botaoDe = (login: string) => document.getElementById(idDoBotao(login)) as HTMLButtonElement;
const abrir = async (login: string) => { await act(async () => { fireEvent.click(botaoDe(login)); }); };
const dossie = () => screen.getByRole('region', { name: /^Dossiê de @/ });
const dossieDe = (login: string) => screen.queryByRole('region', { name: `Dossiê de @${login}` });
const tituloDoDossie = () => within(dossie()).getByRole('heading', { level: 1 });
const subDoDossie = () => dossie().querySelector('h1 + p')?.textContent;
const secao = (nome: string) => within(dossie()).getByRole('group', { name: nome }) as HTMLDetailsElement;
const resumoDe = (nome: string) => secao(nome).querySelector('summary')?.textContent;
const semDossie = () => screen.queryByRole('region', { name: /^Dossiê de @/ }) === null;
const CONFIRMAR = 'Apagar o dossiê, o perfil e as contestações';
const VOLTAR = 'Voltar à lista do Time';

beforeEach(() => { window.history.replaceState(null, '', '/time'); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Time: a lista', () => {
  it('carrega a lista inteira de GET /api/team e mostra na ordem do motor', async () => {
    const t = montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Time' })).toBeTruthy();
    // sem nada ainda, o esqueleto, com a frase para o leitor
    expect(screen.getByText('Carregando o Time.').getAttribute('role')).toBe('status');
    await assentar();
    expect(screen.queryByText('Carregando o Time.')).toBeNull();
    expect(t.pedidos()).toEqual(['/api/team']);
    expect(anuncio()).toBe('3 pessoas');
    // a frase sob o título
    expect(screen.getByText('3 pessoas', { selector: 'p:not([role])' })).toBeTruthy();
    // quem só tem perfil gravado vem depois dos dossiês
    expect(nomes()).toEqual(['Ana Souza', 'bruno', 'caio']);
  });

  it('um cartão por pessoa: a foto, o nome, o login, o papel, os domínios e as ações', async () => {
    montar();
    await assentar();
    const ana = cartaoDe('Ana Souza');
    // a foto do GitHub é enfeite: o nome vai escrito ao lado
    expect(ana.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/Ana-Souza?s=72');
    expect(ana.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(within(ana).getByText('@Ana-Souza')).toBeTruthy();
    expect(within(ana).getByText('Sênior')).toBeTruthy();
    expect(within(within(ana).getByRole('list', { name: 'Domínios' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Backend: Avançado']);
    // as ações são botões de verdade, com o nome da pessoa para o leitor de tela
    expect(within(ana).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ver dossiê de Ana Souza', 'Editar papel de Ana Souza']);
    expect(botaoDe('Ana-Souza')).toBe(within(ana).getByRole('button', { name: 'Ver dossiê de Ana Souza' }));
    // sem domínio no perfil, sem a lista
    expect(within(cartaoDe('bruno')).queryByRole('list', { name: 'Domínios' })).toBeNull();
  });

  it('o que o Farol já aprendeu: os pontos mais recentes do dossiê, de markdown', async () => {
    montar();
    await assentar();
    const aprendeu = within(cartaoDe('Ana Souza')).getByRole('region', { name: 'O que o Farol já aprendeu' });
    expect([...aprendeu.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Cobriu o caso de borda com Map.', 'Teste novo para o limite.']);
    expect(aprendeu.querySelector('code')?.textContent).toBe('Map');
    // só perfil, sem dossiê: diz que o dossiê nasce na primeira revisão
    expect(within(cartaoDe('caio')).getByText(/o dossiê nasce na primeira revisão resolvida/)).toBeTruthy();
  });

  it('os números de 30 dias saem do motor; sem eles, o cartão diz isso em vez de mostrar zero', async () => {
    const comNumeros = { ...ANA, numeros: { janelaDias: 30, prs: 14, aprovadosDePrimeira: 9, rodadas: 20, bloqueios: 4 } };
    montar({ responder: () => corpo([comNumeros, BRUNO]) });
    await assentar();
    const caixas = cartaoDe('Ana Souza').querySelector('dl') as HTMLElement;
    // a janela está escrita na tela, e é ela que dá nome às caixas
    const janela = within(cartaoDe('Ana Souza')).getByText('Últimos 30 dias');
    expect(caixas.getAttribute('aria-labelledby')).toBe(janela.id);
    expect(caixas.hasAttribute('aria-label')).toBe(false);
    expect([...caixas.querySelectorAll('div')].map((d) => `${d.querySelector('dt')?.textContent}: ${d.querySelector('dd')?.textContent}`)).toEqual([
      'PRs revisados: 14', 'aprovados de primeira: 9', 'pedidos de mudança: 4',
    ]);
    // fora do teto do histórico, nada a avisar
    expect(within(cartaoDe('Ana Souza')).queryByText(/histórico guardado está no teto/)).toBeNull();
    expect(cartaoDe('bruno').querySelector('dl')).toBeNull();
    expect(within(cartaoDe('bruno')).getByText(/^Sem números dos últimos 30 dias/)).toBeTruthy();
  });

  it('com o histórico no teto, o cartão diz, abaixo das caixas, o que o motor manda dizer', async () => {
    const noTeto = { ...ANA, numeros: { janelaDias: 30, prs: 14, aprovadosDePrimeira: 9, rodadas: 20, historicoNoTeto: true } };
    montar({ responder: () => corpo([noTeto, BRUNO]) });
    await assentar();
    const cartao = cartaoDe('Ana Souza');
    const aviso = within(cartao).getByText('O histórico guardado está no teto: valem para os PRs com histórico completo, e um PR com revisão anterior já descartada pode contar como novo.');
    const caixas = cartao.querySelector('dl') as HTMLElement;
    // abaixo das caixas
    expect(caixas.compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Ver dossiê leva ao dossiê', async () => {
    montar();
    await assentar();
    await abrir('bruno');
    expect(window.location.search).toBe('?autor=bruno');
    expect(dossieDe('bruno')).toBeTruthy();
  });

  it('sem papel a linha diz "Sem papel", e autor só com login aparece com o que há', async () => {
    montar({ responder: () => corpo([{ login: 'dora' }]), snapshot: { decisions: resolvidas('d1') } });
    await assentar();
    expect(nomes()).toEqual(['dora']);
    const dora = cartaoDe('dora');
    expect(within(dora).getByText('Sem papel').closest('[data-sem-papel="sim"]')).toBeTruthy();
    expect(within(dora).getByText('O motor ainda não anotou nenhum ponto no dossiê.')).toBeTruthy();
  });

  it('pessoa que chega sem login fica de fora, contada e avisada', async () => {
    montar({ responder: () => corpo([ANA, { name: 'sem login' }, 7]) });
    await assentar();
    expect(screen.getByText(/2 pessoa\(s\) chegaram do motor em formato que esta tela não lê/)).toBeTruthy();
    expect(nomes()).toContain('Ana Souza');
  });

  it('a busca filtra nesta página, sem pedir nada ao motor e sem ir ao endereço', async () => {
    const t = montar();
    await assentar();
    act(() => { fireEvent.change(screen.getByLabelText('Buscar por nome ou login'), { target: { value: 'souza' } }); });
    expect(nomes()).toEqual(['Ana Souza']);
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
    expect(nomes()).toHaveLength(3);
  });

  it('Time vazio diz que o motor ainda não tem ninguém', async () => {
    montar({ responder: () => corpo([]), snapshot: { decisions: resolvidas(), config: config({}) } });
    await assentar();
    expect(anuncio()).toBe('Ninguém no Time');
    expect(screen.getByRole('heading', { level: 2, name: 'Ninguém no Time ainda' })).toBeTruthy();
    expect(screen.getByText(/quando a primeira revisão de um PR dela é resolvida/)).toBeTruthy();
    expect(screen.queryByText('Ninguém do Time passa pela busca.')).toBeNull();
  });

  it('a recarga mantém a lista anterior apagada, com a barra no topo', async () => {
    let soltar!: (r: Resposta) => void;
    let primeira = true;
    const t = montar({
      responder: () => {
        if (primeira) { primeira = false; return corpo(TIME); }
        return new Promise<Resposta>((resolver) => { soltar = resolver; });
      },
    });
    await assentar();
    t.trocarSnapshot({ ...SNAPSHOT, decisions: resolvidas('d2', 'd1') });
    await clicar('Atualizar');
    expect(screen.getByRole('progressbar', { name: 'Atualizando o Time' })).toBeTruthy();
    expect(nomes()).toEqual(['Ana Souza', 'bruno', 'caio']);
    expect(screen.getByRole('list', { name: 'Pessoas do Time' }).closest('[aria-busy="true"]')).toBeTruthy();
    await act(async () => { soltar(corpo([BRUNO])); });
    await assentar();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // quem saiu dos dossiês e tem perfil passa a vir depois, pelo login
    expect(nomes()).toEqual(['bruno', 'ana-souza', 'caio']);
  });

  it('falha de rede tem Tentar de novo, que pede a lista outra vez', async () => {
    let falhar = true;
    const t = montar({ responder: () => (falhar ? REDE : corpo(TIME)) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    expect(nomes()).toEqual([]);
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/team', '/api/team']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nomes()).toHaveLength(3);
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
    await abrir('ana');
    // as únicas imagens são as fotos do GitHub dos cartões; nada do texto vira marcação
    const fotos = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(fotos.length).toBeGreaterThan(0);
    for (const src of fotos) expect(src).toMatch(/^https:\/\/avatars\.githubusercontent\.com\/[\w-]+\?s=72$/);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getAllByText(marcado, { exact: false }).length).toBeGreaterThan(0);
  });

  it('nada do Time vai ao armazenamento do navegador, e o console só recebe contagem', async () => {
    const gravar = vi.spyOn(Storage.prototype, 'setItem');
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((nivel) => vi.spyOn(console, nivel).mockImplementation(() => {}));
    // o registro de verdade (registrarNoConsole) é exercitado: há perfil ilegível no snapshot
    const snapshot = comPerfis({ ...PESSOAS, 'zeca-torto': { papel: 4, squad: 'plataforma' }, 'yara-torta': 'x' });
    montar({ responder: () => corpo([ANA, { name: 'Nome Sem Login' }]), snapshot });
    await assentar();
    await abrir('Ana-Souza');
    escolher('Papel', 'techlead');
    await clicar('Salvar papel e competência de @Ana-Souza');
    await assentar();
    expect(gravar).not.toHaveBeenCalled();
    const dito = consoles.flatMap((espiao) => espiao.mock.calls.map((args) => args.map(String).join(' ')));
    expect(dito).toEqual(['[farol] snapshot: 2 perfil(is) de "config.people" com campo ou forma que a tela não lê']);
    for (const dado of ['zeca', 'yara', 'plataforma', 'Ana', 'ana-souza', 'bruno', 'Nome Sem Login', 'senior', 'techlead']) {
      for (const linha of dito) expect(linha).not.toContain(dado);
    }
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
    await abrir('Ana-Souza');
    expect(window.location.search).toBe('?autor=Ana-Souza');
    expect(dossieDe('Ana-Souza')).toBeTruthy();
    const titulo = tituloDoDossie();
    expect(titulo.textContent).toBe('Ana Souza');
    expect(document.activeElement).toBe(titulo);
    // o papel e o que o motor sustenta: as entradas guardadas, sem número que ele não manda
    expect(subDoDossie()).toBe('@Ana-Souza · Sênior · 2 entradas na memória · a mais recente em 16/11/2026');
    expect(within(dossie()).getByRole('button', { name: VOLTAR }).textContent).toBe('← Time');
    // a lista continua montada, escondida
    expect(botaoDe('bruno')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Pessoas do Time' })).toBeNull();
  });

  it('as seções: "O que o Farol observa" aberta, as outras fechadas com o resumo na linha', async () => {
    montar({ url: '/time?autor=Ana-Souza', snapshot: { ...SNAPSHOT, pushbacks: { 'dono/repo#12': { outcome: 'we_right', status: 'confirmed', author: 'ana-souza' } } } });
    await assentar();
    const nomesDasSecoes = [...dossie().querySelectorAll('details')].map((d) => d.getAttribute('aria-label') ?? '');
    expect(nomesDasSecoes).toEqual(['O que o Farol observa', 'Como revisar os PRs desta pessoa', 'Números', 'Últimas revisões', 'Contestações']);
    expect(secao('O que o Farol observa').open).toBe(true);
    for (const nome of nomesDasSecoes.slice(1)) expect(secao(nome).open, nome).toBe(false);
    expect(resumoDe('O que o Farol observa')).toBe('O que o Farol observa2 pontos');
    expect(resumoDe('Como revisar os PRs desta pessoa')).toBe('Como revisar os PRs desta pessoaSênior · Backend: Avançado');
    expect(resumoDe('Números')).toBe('Números2 entradas · 1 aprovação');
    expect(resumoDe('Últimas revisões')).toBe('Últimas revisões2');
    expect(resumoDe('Contestações')).toBe('Contestações1');
  });

  it('"O que o Farol observa" traz os pontos das entradas, de markdown, com o dia e o PR', async () => {
    montar({ url: '/time?autor=Ana-Souza' });
    await assentar();
    const observa = secao('O que o Farol observa');
    // só a entrada com pontos aparece aqui; a outra está nas últimas revisões
    expect(within(observa).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['16/11/2026, PR #12 de dono/repo, Aprovação']);
    expect(within(observa).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Cobriu o caso de borda com Map.', 'Teste novo para o limite.']);
    expect(observa.querySelector('li code')?.textContent).toBe('Map');
    expect(observa.querySelector('li strong')?.textContent).toBe('limite');
  });

  it('"Números" sem os números do motor conta só as entradas listadas, e diz por que não há os do período', async () => {
    montar({ url: '/time?autor=Ana-Souza' });
    await assentar();
    const numeros = secao('Números');
    const caixas = [...numeros.querySelectorAll('dl > div')].map((d) => `${d.querySelector('dt')?.textContent}: ${d.querySelector('dd')?.textContent}`);
    expect(caixas).toEqual(['Entradas guardadas: 2', 'Aprovações: 1', 'Pedidos de mudança: 1', 'Comentários: 0']);
    expect(numeros.textContent).toContain('o motor não manda os números do período');
  });

  it('"Últimas revisões" mostra uma entrada por linha, com a bolinha do desfecho e o dia', async () => {
    montar({ url: '/time?autor=Ana-Souza' });
    await assentar();
    const itens = within(secao('Últimas revisões')).getAllByRole('listitem');
    expect(itens.map((li) => li.textContent)).toEqual(['Aprovação: PR #12 de dono/repo · 16/11/2026', 'Pedido de mudanças: PR #7 de dono/repo · 10/11/2026']);
    // a cor é a mesma do Histórico (tomDoDesfecho): aprovação verde, pedido de mudanças vermelho
    expect(itens.map((li) => li.querySelector('[data-tom]')?.getAttribute('data-tom'))).toEqual(['ok', 'ruim']);
  });

  it('Escape e Voltar à lista fecham, e o foco volta ao botão que abriu', async () => {
    montar();
    await assentar();
    await abrir('bruno');
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(window.location.search).toBe('');
    expect(semDossie()).toBe(true);
    expect(document.activeElement).toBe(botaoDe('bruno'));
    await abrir('bruno');
    await clicar(VOLTAR);
    expect(window.location.search).toBe('');
    expect(document.activeElement).toBe(botaoDe('bruno'));
  });

  it('Escape dentro de um seletor é do seletor, e não fecha o dossiê', async () => {
    montar({ url: '/time?autor=bruno' });
    await assentar();
    act(() => { fireEvent.keyDown(screen.getByLabelText('Papel'), { key: 'Escape' }); });
    expect(dossieDe('bruno')).toBeTruthy();
  });

  it('o voltar do navegador fecha o dossiê', async () => {
    montar();
    await assentar();
    await abrir('bruno');
    act(() => { voltarPara('/time'); });
    expect(semDossie()).toBe(true);
  });

  it('endereço colado abre o dossiê, sem diferenciar a caixa do login', async () => {
    montar({ url: '/time?autor=ana-souza' });
    // carregando: o esqueleto, e o título já é o lugar do foco
    expect(screen.getByText('Carregando o dossiê.').getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(tituloDoDossie());
    await assentar();
    expect(dossieDe('Ana-Souza')).toBeTruthy();
    expect(screen.queryByText('Carregando o dossiê.')).toBeNull();
    // o foco fica no título, que agora diz o nome
    expect(document.activeElement).toBe(tituloDoDossie());
    expect(tituloDoDossie().textContent).toBe('Ana Souza');
  });

  it('login que o motor não conhece diz que não há dossiê nem perfil, e o que uma remoção deixa', async () => {
    montar({ url: '/time?autor=ninguem' });
    await assentar();
    const nota = screen.getByText(/O motor não tem dossiê nem perfil de @ninguem/);
    expect(nota.textContent).toContain('a remoção apaga o dossiê, o perfil e as contestações. As revisões dos PRs dela continuam no Histórico e no log do motor.');
    expect(nota.textContent).not.toMatch(/não sobrou nada/);
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
  });

  it('sem dossiê e sem entradas têm textos diferentes', async () => {
    montar({ url: '/time?autor=caio' });
    await assentar();
    expect(within(secao('O que o Farol observa')).getByText(/O motor não tem dossiê de @caio/)).toBeTruthy();
    expect(subDoDossie()).toBe('@caio · Pleno · sem dossiê');
    // sem entradas, não há números nem últimas revisões a mostrar
    expect(within(dossie()).queryByRole('group', { name: 'Números' })).toBeNull();
    cleanup();
    montar({ url: '/time?autor=dora', responder: () => corpo([{ login: 'dora', entries: [] }]) });
    await assentar();
    expect(within(secao('O que o Farol observa')).getByText('O dossiê de @dora existe, mas está sem entradas.')).toBeTruthy();
    expect(within(dossie()).queryByRole('group', { name: 'Últimas revisões' })).toBeNull();
  });

  it('se a lista falha com o dossiê aberto, o erro aparece com o Tentar de novo', async () => {
    let falhar = true;
    montar({ url: '/time?autor=bruno', responder: () => (falhar ? REDE : corpo(TIME)) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('falha de rede');
    expect(within(dossie()).getByText(/Sem a lista do Time não dá para mostrar o dossiê de @bruno/)).toBeTruthy();
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(subDoDossie()).toContain('Júnior');
  });

  it('recarga que falha com o dossiê aberto não fica muda: o erro aparece e diz que a tela é da carga anterior', async () => {
    let falhar = false;
    const t = montar({ url: '/time?autor=bruno', responder: () => (falhar ? REDE : corpo(TIME)) });
    await assentar();
    falhar = true;
    t.trocarSnapshot({ ...SNAPSHOT, decisions: resolvidas('d2', 'd1') });
    // o aviso de Atualizar aparece também com o dossiê aberto
    await clicar('Atualizar');
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: Não deu para falar com o motor (falha de rede). O que está na tela é da última carga que deu certo.');
    expect(dossieDe('bruno')).toBeTruthy();
    expect(within(dossie()).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('mostra as contestações que o motor guarda dos PRs da pessoa, e diz quantas entram no prompt', async () => {
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
    const contestacoes = secao('Contestações');
    expect(contestacoes.open).toBe(false);
    expect(within(contestacoes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'PR #3 de dono/outro: O autor tinha razão. Nota: era intencional',
      'PR #4 de dono/outro: suspeita do motor, ainda sem confirmação',
    ]);
    expect(contestacoes.textContent).toContain('entram só as 5 confirmadas mais recentes; suspeita sem confirmação não entra');
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
    expect([...papel.options].map((o) => o.textContent)).toEqual(['Sem papel', 'Estágio', 'Júnior', 'Pleno', 'Sênior', 'Tech Lead', 'Arquiteto', 'Especialista', 'Dono do produto']);
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
    // o login tem maiúsculas no dossiê; a chave que vai é a do motor, em minúsculas
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/settings', {
      people: {
        bruno: { papel: 'junior' },
        caio: { papel: 'pleno' },
        'ana-souza': { papel: 'techlead', dominios: { backend: 'avancado', dados: 'basico' } },
      },
    }]);
    expect(regiao().textContent).toContain('O motor gravou o perfil de @Ana-Souza: papel Tech Lead; Backend: Avançado; Dados: Básico.');
    expect(regiao().textContent).not.toContain('Atenção');
    expect(document.activeElement).toBe(regiao());
    // a tela não muda por conta própria: o perfil mostrado só troca com o estado do motor
    expect(subDoDossie()).toContain('Sênior');
    t.trocarSnapshot(comPerfis(gravado));
    expect(subDoDossie()).toContain('Tech Lead');
    expect(resumoDe('Como revisar os PRs desta pessoa')).toContain('Tech Lead · Backend: Avançado · Dados: Básico');
    expect(screen.getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('o corpo sai do dado cru do motor: pessoa degradada, forma errada e campo desconhecido vão como vieram', async () => {
    const cru = { ana: { papel: 4 }, dora: 'x', eva: { papel: 'senior', squad: 'plataforma', dominios: { backend: 2 } }, bruno: { papel: 'junior', squad: 'dados' } };
    const t = montar({ url: '/time?autor=bruno', snapshot: comPerfis(cru) });
    await assentar();
    // a tela avisa dos ilegíveis, mas o salvar segue aberto
    expect(screen.getByText(/^Aviso: 4 perfil\(is\) chegaram do motor com campo ou formato que esta tela não lê/)).toBeTruthy();
    escolher('Papel', 'pleno');
    await clicar('Salvar papel e competência de @bruno');
    expect(t.post.mock.calls[0]?.[1]).toEqual({
      people: {
        ana: { papel: 4 },
        dora: 'x',
        eva: { papel: 'senior', squad: 'plataforma', dominios: { backend: 2 } },
        // na pessoa editada só o papel e os domínios mudam
        bruno: { squad: 'dados', papel: 'pleno' },
      },
    });
  });

  it('se o motor mexeu em outra pessoa ao gravar, o resultado diz quem', async () => {
    const cru = { ana: { papel: 4 }, bruno: { papel: 'junior' }, caio: { papel: 'pleno' } };
    montar({
      url: '/time?autor=bruno',
      snapshot: comPerfis(cru),
      aoPostar: () => corpo({ ok: true, ignoradas: [], config: { people: { bruno: { papel: 'pleno' }, caio: { papel: 'pleno' } } } }),
    });
    await assentar();
    escolher('Papel', 'pleno');
    await clicar('Salvar papel e competência de @bruno');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor gravou o perfil de @bruno: papel Pleno. Atenção: o perfil de outra pessoa ficou diferente do que esta tela enviou, mudou ou saiu da lista (@ana). Confira na tela.');
  });

  it('o salvar usa a lista de perfis do momento do clique, não a de quando o dossiê abriu', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', 'pleno');
    // outra aba gravou o perfil de outra pessoa, e o estado chegou aqui
    t.trocarSnapshot(comPerfis({ ...PESSOAS, dora: { papel: 'arquiteto' } }));
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
    expect(screen.getByText(/o salvar a substitui inteira/).textContent).toContain('a tela relê a lista no motor');
  });

  it('perfil que muda no motor com a edição aberta vira aviso, e dá para descartar a edição', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    escolher('Papel', 'pleno');
    t.trocarSnapshot(comPerfis({ ...PESSOAS, bruno: { papel: 'senior' } }));
    expect(screen.getByText(/o perfil de @bruno mudou no motor enquanto você editava/)).toBeTruthy();
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('pleno');
    await clicar('Descartar a edição e usar o perfil do motor');
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('senior');
    expect(screen.queryByText(/mudou no motor enquanto você editava/)).toBeNull();
  });

  it('sem edição aberta, o formulário acompanha o perfil do motor', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    t.trocarSnapshot(comPerfis({ ...PESSOAS, bruno: { papel: 'senior' } }));
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('senior');
    expect(screen.queryByText(/mudou no motor/)).toBeNull();
  });

  it('sem conexão o salvar fica fechado, e depois da reconexão só reabre quando o estado dela chega', async () => {
    const t = montar({ url: '/time?autor=bruno', conexao: 'reconectando', estadoEmDia: false });
    await assentar();
    escolher('Papel', 'pleno');
    expect(screen.getByText(/^Bloqueado: Esta aba está sem o estado do motor em dia \(conexão: reconectando\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
    // o motor aceitou a conexão nova (HTTP 200), mas o snapshot ainda é o de antes da queda
    act(() => { t.store.trocar({ conexao: 'conectado' }); });
    expect(screen.getByText(/^Bloqueado: A conexão com o motor acabou de abrir e o estado dele ainda não chegou/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
    // o primeiro state da conexão chegou
    act(() => { t.store.trocar({ estadoEmDia: true }); });
    expect(screen.queryByText(/^Bloqueado:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar papel e competência de @bruno' })).toBeTruthy();
  });

  it('sem a lista de perfis no snapshot o salvar fica fechado', async () => {
    montar({ url: '/time?autor=bruno', snapshot: { decisions: resolvidas('d1') } });
    await assentar();
    expect(screen.getByText(/^Bloqueado: O motor não mandou a lista de perfis/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
  });

  it('valor gravado que a tela não conhece aparece como opção, dito como desconhecido', async () => {
    montar({ url: '/time?autor=bruno', snapshot: comPerfis({ bruno: { papel: 'papel_novo' } }) });
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

  it('salvar e remover da mesma pessoa se excluem: com um no ar, o outro fica desabilitado', async () => {
    let soltar!: (r: Resposta) => void;
    const t = montar({ url: '/time?autor=bruno', aoPostar: () => new Promise<Resposta>((resolver) => { soltar = resolver; }) });
    await assentar();
    escolher('Papel', 'pleno');
    await clicar('Salvar papel e competência de @bruno');
    // o botão ocupado diz o processo, com o spinner, e fica desabilitado
    const salvando = screen.getByRole('button', { name: 'Salvando…' }) as HTMLButtonElement;
    expect(salvando.disabled).toBe(true);
    expect(salvando.querySelector('[data-tamanho="p"]')).toBeTruthy();
    const remover = screen.getByRole('button', { name: 'Remover @bruno do Time' }) as HTMLButtonElement;
    expect(remover.disabled).toBe(true);
    await act(async () => { soltar(corpo({ ok: true })); });
    await assentar();
    expect((screen.getByRole('button', { name: 'Remover @bruno do Time' }) as HTMLButtonElement).disabled).toBe(false);
    expect(t.post).toHaveBeenCalledTimes(1);
  });
});

describe('Time: edição não salva', () => {
  const abrirEditando = async () => {
    const t = montar();
    await assentar();
    await abrir('bruno');
    escolher('Papel', 'pleno');
    return t;
  };
  const pergunta = () => screen.queryByRole('group', { name: 'Descartar a edição do perfil de @bruno?' });

  it('Voltar à lista com edição por salvar pergunta antes, e o foco vai a Continuar editando', async () => {
    const t = await abrirEditando();
    await clicar(VOLTAR);
    expect(pergunta()?.textContent).toContain('não foram salvos');
    expect(pergunta()?.textContent).toContain('nada foi enviado ao motor');
    expect(window.location.search).toBe('?autor=bruno');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(t.post).not.toHaveBeenCalled();
  });

  it('Continuar editando fecha a pergunta, mantém a edição e devolve o foco', async () => {
    await abrirEditando();
    const voltar = screen.getByRole('button', { name: VOLTAR });
    voltar.focus();
    await clicar(VOLTAR);
    await clicar('Continuar editando');
    expect(pergunta()).toBeNull();
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('pleno');
    expect(document.activeElement).toBe(voltar);
  });

  it('Escape com edição por salvar pergunta; Escape de novo é continuar editando', async () => {
    await abrirEditando();
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(pergunta()).not.toBeNull();
    expect(dossieDe('bruno')).toBeTruthy();
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(pergunta()).toBeNull();
    expect(dossieDe('bruno')).toBeTruthy();
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('pleno');
  });

  it('Descartar fecha o dossiê sem enviar nada, e a edição não volta ao reabrir', async () => {
    const t = await abrirEditando();
    await clicar(VOLTAR);
    await clicar('Descartar a edição do perfil de @bruno e voltar à lista');
    expect(semDossie()).toBe(true);
    expect(window.location.search).toBe('');
    expect(t.post).not.toHaveBeenCalled();
    await abrir('bruno');
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('junior');
  });

  it('sem edição por salvar, ou com a edição desfeita à mão, não há pergunta', async () => {
    await abrirEditando();
    escolher('Papel', 'junior');
    await clicar(VOLTAR);
    expect(semDossie()).toBe(true);
  });

  it('o voltar do navegador não é segurado: o dossiê fecha e a edição vai embora', async () => {
    await abrirEditando();
    act(() => { voltarPara('/time'); });
    expect(semDossie()).toBe(true);
    expect(pergunta()).toBeNull();
  });

  it('trocar de pessoa pelo endereço com a pergunta de descarte aberta não leva a pergunta nem a edição', async () => {
    const t = await abrirEditando();
    await clicar(VOLTAR);
    expect(pergunta()).not.toBeNull();
    act(() => { voltarPara('/time?autor=Ana-Souza'); });
    expect(dossieDe('Ana-Souza')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Descartar a edição/ })).toBeNull();
    expect((screen.getByLabelText('Papel') as HTMLSelectElement).value).toBe('senior');
    expect(screen.getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });
});

describe('Time: remover do Time', () => {
  const comContestacao: Snapshot = { ...SNAPSHOT, pushbacks: { 'dono/repo#12': { outcome: 'we_right', status: 'confirmed', author: 'ana-souza' } } };

  it('pergunta antes, dizendo as três coisas apagadas, o que continua, que não desfaz e o efeito', async () => {
    const t = montar({ url: '/time?autor=Ana-Souza', snapshot: comContestacao });
    await assentar();
    await clicar('Remover @Ana-Souza do Time');
    const pergunta = screen.getByRole('group', { name: 'Remover @Ana-Souza do Time?' });
    expect(pergunta.textContent).toContain('O motor apaga três coisas de @Ana-Souza: o dossiê (2 entradas de memória nesta tela), o papel e a competência configurados e todos os registros de contestação dos PRs dela (1 nesta tela).');
    expect(pergunta.textContent).toContain('Não dá para desfazer, porque o motor não guarda cópia.');
    expect(pergunta.textContent).toContain('as revisões dos PRs dela continuam no Histórico, com ela como autora, e no log do motor');
    expect(pergunta.textContent).toContain('Nas próximas revisões dos PRs dela a sessão não encontra o dossiê');
    expect(pergunta.textContent).not.toMatch(/apaga tudo/i);
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
    expect(dossieDe('bruno')).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('trocar de pessoa pelo endereço com a confirmação aberta fecha a confirmação: nada é enviado, nem para a outra pessoa', async () => {
    const t = montar({ url: '/time?autor=bruno' });
    await assentar();
    await clicar('Remover @bruno do Time');
    act(() => { voltarPara('/time?autor=Ana-Souza'); });
    expect(dossieDe('Ana-Souza')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /^Remover @/ })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^${CONFIRMAR}`) })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover @Ana-Souza do Time' })).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('o voltar do navegador com a confirmação aberta fecha tudo sem enviar', async () => {
    const t = montar();
    await assentar();
    await abrir('bruno');
    await clicar('Remover @bruno do Time');
    act(() => { voltarPara('/time'); });
    expect(semDossie()).toBe(true);
    expect(screen.queryByRole('group', { name: /^Remover @/ })).toBeNull();
    expect(t.post).not.toHaveBeenCalled();
    // reabrir não traz a confirmação de volta
    await abrir('bruno');
    expect(screen.queryByRole('group', { name: /^Remover @/ })).toBeNull();
  });

  it('com a remoção no ar o botão diz "Removendo…", ocupado, e o salvar da mesma pessoa espera', async () => {
    let soltar!: (r: Resposta) => void;
    montar({ url: '/time?autor=bruno', aoPostar: () => new Promise<Resposta>((resolver) => { soltar = resolver; }) });
    await assentar();
    escolher('Papel', 'pleno');
    await clicar('Remover @bruno do Time');
    await clicar(`${CONFIRMAR}: @bruno`);
    const removendo = screen.getByRole('button', { name: 'Removendo…' }) as HTMLButtonElement;
    expect(removendo.disabled).toBe(true);
    expect(removendo.querySelector('[data-tamanho="p"]')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar papel e competência de @bruno' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { soltar(corpo({ ok: false, error: 'login inválido' })); });
    await assentar();
    expect(screen.queryByRole('button', { name: 'Removendo…' })).toBeNull();
  });

  it('duplo clique no confirmar manda um pedido só', async () => {
    let soltar!: (r: Resposta) => void;
    const t = montar({ url: '/time?autor=bruno', aoPostar: () => new Promise<Resposta>((resolver) => { soltar = resolver; }) });
    await assentar();
    await clicar('Remover @bruno do Time');
    const confirmar = screen.getByRole('button', { name: `${CONFIRMAR}: @bruno` });
    await act(async () => {
      fireEvent.click(confirmar);
      fireEvent.click(confirmar);
    });
    expect(t.post).toHaveBeenCalledTimes(1);
    await act(async () => { soltar(corpo({ ok: true, removed: true })); });
    await assentar();
    expect(t.post).toHaveBeenCalledTimes(1);
  });

  it('confirmar manda só o login como o motor o listou, diz o que o motor respondeu, fecha o dossiê e pede a lista de novo', async () => {
    let removida = false;
    const t = montar({
      url: '/time?autor=ana-souza',
      snapshot: comContestacao,
      responder: () => corpo(removida ? [BRUNO] : TIME),
      aoPostar: () => { removida = true; return corpo({ ok: true, removed: true }); },
    });
    await assentar();
    await clicar('Remover @Ana-Souza do Time');
    await clicar(`${CONFIRMAR}: @Ana-Souza`);
    await assentar();
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/team/remove', { login: 'Ana-Souza' }]);
    expect(regiao().textContent).toContain('O motor respondeu que apagou o que tinha de @Ana-Souza entre o dossiê, o perfil e as contestações (ele não diz quais existiam). Não há como desfazer. As revisões dos PRs dela continuam no Histórico e no log do motor.');
    expect(t.pedidos()).toEqual(['/api/team', '/api/team']);
    // o dossiê fechou, trocando a entrada do endereço, e o foco ficou no resultado
    expect(semDossie()).toBe(true);
    expect(window.location.search).toBe('');
    expect(document.activeElement).toBe(regiao());
    // o perfil dela ainda está no snapshot que a tela tem: mesmo assim ela não reaparece
    expect(nomes()).toEqual(['bruno', 'caio']);
    t.trocarSnapshot(comPerfis({ bruno: PESSOAS.bruno, caio: PESSOAS.caio }));
    expect(nomes()).toEqual(['bruno', 'caio']);
  });

  it('remoção aceita com a recarga falhando: o dossiê fecha, o erro aparece, e a pessoa não fica na lista com ações', async () => {
    let falhar = false;
    const t = montar({
      url: '/time?autor=Ana-Souza',
      responder: () => (falhar ? REDE : corpo(TIME)),
      aoPostar: () => { falhar = true; return corpo({ ok: true, removed: true }); },
    });
    await assentar();
    await clicar('Remover @Ana-Souza do Time');
    await clicar(`${CONFIRMAR}: @Ana-Souza`);
    await assentar();
    expect(semDossie()).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('falha de rede');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    // a lista é a da carga anterior, sem quem foi removido
    expect(nomes()).toEqual(['bruno', 'caio']);
    expect(screen.queryByRole('button', { name: /Ana-Souza/ })).toBeNull();
    // o endereço dela, colado, não reabre Salvar nem Remover
    act(() => { voltarPara('/time?autor=Ana-Souza'); });
    expect(screen.getByText(/O motor não tem dossiê nem perfil de @Ana-Souza/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover|Salvar/ })).toBeNull();
    act(() => { voltarPara('/time'); });
    // a carga que dá certo volta a valer como veio
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recusa do motor aparece, o dossiê fica aberto e a lista não é pedida de novo', async () => {
    const t = montar({ url: '/time?autor=bruno', aoPostar: () => corpo({ ok: false, error: 'login inválido' }) });
    await assentar();
    await clicar('Remover @bruno do Time');
    await clicar(`${CONFIRMAR}: @bruno`);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor recusou: login inválido');
    expect(t.pedidos()).toEqual(['/api/team']);
    expect(dossieDe('bruno')).toBeTruthy();
  });

  it('quando o motor não tinha nada, a tela diz isso em vez de afirmar que apagou', async () => {
    montar({ url: '/time?autor=caio', aoPostar: () => corpo({ ok: true, removed: false }) });
    await assentar();
    await clicar('Remover @caio do Time');
    expect(screen.getByRole('group', { name: 'Remover @caio do Time?' }).textContent).toContain('o dossiê, se houver');
    await clicar(`${CONFIRMAR}: @caio`);
    await assentar();
    expect(regiao().textContent).toContain('O motor respondeu que não tinha dossiê, perfil nem contestação de @caio: nada foi apagado.');
  });
});

describe('Time: adicionar pessoa', () => {
  const digitar = (valor: string) => { act(() => { fireEvent.change(screen.getByLabelText('Login do GitHub'), { target: { value: valor } }); }); };
  const enviar = async () => { await clicar('Adicionar ao Time'); await assentar(); };

  it('o botão abre o formulário; login é obrigatório, papel é opcional, e vai a lista inteira com a pessoa nova', async () => {
    const gravado = { ...PESSOAS, dani: {} };
    const t = montar({ aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: gravado } }) });
    await assentar();
    await clicar('Adicionar pessoa');
    expect(screen.getByRole('form', { name: 'Adicionar pessoa ao Time' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adicionar pessoa' })).toBeNull();
    await enviar();
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.getByText('Digite o login do GitHub.')).toBeTruthy();
    digitar('@Dani');
    await enviar();
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/settings', { people: { ...PESSOAS, dani: {} } }]);
    expect(regiao().textContent).toContain('O motor adicionou @Dani ao Time: sem papel nem competência.');
    // aceito, o formulário fecha; a pessoa aparece quando o estado do motor chega
    expect(screen.queryByRole('form', { name: 'Adicionar pessoa ao Time' })).toBeNull();
    t.trocarSnapshot(comPerfis(gravado));
    expect(nomes()).toContain('dani');
  });

  it('com papel, a pessoa vai com ele', async () => {
    const t = montar({ aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: { ...PESSOAS, dani: { papel: 'pleno' } } } }) });
    await assentar();
    await clicar('Adicionar pessoa');
    digitar('dani');
    escolher('Papel (opcional)', 'pleno');
    await enviar();
    expect(t.post.mock.calls[0]?.[1]).toEqual({ people: { ...PESSOAS, dani: { papel: 'pleno' } } });
    expect(regiao().textContent).toContain('O motor adicionou @dani ao Time: papel Pleno.');
  });

  it('login fora da forma do GitHub, ou de quem já está no Time, não é enviado', async () => {
    const t = montar();
    await assentar();
    await clicar('Adicionar pessoa');
    for (const torto of ['ana souza', '-ana', 'ana--b', 'a'.repeat(40)]) {
      digitar(torto);
      await enviar();
      expect(screen.getByText(/Login do GitHub tem só letras/)).toBeTruthy();
    }
    digitar('BRUNO');
    await enviar();
    expect(screen.getByText('@BRUNO já está no Time: o papel dela se edita no dossiê.')).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('motor que não guarda a pessoa sem papel é dito como erro', async () => {
    montar({ aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: PESSOAS } }) });
    await assentar();
    await clicar('Adicionar pessoa');
    digitar('dani');
    await enviar();
    expect(regiao().textContent).toContain('O motor não guardou @dani: a pessoa não entrou no Time.');
    expect(screen.getByRole('form', { name: 'Adicionar pessoa ao Time' })).toBeTruthy();
  });

  it('sem o estado da conexão o envio fica bloqueado, e Cancelar fecha', async () => {
    montar({ estadoEmDia: false });
    await assentar();
    await clicar('Adicionar pessoa');
    expect((screen.getByRole('button', { name: 'Adicionar ao Time' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/^Bloqueado:/)).toBeTruthy();
    await clicar('Cancelar');
    expect(screen.queryByRole('form', { name: 'Adicionar pessoa ao Time' })).toBeNull();
  });
});

describe('Time: números de 30 dias', () => {
  it('com os números do motor, o dossiê mostra PRs, aprovação de primeira e rodadas, e o resumo na linha', async () => {
    const comNumeros = [{ ...ANA, numeros: { janelaDias: 30, prs: 22, aprovadosDePrimeira: 15, rodadas: 35 } }, BRUNO];
    montar({ url: '/time?autor=Ana-Souza', responder: () => corpo(comNumeros) });
    await assentar();
    expect(subDoDossie()).toContain('22 PRs em 30 dias · 68% aprovados de primeira');
    expect(resumoDe('Números')).toContain('1,6 rodada por PR');
    const caixas = [...secao('Números').querySelectorAll('dl > div')].map((d) => `${d.querySelector('dt')?.textContent}: ${d.querySelector('dd')?.textContent}`);
    expect(caixas.slice(0, 3)).toEqual(['PRs revisados: 22', 'De primeira: 68%', 'Rodadas por PR: 1,6']);
  });

  it('os bloqueios do período entram ao lado das rodadas quando o motor os manda', async () => {
    montar({ url: '/time?autor=Ana-Souza', responder: () => corpo([{ ...ANA, numeros: { janelaDias: 30, prs: 22, aprovadosDePrimeira: 15, rodadas: 35, bloqueios: 3 } }, BRUNO]) });
    await assentar();
    const caixas = [...secao('Números').querySelectorAll('dl > div')].map((d) => `${d.querySelector('dt')?.textContent}: ${d.querySelector('dd')?.textContent}`);
    expect(caixas.slice(0, 4)).toEqual(['PRs revisados: 22', 'De primeira: 68%', 'Rodadas por PR: 1,6', 'Bloqueios: 3']);
    expect(secao('Números').textContent).toContain('quantas dessas revisões pediram mudanças');
  });

  it('bloqueios acima das rodadas, ou ausentes (motor antigo), não aparecem', async () => {
    for (const bloqueios of [99, undefined]) {
      montar({ url: '/time?autor=Ana-Souza', responder: () => corpo([{ ...ANA, numeros: { janelaDias: 30, prs: 22, aprovadosDePrimeira: 15, rodadas: 35, bloqueios } }]) });
      await assentar();
      expect(secao('Números').textContent).not.toContain('Bloqueios');
      cleanup();
    }
  });

  it('número incoerente (aprovados acima dos PRs) não é mostrado', async () => {
    montar({ url: '/time?autor=Ana-Souza', responder: () => corpo([{ ...ANA, numeros: { janelaDias: 30, prs: 2, aprovadosDePrimeira: 3, rodadas: 2 } }]) });
    await assentar();
    expect(subDoDossie()).not.toContain('PRs em 30 dias');
    expect(resumoDe('Números')).not.toContain('rodada por PR');
  });
});

describe('Time: releitura antes de gravar', () => {
  const NO_MOTOR = { ...PESSOAS, eva: { papel: 'senior' } };

  it('salvar papel relê o motor e não apaga o perfil gravado por outra aba', async () => {
    const t = montar({ url: '/time?autor=Ana-Souza', pessoasNoMotor: () => corpo({ config: { people: NO_MOTOR } }), aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: NO_MOTOR } }) });
    await assentar();
    escolher('Papel', 'techlead');
    await clicar('Salvar papel e competência de @Ana-Souza');
    await assentar();
    expect(t.pedidos()).toContain('/api/state');
    expect(t.post.mock.calls[0]?.[1]).toEqual({ people: { bruno: { papel: 'junior' }, caio: { papel: 'pleno' }, eva: { papel: 'senior' }, 'ana-souza': { papel: 'techlead', dominios: { backend: 'avancado' } } } });
  });

  it('adicionar relê o motor, mescla e recusa quem já entrou por outra aba', async () => {
    const t = montar({ pessoasNoMotor: () => corpo({ config: { people: NO_MOTOR } }), aoPostar: () => corpo({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: { ...NO_MOTOR, dani: {} } } }) });
    await assentar();
    await clicar('Adicionar pessoa');
    act(() => { fireEvent.change(screen.getByLabelText('Login do GitHub'), { target: { value: 'dani' } }); });
    await clicar('Adicionar ao Time');
    await assentar();
    expect(t.post.mock.calls[0]?.[1]).toEqual({ people: { ...NO_MOTOR, dani: {} } });
    cleanup();
    const u = montar({ pessoasNoMotor: () => corpo({ config: { people: NO_MOTOR } }) });
    await assentar();
    await clicar('Adicionar pessoa');
    act(() => { fireEvent.change(screen.getByLabelText('Login do GitHub'), { target: { value: 'eva' } }); });
    await clicar('Adicionar ao Time');
    await assentar();
    expect(u.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('@eva já está no Time no motor: o papel dela se edita no dossiê.');
  });

  it('releitura que falha não envia nada e diz por quê', async () => {
    const t = montar({ url: '/time?autor=Ana-Souza', pessoasNoMotor: () => REDE });
    await assentar();
    escolher('Papel', 'techlead');
    await clicar('Salvar papel e competência de @Ana-Souza');
    await assentar();
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Não deu para reler os perfis no motor antes de gravar, e nada foi enviado.');
  });
});

describe('Time: as ações do cartão', () => {
  it('Editar papel abre o dossiê com "Como revisar" aberta e o foco no papel; fechar devolve o foco ao Ver dossiê', async () => {
    montar();
    await assentar();
    await clicar('Editar papel de bruno');
    expect(window.location.search).toBe('?autor=bruno');
    expect(dossieDe('bruno')).toBeTruthy();
    expect(secao('Como revisar os PRs desta pessoa').open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Papel'));
    // trocar o papel e salvar segue o caminho do dossiê
    escolher('Papel', 'pleno');
    expect(screen.getByRole('button', { name: 'Salvar papel e competência de @bruno' })).toBeTruthy();
    escolher('Papel', 'junior');
    await clicar(VOLTAR);
    expect(document.activeElement).toBe(botaoDe('bruno'));
  });

  it('Ver dossiê depois de um Editar papel abre o dossiê do jeito de sempre, com o foco no título', async () => {
    montar();
    await assentar();
    await clicar('Editar papel de bruno');
    await clicar(VOLTAR);
    await clicar('Ver dossiê de bruno');
    expect(document.activeElement).toBe(tituloDoDossie());
    expect(secao('Como revisar os PRs desta pessoa').open).toBe(false);
  });

  it('o Editar papel não sobrevive ao fechar: o mesmo dossiê, reaberto pelo endereço, abre do jeito de sempre', async () => {
    montar();
    await assentar();
    await clicar('Editar papel de bruno');
    await clicar(VOLTAR);
    // o avançar do navegador volta ao dossiê
    await act(async () => { voltarPara('/time?autor=bruno'); });
    expect(document.activeElement).toBe(tituloDoDossie());
    expect(secao('Como revisar os PRs desta pessoa').open).toBe(false);
  });

  it('o Editar papel não sobrevive ao endereço que muda por fora', async () => {
    montar();
    await assentar();
    await clicar('Editar papel de bruno');
    // o voltar do navegador fecha, e o avançar reabre o mesmo dossiê
    await act(async () => { voltarPara('/time'); });
    expect(dossieDe('bruno')).toBeNull();
    await act(async () => { voltarPara('/time?autor=bruno'); });
    expect(document.activeElement).toBe(tituloDoDossie());
    expect(secao('Como revisar os PRs desta pessoa').open).toBe(false);
  });

  it('Editar papel com o dossiê sem leitura pronta leva o foco ao título, e não o perde', () => {
    for (const leitura of [{ fase: 'carregando' }, { fase: 'ausente' }, { fase: 'semLista' }] as const) {
      render(
        <Dossie
          login="bruno"
          leitura={leitura}
          editar
          cru={undefined}
          ilegiveis={0}
          conexao="conectado"
          emDia
          contestacoes={[]}
          controle={{} as unknown as ControleDeAcoes}
          relerPessoas={async () => ({ ok: false, texto: '' })}
          ocupado={false}
          aoFechar={() => {}}
        />,
      );
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: '@bruno' }));
      cleanup();
    }
  });

  it('Adicionar pessoa é o botão principal do topo e abre o formulário', async () => {
    montar();
    await assentar();
    const adicionar = screen.getByRole('button', { name: 'Adicionar pessoa' });
    expect(adicionar.className).toMatch(/primario/);
    await clicar('Adicionar pessoa');
    expect(screen.queryByRole('button', { name: 'Adicionar pessoa' })).toBeNull();
    expect(screen.getByLabelText(/Login do GitHub/)).toBeTruthy();
  });
});
