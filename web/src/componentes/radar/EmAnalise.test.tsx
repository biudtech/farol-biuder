// @vitest-environment jsdom
// Herdeiro de AnalisandoAgora.test.tsx: os mesmos comportamentos (feed, progresso, Cancelar),
// agora numa linha que abre. O que mudou foi só a marcação: o cartão virou <details>, o título
// do bloco perdeu a contagem (ela foi para o topo da tela) e a etapa saiu da cabeça da barra
// para a meta da linha e o detalhe.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessaoAtiva } from '@/contratos/radar';
import { EmAnalise } from './EmAnalise';
import { URL_DO_PR, controleFalso } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'a sessão de PR #12 de dono/repo';

function sessao(extra: Partial<SessaoAtiva> = {}): SessaoAtiva {
  return {
    id: 'a1',
    label: 'Revisão automática de dono/repo#12',
    startedAt: Date.UTC(2026, 10, 16, 14, 32),
    keys: ['dono/repo#12'],
    cancellable: true,
    pr: { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana' },
    ...extra,
  };
}

const PROGRESSO = { percentual: 45, etapa: 3, totalEtapas: 5, rotuloDaEtapa: 'lendo o código', arquivosLidos: 9, arquivosTotais: 20, restanteEstimadoMs: 4 * 60000 };
const resumo = (container: HTMLElement) => container.querySelector('summary') as HTMLElement;

describe('seção Em análise', () => {
  it('lista vazia diz que está vazia numa linha', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Em análise' })).toBeTruthy();
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
  });

  it('a linha traz o título, a porcentagem, a barra e "repo#n · etapa atual"', () => {
    const { controle } = controleFalso();
    const { container } = render(<EmAnalise sessoes={[sessao({ progresso: PROGRESSO })]} feeds={{}} controle={controle} />);
    const linha = resumo(container);
    expect(within(linha).getByText('Corrige o cálculo')).toBeTruthy();
    expect(within(linha).getByText('45%')).toBeTruthy();
    expect(within(linha).getByText('repo#12 · lendo o código')).toBeTruthy();
    // a barra fica fora do <summary>, para o progressbar chegar ao leitor de tela; no resumo, só texto
    expect(within(linha).queryByRole('progressbar')).toBeNull();
    expect(linha.querySelector('svg, [role]')).toBeNull();
    const barra = screen.getByRole('progressbar', { name: 'Andamento de PR #12 de dono/repo' });
    expect(barra.closest('summary')).toBeNull();
    expect(barra.closest('details')).toBeNull();
    expect(barra.getAttribute('aria-valuenow')).toBe('45');
    expect(barra.getAttribute('aria-valuemin')).toBe('0');
    expect(barra.getAttribute('aria-valuemax')).toBe('100');
    expect(barra.getAttribute('aria-valuetext')).toBe('45%, etapa 3 de 5: lendo o código');
    // a largura vai como atributo do SVG, nunca como estilo em linha
    expect(barra.querySelectorAll('rect')[1]?.getAttribute('width')).toBe('45');
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('o detalhe abre num clique e traz a etapa, os arquivos, quanto falta, o feed, o link e o Cancelar', () => {
    const { controle } = controleFalso();
    const feeds = { a1: [{ t: 1000, k: 'tool', text: 'lendo o diff' }, { t: 2000, k: 'text', text: 'conferindo o teste', a: 'leitor' }], outra: [{ t: 1, k: 'info', text: 'de outra sessão' }] };
    const { container } = render(<EmAnalise sessoes={[sessao({ progresso: PROGRESSO })]} feeds={feeds} controle={controle} />);
    const detalhes = container.querySelector('details') as HTMLDetailsElement;
    expect(detalhes.open).toBe(false);
    fireEvent.click(resumo(container));
    expect(detalhes.open).toBe(true);
    expect(screen.getByText('Etapa 3 de 5: lendo o código · 9 de 20 arquivos · faltam ~4 min')).toBeTruthy();
    expect(screen.getByText(/^dono\/repo#12 · PR de ana · começou em /)).toBeTruthy();
    const linhas = within(screen.getByRole('list', { name: /Feed de PR #12 de dono\/repo/ })).getAllByRole('listitem');
    expect(linhas.map((l) => l.lastElementChild?.textContent)).toEqual(['[leitor] conferindo o teste', 'lendo o diff']);
    expect(screen.queryByText('de outra sessão')).toBeNull();
    expect(screen.getByRole('link', { name: /Abrir no GitHub: dono\/repo#12/ }).getAttribute('href')).toBe(URL_DO_PR);
    expect(screen.getByRole('button', { name: `Cancelar ${NOME}` })).toBeTruthy();
  });

  it('com os nomes das etapas, o detalhe lista as feitas, a atual com os arquivos e as que faltam', () => {
    const { controle } = controleFalso();
    const etapas = ['fontes', 'card', 'código', 'conferência dos achados', 'postagem'];
    const { rerender } = render(<EmAnalise sessoes={[sessao({ progresso: { ...PROGRESSO, rotuloDaEtapa: 'código', etapas } })]} feeds={{}} controle={controle} />);
    const itens = () => within(screen.getByRole('list', { name: 'Etapas da revisão' })).getAllByRole('listitem');
    expect(itens().map((li) => li.textContent)).toEqual([
      '✓Fontes (feita)', '✓Card (feita)', 'Código: 9 de 20 arquivos (agora)', 'Conferência dos achados (falta)', 'Postagem (falta)',
    ]);
    rerender(<EmAnalise sessoes={[sessao({ progresso: { percentual: 100, etapa: 5, totalEtapas: 5, rotuloDaEtapa: 'postagem', etapas } })]} feeds={{}} controle={controle} />);
    expect(itens().every((li) => li.getAttribute('data-estado') === 'feita')).toBe(true);
  });

  it('sem os nomes das etapas não há lista: só a linha da etapa atual', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ progresso: PROGRESSO })]} feeds={{}} controle={controle} />);
    expect(screen.queryByRole('list', { name: 'Etapas da revisão' })).toBeNull();
  });

  it('sem estimativa nem contagem de arquivos, não inventa: só o número e a etapa', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ progresso: { percentual: 65, etapa: 4, totalEtapas: 5, rotuloDaEtapa: 'conferência dos achados' } })]} feeds={{}} controle={controle} />);
    expect(screen.getByText('Etapa 4 de 5: conferência dos achados')).toBeTruthy();
    expect(screen.queryByText(/faltam/)).toBeNull();
    expect(screen.queryByText(/arquivos/)).toBeNull();
  });

  it('falta de menos de um minuto se diz como menos de 1 min', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ progresso: { percentual: 90, etapa: 5, totalEtapas: 5, rotuloDaEtapa: 'postagem', restanteEstimadoMs: 20000 } })]} feeds={{}} controle={controle} />);
    expect(screen.getByText(/faltam menos de 1 min/)).toBeTruthy();
  });

  it('sem o progresso, a linha fica sem barra nem porcentagem, com o spinner no lugar', () => {
    const { controle } = controleFalso();
    const { container } = render(<EmAnalise sessoes={[sessao()]} feeds={{}} controle={controle} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/etapa/i)).toBeNull();
    expect(resumo(container).querySelector('[data-tamanho="p"]')).toBeTruthy();
  });

  it('linha de aviso do feed se diz em texto, e o feed é texto, nunca HTML', () => {
    const { controle } = controleFalso();
    const { container } = render(<EmAnalise sessoes={[sessao()]} feeds={{ a1: [{ t: 1, k: 'warn', text: 'instabilidade' }, { t: 2, k: 'tool', text: '<img src=x onerror=alert(1)>' }] }} controle={controle} />);
    expect(screen.getByText('Aviso: instabilidade')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('sessão sem linha no feed diz isso, e id de protótipo não acha feed', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ id: 'constructor' })]} feeds={{}} controle={controle} />);
    expect(screen.getByText('O feed desta sessão ainda não tem linha.')).toBeTruthy();
  });

  it('Cancelar pergunta antes e só envia na confirmação; voltar não envia', () => {
    const { controle, disparar } = controleFalso();
    render(<EmAnalise sessoes={[sessao()]} feeds={{}} controle={controle} />);
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

  it('sessão já cancelada mostra Cancelando ocupado; a que o motor não deixa cancelar diz isso, sem botão', () => {
    const { controle } = controleFalso();
    render(<EmAnalise sessoes={[sessao({ cancelled: true }), sessao({ id: 'a2', cancellable: false })]} feeds={{}} controle={controle} />);
    const cancelando = screen.getByRole('button', { name: 'Cancelando a sessão de PR #12 de dono/repo' }) as HTMLButtonElement;
    expect(cancelando.disabled).toBe(true);
    expect(cancelando.textContent).toBe('Cancelando…');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText(/não pode mais ser cancelada/)).toBeTruthy();
  });

  it('sessão só com o id desenha, com um nome que diz qual é, e sem botão', () => {
    const { controle } = controleFalso();
    const { container } = render(<EmAnalise sessoes={[{ id: 'a9' }]} feeds={{}} controle={controle} />);
    expect(within(resumo(container)).getByText('Sessão a9')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('as linhas que ficam no feed mantêm o elemento quando chega linha nova e a mais antiga é cortada', () => {
    const { controle } = controleFalso();
    const linha = (t: number) => ({ t, k: 'tool', text: `linha ${t}` });
    const { rerender } = render(<EmAnalise sessoes={[sessao()]} feeds={{ a1: [linha(1), linha(2), linha(3)] }} controle={controle} />);
    const antes = screen.getByText('linha 3').closest('li');
    rerender(<EmAnalise sessoes={[sessao()]} feeds={{ a1: [linha(2), linha(3), linha(4)] }} controle={controle} />);
    expect(screen.getByText('linha 3').closest('li')).toBe(antes);
    expect(screen.queryByText('linha 1')).toBeNull();
  });
});
