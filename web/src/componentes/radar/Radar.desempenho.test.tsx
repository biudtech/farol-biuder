// @vitest-environment jsdom
// O que cada mudança do snapshot redesenha. Os blocos são `memo` e a tela lê cada chave por
// um seletor próprio: a linha nova de um feed não pode custar a fila nem as pendências.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import * as formato from '@/radar/formato';
import { aplicarAtividade } from '@/transporte/estado';
import { Radar } from './Radar';
import { pendencia } from './apoio-de-teste';

// Espiões sobre funções que só um bloco chama ao desenhar: cada chamada é um desenho dele.
vi.mock('@/radar/formato', async (importar) => {
  const real = await importar<typeof import('@/radar/formato')>();
  return {
    ...real,
    textoDoEstacionado: vi.fn(real.textoDoEstacionado), // só a Fila
    textoDoParecer: vi.fn(real.textoDoParecer), // só Precisa de você
    chavesDoFeed: vi.fn(real.chavesDoFeed), // só o feed de uma sessão
  };
});

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

describe('o que uma linha de feed redesenha', () => {
  it('só o feed da sessão dela: a fila, as pendências e a outra sessão ficam como estavam', () => {
    const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot: estado() });
    const app = { store, cliente: { post: vi.fn() }, dispensarRecados: vi.fn() } as unknown as App;
    render(<Radar app={app} />);
    const daFila = vi.mocked(formato.textoDoEstacionado);
    const dasPendencias = vi.mocked(formato.textoDoParecer);
    const dosFeeds = vi.mocked(formato.chavesDoFeed);
    expect(daFila).toHaveBeenCalledTimes(1);
    expect(dasPendencias).toHaveBeenCalledTimes(1);
    expect(dosFeeds).toHaveBeenCalledTimes(2);

    act(() => { store.trocar({ snapshot: aplicarAtividade(store.ler().snapshot, { id: 'a1', item: linha(2) }, () => {}) }); });
    expect(screen.getByText('linha 2')).toBeTruthy();
    expect(daFila).toHaveBeenCalledTimes(1);
    expect(dasPendencias).toHaveBeenCalledTimes(1);
    // o feed da sessão a1 de novo; o da a2 não
    expect(dosFeeds).toHaveBeenCalledTimes(3);
  });

  it('um aviso do motor não redesenha bloco nenhum', () => {
    const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot: estado() });
    const app = { store, cliente: { post: vi.fn() }, dispensarRecados: vi.fn() } as unknown as App;
    render(<Radar app={app} />);
    const chamadas = () => [formato.textoDoEstacionado, formato.textoDoParecer, formato.chavesDoFeed].map((f) => vi.mocked(f).mock.calls.length);
    const antes = chamadas();
    act(() => { store.trocar({ recados: [{ n: 1, tom: 'ok', texto: 'aprovado' }] }); });
    expect(screen.getByText('aprovado')).toBeTruthy();
    expect(chamadas()).toEqual(antes);
  });
});
