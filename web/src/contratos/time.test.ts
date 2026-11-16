import { describe, expect, it, vi } from 'vitest';
import { lerAutor, lerConfig, lerPessoas, lerTime } from './time';

describe('lerTime: a resposta de GET /api/team', () => {
  it('lê a lista crua na ordem do motor', () => {
    const lido = lerTime([
      { login: 'ana', name: 'Ana Souza', entries: [{ date: '2026-11-16', ref: 'dono/repo#12', verdict: 'APPROVE', bullets: ['Cobriu o caso de borda.'] }] },
      { login: 'bruno', name: 'bruno', entries: [] },
    ]);
    expect(lido).toEqual({
      autores: [
        { login: 'ana', name: 'Ana Souza', entries: [{ date: '2026-11-16', ref: 'dono/repo#12', verdict: 'APPROVE', bullets: ['Cobriu o caso de borda.'] }] },
        // o motor repete o login quando o dossiê não traz nome: aí não há nome
        { login: 'bruno', entries: [] },
      ],
      descartados: 0,
    });
  });

  it('o que não é lista é resposta inválida', () => {
    expect(lerTime({ ok: true })).toBeNull();
    expect(lerTime(null)).toBeNull();
  });

  it('autor sem login é descartado e contado, e o resto entra', () => {
    expect(lerTime([{ name: 'sem login' }, { login: '  ' }, 7, { login: 'ana' }])).toEqual({ autores: [{ login: 'ana', entries: [] }], descartados: 3 });
  });

  it('o autor degrada campo a campo', () => {
    expect(lerAutor({ login: 'ana', name: 9, entries: 'x' })).toEqual({ login: 'ana', entries: [] });
    expect(lerAutor({ login: 'ana', entries: [null, { date: 3, ref: '', verdict: null, bullets: ['a', 4, '  ', 'b'] }, { bullets: 'x' }] })).toEqual({
      login: 'ana',
      entries: [{ bullets: ['a', 'b'] }, { bullets: [] }],
    });
  });
});

describe('lerPessoas: config.people', () => {
  it('lê papel e domínios como vieram, inclusive valor que a tela não conhece', () => {
    expect(lerPessoas({ ana: { papel: 'senior', dominios: { backend: 'avancado', novo: 'nivel_novo' } }, bruno: { papel: 'papel_novo' } })).toEqual({
      pessoas: { ana: { papel: 'senior', dominios: { backend: 'avancado', novo: 'nivel_novo' } }, bruno: { papel: 'papel_novo' } },
      ilegiveis: 0,
    });
  });

  it('campo torto conta como ausente, e entrada que não é objeto é contada', () => {
    expect(lerPessoas({ ana: { papel: 4, dominios: { backend: 2, dados: '' } }, bruno: 'x', caio: null })).toEqual({ pessoas: { ana: {} }, ilegiveis: 2 });
  });

  it('o que não é mapa não é lido', () => {
    expect(lerPessoas([])).toBeUndefined();
    expect(lerPessoas(undefined)).toBeUndefined();
  });

  it('um login "__proto__" vira propriedade própria', () => {
    const lido = lerPessoas(JSON.parse('{"__proto__":{"papel":"senior"}}'));
    expect(Object.hasOwn(lido?.pessoas ?? {}, '__proto__')).toBe(true);
    expect(({} as { papel?: string }).papel).toBeUndefined();
  });
});

describe('lerConfig: a chave config do snapshot', () => {
  it('fica só com os perfis', () => {
    const registrar = vi.fn();
    expect(lerConfig({ intervalSeconds: 300, people: { ana: { papel: 'pleno' } } }, registrar)).toEqual({ people: { ana: { papel: 'pleno' } } });
    expect(registrar).not.toHaveBeenCalled();
  });

  it('sem o mapa de perfis a config chega sem people', () => {
    expect(lerConfig({ intervalSeconds: 300 }, vi.fn())).toEqual({});
    expect(lerConfig({ people: [] }, vi.fn())).toEqual({});
  });

  it('perfil ilegível é contado, e o registro leva só a contagem', () => {
    const registrar = vi.fn();
    expect(lerConfig({ people: { ana: { papel: 'pleno' }, bruno: 3 } }, registrar)).toEqual({ people: { ana: { papel: 'pleno' } }, peopleIlegiveis: 1 });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(String(registrar.mock.calls[0]?.[0])).not.toContain('bruno');
  });

  it('forma errada da chave mantém o valor anterior', () => {
    expect(lerConfig('x', vi.fn())).toBeUndefined();
    expect(lerConfig(null, vi.fn())).toBeUndefined();
  });
});
