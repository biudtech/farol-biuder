// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostadasHoje } from './PostadasHoje';

vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

const AGORA = Date.now();
const DIA = 86400000;

function resolvida(extra: Record<string, unknown> = {}) {
  return {
    id: 'd1', key: 'dono/repo#12', resolvedAt: AGORA, status: 'auto_approved', action: 'approve',
    pr: { url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o cálculo' }, reportMarkdown: '', reasons: [], attention: [],
    ...extra,
  };
}

describe('seção Postadas hoje', () => {
  it('sem nada hoje, diz numa frase curta, e o cabeçalho leva ao Histórico', () => {
    render(<PostadasHoje resolvidas={[resolvida({ resolvedAt: AGORA - 2 * DIA }), resolvida({ id: 'd2', action: 'skip' })]} agora={AGORA} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Postadas hoje' })).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão postada hoje.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver histórico' }).getAttribute('href')).toBe('/historico');
  });

  it('só as de hoje e publicadas, cada uma com a bolinha dita em texto, o título e a hora', () => {
    const { container } = render(
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
    const resumos = [...container.querySelectorAll('summary')];
    expect(resumos).toHaveLength(3);
    expect(resumos.map((r) => r.querySelector('[data-tom]')?.getAttribute('data-tom'))).toEqual(['ok', 'ruim', 'aviso']);
    expect(within(resumos[0] as HTMLElement).getByText('Aprovado:')).toBeTruthy();
    expect(within(resumos[1] as HTMLElement).getByText('Pediu mudanças:')).toBeTruthy();
    expect(within(resumos[2] as HTMLElement).getByText('Comentado:')).toBeTruthy();
    expect(within(resumos[0] as HTMLElement).getByText('Corrige o cálculo')).toBeTruthy();
    expect(within(resumos[0] as HTMLElement).getByText(/^\d{2}:\d{2}$/)).toBeTruthy();
  });

  it('o detalhe abre num clique, com a chave, o desfecho em texto e o link que abre a revisão no Histórico', () => {
    const { container } = render(<PostadasHoje resolvidas={[resolvida()]} agora={AGORA} />);
    const linha = container.querySelector('details') as HTMLDetailsElement;
    fireEvent.click(linha.querySelector('summary') as HTMLElement);
    expect(linha.open).toBe(true);
    expect(within(linha).getByText('dono/repo#12 · Aprovação. Publicado automaticamente.')).toBeTruthy();
    expect(within(linha).getByRole('link', { name: 'Ver a revisão de dono/repo#12' }).getAttribute('href')).toBe('/historico?id=d1&pr=dono%2Frepo%2312');
    expect(within(linha).getByRole('link', { name: /Abrir no GitHub/ }).getAttribute('href')).toBe('https://github.com/dono/repo/pull/12');
  });

  it('revisão recente que chegou ilegível vira nota, e a lista diz o resto', () => {
    render(<PostadasHoje resolvidas={[{ key: 'sem-id#1' }]} agora={AGORA} />);
    expect(screen.getByText('1 revisão recente chegou do motor numa forma que esta tela não lê e ficou de fora da lista.')).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão postada hoje.')).toBeTruthy();
  });
});
