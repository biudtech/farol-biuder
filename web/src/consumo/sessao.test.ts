import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigDoMotor } from '@/contratos/time';
import type { PerfisDoClaude } from '@/contratos/sistema';
import { duracao, fracao, rotuloDoGatilho, tokensCurtos } from './formato';
import { perfisDoPlano } from './plano';
import { barrasDasEtapas, partesDosTokens, somaDosTokens, textoDasTentativas } from './sessao';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

describe('os rótulos e os números curtos', () => {
  it('o gatilho com o nome da tela, e o que a tela não conhece aparece cru', () => {
    expect(['primeira', 'commit_novo', 'rodada_extra', 'contestacao', '', undefined, 'novo'].map(rotuloDoGatilho)).toEqual([
      'Primeira revisão', 'Revisão de commit novo', 'Rodada extra no mesmo commit', 'Contestação do autor', 'Conversa ou ferramenta', 'Gatilho não informado', 'novo',
    ]);
    // os quatro valores que o motor grava
    const gatilhos = fonte('lib/engine/gatilho-da-sessao.js');
    for (const nome of ['primeira', 'commit_novo', 'rodada_extra', 'contestacao']) expect(gatilhos, nome).toContain(`'${nome}'`);
  });

  it('tokens em mil e mi, e a duração em s, min e h', () => {
    expect([950, 1200, 204_000, 1_234_567].map(tokensCurtos)).toEqual(['950', '1,2 mil', '204 mil', '1,2 mi']);
    expect(tokensCurtos(undefined)).toBe('sem dado');
    expect([0, 42_000, 290_000, 3_900_000].map(duracao)).toEqual(['0 s', '42 s', '4 min 50 s', '1 h 5 min']);
    expect(duracao(undefined)).toBe('sem dado');
    expect(duracao(-1)).toBe('valor inválido');
  });

  it('a fração da barra: parte do maior, de 0 a 100, e o que existe nunca some', () => {
    expect(fracao(5, 10)).toBe(50);
    expect(fracao(0.001, 1000)).toBe(1);
    expect(fracao(0, 10)).toBe(0);
    expect(fracao(undefined, 10)).toBe(0);
    expect(fracao(3, 0)).toBe(0);
    expect(fracao(20, 10)).toBe(100);
  });
});

describe('a linha aberta da sessão', () => {
  const execucao = { inputTokens: 200, outputTokens: 80, thinkingTokens: 40, cacheReadTokens: 600, cacheCreationTokens: 80 };

  it('os tokens por tipo, na ordem do maior, com a fatia de cada um na mesma linha', () => {
    expect(somaDosTokens(execucao)).toBe(1000);
    expect(partesDosTokens(execucao)).toEqual([
      { chave: 'cacheRead', nome: 'Cache lido', valor: 600, fracao: 60 },
      { chave: 'input', nome: 'Entrada', valor: 200, fracao: 20 },
      { chave: 'output', nome: 'Saída', valor: 80, fracao: 8 },
      { chave: 'cacheCreation', nome: 'Cache criado', valor: 80, fracao: 8 },
      { chave: 'thinking', nome: 'Pensamento', valor: 40, fracao: 4 },
    ]);
    // o tipo que o motor não mandou fica de fora, e a linha sem nenhum não tem soma
    expect(partesDosTokens({ inputTokens: 10 }).map((p) => p.nome)).toEqual(['Entrada']);
    expect(somaDosTokens({})).toBeUndefined();
  });

  it('as etapas na ordem do motor, com a barra relativa à mais longa', () => {
    expect(barrasDasEtapas([{ id: 'fontes', label: 'Fontes', ms: 30_000 }, { id: 'codigo', label: 'Código', ms: 120_000 }, { id: 'x' }])).toEqual([
      { id: 'fontes', nome: 'Fontes', tempo: '30 s', fracao: 25 },
      { id: 'codigo', nome: 'Código', tempo: '2 min', fracao: 100 },
      { id: 'x', nome: 'x', tempo: 'sem dado', fracao: 0 },
    ]);
  });

  it('as tentativas dizem quantas e o desfecho de cada uma, sem somar', () => {
    expect(textoDasTentativas([{ status: 'ok' }])).toBe('1');
    expect(textoDasTentativas([{ status: 'parcial' }, { status: 'ok' }])).toBe('2: Parcial (a sessão morreu antes do fim), depois Concluída');
    expect(textoDasTentativas([])).toBe('sem dado');
  });
});

describe('o plano de cada perfil do Claude', () => {
  const config = { claudeProfiles: [{ id: 'a', label: 'Assinatura A', kind: 'dir' }, { id: 'b', kind: 'dir' }, { id: 'k', label: 'Chave', kind: 'apikey', temChave: true }], claudeProfileId: 'b' } as ConfigDoMotor;
  const perfis: PerfisDoClaude = {
    problemas: [{ profileId: 'b', code: 'sem_login' }],
    uso: {
      a: { lido: true, ok: true, janelas: [{ nome: 'Sessão', usado: 0.224, resetTexto: '17:00' }, { nome: 'Semana', usado: 1.4 }, { nome: 'Opus' }] },
      b: { lido: true, ok: false, erro: 'sem login', janelas: [] },
    },
  };

  it('na ordem da configuração, com o selo de cada um e as janelas do uso', () => {
    const lista = perfisDoPlano(config, perfis, ['a']);
    expect(lista.map((p) => [p.id, p.nome, p.selo.texto, p.selo.tom])).toEqual([
      ['a', 'Assinatura A', 'Em uso agora', 'marca'],
      ['b', 'b', 'Com problema: sem_login', 'ruim'],
      ['k', 'Chave', 'Sem uso agora', 'neutro'],
    ]);
    expect(lista[0]?.janelas).toEqual([
      { nome: 'Sessão', texto: '22% usado, volta 17:00', fracao: 22 },
      // passou do teto: a barra fica cheia e o número aparece como veio
      { nome: 'Semana', texto: '140% usado', fracao: 100 },
      { nome: 'Opus', texto: 'sem dado', fracao: 0 },
    ]);
    expect(lista[1]?.aviso).toBe('O motor não conseguiu ler o uso do plano: sem login.');
    expect(lista[2]?.aviso).toBe('Perfil de chave de API: não tem janela de plano.');
  });

  it('o padrão sem sessão aparece como padrão, e o uso que ainda não foi lido é dito', () => {
    const lista = perfisDoPlano({ claudeProfiles: [{ id: 'b', kind: 'dir' }], claudeProfileId: 'b' } as ConfigDoMotor, { problemas: [], uso: {} }, []);
    expect(lista[0]?.selo).toEqual({ texto: 'Perfil padrão', tom: 'ok' });
    expect(lista[0]?.aviso).toBe('O motor ainda não leu o uso do plano deste perfil.');
  });

  it('sem a lista de perfis na configuração, valem os do uso; sem nada, lista vazia', () => {
    expect(perfisDoPlano(undefined, perfis, []).map((p) => p.id)).toEqual(['a', 'b']);
    expect(perfisDoPlano(undefined, undefined, [])).toEqual([]);
  });

  it('a leitura desatualizada é dita', () => {
    const lista = perfisDoPlano(undefined, { problemas: [], uso: { a: { lido: true, desatualizado: true, janelas: [{ nome: 'Sessão', usado: 0.5 }] } } }, []);
    expect(lista[0]?.aviso).toBe('Leitura desatualizada: o motor não conseguiu reler o uso agora.');
  });
});
