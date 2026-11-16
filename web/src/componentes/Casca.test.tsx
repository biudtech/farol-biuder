// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, EstadoDoApp } from '@/estado/app';
import { ESTADO_INICIAL } from '@/estado/app';
import { criarStore } from '@/estado/store';
import { Casca } from './Casca';

vi.mock('next/navigation', () => ({ usePathname: () => '/radar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

function appFalso(entrouAgora: boolean) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao: 'conectado', entrouAgora });
  const sair = vi.fn();
  return { app: { store, sair } as unknown as App, sair };
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
});
