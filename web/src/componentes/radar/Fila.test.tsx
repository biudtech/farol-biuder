// @vitest-environment jsdom
// A Fila no molde do cartão da autoanálise (18/11/2026): um cartão por PR, com a borda neutra,
// sem pílulas, e o rodapé que diz a posição e o que segura o PR. Herdeiro dos testes da linha que
// abria: o detalhe saiu, e o que ele dizia está no cartão.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDaFila } from '@/contratos/radar';
import { Fila } from './Fila';
import { URL_DO_PR, controleFalso, nomes } from './apoio-de-teste';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOME = 'PR #12 de dono/repo';

function item(extra: Partial<ItemDaFila> = {}): ItemDaFila {
  return { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana', repo: 'dono/repo', number: 12, updatedAt: '2026-11-16T14:32:00Z', isDraft: false, ...extra };
}

const cartoes = () => screen.getAllByRole('article');

describe('seção Fila', () => {
  it('lista vazia mostra a linha que a tela mandou, sem botão', () => {
    const { controle } = controleFalso();
    render(<Fila fila={[]} emEspera={[]} vazio="Nenhum PR na fila." controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Fila' })).toBeTruthy();
    expect(screen.getByText('Nenhum PR na fila.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a primeira checagem em curso põe o spinner na linha de vazio', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[]} emEspera={[]} vazio="A primeira checagem ainda não terminou." checando controle={controle} />);
    expect(screen.getByText('A primeira checagem ainda não terminou.')).toBeTruthy();
    expect(container.querySelector('[data-tamanho="p"]')).toBeTruthy();
  });

  it('um cartão por PR, na ordem do motor, com a borda neutra, a chave, o autor, o título e a posição no rodapé', () => {
    const { controle } = controleFalso();
    render(<Fila fila={[item({ key: 'z/zeta#9', url: 'https://github.com/z/zeta/pull/9', title: 'Primeiro' }), item()]} emEspera={[]} vazio="" controle={controle} />);
    const [a, b] = cartoes();
    expect(a?.getAttribute('data-tom')).toBe('fila');
    expect(within(a as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Primeiro');
    expect(within(a as HTMLElement).getByText('1º na fila: começa quando abrir uma vaga.')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('2º na fila: começa quando abrir uma vaga.')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('ana')).toBeTruthy();
    expect(within(b as HTMLElement).getByText(/^atualizado em /)).toBeTruthy();
    // a fila não tem pílulas nem faixa de etapas: ainda não começou
    expect(within(b as HTMLElement).queryByRole('list', { name: 'Resumo' })).toBeNull();
    expect(within(b as HTMLElement).queryByRole('group')).toBeNull();
  });

  it('Revisar agora, Ignorar e Abrir no GitHub no cabeçalho', () => {
    const { controle, disparar } = controleFalso();
    render(<Fila fila={[item()]} emEspera={[]} vazio="" controle={controle} />);
    const cartao = cartoes()[0] as HTMLElement;
    expect(nomes(within(cartao).getAllByRole('button'))).toEqual([`Revisar agora ${NOME}`, `Ignorar ${NOME}`]);
    const link = within(cartao).getByRole('link', { name: /Abrir no GitHub: dono\/repo#12/ });
    expect(link.getAttribute('href')).toBe(URL_DO_PR);
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    fireEvent.click(within(cartao).getByRole('button', { name: `Revisar agora ${NOME}` }));
    fireEvent.click(within(cartao).getByRole('button', { name: `Ignorar ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([
      { tipo: 'revisar', url: URL_DO_PR, alvo: 'dono/repo#12', nome: NOME },
      { tipo: 'ignorar', chave: 'dono/repo#12', alvo: 'dono/repo#12', nome: NOME },
    ]);
  });

  it('item só com chave e URL de fora do GitHub desenha sem link, com o nome do PR no lugar do título e as iniciais no avatar', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[{ key: 'dono/repo#12', url: 'http://outro.example/pull/12' }]} emEspera={[]} vazio="" controle={controle} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(NOME);
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('rascunho, parada e conflito ganham marca, e o rodapé diz o que segura o PR', () => {
    const { controle } = controleFalso();
    const { rerender } = render(
      <Fila
        fila={[item({ isDraft: true })]}
        emEspera={[]}
        estacionados={{ 'dono/repo#12': { at: '', motivo: 'timeout', tipo: 'falha' } }}
        emConflito={{ 'dono/repo#12': { head: 'abc' } }}
        vazio=""
        controle={controle}
      />,
    );
    const cartao = cartoes()[0] as HTMLElement;
    expect(within(cartao).getByText('rascunho')).toBeTruthy();
    expect(within(cartao).getByText('parada')).toBeTruthy();
    expect(within(cartao).getByText('em conflito')).toBeTruthy();
    expect(screen.getByText('Revisão automática parada: falhou (timeout). Ela não relança sozinha.')).toBeTruthy();
    rerender(<Fila fila={[item()]} emEspera={[]} emConflito={{ 'dono/repo#12': {} }} vazio="" controle={controle} />);
    expect(screen.getByText(/^1º na fila, em conflito com a base/)).toBeTruthy();
    rerender(<Fila fila={[item()]} emEspera={[]} inicioAutomatico={{ 'dono/repo#12': false }} vazio="" controle={controle} />);
    expect(screen.getByText('1º na fila: o motor não abre esta revisão sozinho, ela começa por Revisar agora.')).toBeTruthy();
  });

  it('PR que o motor abre sozinho, sem parada nem conflito, não ganha nota', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[item()]} emEspera={[]} estacionados={{}} inicioAutomatico={{ 'dono/repo#12': true }} emConflito={{}} vazio="" controle={controle} />);
    expect(container.textContent).not.toMatch(/parada|sozinho|conflito/);
  });

  it('PR que espera vaga de execução aparece sem botão, com a marca e o motivo no rodapé', () => {
    const { controle } = controleFalso();
    const espera = { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana' };
    render(<Fila fila={[]} emEspera={[espera]} detalhes={{ 'dono/repo#12': { posicao: 2, total: 2, motivo: 'limite-global', ocupadas: 2, limite: 2 } }} vazio="vazio" controle={controle} />);
    expect(screen.getByText('Esperando vaga · 2º')).toBeTruthy();
    expect(screen.getByText('Na fila de execução, posição 2 de 2. Limite total de revisões simultâneas atingido (2/2).')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('vazio')).toBeNull();
  });

  it('com a ação do item no ar, Revisar agora e Ignorar ficam desabilitados', () => {
    const { controle } = controleFalso({ 'dono/repo#12': 'ignorar' });
    const { container } = render(<Fila fila={[item()]} emEspera={[]} vazio="" controle={controle} />);
    expect([...container.querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true]);
    expect(screen.getByRole('button', { name: `Enviando: Ignorar ${NOME}` }).textContent).toBe('Enviando…');
  });

  it('ao clicar: o cartão vira "Iniciando a revisão." com a borda primária, o tempo desde o clique e Revisando ocupado', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.UTC(2026, 10, 16, 15));
    const { controle } = controleFalso();
    render(<Fila fila={[item()]} emEspera={[]} vazio="" iniciadas={new Map([['dono/repo#12', Date.now()]])} controle={controle} />);
    const cartao = cartoes()[0] as HTMLElement;
    expect(cartao.getAttribute('data-tom')).toBe('rodando');
    const faixa = within(cartao).getByRole('group', { name: `Andamento da revisão de ${NOME}` });
    expect(within(faixa).getByText('Iniciando a revisão.')).toBeTruthy();
    expect(within(faixa).getByText('0 s')).toBeTruthy();
    expect(within(faixa).getAllByRole('listitem')[0]?.getAttribute('aria-current')).toBe('step');
    expect(within(cartao).getByRole('button', { name: `Revisando ${NOME}` })).toBeTruthy();
    expect(within(cartao).queryByRole('button', { name: `Revisar agora ${NOME}` })).toBeNull();
  });

  it('a última sessão sumiu sem resultado: o cartão da fila mostra a falha, com Tentar de novo, Ignorar e Dispensar', () => {
    const { controle, disparar } = controleFalso();
    const aoDispensar = vi.fn();
    const falha = { id: 'a1', chave: 'dono/repo#12', inicio: 1000, etapa: 3, cancelada: false, sumiuEm: 61000, fimNoMotor: 61000, motivo: '' };
    render(<Fila fila={[item()]} emEspera={[]} vazio="" falhas={new Map([['dono/repo#12', falha]])} controle={controle} aoDispensarFalha={aoDispensar} />);
    const cartao = cartoes()[0] as HTMLElement;
    expect(cartao.getAttribute('data-tom')).toBe('falha');
    expect(within(cartao).getByText('A sessão terminou sem resultado.')).toBeTruthy();
    expect(within(cartao).getByText('1 min 00 s')).toBeTruthy();
    expect(nomes(within(cartao).getAllByRole('button'))).toEqual([`Tentar de novo ${NOME}`, `Ignorar ${NOME}`, `Dispensar a falha de ${NOME}`]);
    fireEvent.click(within(cartao).getByRole('button', { name: `Tentar de novo ${NOME}` }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL_DO_PR, falhou: true, alvo: 'dono/repo#12', nome: NOME });
    fireEvent.click(within(cartao).getByRole('button', { name: `Dispensar a falha de ${NOME}` }));
    expect(aoDispensar).toHaveBeenCalledWith('dono/repo#12');
  });
});
