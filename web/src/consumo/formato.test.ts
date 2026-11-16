import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  casasDoPasso, diaCurto, diaPorExtenso, dolar, dolarDoEixo, inteiro, participacao, rotuloDoDesfecho, rotuloDoModelo, rotuloDoTipo, textoDoCusto, tokens, urlDoPr,
} from './formato';
import { escalaDoEixo } from './grafico';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const lista = (texto: string, padrao: RegExp): string[] => [...(padrao.exec(texto)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);

describe('números em pt-BR, com a unidade dita', () => {
  it('inteiro com ponto de milhar', () => {
    expect(inteiro(0)).toBe('0');
    expect(inteiro(1234567)).toBe('1.234.567');
    expect(inteiro(undefined)).toBe('sem dado');
  });

  it('dólar com duas casas e vírgula, e o que arredondaria para zero diz que é menos de um centavo', () => {
    expect(dolar(0)).toBe('US$ 0,00');
    expect(dolar(1234.5)).toBe('US$ 1.234,50');
    expect(dolar(0.004)).toBe('menos de US$ 0,01');
    expect(dolar(0.005)).toBe('US$ 0,01');
    expect(dolar(undefined)).toBe('sem dado');
  });

  it('a marca do eixo tem as casas que o passo pede, e nunca menos de duas', () => {
    expect(dolarDoEixo(2.5, 2.5)).toBe('US$ 2,50');
    expect(dolarDoEixo(1500, 500)).toBe('US$ 1.500,00');
    expect(dolarDoEixo(0, 0.001)).toBe('US$ 0,000');
    expect(dolarDoEixo(0.003, 0.001)).toBe('US$ 0,003');
    expect(casasDoPasso(500)).toBe(2);
    expect(casasDoPasso(0.25)).toBe(2);
    expect(casasDoPasso(0.025)).toBe(3);
    expect(casasDoPasso(0.00025)).toBe(5);
  });

  it('passo 0,025: o rótulo não arredonda a marca (0,075 não vira 0,08)', () => {
    const { marcas } = escalaDoEixo(0.09);
    expect(marcas).toEqual([0, 0.025, 0.05, 0.075, 0.1]);
    expect(marcas.map((marca) => dolarDoEixo(marca, 0.025))).toEqual(['US$ 0,000', 'US$ 0,025', 'US$ 0,050', 'US$ 0,075', 'US$ 0,100']);
  });

  it('em toda escala, cada rótulo lido de volta é a marca, e não há dois rótulos iguais', () => {
    const lido = (rotulo: string): number => Number(rotulo.replace('US$ ', '').replaceAll('.', '').replace(',', '.'));
    let escalas = 0;
    // de um milésimo de dólar a dez mil, em passos multiplicativos, com três mantissas
    for (let base = 0.001; base <= 10000; base *= 1.07) {
      for (const maximo of [base, base * 1.31, Number(base.toPrecision(2))]) {
        const { marcas } = escalaDoEixo(maximo);
        const passo = marcas[1] as number;
        const rotulos = marcas.map((marca) => dolarDoEixo(marca, passo));
        expect(rotulos.map(lido), `máximo ${maximo}`).toEqual(marcas);
        expect(new Set(rotulos).size, `máximo ${maximo}`).toBe(rotulos.length);
        escalas += 1;
      }
    }
    expect(escalas).toBeGreaterThan(600);
  });

  it('passo que não é número positivo cai em duas casas, e passo de poeira não lança', () => {
    for (const passo of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(dolarDoEixo(1, passo), String(passo)).toBe('US$ 1,00');
    expect(casasDoPasso(Number.MIN_VALUE)).toBe(12);
    expect(dolarDoEixo(0, Number.MIN_VALUE)).toBe('US$ 0,000000000000');
    expect(dolarDoEixo(Number.NaN, 1)).toBe('valor inválido');
  });

  it('valor negativo, infinito ou que não é número diz que é inválido, em vez de virar "US$ NaN"', () => {
    for (const torto of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.001]) {
      expect(dolar(torto), String(torto)).toBe('valor inválido');
      expect(tokens(torto), String(torto)).toBe('valor inválido');
      expect(inteiro(torto), String(torto)).toBe('valor inválido');
    }
    expect(textoDoCusto({ costUsd: Number.NaN })).toBe('valor inválido');
  });

  it('valor fracionário onde se espera inteiro aparece como veio, sem arredondar calado', () => {
    expect(tokens(1.5)).toBe('1,5 tokens');
    expect(tokens(1234.25)).toBe('1.234,25 tokens');
    expect(inteiro(2.5)).toBe('2,5');
    expect(inteiro(0.4)).toBe('0,4');
  });

  it('valor enorme não lança', () => {
    expect(dolar(1e21)).toMatch(/^US\$ 1\.000\./);
    expect(tokens(Number.MAX_SAFE_INTEGER)).toBe('9.007.199.254.740.991 tokens');
    expect(dolar(Number.MAX_VALUE)).toMatch(/^US\$ /);
  });

  it('tokens no singular e no plural', () => {
    expect(tokens(1)).toBe('1 token');
    expect(tokens(12500)).toBe('12.500 tokens');
    expect(tokens(undefined)).toBe('sem dado');
  });

  it('participação: só quando há parte e todo maior que zero', () => {
    expect(participacao(1, 4)).toBe('25%');
    expect(participacao(1, 3)).toBe('33,3%');
    expect(participacao(0, 3)).toBe('0%');
    expect(participacao(1, 0)).toBe('');
    expect(participacao(undefined, 3)).toBe('');
    expect(participacao(1, undefined)).toBe('');
  });

  it('participação acima de 100% aparece como veio, e valor que não serve não vira percentual', () => {
    expect(participacao(3, 2)).toBe('150%');
    expect(participacao(10, 1)).toBe('1.000%');
    for (const [parte, todo] of [[Number.NaN, 1], [1, Number.NaN], [-1, 2], [1, -2], [Number.POSITIVE_INFINITY, 1], [1, Number.POSITIVE_INFINITY]] as const) {
      expect(participacao(parte, todo), `${parte}/${todo}`).toBe('');
    }
  });
});

describe('o dia é o que o motor mandou', () => {
  it('troca a ordem do texto, sem passar por fuso', () => {
    expect(diaPorExtenso('2026-11-16')).toBe('16/11/2026');
    expect(diaPorExtenso('2026-01-01')).toBe('01/01/2026');
    expect(diaCurto('2026-11-16')).toBe('16/11');
  });

  it('o que não é dia aparece como veio', () => {
    expect(diaPorExtenso('ontem')).toBe('ontem');
    expect(diaCurto('')).toBe('');
  });
});

describe('rótulos', () => {
  it('todo tipo que o motor registra tem rótulo, e o desconhecido aparece cru', () => {
    const doDiario = lista(fonte('lib/usage/activity.js'), /export const ACTIVITY_KINDS = \[([^\]]*)\]/);
    expect(doDiario.length).toBeGreaterThanOrEqual(5);
    for (const tipo of doDiario) expect(rotuloDoTipo(tipo), tipo).not.toBe(tipo);
    expect(rotuloDoTipo('review')).toBe('Revisão');
    expect(rotuloDoTipo('tipo_novo')).toBe('tipo_novo');
    expect(rotuloDoTipo('constructor')).toBe('constructor');
    expect(rotuloDoTipo(undefined)).toBe('Tipo não informado');
  });

  it('todo desfecho que o motor grava tem rótulo', () => {
    const doMotor = lista(fonte('lib/engine/usage-desfechos.js'), /const DESFECHOS = \[([^\]]*)\]/);
    const doDiario = lista(fonte('lib/usage/activity.js'), /const STATES = \[([^\]]*)\]/);
    expect(doMotor.length).toBeGreaterThanOrEqual(6);
    for (const desfecho of [...doMotor, ...doDiario, 'desconhecido']) expect(rotuloDoDesfecho(desfecho), desfecho).not.toBe(desfecho);
    expect(rotuloDoDesfecho('ok')).toBe('Concluída');
    expect(rotuloDoDesfecho('novo')).toBe('novo');
    expect(rotuloDoDesfecho(undefined)).toBe('Não informado');
  });

  it('modelo ausente ou "desconhecido" diz que não foi informado', () => {
    expect(rotuloDoModelo('Sonnet 5')).toBe('Sonnet 5');
    expect(rotuloDoModelo('desconhecido')).toBe('Modelo não informado');
    expect(rotuloDoModelo(undefined)).toBe('Modelo não informado');
  });
});

describe('o custo conforme a origem', () => {
  it('informado pela sessão, calculado pelo motor, desconhecido e origem nova', () => {
    expect(textoDoCusto({ costUsd: 1.5, costSource: 'medido' })).toBe('US$ 1,50');
    expect(textoDoCusto({ costUsd: 1.5 })).toBe('US$ 1,50');
    expect(textoDoCusto({ costUsd: 0.25, costSource: 'estimado' })).toBe('US$ 0,25 (calculado pelo motor)');
    // desconhecido não mostra o zero que o motor grava
    expect(textoDoCusto({ costUsd: 0, costSource: 'desconhecido' })).toBe('Desconhecido');
    expect(textoDoCusto({ costUsd: 0, costSource: 'sem-base' })).toBe('Desconhecido');
    expect(textoDoCusto({ costUsd: 2, costSource: 'nova' })).toBe('US$ 2,00 (origem "nova")');
    expect(textoDoCusto({})).toBe('sem dado');
  });

  it('as origens são as que o motor grava', () => {
    const registro = fonte('lib/engine/usage.js');
    expect(registro).toContain("let costSource = desconhecido && !parcial ? 'desconhecido' : 'medido';");
    expect(registro).toContain("return { costUsd: taxa * Number(outputTokens), source: 'estimado' };");
    expect(fonte('lib/engine/usage-desfechos.js')).toContain("const ORIGENS_DESCONHECIDAS = new Set(['desconhecido', 'sem-base']);");
  });
});

describe('o endereço do PR', () => {
  it('sai da chave dono/repo#n, sempre no GitHub por HTTPS', () => {
    expect(urlDoPr('dono/repo#12')).toBe('https://github.com/dono/repo/pull/12');
    expect(urlDoPr('Dono-1/repo.js#7')).toBe('https://github.com/Dono-1/repo.js/pull/7');
  });

  it('referência de outro formato não vira endereço', () => {
    for (const ref of [undefined, '', 'chat com ana', 'dono/repo', 'dono/repo#', 'dono/repo#1x', 'a/b/c#1', 'dono/re po#1', 'https://evil.example/a/b#1', 'dono/repo#1?x', '../x#1', 'dono/..#1', 'dono/.#1', '-dono/repo#1', 'javascript:alert(1)//a/b#1']) {
      expect(urlDoPr(ref), String(ref)).toBeUndefined();
    }
  });
});
