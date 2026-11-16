import { describe, expect, it } from 'vitest';
import {
  TETO_DE_ENFASE, TETO_DE_PROFUNDIDADE, TETO_DE_TEXTO, lerMarkdown, linkSeguro, type Bloco, type Trecho,
} from './markdown';

const blocos = (texto: string): Bloco[] => lerMarkdown(texto).blocos;
const txt = (v: string): Trecho => ({ t: 'texto', v });
const paragrafo = (...f: Trecho[]): Bloco => ({ t: 'paragrafo', f });

// O texto visível de uma árvore, para conferir que nada some.
function plano(nos: readonly (Bloco | Trecho)[]): string {
  let saida = '';
  for (const no of nos) {
    if (no.t === 'texto' || no.t === 'codigo') saida += no.v;
    else if (no.t === 'quebra') saida += '\n';
    else if (no.t === 'lista') saida += no.itens.map((item) => plano(item)).join('\n');
    else if (no.t === 'regua') saida += '---';
    else saida += plano(no.f);
    if (no.t === 'paragrafo' || no.t === 'titulo' || no.t === 'citacao') saida += '\n';
  }
  return saida;
}

// A maior profundidade de blocos e de trechos da árvore.
function profundidade(nos: readonly (Bloco | Trecho)[]): number {
  let maior = 0;
  for (const no of nos) {
    let filhos: readonly (Bloco | Trecho)[][] = [];
    if (no.t === 'lista') filhos = no.itens;
    else if ('f' in no) filhos = [no.f];
    for (const f of filhos) maior = Math.max(maior, 1 + profundidade(f));
  }
  return maior;
}

describe('markdown: blocos', () => {
  it('títulos de 1 a 6, com os # do fim tirados', () => {
    expect(blocos('# Um\n###### Seis ##\n####### sete')).toEqual([
      { t: 'titulo', nivel: 1, f: [txt('Um')] },
      { t: 'titulo', nivel: 6, f: [txt('Seis')] },
      paragrafo(txt('####### sete')),
    ]);
  });

  it('parágrafos separados por linha em branco, e a quebra de linha dentro do parágrafo fica', () => {
    expect(blocos('um\ndois\n\n\ntrês')).toEqual([
      paragrafo(txt('um'), { t: 'quebra' }, txt('dois')),
      paragrafo(txt('três')),
    ]);
  });

  it('lista com marcador e lista numerada, com item de várias linhas e lista dentro de lista', () => {
    expect(blocos('- a\n- b\n  - b1\n  - b2\n- c')).toEqual([
      {
        t: 'lista', ordenada: false, itens: [
          [paragrafo(txt('a'))],
          [paragrafo(txt('b')), { t: 'lista', ordenada: false, itens: [[paragrafo(txt('b1'))], [paragrafo(txt('b2'))]] }],
          [paragrafo(txt('c'))],
        ],
      },
    ]);
    expect(blocos('3. três\n4. quatro')).toEqual([
      { t: 'lista', ordenada: true, inicio: 3, itens: [[paragrafo(txt('três'))], [paragrafo(txt('quatro'))]] },
    ]);
  });

  it('a lista acaba no texto sem recuo depois de linha em branco', () => {
    expect(blocos('- a\n\nfim')).toEqual([
      { t: 'lista', ordenada: false, itens: [[paragrafo(txt('a'))]] },
      paragrafo(txt('fim')),
    ]);
  });

  it('citação, com bloco dentro', () => {
    expect(blocos('> dito\n> - item\n\nfora')).toEqual([
      { t: 'citacao', f: [paragrafo(txt('dito')), { t: 'lista', ordenada: false, itens: [[paragrafo(txt('item'))]] }] },
      paragrafo(txt('fora')),
    ]);
  });

  it('bloco de código guarda o texto cru, com a linguagem, e não lê markdown dentro', () => {
    expect(blocos('```ts\nconst a = "**x**";\n<script>\n```\ndepois')).toEqual([
      { t: 'codigo', v: 'const a = "**x**";\n<script>', linguagem: 'ts' },
      paragrafo(txt('depois')),
    ]);
    // cerca sem fecho vai até o fim
    expect(blocos('~~~\na\nb')).toEqual([{ t: 'codigo', v: 'a\nb' }]);
  });

  it('régua', () => {
    expect(blocos('a\n\n---\n\n* * *')).toEqual([paragrafo(txt('a')), { t: 'regua' }, { t: 'regua' }]);
  });

  it('texto vazio ou só de espaço não tem bloco', () => {
    expect(lerMarkdown('')).toEqual({ blocos: [], cortado: false });
    expect(blocos('  \n\n \t')).toEqual([]);
  });
});

describe('markdown: trechos', () => {
  it('negrito, itálico e código em linha', () => {
    expect(blocos('a **forte** e *leve* e __f__ e _l_ e `cod`')).toEqual([paragrafo(
      txt('a '), { t: 'forte', f: [txt('forte')] }, txt(' e '), { t: 'enfase', f: [txt('leve')] }, txt(' e '),
      { t: 'forte', f: [txt('f')] }, txt(' e '), { t: 'enfase', f: [txt('l')] }, txt(' e '), { t: 'codigo', v: 'cod' },
    )]);
  });

  it('sublinhado no meio da palavra é texto, e marca sem par também', () => {
    expect(blocos('usa foo_bar_baz e 2 * 3 * 4 e **solto')).toEqual([paragrafo(txt('usa foo_bar_baz e 2 * 3 * 4 e **solto'))]);
  });

  it('código em linha não lê markdown, e crase dupla guarda crase simples', () => {
    expect(blocos('`**x**` e ``a`b``')).toEqual([paragrafo({ t: 'codigo', v: '**x**' }, txt(' e '), { t: 'codigo', v: 'a`b' })]);
    expect(blocos('`sem fecho')).toEqual([paragrafo(txt('`sem fecho'))]);
  });

  it('barra invertida tira o sentido da pontuação', () => {
    expect(blocos('\\*não\\* \\[x\\]')).toEqual([paragrafo(txt('*não* [x]'))]);
  });

  it('link só https, com o texto lido como markdown', () => {
    expect(blocos('veja [o **doc**](https://exemplo.com/a?b=1) aqui')).toEqual([paragrafo(
      txt('veja '),
      { t: 'link', href: 'https://exemplo.com/a?b=1', f: [txt('o '), { t: 'forte', f: [txt('doc')] }] },
      txt(' aqui'),
    )]);
  });

  it('endereço https solto vira link, sem a pontuação do fim', () => {
    expect(blocos('em https://github.com/dono/repo/pull/1. Fim')).toEqual([paragrafo(
      txt('em '), { t: 'link', href: 'https://github.com/dono/repo/pull/1', f: [txt('https://github.com/dono/repo/pull/1')] }, txt('. Fim'),
    )]);
  });
});

describe('markdown: entrada hostil', () => {
  it('HTML cru é texto', () => {
    const arvore = blocos('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> <b>oi</b>');
    expect(arvore).toEqual([
      paragrafo(txt('<script>alert(1)</script>')),
      paragrafo(txt('<img src=x onerror=alert(1)> <b>oi</b>')),
    ]);
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](http://exemplo.com)',
    '[x](//exemplo.com)',
    '[x](/caminho)',
    '[x](vbscript:msgbox)',
    '[x](https://dono:senha@exemplo.com)',
    '[x]( javascript:alert(1) )',
    '[x](<javascript:alert(1)>)',
    '[x](https:alert(1))',
    '<javascript:alert(1)>',
    '![x](data:image/svg+xml,<svg onload=alert(1)>)',
  ])('%s não vira link, e o texto aparece como foi escrito', (entrada) => {
    const arvore = blocos(entrada);
    const temLink = (nos: readonly (Bloco | Trecho)[]): boolean => nos.some((no) => no.t === 'link' || ('f' in no && temLink(no.f)));
    expect(temLink(arvore)).toBe(false);
    expect(plano(arvore).trim()).toBe(entrada.trim());
  });

  it('aspas não entram no endereço: o link vai só até elas, e o resto é texto', () => {
    expect(blocos('[x](https://exemplo.com/"onmouseover="a)')).toEqual([paragrafo(
      txt('[x]('), { t: 'link', href: 'https://exemplo.com/', f: [txt('https://exemplo.com/')] }, txt('"onmouseover="a)'),
    )]);
  });

  it('linkSeguro só aceita https com host, sem credencial e sem caractere de controle', () => {
    expect(linkSeguro('https://exemplo.com/a')).toBe('https://exemplo.com/a');
    for (const ruim of [
      'http://exemplo.com', 'javascript:alert(1)', 'data:text/html,x', 'https://', 'https:///x', 'HTTPS://exemplo.com',
      'https://a@exemplo.com', 'https://exemplo.com/\u0000', 'https://exemplo.com/ a', ' https://exemplo.com',
      `https://exemplo.com/${'a'.repeat(3000)}`,
    ]) expect(linkSeguro(ruim), ruim).toBeNull();
  });

  it('link dentro do texto de um link não aninha', () => {
    const arvore = blocos('[a https://exemplo.com b](https://outro.com)');
    expect(arvore).toEqual([paragrafo({ t: 'link', href: 'https://outro.com/', f: [txt('a https://exemplo.com b')] })]);
  });

  it('citação aninhada além do teto vira texto, sem estourar a pilha', () => {
    const arvore = blocos(`${'> '.repeat(5000)}fundo`);
    expect(profundidade(arvore)).toBeLessThanOrEqual(TETO_DE_PROFUNDIDADE + 2);
    expect(plano(arvore)).toContain('fundo');
  });

  it('lista aninhada além do teto vira texto, sem estourar a pilha', () => {
    const linhas = Array.from({ length: 200 }, (_, i) => `${' '.repeat(i * 2)}- n${i}`);
    const arvore = blocos(linhas.join('\n'));
    expect(profundidade(arvore)).toBeLessThanOrEqual(2 * TETO_DE_PROFUNDIDADE + 2);
    const visivel = plano(arvore);
    expect(visivel).toContain('n0');
    expect(visivel).toContain('n199');
  });

  it('ênfase aninhada além do teto vira texto', () => {
    const fundo = 40;
    const arvore = blocos(`${'*_'.repeat(fundo)}x${'_*'.repeat(fundo)}`);
    expect(profundidade(arvore)).toBeLessThanOrEqual(TETO_DE_ENFASE + 1);
    expect(plano(arvore)).toContain('x');
  });

  it('200 kB de texto são cortados no teto, e o corte é dito', () => {
    const lido = lerMarkdown('palavra '.repeat(25_000));
    expect(lido.cortado).toBe(true);
    expect(plano(lido.blocos).length).toBeLessThanOrEqual(TETO_DE_TEXTO + 1);
    expect(lerMarkdown('a'.repeat(TETO_DE_TEXTO)).cortado).toBe(false);
  });

  // Cada entrada abaixo custaria tempo quadrático num leitor ingênuo: o teste só termina
  // dentro do prazo do Vitest se a leitura for linear.
  it.each([
    ['marcas de negrito sem fecho válido', '**a '.repeat(50_000)],
    ['asteriscos soltos', '*a '.repeat(66_000)],
    ['sublinhados', '_a_ '.repeat(50_000)],
    ['crases de tamanhos diferentes', Array.from({ length: 600 }, (_, i) => '`'.repeat(i + 1)).join(' a ')],
    ['colchetes abertos', '['.repeat(200_000)],
    ['colchetes com parêntese sem fim', '[a]('.repeat(50_000)],
    ['título com cerquilhas no fim', `# a${' #'.repeat(100_000)}`],
    ['linhas em branco dentro de lista', `- a${'\n'.repeat(200_000)}`],
    ['uma linha só de 200 kB', 'x'.repeat(200_000)],
    ['marcadores de citação e de lista misturados', '> - '.repeat(50_000)],
    ['endereços soltos', 'https://a.b/ '.repeat(16_000)],
    ['barras invertidas', '\\'.repeat(200_000)],
  ])('não trava com %s', (_nome, entrada) => {
    const lido = lerMarkdown(entrada);
    expect(Array.isArray(lido.blocos)).toBe(true);
  });
});
