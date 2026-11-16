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

  it('sessão sem PR aparece pelo rótulo do motor, sem link', () => {
    const { controle } = controleFalso();
    render(<AnalisandoAgora sessoes={[sessao({ keys: undefined, pr: undefined, label: 'Sessão avulsa' })]} feeds={{}} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Sessão avulsa');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar a sessão de Sessão avulsa' })).toBeTruthy();
  });
});
