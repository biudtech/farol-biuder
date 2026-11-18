// @vitest-environment jsdom
// O que cada mudança do snapshot redesenha. As seções são `memo` e a tela lê cada chave por
// um seletor próprio: a linha nova de um feed não pode custar a fila nem as postadas.
// Mudou com o redesenho de 17/11/2026: o espião das pendências (textoDoParecer, de "Precisa de
// você") saiu com a mesa, e entrou o de "Postadas hoje" (postadasDeHoje). Com o cartão de
// 18/11/2026 o feed saiu do Radar, e o espião da sessão passou a ser o andamento do cartão dela.
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import * as cartao from '@/radar/cartao';
import * as formato from '@/radar/formato';
import * as postadas from '@/radar/postadas';
import { aplicarAtividade } from '@/transporte/estado';
import { Radar } from './Radar';
import { pendencia } from './apoio-de-teste';

// Espiões sobre funções que só uma seção chama ao desenhar: cada chamada é um desenho dela.
vi.mock('@/radar/formato', async (importar) => {
  const real = await importar<typeof import('@/radar/formato')>();
  return {
    ...real,
    textoDoEstacionado: vi.fn(real.textoDoEstacionado), // só a Fila
  };
});
vi.mock('@/radar/cartao', async (importar) => {
  const real = await importar<typeof import('@/radar/cartao')>();
  return { ...real, andamentoDaSessao: vi.fn(real.andamentoDaSessao) }; // só o cartão de uma sessão
});
vi.mock('@/radar/postadas', async (importar) => {
  const real = await importar<typeof import('@/radar/postadas')>();
  return { ...real, postadasDeHoje: vi.fn(real.postadasDeHoje) }; // só Postadas hoje
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

const linha = (t: number) => ({ t, k: 'tool', text: `linha ${t}` });

function estado(): Snapshot {
  return {
    status: 'idle',
    account: { user: 'revisora', tokenOk: true },
    lastCheckAt: 1,
    queue: [{ key: 'dono/fila#1', url: 'https://github.com/dono/fila/pull/1' }],
    parked: { 'dono/fila#1': { at: '', motivo: 'timeout', tipo: 'falha' } },
    activeSessions: [{ id: 'a1', label: 'Sessão um', cancellable: true }, { id: 'a2', label: 'Sessão dois', cancellable: true }],
    activity: { a1: [linha(1)], a2: [linha(1)] },
    headlessWaitingPrs: [],
    decisions: { pending: [pendencia()], resolved: [], ilegiveis: 0 },
  };
}

function montar() {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot: estado() });
  const app = { store, cliente: { post: vi.fn(), get: vi.fn(() => new Promise(() => {})) }, dispensarRecados: vi.fn() } as unknown as App;
  render(<Radar app={app} />);
  return store;
}

describe('o que uma linha de feed redesenha', () => {
  it('só o feed da sessão dela: a fila, as postadas e a outra sessão ficam como estavam', () => {
    const store = montar();
    const daFila = vi.mocked(formato.textoDoEstacionado);
    const dasPostadas = vi.mocked(postadas.postadasDeHoje);
    const dosFeeds = vi.mocked(cartao.andamentoDaSessao);
    expect(daFila).toHaveBeenCalledTimes(1);
    expect(dasPostadas).toHaveBeenCalledTimes(1);
    expect(dosFeeds).toHaveBeenCalledTimes(2);

    act(() => { store.trocar({ snapshot: aplicarAtividade(store.ler().snapshot, { id: 'a1', item: linha(2) }, () => {}) }); });
    expect(daFila).toHaveBeenCalledTimes(1);
    expect(dasPostadas).toHaveBeenCalledTimes(1);
    // o cartão da sessão a1 de novo (o último evento dela mudou); o da a2 não
    expect(dosFeeds).toHaveBeenCalledTimes(3);
  });

  it('um aviso do motor não redesenha seção nenhuma', () => {
    const store = montar();
    const chamadas = () => [formato.textoDoEstacionado, postadas.postadasDeHoje, cartao.andamentoDaSessao].map((f) => vi.mocked(f).mock.calls.length);
    const antes = chamadas();
    act(() => { store.trocar({ recados: [{ n: 1, tom: 'ok', texto: 'aprovado' }] }); });
    expect(screen.getByText('aprovado')).toBeTruthy();
    expect(chamadas()).toEqual(antes);
  });
});
