// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, EstadoDoApp } from '@/estado/app';
import { ESTADO_INICIAL } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { Snapshot } from '@/contratos/snapshot';
import { Casca } from './Casca';
import { textoDaQueda } from './FaixaDeQueda';

vi.mock('next/navigation', () => ({ usePathname: () => '/radar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

function appFalso(entrouAgora: boolean) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao: 'conectado', entrouAgora });
  const sair = vi.fn(async () => null);
  const tentarReconectar = vi.fn();
  return { app: { store, sair, tentarReconectar } as unknown as App, sair, store, tentarReconectar };
}

describe('casca', () => {
  it('quem acabou de parear tem o foco levado ao conteúdo principal', () => {
    const { app } = appFalso(true);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    const conteudo = screen.getByRole('main');
    expect(conteudo.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(conteudo);
  });

  it('quem abriu a página já pareado não tem o foco mexido', () => {
    const { app } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    expect(document.activeElement).toBe(document.body);
  });

  it('mostra as cinco abas, marca a atual e o Sair chama a sessão', () => {
    const { app, sair } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    expect(screen.getAllByRole('link').filter((a) => a.closest('nav'))).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Radar' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(sair).toHaveBeenCalledTimes(1);
  });

  it('enquanto o motor revoga a sessão o botão diz Saindo, fica desabilitado e a região viva avisa', () => {
    const { app, sair, store } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    expect(screen.queryByText(/^Saindo:/)).toBeNull();
    act(() => { store.trocar({ saindo: true }); });
    const botao = screen.getByRole('button', { name: 'Saindo…' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(screen.getByText('Saindo: pedindo ao motor que revogue a sessão deste navegador.').getAttribute('role')).toBe('status');
    fireEvent.click(botao);
    expect(sair).not.toHaveBeenCalled();
  });

  it('com a sessão do portão, diz de onde vem a sessão, e o Sair segue chamando a sessão', () => {
    const { app, sair, store } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    expect(screen.queryByText('Sessão do login da frente')).toBeNull();
    act(() => { store.trocar({ viaPortao: true }); });
    expect(screen.getByText('Sessão do login da frente')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(sair).toHaveBeenCalledTimes(1);
    act(() => { store.trocar({ saindo: true }); });
    expect(screen.getByText('Saindo: encerrando o login da frente.').getAttribute('role')).toBe('status');
  });

  it('a conexão que cai com a tela desenhada ganha a faixa: desde quando, o último estado e a próxima tentativa', () => {
    const { app, store, tentarReconectar } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    expect(screen.queryByText(/^Sem motor:/)).toBeNull();
    const queda = new Date(2026, 10, 17, 14, 21, 0).getTime();
    act(() => { store.trocar({ snapshot: {} as Snapshot, conexao: 'reconectando', quedaEm: queda, proximaTentativaEm: queda + 6000 }); });
    const faixa = screen.getByText(/^Sem motor:/);
    expect(faixa.textContent).toBe('Sem motor: a conexão caiu às 14:21. O que está na tela é do último estado recebido. A próxima tentativa sai às 14:21:06.');
    expect(faixa.closest('[role="status"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar agora' }));
    expect(tentarReconectar).toHaveBeenCalledTimes(1);
    act(() => { store.trocar({ proximaTentativaEm: null }); });
    expect(screen.getByText(/Tentando de novo agora\.$/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Tentando/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { store.trocar({ conexao: 'conectado', quedaEm: null, proximaTentativaEm: null }); });
    expect(screen.queryByText(/^Sem motor:/)).toBeNull();
  });

  it('sem estado recebido não há faixa: a tela é a de conexão', () => {
    const { app, store } = appFalso(false);
    render(<Casca app={app}><h1>Radar</h1></Casca>);
    act(() => { store.trocar({ snapshot: null, conexao: 'sem-motor', quedaEm: 1, proximaTentativaEm: 2 }); });
    expect(screen.queryByText(/^Sem motor:/)).toBeNull();
    expect(textoDaQueda(0, null)).toBe('Sem motor: a conexão caiu. O que está na tela é do último estado recebido. Tentando de novo agora.');
  });
});
