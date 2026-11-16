// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  return { pending: [], resolved: ids.map((id, i) => ({ id, resolvedAt: 1000 - i })), ilegiveis: 0 };
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
const titulosDosItens = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const umaPagina: Responder = () => corpo(paginaDoMotor([revisaoDoMotor(12), revisaoDoMotor(7, { status: 'posted', action: 'request_changes' })]));

beforeEach(() => { window.history.replaceState(null, '', '/historico'); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Histórico: a lista', () => {
  it('carrega a primeira página do motor, e não do snapshot', async () => {
    const t = montar({ responder: umaPagina });
    expect(screen.getByRole('heading', { level: 1, name: 'Histórico' })).toBeTruthy();
    expect(anuncio()).toBe('Carregando as revisões.');
    expect(titulosDosItens()).toEqual([]);
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1']);
    expect(anuncio()).toBe('2 revisões, página 1 de 1');
    expect(titulosDosItens()).toEqual(['dono/repo#12 (abre em nova aba)', 'dono/repo#7 (abre em nova aba)']);
  });

  it('cada linha diz o PR, o título, o autor, o card, o que foi publicado, a situação e quando', async () => {
    montar({ responder: umaPagina });
    await assentar();
    const [primeiro, segundo] = screen.getAllByRole('listitem');
    const campos = (item: HTMLElement | undefined) => [...(item?.querySelectorAll('dl > div') ?? [])].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);
    expect(within(primeiro as HTMLElement).getByText('Título do PR 12')).toBeTruthy();
    expect(campos(primeiro).slice(0, 4)).toEqual(['Autor: ana', 'Card: BT-12', 'Publicado: Aprovação', 'Situação: Publicado automaticamente']);
    expect(campos(primeiro)[4]).toMatch(/^Quando: \d{2}\/11\/2026, \d{2}:\d{2}$/);
    // o parecer só aparece quando difere do que foi publicado
    expect(campos(segundo).slice(2, 5)).toEqual(['Publicado: Pedido de mudanças', 'Parecer da revisão: aprovar', 'Situação: Publicado por você']);
    const link = within(primeiro as HTMLElement).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://github.com/dono/repo/pull/12');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('status e action que a tela não conhece aparecem crus, e item só com id e chave aparece com o que há', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(1, { status: 'status_novo', action: 'acao_nova' }), { id: 'x', key: 'dono/repo#3' }])) });
    await assentar();
    expect(screen.getByText('status_novo')).toBeTruthy();
    // action desconhecido aparece cru, mas não conta como publicado (a régua do motor)
    expect(screen.getByText('Nada publicado (o motor registrou "acao_nova")')).toBeTruthy();
    const pobre = screen.getAllByRole('listitem')[1] as HTMLElement;
    expect(within(pobre).getByRole('heading', { level: 3 }).textContent).toBe('dono/repo#3');
    expect(within(pobre).queryByRole('link')).toBeNull();
    expect(within(pobre).getByText('Nada publicado')).toBeTruthy();
    expect(within(pobre).getByText('Sem data registrada')).toBeTruthy();
  });

  it('texto de fora é texto, e o link do PR só existe para o GitHub por HTTPS', async () => {
    const marcado = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = montar({
      responder: () => corpo(paginaDoMotor([revisaoDoMotor(1, { card: marcado, pr: { url: 'javascript:alert(1)', title: marcado, author: marcado } })])),
    });
    await assentar();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByText(marcado)).toHaveLength(3);
  });

  it('item que a borda não leu é avisado, e os outros aparecem', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(1), { key: 'sem-id' }], { total: 2 })) });
    await assentar();
    expect(titulosDosItens()).toHaveLength(1);
    expect(screen.getByText(/1 revisão\(ões\) desta página chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('vazio sem filtro e vazio com filtro dizem coisas diferentes', async () => {
    montar({ responder: () => corpo(paginaDoMotor([])) });
    await assentar();
    expect(screen.getByText('O motor ainda não resolveu nenhuma revisão.')).toBeTruthy();
    expect(anuncio()).toBe('Nenhuma revisão');
    expect(screen.queryByRole('navigation', { name: 'Páginas do histórico' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limpar busca e filtros' })).toBeNull();
    cleanup();
    const t = montar({ url: '/historico?q=nada', responder: () => corpo(paginaDoMotor([])) });
    await assentar();
    expect(screen.getByText('Nenhuma revisão passa pela busca e pelos filtros escolhidos.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Limpar busca e filtros' })[0] as HTMLElement); });
    expect(window.location.search).toBe('');
    expect(t.pedidos().at(-1)).toBe('/api/decisions?page=1');
  });
});

describe('Histórico: filtros e busca no endereço', () => {
  it('o endereço com filtros vira o pedido, e os campos mostram o que o endereço diz', async () => {
    const t = montar({ url: '/historico?q=proj-9&veredito=skip&repo=dono%2Frepo&pagina=2', responder: () => corpo(paginaDoMotor([revisaoDoMotor(1)], { page: 2, pages: 2, total: 31 })) });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=2&q=proj-9&veredito=skip&repo=dono%2Frepo']);
    const busca = screen.getByRole('search', { name: 'Busca e filtros do histórico' });
    expect((within(busca).getByLabelText('Buscar') as HTMLInputElement).value).toBe('proj-9');
    expect((within(busca).getByLabelText('O que foi publicado') as HTMLSelectElement).value).toBe('skip');
    expect((within(busca).getByLabelText('Repositório') as HTMLSelectElement).value).toBe('dono/repo');
    expect(anuncio()).toBe('31 revisões, página 2 de 2');
  });

  it('o seletor de desfecho diz o que foi publicado, e o de repositório vem do motor', async () => {
    montar({ responder: umaPagina });
    await assentar();
    const opcoes = (rotulo: string) => [...(screen.getByLabelText(rotulo) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opcoes('O que foi publicado')).toEqual(['Todos', 'Aprovados', 'Mudanças pedidas', 'Comentados', 'Não publicados']);
    expect(opcoes('Repositório')).toEqual(['Todos', 'dono/outro', 'dono/repo']);
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
    expect(titulosDosItens()).toEqual(['dono/repo#5 (abre em nova aba)']);
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
    expect(titulosDosItens()).toEqual(['dono/repo#1 (abre em nova aba)']);
  });

  it('enquanto a página nova não chega, a anterior fica na tela, esmaecida e marcada como ocupada', async () => {
    const pendentes: Array<(r: Resposta) => void> = [];
    const { container } = montar({ responder: (caminho) => (caminho.endsWith('page=1') ? tresPaginas(caminho) : new Promise<Resposta>((resolver) => { pendentes.push(resolver); })) });
    await assentar();
    await clicar('Próxima página');
    const pagina = container.querySelector('[aria-busy]');
    expect(pagina?.getAttribute('aria-busy')).toBe('true');
    expect(pagina?.hasAttribute('data-esmaecida')).toBe(true);
    expect(titulosDosItens()).toEqual(['dono/repo#1 (abre em nova aba)']);
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pendentes[0]?.(await tresPaginas('/api/decisions?page=2')); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('[data-esmaecida]')).toBeNull();
    expect(titulosDosItens()).toEqual(['dono/repo#2 (abre em nova aba)']);
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

  it('falha de rede mostra o erro e o Tentar de novo, que pede de novo', async () => {
    let falhar = true;
    const t = montar({ responder: (caminho) => (falhar ? REDE : umaPagina(caminho)) });
    await assentar();
    const erro = screen.getByRole('alert');
    expect(erro.textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    expect(titulosDosItens()).toEqual([]);
    falhar = false;
    await act(async () => { fireEvent.click(within(erro).getByRole('button', { name: 'Tentar de novo' })); });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decisions?page=1']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(titulosDosItens()).toHaveLength(2);
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

describe('Histórico: detalhe da revisão', () => {
  const rica = revisaoDoMotor(12, {
    status: 'posted',
    action: 'request_changes',
    reportMarkdown: '## Achados\n\n- **Um** ponto com `codigo` e [doc](https://exemplo.com/a)\n- [x](javascript:alert(1))\n\n<script>alert(1)</script>',
    reasons: [{ text: 'a política manda esperar', kind: 'gate' }],
    attention: [{ text: 'olhar o teste', kind: 'content' }],
    rounds: { schema: 1, id: 'r1', ordinal: 2, mode: 'enforce', parentCount: 1, lateCount: 0, droppedCount: 0, resolvedOnUnchangedCount: 1, unresolvedCount: 3, unverified: false, changedContext: false },
    stages: { totalMs: 125000, stages: [{ id: 'ler', label: 'Leitura', ms: 4000 }] },
    verificationCheckpoint: { total: 5, confirmedCount: 4, conflictCount: 1 },
  });
  const comRica: Responder = () => corpo(paginaDoMotor([rica, revisaoDoMotor(7)]));
  const NOME = 'PR #12 de dono/repo';
  const abrir = async () => { await clicar(new RegExp(`^Ver a revisão de ${NOME}`)); };

  it('abre na própria página, com o foco no título e a revisão no endereço', async () => {
    montar({ responder: comRica });
    await assentar();
    const entradas = window.history.length;
    await abrir();
    expect(window.location.search).toBe('?id=d12&pr=dono%2Frepo%2312');
    expect(window.history.length).toBe(entradas + 1);
    const titulo = screen.getByRole('heading', { level: 2, name: `Revisão de ${NOME}` });
    expect(document.activeElement).toBe(titulo);
    // a lista sai da frente, sem ser desmontada
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Revisões' })).toBeNull();
  });

  it('mostra o que foi publicado, os motivos, o resumo técnico, as rodadas, as etapas e a conferência', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const detalhe = screen.getByRole('region', { name: `Revisão de ${NOME}` });
    const campos = [...detalhe.querySelectorAll('dl > div')].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);
    expect(campos).toContain('Publicado: Pedido de mudanças');
    expect(campos).toContain('Parecer da revisão: aprovar');
    expect(campos).toContain('Situação: Publicado por você');
    expect(campos).toContain('Avaliação técnica: Critérios técnicos comprovados.');
    expect(campos).toContain('Verificação de afirmações: 4 confirmada(s) de 5, com 1 divergência(s) entre passadas');
    expect(campos).toContain('Leitura: 4 s');
    expect(campos).toContain('Total: 2 min 5 s');
    expect(campos).toContain('Resolvidos em arquivo inalterado: 1');
    expect(within(screen.getByRole('region', { name: 'Motivos' })).getByRole('listitem').textContent).toBe('Regra do motor: a política manda esperar');
    expect(within(screen.getByRole('region', { name: 'Pontos de atenção' })).getByRole('listitem').textContent).toBe('Ponto da revisão: olhar o teste');
    expect(within(screen.getByRole('region', { name: 'Rodadas' })).getByText(/Rodada 2, com 3 pendência\(s\) rastreada\(s\)\. A comparação entre rodadas está ativa\./)).toBeTruthy();
  });

  it('o texto do parecer é desenhado de markdown, com link só https e HTML cru como texto', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    const texto = screen.getByRole('region', { name: 'Texto do parecer' });
    expect(within(texto).getByRole('heading', { level: 5, name: 'Achados' })).toBeTruthy();
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
    await clicar('Voltar à lista');
    // publicado igual ao parecer, e parecer que não foi publicado: sem o aviso
    await clicar(/^Ver a revisão de PR #7 de dono\/repo/);
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
    cleanup();
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { status: 'skipped', action: 'skip' })])) });
    await assentar();
    expect(screen.getByRole('region', { name: 'Texto do parecer' })).toBeTruthy();
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
  });

  it('action desconhecido não é tratado como publicado: sem o aviso de texto diferente', async () => {
    montar({ url: '/historico?id=d12', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { status: 'posted', action: 'acao_nova', verdict: 'approve' })])) });
    await assentar();
    const detalhe = screen.getByRole('region', { name: 'Revisão de PR #12 de dono/repo' });
    expect(within(detalhe).getByText('Nada publicado (o motor registrou "acao_nova")')).toBeTruthy();
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
    const detalhe = screen.getByRole('region', { name: 'Revisão de PR #12 de dono/repo' });
    const campos = [...detalhe.querySelectorAll('dl > div')].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);
    expect(campos).toContain('Publicado: Nada publicado ainda');
    expect(campos).toContain('Situação: Esperando a sua decisão no Radar');
    expect(campos).toContain('Parecer da revisão: pedir mudanças');
    expect(screen.queryByText(/O que foi publicado difere/)).toBeNull();
  });

  it('revisão sem texto gravado diz isso', async () => {
    montar({ responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { reportMarkdown: '' })])) });
    await assentar();
    await abrir();
    expect(screen.getByText('Esta revisão ficou sem texto gravado.')).toBeTruthy();
  });

  it('Escape fecha, o endereço perde a revisão e o foco volta ao botão que abriu', async () => {
    montar({ responder: comRica });
    await assentar();
    await abrir();
    await act(async () => { fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' }); });
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('region', { name: `Revisão de ${NOME}` })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: new RegExp(`^Ver a revisão de ${NOME}`) }));
    expect(screen.getByRole('search')).toBeTruthy();
  });

  it('Voltar à lista fecha do mesmo jeito, e a lista não é pedida de novo', async () => {
    const t = montar({ responder: comRica });
    await assentar();
    await abrir();
    await clicar('Voltar à lista');
    expect(window.location.search).toBe('');
    expect(t.pedidos()).toHaveLength(1);
    expect(titulosDosItens()).toHaveLength(2);
  });

  it('endereço com a revisão que está na página abre direto, sem pedir o detalhe ao motor', async () => {
    const t = montar({ url: '/historico?id=d12&pr=dono%2Frepo%2312', responder: comRica });
    expect(screen.getByText('Carregando a revisão.')).toBeTruthy();
    await assentar();
    expect(screen.getByRole('region', { name: 'Texto do parecer' })).toBeTruthy();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1']);
  });

  it('revisão que não está na página é pedida pela chave do PR', async () => {
    const t = montar({
      url: '/historico?id=d12&pr=dono%2Frepo%2312',
      responder: (caminho) => (caminho.startsWith('/api/decisions') ? corpo(paginaDoMotor([revisaoDoMotor(7)])) : corpo({ found: true, decision: rica })),
    });
    await assentar();
    await assentar();
    expect(t.pedidos()).toEqual(['/api/decisions?page=1', '/api/decision?key=dono%2Frepo%2312']);
    expect(screen.getByRole('region', { name: 'Texto do parecer' })).toBeTruthy();
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
    expect(screen.getByRole('region', { name: 'Texto do parecer' })).toBeTruthy();
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
    expect(screen.getByRole('region', { name: 'Texto do parecer' })).toBeTruthy();
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
    expect(screen.getByText(/O clique não publica nada: quando a análise termina, o motor publica sozinho ou deixa a revisão em Precisa de você/)).toBeTruthy();
    await clicar(`Revisar de novo ${NOME}`);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: ['https://github.com/dono/repo/pull/12'] }]);
    expect(regiao().querySelector('p')?.textContent).toBe(`O motor aceitou o pedido: revisar de novo ${NOME}.`);
  });

  it('sem URL de PR do GitHub não há botão de revisar, e a tela diz por quê', async () => {
    montar({ url: '/historico?id=d12&pr=dono%2Frepo%2312', responder: () => corpo(paginaDoMotor([revisaoDoMotor(12, { pr: { url: 'https://exemplo.com/x' } })])) });
    await assentar();
    expect(screen.queryByRole('button', { name: /Revisar de novo/ })).toBeNull();
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
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText(/o motor mudou este item/)).toBeNull();
    expect(screen.getByRole('button', { name: `Apagar a contestação de ${NOME}` })).toBeTruthy();
    // e a pergunta de apagar, aberta, fecha do mesmo jeito ao voltar para um desfecho
    await clicar(`Apagar a contestação de ${NOME}`);
    await act(async () => { fireEvent.change(within(secao).getByLabelText('Desfecho'), { target: { value: 'we_right' } }); });
    expect(screen.queryByRole('group')).toBeNull();
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
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: 'Voltar à lista' }), { key: 'Escape' }); });
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
