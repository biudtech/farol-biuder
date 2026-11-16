import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diaCurto, diaPorExtenso, dolar, dolarDoEixo, inteiro, participacao, rotuloDoDesfecho, rotuloDoModelo, rotuloDoTipo, textoDoCusto, tokens, urlDoPr,
} from './formato';

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

  it('a marca do eixo ganha casas quando o passo é menor que um centavo', () => {
    expect(dolarDoEixo(2.5, 2.5)).toBe('US$ 2,50');
    expect(dolarDoEixo(0, 0.001)).toBe('US$ 0,0000');
    expect(dolarDoEixo(0.003, 0.001)).toBe('US$ 0,0030');
    expect(dolarDoEixo(1500, 500)).toBe('US$ 1.500,00');
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
