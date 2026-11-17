// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Ignorados } from './Ignorados';
import { controleFalso } from './apoio-de-teste';

afterEach(cleanup);

describe('seção Ignorados', () => {
  it('sem nada ignorado nesta aba, a seção não aparece', () => {
    const { controle } = controleFalso();
    const { container } = render(<Ignorados ignorados={[]} controle={controle} />);
    expect(container.textContent).toBe('');
  });

  it('cada ignorado tem o Restaurar com o alvo no nome, e a seção diz que é só desta aba', () => {
    const { controle, disparar } = controleFalso();
    render(<Ignorados ignorados={[{ chave: 'dono/repo#12', nome: 'PR #12 de dono/repo' }]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados' })).toBeTruthy();
    expect(screen.getByText(/Só o que foi ignorado nesta aba/)).toBeTruthy();
    expect(screen.getByText('dono/repo#12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar PR #12 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'restaurar', chave: 'dono/repo#12', alvo: 'dono/repo#12', nome: 'PR #12 de dono/repo' });
  });

  it('com o Restaurar no ar o botão fica desabilitado', () => {
    const { controle } = controleFalso({ 'dono/repo#12': 'restaurar' });
    render(<Ignorados ignorados={[{ chave: 'dono/repo#12', nome: 'PR #12 de dono/repo' }]} controle={controle} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
