import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerContas } from '@/contratos/sistema';
import { IDENTIFICADOR_DA_REGRA, corpoDaRegra, erroDaRegra, fraseDaRegra, identificadorValido, nomeDaRegra, regraDoAlvo, regrasOrdenadas, resumoDasRegras } from './regras';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');
const conta = (reviewRules: unknown) => lerContas([{ user: 'conta', owners: [], reviewRules }], () => {})?.[0];

describe('o leitor das regras', () => {
  it('lê a regra da organização e a de cada autor', () => {
    const lida = conta({ orga: { mode: 'manual', authors: { 'robo[bot]': 'manual', alguem: 'auto' } }, orgb: { authors: { outra: 'auto' } } });
    expect(lida?.regras).toEqual([
      { organizacao: 'orga', modo: 'manual' },
      { organizacao: 'orga', autor: 'robo[bot]', modo: 'manual' },
      { organizacao: 'orga', autor: 'alguem', modo: 'auto' },
      { organizacao: 'orgb', autor: 'outra', modo: 'auto' },
    ]);
    expect(lida?.regrasIlegiveis).toBe(0);
    expect(lida?.regrasDeReview).toBe(2);
  });

  it('entrada torta não quebra: o que não tem forma fica de fora e é contado', () => {
    expect(conta(undefined)?.regras).toEqual([]);
    expect(conta('texto')?.regras).toEqual([]);
    expect(conta([1, 2])?.regras).toEqual([]);
    const lida = conta({ a: 'manual', b: { mode: 'talvez', authors: { x: 'auto', y: 3 } }, c: { authors: 'nada' }, d: null });
    expect(lida?.regras).toEqual([{ organizacao: 'b', autor: 'x', modo: 'auto' }]);
    expect(lida?.regrasIlegiveis).toBe(4);
  });
});

describe('a regra digitada', () => {
  it('a forma do identificador é a do motor', () => {
    expect(raiz('lib/engine/review-scope.js')).toContain(`const identificador = v => ${IDENTIFICADOR_DA_REGRA.toString()}.test(v) && v.length <= 100;`);
  });

  it('nome como o motor grava: sem espaço, sem @ e em minúsculas', () => {
    expect(nomeDaRegra('  @Alguem ')).toBe('alguem');
    expect(identificadorValido('dependabot[bot]')).toBe(true);
    expect(identificadorValido('-x')).toBe(false);
    expect(identificadorValido('')).toBe(false);
    expect(identificadorValido('a'.repeat(101))).toBe(false);
  });

  it('organização é obrigatória; autor é opcional, mas com forma', () => {
    expect(erroDaRegra('', '')).toMatch(/organização/);
    expect(erroDaRegra('org', '')).toBeNull();
    expect(erroDaRegra('org', 'não vale')).toMatch(/autor/);
  });

  it('o corpo é a operação pontual do motor; inherit tira', () => {
    expect(corpoDaRegra('conta', ' Org ', '', 'manual')).toEqual({ tipo: 'regra-review', user: 'conta', organization: 'org', mode: 'manual' });
    expect(corpoDaRegra('conta', 'org', '@Autor', 'inherit')).toEqual({ tipo: 'regra-review', user: 'conta', organization: 'org', author: 'autor', mode: 'inherit' });
  });

  it('frase, ordem, regra do mesmo alvo e resumo', () => {
    expect(fraseDaRegra({ organizacao: 'org', modo: 'manual' })).toBe('Os PRs de org só são revisados no clique, mesmo com a revisão automática da conta ligada.');
    expect(fraseDaRegra({ organizacao: 'org', autor: 'x', modo: 'auto' })).toContain('@x em org são revisados sozinhos');
    const regras = [{ organizacao: 'b', modo: 'auto' as const }, { organizacao: 'a', autor: 'z', modo: 'auto' as const }, { organizacao: 'a', modo: 'manual' as const }];
    expect(regrasOrdenadas(regras).map((r) => `${r.organizacao}:${r.autor ?? ''}`)).toEqual(['a:', 'a:z', 'b:']);
    expect(regraDoAlvo(regras, 'A', '@Z')).toEqual({ organizacao: 'a', autor: 'z', modo: 'auto' });
    expect(regraDoAlvo(regras, 'a', '')).toEqual({ organizacao: 'a', modo: 'manual' });
    expect([0, 1, 3].map((n) => resumoDasRegras(regras.slice(0, n)))).toEqual(['Nenhuma exceção', '1 exceção', '3 exceções']);
  });
});
