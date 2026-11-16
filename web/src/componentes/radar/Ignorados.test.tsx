// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Ignorados } from './Ignorados';
import { controleFalso } from './apoio-de-teste';

afterEach(cleanup);

describe('bloco Ignorados', () => {
  it('vazio diz que só mostra o que for ignorado nesta aba', () => {
    const { controle } = controleFalso();
    render(<Ignorados ignorados={[]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados (0)' })).toBeTruthy();
    expect(screen.getByText(/Nenhum PR ignorado nesta aba\. O motor não manda a lista/)).toBeTruthy();
  });

  it('cada ignorado tem o Restaurar com o alvo no nome', () => {
    const { controle, disparar } = controleFalso();
    render(<Ignorados ignorados={[{ chave: 'dono/repo#12', nome: 'PR #12 de dono/repo' }]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('dono/repo#12');
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar PR #12 de dono/repo' }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'restaurar', chave: 'dono/repo#12', alvo: 'dono/repo#12', nome: 'PR #12 de dono/repo' });
  });

  it('com o Restaurar no ar o botão fica desabilitado', () => {
    const { controle } = controleFalso({ 'dono/repo#12': 'restaurar' });
    render(<Ignorados ignorados={[{ chave: 'dono/repo#12', nome: 'PR #12 de dono/repo' }]} controle={controle} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
