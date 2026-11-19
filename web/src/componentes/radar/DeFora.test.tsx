// @vitest-environment jsdom
// "De fora da fila" (redesenho de 19/11/2026): o botão flutuante, a pílula ao lado do título da
// Fila e o painel lateral com os filtros por motivo, o motivo de cada PR em frase, quando ele volta
// e "Revisar mesmo assim". O painel fecha no X e no Esc, prende o foco e devolve o foco a quem o
// abriu.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrDeFora } from '@/contratos/de-fora';
import { BotaoDeFora, PainelDeFora, PilulaDeFora, usePainelDeFora } from './DeFora';
import { controleFalso, nomes } from './apoio-de-teste';
import type { ControleDeAcoes } from './useAcoes';

afterEach(cleanup);

const ITENS: PrDeFora[] = [
  {
    key: 'dono/repo#12', url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o cálculo', author: 'ana', motivo: 'decisao_de_gente',
    head: '30438ba4c0ffee', quem: ['bia'], detalhe: { decisivos: [{ quem: 'bia', estado: 'APPROVED' }] },
  },
  { key: 'dono/repo#13', url: 'https://github.com/dono/repo/pull/13', title: 'Nova tela', author: 'caio', motivo: 'outra_conta', quem: ['davi'], detalhe: { fonte: 'label' } },
  { key: 'dono/repo#14', url: 'https://github.com/dono/repo/pull/14', title: 'Ajuste', author: 'ana', motivo: 'decisao_de_gente', detalhe: {} },
];

function Tela({ itens, controle }: { itens: readonly PrDeFora[]; controle: ControleDeAcoes }) {
  const painel = usePainelDeFora();
  return (
    <>
      <PilulaDeFora n={itens.length} aoAbrir={painel.abrir} aberto={painel.aberto} />
      <p>conteúdo</p>
      <BotaoDeFora n={itens.length} aoAbrir={painel.abrir} aberto={painel.aberto} />
      <PainelDeFora itens={itens} aberto={painel.aberto} aoFechar={painel.fechar} controle={controle} />
    </>
  );
}

function montar(itens: readonly PrDeFora[] = ITENS) {
  const { controle, disparar } = controleFalso();
  const { rerender } = render(<Tela itens={itens} controle={controle} />);
  // o snapshot novo, com outra lista de PRs de fora
  const trocar = (novos: readonly PrDeFora[]) => rerender(<Tela itens={novos} controle={controle} />);
  return { disparar, trocar };
}

const flutuante = () => screen.getByRole('button', { name: /^De fora da fila/ });
const pilula = () => screen.getByRole('button', { name: /de fora da fila, ver os PRs/ });
const painel = () => screen.getByRole('dialog', { name: 'De fora com justificativa' });

describe('De fora da fila: o botão e a pílula', () => {
  it('com zero PRs de fora, nem o botão nem a pílula aparecem, e o painel não existe', () => {
    montar([]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('o botão flutuante tem o rótulo do desenho e o número; a pílula, o número', () => {
    montar();
    expect(flutuante().textContent).toContain('De fora da fila');
    expect(flutuante().textContent).toContain('Ver os PRs e o motivo de cada um');
    expect(flutuante().textContent).toContain('3');
    expect(flutuante().getAttribute('aria-haspopup')).toBe('dialog');
    expect(pilula().textContent).toContain('3');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('De fora da fila: o painel', () => {
  it('abre pelo botão, com o foco no fechar, e fecha no X devolvendo o foco ao botão', () => {
    montar();
    fireEvent.click(flutuante());
    expect(painel().getAttribute('aria-modal')).toBe('true');
    const fechar = within(painel()).getByRole('button', { name: 'Fechar o painel e voltar à fila' });
    expect(document.activeElement).toBe(fechar);
    expect(flutuante().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(fechar);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(flutuante());
  });

  it('fecha no Esc e devolve o foco a quem abriu (a pílula)', () => {
    montar();
    fireEvent.click(pilula());
    fireEvent.keyDown(painel(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(pilula());
  });

  it('prende o foco: Tab no último volta ao primeiro, e Shift+Tab no primeiro vai ao último', () => {
    montar();
    fireEvent.click(flutuante());
    const focaveis = [...painel().querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
    const primeiro = focaveis[0] as HTMLElement;
    const ultimo = focaveis[focaveis.length - 1] as HTMLElement;
    ultimo.focus();
    fireEvent.keyDown(painel(), { key: 'Tab' });
    expect(document.activeElement).toBe(primeiro);
    fireEvent.keyDown(painel(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it('diz quantos PRs ficaram de fora e que o Revisar funciona em todos', () => {
    montar();
    fireEvent.click(flutuante());
    expect(within(painel()).getByText('3 PRs que o Farol deixou de revisar sozinho. Não contam na fila. O Revisar continua funcionando em todos.')).toBeTruthy();
  });

  it('cada cartão abre com o motivo em destaque, o que aconteceu e quando volta', () => {
    montar();
    fireEvent.click(flutuante());
    const [primeiro, segundo] = within(painel()).getAllByRole('article');
    expect(within(primeiro as HTMLElement).getByText('bia aprovou este commit')).toBeTruthy();
    expect(within(primeiro as HTMLElement).getByText('bia aprovou o head 30438ba. O Farol não revisa por cima.')).toBeTruthy();
    expect(within(primeiro as HTMLElement).getByText('Volta à fila no próximo commit.')).toBeTruthy();
    expect(within(primeiro as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Corrige o cálculo');
    expect(within(segundo as HTMLElement).getByText('Outra conta está revisando')).toBeTruthy();
  });

  it('os filtros por motivo, com a contagem; o escolhido fica pressionado e corta a lista', () => {
    montar();
    fireEvent.click(flutuante());
    const filtros = within(painel()).getByRole('group', { name: 'Filtrar por motivo' });
    expect(within(filtros).getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos 3', 'Outra conta revisando 1', 'Revisado por gente 2']);
    expect(within(filtros).getByRole('button', { name: /^Todos/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(filtros).getByRole('button', { name: /^Revisado por gente/ }));
    expect(within(filtros).getByRole('button', { name: /^Revisado por gente/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(painel()).getAllByRole('article').map((a) => within(a).getByRole('heading', { level: 3 }).textContent)).toEqual(['Corrige o cálculo', 'Ajuste']);
  });

  it('Revisar mesmo assim manda o mesmo pedido do Revisar de hoje, pela URL do PR', () => {
    const { disparar } = montar();
    fireEvent.click(flutuante());
    const primeiro = within(painel()).getAllByRole('article')[0] as HTMLElement;
    expect(nomes(within(primeiro).getAllByRole('button'))).toEqual(['Revisar mesmo assim PR #12 de dono/repo']);
    fireEvent.click(within(primeiro).getByRole('button', { name: 'Revisar mesmo assim PR #12 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12', mesmoAssim: true, alvo: 'dono/repo#12', nome: 'PR #12 de dono/repo' });
  });

  it('o ignorado tem Restaurar, o mesmo da seção Ignorados, além do Revisar mesmo assim', () => {
    const ignorado: PrDeFora = { key: 'dono/repo#20', url: 'https://github.com/dono/repo/pull/20', title: 'Ignorado', motivo: 'ignorado', detalhe: {} };
    const { disparar } = montar([ignorado]);
    fireEvent.click(flutuante());
    const cartao = within(painel()).getByRole('article');
    expect(nomes(within(cartao).getAllByRole('button'))).toEqual(['Restaurar PR #20 de dono/repo', 'Revisar mesmo assim PR #20 de dono/repo']);
    fireEvent.click(within(cartao).getByRole('button', { name: 'Restaurar PR #20 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'restaurar', chave: 'dono/repo#20', alvo: 'dono/repo#20', nome: 'PR #20 de dono/repo' });
  });

  it('o resultado das ações aparece dentro do painel, no modal', () => {
    const { controle } = controleFalso();
    render(<PainelDeFora itens={ITENS} aberto aoFechar={() => {}} controle={controle} resultado={<div role="status">Erro: recusado</div>} />);
    expect(within(painel()).getByRole('status').textContent).toBe('Erro: recusado');
  });
});

describe('De fora da fila: o foco quando o cartão sai', () => {
  const revisar = (n: number) => within(painel()).getByRole('button', { name: `Revisar mesmo assim PR #${n} de dono/repo` });

  it('o cartão com o foco saiu (o PR foi para a revisão): o foco vai ao cartão seguinte', () => {
    const { trocar } = montar();
    fireEvent.click(flutuante());
    revisar(12).focus();
    trocar(ITENS.slice(1));
    const primeiro = within(painel()).getAllByRole('article')[0] as HTMLElement;
    expect(document.activeElement).not.toBe(document.body);
    expect(primeiro.contains(document.activeElement)).toBe(true);
    expect(within(primeiro).getByRole('heading', { level: 3 }).textContent).toBe('Nova tela');
  });

  it('o último cartão saiu: o foco vai ao que ficou por último', () => {
    const { trocar } = montar();
    fireEvent.click(flutuante());
    revisar(14).focus();
    trocar(ITENS.slice(0, 2));
    const cartoes = within(painel()).getAllByRole('article');
    expect((cartoes[cartoes.length - 1] as HTMLElement).contains(document.activeElement)).toBe(true);
  });

  it('a lista esvaziou: o foco vai ao X', () => {
    const { trocar } = montar(ITENS.slice(0, 1));
    fireEvent.click(flutuante());
    revisar(12).focus();
    trocar([]);
    expect(document.activeElement).toBe(within(painel()).getByRole('button', { name: 'Fechar o painel e voltar à fila' }));
  });

  it('o foco fora dos cartões não muda quando a lista muda', () => {
    const { trocar } = montar();
    fireEvent.click(flutuante());
    const filtroTodos = within(painel()).getByRole('button', { name: /^Todos/ });
    revisar(12).focus();
    filtroTodos.focus();
    trocar(ITENS.slice(1));
    expect(document.activeElement).toBe(filtroTodos);
  });
});
