import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ErroDaAba from './error';
import ErroGlobal from './global-error';
import NaoEncontrada from './not-found';

vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

// As três páginas de aviso são do front, e não as embutidas do Next: as embutidas usam o
// atributo style, que a CSP de produção bloqueia, e falam inglês.
const paginas: Array<[string, string]> = [
  ['not-found', renderToStaticMarkup(<NaoEncontrada />)],
  ['error', renderToStaticMarkup(<ErroDaAba error={new Error('segredo interno')} retry={() => {}} />)],
  ['global-error', renderToStaticMarkup(<ErroGlobal error={new Error('segredo interno')} retry={() => {}} />)],
];

describe.each(paginas)('página %s', (nome, html) => {
  it('não usa atributo style nem estilo em linha', () => {
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('<style');
  });

  it('usa classe para o estilo', () => {
    expect(html).toMatch(/class="[^"]+"/);
  });

  it('está em português e não repete o texto embutido do Next', () => {
    expect(html).not.toMatch(/could not be found|Not Found|Something went wrong|Application error|Try again/i);
    expect(html).toMatch(nome === 'not-found' ? /Página não encontrada/ : /Algo deu errado/);
  });

  it('tem um título de nível 1 e uma saída', () => {
    expect(html).toMatch(/<h1[ >]/);
    expect(html).toMatch(nome === 'not-found' ? /<a [^>]*href="\/radar"/ : /<button [^>]*type="button"/);
  });

  it('não mostra a mensagem do erro', () => {
    expect(html).not.toContain('segredo interno');
  });
});

describe('página global-error', () => {
  it('desenha o documento inteiro, em pt-BR', () => {
    const html = paginas[2]?.[1] ?? '';
    expect(html).toMatch(/^<html lang="pt-BR"/);
    expect(html).toContain('<body');
  });
});

it('a página não encontrada leva o 404 acima do título, fora do que o leitor de tela lê', () => {
  const html = renderToStaticMarkup(<NaoEncontrada />);
  expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>404<\/p><h1/);
});
