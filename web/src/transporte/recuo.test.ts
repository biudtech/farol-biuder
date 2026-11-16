import { describe, expect, it } from 'vitest';
import { OCIOSO_MS, RECUO_INICIAL_MS, RECUO_MAXIMO_MS, proximoRecuo } from './recuo';

describe('recuo da reconexão', () => {
  it('vai de 3 a 30 segundos, dobrando, e para no teto', () => {
    const esperas = [RECUO_INICIAL_MS];
    for (let i = 0; i < 6; i += 1) esperas.push(proximoRecuo(esperas[esperas.length - 1] as number));
    expect(esperas).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 30000]);
    expect(RECUO_MAXIMO_MS).toBe(30000);
  });

  it('valor torto volta ao início em vez de virar espera zero ou infinita', () => {
    expect(proximoRecuo(0)).toBe(RECUO_INICIAL_MS);
    expect(proximoRecuo(Number.NaN)).toBe(RECUO_INICIAL_MS);
    expect(proximoRecuo(-5)).toBe(RECUO_INICIAL_MS);
  });

  it('a queda por silêncio é de 90 segundos', () => {
    expect(OCIOSO_MS).toBe(90000);
  });
});
