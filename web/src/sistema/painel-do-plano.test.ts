import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerConfigDoSistema, type PerfisDoClaude, type UsoDoPlano } from '@/contratos/sistema';
import { SEM_VALIDADE_NO_CLI, VALIDADE_NAO_LIDA, linhasDoPainel, validadeDoLogin } from './painel-do-plano';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');
const FUSO = 'America/Sao_Paulo';
const VENCE = Date.UTC(2026, 10, 27, 4, 45);

const A = { id: 'a', label: 'Primeiro', kind: 'dir', dir: '/home/farol/.farol/claude/a' };
const B = { id: 'b', label: 'Segundo', kind: 'dir', dir: '/home/farol/.farol/claude/b' };
const CHAVE = { id: 'k', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true };
const ler = (bruto: unknown) => lerConfigDoSistema(bruto, () => {});
const uso = (extra: Partial<UsoDoPlano> = {}): UsoDoPlano => ({ lido: true, ok: true, janelas: [{ nome: 'Semana', usado: 0.02, resetTexto: 'Nov 27, 9pm (America/Sao_Paulo)' }], ...extra });
const perfis = (mapa: Record<string, UsoDoPlano>, limites: PerfisDoClaude['limites'] = {}): PerfisDoClaude => ({ problemas: [], uso: mapa, limites });

describe('a validade do login no painel', () => {
  it('lê o campo que o motor tira do /usage do Claude Code', () => {
    expect(raiz('lib/engine/uso-do-plano.js')).toContain('j?.credential_expires_at');
  });

  it('com a validade: vale até, vence em e vencido, cada um com o seu tom', () => {
    expect(validadeDoLogin(uso({ venceEm: VENCE }), FUSO)).toEqual({ texto: 'Vale até 27/11, 01:45.', tom: 'ok' });
    expect(validadeDoLogin(uso({ venceEm: VENCE, faixaDoLogin: 'perto' }), FUSO)).toEqual({ texto: 'Vence em 27/11, 01:45: refaça o login antes disso.', tom: 'aviso' });
    expect(validadeDoLogin(uso({ venceEm: VENCE, faixaDoLogin: 'vencido' }), FUSO)).toEqual({ texto: 'Vencido em 27/11, 01:45: o login precisa ser refeito.', tom: 'ruim' });
  });

  it('uso lido sem validade é o Claude Code que não informa, e não leitura por vir', () => {
    expect(validadeDoLogin(uso({ venceEm: 0 }), FUSO)).toEqual({ texto: SEM_VALIDADE_NO_CLI, tom: 'aviso' });
    expect(validadeDoLogin(uso(), FUSO).texto).toBe(SEM_VALIDADE_NO_CLI);
  });

  it('sem leitura, ou com a leitura que falhou, a validade ainda não foi lida', () => {
    expect(validadeDoLogin(undefined, FUSO)).toEqual({ texto: VALIDADE_NAO_LIDA, tom: 'neutro' });
    expect(validadeDoLogin({ lido: false, janelas: [] }, FUSO).texto).toBe(VALIDADE_NAO_LIDA);
    expect(validadeDoLogin({ lido: true, ok: false, erro: 'o Claude Code não respondeu a tempo', janelas: [] }, FUSO).texto).toBe(VALIDADE_NAO_LIDA);
  });
});

describe('as linhas do painel', () => {
  it('uma por perfil, na ordem de uso do motor, com o padrão em primeiro', () => {
    const linhas = linhasDoPainel(ler({ claudeProfileId: 'b', claudeProfiles: [A, B, CHAVE] }), perfis({}), FUSO);
    expect(linhas.map((l) => [l.posicao, l.id, l.padrao])).toEqual([[1, 'b', true], [2, 'a', false], [3, 'k', false]]);
    expect(linhasDoPainel(undefined, undefined)).toEqual([]);
  });

  it('as janelas com o percentual e a volta que o motor leu', () => {
    const [linha] = linhasDoPainel(ler({ claudeProfileId: 'a', claudeProfiles: [A] }), perfis({
      a: uso({ venceEm: VENCE, janelas: [{ nome: 'Sessão', usado: 0.07, resetTexto: 'Nov 21, 5:39pm (America/Sao_Paulo)' }, { nome: 'Semana', usado: 1.4 }, { nome: 'Semana Fable' }] }),
    }), FUSO);
    expect(linha?.janelas).toEqual([
      { nome: 'Sessão', pct: 7, volta: 'Nov 21, 5:39pm (America/Sao_Paulo)' },
      { nome: 'Semana', pct: 100 },
      { nome: 'Semana Fable', pct: null },
    ]);
    expect(linha?.semJanela).toBeUndefined();
    expect(linha?.validade.texto).toBe('Vale até 27/11, 01:45.');
  });

  it('sem janela, diz por quê', () => {
    const config = ler({ claudeProfileId: 'a', claudeProfiles: [A, B, CHAVE] });
    const linhas = linhasDoPainel(config, perfis({ a: { lido: true, ok: false, erro: 'sem login válido nesta pasta', janelas: [] } }), FUSO);
    expect(linhas.map((l) => l.semJanela)).toEqual([
      'O motor não conseguiu ler o uso do plano: sem login válido nesta pasta.',
      'O motor ainda não leu o uso do plano deste perfil.',
      'Chave de API: não tem janela de plano.',
    ]);
    expect(linhas[2]?.validade).toEqual({ texto: 'Chave de API: não tem login para renovar.', tom: 'neutro' });
  });

  it('o perfil no limite do plano leva a hora da volta, e a leitura velha é marcada', () => {
    const [linha] = linhasDoPainel(ler({ claudeProfileId: 'a', claudeProfiles: [A] }), perfis({ a: uso({ desatualizado: true }) }, { a: { ate: VENCE, origem: 'uso', janela: 'Semana' } }), FUSO);
    expect(linha?.noLimiteAte).toBe('27/11, 01:45');
    expect(linha?.desatualizado).toBe(true);
  });

  it('não lê uso nem limite de chave herdada do protótipo', () => {
    const [linha] = linhasDoPainel(ler({ claudeProfileId: 'toString', claudeProfiles: [{ id: 'toString', label: 'Estranho', kind: 'dir' }] }), perfis({}), FUSO);
    expect(linha?.janelas).toEqual([]);
    expect(linha?.noLimiteAte).toBeUndefined();
  });
});
