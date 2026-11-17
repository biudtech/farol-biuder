import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { aplicarAtividade, aplicarEstadoInteiro, aplicarPatch } from './estado';

const APP = { name: 'Farol', version: '3.0.0-dev', platform: 'linux' };

function coletor() {
  const avisos: string[] = [];
  return { avisos, registrar: (aviso: string) => { avisos.push(aviso); } };
}

describe('state: o snapshot inteiro', () => {
  it('entra com as chaves conhecidas e ignora a desconhecida', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarEstadoInteiro(null, { app: APP, status: 'idle', filaJusta: [1, 2], chaveNova: { x: 1 } }, registrar);
    expect(novo).toEqual({ app: APP, status: 'idle', filaJusta: [1, 2] });
    expect(avisos).toEqual([]);
  });

  it('forma errada numa chave conhecida mantém o valor anterior e registra', () => {
    const { avisos, registrar } = coletor();
    const anterior: Snapshot = { app: APP, status: 'idle' };
    const novo = aplicarEstadoInteiro(anterior, { app: { name: 7 }, status: 'checking' }, registrar);
    expect(novo).toEqual({ app: APP, status: 'checking' });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('app');
  });

  it('forma errada sem valor anterior deixa a chave ausente', () => {
    const { avisos, registrar } = coletor();
    expect(aplicarEstadoInteiro(null, { app: 'torto', status: 'idle' }, registrar)).toEqual({ status: 'idle' });
    expect(avisos).toHaveLength(1);
  });

  it('chave que o motor deixou de mandar some', () => {
    const { registrar } = coletor();
    expect(aplicarEstadoInteiro({ app: APP, status: 'idle' }, { app: APP }, registrar)).toEqual({ app: APP });
  });

  it('corpo que não é objeto não troca nada', () => {
    const { avisos, registrar } = coletor();
    const anterior: Snapshot = { app: APP };
    for (const torto of [null, 'texto', 3, [APP]]) expect(aplicarEstadoInteiro(anterior, torto, registrar)).toBe(anterior);
    expect(avisos).toHaveLength(4);
  });

  it('chave de protótipo no corpo não vira estado', () => {
    const { registrar } = coletor();
    const corpo: unknown = JSON.parse('{"__proto__":{"app":"x"},"constructor":1,"status":"idle"}');
    const novo = aplicarEstadoInteiro(null, corpo, registrar);
    expect(novo).toEqual({ status: 'idle' });
    expect(Object.keys(novo as object)).toEqual(['status']);
  });
});

describe('state-patch: a diferença por chave de topo', () => {
  const base: Snapshot = { app: APP, status: 'idle', filaJusta: [1], error: 'antigo' };

  it('troca as chaves de campos e apaga as de removidos, como o motor emite', () => {
    const { avisos, registrar } = coletor();
    const novo = aplicarPatch(base, { campos: { status: 'checking', filaJusta: [1, 2] }, removidos: ['error'] }, registrar);
    expect(novo).toEqual({ app: APP, status: 'checking', filaJusta: [1, 2] });
    expect(avisos).toEqual([]);
  });

  it('não altera o estado anterior, e o que não mudou mantém a referência', () => {
    const { registrar } = coletor();
    const copia = structuredClone(base);
    const novo = aplicarPatch(base, { campos: { status: 'checking' }, removidos: [] }, registrar);
    expect(base).toEqual(copia);
    expect(novo).not.toBe(base);
    expect(novo?.filaJusta).toBe(base.filaJusta);
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
    expect(aplicarPatch(null, { campos: { status: 'idle' }, removidos: [] }, registrar)).toBeNull();
    expect(avisos).toHaveLength(1);
  });
});

describe('lista com item torto: o item sai e a chave entra', () => {
  it('a fila entra sem o item de forma errada, com o registro da contagem', () => {
    const { avisos, registrar } = coletor();
    const bom = { key: 'dono/repo#1', url: 'https://github.com/dono/repo/pull/1' };
    const novo = aplicarEstadoInteiro(null, { queue: [bom, { key: 7 }] }, registrar);
    expect(novo).toEqual({ queue: [bom] });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('queue');
  });

  it('fila que não é lista mantém a anterior', () => {
    const { avisos, registrar } = coletor();
    const anterior: Snapshot = { queue: [{ key: 'dono/repo#1', url: 'u' }] };
    const novo = aplicarPatch(anterior, { campos: { queue: 'torta', status: 'idle' }, removidos: [] }, registrar);
    expect(novo?.queue).toBe(anterior.queue);
    expect(novo?.status).toBe('idle');
    expect(avisos).toHaveLength(1);
  });
});

describe('activity: a linha nova do feed de uma sessão', () => {
  const linha = (t: number) => ({ t, k: 'tool', text: `linha ${t}` });
  const base: Snapshot = { app: APP, activity: { a1: [linha(1)], a2: [linha(9)] } };

  it('entra no fim do feed da sessão, sem alterar o estado anterior nem os outros feeds', () => {
    const { avisos, registrar } = coletor();
    const copia = structuredClone(base);
    const novo = aplicarAtividade(base, { id: 'a1', item: linha(2), lidos: 3 }, registrar);
    expect(novo?.activity?.a1).toEqual([linha(1), linha(2)]);
    expect(novo?.activity?.a2).toBe(base.activity?.a2);
    expect(novo?.app).toBe(base.app);
    expect(base).toEqual(copia);
    expect(avisos).toEqual([]);
  });

  it('sessão que o snapshot ainda não trouxe ganha o feed com a linha', () => {
    const { registrar } = coletor();
    expect(aplicarAtividade({ app: APP }, { id: 'a7', item: linha(1) }, registrar)?.activity).toEqual({ a7: [linha(1)] });
  });

  it('guarda só as 120 linhas mais recentes, como o motor', () => {
    const { registrar } = coletor();
    const cheio: Snapshot = { activity: { a1: Array.from({ length: 120 }, (_, i) => linha(i)) } };
    const feed = aplicarAtividade(cheio, { id: 'a1', item: linha(500) }, registrar)?.activity?.a1 ?? [];
    expect(feed).toHaveLength(120);
    expect(feed[0]).toEqual(linha(1));
    expect(feed.at(-1)).toEqual(linha(500));
  });

  it('o progresso que vem com a linha atualiza a sessão dela, e só ela', () => {
    const { avisos, registrar } = coletor();
    const progresso = { percentual: 31, etapa: 3, totalEtapas: 5, rotuloDaEtapa: 'código', arquivosLidos: 5, arquivosTotais: 20 };
    const comSessoes: Snapshot = { ...base, activeSessions: [{ id: 'a1' }, { id: 'a2', progresso: { percentual: 10, etapa: 2, totalEtapas: 5, rotuloDaEtapa: 'card' } }] };
    const novo = aplicarAtividade(comSessoes, { id: 'a1', item: linha(2), progresso }, registrar);
    expect(novo?.activeSessions?.[0]).toEqual({ id: 'a1', progresso });
    expect(novo?.activeSessions?.[1]).toBe(comSessoes.activeSessions?.[1]);
    // progresso torto não apaga o que a sessão tinha, e a linha entra do mesmo jeito
    const torto = aplicarAtividade(comSessoes, { id: 'a2', item: linha(3), progresso: { percentual: 'muito' } }, registrar);
    expect(torto?.activeSessions).toBe(comSessoes.activeSessions);
    expect(torto?.activity?.a2?.at(-1)).toEqual(linha(3));
    // sem o campo, as sessões ficam como estavam
    expect(aplicarAtividade(comSessoes, { id: 'a1', item: linha(4) }, registrar)?.activeSessions).toBe(comSessoes.activeSessions);
    expect(avisos).toEqual([]);
  });

  it('evento torto não troca nada e registra', () => {
    const { avisos, registrar } = coletor();
    const tortos = [null, 'x', {}, { id: 'a1' }, { id: 7, item: linha(1) }, { id: 'a1', item: { t: 'agora', k: 'tool', text: 'x' } }];
    for (const torto of tortos) expect(aplicarAtividade(base, torto, registrar)).toBe(base);
    expect(avisos).toHaveLength(tortos.length);
  });

  it('sem estado ainda, a linha é descartada sem aviso (o state traz o feed inteiro)', () => {
    const { avisos, registrar } = coletor();
    expect(aplicarAtividade(null, { id: 'a1', item: linha(1) }, registrar)).toBeNull();
    expect(avisos).toEqual([]);
  });

  it('id de protótipo vira entrada comum', () => {
    const { registrar } = coletor();
    const novo = aplicarAtividade({ app: APP }, JSON.parse('{"id":"__proto__","item":{"t":1,"k":"info","text":"x"}}'), registrar);
    expect(Object.keys(novo?.activity ?? {})).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(novo?.activity)).toBe(Object.prototype);
  });
});
