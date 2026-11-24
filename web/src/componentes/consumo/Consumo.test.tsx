// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEITORES, type ChaveDoSnapshot, type Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { Resultado } from '@/transporte/cliente';
import { voltarPara } from '../historico/apoio-de-teste';
import { Consumo } from './Consumo';
import { ESPERA_DA_BUSCA_MS } from './Filtros';
import { SESSOES_A_VISTA } from './SessoesRecentes';
import { consumoDoMotor, operacaoDoMotor, relatorioDoMotor, sessaoDoMotor, somaDoMotor } from './apoio-de-teste';

vi.mock('next/navigation', async () => (await import('../historico/apoio-de-teste')).navegacaoDeMentira);

type Falha = Extract<Resultado<never>, { ok: false }>;
// O que o motor de mentira devolve: o corpo cru (que passa pelo leitor da borda, como no
// cliente de verdade) ou uma falha do transporte.
type Resposta = { corpo: unknown } | Falha;
type Responder = (caminho: string) => Resposta | Promise<Resposta>;

const corpo = (valor: unknown): Resposta => ({ corpo: valor });
// O CSV chega ao leitor com os cabeçalhos que a tela pede (o cliente os junta ao texto).
const arquivo = (texto: string, nome: string | null = null, tipo = 'text/csv; charset=utf-8'): Resposta => corpo({
  corpo: texto,
  cabecalhos: { 'content-type': tipo, 'content-disposition': nome === null ? null : `attachment; filename="${nome}"` },
});
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };

// O snapshot como a borda o entrega ao store: cada chave crua passa pelo leitor dela.
function snapshotDe(cru: Partial<Record<ChaveDoSnapshot, unknown>>): Snapshot {
  const lido: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(cru)) {
    const ler = LEITORES[chave as ChaveDoSnapshot] as (v: unknown, r: (a: string) => void) => unknown;
    const v = ler(valor, () => {});
    if (v !== undefined) lido[chave] = v;
  }
  return lido as Snapshot;
}

const PERFIS_DO_MOTOR = {
  config: { claudeProfiles: [{ id: 'perfil-a', label: 'Assinatura A', kind: 'dir' }, { id: 'perfil-b', label: 'Assinatura B', kind: 'dir' }], claudeProfileId: 'perfil-b' },
  claudePerfis: { problemas: [], uso: { 'perfil-a': { lido: true, ok: true, janelas: [{ nome: 'Sessão', usado: 0.25, resetTexto: '17:00' }, { nome: 'Semana', usado: 0.5 }] } } },
  activeSessions: [{ id: 's1', keys: ['dono/repo#3'], perfilId: 'perfil-a' }],
};

const snapshotCom = (usage: unknown, extra: Partial<Record<ChaveDoSnapshot, unknown>> = PERFIS_DO_MOTOR): Snapshot => snapshotDe({ usage, ...extra });

function montar({ url = '/consumo', responder = () => corpo(relatorioDoMotor()), snapshot = snapshotCom(consumoDoMotor()) }: { url?: string; responder?: Responder; snapshot?: Snapshot | null } = {}) {
  window.history.replaceState(null, '', url);
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot });
  const sinais: AbortSignal[] = [];
  const get = vi.fn(async (caminho: string, leitor: (bruto: unknown) => unknown, opcoes?: { sinal?: AbortSignal; texto?: boolean }) => {
    if (opcoes?.sinal) sinais.push(opcoes.sinal);
    const r = await responder(caminho);
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  });
  const post = vi.fn();
  const app = { store, cliente: { get, post } } as unknown as App;
  const tela = render(<Consumo app={app} />);
  // o CSV não é relatório: fica de fora da lista de pedidos do relatório
  const pedidos = (): string[] => get.mock.calls.map(([caminho]) => caminho).filter((c) => !c.includes('formato=csv'));
  return { store, get, post, sinais, pedidos, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome, hidden: true })); }); };
const anuncio = () => screen.getByRole('status', { name: 'Resultado da consulta' }).textContent;
const secao = (nome: string | RegExp) => screen.getByRole('region', { name: nome, hidden: true });
const painel = (titulo: string) => screen.getByRole('heading', { name: titulo }).closest('section') as HTMLElement;
const tabela = (nome: string) => within(secao(nome)).getByRole('table', { hidden: true });
const linhasDa = (nome: string): string[][] => within(tabela(nome)).getAllByRole('row', { hidden: true }).slice(1).map((linha) => [...linha.querySelectorAll('th,td')].map((celula) => celula.textContent ?? ''));
const numeros = () => within(screen.getByRole('list', { name: 'Números do período' })).getAllByRole('listitem').map((li) => li.textContent);
const periodo = (rotulo: string) => within(screen.getByRole('group', { name: 'Período' })).getByRole('button', { name: rotulo });
// A linha que abre, pelo título do resumo.
function linha(titulo: string): HTMLDetailsElement {
  const achada = [...document.querySelectorAll('details')].find((d) => d.querySelector(':scope > summary span')?.textContent === titulo);
  if (!achada) throw new Error(`sem a linha ${titulo}`);
  return achada;
}
const resumoDa = (titulo: string) => linha(titulo).querySelector(':scope > summary')?.textContent ?? '';
const SESSOES = 'Tabela das sessões';

beforeEach(() => { window.history.replaceState(null, '', '/consumo'); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Consumo: a tela', () => {
  it('na ordem do desenho: período, filtros, números, plano, por dia e por repositório, por modelo e por gatilho, e cada sessão', async () => {
    montar();
    await assentar();
    expect(screen.getByRole('heading', { level: 1, name: 'Consumo' })).toBeTruthy();
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Plano de cada perfil do Claude', 'Custo por dia', 'Por repositório', 'Por modelo', 'Para que foi o gasto', 'Cada sessão',
      'Revisões que não publicaram',
    ]);
    expect(screen.getByRole('search', { name: 'Busca e filtros do consumo' })).toBeTruthy();
    for (const nome of ['Buscar sessão', 'Repositório', 'Autor do PR', 'Modelo', 'Perfil do Claude']) expect(screen.getByLabelText(nome)).toBeTruthy();
    // sem estilo em linha: a CSP de produção não aceita
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('os números são os que o motor somou, sem média feita pela tela', async () => {
    montar();
    await assentar();
    expect(numeros()).toEqual([
      'Custo estimadoUS$ 12,50O valor que cada sessão informa, não cobrança.',
      'Revisões concluídas3Em 2 PRs. Concluída não quer dizer publicada.',
      'Execuções de IA51 é retentativa de uma operação.',
      'Tokens de saída2 milMais 0 de pensamento e 6 mil de entrada.',
    ]);
    expect(document.body.textContent).not.toMatch(/média|NaN/);
  });

  it('o plano de cada perfil: na ordem da configuração, com o selo, as janelas lidas e o que falta', async () => {
    montar();
    await assentar();
    const plano = painel('Plano de cada perfil do Claude');
    const cartoes = within(plano).getAllByRole('listitem');
    expect(cartoes.map((c) => within(c).getByRole('heading').textContent)).toEqual(['Assinatura A', 'Assinatura B']);
    expect(cartoes[0]?.textContent).toContain('Em uso agora');
    expect(cartoes[0]?.textContent).toContain('Sessão25% usado, volta 17:00');
    expect(cartoes[0]?.textContent).toContain('Semana50% usado');
    expect(cartoes[1]?.textContent).toContain('Perfil padrão');
    expect(cartoes[1]?.textContent).toContain('O motor ainda não leu o uso do plano deste perfil.');
    cleanup();
    montar({ snapshot: null });
    await assentar();
    expect(painel('Plano de cada perfil do Claude').textContent).toContain('O estado do motor ainda não chegou.');
  });

  it('o gráfico por dia tem a frase para o leitor e a tabela como alternativa em texto', async () => {
    montar();
    await assentar();
    const dia = painel('Custo por dia');
    expect(dia.textContent).toContain('Custo estimado por dia de Brasília, em dólar, de 18/10/2026 a 16/11/2026 (30 dias). 3 dias com execução. Maior dia: 15/11/2026, com US$ 9,10.');
    // um botão por dia do período, com o dia e o valor no nome
    const barras = within(within(dia).getByRole('group', { name: 'Custo por dia: cada dia filtra a tela' })).getAllByRole('button');
    expect(barras).toHaveLength(30);
    expect(barras.at(-2)?.getAttribute('aria-label')).toBe('Filtrar pelo dia 15/11/2026: US$ 9,10');
    expect(barras[0]?.getAttribute('aria-label')).toBe('Filtrar pelo dia 18/10/2026: sem execução');
    expect(resumoDa('Ver em tabela')).toBe('Ver em tabela3 dias com execução');
    expect(linhasDa('Tabela do consumo por dia').map((l) => l.slice(0, 3))).toEqual([['14/11/2026', 'US$ 2,00', '1'], ['15/11/2026', 'US$ 9,10', '3'], ['16/11/2026', 'US$ 1,40', '1']]);
  });

  it('por modelo, por gatilho e por repositório: do maior custo ao menor, com o valor escrito ao lado da barra', async () => {
    montar();
    await assentar();
    const itens = (titulo: string) => within(painel(titulo)).getAllByRole('listitem').map((li) => li.textContent);
    expect(itens('Por modelo')).toEqual([
      'Sonnet 5US$ 10,00 · 4 execuçõesTokens: entrada 5 mil, saída 1,8 mil, pensamento 90',
      'Opus 5US$ 2,50 · 1 execuçãoTokens: entrada 1 mil, saída 200, pensamento 10',
    ]);
    expect(itens('Para que foi o gasto')).toEqual([
      'Primeira revisãoUS$ 8,00 · 3 execuções', 'Contestação do autorUS$ 2,50 · 1 execução', 'Revisão de commit novoUS$ 2,00 · 1 execução',
    ]);
    expect(itens('Por repositório')).toEqual(['repoUS$ 10,00 · 4 execuções', 'outroUS$ 2,50 · 1 execução']);
    // o número das quebras é de tentativas: nenhuma delas fala em sessão, que é a linha da tabela
    for (const titulo of ['Por modelo', 'Para que foi o gasto', 'Por repositório']) expect(painel(titulo).textContent, titulo).not.toMatch(/sess(ão|ões)/i);
  });
});

describe('Consumo: o clique que vira filtro', () => {
  it('o repositório clicado vira filtro, empilhando o endereço; clicar de novo tira', async () => {
    const t = montar();
    await assentar();
    const entradas = window.history.length;
    await clicar('Filtrar pelo repositório dono/repo');
    expect(window.location.search).toBe('?repo=dono%2Frepo');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?repo=dono%2Frepo');
    await assentar();
    const botao = screen.getByRole('button', { name: 'Tirar o filtro do repositório dono/repo' });
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Repositório') as HTMLSelectElement).value).toBe('dono/repo');
    await clicar('Tirar o filtro do repositório dono/repo');
    expect(window.location.search).toBe('');
  });

  it('o dia clicado recorta tudo àquele dia e o gráfico continua mostrando o período', async () => {
    const t = montar({
      responder: (caminho) => {
        const params = new URLSearchParams(caminho.split('?')[1] ?? '');
        const start = params.get('start') ?? '2026-10-18';
        return corpo(relatorioDoMotor({ range: { start, end: params.get('end') ?? '2026-11-16' }, ...(start === '2026-11-15' ? { totals: somaDoMotor({ attempts: 3, costUsd: 9.1 }) } : {}) }));
      },
    });
    await assentar();
    await clicar('Filtrar pelo dia 15/11/2026: US$ 9,10');
    expect(window.location.search).toBe('?dia=2026-11-15');
    // dois pedidos: o do dia, para a tela, e o do período, para o gráfico
    expect(t.pedidos().slice(1)).toEqual(['/api/usage?start=2026-11-15&end=2026-11-15', '/api/usage']);
    await assentar();
    expect(numeros()[0]).toContain('US$ 9,10');
    const barras = within(screen.getByRole('group', { name: 'Custo por dia: cada dia filtra a tela' })).getAllByRole('button');
    expect(barras).toHaveLength(30);
    expect(screen.getByRole('button', { name: 'Tirar o filtro do dia 15/11/2026: US$ 9,10' }).getAttribute('aria-pressed')).toBe('true');
    // o período do topo segue o do gráfico
    expect(periodo('30 dias').getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Filtros ativos' })).getAllByRole('button')[0]?.getAttribute('aria-label')).toBe('Tirar o filtro Dia: 15/11/2026');
    await clicar('Tirar o filtro do dia 15/11/2026: US$ 9,10');
    expect(window.location.search).toBe('');
  });
});

describe('Consumo: o primeiro clique num dia', () => {
  // O período de 7 dias no endereço: com o dia clicado, o pedido do período inteiro é o mesmo
  // caminho do relatório que já está na tela. Da segunda vez em diante, quem responde é `doPeriodo`.
  const SETE = '/api/usage?start=2026-11-10&end=2026-11-16';
  function comPeriodoPendente(doPeriodo: () => Resposta | Promise<Resposta>) {
    let vezes = 0;
    return montar({
      url: '/consumo?inicio=2026-11-10&fim=2026-11-16',
      responder: (caminho) => {
        if (caminho.includes('formato=csv')) return arquivo('a\n');
        if (caminho === SETE && ++vezes > 1) return doPeriodo();
        const params = new URLSearchParams(caminho.split('?')[1] ?? '');
        return corpo(relatorioDoMotor({ range: { start: params.get('start') ?? '', end: params.get('end') ?? '' } }));
      },
    });
  }
  const pilulas = () => within(screen.getByRole('group', { name: 'Filtros ativos' })).getAllByRole('button', { name: /^Tirar o filtro/ }).map((b) => b.getAttribute('aria-label'));

  it('enquanto o período não chega, o gráfico fica, o foco fica no botão clicado e a tela espera', async () => {
    let soltar: (r: Resposta) => void = () => {};
    comPeriodoPendente(() => new Promise<Resposta>((r) => { soltar = r; }));
    await assentar();
    const botao = screen.getByRole('button', { name: 'Filtrar pelo dia 15/11/2026: US$ 9,10' });
    botao.focus();
    await act(async () => { fireEvent.click(botao); });
    await assentar();
    expect(window.location.search).toBe('?inicio=2026-11-10&fim=2026-11-16&dia=2026-11-15');
    // o mesmo botão, montado e com o foco
    expect(botao.isConnected).toBe(true);
    expect(document.activeElement).toBe(botao);
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Custo por dia: cada dia filtra a tela' })).getAllByRole('button')).toHaveLength(7);
    // os períodos prontos seguem valendo, o pronto continua marcado, e não aparece pílula de período
    expect((periodo('30 dias') as HTMLButtonElement).disabled).toBe(false);
    expect(periodo('7 dias').getAttribute('aria-pressed')).toBe('true');
    expect(pilulas()).toEqual(['Tirar o filtro Dia: 15/11/2026']);
    // o pedido do período ainda corre: a tela espera, e o CSV também
    expect(screen.getByRole('progressbar', { name: 'Carregando o consumo do novo pedido' })).toBeTruthy();
    expect(anuncio()).toBe('');
    expect((screen.getByRole('button', { name: 'Baixar CSV deste recorte' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { soltar(corpo(relatorioDoMotor({ range: { start: '2026-11-10', end: '2026-11-16' } }))); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.activeElement).toBe(botao);
    expect((screen.getByRole('button', { name: 'Baixar CSV deste recorte' }) as HTMLButtonElement).disabled).toBe(false);
    // o anúncio é o do dia, que é o recorte da tela
    expect(anuncio()).toMatch(/^Período de 15\/11\/2026 \(1 dia\)/);
  });

  it('a falha do pedido do período aparece com o motivo, e Tentar de novo pede outra vez', async () => {
    const t = comPeriodoPendente(() => REDE);
    await assentar();
    await clicar('Filtrar pelo dia 15/11/2026: US$ 9,10');
    await assentar();
    expect(screen.getByRole('alert').textContent).toBe('Gráfico do período: Não deu para falar com o motor (falha de rede).Tentar de novo');
    // sem o período do motor, nada de pílula de período falsa, e os períodos prontos seguem valendo
    expect(pilulas()).toEqual(['Tirar o filtro Dia: 15/11/2026']);
    expect((periodo('30 dias') as HTMLButtonElement).disabled).toBe(false);
    const antes = t.pedidos().length;
    await clicar('Tentar de novo');
    expect(t.pedidos().length).toBeGreaterThan(antes);
  });

  it('o período que o motor não entrega diz a frase dele', async () => {
    comPeriodoPendente(() => corpo({ ok: false, motivo: 'Período longo demais.' }));
    await assentar();
    await clicar('Filtrar pelo dia 15/11/2026: US$ 9,10');
    await assentar();
    expect(screen.getByRole('alert').textContent).toBe('Gráfico do período: o motor não entrega o período inteiro. O que ele disse: Período longo demais.Tentar de novo');
  });
});

describe('Consumo: trocar o período tira o dia clicado', () => {
  const seguindo: Responder = (caminho) => {
    const params = new URLSearchParams(caminho.split('?')[1] ?? '');
    return corpo(relatorioDoMotor({ range: { start: params.get('start') ?? '2026-10-18', end: params.get('end') ?? '2026-11-16' } }));
  };

  it('pelos botões de período', async () => {
    montar({ url: '/consumo?dia=2026-11-15&tipo=review', responder: seguindo });
    await assentar();
    await clicar('7 dias');
    expect(window.location.search).toBe('?inicio=2026-11-10&fim=2026-11-16&tipo=review');
  });

  it('pelo campo De', async () => {
    montar({ url: '/consumo?dia=2026-11-15', responder: seguindo });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-11-01' } }); });
    expect(window.location.search).toBe('?inicio=2026-11-01');
  });

  it('pelo campo Até', async () => {
    montar({ url: '/consumo?dia=2026-11-15', responder: seguindo });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-11-15' } }); });
    expect(window.location.search).toBe('?fim=2026-11-15');
  });
});

describe('Consumo: as pílulas e os filtros no endereço', () => {
  it('o endereço vira o pedido, com autor e perfil, e os campos mostram o que o endereço diz', async () => {
    const t = montar({ url: '/consumo?repo=dono%2Frepo&autor=ana&perfil=perfil-a&modelo=Sonnet+5&q=repo%2312' });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?model=Sonnet+5&repo=dono%2Frepo&author=ana&profile=perfil-a&search=repo%2312']);
    expect((screen.getByLabelText('Autor do PR') as HTMLSelectElement).value).toBe('ana');
    expect((screen.getByLabelText('Perfil do Claude') as HTMLSelectElement).value).toBe('perfil-a');
    expect((screen.getByLabelText('Buscar sessão') as HTMLInputElement).value).toBe('repo#12');
    // o perfil aparece com o nome que a configuração dá
    expect([...(screen.getByLabelText('Perfil do Claude') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Todos', 'Assinatura A', 'Assinatura B']);
    const grupo = screen.getByRole('group', { name: 'Filtros ativos' });
    expect(within(grupo).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Tirar o filtro Repositório: dono/repo', 'Tirar o filtro Autor: ana', 'Tirar o filtro Modelo: Sonnet 5', 'Tirar o filtro Perfil: Assinatura A', 'Tirar o filtro Busca: repo#12', 'Limpar filtros',
    ]);
  });

  it('a pílula tira só aquele filtro, empilhando o endereço, e o foco vai ao título', async () => {
    const t = montar({ url: '/consumo?autor=ana&repo=dono%2Frepo' });
    await assentar();
    const entradas = window.history.length;
    await clicar('Tirar o filtro Autor: ana');
    expect(window.location.search).toBe('?repo=dono%2Frepo');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?repo=dono%2Frepo');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    await clicar('Limpar filtros');
    expect(screen.queryByRole('group', { name: 'Filtros ativos' })).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('escolher um filtro empilha o endereço, volta à primeira página e aborta o pedido anterior', async () => {
    const t = montar({ url: '/consumo?pagina=1' });
    await assentar();
    const entradas = window.history.length;
    await act(async () => { fireEvent.change(screen.getByLabelText('Autor do PR'), { target: { value: 'bia' } }); });
    expect(window.location.search).toBe('?autor=bia');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?author=bia');
    await act(async () => { fireEvent.change(screen.getByLabelText('Perfil do Claude'), { target: { value: 'perfil-b' } }); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?author=bia&profile=perfil-b');
    expect(t.sinais.at(-2)?.aborted).toBe(true);
    expect(t.sinais.at(-1)?.aborted).toBe(false);
  });

  it('valor do endereço que o motor não listou continua escolhido, dizendo de onde veio, e vai ao motor como veio', async () => {
    const t = montar({ url: '/consumo?autor=Ana' });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?author=Ana']);
    const autor = screen.getByLabelText('Autor do PR') as HTMLSelectElement;
    expect(autor.value).toBe('Ana');
    expect(autor.selectedOptions[0]?.textContent).toBe('Ana (valor do endereço)');
  });

  it('o tipo de um endereço antigo continua valendo e vira pílula', async () => {
    const t = montar({ url: '/consumo?tipo=review' });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?kind=review']);
    expect(screen.getByRole('button', { name: 'Tirar o filtro Tipo: Revisão' })).toBeTruthy();
  });

  // o motor de mentira que segue o período pedido: sem datas, os 30 dias até `hoje`
  const seguindo = (hoje: string): Responder => (caminho) => {
    const params = new URLSearchParams(caminho.split('?')[1] ?? '');
    return corpo(relatorioDoMotor({ range: { start: params.get('start') ?? '2026-10-18', end: params.get('end') ?? hoje } }));
  };
  const dica = () => screen.getByRole('note', { name: 'Como o período é lido', hidden: true }).textContent;

  it('os períodos prontos saem do último dia que o motor disse, gravam as duas datas e ficam marcados', async () => {
    const t = montar({ responder: seguindo('2026-11-16') });
    // antes da primeira resposta não há dia do motor: os botões esperam
    expect((periodo('7 dias') as HTMLButtonElement).disabled).toBe(true);
    await assentar();
    expect(within(screen.getByRole('group', { name: 'Período' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hoje', '7 dias', '30 dias', '90 dias']);
    expect(periodo('30 dias').getAttribute('aria-pressed')).toBe('true');
    expect(dica()).toBe('Sem datas, o motor mostra os 30 dias que terminam no hoje dele.');
    const entradas = window.history.length;
    await clicar('7 dias');
    expect(window.location.search).toBe('?inicio=2026-11-10&fim=2026-11-16');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?start=2026-11-10&end=2026-11-16');
    await assentar();
    expect(periodo('7 dias').getAttribute('aria-pressed')).toBe('true');
    expect(periodo('30 dias').getAttribute('aria-pressed')).toBe('false');
    // o período pronto não vira pílula: ele já está marcado no topo
    expect(screen.queryByRole('group', { name: 'Filtros ativos' })).toBeNull();
    await clicar('Hoje');
    expect(window.location.search).toBe('?inicio=2026-11-16&fim=2026-11-16');
  });

  it('período fora dos prontos não marca nenhum, vira pílula e abre Outro período', async () => {
    montar({ url: '/consumo?inicio=2026-11-10', responder: seguindo('2026-11-17') });
    await assentar();
    expect(anuncio()).toMatch(/^Período de 10\/11\/2026 a 17\/11\/2026 \(8 dias\)/);
    expect(within(screen.getByRole('group', { name: 'Período' })).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'Tirar o filtro Período: de 10/11/2026 até o hoje do motor' })).toBeTruthy();
    expect((screen.getByText('Outro período').closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(dica()).toBe('Só com "De", o período vai dessa data até o hoje do motor e cresce a cada dia. Agora ele termina em 17/11/2026.');
  });

  it('ano ainda sendo digitado não vira pedido, e a data completa vai, trocando a entrada', async () => {
    const t = montar({ responder: seguindo('2026-11-16') });
    await assentar();
    const de = screen.getByLabelText('De') as HTMLInputElement;
    for (const parcial of ['0002-11-05', '0202-11-05', '1969-12-31']) {
      await act(async () => { fireEvent.change(de, { target: { value: parcial } }); });
      expect(de.getAttribute('aria-invalid')).toBe('true');
    }
    expect(t.pedidos()).toEqual(['/api/usage']);
    const entradas = window.history.length;
    await act(async () => { fireEvent.change(de, { target: { value: '2026-11-05' } }); });
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage?start=2026-11-05']);
    expect(window.history.length).toBe(entradas);
  });

  it('a busca espera a pessoa parar de digitar, troca a entrada e aborta o pedido anterior', async () => {
    vi.useFakeTimers();
    const pendentes: Array<(r: Resposta) => void> = [];
    let primeira = true;
    const t = montar({
      responder: () => {
        if (primeira) { primeira = false; return corpo(relatorioDoMotor()); }
        return new Promise<Resposta>((resolver) => { pendentes.push(resolver); });
      },
    });
    await assentar();
    const entradas = window.history.length;
    const campo = screen.getByLabelText('Buscar sessão');
    fireEvent.change(campo, { target: { value: 'a' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    fireEvent.change(campo, { target: { value: 'ab' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    expect(t.pedidos()).toEqual(['/api/usage']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage?search=ab']);
    expect(window.location.search).toBe('?q=ab');
    expect(window.history.length).toBe(entradas);
    await act(async () => { fireEvent.change(campo, { target: { value: 'abc' } }); await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS); });
    expect(t.sinais[1]?.aborted).toBe(true);
    // a resposta atrasada do pedido abortado não entra na tela
    await act(async () => { pendentes[0]?.(corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 99, costUsd: 99 }) }))); await Promise.resolve(); });
    expect(anuncio()).toBe('');
    await act(async () => { pendentes[1]?.(corpo(relatorioDoMotor())); await Promise.resolve(); await Promise.resolve(); });
    expect(anuncio()).toMatch(/5 execuções de IA/);
  });

  it('Enter manda a busca na hora', async () => {
    vi.useFakeTimers();
    const t = montar();
    await assentar();
    const campo = screen.getByLabelText('Buscar sessão');
    fireEvent.change(campo, { target: { value: 'opus' } });
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?search=opus');
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS * 2); });
    expect(t.pedidos().filter((p) => p.includes('search=opus'))).toHaveLength(1);
  });

  it('o voltar do navegador refaz a consulta do endereço, e os campos acompanham', async () => {
    const t = montar({ url: '/consumo?q=ana' });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('Repositório'), { target: { value: 'dono/repo' } }); });
    expect(window.location.search).toBe('?repo=dono%2Frepo&q=ana');
    await act(async () => { voltarPara('/consumo?q=bia'); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?search=bia');
    expect((screen.getByLabelText('Buscar sessão') as HTMLInputElement).value).toBe('bia');
    expect((screen.getByLabelText('Repositório') as HTMLSelectElement).value).toBe('');
  });
});

describe('Consumo: cada sessão', () => {
  it('uma linha por operação: quando, PR, tipo pelo gatilho, modelo e perfil, duração, tokens, custo e desfecho', async () => {
    montar({
      responder: () => corpo(relatorioDoMotor({
        history: { total: 2, page: 0, pages: 1, rows: [operacaoDoMotor(12, { duration: 290_000, durationKnown: true }), operacaoDoMotor(7, { kind: 'pushback', gatilho: 'contestacao', profile: '', model: 'Opus 5', status: 'erro', costUsd: 0, costSource: 'desconhecido' })] },
      })),
    });
    await assentar();
    const linhas = linhasDa(SESSOES);
    expect(linhas.map((l) => l.slice(1))).toEqual([
      ['dono/repo#12 (abre em nova aba)', 'Primeira revisão', 'Sonnet 5 · Assinatura A', '4 min 50 s', '94,1 mil', 'US$ 1,50', 'Concluída'],
      ['dono/repo#7 (abre em nova aba)', 'Contestação do autor', 'Opus 5', 'sem dado', '94,1 mil', 'Desconhecido', 'Erro'],
    ]);
  });

  it('a linha abre com os tokens por tipo, as etapas, as tentativas, os arquivos e o card, e fecha', async () => {
    const etapas = [{ id: 'fontes', label: 'Fontes', ms: 42_000 }, { id: 'codigo', label: 'Código', ms: 290_000 }];
    montar({
      responder: () => corpo(relatorioDoMotor({
        history: {
          total: 1, page: 0, pages: 1,
          rows: [operacaoDoMotor(12, { etapas, card: 'PROJ-9', arquivosLidos: 18, decisaoId: 'd1' }, [{ status: 'parcial', costUsd: 0.25, costSource: 'estimado', at: Date.UTC(2026, 10, 15, 14, 0) }])],
        },
      })),
    });
    await assentar();
    const abrir = screen.getByRole('button', { name: /^Abrir a sessão de dono\/repo#12/ });
    expect(abrir.getAttribute('aria-expanded')).toBe('false');
    expect(linhasDa(SESSOES)[0]?.[0]).toContain('(última de 2 tentativas)');
    await act(async () => { fireEvent.click(abrir); });
    const fechar = screen.getByRole('button', { name: /^Fechar a sessão de dono\/repo#12/ });
    expect(fechar.getAttribute('aria-expanded')).toBe('true');
    const detalhe = document.getElementById(fechar.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(within(detalhe).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Para onde foram os tokens (última tentativa)', 'Tempo em cada etapa', 'A sessão']);
    expect(within(detalhe).getAllByRole('listitem').slice(0, 5).map((li) => li.textContent)).toEqual([
      'Cache lido90.000', 'Cache criado2.500', 'Entrada1.200', 'Saída340', 'Pensamento60',
    ]);
    expect(detalhe.textContent).toContain('Fontes42 s');
    expect(detalhe.textContent).toContain('Código4 min 50 s');
    expect(detalhe.textContent).toContain('Tentativas: 2: Parcial (a sessão morreu antes do fim), depois Concluída');
    expect(detalhe.textContent).toContain('Arquivos lidos: 18');
    expect(detalhe.textContent).toContain('Card: PROJ-9');
    expect(detalhe.textContent).toContain('Autor do PR: ana');
    // cada tentativa com o custo dela, sem soma
    expect(detalhe.textContent).toContain('US$ 0,25 (calculado pelo motor)');
    expect(within(detalhe).getByRole('link', { name: 'Ver no Histórico' }).getAttribute('href')).toBe('/historico?q=dono%2Frepo%2312');
    expect(within(detalhe).getByRole('link', { name: 'Abrir o PR' }).getAttribute('href')).toBe('https://github.com/dono/repo/pull/12');
    await act(async () => { fireEvent.click(fechar); });
    expect(document.getElementById(fechar.getAttribute('aria-controls') ?? 'x')).toBeNull();
    expect(screen.getByRole('button', { name: /^Abrir a sessão de dono\/repo#12/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('a sessão sem decisão diz o que falta, sem inventar', async () => {
    montar();
    await assentar();
    await clicar(/^Abrir a sessão de dono\/repo#7/);
    const detalhe = screen.getByRole('heading', { name: 'Tempo em cada etapa' }).closest('td') as HTMLElement;
    expect(detalhe.textContent).toContain('Sem etapas: a rodada ainda não decidiu, ou a sessão não é de revisão.');
    expect(detalhe.textContent).toContain('Arquivos lidos: o motor não informou');
    expect(detalhe.textContent).toContain('Card: nenhum card lido');
  });

  it('a paginação manda a página ao endereço e ao motor (que conta a partir de zero), e o foco vai ao título da tabela', async () => {
    const t = montar({ responder: (caminho) => corpo(relatorioDoMotor({ history: { total: 20, page: caminho.includes('page=1') ? 1 : 0, pages: 3, rows: [operacaoDoMotor(1)] } })) });
    await assentar();
    const nav = () => screen.getByRole('navigation', { name: 'Páginas das sessões' });
    expect(nav().textContent).toContain('20 operações · página 1 de 3');
    expect((screen.getByRole('button', { name: 'Página anterior das sessões' }) as HTMLButtonElement).disabled).toBe(true);
    const entradas = window.history.length;
    await clicar('Próxima página das sessões');
    expect(window.location.search).toBe('?pagina=2');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?page=1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Cada sessão' }));
    await assentar();
    expect(nav().textContent).toContain('página 2 de 3');
    expect(anuncio()).toMatch(/Diário: 20 operações, página 2 de 3\.$/);
  });

  it('página além do fim: o motor devolve a última, e o endereço passa a dizer a que está na tela', async () => {
    const t = montar({ url: '/consumo?pagina=99', responder: () => corpo(relatorioDoMotor({ history: { total: 20, page: 2, pages: 3, rows: [operacaoDoMotor(1)] } })) });
    const entradas = window.history.length;
    await assentar();
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?page=98', '/api/usage?page=2']);
    expect(window.location.search).toBe('?pagina=3');
    expect(window.history.length).toBe(entradas);
  });

  it('busca sem resultado diz que nada passa por ela, sem paginação, e os números continuam', async () => {
    montar({ url: '/consumo?q=nada', responder: () => corpo(relatorioDoMotor({ history: { total: 0, page: 0, pages: 1, rows: [] } })) });
    await assentar();
    expect(screen.getByText('Nenhuma operação passa pela busca e pelos filtros escolhidos neste período.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Páginas das sessões' })).toBeNull();
    expect(numeros()[0]).toContain('US$ 12,50');
  });

  it('operação que a borda não leu é avisada, e as outras aparecem', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ history: { total: 2, page: 0, pages: 1, rows: [operacaoDoMotor(1), { at: 5 }] } })) });
    await assentar();
    expect(linhasDa(SESSOES)).toHaveLength(1);
    expect(screen.getByText(/1 operação\(ões\) desta página chegaram em formato que esta tela não lê/)).toBeTruthy();
  });
});

describe('Consumo: Baixar CSV', () => {
  it('pede o mesmo recorte em formato=csv, pelo cliente, e entrega o arquivo com o nome do motor', async () => {
    const criar = vi.fn(() => 'blob:x');
    const soltar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: soltar });
    const cliques: string[] = [];
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function registrar(this: HTMLAnchorElement) { cliques.push(this.download); });
    const t = montar({
      url: '/consumo?dia=2026-11-15&autor=ana&q=repo&pagina=2',
      responder: (caminho) => (caminho.includes('formato=csv') ? arquivo('Quando,Tipo\n', 'farol-consumo-2026-11-16.csv') : corpo(relatorioDoMotor({ history: { total: 9, page: 1, pages: 2, rows: [operacaoDoMotor(1)] } }))),
    });
    await assentar();
    await clicar('Baixar CSV deste recorte');
    await assentar();
    const pedido = t.get.mock.calls.find(([c]) => c.includes('formato=csv'));
    expect(pedido?.[0]).toBe('/api/usage?formato=csv&start=2026-11-15&end=2026-11-15&author=ana&search=repo');
    expect(pedido?.[2]).toMatchObject({ texto: true, cabecalhos: ['content-type', 'content-disposition'] });
    expect(criar).toHaveBeenCalledTimes(1);
    expect(cliques).toEqual(['farol-consumo-2026-11-16.csv']);
    clique.mockRestore();
  });

  it('sem o Content-Disposition (o motor em outra origem não o expõe), o nome é o da reserva da tela', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const cliques: string[] = [];
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function registrar(this: HTMLAnchorElement) { cliques.push(this.download); });
    montar({ responder: (caminho) => (caminho.includes('formato=csv') ? arquivo('Quando,Tipo\n') : corpo(relatorioDoMotor())) });
    await assentar();
    await clicar('Baixar CSV deste recorte');
    await assentar();
    expect(cliques).toHaveLength(1);
    expect(cliques[0]).toMatch(/^farol-consumo-\d{4}-\d{2}-\d{2}\.csv$/);
    clique.mockRestore();
  });

  it('a recusa do motor em JSON não vira arquivo: a tela diz a frase dele', async () => {
    const criar = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() });
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    montar({ responder: (caminho) => (caminho.includes('formato=csv') ? arquivo(JSON.stringify({ ok: false, motivo: 'Período inválido.' }), null, 'application/json; charset=utf-8') : corpo(relatorioDoMotor())) });
    await assentar();
    await clicar('Baixar CSV deste recorte');
    await assentar();
    expect(screen.getByRole('alert').textContent).toBe('Erro: o motor não entregou o arquivo. O que ele disse: Período inválido.');
    expect(criar).not.toHaveBeenCalled();
    expect(clique).not.toHaveBeenCalled();
    clique.mockRestore();
  });

  it('enquanto um pedido novo carrega, Baixar CSV espera', async () => {
    const pendentes: Array<(r: Resposta) => void> = [];
    let primeira = true;
    montar({
      responder: () => {
        if (primeira) { primeira = false; return corpo(relatorioDoMotor()); }
        return new Promise<Resposta>((resolver) => { pendentes.push(resolver); });
      },
    });
    await assentar();
    const baixar = () => screen.getByRole('button', { name: 'Baixar CSV deste recorte' }) as HTMLButtonElement;
    expect(baixar().disabled).toBe(false);
    await clicar('7 dias');
    expect(baixar().disabled).toBe(true);
    await act(async () => { pendentes[0]?.(corpo(relatorioDoMotor())); await Promise.resolve(); await Promise.resolve(); });
    expect(baixar().disabled).toBe(false);
  });

  it('falha ao baixar diz o erro, sem sair da tela', async () => {
    montar({ responder: (caminho) => (caminho.includes('formato=csv') ? REDE : corpo(relatorioDoMotor())) });
    await assentar();
    await clicar('Baixar CSV deste recorte');
    await assentar();
    expect(screen.getByRole('alert').textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).');
    expect(numeros()[0]).toContain('US$ 12,50');
  });
});

describe('Consumo: estados', () => {
  it('carregando: a página sem nada mostra o esqueleto, e o que vem do snapshot não espera', async () => {
    montar({ responder: () => new Promise<Resposta>(() => {}) });
    expect(screen.getByText('Carregando o consumo.').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('list', { name: 'Números do período' })).toBeNull();
    expect(resumoDa('Auditoria do registro')).toBe('Auditoria do registroUS$ 900,00 em 42 sessões');
    expect(screen.getByRole('heading', { name: 'Plano de cada perfil do Claude' })).toBeTruthy();
  });

  it('trocar o período: barra no topo, o relatório anterior fica apagado e ocupado', async () => {
    const pendentes: Array<(r: Resposta) => void> = [];
    let primeira = true;
    montar({
      responder: () => {
        if (primeira) { primeira = false; return corpo(relatorioDoMotor()); }
        return new Promise<Resposta>((resolver) => { pendentes.push(resolver); });
      },
    });
    await assentar();
    await clicar('7 dias');
    expect(screen.getByRole('progressbar', { name: 'Carregando o consumo do novo pedido' })).toBeTruthy();
    const ocupado = screen.getByRole('list', { name: 'Números do período' }).closest('[aria-busy]');
    expect(ocupado?.getAttribute('aria-busy')).toBe('true');
    expect(ocupado?.className).toContain('apagada');
    await act(async () => { pendentes[0]?.(corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 4, costUsd: 10 }) }))); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(numeros()[0]).toContain('US$ 10,00');
  });

  it('sem consumo no período: diz isso, e com filtro a frase muda', async () => {
    const vazio = () => corpo(relatorioDoMotor({ totals: somaDoMotor(), series: [], models: [], repos: [], porGatilho: [], history: { total: 0, page: 0, pages: 1, rows: [] } }));
    montar({ responder: vazio });
    await assentar();
    expect(anuncio()).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): nenhuma execução de IA.');
    expect(screen.getByText('Nenhuma execução de IA neste período.')).toBeTruthy();
    expect(screen.getByText('Nenhuma operação neste período.')).toBeTruthy();
    expect(() => linha('Detalhes do período')).toThrow();
    cleanup();
    montar({ url: '/consumo?perfil=perfil-b', responder: vazio });
    await assentar();
    expect(screen.getByText('Nenhuma execução de IA neste período com os filtros escolhidos.')).toBeTruthy();
  });

  it('falha de rede: diz o erro, e Tentar de novo pede outra vez', async () => {
    let falhar = true;
    const t = montar({ responder: () => (falhar ? REDE : corpo(relatorioDoMotor())) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    expect(screen.queryByText('Carregando o consumo.')).toBeNull();
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('período que o motor não aceita: a frase dele, e Voltar ao período padrão tira as datas e o dia', async () => {
    const t = montar({
      url: '/consumo?inicio=2026-11-20&fim=2026-11-10&repo=dono%2Frepo',
      responder: (caminho) => (caminho.includes('start=') ? corpo({ ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }) : corpo(relatorioDoMotor())),
    });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O que ele disse: Selecione um intervalo válido, sem datas futuras.');
    await clicar('Voltar ao período padrão');
    expect(window.location.search).toBe('?repo=dono%2Frepo');
    await assentar();
    expect(t.pedidos().at(-1)).toBe('/api/usage?repo=dono%2Frepo');
  });

  it('recusa que nomeia o campo diz qual, e oferece limpar em vez de tentar de novo', async () => {
    const recusa: Falha = { ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'start' } };
    const t = montar({ url: '/consumo?inicio=x', responder: (caminho) => (caminho.includes('start=') ? recusa : corpo(relatorioDoMotor())) });
    await assentar();
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('Erro: O motor recusou o início do período (campo "start").');
    await act(async () => { fireEvent.click(within(alerta).getByRole('button', { name: 'Limpar período e filtros' })); });
    await assentar();
    expect(t.pedidos().at(-1)).toBe('/api/usage');
  });

  it('resposta fora do formato vira erro, não tela vazia', async () => {
    montar({ responder: () => corpo({ ok: true, totals: {} }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: O motor respondeu fora do formato esperado.');
  });

  it('linha do relatório que a borda não leu é avisada', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ porGatilho: [{ costUsd: 2 }], models: [null] })) });
    await assentar();
    expect(screen.getByText(/2 linha\(s\) deste relatório chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('sessão nova no snapshot vira aviso com Atualizar, e o relatório não se refaz sozinho', async () => {
    const t = montar();
    await assentar();
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor({ totals: { sessions: 43 } })) }); });
    expect(t.pedidos()).toHaveLength(1);
    expect(screen.getByText(/^O motor registrou sessão nova desde a última carga deste relatório\./)).toBeTruthy();
    await clicar('Atualizar');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage']);
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
  });

  it('relatório que chega antes do snapshot não vira aviso de sessão nova', async () => {
    const t = montar({ snapshot: null });
    await assentar();
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor()) }); });
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
  });

  it('os avisos do motor aparecem no anúncio discreto, sem botão de dispensar', async () => {
    const t = montar();
    await assentar();
    act(() => { t.store.trocar({ recados: [{ n: 1, tom: 'erro', texto: 'Buscas pausadas pelo limite do GitHub.' }] as unknown as EstadoDoApp['recados'] }); });
    const regiao = screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
    expect(regiao.textContent).toContain('Buscas pausadas pelo limite do GitHub.');
    expect(screen.queryByRole('button', { name: 'Dispensar', hidden: true })).toBeNull();
  });

  it('o detalhe do período traz as somas e os avisos menores do motor', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 5, costUsd: 12.5, estimatedUsd: 0.5, unknownCost: 1, subscription: 5 }) })) });
    await assentar();
    expect(resumoDa('Detalhes do período')).toBe('Detalhes do período3 revisões concluídas · 2 avisos');
    expect(linha('Detalhes do período').textContent).toContain('Por assinatura: 5 execuções.');
    expect(numeros()[0]).toBe('Custo estimadoUS$ 12,50O valor que cada sessão informa, não cobrança, US$ 0,50 calculados pelo motor; 1 de custo desconhecido fora da soma.');
  });
});

describe('Consumo: a auditoria e as sessões recentes, do snapshot', () => {
  it('a auditoria diz em texto o total do registro e muda com o snapshot, sem pedir nada ao motor', async () => {
    const t = montar();
    await assentar();
    expect(within(linha('Auditoria do registro')).getByText('Registro inteiro de sessões: US$ 900,00 estimados em 42 sessões.')).toBeTruthy();
    const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor({ auditoria: { total: parte(43, 910), perdido: parte(0, 0), estimado: parte(0, 0), desconhecido: parte(2, 0) } })) }); });
    expect(within(linha('Auditoria do registro')).getByText('Registro inteiro de sessões: US$ 910,00 estimados em 43 sessões.')).toBeTruthy();
    expect(t.pedidos()).toHaveLength(1);
  });

  it('as sessões recentes mostram as primeiras e deixam abrir as que o motor mandou', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => sessaoDoMotor(i + 1));
    montar({ snapshot: snapshotCom(consumoDoMotor({ recentSessions: muitas })) });
    await assentar();
    expect(linhasDa('Tabela das sessões recentes')).toHaveLength(SESSOES_A_VISTA);
    await clicar('Mostrar as 25 que o motor mandou');
    expect(linhasDa('Tabela das sessões recentes')).toHaveLength(25);
  });

  it('sem teto de gasto: a lista de um motor antigo não aparece', async () => {
    const antigo = { id: 'p1', label: 'Assinatura do time', kind: 'assinatura', budgetDaily: 0, today: 51, blocked: true, reason: 'diario' };
    montar({ snapshot: snapshotCom(consumoDoMotor({ budgets: [antigo] })) });
    await assentar();
    expect(document.body.textContent).not.toMatch(/[Tt]eto de gasto|[Pp]ausad|orçamento|Assinatura do time/);
  });
});

describe('Consumo: as revisões que não publicaram', () => {
  const TABELA = 'Tabela das revisões que não publicaram';

  it('sem ocorrência no período, a seção diz isso', async () => {
    montar();
    await assentar();
    expect(painel('Revisões que não publicaram').textContent).toContain('Nenhuma revisão terminou sem publicar no período.');
    expect(screen.queryByRole('region', { name: TABELA })).toBeNull();
  });

  it('motor anterior ao registro (sem o campo): a seção não aparece, em vez de afirmar que não houve', async () => {
    const { ocorrencias: _semCampo, ...antigo } = relatorioDoMotor();
    montar({ responder: () => corpo(antigo) });
    await assentar();
    expect(screen.queryByRole('heading', { name: 'Revisões que não publicaram' })).toBeNull();
  });

  it('cada ocorrência numa linha: a hora de Brasília, o PR com link, a frase do motor, a origem e a sessão', async () => {
    const ocorrencias = [
      { at: Date.UTC(2026, 10, 16, 16, 19), ref: 'dono/repo#64', tipo: 'nao_iniciada', motivo: 'pr_mergeado', texto: 'A revisão não chegou a abrir a sessão do Claude: o PR já tinha sido mergeado.', origem: 'clique', sessao: 'a-9' },
      { at: Date.UTC(2026, 10, 16, 16, 11), ref: 'dono/repo#64', tipo: 'interrompida', motivo: 'sessao_caiu', texto: 'A revisão caiu e vai ser tentada de novo: um problema passageiro interrompeu a revisão.', origem: 'inventada', classe: 'rede' },
    ];
    montar({ responder: () => corpo(relatorioDoMotor({ ocorrencias })) });
    await assentar();
    expect(linhasDa(TABELA)).toEqual([
      ['16/11/2026, 13:19', 'dono/repo#64 (abre em nova aba)', ocorrencias[0]?.texto, 'Clique seu', 'a-9'],
      ['16/11/2026, 13:11', 'dono/repo#64 (abre em nova aba)', ocorrencias[1]?.texto, 'Sem registro', 'Sem sessão'],
    ]);
    const link = within(tabela(TABELA)).getAllByRole('link', { hidden: true })[0] as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/dono/repo/pull/64');
  });
});
