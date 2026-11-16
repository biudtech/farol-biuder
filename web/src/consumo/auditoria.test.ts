import { describe, expect, it } from 'vitest';
import { linhasDaAuditoria } from './auditoria';

describe('a auditoria do registro inteiro', () => {
  const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });

  it('sem perda nem estimativa, só o total', () => {
    expect(linhasDaAuditoria({ total: parte(1, 2), perdido: parte(0, 0), estimado: parte(0, 0), desconhecido: parte(0, 0) })).toEqual(['Registro inteiro de sessões: US$ 2,00 estimados em 1 sessão.']);
  });

  it('diz o que não virou resultado, o que o motor calculou e o que ficou desconhecido', () => {
    expect(linhasDaAuditoria({ total: parte(42, 900), util: parte(39, 810), perdido: parte(3, 90), medido: parte(40, 880), estimado: parte(1, 20), desconhecido: parte(1, 0) })).toEqual([
      'Registro inteiro de sessões: US$ 900,00 estimados em 42 sessões.',
      'Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): US$ 90,00 em 3 sessões, 10% do custo registrado.',
      'Custo calculado pelo motor, para sessão que morreu antes de informar: US$ 20,00 em 1 sessão.',
      'Custo desconhecido: 1 sessão, fora de todo valor em dólar.',
    ]);
  });

  it('total zero não vira participação', () => {
    expect(linhasDaAuditoria({ total: parte(1, 0), perdido: parte(1, 0) })[1]).toBe('Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): US$ 0,00 em 1 sessão.');
  });
});
