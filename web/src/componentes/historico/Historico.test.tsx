// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pendencia } from '@/contratos/radar';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { Resultado } from '@/transporte/cliente';
import { ESPERA_DA_BUSCA_MS } from './Filtros';
import { Historico } from './Historico';
import { paginaDoMotor, revisaoDoMotor, voltarPara } from './apoio-de-teste';

vi.mock('next/navigation', async () => (await import('./apoio-de-teste')).navegacaoDeMentira);

type Falha = Extract<Resultado<never>, { ok: false }>;
// O que o motor de mentira devolve: o corpo cru (que passa pelo leitor da borda, como no
// cliente de verdade) ou uma falha do transporte.
type Resposta = { corpo: unknown } | Falha;
type Responder = (caminho: string) => Resposta | Promise<Resposta>;

const corpo = (valor: unknown): Resposta => ({ corpo: valor });
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };
const ACEITE = { ok: true, dados: { ok: true } };

function resolvidas(...ids: string[]) {
  return { pending: [] as Pendencia[], resolved: ids.map((id, i) => ({ id, resolvedAt: 1000 - i })), ilegiveis: 0 };
}

function montar({ url = '/historico', responder, snapshot = { decisions: resolvidas('d1') } }: { url?: string; responder: Responder; snapshot?: Snapshot | null }) {
  window.history.replaceState(null, '', url);
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot });
  const sinais: AbortSignal[] = [];
  const get = vi.fn(async (caminho: string, leitor: (bruto: unknown) => unknown, opcoes?: { sinal?: AbortSignal }) => {
    if (opcoes?.sinal) sinais.push(opcoes.sinal);
    const r = await responder(caminho);
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  });
  const post = vi.fn(async (rota: string, enviado: unknown) => { void rota; void enviado; return ACEITE; });
  const app = { store, cliente: { get, post }, dispensarRecados: () => store.trocar({ recados: [] }) } as unknown as App;
  const tela = render(<Historico app={app} />);
  const pedidos = (): string[] => get.mock.calls.map(([caminho]) => caminho);
  return { store, get, post, sinais, pedidos, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };
const anuncio = () => screen.getByRole('status', { name: 'Resultado da consulta' }).textContent;
const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
const revisoes = () => screen.getByRole('region', { name: 'Revisões' });
// As linhas da lista paginada: o <details> de cada revisão, e o título (o texto do resumo
// sem a bolinha nem a hora).
const linhas = (): HTMLDetailsElement[] => [...revisoes().querySelectorAll<HTMLDetailsElement>(':scope details')];
const tituloDa = (linha: HTMLDetailsElement): string => linha.querySelector('summary')?.children[2]?.textContent ?? '';
const titulosDosItens = (): string[] => linhas().map(tituloDa);
const abrirLinha = async (linha: HTMLDetailsElement | undefined) => {
  await act(async () => {
    if (!linha) throw new Error('linha ausente');
    linha.open = true;
    fireEvent(linha, new Event('toggle'));
  });
};
const umaPagina: Responder = () => corpo(paginaDoMotor([revisaoDoMotor(12), revisaoDoMotor(7, { status: 'posted', action: 'request_changes' })]));

beforeEach(() => { window.history.replaceState(null, '', '/historico'); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Histórico: a lista', () => {
  it('carrega a primeira página do motor, e não do snapshot; sem nada ainda, esqueleto', async () => {
    const t = montar({ responder: umaPagina });
    expect(screen.getByRole('heading', { level: 1, name: 'Histórico' })).toBeTruthy();
    expect(screen.getByText('Carregando as revisões.').getAttribute('role')).toBe('status');
    expect(titulosDosItens()).toEqual([]);
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1']);
    expect(screen.queryByText('Carregando as revisões.')).toBeNull();
    expect(anuncio()).toBe('2 revisões, página 1 de 1');
    expect(titulosDosItens()).toEqual(['Título do PR 12', 'Título do PR 7']);
  });

  it('agrupa por dia, no fuso do navegador: Hoje, Ontem e depois a data', async () => {
    // só o Date é de mentira: as promessas e os relógios do teste seguem de verdade
    vi.useFakeTimers({ toFake: ['Date'] });
    // meio-dia UTC: o mesmo dia do calendário em qualquer fuso de -11 a +11 horas
    vi.setSystemTime(Date.UTC(2026, 10, 17, 12, 0));
    montar({
      responder: () => corpo(paginaDoMotor([
        revisaoDoMotor(1, { resolvedAt: Date.UTC(2026, 10, 17, 11, 0) }),
        revisaoDoMotor(2, { resolvedAt: Date.UTC(2026, 10, 17, 10, 0) }),
        revisaoDoMotor(3, { resolvedAt: Date.UTC(2026, 10, 16, 12, 0) }),
        revisaoDoMotor(4, { resolvedAt: Date.UTC(2026, 10, 14, 12, 0) }),
      ])),
    });
    await assentar();
    const grupos = within(revisoes()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(grupos).toEqual(['Hoje', 'Ontem', 'sábado, 14/11']);
    const hoje = within(revisoes()).getByRole('region', { name: 'Hoje' });
    expect([...hoje.querySelectorAll('details')].map((d) => tituloDa(d as HTMLDetailsElement))).toEqual(['Título do PR 1', 'Título do PR 2']);
    // a hora curta fica na ponta da linha
    expect(linhas()[0]?.querySelector('summary')?.children[3]?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('a linha abre num clique: o PR, o autor, o desfecho em texto e Abrir a revisão', async () => {
    montar({ responder: umaPagina });
    await assentar();
    const [primeira, segunda] = linhas();
    expect(primeira?.open).toBe(false);
    await abrirLinha(primeira);
    expect(primeira?.open).toBe(true);
    const corpoDaLinha = within(primeira as HTMLElement);
    expect(corpoDaLinha.getByText('dono/repo#12 · ana · Aprovação')).toBeTruthy();
    expect(corpoDaLinha.getByText(/^Publicado automaticamente; card BT-12; \d{2}\/11\/2026, \d{2}:\d{2}$/)).toBeTruthy();
    expect(corpoDaLinha.getByRole('button', { name: /^Abrir a revisão de PR #12 de dono\/repo, de / })).toBeTruthy();
    // revisão publicada não oferece Revisar de novo na linha
    expect(corpoDaLinha.queryByRole('button', { name: /Revisar de novo/ })).toBeNull();
    // o parecer só aparece quando difere do que foi publicado
    expect(within(segunda as HTMLElement).getByText(/^Publicado por você; parecer da revisão: aprovar/)).toBeTruthy();
  });

  it('a bolinha diz o desfecho ao leitor, e a legenda das cores fica no pé', async () => {
    montar({ responder: () => corpo(paginaDoMotor([
      revisaoDoMotor(1), revisaoDoMotor(2, { action: 'comment' }), revisaoDoMotor(3, { action: 'request_changes' }), revisaoDoMotor(4, { action: 'skip', status: 'skipped' }),
    ])) });
    await assentar();
    expect(linhas().map((l) => l.querySelector('summary')?.children[1]?.textContent)).toEqual(['Aprovação:', 'Comentário:', 'Pedido de mudanças:', 'Nada publicado:']);
    expect(linhas().map((l) => l.querySelector('summary [aria-hidden]')?.getAttribute('data-tom'))).toEqual(['ok', 'aviso', 'ruim', 'neutro']);
    const legenda = screen.getByRole('list', { name: 'Legenda das cores' });
    expect(within(legenda).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['aprovado', 'comentado', 'pediu mudanças', 'nada postado']);
  });

  it('revisão que não publicou nada oferece Revisar de novo na própria linha', async () => {
    const t = montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(3, { action: 'skip', status: 'superseded' })])) });
    await assentar();
    await abrirLinha(linhas()[0]);
    await clicar('Revisar de novo PR #3 de dono/repo');
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: ['https://github.com/dono/repo/pull/3'] }]);
  });

  it('status e action que a tela não conhece aparecem crus, e item só com id e chave aparece com o que há', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(1, { status: 'status_novo', action: 'acao_nova' }), { id: 'x', key: 'dono/repo#3' }])) });
    await assentar();
    const [primeira, pobre] = linhas();
    expect(within(primeira as HTMLElement).getByText(/^status_novo/)).toBeTruthy();
    // action desconhecido aparece cru, mas não conta como publicado (a régua do motor)
    expect(within(primeira as HTMLElement).getByText('dono/repo#1 · ana · Nada publicado (o motor registrou "acao_nova")')).toBeTruthy();
    expect(tituloDa(pobre as HTMLDetailsElement)).toBe('dono/repo#3');
    expect(pobre?.querySelector('summary')?.children[3]?.textContent).toBe('sem hora');
    expect(within(pobre as HTMLElement).getByText('dono/repo#3 · Nada publicado')).toBeTruthy();
    expect(within(pobre as HTMLElement).getByText('Sem registro de como foi resolvida')).toBeTruthy();
  });

  it('texto de fora é texto', async () => {
    const marcado = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = montar({
      responder: () => corpo(paginaDoMotor([revisaoDoMotor(1, { card: marcado, blockedReason: marcado, pr: { url: 'javascript:alert(1)', title: marcado, author: marcado } })])),
    });
    await assentar();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(tituloDa(linhas()[0] as HTMLDetailsElement)).toBe(marcado);
    // URL que não é de PR do GitHub não vira botão de revisar
    expect(screen.queryByRole('button', { name: /Revisar de novo/ })).toBeNull();
  });

  it('item que a borda não leu é avisado, e os outros aparecem', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(1), { key: 'sem-id' }], { total: 2 })) });
    await assentar();
    expect(titulosDosItens()).toHaveLength(1);
    expect(screen.getByText(/1 revisão\(ões\) desta página chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('nada revisado ainda leva ao Radar; filtro sem resultado oferece limpar', async () => {
    montar({ responder: () => corpo(paginaDoMotor([])) });
    await assentar();
    expect(screen.getByRole('heading', { level: 3, name: 'Nenhuma revisão ainda' })).toBeTruthy();
    expect(screen.getByText('O motor ainda não resolveu nenhuma revisão.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para o Radar' }).getAttribute('href')).toBe('/radar');
    expect(anuncio()).toBe('Nenhuma revisão');
    expect(screen.queryByRole('navigation', { name: 'Páginas do histórico' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limpar busca e filtros' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Legenda das cores' })).toBeNull();
    cleanup();
    const t = montar({ url: '/historico?q=nada', responder: () => corpo(paginaDoMotor([])) });
    await assentar();
    expect(screen.getByText('Nenhuma revisão passa pela busca e pelos filtros escolhidos.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ir para o Radar' })).toBeNull();
    await clicar('Limpar busca e filtros');
    expect(window.location.search).toBe('');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1');
  });
});

describe('Histórico: filtros e busca no endereço', () => {
  const gaveta = () => screen.getByText(/^Filtrar/).closest('details') as HTMLDetailsElement;

  it('o endereço com filtros vira o pedido; a busca e os filtros mostram o que o endereço diz', async () => {
    const t = montar({ url: '/historico?q=proj-9&veredito=skip&repo=dono%2Frepo&pagina=2', responder: () => corpo(paginaDoMotor([revisaoDoMotor(1)], { page: 2, pages: 2, total: 31 })) });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=2&q=proj-9&veredito=skip&repo=dono%2Frepo']);
    const busca = screen.getByRole('search', { name: 'Busca e filtros do histórico' });
    expect((within(busca).getByLabelText('Buscar') as HTMLInputElement).value).toBe('proj-9');
    expect((within(busca).getByLabelText('O que foi publicado') as HTMLSelectElement).value).toBe('skip');
    expect((within(busca).getByLabelText('Repositório') as HTMLSelectElement).value).toBe('dono/repo');
    expect(screen.getByText('Filtrar (2)')).toBeTruthy();
    const valendo = screen.getByRole('group', { name: 'Filtros valendo' });
    expect(within(valendo).getByRole('button', { name: 'Tirar o filtro Repositório: dono/repo' })).toBeTruthy();
    expect(within(valendo).getByRole('button', { name: 'Tirar o filtro O que foi publicado: Não publicados' })).toBeTruthy();
    expect(anuncio()).toBe('31 revisões, página 2 de 2');
  });

  it('os filtros ficam atrás de Filtrar, a busca fica à vista, e sem filtro não há chips', async () => {
    montar({ responder: umaPagina });
    await assentar();
    expect(gaveta().open).toBe(false);
    expect(screen.getByLabelText('Buscar').closest('details')).toBeNull();
    expect(gaveta().contains(screen.getByLabelText('Repositório'))).toBe(true);
    expect(screen.queryByRole('group', { name: 'Filtros valendo' })).toBeNull();
    const opcoes = (rotulo: string) => [...(screen.getByLabelText(rotulo) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opcoes('O que foi publicado')).toEqual(['Todos', 'Aprovados', 'Mudanças pedidas', 'Comentados', 'Não publicados']);
    expect(opcoes('Repositório')).toEqual(['Todos', 'dono/outro', 'dono/repo']);
    expect(gaveta().contains(screen.getByLabelText('Período'))).toBe(true);
    expect(opcoes('Período')).toEqual(['Todo o histórico', 'Últimos 7 dias', 'Últimos 30 dias']);
  });

  it('trocar um filtro vai ao endereço, volta à primeira página e pede de novo', async () => {
    const t = montar({ url: '/historico?pagina=3', responder: umaPagina });
    await assentar();
    const entradas = window.history.length;
    await act(async () => { fireEvent.change(screen.getByLabelText('O que foi publicado'), { target: { value: 'request_changes' } }); });
    expect(window.location.search).toBe('?veredito=request_changes');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&veredito=request_changes');
    await act(async () => { fireEvent.change(screen.getByLabelText('Repositório'), { target: { value: 'dono/outro' } }); });
    expect(window.location.search).toBe('?veredito=request_changes&repo=dono%2Foutro');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&veredito=request_changes&repo=dono%2Foutro');
  });

  it('o X de um chip tira só aquele filtro; Limpar filtros tira os dois e mantém a busca', async () => {
    const t = montar({ url: '/historico?q=ana&veredito=approve&repo=dono%2Frepo', responder: umaPagina });
    await assentar();
    await clicar('Tirar o filtro Repositório: dono/repo');
    // o chip some com o clique: o foco vai ao Filtrar, que fica
    expect(document.activeElement).toBe(screen.getByText(/^Filtrar/).closest('summary'));
    expect(window.location.search).toBe('?q=ana&veredito=approve');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&q=ana&veredito=approve');
    await act(async () => { voltarPara('/historico?q=ana&veredito=approve&repo=dono%2Frepo'); });
    await clicar('Limpar filtros');
    expect(window.location.search).toBe('?q=ana');
    expect(screen.queryByRole('group', { name: 'Filtros valendo' })).toBeNull();
    expect(screen.getByText('Filtrar')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('Filtrar').closest('summary'));
  });

  it('a busca espera a pessoa parar de digitar, e o pedido anterior é abortado', async () => {
    vi.useFakeTimers();
    const pendentes: Array<(r: Resposta) => void> = [];
    const t = montar({ responder: () => new Promise<Resposta>((resolver) => { pendentes.push(resolver); }) });
    const entradas = window.history.length;
    const campo = screen.getByLabelText('Buscar');
    fireEvent.change(campo, { target: { value: 'a' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    fireEvent.change(campo, { target: { value: 'ab' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    // nenhuma tecla virou pedido ainda: só o da carga inicial
    expect(t.pedidos()).toEqual(['/api/decisions?page=1']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decisions?page=1&q=ab']);
    expect(window.location.search).toBe('?q=ab');
    // a busca troca a entrada do endereço, não empilha uma por tecla
    expect(window.history.length).toBe(entradas);
    expect(t.sinais[0]?.aborted).toBe(true);
    expect(t.sinais[1]?.aborted).toBe(false);
    // a resposta atrasada do pedido abortado não entra na tela
    await act(async () => { pendentes[0]?.(corpo(paginaDoMotor([revisaoDoMotor(99)]))); await Promise.resolve(); });
    expect(titulosDosItens()).toEqual([]);
    await act(async () => { pendentes[1]?.(corpo(paginaDoMotor([revisaoDoMotor(5)]))); await Promise.resolve(); await Promise.resolve(); });
    expect(titulosDosItens()).toEqual(['Título do PR 5']);
  });

  it('Enter manda a busca na hora', async () => {
    vi.useFakeTimers();
    const t = montar({ responder: umaPagina });
    await assentar();
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'ana' } });
    await act(async () => { fireEvent.submit(screen.getByRole('search', { name: 'Busca e filtros do histórico' })); });
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&q=ana');
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS * 2); });
    expect(t.pedidos().filter((p) => p.includes('q=ana'))).toHaveLength(1);
  });

  it('o voltar do navegador refaz a consulta do endereço, e o campo de busca acompanha', async () => {
    const t = montar({ url: '/historico?q=ana', responder: umaPagina });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('O que foi publicado'), { target: { value: 'skip' } }); });
    expect(window.location.search).toBe('?q=ana&veredito=skip');
    await act(async () => { voltarPara('/historico?q=bia'); });
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&q=bia');
    expect((screen.getByLabelText('Buscar') as HTMLInputElement).value).toBe('bia');
    expect((screen.getByLabelText('O que foi publicado') as HTMLSelectElement).value).toBe('');
  });

  it('filtro do endereço que a tela não conhece vai ao motor, e a recusa diz o campo', async () => {
    const t = montar({
      url: '/historico?veredito=xyz',
      responder: () => ({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'veredito' } }),
    });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1&veredito=xyz']);
    const erro = screen.getByRole('alert');
    expect(erro.textContent).toContain('Erro: O motor recusou o filtro de desfecho (campo "veredito").');
    expect((screen.getByLabelText('O que foi publicado') as HTMLSelectElement).value).toBe('xyz');
    expect(screen.getByRole('button', { name: 'Tirar o filtro O que foi publicado: xyz (valor do endereço)' })).toBeTruthy();
    // recusa de parâmetro não se resolve tentando de novo
    expect(within(erro).queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    await act(async () => { fireEvent.click(within(erro).getByRole('button', { name: 'Limpar busca e filtros' })); });
    expect(window.location.search).toBe('');
  });
});

describe('Histórico: paginação e estados', () => {
  const tresPaginas: Responder = (caminho) => {
    const pagina = Number(new URLSearchParams(caminho.split('?')[1]).get('page'));
    return corpo(paginaDoMotor([revisaoDoMotor(pagina)], { page: pagina, pages: 3, total: 61 }));
  };

  it('a navegação tem nome, diz onde se está e desabilita o que não há', async () => {
    montar({ responder: tresPaginas });
    await assentar();
    const nav = screen.getByRole('navigation', { name: 'Páginas do histórico' });
    expect(within(nav).getByText('Página 1 de 3 · 61 revisões')).toBeTruthy();
    expect((within(nav).getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(nav).getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('próxima e anterior vão ao endereço, pedem a página e levam o foco ao título da lista', async () => {
    const t = montar({ responder: tresPaginas });
    await assentar();
    await clicar('Próxima página');
    await assentar();
    expect(window.location.search).toBe('?pagina=2');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=2');
    expect(anuncio()).toBe('61 revisões, página 2 de 3');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Revisões' }));
    await clicar('Página anterior');
    await assentar();
    expect(window.location.search).toBe('');
    expect(titulosDosItens()).toEqual(['Título do PR 1']);
  });

  it('enquanto a página nova não chega: barra no topo e a anterior apagada, marcada como ocupada', async () => {
    const pendentes: Array<(r: Resposta) => void> = [];
    const { container } = montar({ responder: (caminho) => (caminho.endsWith('page=1') ? tresPaginas(caminho) : new Promise<Resposta>((resolver) => { pendentes.push(resolver); })) });
    await assentar();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await clicar('Próxima página');
    expect(screen.getByRole('progressbar', { name: 'Carregando as revisões pedidas' })).toBeTruthy();
    const pagina = revisoes().querySelector('[aria-busy="true"]:not([role])');
    expect(pagina).toBeTruthy();
    expect(pagina?.className).toMatch(/apagada/);
    expect(titulosDosItens()).toEqual(['Título do PR 1']);
    expect(screen.queryByText('Carregando as revisões.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pendentes[0]?.(await tresPaginas('/api/decisions?page=2')); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(titulosDosItens()).toEqual(['Título do PR 2']);
  });

  it('página além do fim volta para a última, trocando a entrada do endereço', async () => {
    const t = montar({
      url: '/historico?pagina=9&veredito=approve',
      responder: (caminho) => (caminho.includes('page=9') ? corpo(paginaDoMotor([], { page: 9, pages: 3, total: 61 })) : tresPaginas(caminho)),
    });
    const entradas = window.history.length;
    await assentar();
    await assentar();
    expect(window.location.search).toBe('?veredito=approve&pagina=3');
    expect(window.history.length).toBe(entradas);
    expect(t.pedidos()).toEqual(['/api/decisions?page=9&veredito=approve', '/api/decisions?page=3&veredito=approve']);
    expect(anuncio()).toBe('61 revisões, página 3 de 3');
    expect(screen.queryByText(/Nenhuma revisão passa/)).toBeNull();
  });

  it('falha de rede sem lista mostra o erro e o Tentar de novo, que pede de novo', async () => {
    let falhar = true;
    const t = montar({ responder: (caminho) => (falhar ? REDE : umaPagina(caminho)) });
    await assentar();
    const erro = screen.getByRole('alert');
    expect(erro.textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).Tentar de novo');
    expect(titulosDosItens()).toEqual([]);
    falhar = false;
    await act(async () => { fireEvent.click(within(erro).getByRole('button', { name: 'Tentar de novo' })); });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decisions?page=1']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(titulosDosItens()).toHaveLength(2);
  });

  it('falha com lista anterior na tela diz que ela é da última carga que deu certo', async () => {
    const t = montar({ responder: (caminho) => (caminho.endsWith('page=1') ? tresPaginas(caminho) : REDE) });
    await assentar();
    await clicar('Próxima página');
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Não deu para falar com o motor (falha de rede). O que está na tela é da última carga que deu certo.');
    expect(titulosDosItens()).toEqual(['Título do PR 1']);
    expect(screen.queryByRole('progressbar')).toBeNull();
    await clicar('Tentar de novo');
    expect(t.pedidos().filter((p) => p.endsWith('page=2'))).toHaveLength(2);
  });

  it('histórico indisponível (503) diz isso e oferece tentar de novo', async () => {
    montar({ responder: () => ({ ok: false, falha: 'recusado', status: 503, detalhe: { codigo: 'historico_indisponivel' } }) });
    await assentar();
    const erro = screen.getByRole('alert');
    expect(erro.textContent).toContain('O histórico está indisponível no motor agora');
    expect(within(erro).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('resposta fora do formato é erro, não lista vazia', async () => {
    montar({ responder: () => corpo({ ok: true, items: 'x' }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O motor respondeu fora do formato esperado.');
    expect(screen.queryByText(/ainda não resolveu/)).toBeNull();
  });
});

describe('Histórico: aviso de revisões novas', () => {
  it('snapshot com resolvida nova mostra o aviso, sem recarregar nem mudar de página; Atualizar pede a mesma página', async () => {
    const t = montar({ url: '/historico?pagina=2', responder: () => corpo(paginaDoMotor([revisaoDoMotor(1)], { page: 2, pages: 2, total: 31 })) });
    await assentar();
    expect(screen.queryByText(/Há revisões novas/)).toBeNull();
    act(() => { t.store.trocar({ snapshot: { decisions: resolvidas('d9', 'd1') } }); });
    expect(screen.getByText(/Há revisões novas desde a última carga desta lista\./)).toBeTruthy();
    expect(t.pedidos()).toHaveLength(1);
    expect(window.location.search).toBe('?pagina=2');
    await clicar('Atualizar');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=2', '/api/decisions?page=2']);
    expect(screen.queryByText(/Há revisões novas/)).toBeNull();
  });

  it('snapshot que chega de novo com as mesmas resolvidas não avisa', async () => {
    const t = montar({ responder: umaPagina });
    await assentar();
    act(() => { t.store.trocar({ snapshot: { decisions: resolvidas('d1'), queue: [] } }); });
    expect(screen.queryByText(/Há revisões novas/)).toBeNull();
  });

  it('o primeiro snapshot que chega depois da lista não é novidade', async () => {
    const t = montar({ responder: umaPagina, snapshot: null });
    await assentar();
    act(() => { t.store.trocar({ snapshot: { decisions: resolvidas('d1') } }); });
    expect(screen.queryByText(/Há revisões novas/)).toBeNull();
    act(() => { t.store.trocar({ snapshot: { decisions: resolvidas('d2', 'd1') } }); });
    expect(screen.getByText(/Há revisões novas/)).toBeTruthy();
  });
});

describe('Histórico: pendências da mesa', () => {
  // `decisions.pending` do snapshot, já lido pela borda (lerPendencia)
  const pendencia = (n: number, extra: Partial<Pendencia> = {}): Pendencia => ({
    id: `p${n}`,
    key: `dono/repo#${n}`,
    createdAt: Date.UTC(2026, 10, 16, 15, 0),
    verdict: 'approve',
    pr: { repo: 'dono/repo', number: n, url: `https://github.com/dono/repo/pull/${n}`, title: `Pendente ${n}`, author: 'bia' },
    reportMarkdown: '',
    reasons: [],
    attention: [],
    ...extra,
  });
  const comPendencias = (...p: Pendencia[]): Snapshot => ({ decisions: { ...resolvidas('d1'), pending: p } });
  const grupo = () => screen.getByRole('region', { name: 'Sem nada postado ainda' });

  it('aparecem no topo, como nada postado, com o motivo do motor e sem nenhuma ação de mesa', async () => {
    montar({
      responder: umaPagina,
      snapshot: comPendencias(
        pendencia(40, { blockedReason: 'A política da conta manda esperar.' }),
        pendencia(41, { postRetry: { attempts: 3, exhausted: true } }),
      ),
    });
    await assentar();
    const g = grupo();
    // antes da lista paginada
    expect(g.compareDocumentPosition(revisoes()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // os títulos não pulam nível: o grupo é h2, como "Revisões", e os dias vêm em h3 depois
    const niveis = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    expect(niveis[0]).toBe(1);
    for (let i = 1; i < niveis.length; i += 1) expect((niveis[i] as number) - (niveis[i - 1] as number)).toBeLessThanOrEqual(1);
    expect(within(g).getByRole('heading', { level: 2, name: 'Sem nada postado ainda' })).toBeTruthy();
    const [primeira, segunda] = [...g.querySelectorAll('details')];
    expect(primeira?.querySelector('summary')?.textContent).toMatch(/^Nada postado:Pendente 40\d{2}:\d{2}$/);
    expect(primeira?.querySelector('summary [aria-hidden]')?.getAttribute('data-tom')).toBe('neutro');
    expect(within(primeira as HTMLElement).getByText('O motor não postou nada ainda. A política da conta manda esperar.')).toBeTruthy();
    expect(within(primeira as HTMLElement).getByText('dono/repo#40 · bia · nada postado')).toBeTruthy();
    expect(within(segunda as HTMLElement).getByText(/O motor não postou nada ainda\. A publicação falhou e o motor desistiu de tentar sozinho depois de 3 tentativa\(s\)\./)).toBeTruthy();
    // nada de mesa: só abrir e revisar de novo
    expect(within(g).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Abrir a revisão de PR #40 de dono/repo, sem nada postado', 'Revisar de novo PR #40 de dono/repo',
      'Abrir a revisão de PR #41 de dono/repo, sem nada postado', 'Revisar de novo PR #41 de dono/repo',
    ]);
    expect(screen.queryByRole('button', { name: /Aprovar|Pedir mudanças|Comentar|Pular/ })).toBeNull();
    // não entram na contagem nem na lista do motor
    expect(anuncio()).toBe('2 revisões, página 1 de 1');
    expect(titulosDosItens()).toEqual(['Título do PR 12', 'Título do PR 7']);
  });

  it('ficam fora da paginação e da busca: aparecem com filtro, em outra página e no vazio', async () => {
    const t = montar({ url: '/historico?q=zzz&pagina=2', responder: () => corpo(paginaDoMotor([])), snapshot: comPendencias(pendencia(40)) });
    await assentar();
    expect(within(grupo()).getAllByRole('group')).toHaveLength(1);
    expect(t.pedidos().every((p) => p.startsWith('/api/decisions?'))).toBe(true);
    expect(screen.getByText('Nenhuma revisão passa pela busca e pelos filtros escolhidos.')).toBeTruthy();
  });

  it('sem pendências o grupo não aparece; pendência ilegível é avisada', async () => {
    montar({ responder: umaPagina });
    await assentar();
    expect(screen.queryByRole('region', { name: 'Sem nada postado ainda' })).toBeNull();
    cleanup();
    montar({ responder: umaPagina, snapshot: { decisions: { ...resolvidas('d1'), ilegiveis: 2 } } });
    await assentar();
    expect(within(grupo()).getByText(/2 revisão\(ões\) sem nada postado chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('Abrir a revisão pede o detalhe pela chave, mostra nada postado e devolve o foco ao fechar', async () => {
    const doMotor = revisaoDoMotor(40, { id: 'p40', status: 'pending', action: undefined, resolvedAt: undefined, blockedReason: 'A política da conta manda esperar.' });
    const t = montar({
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? umaPagina(caminho) : corpo({ found: true, decision: doMotor })),
      snapshot: comPendencias(pendencia(40)),
    });
    await assentar();
    await clicar('Abrir a revisão de PR #40 de dono/repo, sem nada postado');
    await assentar();
    expect(window.location.search).toBe('?id=p40&pr=dono%2Frepo%2340');
    expect(t.pedidos().at(-1)).toBe('/api/decision?key=dono%2Frepo%2340');
    const detalhe = screen.getByRole('region', { name: 'Revisão de PR #40 de dono/repo' });
    expect(within(detalhe).getByText('Nada postado')).toBeTruthy();
    expect(within(detalhe).getByText('O motor ainda não postou nada desta revisão. Nada desta revisão foi postado no GitHub.')).toBeTruthy();
    expect(within(detalhe).queryByRole('button', { name: /Aprovar|Pedir mudanças|Comentar|Pular/ })).toBeNull();
    await clicar('Voltar ao Histórico');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir a revisão de PR #40 de dono/repo, sem nada postado' }));
  });

  it('Revisar de novo manda a URL do PR ao motor', async () => {
    const t = montar({ responder: umaPagina, snapshot: comPendencias(pendencia(40)) });
    await assentar();
    await clicar('Revisar de novo PR #40 de dono/repo');
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: ['https://github.com/dono/repo/pull/40'] }]);
  });
});

describe('Histórico: detalhe da revisão', () => {
  const rica = revisaoDoMotor(12, {
    status: 'posted',
    action: 'request_changes',
    blockedReason: 'Falta o teste do caso vazio.',
    reportMarkdown: '## Achados\n\n- **Um** ponto com `codigo` e [doc](https://exemplo.com/a)\n- [x](javascript:alert(1))\n\n<script>alert(1)</script>',
    reasons: [{ text: 'a política manda esperar', kind: 'gate' }],
    attention: [{ text: 'olhar o teste', kind: 'content' }],
    rounds: { schema: 1, id: 'r1', ordinal: 2, mode: 'enforce', parentCount: 1, lateCount: 0, droppedCount: 0, resolvedOnUnchangedCount: 1, unresolvedCount: 3, unverified: false, changedContext: false },
    stages: { totalMs: 125000, stages: [{ id: 'ler', label: 'Leitura', ms: 4000 }] },
    verificationCheckpoint: { total: 5, confirmedCount: 4, conflictCount: 1 },
  });
  const comRica: Responder = () => corpo(paginaDoMotor([rica, revisaoDoMotor(7)]));
  const NOME = 'PR #12 de dono/repo';
  const abrir = async () => { await clicar(new RegExp(`^Abrir a revisão de ${NOME}`)); };
  const detalhe = () => screen.getByRole('region', { name: `Revisão de ${NOME}` });
  const campos = (raiz: HTMLElement) => [...raiz.querySelectorAll('dl > div')].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);

  it('abre na própria página, com o foco no título e a revisão no endereço', async () => {
    montar({ responder: comRica });
    await assentar();
    const entradas = window.history.length;
    await abrir();
    expect(window.location.search).toBe('?id=d12&pr=dono%2Frepo%2312');
    expect(window.history.length).toBe(entradas + 1);
    const titulo = screen.getByRole('heading', { level: 1, name: 'Título do PR 12' });
    expect(document.activeElement).toBe(titulo);
    // a lista sai da frente, sem ser desmontada
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Histórico' })).toBeNull();
  });

  it('o topo diz o PR, o autor, a rodada e o card; o chip do desfecho, a hora e o link do GitHub', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const d = detalhe();
    expect(within(d).getByText('dono/repo#12 · ana · 2ª rodada · BT-12')).toBeTruthy();
    expect(within(d).getByText('Pediu mudanças')).toBeTruthy();
    expect(within(d).getByText(/^publicado em \d{2}\/11\/2026, \d{2}:\d{2}$/)).toBeTruthy();
    const github = within(d).getByRole('link', { name: 'Ver no GitHub (abre em nova aba)' });
    expect(github.getAttribute('href')).toBe('https://github.com/dono/repo/pull/12');
    expect(github.getAttribute('rel')).toBe('noreferrer noopener');
    // a frase é a avaliação técnica que o motor manda
    // (e volta, como campo, em Execução)
    expect(within(d).getAllByText('Critérios técnicos comprovados.').map((e) => e.tagName)).toEqual(['P', 'DD']);
  });

  it('os achados: o bloqueio aberto, motivos e pontos de atenção fechados, uma linha cada', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const achados = screen.getByRole('region', { name: 'Achados' });
    const bloqueio = within(achados).getByRole('group', { name: 'Bloqueio: Falta o teste do caso vazio.' }) as HTMLDetailsElement;
    const motivo = within(achados).getByRole('group', { name: 'Motivo: a política manda esperar' }) as HTMLDetailsElement;
    const atencao = within(achados).getByRole('group', { name: 'Ponto de atenção: olhar o teste' }) as HTMLDetailsElement;
    expect([bloqueio.open, motivo.open, atencao.open]).toEqual([true, false, false]);
    expect(within(motivo).getByText('Origem: Regra do motor')).toBeTruthy();
    expect(within(atencao).getByText('Origem: Ponto da revisão')).toBeTruthy();
  });

  it('sem bloqueio, motivo nem ponto de atenção, não há seção de achados', async () => {
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12)])) });
    await assentar();
    expect(screen.queryByRole('region', { name: 'Achados' })).toBeNull();
  });

  it('Mais detalhes: execução, rodadas, etapas e o review, tudo fechado, com o resumo na linha', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const mais = screen.getByRole('region', { name: 'Mais detalhes' });
    const linhasDe = [...mais.querySelectorAll(':scope > details')] as HTMLDetailsElement[];
    expect(linhasDe.map((l) => [l.getAttribute('aria-label'), l.open, l.querySelector('summary')?.children[1]?.textContent])).toEqual([
      ['Execução', false, 'Pedido de mudanças'],
      ['Rodadas', false, 'rodada 2 · 3 pendência(s)'],
      ['Etapas da sessão', false, '2 min 5 s'],
      ['Review completo', false, 'texto gravado'],
    ]);
    const todos = campos(mais);
    expect(todos).toContain('Publicado: Pedido de mudanças');
    expect(todos).toContain('Parecer da revisão: aprovar');
    expect(todos).toContain('Situação: Publicado por você');
    expect(todos).toContain('Avaliação técnica: Critérios técnicos comprovados.');
    expect(todos).toContain('Verificação de afirmações: 4 confirmada(s) de 5, com 1 divergência(s) entre passadas');
    expect(todos).toContain('Leitura: 4 s');
    expect(todos).toContain('Total: 2 min 5 s');
    expect(todos).toContain('Resolvidos em arquivo inalterado: 1');
    expect(within(mais).getByText(/Rodada 2, com 3 pendência\(s\) rastreada\(s\)\. A comparação entre rodadas está ativa\./)).toBeTruthy();
  });

  it('o review completo é desenhado de markdown, com link só https e HTML cru como texto', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const texto = screen.getByRole('group', { name: 'Review completo' });
    expect(within(texto).getByRole('heading', { level: 5, name: 'Achados', hidden: true })).toBeTruthy();
    expect(texto.querySelector('strong')?.textContent).toBe('Um');
    expect(texto.querySelector('code')?.textContent).toBe('codigo');
    expect([...texto.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://exemplo.com/a']);
    expect(texto.querySelector('script')).toBeNull();
    expect(texto.textContent).toContain('[x](javascript:alert(1))');
    expect(texto.textContent).toContain('<script>alert(1)</script>');
  });

  it('quando o publicado difere do parecer, a tela avisa que o texto pode não ser o que saiu', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    expect(screen.getByText(/O que foi publicado difere do parecer da revisão: o texto abaixo pode não ser o que saiu no PR\./)).toBeTruthy();
    await clicar('Voltar ao Histórico');
    // publicado igual ao parecer: sem o aviso
    await clicar(/^Abrir a revisão de PR #7 de dono\/repo/);
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
    cleanup();
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { status: 'skipped', action: 'skip' })])) });
    await assentar();
    expect(screen.getByRole('group', { name: 'Review completo' })).toBeTruthy();
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
  });

  it('action desconhecido não é tratado como publicado: sem o aviso de texto diferente', async () => {
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { status: 'posted', action: 'acao_nova', verdict: 'approve' })])) });
    await assentar();
    expect(campos(detalhe())).toContain('Publicado: Nada publicado (o motor registrou "acao_nova")');
    expect(within(detalhe()).getByText('Nada postado')).toBeTruthy();
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
  });

  it('pendência da mesa aberta pela chave mostra que nada foi publicado ainda', async () => {
    const pendente = revisaoDoMotor(12, { status: 'pending', action: undefined, resolvedAt: undefined, verdict: 'request_changes' });
    montar({
      url: '/historico?id=d12&pr=dono%2Frepo%2312',
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([])) : corpo({ found: true, decision: pendente })),
    });
    await assentar();
    await assentar();
    const lidos = campos(detalhe());
    expect(lidos).toContain('Publicado: Nada publicado ainda');
    expect(lidos).toContain('Situação: O motor ainda não postou nada desta revisão');
    expect(lidos).toContain('Parecer da revisão: pedir mudanças');
    expect(within(detalhe()).getByText(/^análise concluída em /)).toBeTruthy();
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
  });

  it('revisão sem texto gravado diz isso, já na linha fechada', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { reportMarkdown: '' })])) });
    await assentar();
    await abrir();
    const review = screen.getByRole('group', { name: 'Review completo' });
    expect(review.querySelector('summary')?.textContent).toContain('sem texto gravado');
    expect(within(review).getByText('Esta revisão ficou sem texto gravado.')).toBeTruthy();
  });

  it('revisão que não postou nada diz isso, com o chip cinza e Revisar de novo como ação principal', async () => {
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { status: 'superseded', action: 'skip' })])) });
    await assentar();
    const d = detalhe();
    expect(within(d).getByText('Nada postado').getAttribute('data-tom')).toBe('neutro');
    expect(within(d).getByText('Substituído por rodada nova. Nada desta revisão foi postado no GitHub.')).toBeTruthy();
    expect(within(d).getByText(/^resolvida em /)).toBeTruthy();
    expect(within(d).getByRole('button', { name: `Revisar de novo ${NOME}` })).toBeTruthy();
  });

  it('Escape fecha, o endereço perde a revisão e o foco volta ao botão que abriu', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    await act(async () => { fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' }); });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('region', { name: `Revisão de ${NOME}` })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: new RegExp(`^Abrir a revisão de ${NOME}`) }));
    expect(screen.getByRole('search')).toBeTruthy();
  });

  it('Voltar ao Histórico fecha do mesmo jeito, e a lista não é pedida de novo', async () => {
    const t = montar({ responder: comRica });
    await assentar();
    await abrir();
    expect(screen.getByRole('button', { name: 'Voltar ao Histórico' }).textContent).toBe('← Histórico');
    await clicar('Voltar ao Histórico');
    expect(window.location.search).toBe('');
    expect(t.pedidos().filter((p) => p.startsWith('/api/decisions'))).toHaveLength(1);
    expect(titulosDosItens()).toHaveLength(2);
  });

  it('endereço com a revisão que está na página abre direto, e pede ao motor só o complemento', async () => {
    const t = montar({ url: '/historico?id=d12&pr=dono%2Frepo%2312', responder: comRica });
    expect(screen.getByText('Carregando a revisão.').getAttribute('role')).toBe('status');
    await assentar();
    expect(screen.getByRole('group', { name: 'Review completo' })).toBeTruthy();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decision?key=dono%2Frepo%2312&id=d12']);
  });

  it('revisão que não está na página é pedida pela chave do PR', async () => {
    const t = montar({
      url: '/historico?id=d12&pr=dono%2Frepo%2312',
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([revisaoDoMotor(7)])) : corpo({ found: true, decision: rica })),
    });
    await assentar();
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decision?key=dono%2Frepo%2312']);
    expect(screen.getByRole('group', { name: 'Review completo' })).toBeTruthy();
    expect(screen.queryByText(/O endereço pedia outra revisão/)).toBeNull();
  });

  it('quando o motor devolve outra revisão do mesmo PR, a tela diz que não é a pedida', async () => {
    montar({
      url: '/historico?id=antiga&pr=dono%2Frepo%2312',
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([])) : corpo({ found: true, decision: rica })),
    });
    await assentar();
    await assentar();
    expect(screen.getByText(/O endereço pedia outra revisão deste PR/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Review completo' })).toBeTruthy();
  });

  it('revisão que o motor não acha, ou endereço sem a chave do PR, viram aviso', async () => {
    montar({
      url: '/historico?id=d99&pr=dono%2Frepo%2399',
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([])) : corpo({ found: false, decision: null })),
    });
    await assentar();
    await assentar();
    expect(screen.getByText(/o motor não tem revisão deste PR para mostrar/)).toBeTruthy();
    cleanup();
    const t = montar({ url: '/historico?id=d99', responder: () => corpo(paginaDoMotor([])) });
    await assentar();
    expect(screen.getByText(/o endereço não diz de qual PR ela é/)).toBeTruthy();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1']);
  });

  it('falha ao buscar o detalhe mostra o erro e o Tentar de novo', async () => {
    let falhar = true;
    const t = montar({
      url: '/historico?id=d12&pr=dono%2Frepo%2312',
      responder: (caminho) => {
        if (caminho.startsWith('/api/decisions')) return corpo(paginaDoMotor([]));
        return falhar ? REDE : corpo({ found: true, decision: rica });
      },
    });
    await assentar();
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos().filter((p) => p.startsWith('/api/decision?'))).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Review completo' })).toBeTruthy();
  });
});

describe('Histórico: ações do detalhe', () => {
  const NOME = 'PR #12 de dono/repo';
  const sujo = revisaoDoMotor(12, { pr: { repo: 'dono/repo', number: 12, url: 'https://github.com/dono/repo/pull/12/files?w=1#diff', title: 'T', author: 'ana' } });
  const abrir = async (snapshot: Snapshot = { decisions: resolvidas('d12') }) => {
    const t = montar({ url: '/historico?id=d12&pr=dono%2Frepo%2312', responder: () => corpo(paginaDoMotor([sujo])), snapshot });
    await assentar();
    return t;
  };

  it('Revisar de novo manda a URL canônica do PR, sem pergunta, e diz o que acontece', async () => {
    const t = await abrir();
    expect(screen.getByText(/O clique não publica nada: quando a análise termina, o motor segue a política da conta, que pode publicar sozinha\./)).toBeTruthy();
    await clicar(`Revisar de novo ${NOME}`);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: ['https://github.com/dono/repo/pull/12'] }]);
    expect(regiao().querySelector('p')?.textContent).toBe(`O motor aceitou o pedido: revisar de novo ${NOME}.`);
  });

  it('sem URL de PR do GitHub não há botão de revisar nem link, e a tela diz por quê', async () => {
    montar({ url: '/historico?id=d12&pr=dono%2Frepo%2312', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { pr: { url: 'https://exemplo.com/x' } })])) });
    await assentar();
    expect(screen.queryByRole('button', { name: /Revisar de novo/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Ver no GitHub/ })).toBeNull();
    expect(screen.getByText(/não traz o endereço do PR no GitHub/)).toBeTruthy();
  });

  it('sem contestação registrada para o PR, a seção não aparece', async () => {
    await abrir({ decisions: resolvidas('d12'), pushbacks: { 'dono/outro#1': { outcome: 'mixed' } } });
    expect(screen.queryByRole('region', { name: 'Contestação do autor' })).toBeNull();
  });

  it('suspeita do motor pede confirmação do desfecho, e gravar manda o desfecho e a nota', async () => {
    const t = await abrir({
      decisions: resolvidas('d12'),
      pushbacks: { 'dono/repo#12': { author: 'ana', outcome: 'author_right', note: 'era intencional', at: 5, source: 'auto', status: 'pending' } },
    });
    const secao = screen.getByRole('region', { name: 'Contestação do autor' });
    expect(within(secao).getByText(/O motor suspeita que o autor contestou a revisão deste PR: era intencional\./)).toBeTruthy();
    expect(within(secao).getByText(/entra no prompt das próximas revisões dos PRs do autor.*também no de revisões de outros autores neste repositório.*o motor deixa de procurar contestação neste PR sozinho.*Gravar não publica nada no GitHub[.]/)).toBeTruthy();
    expect((within(secao).getByLabelText('Desfecho') as HTMLSelectElement).value).toBe('author_right');
    fireEvent.change(within(secao).getByLabelText('Desfecho'), { target: { value: 'mixed' } });
    fireEvent.change(within(secao).getByLabelText('Nota curta (opcional)'), { target: { value: '  parte procedia  ' } });
    await clicar(`Gravar o desfecho da contestação de ${NOME}`);
    // gravar muda o prompt de revisões futuras: pergunta antes, com o que acontece
    expect(t.post).not.toHaveBeenCalled();
    const pergunta = screen.getByRole('group', { name: `Gravar o desfecho da contestação de ${NOME}?` });
    expect(pergunta.textContent).toContain('também no das revisões de PRs de outros autores neste repositório');
    expect(pergunta.textContent).toContain('o motor deixa de procurar contestação neste PR sozinho');
    expect(pergunta.textContent).toContain('Nada é publicado no GitHub.');
    await clicar(`Gravar o desfecho: ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/pushback', { key: 'dono/repo#12', author: 'ana', outcome: 'mixed', note: 'parte procedia' }]);
    expect(regiao().querySelector('p')?.textContent).toBe(`O motor aceitou o pedido: gravar o desfecho da contestação de ${NOME}.`);
  });

  it('contestação confirmada mostra o desfecho, de onde veio e a nota', async () => {
    await abrir({ decisions: resolvidas('d12'), pushbacks: { 'dono/repo#12': { author: 'ana', outcome: 'we_right', note: 'o autor cedeu', source: 'manual', status: 'confirmed' } } });
    const secao = screen.getByRole('region', { name: 'Contestação do autor' });
    expect(within(secao).getByText(/Contestação registrada: A revisão tinha razão \(registrada à mão\)\. Nota: o autor cedeu/)).toBeTruthy();
  });

  it('apagar o registro pergunta antes; Escape fecha só a pergunta, e confirmar manda o desfecho vazio', async () => {
    const t = await abrir({ decisions: resolvidas('d12'), pushbacks: { 'dono/repo#12': { author: 'ana', outcome: 'mixed', note: 'n', status: 'confirmed' } } });
    const secao = screen.getByRole('region', { name: 'Contestação do autor' });
    fireEvent.change(within(secao).getByLabelText('Desfecho'), { target: { value: '' } });
    await clicar(`Apagar a contestação de ${NOME}`);
    expect(t.post).not.toHaveBeenCalled();
    const pergunta = screen.getByRole('group', { name: `Apagar a contestação de ${NOME}?` });
    expect(pergunta.textContent).toContain('Nada é publicado no GitHub.');
    await act(async () => { fireEvent.keyDown(within(pergunta).getByRole('button', { name: 'Voltar sem enviar' }), { key: 'Escape' }); });
    // a pergunta fechou, e o detalhe continua aberto
    expect(screen.queryByRole('group', { name: `Apagar a contestação de ${NOME}?` })).toBeNull();
    expect(screen.getByRole('region', { name: `Revisão de ${NOME}` })).toBeTruthy();
    expect(window.location.search).toBe('?id=d12&pr=dono%2Frepo%2312');
    await clicar(`Apagar a contestação de ${NOME}`);
    await clicar(`Apagar o registro: ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/pushback', { key: 'dono/repo#12', author: 'ana', outcome: '', note: '' }]);
  });

  it('trocar o desfecho com a pergunta aberta fecha a pergunta, sem dizer que o motor mudou o item', async () => {
    const t = await abrir({ decisions: resolvidas('d12'), pushbacks: { 'dono/repo#12': { author: 'ana', outcome: 'mixed', status: 'confirmed' } } });
    const secao = screen.getByRole('region', { name: 'Contestação do autor' });
    await clicar(`Gravar o desfecho da contestação de ${NOME}`);
    expect(screen.getByRole('group', { name: `Gravar o desfecho da contestação de ${NOME}?` })).toBeTruthy();
    await act(async () => { fireEvent.change(within(secao).getByLabelText('Desfecho'), { target: { value: '' } }); });
    expect(screen.queryByRole('group', { name: /contestação de .*\?$/ })).toBeNull();
    expect(screen.queryByText(/o motor mudou este item/)).toBeNull();
    expect(screen.getByRole('button', { name: `Apagar a contestação de ${NOME}` })).toBeTruthy();
    // e a pergunta de apagar, aberta, fecha do mesmo jeito ao voltar para um desfecho
    await clicar(`Apagar a contestação de ${NOME}`);
    await act(async () => { fireEvent.change(within(secao).getByLabelText('Desfecho'), { target: { value: 'we_right' } }); });
    expect(screen.queryByRole('group', { name: /contestação de .*\?$/ })).toBeNull();
    expect(screen.queryByText(/o motor mudou este item/)).toBeNull();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('Escape dentro de um campo do detalhe não fecha o detalhe', async () => {
    await abrir({ decisions: resolvidas('d12'), pushbacks: { 'dono/repo#12': { author: 'ana', outcome: 'mixed', status: 'confirmed' } } });
    const secao = screen.getByRole('region', { name: 'Contestação do autor' });
    for (const campo of [within(secao).getByLabelText('Nota curta (opcional)'), within(secao).getByLabelText('Desfecho')]) {
      await act(async () => { fireEvent.keyDown(campo, { key: 'Escape' }); });
      expect(screen.getByRole('region', { name: `Revisão de ${NOME}` })).toBeTruthy();
      expect(window.location.search).toBe('?id=d12&pr=dono%2Frepo%2312');
    }
    // fora de campo, Escape continua fechando
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: 'Voltar ao Histórico' }), { key: 'Escape' }); });
    expect(screen.queryByRole('region', { name: `Revisão de ${NOME}` })).toBeNull();
  });

  it('recusa do motor aparece na região de resultado, e o aviso dele (toast) também', async () => {
    const t = await abrir();
    t.post.mockResolvedValueOnce({ ok: true, dados: { ok: false, error: 'gh sem token' } } as never);
    await clicar(`Revisar de novo ${NOME}`);
    expect(regiao().querySelector('p')?.textContent).toBe('Erro: O motor recusou: gh sem token');
    act(() => { t.store.trocar({ recados: [{ n: 1, tom: 'info', texto: 'dono/repo#12 entrou na fila.' }] }); });
    expect(regiao().textContent).toContain('Aviso do motor: dono/repo#12 entrou na fila.');
  });
});

describe('Histórico: período', () => {
  it('o select Período vai ao endereço e manda ao motor o primeiro dia, com chip e Limpar filtros', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-17T15:00:00Z'));
    const t = montar({ responder: umaPagina });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('Período'), { target: { value: '7' } }); });
    expect(window.location.search).toBe('?periodo=7');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1&desde=2026-11-11');
    expect(screen.getByText('Filtrar (1)')).toBeTruthy();
    await clicar('Tirar o filtro Período: Últimos 7 dias');
    expect(window.location.search).toBe('');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1');
  });

  it('o motor recusando o período diz o campo', async () => {
    montar({ url: '/historico?periodo=30', responder: () => ({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'desde' } }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O motor recusou o início do período (campo "desde").');
  });
});

describe('Histórico: critérios do card, checks do head e execução', () => {
  const NOME = 'PR #12 de dono/repo';
  const daPagina = revisaoDoMotor(12);
  const complemento = {
    ...daPagina,
    checks: { conferidoNoHead: true, semExigencia: false, naoVerdes: [], herdados: [{ nome: 'osv', estado: 'vermelho' }] },
    execucao: { tentativas: 2, modelos: ['Opus 4.1'], duracaoMs: 420_000, custoUsd: 2.84, custoEstimado: false },
  };
  const responder = (decisao: unknown): Responder => (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([daPagina])) : corpo({ found: true, decision: decisao }));
  const pedirAberta = `/historico?id=d12&pr=${encodeURIComponent('dono/repo#12')}`;
  const linhasDe = () => [...screen.getByRole('region', { name: 'Mais detalhes' }).querySelectorAll(':scope > details')] as HTMLDetailsElement[];
  const resumos = () => linhasDe().map((l) => [l.getAttribute('aria-label'), l.querySelector('summary')?.children[1]?.textContent]);
  const campos = (nome: string) => [...(linhasDe().find((l) => l.getAttribute('aria-label') === nome)?.querySelectorAll('dl > div') ?? [])]
    .map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);

  it('a revisão da página ganha as linhas com o que GET /api/decision traz, pedida pelo id', async () => {
    const t = montar({ url: pedirAberta, responder: responder(complemento) });
    await assentar();
    await assentar();
    expect(t.pedidos().at(-1)).toBe('/api/decision?key=dono%2Frepo%2312&id=d12');
    expect(screen.getByRole('region', { name: `Revisão de ${NOME}` })).toBeTruthy();
    expect(resumos().slice(0, 2)).toEqual([['Checks do head', 'tudo verde · osv herdado'], ['Execução', '7 min · US$ 2,84']]);
    expect(campos('Checks do head')).toEqual(['osv: Falha também na base (herdado, não pesa)']);
    expect(campos('Execução').slice(0, 4)).toEqual(['Duração da rodada: 7 min', 'Custo estimado: US$ 2,84', 'Modelo: Opus 4.1', 'Tentativas de revisão na rodada: 2']);
    expect(screen.queryByText(/pode faltar tentativa do começo/)).toBeNull();
  });

  it('sem complemento (motor antigo, outra revisão ou falha) as linhas novas não aparecem', async () => {
    for (const decisao of [daPagina, { ...complemento, id: 'outra' }]) {
      montar({ url: `/historico?id=d12&pr=${encodeURIComponent('dono/repo#12')}`, responder: responder(decisao) });
      await assentar();
      await assentar();
      expect(resumos()[0]).toEqual(['Execução', 'Aprovação']);
      cleanup();
    }
  });

  it('os critérios do card vêm numa linha fechada, com a contagem e o estado de cada um em texto', async () => {
    const criterios = [
      { texto: 'Navegar entre as versões geradas', atende: true },
      { texto: 'Limite de cinco regenerações', atende: true },
      { texto: 'Editar a versão escolhida antes de enviar', atende: false },
      { texto: 'Mensagem de erro do servidor', atende: null },
    ];
    montar({ url: pedirAberta, responder: responder({ ...complemento, criteriosDoCard: criterios }) });
    await assentar();
    await assentar();
    expect(resumos()[0]).toEqual(['Critérios do card BT-12', '2 de 4 atendidos · 1 sem conferir']);
    const linha = linhasDe()[0] as HTMLDetailsElement;
    expect(linha.open).toBe(false);
    expect([...linha.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '✓AtendeNavegar entre as versões geradas',
      '✓AtendeLimite de cinco regenerações',
      '✕Não atendeEditar a versão escolhida antes de enviar',
      '?Não conferidoMensagem de erro do servidor',
    ]);
  });

  it('sem critérios declarados a linha não aparece', async () => {
    montar({ url: pedirAberta, responder: responder({ ...complemento, criteriosDoCard: [] }) });
    await assentar();
    await assentar();
    expect(resumos().map((r) => r[0])).not.toContain('Critérios do card');
    expect(resumos()[0]?.[0]).toBe('Checks do head');
  });

  it('o que falta no head vem por nome, e leitura fora do commit revisado é dita', async () => {
    const naoVerdes = { ...complemento, checks: { conferidoNoHead: true, semExigencia: false, naoVerdes: [{ nome: 'e2e', estado: 'rodando' }], herdados: [] }, execucao: { tentativas: 1, modelos: [], inicioIncerto: true } };
    montar({ url: `/historico?id=d12&pr=${encodeURIComponent('dono/repo#12')}`, responder: responder(naoVerdes) });
    await assentar();
    await assentar();
    expect(resumos().slice(0, 2)).toEqual([['Checks do head', '1 fora do verde'], ['Execução', '1 tentativa no diário']]);
    expect(campos('Checks do head')).toEqual(['e2e: ainda rodando']);
    expect(screen.getByText(/pode faltar tentativa do começo/)).toBeTruthy();
    cleanup();
    montar({ url: `/historico?id=d12&pr=${encodeURIComponent('dono/repo#12')}`, responder: responder({ ...complemento, checks: { ...complemento.checks, conferidoNoHead: false } }) });
    await assentar();
    await assentar();
    expect(resumos()[0]).toEqual(['Checks do head', 'não conferidos no commit revisado']);
  });
});
