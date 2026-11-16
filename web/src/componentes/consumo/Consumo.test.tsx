// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lerConsumoDoSnapshot } from '@/contratos/consumo';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { Resultado } from '@/transporte/cliente';
import { voltarPara } from '../historico/apoio-de-teste';
import { Consumo } from './Consumo';
import { PERIODOS } from '@/consumo/consulta';
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
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };

// o snapshot como a borda o entrega ao store
function snapshotCom(usage: unknown): Snapshot {
  const lido = lerConsumoDoSnapshot(usage, () => {});
  return lido === undefined ? {} : { usage: lido };
}

function montar({ url = '/consumo', responder = () => corpo(relatorioDoMotor()), snapshot = snapshotCom(consumoDoMotor()) }: { url?: string; responder?: Responder; snapshot?: Snapshot | null } = {}) {
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
  const post = vi.fn();
  const app = { store, cliente: { get, post }, dispensarRecados: () => store.trocar({ recados: [] }) } as unknown as App;
  const tela = render(<Consumo app={app} />);
  const pedidos = (): string[] => get.mock.calls.map(([caminho]) => caminho);
  return { store, get, post, sinais, pedidos, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const clicar = async (nome: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };
const anuncio = () => screen.getByRole('status', { name: 'Resultado da consulta' }).textContent;
const secao = (nome: string | RegExp) => screen.getByRole('region', { name: nome });
const tabela = (nome: string) => within(screen.getByRole('region', { name: nome })).getByRole('table');
const linhasDa = (nome: string): string[][] => within(tabela(nome)).getAllByRole('row').slice(1).map((linha) => [...linha.querySelectorAll('th,td')].map((celula) => celula.textContent ?? ''));
const cabecalhosDa = (nome: string): string[] => within(tabela(nome)).getAllByRole('columnheader').map((th) => th.textContent ?? '');
const pares = (): string[] => [...document.querySelectorAll('dl > div')].map((par) => `${par.querySelector('dt')?.textContent}: ${par.querySelector('dd')?.textContent}`);

beforeEach(() => { window.history.replaceState(null, '', '/consumo'); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Consumo: o período', () => {
  it('pede o relatório ao motor sem parâmetro, e anuncia o que voltou', async () => {
    const t = montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Consumo' })).toBeTruthy();
    expect(anuncio()).toBe('Carregando o consumo.');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage']);
    expect(anuncio()).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): 5 execuções de IA, custo estimado de US$ 12,50. Diário: 2 operações, página 1 de 1.');
    expect(t.post).not.toHaveBeenCalled();
  });

  it('o resumo mostra as somas do motor, com a unidade, e diz que o custo é estimado e de onde vem', async () => {
    montar();
    await assentar();
    expect(pares()).toEqual([
      'Custo estimado: US$ 12,50',
      'Execuções de IA: 5',
      'Retentativas, já contadas nas execuções: 1',
      'Revisões concluídas: 3',
      'PRs com revisão concluída: 2',
      'Entrada: 6.000 tokens',
      'Saída: 2.000 tokens',
      'Cache lido: 400.000 tokens',
      'Cache criado: 12.000 tokens',
    ]);
    const resumo = secao('Resumo do período');
    expect(within(resumo).getByText(/^De onde vem o custo: é o valor em dólar que a sessão do Claude Code informa ao terminar\. Em perfil de assinatura ninguém cobra esse valor por sessão: ele é uma estimativa/)).toBeTruthy();
    expect(within(resumo).getByText('Por assinatura: 5 execuções. O valor em dólar delas não é cobrança.')).toBeTruthy();
    // o dia do período é o de Brasília, e a tela diz
    expect(within(resumo).getByText('18/10/2026 a 16/11/2026 (30 dias), em dias de Brasília: é nesse fuso que o motor agrupa o diário.')).toBeTruthy();
  });

  it('modalidade: uma por assinatura e duas sem registro não viram "1 de 3", que faria o resto parecer cobrado', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 3, costUsd: 3, subscription: 1, unknownBilling: 2 }) })) });
    await assentar();
    const resumo = secao('Resumo do período');
    expect(within(resumo).getByText('Por assinatura: 1 execução. O valor em dólar delas não é cobrança.')).toBeTruthy();
    expect(within(resumo).getByText('Sem modalidade registrada: 2 execuções. O motor não gravou se rodaram por assinatura ou por chave de API, e a tela não supõe.')).toBeTruthy();
    expect(within(resumo).queryByText(/Por chave de API/)).toBeNull();
    expect(resumo.textContent).not.toMatch(/\d+ de \d+ execuç/);
  });

  it('modalidade: a chave de API aparece com o dólar que o motor somou, sem contagem inventada', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 4, costUsd: 9, subscription: 1, apiUsd: 7.5, apiEstimatedUsd: 0.5, apiUnknown: 1 }) })) });
    await assentar();
    const resumo = secao('Resumo do período');
    expect(within(resumo).getByText('Por chave de API: US$ 7,50, dos quais US$ 0,50 calculados pelo motor. O motor soma o valor e não diz quantas execuções foram. Mais 1 execução de custo desconhecido.')).toBeTruthy();
    expect(within(resumo).getByText('Por assinatura: 1 execução. O valor em dólar delas não é cobrança.')).toBeTruthy();
    expect(within(resumo).queryByText(/Sem modalidade registrada/)).toBeNull();
  });

  it('avisa o que o período tem de calculado, de desconhecido e de incompleto', async () => {
    montar({
      url: '/consumo?inicio=2026-09-01',
      responder: () => corpo(relatorioDoMotor({
        range: { start: '2026-09-01', end: '2026-11-16' },
        totals: somaDoMotor({ attempts: 5, costUsd: 12.5, estimatedUsd: 0.75, unknownCost: 1, subscription: 0 }),
        incomplete: true,
        unidentified: 2,
      })),
    });
    await assentar();
    const resumo = secao('Resumo do período');
    expect(within(resumo).getByText(/^US\$ 0,75 do custo deste período foi calculado pelo motor, para sessão que morreu antes de informar o valor/)).toBeTruthy();
    expect(within(resumo).getByText('1 execução tem custo desconhecido e não entra no valor em dólar.')).toBeTruthy();
    expect(within(resumo).getByText(/^O diário tem menos sessões do que o agregado do motor contou/)).toBeTruthy();
    expect(within(resumo).getByText(/^2 execuções sem identidade de operação/)).toBeTruthy();
    expect(within(resumo).getByText('O período começa antes do primeiro registro do diário (01/10/2026): não há dado dos dias anteriores.')).toBeTruthy();
    expect(within(resumo).queryByText(/Por assinatura/)).toBeNull();
  });
});

describe('Consumo: gasto por dia', () => {
  it('o gráfico é uma imagem com um nome que o resume, e uma barra por dia com custo', async () => {
    const { container } = montar();
    await assentar();
    const grafico = screen.getByRole('img');
    expect(grafico.getAttribute('aria-label')).toBe('Custo estimado por dia de Brasília, em dólar, de 18/10/2026 a 16/11/2026 (30 dias). 3 dias com execução. Maior dia: 15/11/2026, com US$ 9,10. Custo estimado do período, somado pelo motor: US$ 12,50.');
    const barras = [...container.querySelectorAll('svg rect')];
    expect(barras.map((b) => b.querySelector('title')?.textContent)).toEqual(['14/11/2026: US$ 2,00 estimados', '15/11/2026: US$ 9,10 estimados', '16/11/2026: US$ 1,40 estimados']);
    // a maior barra é a do maior dia, e nenhuma passa do topo do eixo (US$ 10,00)
    const alturas = barras.map((b) => Number(b.getAttribute('height')));
    expect(alturas[1]).toBeGreaterThan(alturas[0] as number);
    expect(alturas[0]).toBeGreaterThan(alturas[2] as number);
    const rotulos = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(rotulos).toEqual(['US$ 0,00', 'US$ 2,50', 'US$ 5,00', 'US$ 7,50', 'US$ 10,00', '18/10', '24/10', '30/10', '05/11', '11/11', '16/11']);
    // sem estilo em linha: a CSP de produção não aceita
    expect(container.querySelector('[style]')).toBeNull();
    // o gráfico rola dentro do próprio contêiner, que recebe foco e tem nome
    expect(secao('Gráfico do custo estimado por dia').getAttribute('tabindex')).toBe('0');
  });

  it('a tabela traz a mesma informação, com o dia como o motor o definiu e o fuso dito', async () => {
    montar();
    await assentar();
    expect(cabecalhosDa('Tabela do consumo por dia')).toEqual(['Dia', 'Custo estimado', 'Execuções', 'Execuções de custo desconhecido', 'Tokens de entrada', 'Tokens de saída', 'Tokens de cache lido', 'Tokens de cache criado']);
    expect(linhasDa('Tabela do consumo por dia')).toEqual([
      ['14/11/2026', 'US$ 2,00', '1', '0', '1.000', '300', '50.000', '2.000'],
      ['15/11/2026', 'US$ 9,10', '3', '0', '4.000', '1.500', '300.000', '9.000'],
      ['16/11/2026', 'US$ 1,40', '1', '0', '1.000', '200', '50.000', '1.000'],
    ]);
    expect(tabela('Tabela do consumo por dia').querySelector('caption')?.textContent).toBe('Consumo por dia de Brasília (o fuso em que o motor agrupa o diário), só os dias com execução.');
    expect(secao('Tabela do consumo por dia').getAttribute('tabindex')).toBe('0');
  });

  it('a tabela ordena os dias mesmo que o motor os mande fora de ordem, e campo ausente não vira zero', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ series: [{ name: '2026-11-16', costUsd: 1 }, { name: '2026-11-02', attempts: 2 }] })) });
    await assentar();
    expect(linhasDa('Tabela do consumo por dia')).toEqual([
      ['02/11/2026', 'sem dado', '2', 'sem dado', 'sem dado', 'sem dado', 'sem dado', 'sem dado'],
      ['16/11/2026', 'US$ 1,00', 'sem dado', 'sem dado', 'sem dado', 'sem dado', 'sem dado', 'sem dado'],
    ]);
  });

  it('período longo demais não desenha o gráfico, e a tabela continua', async () => {
    montar({ url: '/consumo?inicio=2026-01-01', responder: () => corpo(relatorioDoMotor({ range: { start: '2026-01-01', end: '2026-11-16' } })) });
    await assentar();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('O período passa de 120 dias: o gráfico não é desenhado, e a tabela traz todos os dias com execução.')).toBeTruthy();
    expect(linhasDa('Tabela do consumo por dia')).toHaveLength(3);
  });

  it('dia só com custo desconhecido fica sem barra, e o nome do gráfico não inventa maior dia', async () => {
    const { container } = montar({ responder: () => corpo(relatorioDoMotor({ series: [{ name: '2026-11-16', ...somaDoMotor({ attempts: 1, unknownCost: 1 }) }] })) });
    await assentar();
    expect(container.querySelectorAll('svg rect')).toHaveLength(0);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Custo estimado por dia de Brasília, em dólar, de 18/10/2026 a 16/11/2026 (30 dias). Nenhum dia com custo neste período.');
    expect(linhasDa('Tabela do consumo por dia')[0]?.slice(0, 4)).toEqual(['16/11/2026', 'US$ 0,00', '1', '1']);
  });
});

describe('Consumo: as quebras', () => {
  it('por tipo: a ordem é a do motor, e a participação é a fatia do custo que ele somou', async () => {
    montar();
    await assentar();
    expect(cabecalhosDa('Tabela do consumo por tipo de sessão').slice(0, 4)).toEqual(['Tipo', 'Custo estimado', 'Participação no custo', 'Execuções']);
    expect(linhasDa('Tabela do consumo por tipo de sessão')).toEqual([
      ['Revisão', 'US$ 10,00', '80%', '4', '5.000', '1.800', '390.000', '11.000'],
      ['Contestação', 'US$ 2,50', '20%', '1', '1.000', '200', '10.000', '1.000'],
      ['Chat', 'US$ 0,00', '0%', '0', '0', '0', '0', '0'],
      ['Ferramenta', 'US$ 0,00', '0%', '0', '0', '0', '0', '0'],
      ['Outro', 'US$ 0,00', '0%', '0', '0', '0', '0', '0'],
    ]);
  });

  it('por modelo: do que mais usou tokens ao que menos usou, e a tela diz que o motor não manda custo por modelo', async () => {
    montar();
    await assentar();
    expect(cabecalhosDa('Tabela do consumo por modelo')).toEqual(['Modelo', 'Execuções', 'Tokens de entrada', 'Tokens de saída', 'Participação nos tokens de entrada e saída']);
    expect(linhasDa('Tabela do consumo por modelo')).toEqual([
      ['Sonnet 5', '4', '5.000', '1.800', '85%'],
      ['Opus 5', '1', '1.000', '200', '15%'],
    ]);
    expect(screen.getByText('O motor não manda custo nem cache por modelo neste relatório. Uma execução que usou dois modelos conta nos dois.')).toBeTruthy();
  });

  it('tipo que a tela não conhece aparece cru, e sem total não há participação inventada', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ totals: { attempts: 2 }, byKind: [{ name: 'tipo_novo', costUsd: 3 }], models: [{ name: 'desconhecido', attempts: 2 }] })) });
    await assentar();
    expect(linhasDa('Tabela do consumo por tipo de sessão')[0]?.slice(0, 3)).toEqual(['tipo_novo', 'US$ 3,00', 'sem base']);
    expect(linhasDa('Tabela do consumo por modelo')).toEqual([['Modelo não informado', '2', 'sem dado', 'sem dado', 'sem base']]);
  });
});

describe('Consumo: o diário', () => {
  const NOME = 'Tabela do diário de execuções';

  it('cada linha diz quando, o tipo, o modelo, o PR, os tokens, o custo e o desfecho', async () => {
    montar();
    await assentar();
    expect(cabecalhosDa(NOME)).toEqual(['Quando', 'Tipo', 'Modelo', 'PR ou trabalho', 'Tokens de entrada', 'Tokens de saída', 'Tokens de cache lido', 'Tokens de cache criado', 'Custo estimado', 'Desfecho']);
    const [primeira, segunda] = linhasDa(NOME);
    expect(primeira?.[0]).toMatch(/^\d{2}\/11\/2026, \d{2}:\d{2}$/);
    expect(primeira?.slice(1)).toEqual(['Revisão', 'Sonnet 5', 'dono/repo#12 (abre em nova aba)', '1.200', '340', '90.000', '2.500', 'US$ 1,50', 'Concluída']);
    // custo desconhecido não mostra o zero que o motor grava
    expect(segunda?.slice(1)).toEqual(['Contestação', 'Opus 5', 'dono/repo#7 (abre em nova aba)', '1.200', '340', '90.000', '2.500', 'Desconhecido', 'Erro']);
    const link = within(tabela(NOME)).getAllByRole('link')[0] as HTMLElement;
    expect(link.getAttribute('href')).toBe('https://github.com/dono/repo/pull/12');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(secao(NOME).getAttribute('tabindex')).toBe('0');
  });

  it('a operação com retomada mostra cada tentativa na sua linha, a mais nova primeiro, sem somar', async () => {
    const operacao = operacaoDoMotor(13, { at: Date.UTC(2026, 10, 15, 15), costUsd: 2 }, [{ at: Date.UTC(2026, 10, 15, 14), status: 'parcial', costUsd: 0.25, costSource: 'estimado', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }]);
    montar({ responder: () => corpo(relatorioDoMotor({ history: { total: 1, page: 0, pages: 1, rows: [operacao] } })) });
    await assentar();
    const linhas = linhasDa(NOME);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.[0]).toMatch(/\(tentativa 2 de 2 da mesma operação\)$/);
    expect(linhas[0]?.slice(8)).toEqual(['US$ 2,00', 'Concluída']);
    expect(linhas[1]?.[0]).toMatch(/\(tentativa 1 de 2 da mesma operação\)$/);
    expect(linhas[1]?.slice(4)).toEqual(['10', '5', '0', '0', 'US$ 0,25 (calculado pelo motor)', 'Parcial (a sessão morreu antes do fim)']);
  });

  it('tentativa de fora do período fica marcada em texto, e a tela diz por que as linhas não fecham com o total', async () => {
    // o relatório é só do dia 15; a operação tem uma tentativa do dia 14, que as somas não contam
    const operacao = operacaoDoMotor(13, { at: Date.UTC(2026, 10, 15, 15), day: '2026-11-15' }, [{ at: Date.UTC(2026, 10, 14, 15), day: '2026-11-14', status: 'parcial' }]);
    const sozinha = operacaoDoMotor(14, { day: '2026-11-16' });
    montar({
      url: '/consumo?inicio=2026-11-15&fim=2026-11-15',
      responder: () => corpo(relatorioDoMotor({ range: { start: '2026-11-15', end: '2026-11-15' }, history: { total: 2, page: 0, pages: 1, rows: [operacao, sozinha] } })),
    });
    await assentar();
    const quando = linhasDa(NOME).map((linha) => linha[0]?.replace(/^[^(]*/, ''));
    expect(quando).toEqual(['(tentativa 2 de 2 da mesma operação)', '(tentativa 1 de 2 da mesma operação, fora do período)', '(fora do período)']);
    expect(screen.getByText('As linhas não fecham com o total do período: cada operação traz todas as tentativas dela, inclusive as de fora do período ou do filtro, que as somas não contam. As de fora do período estão marcadas na coluna Quando; as de fora do filtro o motor não marca.')).toBeTruthy();
    expect(tabela(NOME).querySelector('caption')?.textContent).toBe('Operações com execução no período, a mais recente primeiro, 8 por página. A hora é a do fim de cada execução, no fuso deste navegador.');
  });

  it('tentativa sem o dia não é marcada: a tela não supõe', async () => {
    const operacao = operacaoDoMotor(13, { day: undefined }, [{ day: 'ontem' }]);
    montar({ responder: () => corpo(relatorioDoMotor({ history: { total: 1, page: 0, pages: 1, rows: [operacao] } })) });
    await assentar();
    expect(linhasDa(NOME).map((linha) => linha[0]?.replace(/^[^(]*/, ''))).toEqual(['(tentativa 2 de 2 da mesma operação)', '(tentativa 1 de 2 da mesma operação)']);
  });

  it('texto de fora é texto, e a referência só vira link quando é chave de PR', async () => {
    const marcado = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = montar({
      responder: () => corpo(relatorioDoMotor({
        history: { total: 3, page: 0, pages: 1, rows: [
          operacaoDoMotor(1, { ref: marcado, pr: '', model: marcado, kind: 'chat', status: marcado }),
          operacaoDoMotor(2, { ref: 'javascript:alert(1)', pr: 'https://evil.example/a/b#1' }),
          { key: 'so-a-chave' },
        ] },
      })),
    });
    await assentar();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(within(tabela(NOME)).queryByRole('link')).toBeNull();
    expect(within(tabela(NOME)).getAllByText(marcado)).toHaveLength(3);
    // a operação só com a chave aparece com o que há
    expect(linhasDa(NOME)[2]).toEqual(['Sem data registrada', 'Tipo não informado', 'Modelo não informado', 'Sem referência', 'sem dado', 'sem dado', 'sem dado', 'sem dado', 'sem dado', 'Não informado']);
  });

  it('operação que a borda não leu é avisada, e as outras aparecem', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ history: { total: 2, page: 0, pages: 1, rows: [operacaoDoMotor(1), { at: 5 }] } })) });
    await assentar();
    expect(linhasDa(NOME)).toHaveLength(1);
    expect(screen.getByText(/1 operação\(ões\) desta página chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('a paginação manda a página ao endereço e ao motor (que conta a partir de zero), e o foco vai ao título', async () => {
    const t = montar({ responder: (caminho) => corpo(relatorioDoMotor({ history: { total: 20, page: caminho.includes('page=1') ? 1 : 0, pages: 3, rows: [operacaoDoMotor(1)] } })) });
    await assentar();
    const navegacao = screen.getByRole('navigation', { name: 'Páginas do diário' });
    expect(navegacao.textContent).toContain('Página 1 de 3 · 20 operações');
    expect((screen.getByRole('button', { name: 'Página anterior do diário' }) as HTMLButtonElement).disabled).toBe(true);
    const entradas = window.history.length;
    await clicar('Próxima página do diário');
    expect(window.location.search).toBe('?pagina=2');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?page=1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Diário de execuções' }));
    await assentar();
    expect(screen.getByRole('navigation', { name: 'Páginas do diário' }).textContent).toContain('Página 2 de 3');
    expect(anuncio()).toMatch(/Diário: 20 operações, página 2 de 3\.$/);
  });

  it('página além do fim: o motor devolve a última, e o endereço passa a dizer a que está na tela', async () => {
    const t = montar({
      url: '/consumo?pagina=99',
      responder: () => corpo(relatorioDoMotor({ history: { total: 20, page: 2, pages: 3, rows: [operacaoDoMotor(1)] } })),
    });
    const entradas = window.history.length;
    await assentar();
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?page=98', '/api/usage?page=2']);
    expect(window.location.search).toBe('?pagina=3');
    // a correção troca a entrada do endereço, não empilha outra
    expect(window.history.length).toBe(entradas);
    expect(screen.getByRole('navigation', { name: 'Páginas do diário' }).textContent).toContain('Página 3 de 3');
  });

  it('diário vazio com busca diz que nada passa por ela, e as somas continuam na tela', async () => {
    montar({ url: '/consumo?q=nada', responder: () => corpo(relatorioDoMotor({ history: { total: 0, page: 0, pages: 1, rows: [] } })) });
    await assentar();
    expect(screen.getByText('Nenhuma operação passa pela busca e pelos filtros escolhidos neste período.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Páginas do diário' })).toBeNull();
    expect(pares()[0]).toBe('Custo estimado: US$ 12,50');
  });
});

describe('Consumo: período e filtros no endereço', () => {
  it('o endereço vira o pedido, e os campos mostram o que o endereço diz', async () => {
    const t = montar({ url: '/consumo?inicio=2026-11-01&fim=2026-11-16&tipo=review&modelo=Sonnet+5&repo=dono%2Frepo&q=repo%2312&pagina=1' });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?start=2026-11-01&end=2026-11-16&kind=review&model=Sonnet+5&repo=dono%2Frepo&search=repo%2312']);
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe('2026-11-01');
    expect((screen.getByLabelText('Até') as HTMLInputElement).value).toBe('2026-11-16');
    expect((screen.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('review');
    expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('Sonnet 5');
    expect((screen.getByLabelText('Repositório') as HTMLSelectElement).value).toBe('dono/repo');
    expect((screen.getByLabelText('Buscar no diário') as HTMLInputElement).value).toBe('repo#12');
  });

  it('as opções dos filtros são as que o motor listou, com o rótulo do tipo', async () => {
    montar();
    await assentar();
    const opcoes = (nome: string) => [...(screen.getByLabelText(nome) as HTMLSelectElement).options].map((o) => `${o.value}=${o.textContent}`);
    expect(opcoes('Tipo')).toEqual(['=Todos', 'pushback=Contestação', 'review=Revisão']);
    expect(opcoes('Modelo')).toEqual(['=Todos', 'Opus 5=Opus 5', 'Sonnet 5=Sonnet 5']);
    expect(opcoes('Repositório')).toEqual(['=Todos', 'dono/outro=dono/outro', 'dono/repo=dono/repo']);
  });

  it('escolher um filtro empilha o endereço, volta à primeira página e pede de novo', async () => {
    const t = montar({ url: '/consumo?pagina=1' });
    await assentar();
    const entradas = window.history.length;
    await act(async () => { fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'pushback' } }); });
    expect(window.location.search).toBe('?tipo=pushback');
    expect(window.history.length).toBe(entradas + 1);
    expect(t.pedidos().at(-1)).toBe('/api/usage?kind=pushback');
    await act(async () => { fireEvent.change(screen.getByLabelText('Repositório'), { target: { value: 'dono/repo' } }); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?kind=pushback&repo=dono%2Frepo');
    // o pedido que o filtro trocou foi abortado
    expect(t.sinais.at(-2)?.aborted).toBe(true);
    expect(t.sinais.at(-1)?.aborted).toBe(false);
  });

  it('valor do endereço que o motor não listou continua escolhido, dizendo de onde veio, e vai ao motor como veio', async () => {
    const t = montar({ url: '/consumo?tipo=tipo_novo&inicio=ontem' });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?start=ontem&kind=tipo_novo']);
    const tipo = screen.getByLabelText('Tipo') as HTMLSelectElement;
    expect(tipo.value).toBe('tipo_novo');
    expect(tipo.selectedOptions[0]?.textContent).toBe('tipo_novo (valor do endereço)');
  });

  // o motor de mentira que segue o período pedido: sem datas, os 30 dias até `hoje`
  const seguindo = (hoje: string): Responder => (caminho) => {
    const params = new URLSearchParams(caminho.split('?')[1] ?? '');
    return corpo(relatorioDoMotor({ range: { start: params.get('start') ?? '2026-10-18', end: params.get('end') ?? hoje } }));
  };
  const marcados = () => PERIODOS.filter((dias) => screen.getByRole('button', { name: `${dias} dias` }).getAttribute('aria-pressed') === 'true');
  const dica = () => screen.getByRole('note', { name: 'Como o período é lido' }).textContent;

  it('os períodos prontos saem do último dia que o motor disse, gravam as duas datas e ficam marcados', async () => {
    const t = montar({ responder: seguindo('2026-11-16') });
    // antes da primeira resposta não há dia do motor: os botões esperam
    expect((screen.getByRole('button', { name: '7 dias' }) as HTMLButtonElement).disabled).toBe(true);
    await assentar();
    // sem datas, o padrão do motor são sempre 30 dias
    expect(marcados()).toEqual([30]);
    expect(dica()).toBe('Sem datas, o motor mostra os 30 dias que terminam no hoje dele.');
    await clicar('7 dias');
    expect(window.location.search).toBe('?inicio=2026-11-10&fim=2026-11-16');
    expect(t.pedidos().at(-1)).toBe('/api/usage?start=2026-11-10&end=2026-11-16');
    await assentar();
    expect(marcados()).toEqual([7]);
    expect(dica()).toBe('Período fixo nas duas datas: não acompanha o dia de hoje.');
    await clicar('90 dias');
    expect(window.location.search).toBe('?inicio=2026-08-19&fim=2026-11-16');
    await assentar();
    expect(marcados()).toEqual([90]);
  });

  it('endereço só com o início, aberto no dia seguinte: a tela diz os 8 dias, e nenhum atalho fica marcado', async () => {
    montar({ url: '/consumo?inicio=2026-11-10', responder: seguindo('2026-11-17') });
    await assentar();
    expect(anuncio()).toMatch(/^Período de 10\/11\/2026 a 17\/11\/2026 \(8 dias\)/);
    expect(marcados()).toEqual([]);
    expect(dica()).toBe('Só com "De", o período vai dessa data até o hoje do motor e cresce a cada dia. Agora ele termina em 17/11/2026.');
    // no mesmo dia em que foi gravado (7 dias exatos) também não marca: o fim não está fixo
    cleanup();
    montar({ url: '/consumo?inicio=2026-11-10', responder: seguindo('2026-11-16') });
    await assentar();
    expect(marcados()).toEqual([]);
  });

  it('fim do endereço diferente do fim do relatório não marca atalho', async () => {
    // o endereço pede até o dia 17, e o motor de mentira entrega até o dia 16
    montar({ url: '/consumo?inicio=2026-11-10&fim=2026-11-17', responder: () => corpo(relatorioDoMotor({ range: { start: '2026-11-10', end: '2026-11-16' } })) });
    await assentar();
    expect(anuncio()).toMatch(/^Período de 10\/11\/2026 a 16\/11\/2026 \(7 dias\)/);
    expect(marcados()).toEqual([]);
  });

  it('só "Até" preenchido: a dica avisa de onde o motor começa, e o que ele faz com data antiga', async () => {
    const t = montar({ url: '/consumo?fim=2026-01-31', responder: () => corpo({ ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }) });
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage?end=2026-01-31']);
    expect(dica()).toBe('Só com "Até", o motor começa 30 dias antes do hoje dele, não desta data. Se a data for mais antiga que isso, ele não entrega o relatório: preencha também "De".');
    expect(screen.getByRole('alert').textContent).toContain('Selecione um intervalo válido, sem datas futuras.');
  });

  it('ano ainda sendo digitado não vira pedido: o campo diz que a data é inválida, e a data completa vai', async () => {
    const t = montar({ responder: seguindo('2026-11-16') });
    await assentar();
    const de = screen.getByLabelText('De') as HTMLInputElement;
    // o que o campo de data entrega enquanto se digita "2026"
    for (const parcial of ['0002-11-05', '0020-11-05', '0202-11-05', '1969-12-31']) {
      await act(async () => { fireEvent.change(de, { target: { value: parcial } }); });
      expect(de.value).toBe(parcial);
      expect(de.getAttribute('aria-invalid')).toBe('true');
    }
    expect(t.pedidos()).toEqual(['/api/usage']);
    expect(window.location.search).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('Data inválida: use um dia de 1970 em diante. Nada foi pedido ao motor.');
    await act(async () => { fireEvent.change(de, { target: { value: '2026-11-05' } }); });
    expect(de.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage?start=2026-11-05']);
    // esvaziar o campo tira a data do endereço
    await act(async () => { fireEvent.change(de, { target: { value: '' } }); });
    expect(window.location.search).toBe('');
  });

  it('o filtro de modelo diz que recorta pelo modelo principal da execução', async () => {
    montar();
    await assentar();
    const modelo = screen.getByLabelText('Modelo');
    const idDaDica = modelo.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(idDaDica)?.textContent).toBe('Recorta pelo modelo principal de cada execução. A tabela Por modelo ainda pode trazer outros, que são partes das mesmas execuções.');
  });

  it('as datas vão ao endereço trocando a entrada, e Limpar volta ao padrão do motor', async () => {
    const t = montar();
    await assentar();
    const entradas = window.history.length;
    await act(async () => { fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-11-05' } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-11-09' } }); });
    expect(window.location.search).toBe('?inicio=2026-11-05&fim=2026-11-09');
    expect(window.history.length).toBe(entradas);
    expect(t.pedidos().at(-1)).toBe('/api/usage?start=2026-11-05&end=2026-11-09');
    await clicar('Limpar período e filtros');
    expect(window.location.search).toBe('');
    expect(t.pedidos().at(-1)).toBe('/api/usage');
    expect(screen.queryByRole('button', { name: 'Limpar período e filtros' })).toBeNull();
  });

  it('a busca espera a pessoa parar de digitar, e o pedido anterior é abortado', async () => {
    vi.useFakeTimers();
    const pendentes: Array<(r: Resposta) => void> = [];
    const t = montar({ responder: () => new Promise<Resposta>((resolver) => { pendentes.push(resolver); }) });
    const entradas = window.history.length;
    const campo = screen.getByLabelText('Buscar no diário');
    fireEvent.change(campo, { target: { value: 'a' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    fireEvent.change(campo, { target: { value: 'ab' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS - 1); });
    // nenhuma tecla virou pedido ainda: só o da carga inicial
    expect(t.pedidos()).toEqual(['/api/usage']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage?search=ab']);
    expect(window.location.search).toBe('?q=ab');
    // a busca troca a entrada do endereço, não empilha uma por tecla
    expect(window.history.length).toBe(entradas);
    expect(t.sinais[0]?.aborted).toBe(true);
    expect(t.sinais[1]?.aborted).toBe(false);
    // a resposta atrasada do pedido abortado não entra na tela
    await act(async () => { pendentes[0]?.(corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 99, costUsd: 99 }) }))); await Promise.resolve(); });
    expect(anuncio()).toBe('Carregando o consumo.');
    await act(async () => { pendentes[1]?.(corpo(relatorioDoMotor())); await Promise.resolve(); await Promise.resolve(); });
    expect(anuncio()).toMatch(/5 execuções de IA/);
  });

  it('Enter manda a busca na hora', async () => {
    vi.useFakeTimers();
    const t = montar();
    await assentar();
    fireEvent.change(screen.getByLabelText('Buscar no diário'), { target: { value: 'opus' } });
    await act(async () => { fireEvent.submit(screen.getByRole('search', { name: 'Período e filtros do consumo' })); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?search=opus');
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_DA_BUSCA_MS * 2); });
    expect(t.pedidos().filter((p) => p.includes('search=opus'))).toHaveLength(1);
  });

  it('o voltar do navegador refaz a consulta do endereço, e os campos acompanham', async () => {
    const t = montar({ url: '/consumo?q=ana' });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'review' } }); });
    expect(window.location.search).toBe('?tipo=review&q=ana');
    await act(async () => { voltarPara('/consumo?q=bia'); });
    expect(t.pedidos().at(-1)).toBe('/api/usage?search=bia');
    expect((screen.getByLabelText('Buscar no diário') as HTMLInputElement).value).toBe('bia');
    expect((screen.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('');
  });

  it('durante a carga o relatório anterior fica na tela, esmaecido e ocupado', async () => {
    const pendentes: Array<(r: Resposta) => void> = [];
    let primeira = true;
    const { container } = montar({
      responder: () => {
        if (primeira) { primeira = false; return corpo(relatorioDoMotor()); }
        return new Promise<Resposta>((resolver) => { pendentes.push(resolver); });
      },
    });
    await assentar();
    await act(async () => { fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'review' } }); });
    const relatorio = container.querySelector('[aria-busy]');
    expect(relatorio?.getAttribute('aria-busy')).toBe('true');
    expect(relatorio?.hasAttribute('data-esmaecida')).toBe(true);
    expect(pares()[0]).toBe('Custo estimado: US$ 12,50');
    expect(anuncio()).toBe('');
    await act(async () => { pendentes[0]?.(corpo(relatorioDoMotor({ totals: somaDoMotor({ attempts: 4, costUsd: 10 }) }))); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(pares()[0]).toBe('Custo estimado: US$ 10,00');
  });
});

describe('Consumo: estados', () => {
  it('sem consumo no período: diz isso, sem gráfico nem quebras, e com filtro a frase muda', async () => {
    const vazio = () => corpo(relatorioDoMotor({ totals: somaDoMotor(), series: [], models: [], history: { total: 0, page: 0, pages: 1, rows: [] } }));
    montar({ responder: vazio });
    await assentar();
    expect(anuncio()).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): nenhuma execução de IA.');
    expect(screen.getByText('Nenhuma execução de IA neste período.')).toBeTruthy();
    expect(screen.getByText('Nenhuma operação neste período.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tabela do consumo por tipo de sessão' })).toBeNull();
    expect(pares()).toEqual([]);
    cleanup();
    montar({ url: '/consumo?repo=dono%2Fvazio', responder: vazio });
    await assentar();
    expect(screen.getByText('Nenhuma execução de IA neste período com os filtros escolhidos.')).toBeTruthy();
  });

  it('falha de rede: diz o erro, e Tentar de novo pede outra vez', async () => {
    let falhar = true;
    const t = montar({ responder: () => (falhar ? REDE : corpo(relatorioDoMotor())) });
    await assentar();
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('Erro: Não deu para falar com o motor (falha de rede).');
    expect(anuncio()).toBe('');
    falhar = false;
    await clicar('Tentar de novo');
    await assentar();
    expect(t.pedidos()).toEqual(['/api/usage', '/api/usage']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(anuncio()).toMatch(/5 execuções de IA/);
  });

  it('período que o motor não aceita: a tela mostra a frase dele e oferece voltar ao período padrão', async () => {
    const t = montar({
      url: '/consumo?inicio=2026-11-20&fim=2026-11-10&tipo=review',
      responder: (caminho) => (caminho.includes('start=') ? corpo({ ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }) : corpo(relatorioDoMotor())),
    });
    await assentar();
    expect(screen.getByRole('alert').textContent).toBe('Sem relatório: o motor respondeu que não entrega o consumo deste pedido. O que ele disse: Selecione um intervalo válido, sem datas futuras.Voltar ao período padrãoTentar de novo');
    expect(pares()).toEqual([]);
    await clicar('Voltar ao período padrão');
    // o período sai, o filtro fica
    expect(window.location.search).toBe('?tipo=review');
    await assentar();
    expect(t.pedidos().at(-1)).toBe('/api/usage?kind=review');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('o motor sem o diário responde com a frase dele, e sem período no endereço só há Tentar de novo', async () => {
    montar({ responder: () => corpo({ ok: false, motivo: 'O agregado tem consumo, mas o diário detalhado não está disponível.' }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('O agregado tem consumo, mas o diário detalhado não está disponível.');
    expect(screen.queryByRole('button', { name: 'Voltar ao período padrão' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('recusa que nomeia o campo diz qual, e oferece limpar em vez de tentar de novo', async () => {
    const recusa: Falha = { ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'start' } };
    const t = montar({ url: '/consumo?inicio=x', responder: (caminho) => (caminho.includes('start=') ? recusa : corpo(relatorioDoMotor())) });
    await assentar();
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('Erro: O motor recusou o início do período (campo "start").');
    expect(within(alerta).queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    await act(async () => { fireEvent.click(within(alerta).getByRole('button', { name: 'Limpar período e filtros' })); });
    await assentar();
    expect(t.pedidos().at(-1)).toBe('/api/usage');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resposta fora do formato vira erro, não tela vazia', async () => {
    montar({ responder: () => corpo({ ok: true, totals: {} }) });
    await assentar();
    expect(screen.getByRole('alert').textContent).toContain('Erro: O motor respondeu fora do formato esperado.');
  });

  it('linha do relatório que a borda não leu é avisada', async () => {
    montar({ responder: () => corpo(relatorioDoMotor({ byKind: [{ name: 'review', costUsd: 1 }, { costUsd: 2 }], models: [null] })) });
    await assentar();
    expect(screen.getByText(/2 linha\(s\) deste relatório chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('sessão nova no snapshot vira aviso com Atualizar, e o relatório não se refaz sozinho', async () => {
    const t = montar();
    await assentar();
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor({ totals: { sessions: 43 } })) }); });
    expect(t.pedidos()).toHaveLength(1);
    // a sessão nova pode estar fora do período ou do filtro, e o aviso diz
    expect(screen.getByText(/^O motor registrou sessão nova desde a última carga deste relatório\. Ela pode não entrar neste recorte: o aviso não olha o período nem os filtros\./)).toBeTruthy();
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

  it('os avisos do motor aparecem na região de resultado, e dá para dispensar', async () => {
    const t = montar();
    await assentar();
    act(() => { t.store.trocar({ recados: [{ n: 1, tom: 'erro', texto: 'Buscas pausadas pelo limite do GitHub.' }] as unknown as EstadoDoApp['recados'] }); });
    const regiao = screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
    expect(regiao.textContent).toContain('Buscas pausadas pelo limite do GitHub.');
    await clicar('Dispensar');
    expect(regiao.textContent).toBe('');
  });
});

describe('Consumo: a auditoria do registro', () => {
  const auditoria = () => secao('Auditoria do registro');

  it('diz em texto o total do registro e o que não virou resultado, com o custo dito estimado', async () => {
    montar();
    await assentar();
    expect(within(auditoria()).getByText('Registro inteiro de sessões: US$ 900,00 estimados em 42 sessões.')).toBeTruthy();
    expect(within(auditoria()).getByText(/^Não viraram resultado .*US\$ 90,00 em 3 sessões, 10% do custo registrado\.$/)).toBeTruthy();
    expect(within(auditoria()).getByText(/^Custo calculado pelo motor.*US\$ 20,00 em 1 sessão\.$/)).toBeTruthy();
  });

  it('sem a auditoria no snapshot a seção diz que ela ainda não chegou', async () => {
    montar({ snapshot: {} });
    await assentar();
    expect(within(auditoria()).getByText('A auditoria do registro ainda não chegou do motor.')).toBeTruthy();
  });

  it('muda com o snapshot, sem pedir nada ao motor', async () => {
    const t = montar();
    await assentar();
    const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor({ auditoria: { total: parte(43, 910), perdido: parte(0, 0), estimado: parte(0, 0), desconhecido: parte(2, 0) } })) }); });
    expect(within(auditoria()).getByText('Registro inteiro de sessões: US$ 910,00 estimados em 43 sessões.')).toBeTruthy();
    expect(within(auditoria()).getByText('Custo desconhecido: 2 sessões, fora de todo valor em dólar.')).toBeTruthy();
    expect(t.pedidos()).toHaveLength(1);
  });
});

// O teto de gasto saiu em 16/11/2026: o revisor não trava por dinheiro. A tela não tem o
// bloco, não diz pausa por gasto e ignora a lista de teto que um motor antigo ainda mande.
describe('Consumo: sem teto de gasto', () => {
  it('não há bloco de teto, nem com a lista de um motor antigo dizendo que o perfil está bloqueado', async () => {
    const antigo = { id: 'p1', label: 'Assinatura do time', kind: 'assinatura', budgetDaily: 0, capHoje: 0, capOrigem: 'base', today: 51, blocked: true, reason: 'diario', tipicoReview: 4.1 };
    montar({ snapshot: snapshotCom(consumoDoMotor({ budgets: [antigo] })) });
    await assentar();
    expect(screen.queryByRole('heading', { name: 'Teto de gasto' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/[Tt]eto de gasto|[Pp]ausad|orçamento|Assinatura do time/);
  });
});

describe('Consumo: as sessões recentes', () => {
  const NOME = 'Tabela das sessões recentes';

  it('vêm do snapshot, na ordem do motor, com as mesmas colunas do diário', async () => {
    montar();
    await assentar();
    expect(screen.getByRole('heading', { level: 2, name: 'Sessões recentes (2)' })).toBeTruthy();
    const linhas = linhasDa(NOME);
    expect(linhas.map((l) => l.slice(1))).toEqual([
      ['Revisão', 'Sonnet 5', 'dono/repo#1 (abre em nova aba)', '101', '50', '1.000', '10', 'US$ 0,50', 'Concluída'],
      ['Revisão', 'Sonnet 5', 'dono/repo#2 (abre em nova aba)', '102', '50', '1.000', '10', 'US$ 0,50', 'Concluída'],
    ]);
    expect(within(tabela(NOME)).getAllByRole('link')[0]?.getAttribute('href')).toBe('https://github.com/dono/repo/pull/1');
  });

  it('mostra as primeiras e deixa abrir as que o motor mandou', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => sessaoDoMotor(i + 1));
    montar({ snapshot: snapshotCom(consumoDoMotor({ recentSessions: muitas })) });
    await assentar();
    expect(linhasDa(NOME)).toHaveLength(SESSOES_A_VISTA);
    const botao = screen.getByRole('button', { name: 'Mostrar as 25 que o motor mandou' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    await clicar('Mostrar as 25 que o motor mandou');
    expect(linhasDa(NOME)).toHaveLength(25);
    await clicar(`Mostrar só as ${SESSOES_A_VISTA} mais recentes`);
    expect(linhasDa(NOME)).toHaveLength(SESSOES_A_VISTA);
  });

  it('referência que não é PR fica como texto, e sessão sem hora é contada e avisada', async () => {
    montar({ snapshot: snapshotCom(consumoDoMotor({ recentSessions: [sessaoDoMotor(1, { kind: 'chat', ref: 'conversa <b>x</b>', costSource: 'estimado' }), { ref: 'sem hora' }] })) });
    await assentar();
    expect(linhasDa(NOME)[0]?.slice(1, 4)).toEqual(['Chat', 'Sonnet 5', 'conversa <b>x</b>']);
    expect(linhasDa(NOME)[0]?.[8]).toBe('US$ 0,50 (calculado pelo motor)');
    expect(within(tabela(NOME)).queryByRole('link')).toBeNull();
    expect(screen.getByText(/1 sessão\(ões\) chegaram em formato que esta tela não lê/)).toBeTruthy();
  });

  it('sem a lista e com a lista vazia dizem coisas diferentes', async () => {
    montar({ snapshot: {} });
    await assentar();
    expect(screen.getByText('As sessões recentes ainda não chegaram do motor.')).toBeTruthy();
    cleanup();
    montar({ snapshot: snapshotCom(consumoDoMotor({ recentSessions: [] })) });
    await assentar();
    expect(screen.getByText('Nenhuma sessão registrada ainda.')).toBeTruthy();
  });

  it('sessão nova entra na tabela pelo snapshot', async () => {
    const t = montar();
    await assentar();
    act(() => { t.store.trocar({ snapshot: snapshotCom(consumoDoMotor({ recentSessions: [sessaoDoMotor(0, { ref: 'dono/novo#9' }), sessaoDoMotor(1), sessaoDoMotor(2)] })) }); });
    expect(linhasDa(NOME)[0]?.[3]).toBe('dono/novo#9 (abre em nova aba)');
    expect(screen.getByRole('heading', { level: 2, name: 'Sessões recentes (3)' })).toBeTruthy();
  });
});
