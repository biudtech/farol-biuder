import { describe, expect, it, vi } from 'vitest';
import { mesmoJson } from './formas';
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

  it('pessoa que perde algo na leitura entra com o que deu para ler, e é contada como ilegível', () => {
    // papel e domínio de forma errada
    expect(lerPessoas({ ana: { papel: 4, dominios: { backend: 2, dados: '' } } })).toEqual({ pessoas: { ana: {} }, ilegiveis: 1 });
    // campo que a tela não conhece
    expect(lerPessoas({ ana: { papel: 'senior', squad: 'plataforma' } })).toEqual({ pessoas: { ana: { papel: 'senior' } }, ilegiveis: 1 });
    // o que não é objeto fica de fora, e também conta
    expect(lerPessoas({ bruno: 'x', caio: null, dora: { papel: 'pleno' } })).toEqual({ pessoas: { dora: { papel: 'pleno' } }, ilegiveis: 2 });
  });

  it('a ordem das chaves não faz uma pessoa ilegível', () => {
    expect(lerPessoas({ ana: { dominios: { dados: 'basico', backend: 'avancado' }, papel: 'senior' } })?.ilegiveis).toBe(0);
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
  it('dos perfis de review ficam os lidos, para mostrar, e o mapa cru, para o corpo de um salvar', () => {
    const registrar = vi.fn();
    const people = { ana: { papel: 'pleno' } };
    const lido = lerConfig({ intervalSeconds: 300, soundEnabled: true, people }, registrar);
    expect(lido).toEqual({ people: { ana: { papel: 'pleno' } }, peopleCru: people });
    // o cru é o próprio objeto do motor, não uma cópia filtrada
    expect(lido?.peopleCru).toBe(people);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('sem o mapa de perfis a config chega sem people', () => {
    expect(lerConfig({ intervalSeconds: 300 }, vi.fn())).toEqual({});
    expect(lerConfig({ people: [] }, vi.fn())).toEqual({});
  });

  it('perfil ilegível é contado, o cru o mantém como veio, e o registro leva só a contagem', () => {
    const registrar = vi.fn();
    const people = { ana: { papel: 'pleno' }, bruno: 3, caio: { papel: 4 }, dora: { papel: 'senior', squad: 'plataforma' } };
    expect(lerConfig({ people }, registrar)).toEqual({
      people: { ana: { papel: 'pleno' }, caio: {}, dora: { papel: 'senior' } },
      peopleCru: people,
      peopleIlegiveis: 3,
    });
    expect(registrar).toHaveBeenCalledTimes(1);
    const aviso = String(registrar.mock.calls[0]?.[0]);
    expect(aviso).toContain('3 perfil(is)');
    for (const dado of ['bruno', 'caio', 'dora', 'plataforma', 'senior']) expect(aviso).not.toContain(dado);
  });

  it('forma errada da chave mantém o valor anterior', () => {
    expect(lerConfig('x', vi.fn())).toBeUndefined();
    expect(lerConfig(null, vi.fn())).toBeUndefined();
  });
});

describe('mesmoJson', () => {
  it('compara valor a valor, sem olhar a ordem das chaves', () => {
    expect(mesmoJson({ a: 1, b: { c: [1, 2], d: null } }, { b: { d: null, c: [1, 2] }, a: 1 })).toBe(true);
    expect(mesmoJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(mesmoJson({ a: 1 }, { a: '1' })).toBe(false);
    expect(mesmoJson([1, 2], [2, 1])).toBe(false);
    expect(mesmoJson([], {})).toBe(false);
    expect(mesmoJson(null, {})).toBe(false);
    expect(mesmoJson('x', 'x')).toBe(true);
  });
});
