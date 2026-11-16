import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SelecaoDeModelo } from '@/contratos/sistema';
import {
  CHAVES_DA_AUTOMACAO, ESFORCOS, PARALELO_MAXIMO, PARALELO_MINIMO, aceitaEsforco, ampliacoesDaAutomacao, automacaoDe, corpoDaAutomacao,
  diferencasDaAutomacao, efeitoDoCi, marcaDaAutomacao, notaDoTetoTotal, paraleloValido, rotuloDoEsforco, rotuloDoModelo, textoDaAutomacao,
  type Automacao,
} from './automacao';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const ANTES: Automacao = { aguardarCiParaAprovar: true, parallelReviews: 1, reviewModel: 'opus', reviewEffort: '' };
const SELECOES: SelecaoDeModelo[] = [
  { valor: '', rotulo: 'Padrão do Claude', aceitaEsforco: true },
  { valor: 'auto', rotulo: 'Auto (qualidade primeiro)', auto: true, aceitaEsforco: false },
  { valor: 'opus', rotulo: 'Opus', aceitaEsforco: true },
];

describe('os valores permitidos são os do motor', () => {
  it('os níveis de esforço são EFFORT_LEVELS, em lib/parse.js', () => {
    const lista = /const EFFORT_LEVELS = \[([^\]]*)\]/.exec(raiz('lib/parse.js'));
    expect([...(lista?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...ESFORCOS]);
  });

  it('a faixa do paralelismo é a de sanitizeParallelReviews, em lib/parse.js', () => {
    const funcao = /function sanitizeParallelReviews\(v\) \{[\s\S]*?return Math\.min\((\d+), Math\.max\((\d+), n\)\);/.exec(raiz('lib/parse.js'));
    expect(funcao).not.toBeNull();
    expect([Number(funcao?.[2]), Number(funcao?.[1])]).toEqual([PARALELO_MINIMO, PARALELO_MAXIMO]);
  });

  it('as quatro chaves são preferências que a tela edita (ui: true), em lib/settings.js', () => {
    const fonte = raiz('lib/settings.js');
    for (const chave of CHAVES_DA_AUTOMACAO) expect(fonte).toMatch(new RegExp(`\\{ key: '${chave}', def: [^,]+, ui: true`));
  });

  it('cada chave é lida onde a tela diz', () => {
    expect(raiz('lib/engine/gate-espera.js')).toContain('config.aguardarCiParaAprovar === true');
    expect(raiz('lib/engine/headless-fila.js')).toContain('parallelReviews');
    expect(raiz('lib/engine/session.js')).toMatch(/--model \$\{model\}[\s\S]*--effort \$\{effort\}/);
  });
});

describe('automacaoDe', () => {
  it('lê as quatro chaves, e sem alguma delas não há de onde partir', () => {
    expect(automacaoDe({ ...ANTES, parallelReviews: 2 })).toEqual({ ...ANTES, parallelReviews: 2 });
    expect(automacaoDe({ aguardarCiParaAprovar: true, parallelReviews: 1, reviewModel: 'opus' })).toBeNull();
    expect(automacaoDe(undefined)).toBeNull();
  });
});

describe('corpoDaAutomacao: só as chaves que mudaram', () => {
  it('sem edição o corpo é vazio', () => {
    expect(corpoDaAutomacao(ANTES, { ...ANTES })).toEqual({});
  });

  it('uma chave editada vai sozinha, e nenhuma outra chave de config entra', () => {
    expect(corpoDaAutomacao(ANTES, { ...ANTES, reviewEffort: 'high' })).toEqual({ reviewEffort: 'high' });
    expect(corpoDaAutomacao(ANTES, { ...ANTES, aguardarCiParaAprovar: false, parallelReviews: 3 })).toEqual({ aguardarCiParaAprovar: false, parallelReviews: 3 });
    // voltar ao padrão do Claude Code é mandar o texto vazio
    expect(corpoDaAutomacao(ANTES, { ...ANTES, reviewModel: '' })).toEqual({ reviewModel: '' });
  });
});

describe('o que amplia a publicação', () => {
  it('só desligar o CI antes de aprovar', () => {
    const ampliacoes = ampliacoesDaAutomacao(ANTES, { aguardarCiParaAprovar: false });
    expect(ampliacoes).toHaveLength(1);
    expect(ampliacoes[0]).toContain('CI vermelho');
    expect(ampliacoesDaAutomacao({ ...ANTES, aguardarCiParaAprovar: false }, { aguardarCiParaAprovar: true })).toEqual([]);
    expect(ampliacoesDaAutomacao({ ...ANTES, aguardarCiParaAprovar: false }, { aguardarCiParaAprovar: false })).toEqual([]);
    expect(ampliacoesDaAutomacao(ANTES, { parallelReviews: 4, reviewModel: 'auto', reviewEffort: 'xhigh' })).toEqual([]);
  });
});

describe('a conferência do que voltou', () => {
  it('igual ao pedido não tem diferença', () => {
    expect(diferencasDaAutomacao({ parallelReviews: 3, reviewModel: '' }, { parallelReviews: 3, reviewModel: '', reviewEffort: 'high' })).toEqual([]);
  });

  it('o que o motor manteve ou ajustou aparece com o que ficou', () => {
    expect(diferencasDaAutomacao({ reviewModel: 'haiku', parallelReviews: 9 }, { reviewModel: 'opus', parallelReviews: 4 })).toEqual([
      'revisões ao mesmo tempo ficou 4, e o pedido era 9',
      'modelo ficou opus, e o pedido era haiku',
    ]);
    expect(diferencasDaAutomacao({ aguardarCiParaAprovar: false }, {})).toEqual(['CI antes de aprovar ficou sem valor na resposta, e o pedido era desligado']);
  });
});

describe('textos', () => {
  it('o pedido numa frase', () => {
    expect(textoDaAutomacao({ aguardarCiParaAprovar: true, reviewModel: '', reviewEffort: 'high', parallelReviews: 2 })).toBe('CI antes de aprovar: ligado; revisões ao mesmo tempo: 2; modelo: padrão do Claude Code; esforço: high');
  });

  it('o efeito do CI muda com o valor, e o desligado diz o risco', () => {
    expect(efeitoDoCi(true)).toContain('espera os checks obrigatórios');
    expect(efeitoDoCi(false)).toContain('CI vermelho');
  });

  it('o rótulo do modelo é o do catálogo do motor; valor fixado no arquivo é dito', () => {
    expect(rotuloDoModelo(SELECOES, 'opus')).toBe('Opus');
    expect(rotuloDoModelo(SELECOES, '')).toBe('Padrão do Claude');
    expect(rotuloDoModelo(SELECOES, 'claude-opus-5-5')).toBe('claude-opus-5-5 (fixado no arquivo de configuração; não está no catálogo)');
    expect(rotuloDoModelo([], '')).toBe('Padrão do Claude Code');
  });

  it('o esforço só não vale para a seleção que o catálogo diz que não aceita', () => {
    expect(aceitaEsforco(SELECOES, 'auto')).toBe(false);
    expect(aceitaEsforco(SELECOES, 'opus')).toBe(true);
    expect(aceitaEsforco(SELECOES, 'claude-opus-5-5')).toBe(true);
    expect(rotuloDoEsforco('')).toBe('Padrão do Claude Code (não manda a flag)');
    expect(rotuloDoEsforco('xhigh')).toBe('Muito alto (xhigh)');
    expect(rotuloDoEsforco('max')).toBe('max (valor que esta tela não conhece)');
  });

  it('o paralelismo válido e a nota do teto total', () => {
    expect([0, 1, 4, 5, 2.5].map(paraleloValido)).toEqual([false, true, true, false, false]);
    expect(notaDoTetoTotal(0)).toBeNull();
    expect(notaDoTetoTotal(undefined)).toBeNull();
    expect(notaDoTetoTotal(1)).toContain('1 sessão');
    expect(notaDoTetoTotal(3)).toContain('3 sessões');
  });

  it('a marca muda com qualquer chave', () => {
    expect(marcaDaAutomacao(ANTES)).toBe(marcaDaAutomacao({ ...ANTES }));
    expect(marcaDaAutomacao({ ...ANTES, reviewEffort: 'low' })).not.toBe(marcaDaAutomacao(ANTES));
  });
});
