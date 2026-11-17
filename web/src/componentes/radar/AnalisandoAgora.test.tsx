// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessaoAtiva } from '@/contratos/radar';
import { AnalisandoAgora } from './AnalisandoAgora';
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

describe('bloco Analisando agora', () => {
  it('lista vazia diz que está vazia numa linha', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Analisando agora (0)' })).toBeTruthy();
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
  });

  it('sessão normal mostra o PR, o feed com a linha mais recente primeiro e o Cancelar', () => {
    const { controle } = controleFalso();
    const feeds = { a1: [{ t: 1000, k: 'tool', text: 'lendo o diff' }, { t: 2000, k: 'text', text: 'conferindo o teste', a: 'leitor' }], outra: [{ t: 1, k: 'info', text: 'de outra sessão' }] };
    render(<AnalisandoAgora sessoes={[sessao()]} feeds={feeds} controle={controle} />);
    expect(screen.getByRole('link', { name: /dono\/repo#12/ }).getAttribute('href')).toBe(URL_DO_PR);
    expect(screen.getByText('Corrige o cálculo')).toBeTruthy();
    const linhas = within(screen.getByRole('list', { name: /Feed de PR #12 de dono\/repo/ })).getAllByRole('listitem');
    expect(linhas.map((l) => l.lastElementChild?.textContent)).toEqual(['[leitor] conferindo o teste', 'lendo o diff']);
    expect(screen.queryByText('de outra sessão')).toBeNull();
    expect(screen.getByRole('button', { name: `Cancelar ${NOME}` })).toBeTruthy();
  });

  it('linha de aviso do feed se diz em texto, não só no destaque', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao()]} feeds={{ a1: [{ t: 1, k: 'warn', text: 'instabilidade na conexão' }] }} controle={controle} />);
    expect(screen.getByText('Aviso: instabilidade na conexão')).toBeTruthy();
  });

  it('linha do feed é texto, nunca HTML', () => {
    const { controle } = controleFalso();
    const { container } = render(<AnalisandoAgora sessoes={[sessao()]} feeds={{ a1: [{ t: 1, k: 'tool', text: '<img src=x onerror=alert(1)>' }] }} controle={controle} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('sessão sem linha no feed diz isso, e id de protótipo não acha feed', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ id: 'constructor' })]} feeds={{}} controle={controle} />);
    expect(screen.getByText('O feed desta sessão ainda não tem linha.')).toBeTruthy();
  });

  it('com o progresso, mostra o número, a barra, a etapa, os arquivos e quanto falta', () => {
    const { controle } = controleFalso();
    const progresso = { percentual: 45, etapa: 3, totalEtapas: 5, rotuloDaEtapa: 'código', arquivosLidos: 9, arquivosTotais: 20, restanteEstimadoMs: 4 * 60000 };
    render(<AnalisandoAgora sessoes={[sessao({ progresso })]} feeds={{}} controle={controle} />);
    const barra = screen.getByRole('progressbar', { name: 'Andamento de PR #12 de dono/repo' });
    expect(barra.getAttribute('aria-valuenow')).toBe('45');
    expect(barra.getAttribute('aria-valuemin')).toBe('0');
    expect(barra.getAttribute('aria-valuemax')).toBe('100');
    expect(barra.getAttribute('aria-valuetext')).toBe('45%, etapa 3 de 5: código');
    expect(screen.getByText('45%')).toBeTruthy();
    expect(screen.getByText('etapa 3 de 5: código')).toBeTruthy();
    expect(screen.getByText('9 de 20 arquivos')).toBeTruthy();
    expect(screen.getByText('faltam ~4 min')).toBeTruthy();
  });

  it('sem estimativa nem contagem de arquivos, não inventa: só o número e a etapa', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ progresso: { percentual: 65, etapa: 4, totalEtapas: 5, rotuloDaEtapa: 'conferência dos achados' } })]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('65');
    expect(screen.getByText('etapa 4 de 5: conferência dos achados')).toBeTruthy();
    expect(screen.queryByText(/faltam/)).toBeNull();
    expect(screen.queryByText(/arquivos/)).toBeNull();
  });

  it('falta de menos de um minuto se diz como menos de 1 min', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ progresso: { percentual: 90, etapa: 5, totalEtapas: 5, rotuloDaEtapa: 'postagem', restanteEstimadoMs: 20000 } })]} feeds={{}} controle={controle} />);
    expect(screen.getByText('faltam menos de 1 min')).toBeTruthy();
  });

  it('sem o progresso, o cartão fica como antes: sem barra nem porcentagem', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao()]} feeds={{}} controle={controle} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/etapa/)).toBeNull();
  });

  it('Cancelar pergunta antes e só envia na confirmação', () => {
    const { controle, disparar } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao()]} feeds={{}} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Cancelar ${NOME}` }));
    expect(disparar).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Cancelar ${NOME}?` }).textContent).toMatch(/interrompida/);
    fireEvent.click(screen.getByRole('button', { name: `Cancelar a sessão: ${NOME}` }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'cancelar', id: 'a1', alvo: 'sessao:a1', nome: NOME });
  });

  it('confirmação cancelada não envia', () => {
    const { controle, disparar } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao()]} feeds={{}} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Cancelar ${NOME}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    expect(disparar).not.toHaveBeenCalled();
  });

  it('sessão já cancelada, ou que o motor não deixa mais cancelar, não tem botão e diz o estado', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ cancelled: true }), sessao({ id: 'a2', cancellable: false })]} feeds={{}} controle={controle} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Cancelamento aceito: a sessão está encerrando.')).toBeTruthy();
    expect(screen.getByText(/não pode mais ser cancelada/)).toBeTruthy();
  });

  it('sessão só com o id (o resto ausente) desenha, com um nome que diz qual é', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[{ id: 'a9' }]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Sessão a9');
    // sem cancellable o motor não disse que dá para cancelar: não há botão
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('as linhas que ficam no feed mantêm o elemento quando chega linha nova e a mais antiga é cortada', () => {
    const { controle } = controleFalso();
    const linha = (t: number) => ({ t, k: 'tool', text: `linha ${t}` });
    const { rerender } = render(<AnalisandoAgora sessoes={[sessao()]} feeds={{ a1: [linha(1), linha(2), linha(3)] }} controle={controle} />);
    const antes = screen.getByText('linha 3').closest('li');
    rerender(<AnalisandoAgora sessoes={[sessao()]} feeds={{ a1: [linha(2), linha(3), linha(4)] }} controle={controle} />);
    expect(screen.getByText('linha 3').closest('li')).toBe(antes);
    expect(screen.queryByText('linha 1')).toBeNull();
  });

  it('sessão sem PR aparece pelo rótulo do motor, sem link', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ keys: undefined, pr: undefined, label: 'Sessão avulsa' })]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Sessão avulsa');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar a sessão de Sessão avulsa' })).toBeTruthy();
  });
});
