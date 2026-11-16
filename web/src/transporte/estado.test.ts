import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { aplicarEstadoInteiro, aplicarPatch } from './estado';

const APP = { name: 'Farol', version: '3.0.0-dev', platform: 'linux' };

function coletor() {
  const avisos: string[] = [];
  return { avisos, registrar: (aviso: string) => { avisos.push(aviso); } };
}

describe('state: o snapshot inteiro', () => {
  it('entra com as chaves conhecidas e ignora a desconhecida', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarEstadoInteiro(null, { app: APP, status: 'ok', queue: [1, 2], chaveNova: { x: 1 } }, registrar);
    expect(novo).toEqual({ app: APP, status: 'ok', queue: [1, 2] });
    expect(avisos).toEqual([]);
  });

  it('forma errada numa chave conhecida mantém o valor anterior e registra', () => {
    const { avisos, registrar } = coletor();
    const anterior: Snapshot = { app: APP, status: 'ok' };
    const novo = aplicarEstadoInteiro(anterior, { app: { name: 7 }, status: 'checking' }, registrar);
    expect(novo).toEqual({ app: APP, status: 'checking' });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('app');
  });

  it('forma errada sem valor anterior deixa a chave ausente', () => {
    const { avisos, registrar } = coletor();
    expect(aplicarEstadoInteiro(null, { app: 'torto', status: 'ok' }, registrar)).toEqual({ status: 'ok' });
    expect(avisos).toHaveLength(1);
  });

  it('chave que o motor deixou de mandar some', () => {
    const { registrar } = coletor();
    expect(aplicarEstadoInteiro({ app: APP, status: 'ok' }, { app: APP }, registrar)).toEqual({ app: APP });
  });

  it('corpo que não é objeto não troca nada', () => {
    const { avisos, registrar } = coletor();
    const anterior: Snapshot = { app: APP };
    for (const torto of [null, 'texto', 3, [APP]]) expect(aplicarEstadoInteiro(anterior, torto, registrar)).toBe(anterior);
    expect(avisos).toHaveLength(4);
  });

  it('chave de protótipo no corpo não vira estado', () => {
    const { registrar } = coletor();
    const corpo: unknown = JSON.parse('{"__proto__":{"app":"x"},"constructor":1,"status":"ok"}');
    const novo = aplicarEstadoInteiro(null, corpo, registrar);
    expect(novo).toEqual({ status: 'ok' });
    expect(Object.keys(novo as object)).toEqual(['status']);
  });
});

describe('state-patch: a diferença por chave de topo', () => {
  const base: Snapshot = { app: APP, status: 'ok', queue: [1], error: 'antigo' };

  it('troca as chaves de campos e apaga as de removidos, como o motor emite', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarPatch(base, { campos: { status: 'checking', queue: [1, 2] }, removidos: ['error'] }, registrar);
    expect(novo).toEqual({ app: APP, status: 'checking', queue: [1, 2] });
    expect(avisos).toEqual([]);
  });

  it('não altera o estado anterior, e o que não mudou mantém a referência', () => {
    const { registrar } = coletor();
    const copia = structuredClone(base);
    const novo = aplicarPatch(base, { campos: { status: 'checking' }, removidos: [] }, registrar);
    expect(base).toEqual(copia);
    expect(novo).not.toBe(base);
    expect(novo?.queue).toBe(base.queue);
  });

  it('valor null é valor, não remoção', () => {
    const { registrar } = coletor();
    expect(aplicarPatch(base, { campos: { error: null }, removidos: [] }, registrar)).toEqual({ ...base, error: null });
  });

  it('ignora chave desconhecida em campos e em removidos', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarPatch(base, { campos: { chaveNova: 1 }, removidos: ['outraNova', 'toString'] }, registrar);
    expect(novo).toBe(base);
    expect(avisos).toEqual([]);
  });

  it('forma errada numa chave conhecida mantém o anterior, registra e aplica o resto', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarPatch(base, { campos: { app: [], status: 'checking' }, removidos: [] }, registrar);
    expect(novo).toEqual({ ...base, status: 'checking' });
    expect(avisos).toHaveLength(1);
  });

  it('envelope torto não troca nada', () => {
    const { avisos, registrar } = coletor();
    const tortos = [null, [], 'x', {}, { campos: [], removidos: [] }, { campos: {}, removidos: 'error' }, { campos: {}, removidos: [1] }, { campos: null, removidos: [] }];
    for (const torto of tortos) expect(aplicarPatch(base, torto, registrar)).toBe(base);
    expect(avisos).toHaveLength(tortos.length);
  });

  it('patch sem estado para mesclar é descartado', () => {
    const { avisos, registrar } = coletor();
    expect(aplicarPatch(null, { campos: { status: 'ok' }, removidos: [] }, registrar)).toBeNull();
    expect(avisos).toHaveLength(1);
  });
});
