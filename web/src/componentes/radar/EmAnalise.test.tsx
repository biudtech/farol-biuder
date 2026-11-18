// @vitest-environment jsdom
// O cartão da sessão em análise, no molde do cartão da autoanálise (18/11/2026): a borda pelo
// estado, o cabeçalho, as pílulas e a faixa com as cinco etapas. Herdeiro dos testes da linha que
// abria (feed, progresso, Cancelar): o feed saiu do Radar com o desenho novo, e o que a sessão faz
// agora vai no rodapé da faixa.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressoDaRevisao, SessaoAtiva } from '@/contratos/radar';
import { EmAnalise } from './EmAnalise';
import { URL_DO_PR, controleFalso } from './apoio-de-teste';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOME = 'a sessão de PR #12 de dono/repo';
const ETAPAS = ['fontes', 'card', 'código', 'conferência dos achados', 'postagem'];
// 16/11/2026 14:32 em UTC
const INICIO = Date.UTC(2026, 10, 16, 14, 32);

function sessao(extra: Partial<SessaoAtiva> = {}): SessaoAtiva {
  return {
    id: 'a1',
    label: 'Revisão automática de dono/repo#12',
    startedAt: INICIO,
    keys: ['dono/repo#12'],
    cancellable: true,
    pr: { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana', account: 'revisora' },
    ...extra,
  };
}

function progresso(etapa: number, extra: Partial<ProgressoDaRevisao> = {}): ProgressoDaRevisao {
  return { percentual: [5, 15, 45, 70, 95][etapa - 1] ?? 0, etapa, totalEtapas: 5, rotuloDaEtapa: ETAPAS[etapa - 1] ?? '', etapas: ETAPAS, ...extra };
}

const cartao = () => screen.getByRole('article');
const faixa = () => screen.getByRole('group', { name: 'Andamento da revisão de PR #12 de dono/repo' });
const etapas = () => within(faixa()).getAllByRole('listitem');
const estados = () => etapas().map((li) => li.getAttribute('data-estado'));
const pilulas = () => within(screen.getByRole('list', { name: 'Resumo' })).getAllByRole('listitem').map((li) => li.textContent);

function montar(s: SessaoAtiva, feeds: Record<string, { t: number; k: string; text: string }[]> = {}, outras: SessaoAtiva[] = []) {
  const { controle, disparar } = controleFalso();
  const r = render(<EmAnalise sessoes={[s, ...outras]} feeds={feeds} controle={controle} />);
  return { ...r, disparar, controle };
}

describe('seção Em análise: o cartão', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(INICIO + 18000);
  });

  it('lista vazia diz que está vazia numa linha', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Em análise' })).toBeTruthy();
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
  });

  it('cabeçalho: a chave como link, o autor, o título, o contexto e o botão Revisando ocupado', () => {
    const { container } = montar(sessao({ arquivosPr: 14, pedido: { por: 'bia', em: '2026-11-16T14:03:00Z' } }));
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    expect(screen.getByRole('link', { name: /^dono\/repo#12/ }).getAttribute('href')).toBe(URL_DO_PR);
    expect(screen.getByText('ana')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Corrige o cálculo' })).toBeTruthy();
    expect(screen.getByText(/^14 arquivos · pedido por @bia às \d\d:03$/)).toBeTruthy();
    const ocupado = screen.getByRole('button', { name: 'Revisando PR #12 de dono/repo' }) as HTMLButtonElement;
    // ocupado, mas focável: aria-disabled em vez de disabled, para o foco do clique ter onde ficar
    expect(ocupado.getAttribute('aria-disabled')).toBe('true');
    expect(ocupado.querySelector('[data-tamanho="p"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir no GitHub: dono\/repo#12/ }).getAttribute('href')).toBe(URL_DO_PR);
    // nada de estilo em linha: a CSP recusa
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('buscando o código: a primeira etapa com o spinner e aria-current, o tempo e quanto costuma levar', () => {
    montar(sessao({ progresso: progresso(1), estimativa: { tipicoMs: 300000, ateOFimMs: 420000 } }), {}, [sessao({ id: 'a2', pr: { key: 'x/y#1' } })]);
    const [fontes] = etapas();
    expect(estados()).toEqual(['agora', 'falta', 'falta', 'falta', 'falta']);
    expect(fontes?.getAttribute('aria-current')).toBe('step');
    expect(fontes?.querySelector('[class*="giro"]')).toBeTruthy();
    expect(within(faixa()).getByText('18 s')).toBeTruthy();
    expect(within(faixa()).getByText('Buscando o código do PR, com 1 outra revisão em andamento.')).toBeTruthy();
    expect(within(faixa()).getByText('costuma levar 7 min')).toBeTruthy();
    // trilho indefinido: progressbar sem valor
    const trilho = within(faixa()).getByRole('progressbar');
    expect(trilho.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('lendo o card: a primeira etapa feita com o traço verde, e a pílula do card diz que lê os critérios', () => {
    montar(sessao({ progresso: progresso(2) }));
    expect(estados()).toEqual(['feita', 'agora', 'falta', 'falta', 'falta']);
    expect(etapas()[1]?.querySelector('[data-feita="true"]')).toBeTruthy();
    expect(etapas()[2]?.querySelector('[data-feita="false"]')).toBeTruthy();
    expect(within(faixa()).getByText('Lendo o card no Jira.')).toBeTruthy();
    expect(pilulas()).toEqual(['\u2013Checks obrigatóriosLidos no fim da revisão', '\u2013CardLendo os critérios', '\u2013ParecerEm análise']);
  });

  it('lendo o código: o arquivo da vez, a contagem, quanto falta e o trilho definido pela porcentagem dos arquivos', () => {
    montar(sessao({ progresso: progresso(3, { arquivosLidos: 9, arquivosTotais: 20, arquivoAtual: 'src/survey/remanejamento.ts', restanteEstimadoMs: 240000 }) }));
    expect(estados()).toEqual(['feita', 'feita', 'agora', 'falta', 'falta']);
    expect(within(faixa()).getByText('Lendo src/survey/remanejamento.ts')).toBeTruthy();
    expect(within(faixa()).getByText('9 de 20 arquivos · faltam ~4 min')).toBeTruthy();
    const trilho = within(faixa()).getByRole('progressbar');
    expect(trilho.getAttribute('aria-valuenow')).toBe('45');
    expect(trilho.getAttribute('aria-valuetext')).toBe('45%, 9 de 20 arquivos');
    // a largura é atributo do SVG, nunca estilo em linha
    expect(trilho.querySelector('rect')?.getAttribute('width')).toBe('45');
  });

  it('lendo o código sem a contagem: trilho indefinido e o texto sem arquivo', () => {
    montar(sessao({ progresso: progresso(3) }));
    expect(within(faixa()).getByText('Lendo o código do PR.')).toBeTruthy();
    expect(within(faixa()).getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  });

  it('conferindo e postando: o texto de cada etapa, e o botão vira Postando na postagem, com a conta', () => {
    const { rerender, controle } = montar(sessao({ progresso: progresso(4) }));
    expect(within(faixa()).getByText('Conferindo no código o que a revisão afirmou.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisando PR #12 de dono/repo' })).toBeTruthy();
    rerender(<EmAnalise sessoes={[sessao({ progresso: progresso(5) })]} feeds={{}} controle={controle} />);
    expect(estados()).toEqual(['feita', 'feita', 'feita', 'feita', 'agora']);
    expect(within(faixa()).getByText('Postando a revisão no GitHub.')).toBeTruthy();
    expect(within(faixa()).getByText('pela conta @revisora')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Postando PR #12 de dono/repo' })).toBeTruthy();
  });

  it('a etapa nunca recua: um estado atrasado com a etapa anterior não faz a faixa voltar', () => {
    const { rerender, controle } = montar(sessao({ progresso: progresso(4) }));
    expect(estados()).toEqual(['feita', 'feita', 'feita', 'agora', 'falta']);
    rerender(<EmAnalise sessoes={[sessao({ progresso: progresso(2) })]} feeds={{}} controle={controle} />);
    expect(estados()).toEqual(['feita', 'feita', 'feita', 'agora', 'falta']);
    expect(within(faixa()).getByText('Conferindo no código o que a revisão afirmou.')).toBeTruthy();
    // e sem o progresso também não volta ao começo
    rerender(<EmAnalise sessoes={[sessao()]} feeds={{}} controle={controle} />);
    expect(estados()).toEqual(['feita', 'feita', 'feita', 'agora', 'falta']);
  });

  it('o relógio de 1 s só troca o texto: o foco fica no Cancelar', () => {
    montar(sessao({ progresso: progresso(1) }));
    const cancelar = screen.getByRole('button', { name: `Cancelar ${NOME}` });
    cancelar.focus();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(within(faixa()).getByText('21 s')).toBeTruthy();
    expect(document.activeElement).toBe(cancelar);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(within(faixa()).getByText('1 min 21 s')).toBeTruthy();
    expect(document.activeElement).toBe(cancelar);
  });

  it('sem sinal: mais de 45 s sem evento da sessão com o modelo lendo vira aviso, e um evento novo tira', () => {
    const feeds = { a1: [{ t: INICIO + 10000, k: 'tool', text: 'lendo' }] };
    const { rerender, controle } = montar(sessao({ progresso: progresso(3) }), feeds);
    // 8 s desde o último evento
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    act(() => { vi.advanceTimersByTime(37000); });
    // 45 s exatos ainda não é sem sinal
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    act(() => { vi.advanceTimersByTime(35000); });
    expect(cartao().getAttribute('data-tom')).toBe('aviso');
    expect(within(faixa()).getByText('Sem sinal do modelo há 1 min 20 s. A sessão segue aberta.')).toBeTruthy();
    expect(within(faixa()).getByText('pode cancelar e tentar de novo')).toBeTruthy();
    expect(cartao().getAttribute('aria-label')).toBe('dono/repo#12: em análise, sem sinal do modelo');
    rerender(<EmAnalise sessoes={[sessao({ progresso: progresso(3) })]} feeds={{ a1: [...feeds.a1, { t: Date.now(), k: 'tool', text: 'de novo' }] }} controle={controle} />);
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
  });

  it('o modelo pensando não vira linha do feed: o sinal de vida do motor (ultimoSinalEm) mantém a sessão viva', () => {
    const feeds = { a1: [{ t: INICIO, k: 'tool', text: 'lendo' }] };
    const { rerender, controle } = montar(sessao({ progresso: progresso(3), ultimoSinalEm: INICIO + 10000 }), feeds);
    // 70 s desde a última linha do feed, mas o motor viu o modelo escrevendo há 8 s + 50 s
    act(() => { vi.advanceTimersByTime(50000); });
    expect(cartao().getAttribute('data-tom')).toBe('aviso');
    // o sinal novo chega no estado: a sessão está viva, sem nenhuma linha nova no feed
    rerender(<EmAnalise sessoes={[sessao({ progresso: progresso(3), ultimoSinalEm: Date.now() - 2000 })]} feeds={feeds} controle={controle} />);
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    expect(screen.queryByText(/Sem sinal/)).toBeNull();
    act(() => { vi.advanceTimersByTime(40000); });
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
  });

  it('relógio do navegador 60 s à frente do motor: o tempo e o "sem sinal" contam na hora do motor', () => {
    // o navegador está 60 s adiantado: a sessão começou há 18 s no relógio do motor
    vi.setSystemTime(INICIO + 18000 + 60000);
    const { controle } = controleFalso();
    const feeds = { a1: [{ t: INICIO + 10000, k: 'tool', text: 'lendo' }] };
    render(<EmAnalise sessoes={[sessao({ progresso: progresso(3) })]} feeds={feeds} desvio={60000} controle={controle} />);
    expect(within(faixa()).getByText('18 s')).toBeTruthy();
    // 68 s no relógio do navegador desde a última linha, mas só 8 s no do motor
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    act(() => { vi.advanceTimersByTime(36000); });
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(cartao().getAttribute('data-tom')).toBe('aviso');
    expect(within(faixa()).getByText('Sem sinal do modelo há 46 s. A sessão segue aberta.')).toBeTruthy();
  });

  it('sem o desvio o mesmo motor atrasado acenderia o "sem sinal" na hora: é o que o desvio corrige', () => {
    vi.setSystemTime(INICIO + 18000 + 60000);
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ progresso: progresso(3) })]} feeds={{ a1: [{ t: INICIO + 10000, k: 'tool', text: 'lendo' }] }} controle={controle} />);
    expect(cartao().getAttribute('data-tom')).toBe('aviso');
  });

  it('sem sinal não vale nas fontes, no card nem na postagem: quem trabalha é o motor', () => {
    montar(sessao({ progresso: progresso(1) }));
    act(() => { vi.advanceTimersByTime(120000); });
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    expect(screen.queryByText(/Sem sinal/)).toBeNull();
  });

  it('sem progresso, a faixa começa nas fontes, e as pílulas dizem o traço sem inventar', () => {
    montar(sessao());
    expect(estados()).toEqual(['agora', 'falta', 'falta', 'falta', 'falta']);
    expect(pilulas()).toEqual(['\u2013Checks obrigatóriosLidos no fim da revisão', '\u2013CardAinda não lido', '\u2013ParecerEm análise']);
    expect(screen.queryByText(/costuma/)).toBeNull();
    expect(screen.queryByText(/faltam/)).toBeNull();
  });

  it('Cancelar pergunta antes e só envia na confirmação; voltar não envia', () => {
    const { disparar } = montar(sessao());
    fireEvent.click(screen.getByRole('button', { name: `Cancelar ${NOME}` }));
    expect(disparar).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Cancelar ${NOME}?` }).textContent).toMatch(/interrompida/);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    expect(disparar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Cancelar ${NOME}` }));
    fireEvent.click(screen.getByRole('button', { name: `Cancelar a sessão: ${NOME}` }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'cancelar', id: 'a1', alvo: 'sessao:a1', nome: NOME });
  });

  it('com o Cancelar no ar, o botão diz Cancelando e fica desabilitado', () => {
    const { controle } = controleFalso({ 'sessao:a1': 'cancelar' });
    render(<EmAnalise sessoes={[sessao()]} feeds={{}} controle={controle} />);
    const botao = screen.getByRole('button', { name: `Enviando: Cancelar ${NOME}` }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe('Cancelando…');
  });

  it('sessão já cancelada mostra Cancelando ocupado; a que o motor não deixa cancelar diz isso, sem Cancelar', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ cancelled: true }), sessao({ id: 'a2', cancellable: false })]} feeds={{}} controle={controle} />);
    const cancelando = screen.getByRole('button', { name: 'Cancelando a sessão de PR #12 de dono/repo' }) as HTMLButtonElement;
    expect(cancelando.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Cancelar / })).toBeNull();
    expect(screen.getByText(/não pode mais ser cancelada/)).toBeTruthy();
  });

  it('sessão só com o id desenha, com um nome que diz qual é, e sem link', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[{ id: 'a9' }]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Sessão a9' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('texto de fora é texto: título com HTML não vira elemento', () => {
    const { container } = montar(sessao({ pr: { key: 'dono/repo#12', url: URL_DO_PR, title: '<img src=x onerror=alert(1)>' } }));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('seção Em análise: a sessão que falhou', () => {
  const falha = { id: 'a1', chave: 'dono/repo#12', url: URL_DO_PR, titulo: 'Corrige o cálculo', autor: 'ana', inicio: INICIO, etapa: 2, cancelada: false, sumiuEm: INICIO + 151000, fimNoMotor: INICIO + 151000, motivo: 'limite do plano até 19/11.' };

  it('borda de falha, a etapa onde parou com "!", o motivo, "nada foi publicado", Tentar de novo e Dispensar', () => {
    const { controle, disparar } = controleFalso();
    const aoDispensar = vi.fn();
    render(<EmAnalise sessoes={[]} feeds={{}} falhas={[falha]} controle={controle} aoDispensarFalha={aoDispensar} />);
    expect(cartao().getAttribute('data-tom')).toBe('falha');
    expect(estados()).toEqual(['feita', 'feita', 'erro', 'falta', 'falta']);
    expect(etapas()[2]?.textContent).toContain('!');
    expect(within(faixa()).getByText('A sessão terminou sem resultado: limite do plano até 19/11.')).toBeTruthy();
    expect(within(faixa()).getByText('nada foi publicado')).toBeTruthy();
    expect(within(faixa()).getByText('2 min 31 s')).toBeTruthy();
    expect(within(faixa()).queryByRole('progressbar')).toBeNull();
    expect(pilulas()[2]).toBe('\u2013ParecerNada foi publicado');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo PR #12 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL_DO_PR, falhou: true, alvo: 'dono/repo#12', nome: 'PR #12 de dono/repo' });
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar a falha de PR #12 de dono/repo' }));
    expect(aoDispensar).toHaveBeenCalledWith('dono/repo#12');
  });

  it('sem motivo, a frase fecha sem dois pontos', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[]} feeds={{}} falhas={[{ ...falha, motivo: '' }]} controle={controle} />);
    expect(screen.getByText('A sessão terminou sem resultado.')).toBeTruthy();
  });

  it('com o Tentar de novo clicado, o cartão vira "Iniciando a revisão." na hora', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(INICIO + 200000);
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[]} feeds={{}} falhas={[falha]} iniciadas={new Map([['dono/repo#12', INICIO + 200000]])} controle={controle} />);
    expect(cartao().getAttribute('data-tom')).toBe('rodando');
    expect(screen.getByText('Iniciando a revisão.')).toBeTruthy();
    expect(within(faixa()).getByText('0 s')).toBeTruthy();
    expect(estados()).toEqual(['agora', 'falta', 'falta', 'falta', 'falta']);
    expect(screen.getByRole('button', { name: 'Revisando PR #12 de dono/repo' })).toBeTruthy();
  });
});
