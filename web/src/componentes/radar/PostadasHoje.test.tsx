// @vitest-environment jsdom
// Postadas hoje no molde do cartão da autoanálise (18/11/2026): a borda pelo que saiu, as pílulas
// com o detalhe de GET /api/decision e a faixa com todas as etapas feitas.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, Resultado } from '@/transporte/cliente';
import { PostadasHoje } from './PostadasHoje';
import { controleFalso } from './apoio-de-teste';

vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

const AGORA = Date.now();
const DIA = 86400000;
const URL = 'https://github.com/dono/repo/pull/12';

function resolvida(extra: Record<string, unknown> = {}) {
  return {
    id: 'd1', key: 'dono/repo#12', resolvedAt: AGORA, status: 'auto_approved', action: 'approve', card: 'BT-7',
    pr: { url: URL, title: 'Corrige o cálculo', author: 'ana' }, stages: { totalMs: 438000, stages: [] }, reportMarkdown: '', reasons: [], attention: [],
    ...extra,
  };
}

// o detalhe que GET /api/decision devolve para a revisão d1
const DETALHE = {
  found: true,
  decision: {
    ...resolvida({ action: 'request_changes' }),
    checks: { conferidoNoHead: true, semExigencia: false, naoVerdes: [], herdados: [{ nome: 'osv', estado: 'vermelho' }] },
    criteriosDoCard: [{ texto: 'a', atende: true }, { texto: 'b', atende: true }, { texto: 'c', atende: false }],
    achados: [{ severidade: 'blocking', titulo: 'Editar falha sempre com o histórico vazio' }, { severidade: 'suggestion', titulo: 'Nome' }],
    rodadasDoPr: { itens: [{ id: 'd0', rodada: 1, publicado: 'approve' }, { id: 'd1', rodada: 3, head: 'abc1234', publicado: 'request_changes' }] },
    tamanhoDoPr: { arquivos: 14, adicoes: 612, remocoes: 148 },
    execucao: { tentativas: 1, modelos: [], duracaoMs: 420000, custoUsd: 2.84 },
  },
};

function clienteCom(respostas: Record<string, unknown>) {
  const get = vi.fn(async (caminho: string, ler: (bruto: unknown) => unknown): Promise<Resultado<unknown>> => {
    const id = new URLSearchParams(caminho.split('?')[1]).get('id') ?? '';
    if (!Object.hasOwn(respostas, id)) return { ok: false, falha: 'rede', status: 0 };
    return { ok: true, dados: ler(respostas[id]) };
  });
  return { get } as unknown as Pick<Cliente, 'get'> & { get: typeof get };
}

const pilulas = (cartao: HTMLElement) => within(within(cartao).getByRole('list', { name: 'Resumo' })).getAllByRole('listitem');
const textos = (cartao: HTMLElement) => pilulas(cartao).map((li) => li.textContent);

describe('seção Postadas hoje', () => {
  it('sem nada hoje, diz numa frase curta, e o cabeçalho leva ao Histórico', () => {
    render(<PostadasHoje resolvidas={[resolvida({ resolvedAt: AGORA - 2 * DIA }), resolvida({ id: 'd2', action: 'skip' })]} agora={AGORA} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Postadas hoje' })).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão postada hoje.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver histórico' }).getAttribute('href')).toBe('/historico');
  });

  it('só as de hoje e publicadas, cada uma com a borda e o parecer do que saiu, dito em texto', () => {
    render(
      <PostadasHoje
        agora={AGORA}
        resolvidas={[
          resolvida(),
          resolvida({ id: 'd2', key: 'dono/repo#13', action: 'request_changes', pr: { title: 'Troca a base' } }),
          resolvida({ id: 'd3', key: 'dono/repo#14', action: 'comment', pr: { title: 'Só comenta' } }),
          resolvida({ id: 'ontem', resolvedAt: AGORA - 2 * DIA }),
          resolvida({ id: 'pulada', action: 'skip', status: 'skipped' }),
        ]}
      />,
    );
    const cartoes = screen.getAllByRole('article');
    expect(cartoes.map((c) => c.getAttribute('data-tom'))).toEqual(['ok', 'falha', 'aviso']);
    expect(cartoes[0]?.getAttribute('aria-label')).toBe('dono/repo#12: Aprovação. Publicado automaticamente.');
    expect(textos(cartoes[0] as HTMLElement)[2]).toBe('✓ParecerAprovado');
    expect(textos(cartoes[1] as HTMLElement)[2]).toBe('✕ParecerPediu mudanças');
    expect(textos(cartoes[2] as HTMLElement)[2]).toBe('!ParecerComentado');
    expect(within(cartoes[0] as HTMLElement).getByText('Revisão postada: aprovada.')).toBeTruthy();
    expect(within(cartoes[1] as HTMLElement).getByText('Revisão postada: pediu mudanças.')).toBeTruthy();
  });

  it('a faixa da postada: todas as etapas feitas, sem trilho, a duração das etapas e Ver resultado', () => {
    render(<PostadasHoje resolvidas={[resolvida()]} agora={AGORA} />);
    const faixa = screen.getByRole('group', { name: 'Andamento da revisão de PR #12 de dono/repo' });
    expect(within(faixa).getAllByRole('listitem').map((li) => li.getAttribute('data-estado'))).toEqual(['feita', 'feita', 'feita', 'feita', 'feita']);
    expect(within(faixa).queryByRole('progressbar')).toBeNull();
    expect(within(faixa).getByText('7 min 18 s')).toBeTruthy();
    expect(within(faixa).getByRole('link', { name: 'Ver resultado de dono/repo#12' }).getAttribute('href')).toBe('/historico?id=d1&pr=dono%2Frepo%2312');
    expect(screen.getByRole('link', { name: /Abrir no GitHub/ }).getAttribute('href')).toBe(URL);
  });

  it('sem o detalhe, as pílulas dos checks e do card dizem o traço com texto neutro, nunca inventado', () => {
    render(<PostadasHoje resolvidas={[resolvida({ card: undefined })]} agora={AGORA} />);
    const cartao = screen.getByRole('article');
    expect(textos(cartao)).toEqual(['\u2013Checks obrigatóriosSem leitura gravada', '\u2013CardSem card', '✓ParecerAprovado']);
    expect(pilulas(cartao).slice(0, 2).every((li) => li.getAttribute('data-tom') === 'neutro')).toBe(true);
  });

  it('com o card e sem os critérios declarados, a pílula diz qual card e que não houve critério', () => {
    render(<PostadasHoje resolvidas={[resolvida()]} agora={AGORA} />);
    expect(textos(screen.getByRole('article'))[1]).toBe('\u2013CardBT-7: critérios não declarados');
  });

  it('com o detalhe de GET /api/decision: checks, critérios, bloqueios, a rodada, o tamanho, o commit e o custo', async () => {
    const cliente = clienteCom({ d1: DETALHE });
    render(<PostadasHoje resolvidas={[resolvida({ action: 'request_changes' })]} cliente={cliente} agora={AGORA} />);
    const cartao = screen.getByRole('article');
    expect(textos(cartao)[0]).toBe('\u2013Checks obrigatóriosCarregando');
    await act(async () => {});
    expect(cliente.get).toHaveBeenCalledTimes(1);
    expect(cliente.get.mock.calls[0]?.[0]).toBe('/api/decision?key=dono%2Frepo%2312&id=d1');
    expect(textos(cartao)).toEqual([
      '✓Checks obrigatóriosVerdes · osv herdado da base',
      '!Card2 de 3 critérios atendidos',
      '✕ParecerPediu mudanças · 1 bloqueio',
    ]);
    expect(within(cartao).getByText(/^3ª rodada · card BT-7 · 14 arquivos, \+612 −148 · postado às \d\d:\d\d$/)).toBeTruthy();
    expect(within(cartao).getByText('Revisão postada: pediu mudanças, Editar falha sempre com o histórico vazio.')).toBeTruthy();
    expect(within(cartao).getByText('commit abc1234 · 7 min · US$ 2,84')).toBeTruthy();
    expect(within(cartao).getByText('7 min 00 s')).toBeTruthy();
  });

  it('a busca do detalhe que falha não se repete e deixa as pílulas sem dado', async () => {
    const cliente = clienteCom({});
    const { rerender } = render(<PostadasHoje resolvidas={[resolvida()]} cliente={cliente} agora={AGORA} />);
    await act(async () => {});
    rerender(<PostadasHoje resolvidas={[resolvida(), resolvida({ id: 'd2', key: 'dono/repo#13' })]} cliente={cliente} agora={AGORA} />);
    await act(async () => {});
    expect(cliente.get.mock.calls.map(([c]) => new URLSearchParams(String(c).split('?')[1]).get('id'))).toEqual(['d1', 'd2']);
    expect(textos(screen.getAllByRole('article')[0] as HTMLElement)[0]).toBe('\u2013Checks obrigatóriosSem leitura gravada');
  });

  it('Revisar de novo manda a URL do PR', () => {
    const { controle, disparar } = controleFalso();
    render(<PostadasHoje resolvidas={[resolvida()]} controle={controle} agora={AGORA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar de novo PR #12 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL, deNovo: true, alvo: 'dono/repo#12', nome: 'PR #12 de dono/repo' });
  });

  it('revisão recente que chegou ilegível vira nota, e a lista diz o resto', () => {
    render(<PostadasHoje resolvidas={[{ key: 'sem-id#1' }]} agora={AGORA} />);
    expect(screen.getByText('1 revisão recente chegou do motor numa forma que esta tela não lê e ficou de fora da lista.')).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão postada hoje.')).toBeTruthy();
  });
});
