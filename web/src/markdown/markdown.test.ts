import { describe, expect, it } from 'vitest';
import {
  TETO_DA_URL, TETO_DE_ENFASE, TETO_DE_PROFUNDIDADE, TETO_DE_TEXTO, lerMarkdown, linkSeguro, type Bloco, type Trecho,
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

  const temLink = (nos: readonly (Bloco | Trecho)[]): boolean => nos.some((no) => no.t === 'link' || (no.t === 'lista' ? no.itens.some(temLink) : 'f' in no && temLink(no.f)));

  it('endereço solto acima do teto não vira link para um pedaço dele: fica texto inteiro', () => {
    const longo = `https://exemplo.com/${'a'.repeat(TETO_DA_URL)}/https://outro.com/fim`;
    const arvore = blocos(`veja ${longo} aqui`);
    expect(temLink(arvore)).toBe(false);
    expect(arvore).toEqual([paragrafo(txt(`veja ${longo} aqui`))]);
    // no limite exato ainda é link
    const justo = `https://exemplo.com/${'a'.repeat(TETO_DA_URL - 20)}`;
    expect(justo.length).toBe(TETO_DA_URL);
    expect(temLink(blocos(justo))).toBe(true);
  });

  it('link com colchete cujo endereço passa do teto fica texto, sem link para um pedaço', () => {
    const entrada = `[t](https://exemplo.com/${'a'.repeat(2600)})`;
    const arvore = blocos(entrada);
    expect(temLink(arvore)).toBe(false);
    expect(plano(arvore).trim()).toBe(entrada);
  });

  it('endereço que encosta no fim de um texto cortado não vira link', () => {
    // o corte cai dentro do host: sem a regra, sairia um link para "https://banco.exe"
    const antes = 'x'.repeat(TETO_DE_TEXTO - 18);
    const lido = lerMarkdown(`${antes} https://banco.exemplo.com/entrar depois`);
    expect(lido.cortado).toBe(true);
    expect(temLink(lido.blocos)).toBe(false);
    expect(plano(lido.blocos).trimEnd().endsWith(' https://banco.exe')).toBe(true);
    // dentro de colchete também
    const comColchete = lerMarkdown(`${'x'.repeat(TETO_DE_TEXTO - 22)} [t](https://banco.exemplo.com/entrar) depois`);
    expect(comColchete.cortado).toBe(true);
    expect(temLink(comColchete.blocos)).toBe(false);
    // o endereço que terminou antes do corte continua link
    const inteiro = lerMarkdown(`https://exemplo.com/a ${'x'.repeat(TETO_DE_TEXTO)}`);
    expect(inteiro.cortado).toBe(true);
    expect(temLink(inteiro.blocos)).toBe(true);
  });

  it('o corte não parte um par substituto', () => {
    const lido = lerMarkdown(`${'a'.repeat(TETO_DE_TEXTO - 1)}😀resto`);
    expect(lido.cortado).toBe(true);
    const visivel = plano(lido.blocos).trimEnd();
    expect(visivel.length).toBe(TETO_DE_TEXTO - 1);
    expect(/[\uD800-\uDBFF]$/.test(visivel)).toBe(false);
  });

  it('o teto vale depois da expansão das tabulações', () => {
    const lido = lerMarkdown('\t'.repeat(TETO_DE_TEXTO / 2));
    expect(lido.cortado).toBe(true);
    const comTexto = lerMarkdown(`${'\ta'.repeat(TETO_DE_TEXTO / 2)}`);
    expect(comTexto.cortado).toBe(true);
    expect(plano(comTexto.blocos).length).toBeLessThanOrEqual(TETO_DE_TEXTO + 1);
    // quatro espaços por tabulação: 20.000 tabulações e 20.000 letras cabem
    expect(lerMarkdown('\ta'.repeat(20_000)).cortado).toBe(false);
  });

  it('imagem aparece como o texto que é, sem link nem para o endereço dela', () => {
    for (const entrada of ['![i](https://exemplo.com/a.png)', 'antes ![](https://exemplo.com/a.png "t") depois', '![a **b**](https://exemplo.com/x)']) {
      const arvore = blocos(entrada);
      expect(temLink(arvore), entrada).toBe(false);
      expect(arvore).toEqual([paragrafo(txt(entrada))]);
    }
  });

  it('arroba na autoridade, controle de direção e host disfarçado não passam', () => {
    for (const ruim of [
      'https://@evil.com', 'https://:@evil.com', 'https://good.com@evil.com/x', 'https://good.com:443@evil.com',
      'https://exemplo.com/‮gpj.exe', 'https://exemplo.com/⁦a⁩', 'https://‭exemplo.com',
    ]) {
      expect(linkSeguro(ruim), JSON.stringify(ruim)).toBeNull();
      expect(temLink(blocos(`veja ${ruim} e [x](${ruim})`)), JSON.stringify(ruim)).toBe(false);
    }
    // arroba depois da autoridade é caminho, e passa
    expect(linkSeguro('https://exemplo.com/@dono/repo')).toBe('https://exemplo.com/@dono/repo');
  });

  it('no endereço solto o texto visível é o endereço normalizado, que é para onde o link vai', () => {
    // o ponto ideográfico vira ponto comum no host: quem lê vê o host de verdade
    const arvore = blocos('abra https://good.com。evil.com/x agora');
    expect(arvore).toEqual([paragrafo(
      txt('abra '), { t: 'link', href: 'https://good.com.evil.com/x', f: [txt('https://good.com.evil.com/x')] }, txt(' agora'),
    )]);
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

  // Cada entrada abaixo custaria tempo quadrático num leitor ingênuo. O teste mede a leitura
  // e exige um teto folgado: a leitura de 100 kB leva milissegundos, e um leitor quadrático
  // leva dezenas de segundos. As entradas de 100 kB cabem inteiras no teto; as de 200 kB
  // conferem que o corte vem antes do trabalho.
  const PRAZO_MS = 1500;
  const cheio = (pedaco: string): string => pedaco.repeat(Math.floor(TETO_DE_TEXTO / pedaco.length));
  it.each([
    ['marcas de negrito sem fecho válido', cheio('**a ')],
    ['asteriscos soltos', cheio('*a ')],
    ['sublinhados', cheio('_a_ ')],
    ['ênfase que abre e nunca fecha colada', cheio('*a* *')],
    ['crases de tamanhos diferentes', Array.from({ length: 400 }, (_, i) => '`'.repeat(i + 1)).join(' a ')],
    ['crases simples sem par', cheio('` a')],
    ['colchetes abertos', cheio('[')],
    ['colchetes com parêntese sem fim', cheio('[a](')],
    ['imagens sem fim', cheio('![a](')],
    ['título com cerquilhas no fim', `# a${cheio(' #').slice(0, TETO_DE_TEXTO - 3)}`],
    ['linhas em branco dentro de lista', `- a${'\n'.repeat(TETO_DE_TEXTO - 3)}`],
    ['itens de lista de uma letra', cheio('- a\n')],
    ['citações de uma linha', cheio('> a\n')],
    ['uma linha só', cheio('x')],
    ['marcadores de citação e de lista misturados', cheio('> - ')],
    ['endereços soltos', cheio('https://a.b/ ')],
    ['um endereço solto sem fim', `https://a.b/${cheio('a').slice(12)}`],
    ['endereços colados acima do teto', cheio('https://a.b/')],
    ['barras invertidas', cheio('\\')],
    ['cercas de código abertas e fechadas', cheio('```\na\n```\n')],
    ['200 kB de colchetes, que o corte reduz', '['.repeat(200_000)],
    ['200 kB numa linha só, que o corte reduz', 'x'.repeat(200_000)],
  ])('não trava com %s', (_nome, entrada) => {
    const inicio = performance.now();
    const lido = lerMarkdown(entrada);
    const gasto = performance.now() - inicio;
    expect(Array.isArray(lido.blocos)).toBe(true);
    expect(lido.cortado).toBe(entrada.length > TETO_DE_TEXTO);
    expect(gasto, `levou ${Math.round(gasto)} ms`).toBeLessThan(PRAZO_MS);
  });
});
