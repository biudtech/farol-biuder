// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TETO_DE_TEXTO } from '@/markdown/markdown';
import { Markdown } from './Markdown';

afterEach(cleanup);

describe('componente Markdown', () => {
  it('desenha título, parágrafo, listas, citação, código, negrito, itálico e régua', () => {
    const texto = [
      '# Resumo', '', 'Um **ponto** e um *detalhe* com `codigo`.', '', '- a', '- b', '', '1. um', '2. dois', '',
      '> citado', '', '```ts', 'const a = 1;', '```', '', '---',
    ].join('\n');
    const { container } = render(<Markdown texto={texto} />);
    expect(screen.getByRole('heading', { level: 4, name: 'Resumo' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('ponto');
    expect(container.querySelector('em')?.textContent).toBe('detalhe');
    expect(container.querySelector('p code')?.textContent).toBe('codigo');
    expect([...container.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    expect([...container.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['um', 'dois']);
    expect(container.querySelector('blockquote')?.textContent).toBe('citado');
    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(container.querySelector('pre')?.getAttribute('data-linguagem')).toBe('ts');
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('o nível do título parte do nível pedido e não passa de 6', () => {
    render(<Markdown texto={'# um\n\n## dois\n\n###### seis'} nivelBase={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'um' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'dois' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 6, name: 'seis' })).toBeTruthy();
  });

  it('link https abre em outra aba, sem referência; os outros esquemas ficam como texto', () => {
    const { container } = render(<Markdown texto={'[doc](https://exemplo.com/a) [x](javascript:alert(1)) [y](data:text/html,oi) [z](http://exemplo.com)'} />);
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://exemplo.com/a');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(container.textContent).toContain('[x](javascript:alert(1))');
    expect(container.textContent).toContain('[y](data:text/html,oi)');
    expect(container.textContent).toContain('[z](http://exemplo.com)');
  });

  it('HTML cru aparece como texto: nenhum elemento nasce do review', () => {
    const hostil = '<script>window.x = 1</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">oi</a>\n\n<iframe src="https://exemplo.com"></iframe>';
    const { container } = render(<Markdown texto={hostil} />);
    for (const seletor of ['script', 'img', 'iframe', '[onerror]', '[style]', 'a[href^="javascript"]']) expect(container.querySelector(seletor), seletor).toBeNull();
    expect(container.textContent).toContain('<script>window.x = 1</script>');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('<a href="javascript:alert(1)">oi</a>');
  });

  it('nenhum atributo de evento nem de estilo sai do texto, por mais que ele tente', () => {
    const { container } = render(<Markdown texto={'[a](https://exemplo.com/" onclick="alert(1)) **<b onmouseover=x>**\n\n```" onload="x\ncodigo\n```'} />);
    for (const elemento of container.querySelectorAll('*')) {
      for (const atributo of elemento.getAttributeNames()) expect(['class', 'href', 'target', 'rel', 'role', 'start', 'data-linguagem']).toContain(atributo);
    }
    for (const link of container.querySelectorAll('a')) expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(container.querySelector('pre')?.getAttribute('data-linguagem')).toBeNull();
  });

  it('texto acima do teto é cortado, e o corte é dito', () => {
    render(<Markdown texto={'palavra '.repeat(25_000)} />);
    expect(screen.getByRole('note').textContent).toBe(`O texto passa de ${TETO_DE_TEXTO.toLocaleString('pt-BR')} caracteres e foi cortado aqui.`);
  });

  it('aninhamento profundo é desenhado sem estourar', () => {
    const { container } = render(<Markdown texto={`${'> '.repeat(3000)}fundo\n\n${'*_'.repeat(200)}x${'_*'.repeat(200)}`} />);
    expect(container.querySelectorAll('blockquote').length).toBeLessThanOrEqual(6);
    expect(container.textContent).toContain('fundo');
  });

  it('texto vazio não desenha nada', () => {
    const { container } = render(<Markdown texto="" />);
    expect(container.textContent).toBe('');
  });
});
