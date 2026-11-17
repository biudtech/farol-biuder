// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@/estado/app';
import { PortaoExpirado } from './PortaoExpirado';

afterEach(cleanup);

describe('sessão do portão expirada', () => {
  it('diz o que houve e o botão Entrar de novo chama a sessão, sem recarregar sozinho', () => {
    const entrarDeNovo = vi.fn();
    render(<PortaoExpirado app={{ entrarDeNovo } as unknown as App} />);
    expect(screen.getByRole('alert').textContent).toMatch(/login da frente acabou/);
    expect(entrarDeNovo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar de novo' }));
    expect(entrarDeNovo).toHaveBeenCalledTimes(1);
  });
});
