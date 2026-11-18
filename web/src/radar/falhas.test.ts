import { describe, expect, it } from 'vitest';
import type { SessaoAtiva } from '@/contratos/radar';
import { CARENCIA_MS, falhaSuperada, motivoDaFalha, sumidas, vistaDa, visivel } from './falhas';

const INICIO = Date.UTC(2026, 10, 16, 14, 0);

const sessao = (extra: Partial<SessaoAtiva> = {}): SessaoAtiva => ({
  id: 'a1', startedAt: INICIO, pr: { key: 'dono/repo#12', url: 'u', title: 'T', author: 'ana' },
  progresso: { percentual: 45, etapa: 3, totalEtapas: 5, rotuloDaEtapa: 'código' }, ...extra,
});

describe('a sessão que some sem resultado', () => {
  it('a vista guarda o PR, a etapa (com o piso) e o último aviso do feed', () => {
    const feed = [{ t: 1, k: 'warn', text: 'primeiro' }, { t: 2, k: 'warn', text: 'limite do plano' }, { t: 3, k: 'tool', text: 'lendo' }];
    expect(vistaDa(sessao(), feed)).toEqual({ id: 'a1', chave: 'dono/repo#12', url: 'u', titulo: 'T', autor: 'ana', inicio: INICIO, etapa: 2, cancelada: false, aviso: 'limite do plano' });
    expect(vistaDa(sessao(), [], 4)?.etapa).toBe(4);
    expect(vistaDa({ id: 'x' }, [])).toBeNull();
  });

  it('some: a que saiu e não foi cancelada', () => {
    const antes = [vistaDa(sessao(), []), vistaDa(sessao({ id: 'a2', cancelled: true }), []), vistaDa(sessao({ id: 'a3' }), [])].filter((v) => v !== null);
    expect(sumidas(antes, [sessao({ id: 'a3' })], 99).map((f) => [f.id, f.sumiuEm, f.fimNoMotor])).toEqual([['a1', 99, 99]]);
    // com o motor 60 s atrás do navegador, o fim na hora do motor é 60 s antes
    expect(sumidas(antes, [], 100000, 60000).map((f) => f.fimNoMotor)).toEqual([40000, 40000]);
  });

  it('superada: o PR voltou a ter sessão ou ganhou decisão depois do começo', () => {
    const [f] = sumidas([vistaDa(sessao(), []) as NonNullable<ReturnType<typeof vistaDa>>], [], INICIO + 60000);
    if (!f) throw new Error('sem falha');
    const vazio = { sessoes: [], pendentes: [], resolvidas: [] };
    expect(falhaSuperada(f, vazio)).toBe(false);
    expect(falhaSuperada(f, { ...vazio, sessoes: [sessao({ id: 'a9' })] })).toBe(true);
    expect(falhaSuperada(f, { ...vazio, resolvidas: [{ id: 'd', key: 'dono/repo#12', resolvedAt: INICIO + 1 }] })).toBe(true);
    expect(falhaSuperada(f, { ...vazio, resolvidas: [{ id: 'd', key: 'dono/repo#12', resolvedAt: INICIO - 1 }] })).toBe(false);
    expect(falhaSuperada(f, { ...vazio, pendentes: [{ id: 'p', key: 'dono/repo#12', createdAt: INICIO + 5, reportMarkdown: '', reasons: [], attention: [] }] })).toBe(true);
  });

  it('o motivo: a parada gravada depois do começo, senão o último aviso', () => {
    const v = vistaDa(sessao(), [{ t: 1, k: 'warn', text: 'aviso do feed' }]) as NonNullable<ReturnType<typeof vistaDa>>;
    expect(motivoDaFalha(v, { at: new Date(INICIO + 1000).toISOString(), motivo: 'timeout', tipo: 'esgotado' })).toBe('timeout');
    expect(motivoDaFalha(v, { at: new Date(INICIO - 1000).toISOString(), motivo: 'velho', tipo: 'esgotado' })).toBe('aviso do feed');
    expect(motivoDaFalha({ ...v, aviso: undefined }, undefined)).toBe('');
  });

  it('carência: só aparece depois de 3 s', () => {
    const f = { id: 'a1', chave: 'k', etapa: 0, cancelada: false, sumiuEm: 1000, fimNoMotor: 1000 };
    expect(visivel(f, 1000 + CARENCIA_MS - 1)).toBe(false);
    expect(visivel(f, 1000 + CARENCIA_MS)).toBe(true);
  });
});
