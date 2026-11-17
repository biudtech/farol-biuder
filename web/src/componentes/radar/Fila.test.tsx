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

// cada PR é um <details>: o resumo é a linha, o resto é o detalhe
const linhas = (container: HTMLElement) => [...container.querySelectorAll('details')];
const resumo = (linha: HTMLElement) => linha.querySelector('summary') as HTMLElement;

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

  it('uma linha por PR, na ordem do motor, com o título e o repositório; o detalhe começa fechado', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[item({ key: 'z/zeta#9', url: 'https://github.com/z/zeta/pull/9', title: 'Primeiro' }), item()]} emEspera={[]} vazio="" controle={controle} />);
    const [a, b] = linhas(container);
    expect(resumo(a as HTMLElement).textContent).toBe('Primeirozeta');
    expect(resumo(b as HTMLElement).textContent).toBe('Corrige o cálculorepo');
    expect((a as HTMLDetailsElement).open).toBe(false);
  });

  it('o detalhe abre e fecha num clique, e traz a chave, o autor, a hora, a posição e as ações', () => {
    const { controle, disparar } = controleFalso();
    const { container } = render(<Fila fila={[item({ key: 'z/z#9', url: 'https://github.com/z/z/pull/9' }), item()]} emEspera={[]} vazio="" controle={controle} />);
    const segunda = linhas(container)[1] as HTMLDetailsElement;
    fireEvent.click(resumo(segunda));
    expect(segunda.open).toBe(true);
    expect(within(segunda).getByText(/^dono\/repo#12 · ana · atualizado em .+ · 2º na fila$/)).toBeTruthy();
    expect(nomes(within(segunda).getAllByRole('button'))).toEqual([`Revisar agora ${NOME}`, `Ignorar ${NOME}`]);
    const link = within(segunda).getByRole('link', { name: /Abrir no GitHub: dono\/repo#12/ });
    expect(link.getAttribute('href')).toBe(URL_DO_PR);
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    fireEvent.click(within(segunda).getByRole('button', { name: `Revisar agora ${NOME}` }));
    fireEvent.click(within(segunda).getByRole('button', { name: `Ignorar ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([
      { tipo: 'revisar', url: URL_DO_PR, alvo: 'dono/repo#12', nome: NOME },
      { tipo: 'ignorar', chave: 'dono/repo#12', alvo: 'dono/repo#12', nome: NOME },
    ]);
    fireEvent.click(resumo(segunda));
    expect(segunda.open).toBe(false);
  });

  it('item só com chave e URL de fora do GitHub desenha sem link, com o nome do PR no lugar do título', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[{ key: 'dono/repo#12', url: 'http://outro.example/pull/12' }]} emEspera={[]} vazio="" controle={controle} />);
    expect(container.querySelector('a')).toBeNull();
    expect(resumo(linhas(container)[0] as HTMLElement).textContent).toBe(`${NOME}repo`);
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('rascunho, parada e conflito ganham marca na linha, e o motivo do motor no detalhe', () => {
    const { controle } = controleFalso();
    const { container } = render(
      <Fila
        fila={[item({ isDraft: true })]}
        emEspera={[]}
        estacionados={{ 'dono/repo#12': { at: '', motivo: 'timeout', tipo: 'falha' } }}
        inicioAutomatico={{ 'dono/repo#12': false }}
        emConflito={{ 'dono/repo#12': { head: 'abc' } }}
        vazio=""
        controle={controle}
      />,
    );
    const linha = resumo(linhas(container)[0] as HTMLElement);
    expect(within(linha).getByText('rascunho')).toBeTruthy();
    expect(within(linha).getByText('parada')).toBeTruthy();
    expect(within(linha).getByText('em conflito')).toBeTruthy();
    expect(screen.getByText('Revisão automática parada: falhou (timeout). Ela não relança sozinha.')).toBeTruthy();
    expect(screen.getByText(/não abre a revisão deste PR sozinho/)).toBeTruthy();
    expect(screen.getByText(/Em conflito com a base/)).toBeTruthy();
  });

  it('PR que o motor abre sozinho, sem parada nem conflito, não ganha nota', () => {
    const { controle } = controleFalso();
    const { container } = render(<Fila fila={[item()]} emEspera={[]} estacionados={{}} inicioAutomatico={{ 'dono/repo#12': true }} emConflito={{}} vazio="" controle={controle} />);
    expect(container.textContent).not.toMatch(/parada|sozinho|conflito/);
  });

  it('PR que espera vaga de execução aparece sem botão, com a marca na linha e o motivo no detalhe', () => {
    const { controle } = controleFalso();
    const espera = { key: 'dono/repo#12', url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana' };
    const { container } = render(<Fila fila={[]} emEspera={[espera]} detalhes={{ 'dono/repo#12': { posicao: 2, total: 2, motivo: 'limite-global', ocupadas: 2, limite: 2 } }} vazio="vazio" controle={controle} />);
    expect(within(resumo(linhas(container)[0] as HTMLElement)).getByText('Esperando vaga · 2º')).toBeTruthy();
    expect(screen.getByText('Na fila de execução, posição 2 de 2. Limite total de revisões simultâneas atingido (2/2).')).toBeTruthy();
    expect(screen.getByText('dono/repo#12 · ana')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('vazio')).toBeNull();
  });

  it('com a ação do item no ar, Revisar agora e Ignorar ficam desabilitados', () => {
    const { controle } = controleFalso({ 'dono/repo#12': 'ignorar' });
    const { container } = render(<Fila fila={[item()]} emEspera={[]} vazio="" controle={controle} />);
    expect([...container.querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true]);
    expect(within(container).getByRole('button', { name: `Enviando: Ignorar ${NOME}`, hidden: true }).textContent).toBe('Enviando…');
  });
});
