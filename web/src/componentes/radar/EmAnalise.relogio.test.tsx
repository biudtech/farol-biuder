// @vitest-environment jsdom
// O relógio de 1 s do cartão da sessão mora só na faixa: o cabeçalho, o avatar e as pílulas não
// redesenham a cada segundo. Os espiões contam os desenhos de cada pedaço.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cartao from '@/radar/cartao';
import { EmAnalise } from './EmAnalise';
import { URL_DO_PR, controleFalso } from './apoio-de-teste';

vi.mock('@/radar/cartao', async (importar) => {
  const real = await importar<typeof import('@/radar/cartao')>();
  return {
    ...real,
    pilulasDaSessao: vi.fn(real.pilulasDaSessao), // só o corpo do cartão
    iniciais: vi.fn(real.iniciais), // só o avatar
    andamentoDaSessao: vi.fn(real.andamentoDaSessao), // só a faixa
  };
});

const INICIO = Date.UTC(2026, 10, 16, 14, 32);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(INICIO + 18000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('o relógio do cartão da sessão', () => {
  it('a cada segundo só a faixa redesenha: o tempo anda, o cabeçalho, o avatar e as pílulas ficam', () => {
    const { controle } = controleFalso();
    render(
      <EmAnalise
        // login fora da forma de login: o avatar fica nas iniciais, que o espião conta
        sessoes={[{ id: 'a1', startedAt: INICIO, cancellable: true, pr: { key: 'dono/repo#12', url: URL_DO_PR, title: 'T', author: 'bot[bot]' } }]}
        feeds={{}}
        controle={controle}
      />,
    );
    const corpo = vi.mocked(cartao.pilulasDaSessao).mock.calls.length;
    const avatar = vi.mocked(cartao.iniciais).mock.calls.length;
    const faixa = vi.mocked(cartao.andamentoDaSessao).mock.calls.length;
    expect(screen.getByText('18 s')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('23 s')).toBeTruthy();
    expect(vi.mocked(cartao.pilulasDaSessao).mock.calls.length).toBe(corpo);
    expect(vi.mocked(cartao.iniciais).mock.calls.length).toBe(avatar);
    expect(vi.mocked(cartao.andamentoDaSessao).mock.calls.length).toBeGreaterThan(faixa);
  });
});
