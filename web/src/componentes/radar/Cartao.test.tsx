// @vitest-environment jsdom
// O avatar do cartão: a foto do GitHub do autor, e as iniciais quando a foto não serve.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Cartao';

afterEach(cleanup);

describe('avatar do autor', () => {
  it('a foto do servidor de avatares do GitHub, decorativa, com tamanho fixo, carga tardia e sem referer', () => {
    const { container } = render(<Avatar login="thiago-prado" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://avatars.githubusercontent.com/thiago-prado?s=72');
    expect(img.getAttribute('alt')).toBe('');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['36', '36']);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('a foto que falha cai nas iniciais', () => {
    const { container } = render(<Avatar login="thiago-prado" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('TP').getAttribute('aria-hidden')).toBe('true');
  });

  it('login de bot, ou sem login, fica nas iniciais, sem pedido de imagem', () => {
    const { container, rerender } = render(<Avatar login="dependabot[bot]" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('DE')).toBeTruthy();
    rerender(<Avatar login={undefined} />);
    expect(screen.getByText('?')).toBeTruthy();
  });
});
