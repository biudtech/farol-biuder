// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemDaFila } from '@/contratos/radar';
import { Fila } from './Fila';
import { URL_DO_PR, controleFalso, nomes } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';

function item(extra: Partial<ItemDaFila> = {}): ItemDaFila {
  return { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana', repo: 'dono/repo', number: 12, updatedAt: '2026-11-16T14:32:00Z', isDraft: false, ...extra };
}

const cartoes = () => screen.getAllByRole('listitem').filter((li) => li.querySelector('h3'));

describe('bloco Fila', () => {
  it('lista vazia mostra a linha que a tela mandou', () => {
    const { controle } = controleFalso();
    render(<Fila fila={[]} emEspera={[]} vazio="Nenhum PR na fila." controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Fila (0)' })).toBeTruthy();
    expect(screen.getByText('Nenhum PR na fila.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('item normal mostra o PR, com Revisar agora e Ignorar, na ordem do motor', () => {
    const { controle, disparar } = controleFalso();
    render(<Fila fila={[item({ key: 'z/z#9', url: 'https://github.com/z/z/pull/9' }), item()]} emEspera={[]} vazio="" controle={controle} />);
    expect(cartoes().map((c) => c.querySelector('h3')?.textContent)).toEqual(['z/z#9 (abre em nova aba)', 'dono/repo#12 (abre em nova aba)']);
    const segundo = cartoes()[1] as HTMLElement;
    expect(within(segundo).getByText('Corrige o cálculo')).toBeTruthy();
    expect(within(segundo).getByText(/PR de ana · Atualizado em /)).toBeTruthy();
    expect(nomes(within(segundo).getAllByRole('button'))).toEqual([`Revisar agora ${NOME}`, `Ignorar ${NOME}`]);
    fireEvent.click(within(segundo).getByRole('button', { name: `Revisar agora ${NOME}` }));
    fireEvent.click(within(segundo).getByRole('button', { name: `Ignorar ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([
      { tipo: 'revisar', url: URL_DO_PR, alvo: 'dono/repo#12', nome: NOME },
      { tipo: 'ignorar', chave: 'dono/repo#12', alvo: 'dono/repo#12', nome: NOME },
    ]);
  });

  it('item só com chave e URL (os campos opcionais ausentes) desenha sem quebrar', () => {
    const { controle } = controleFalso();
    render(<Fila fila={[{ key: 'dono/repo#12', url: 'http://outro.example/pull/12' }]} emEspera={[]} vazio="" controle={controle} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('rascunho ganha o selo', () => {
    const { controle } = controleFalso();
    render(<Fila fila={[item({ isDraft: true })]} emEspera={[]} vazio="" controle={controle} />);
    expect(screen.getByText('rascunho')).toBeTruthy();
  });

  it('item parado, em conflito ou que não abre sozinho diz o motivo que o motor mandou', () => {
    const { controle } = controleFalso();
    render(
      <Fila
        fila={[item()]}
        emEspera={[]}
        estacionados={{ 'dono/repo#12': { at: '', motivo: 'timeout', tipo: 'falha' } }}
        inicioAutomatico={{ 'dono/repo#12': false }}
        emConflito={{ 'dono/repo#12': { head: 'abc' } }}
        vazio=""
        controle={controle}
      />,
    );
    expect(screen.getByText('Revisão automática parada: falhou (timeout). Ela não relança sozinha.')).toBeTruthy();
    expect(screen.getByText(/não abre a revisão deste PR sozinho/)).toBeTruthy();
    expect(screen.getByText(/Em conflito com a base/)).toBeTruthy();
  });

  it('PR que o motor abre sozinho, sem parada nem conflito, não ganha nota', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[item()]} emEspera={[]} estacionados={{}} inicioAutomatico={{ 'dono/repo#12': true }} emConflito={{}} vazio="" controle={controle} />);
    expect(container.textContent).not.toMatch(/parada|sozinho|conflito/);
  });

  it('PR que espera vaga de execução aparece sem botão, com a posição e o motivo', () => {
    const { controle } = controleFalso();
    const espera = { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana', repo: 'dono/repo', updatedAt: '' };
    render(<Fila fila={[]} emEspera={[espera]} detalhes={{ 'dono/repo#12': { posicao: 1, total: 2, motivo: 'limite-global', ocupadas: 2, limite: 2 } }} vazio="vazio" controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Fila (1)' })).toBeTruthy();
    expect(screen.getByText(/PR de ana · Na fila de execução, posição 1 de 2\. Limite total de revisões simultâneas atingido \(2\/2\)\./)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('vazio')).toBeNull();
  });

  it('com a ação do item no ar, Revisar agora e Ignorar ficam desabilitados', () => {
    const { controle } = controleFalso({ 'dono/repo#12': 'ignorar' });
    render(<Fila fila={[item()]} emEspera={[]} vazio="" controle={controle} />);
    expect((screen.getAllByRole('button') as HTMLButtonElement[]).map((b) => b.disabled)).toEqual([true, true]);
    expect(screen.getByRole('button', { name: `Enviando: Ignorar ${NOME}` }).textContent).toBe('Enviando…');
  });
});
