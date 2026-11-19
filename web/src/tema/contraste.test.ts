import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contraste AA (WCAG 2.1) dos pares que a casca e o pareamento usam, lido das variáveis de
// src/app/globals.css nos dois temas. Texto pede 4,5:1; anel de foco e contorno de campo, 3:1.

type Cor = [number, number, number, number];

const CSS = fs.readFileSync(path.resolve(import.meta.dirname, '../app/globals.css'), 'utf8');

function variaveis(seletor: string): Map<string, string> {
  const inicio = CSS.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`bloco ${seletor} não encontrado`);
  const bloco = CSS.slice(inicio, CSS.indexOf('}', inicio));
  return new Map([...bloco.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

function cor(texto: string): Cor {
  const hex = /^#([0-9a-f]{6})$/i.exec(texto);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(texto);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`cor fora do formato esperado: ${texto}`);
}

// cor com transparência pintada sobre um fundo opaco
function sobre(frente: Cor, fundo: Cor): Cor {
  const a = frente[3];
  return [0, 1, 2].map((i) => (frente[i] as number) * a + (fundo[i] as number) * (1 - a)).concat(1) as Cor;
}

function luminancia(c: Cor): number {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: Cor, b: Cor): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

const TEMAS: Array<[string, Map<string, string>]> = [
  ['claro', variaveis(':root')],
  ['escuro', new Map([...variaveis(':root'), ...variaveis(':root[data-theme="dark"]')])],
];

describe.each(TEMAS)('contraste AA no tema %s', (nome, v) => {
  const de = (nome: string) => cor(v.get(nome) as string);
  const fundos = ['--bg', '--surface', '--surface-2'];

  it('texto e texto secundário sobre os três fundos: 4,5:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--text'), de(fundo)), `--text sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(de('--muted'), de(fundo)), `--muted sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('botão primário: 4,5:1', () => {
    expect(contraste(de('--accent-ink'), de('--accent'))).toBeGreaterThanOrEqual(4.5);
  });

  // O botão primário é um bloco de --accent: o que o separa do fundo vizinho (o cartão do
  // pareamento, a página) é a cor dele, e componente de interface pede 3:1 (WCAG 1.4.11).
  it('botão primário contra os três fundos: 3:1, também com o realce do ponteiro', () => {
    // .primario:hover aplica filter: brightness(1.08), que multiplica cada canal
    const realcado = de('--accent').map((v, i) => (i < 3 ? Math.min(255, Math.round(v * 1.08)) : v)) as Cor;
    for (const fundo of fundos) {
      expect(contraste(de('--accent'), de(fundo)), `--accent sobre ${fundo}`).toBeGreaterThanOrEqual(3);
    }
    // com o realce, contra o cartão em que o botão mora
    expect(contraste(realcado, de('--surface')), '--accent realçado sobre --surface').toBeGreaterThanOrEqual(3);
    expect(contraste(de('--accent-ink'), realcado), '--accent-ink sobre --accent realçado').toBeGreaterThanOrEqual(4.5);
  });

  it('texto de estado sobre o fundo suave dele, em cima de cada fundo: 4,5:1', () => {
    for (const estado of ['ok', 'aviso', 'danger', 'neutro', 'info']) {
      for (const fundo of fundos) {
        const suave = sobre(de(`--${estado}-soft`), de(fundo));
        expect(contraste(de(`--${estado}-texto`), suave), `--${estado}-texto sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('link sobre os fundos: 4,5:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--info-texto'), de(fundo)), fundo).toBeGreaterThanOrEqual(4.5);
      expect(contraste(de('--link'), de(fundo)), `--link sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // A aba ativa e o chip da marca: o texto da primária sobre o fundo suave dela.
  it('aba ativa: texto da primária sobre o fundo suave dela, em cima de cada fundo: 4,5:1', () => {
    for (const fundo of fundos) {
      const suave = sobre(cor(v.get('--accent-soft') as string), de(fundo));
      expect(contraste(de('--accent-texto'), suave), `--accent-texto sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // O texto apagado (hora, repositório, resumo da linha) é texto de verdade: 4,5:1.
  it('texto apagado sobre os fundos: 4,5:1', () => {
    for (const fundo of fundos) expect(contraste(de('--apagado'), de(fundo)), `--apagado sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
  });

  // A bolinha de estado é parte gráfica (3:1 contra a superfície da linha); o texto ao lado
  // diz o estado, então a cor só reforça.
  it('bolinha de estado sobre a superfície: 3:1', () => {
    for (const estado of ['--ok', '--aviso', '--danger', '--neutro']) {
      expect(contraste(de(estado), de('--surface')), `${estado} sobre --surface`).toBeGreaterThanOrEqual(estado === '--aviso' || estado === '--neutro' ? 2 : 3);
    }
  });

  // O contorno é o que desenha o botão sem preenchimento (Sair, troca de tema). No tema
  // escuro ele fica com o tom da tela antiga, abaixo de 3:1, por decisão de identidade: a
  // exigência aqui é só do claro.
  it.runIf(nome === 'claro')('contorno de botão sem preenchimento: 3:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--borda-botao'), de(fundo)), `--borda-botao sobre ${fundo}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('o contorno de botão existe nos dois temas', () => {
    expect(v.has('--borda-botao')).toBe(true);
  });

  // O gráfico e as tabelas do Consumo são pintados sobre o cartão (--surface): a barra é
  // --accent, a linha de base do eixo é --borda-campo, os rótulos do eixo e os cabeçalhos são
  // --muted, o texto das células é --text e o período pronto marcado usa --foco no contorno.
  // Parte gráfica pede 3:1 (WCAG 1.4.11); texto, 4,5:1.
  it('gráfico e tabelas do Consumo sobre o cartão: barra, eixo e marca 3:1, rótulo e texto 4,5:1', () => {
    for (const grafica of ['--accent', '--borda-campo', '--foco']) {
      expect(contraste(de(grafica), de('--surface')), `${grafica} sobre --surface`).toBeGreaterThanOrEqual(3);
    }
    for (const texto of ['--muted', '--text', '--info-texto']) {
      expect(contraste(de(texto), de('--surface')), `${texto} sobre --surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // No redesenho (lote 5) as barras horizontais são --accent sobre o trilho --surface-2; a barra
  // do dia escolhido é --text; o nome do repositório é --link e, escolhido, --accent-ink sobre
  // --accent; o período marcado e a pílula são --surface sobre --text; a nota dos números é
  // --apagado.
  it('as barras, os botões que viram filtro e as pílulas do Consumo: 3:1 no gráfico, 4,5:1 no texto', () => {
    expect(contraste(de('--accent'), de('--surface-2')), '--accent sobre --surface-2').toBeGreaterThanOrEqual(3);
    expect(contraste(de('--text'), de('--surface')), '--text sobre --surface').toBeGreaterThanOrEqual(3);
    for (const [texto, fundo] of [['--link', '--surface'], ['--accent-ink', '--accent'], ['--surface', '--text'], ['--apagado', '--surface']] as const) {
      expect(contraste(de(texto), de(fundo)), `${texto} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('anel de foco e contorno de campo: 3:1', () => {
    for (const fundo of fundos) {
      expect(contraste(de('--foco'), de(fundo)), `--foco sobre ${fundo}`).toBeGreaterThanOrEqual(3);
      expect(contraste(de('--borda-campo'), de(fundo)), `--borda-campo sobre ${fundo}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// As cores do Consumo saem só das variáveis conferidas acima: cor escrita à mão no CSS da
// tela escaparia deste teste.
describe('o CSS do Consumo', () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../componentes/consumo/Consumo.module.css'), 'utf8');

  it('não tem cor fora das variáveis de globals.css', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const usadas = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1] as string));
    expect(usadas.size).toBeGreaterThan(0);
    for (const [tema, v] of TEMAS) for (const nome of usadas) expect(v.has(nome), `${nome} no tema ${tema}`).toBe(true);
  });

  it('as barras, os rótulos e os botões que viram filtro usam os pares conferidos', () => {
    expect(css).toContain('.barraDoDia { fill: var(--accent); }');
    expect(css).toContain('.botaoDeBarra[aria-pressed="true"] .barraDoDia { fill: var(--text); }');
    expect(css).toMatch(/\.trilho \{[^}]*background: var\(--surface-2\);/);
    expect(css).toContain('.cheio { fill: var(--accent); }');
    expect(css).toMatch(/\.valorDoDia \{[^}]*color: var\(--muted\);/);
    expect(css).toMatch(/\.nomeClicavel \{[^}]*color: var\(--link\);/);
    expect(css).toContain('.nomeClicavel[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }');
    expect(css).toContain('.periodo[aria-pressed="true"] { background: var(--text); color: var(--surface); font-weight: 800; }');
    expect(css).toMatch(/\.tirar \{[^}]*background: var\(--text\);\s*color: var\(--surface\);/);
    expect(css).toMatch(/outline: 2px solid var\(--foco\);/);
    expect(css).toMatch(/\.rolagem \{[^}]*background: var\(--surface\);/);
  });
});

// O mesmo para a tela Sistema, que diz o estado de cada verificação com texto sobre o fundo
// suave do estado (os pares de "texto de estado sobre o fundo suave dele", acima).
describe('o CSS do Sistema', () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../componentes/sistema/Sistema.module.css'), 'utf8');

  it('não tem cor fora das variáveis de globals.css', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const usadas = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1] as string));
    expect(usadas.size).toBeGreaterThan(0);
    for (const [tema, v] of TEMAS) for (const nome of usadas) expect(v.has(nome), `${nome} no tema ${tema}`).toBe(true);
  });

  // O estado (verificação, linha, credencial) é dito pelo Chip e pela Bolinha das peças comuns,
  // que já põem o texto de estado sobre o fundo suave dele (ui.module.css); o erro é o de ui.
  // Esta folha não pinta estado: se um dia pintar, o par tem de ser o mesmo da regra de ui.
  it('não pinta cor de estado por conta própria; fundo suave só com o texto de estado dele', () => {
    expect(css).not.toMatch(/var\(--(ok|aviso|danger|neutro)(-texto)?\)/);
    for (const regra of css.match(/\{[^}]*\}/g) ?? []) {
      const fundo = /background: var\(--(\w+)-soft\)/.exec(regra)?.[1];
      if (fundo) expect(regra).toContain(`color: var(--${fundo}-texto)`);
    }
  });
});

// O cartão de um PR no Radar: o texto do rodapé da faixa vai na cor do estado direto sobre o
// cartão (--surface), e as pílulas e o marcador da etapa põem o texto do estado sobre o fundo
// suave dele (o par conferido acima). O trilho e o spinner são parte gráfica (--accent, 3:1).
describe.each(TEMAS)('o cartão do Radar no tema %s', (_nome, v) => {
  const de = (nome: string) => cor(v.get(nome) as string);

  it('texto de estado direto sobre o cartão: 4,5:1', () => {
    for (const estado of ['--ok-texto', '--aviso-texto', '--danger-texto', '--accent-texto', '--apagado', '--muted', '--text']) {
      expect(contraste(de(estado), de('--surface')), `${estado} sobre --surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o trilho e o spinner da etapa contra o trilho vazio e o cartão: 3:1', () => {
    expect(contraste(de('--accent'), de('--surface-2')), '--accent sobre --surface-2').toBeGreaterThanOrEqual(3);
    expect(contraste(de('--accent'), de('--surface')), '--accent sobre --surface').toBeGreaterThanOrEqual(3);
  });
});

// O CSS do Radar, do cartão único (src/componentes/cartao), do painel De fora da fila e das telas
// que usam o cartão.
const CSS_DO_RADAR = [
  'componentes/radar/Radar.module.css', 'componentes/cartao/Cartao.module.css', 'componentes/radar/DeFora.module.css',
  // o Histórico e o Time no cartão único (redesenho, lote 4)
  'componentes/historico/Historico.module.css', 'componentes/time/Time.module.css',
];

describe.each(CSS_DO_RADAR)('o CSS de %s', (arquivo) => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '..', arquivo), 'utf8');

  it('não tem cor fora das variáveis de globals.css', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const usadas = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1] as string));
    expect(usadas.size).toBeGreaterThan(0);
    for (const [tema, v] of TEMAS) for (const nome of usadas) expect(v.has(nome), `${nome} no tema ${tema}`).toBe(true);
  });

  // texto sobre o fundo suave de um estado é sempre o texto daquele estado
  it('fundo suave de estado só com o texto do mesmo estado', () => {
    for (const regra of css.match(/\{[^}]*\}/g) ?? []) {
      const fundo = /background: var\(--(ok|aviso|danger|accent|neutro)-soft\)/.exec(regra)?.[1];
      if (fundo && /color:/.test(regra)) expect(regra).toContain(`color: var(--${fundo}-texto)`);
    }
  });
});

describe('o cartão único', () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../componentes/cartao/Cartao.module.css'), 'utf8');

  it('o pulso da etapa e a barra indefinida param com movimento reduzido', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.giro, \.corre \{ animation: none; \}/);
  });
});
