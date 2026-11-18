import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SelecaoDeModelo } from '@/contratos/sistema';
import {
  CHAVES_DA_AUTOMACAO, ESFORCOS, NOME_DO_CAMPO_DE_ESFORCO, PARALELO_MAXIMO, PARALELO_MINIMO, aceitaEsforco, automacaoDe, conflitosDaAutomacao, corpoDaAutomacao,
  diferencasDaAutomacao, marcaDaAutomacao, notaDoLimiteTotal, paraleloValido, resumoDaAutomacao, rotuloDoEsforco, rotuloDoModelo, textoDaAutomacao,
  type Automacao,
} from './automacao';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const ANTES: Automacao = { parallelReviews: 1, reviewModel: 'opus', reviewEffort: '' };
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

  it('as três chaves são preferências que a tela edita (ui: true), em lib/settings.js', () => {
    const fonte = raiz('lib/settings.js');
    for (const chave of CHAVES_DA_AUTOMACAO) expect(fonte).toMatch(new RegExp(`\\{ key: '${chave}', def: [^,]+, ui: true`));
  });

  it('cada chave é lida onde a tela diz', () => {
    expect(raiz('lib/engine/headless-fila.js')).toContain('parallelReviews');
    expect(raiz('lib/engine/session.js')).toMatch(/--model \$\{model\}[\s\S]*--effort \$\{effort\}/);
  });
});

describe('automacaoDe', () => {
  it('lê as três chaves, e sem alguma delas não há de onde partir', () => {
    expect(automacaoDe({ ...ANTES, parallelReviews: 2 })).toEqual({ ...ANTES, parallelReviews: 2 });
    expect(automacaoDe({ parallelReviews: 1, reviewModel: 'opus' })).toBeNull();
    // a espera do CI não é lida: o motor pode mandá-la, e ela não entra no formulário
    expect(automacaoDe({ ...ANTES, aguardarCiParaAprovar: true })).toEqual(ANTES);
    expect(automacaoDe(undefined)).toBeNull();
  });
});

describe('corpoDaAutomacao: só as chaves que mudaram', () => {
  it('sem edição o corpo é vazio', () => {
    expect(corpoDaAutomacao(ANTES, { ...ANTES })).toEqual({});
  });

  it('uma chave editada vai sozinha, e nenhuma outra chave de config entra', () => {
    expect(corpoDaAutomacao(ANTES, { ...ANTES, reviewEffort: 'high' })).toEqual({ reviewEffort: 'high' });
    expect(corpoDaAutomacao(ANTES, { ...ANTES, reviewModel: 'sonnet', parallelReviews: 3 })).toEqual({ parallelReviews: 3, reviewModel: 'sonnet' });
    // voltar ao padrão do Claude Code é mandar o texto vazio
    expect(corpoDaAutomacao(ANTES, { ...ANTES, reviewModel: '' })).toEqual({ reviewModel: '' });
  });
});

describe('a espera do CI saiu da tela (o revisor nunca espera)', () => {
  it('não é chave da automação, e nenhum fonte da tela Sistema a manda nem a lê', () => {
    expect([...CHAVES_DA_AUTOMACAO]).toEqual(['parallelReviews', 'reviewModel', 'reviewEffort']);
    const pastas = [path.resolve(import.meta.dirname), path.resolve(import.meta.dirname, '../componentes/sistema')];
    const fontes = pastas.flatMap((pasta) => fs.readdirSync(pasta).filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)).map((nome) => [nome, fs.readFileSync(path.join(pasta, nome), 'utf8')] as const));
    expect(fontes.length).toBeGreaterThan(10);
    expect(fontes.filter(([, fonte]) => fonte.includes('aguardarCiParaAprovar')).map(([nome]) => nome)).toEqual([]);
  });

  it('o motor também não espera o CI: a chave saiu da tabela e não tem leitor (17/11/2026)', () => {
    expect(raiz('lib/settings.js')).not.toMatch(/key: 'aguardarCiParaAprovar'/);
    expect(raiz('lib/engine/gate-espera.js')).not.toContain('config.aguardarCiParaAprovar === true');
  });
});

describe('chave que os dois mexeram', () => {
  it('é dita com os dois valores, só enquanto diferem', () => {
    expect(conflitosDaAutomacao(['reviewModel', 'parallelReviews'], { ...ANTES, reviewModel: 'sonnet', parallelReviews: 2 }, { ...ANTES, reviewModel: '', parallelReviews: 2 })).toEqual([
      'modelo: no motor agora está "sonnet", e no seu formulário, "padrão do Claude Code". Salvar grava o seu.',
    ]);
    expect(conflitosDaAutomacao([], ANTES, { ...ANTES, reviewModel: 'auto' })).toEqual([]);
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
    expect(diferencasDaAutomacao({ reviewEffort: 'high' }, {})).toEqual(['esforço (effort) ficou sem valor na resposta, e o pedido era high']);
  });
});

describe('textos', () => {
  it('o pedido numa frase', () => {
    expect(textoDaAutomacao({ reviewModel: '', reviewEffort: 'high', parallelReviews: 2 })).toBe('revisões ao mesmo tempo: 2; modelo: padrão do Claude Code; esforço (effort): high');
  });

  it('o resumo da linha: paralelismo e o nome do modelo no catálogo', () => {
    expect(resumoDaAutomacao(ANTES, SELECOES)).toBe('1 ao mesmo tempo, Opus');
    expect(resumoDaAutomacao({ ...ANTES, reviewModel: 'claude-opus-5-5', parallelReviews: 3 }, SELECOES)).toBe('3 ao mesmo tempo, claude-opus-5-5');
    expect(resumoDaAutomacao({ ...ANTES, reviewModel: '' }, [])).toBe('1 ao mesmo tempo, padrão do Claude Code');
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

  it('o campo de esforço traz o termo oficial, e o modelo aceita nome completo só pelo arquivo', () => {
    expect(NOME_DO_CAMPO_DE_ESFORCO).toBe('Esforço (effort) da revisão');
    // a escotilha do nome completo, no motor
    expect(raiz('lib/parse.js')).toContain('const MODEL_FULL_RE = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;');
  });

  it('o paralelismo válido e a nota do limite total', () => {
    expect([0, 1, 4, 5, 2.5].map(paraleloValido)).toEqual([false, true, true, false, false]);
    expect(notaDoLimiteTotal(0)).toBeNull();
    expect(notaDoLimiteTotal(undefined)).toBeNull();
    expect(notaDoLimiteTotal(1)).toContain('1 sessão');
    expect(notaDoLimiteTotal(3)).toContain('3 sessões');
  });

  it('a marca muda com qualquer chave', () => {
    expect(marcaDaAutomacao(ANTES)).toBe(marcaDaAutomacao({ ...ANTES }));
    expect(marcaDaAutomacao({ ...ANTES, reviewEffort: 'low' })).not.toBe(marcaDaAutomacao(ANTES));
  });
});
