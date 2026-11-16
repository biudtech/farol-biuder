import { describe, expect, it } from 'vitest';
import { LEITORES } from './snapshot';
import { ehPendencia } from './radar';

function coletor() {
  const avisos: string[] = [];
  return { avisos, registrar: (aviso: string) => { avisos.push(aviso); } };
}

// O que decisionForUi (lib/engine/public-review.js) sempre emite numa pendência.
const PENDENCIA = { id: 'd1', key: 'dono/repo#12', reportMarkdown: '## Review', reasons: [], attention: [] };

describe('chaves simples do Radar', () => {
  it('status aceita só os quatro estados do ciclo de checagem', () => {
    const { registrar } = coletor();
    for (const s of ['starting', 'checking', 'idle', 'error']) expect(LEITORES.status(s, registrar)).toBe(s);
    for (const torto of ['ok', '', 3, null]) expect(LEITORES.status(torto, registrar)).toBeUndefined();
  });

  it('error, lastCheckAt e nextCheckAt aceitam null, que é valor e não forma errada', () => {
    const { registrar } = coletor();
    expect(LEITORES.error(null, registrar)).toBeNull();
    expect(LEITORES.error('rede fora', registrar)).toBe('rede fora');
    expect(LEITORES.error(7, registrar)).toBeUndefined();
    expect(LEITORES.lastCheckAt(null, registrar)).toBeNull();
    expect(LEITORES.nextCheckAt(1700000000000, registrar)).toBe(1700000000000);
    expect(LEITORES.lastCheckAt('ontem', registrar)).toBeUndefined();
    expect(LEITORES.lastCheckAt(Number.NaN, registrar)).toBeUndefined();
  });

  it('account pede o login e o estado do token', () => {
    const { registrar } = coletor();
    expect(LEITORES.account({ user: '', tokenOk: false }, registrar)).toEqual({ user: '', tokenOk: false });
    for (const torto of [null, {}, { user: 'x' }, { user: 'x', tokenOk: 'sim' }]) expect(LEITORES.account(torto, registrar)).toBeUndefined();
  });
});

describe('listas do Radar: o item torto sai, a lista segue', () => {
  it('queue descarta o item sem chave ou sem URL e registra a contagem, sem o dado', () => {
    const { avisos, registrar } = coletor();
    const bom = { key: 'dono/repo#1', url: 'https://github.com/dono/repo/pull/1', title: 'Título', isDraft: false, labels: ['x'] };
    const lida = LEITORES.queue([bom, { key: 'dono/repo#2' }, null, { key: 'dono/repo#3', url: 'u', title: 9 }], registrar);
    expect(lida).toEqual([bom]);
    expect(avisos).toEqual(['snapshot: 3 item(ns) de "queue" com forma inesperada, descartado(s)']);
  });

  it('queue que não é lista é forma errada da chave', () => {
    const { registrar } = coletor();
    for (const torto of [null, {}, 'fila']) expect(LEITORES.queue(torto, registrar)).toBeUndefined();
  });

  it('campo opcional ausente passa', () => {
    const { avisos, registrar } = coletor();
    expect(LEITORES.queue([{ key: 'a/b#1', url: 'u' }], registrar)).toHaveLength(1);
    expect(LEITORES.activeSessions([{ id: 'a1', label: 'Revisão', startedAt: 1 }], registrar)).toHaveLength(1);
    expect(avisos).toEqual([]);
  });

  it('activeSessions descarta a sessão sem id ou com o PR torto', () => {
    const { avisos, registrar } = coletor();
    const boa = { id: 'a1', label: 'Revisão automática de a/b#1', startedAt: 5, keys: ['a/b#1'], cancellable: true, pr: { key: 'a/b#1', url: 'u' }, fase: 'modelo' };
    expect(LEITORES.activeSessions([boa, { label: 'x', startedAt: 1 }, { id: 'a2', label: 'x', startedAt: 1, pr: 'a/b#2' }], registrar)).toEqual([boa]);
    expect(avisos).toHaveLength(1);
  });

  it('buscasPausadas e headlessWaitingPrs conferem cada item', () => {
    const { registrar } = coletor();
    expect(LEITORES.buscasPausadas([{ conta: 'rev', ate: 9 }, { conta: 'rev' }], registrar)).toEqual([{ conta: 'rev', ate: 9 }]);
    const pr = { key: 'a/b#1', url: 'u', title: '', author: '', repo: 'a/b', updatedAt: '', account: 'rev' };
    expect(LEITORES.headlessWaitingPrs([pr, { key: 'a/b#2' }], registrar)).toEqual([pr]);
    expect(LEITORES.headlessWaiting(['a/b#1'], registrar)).toEqual(['a/b#1']);
    expect(LEITORES.headlessWaiting(['a/b#1', 2], registrar)).toBeUndefined();
  });
});

describe('mapas do Radar', () => {
  it('parked, inicioAutomatico, esperaConflito e headlessWaitingDetails descartam a entrada torta', () => {
    const { avisos, registrar } = coletor();
    expect(LEITORES.parked({ 'a/b#1': { at: '', motivo: '', tipo: 'legado' }, 'a/b#2': { at: 3 } }, registrar)).toEqual({ 'a/b#1': { at: '', motivo: '', tipo: 'legado' } });
    expect(LEITORES.inicioAutomatico({ 'a/b#1': false, 'a/b#2': 'sim' }, registrar)).toEqual({ 'a/b#1': false });
    expect(LEITORES.esperaConflito({ 'a/b#1': { at: 1, head: 'h' }, 'a/b#2': null }, registrar)).toEqual({ 'a/b#1': { at: 1, head: 'h' } });
    expect(LEITORES.headlessWaitingDetails({ 'a/b#1': { posicao: 1, total: 2, motivo: 'limite-conta' }, 'a/b#2': { posicao: '1' } }, registrar))
      .toEqual({ 'a/b#1': { posicao: 1, total: 2, motivo: 'limite-conta' } });
    expect(avisos).toHaveLength(4);
    expect(LEITORES.parked([], registrar)).toBeUndefined();
  });

  it('activity descarta a linha torta de um feed e o feed que não é lista', () => {
    const { avisos, registrar } = coletor();
    const linha = { t: 1, k: 'tool', text: 'lendo', a: 'leitor', s: 'leitura' };
    expect(LEITORES.activity({ a1: [linha, { t: 'x' }], a2: 'feed', a3: [] }, registrar)).toEqual({ a1: [linha], a3: [] });
    expect(avisos).toHaveLength(2);
  });

  it('chave de protótipo num mapa vira entrada comum, sem tocar no protótipo', () => {
    const { registrar } = coletor();
    const lido = LEITORES.inicioAutomatico(JSON.parse('{"__proto__":true,"a/b#1":true}'), registrar);
    expect(Object.keys(lido as object).sort()).toEqual(['__proto__', 'a/b#1']);
    expect(Object.getPrototypeOf(lido)).toBe(Object.prototype);
  });
});

describe('pendências (decisions.pending)', () => {
  it('aceita a pendência mínima e a completa que o motor projeta', () => {
    expect(ehPendencia(PENDENCIA)).toBe(true);
    expect(ehPendencia({
      ...PENDENCIA, createdAt: 1, verdict: 'approve', card: null, prProprio: true, blockedReason: 'motivo', blockedKind: 'stale_head',
      headSha: 'aaa', blockedHead: 'bbb', author: 'ana', account: 'rev',
      pr: { repo: 'dono/repo', number: 12, url: 'https://github.com/dono/repo/pull/12', title: 'T', author: 'ana' },
      postRetry: { attempts: 2, exhausted: false },
      esperaCi: { desde: 1, checks: [{ nome: 'ci', estado: 'pending' }] },
      esperaProva: { desde: 1, tentativas: 0, soEnvelope: false, aguardandoCi: false, proximaEm: 0, impedimento: '', pedeVoce: false },
      technical: { state: 'pass', message: 'Critérios técnicos comprovados.', violated: 0 },
      reasons: [{ text: 'regra', kind: 'gate' }], attention: [{ text: 'olhar', kind: 'content' }],
    })).toBe(true);
  });

  it.each([
    ['sem id', { ...PENDENCIA, id: undefined }],
    ['sem o texto do review', { ...PENDENCIA, reportMarkdown: undefined }],
    ['motivo com tipo desconhecido', { ...PENDENCIA, reasons: [{ text: 'x', kind: 'outro' }] }],
    ['prProprio que não é true', { ...PENDENCIA, prProprio: 'sim' }],
    ['postRetry torto', { ...PENDENCIA, postRetry: { attempts: '2' } }],
    ['check sem nome', { ...PENDENCIA, esperaCi: { desde: 1, checks: [{ estado: 'x' }] } }],
    ['pr que não é objeto', { ...PENDENCIA, pr: 'dono/repo#12' }],
  ])('recusa a pendência %s', (_caso, torta) => {
    expect(ehPendencia(torta)).toBe(false);
  });

  it('decisions descarta a pendência torta, mantém as outras e não mexe nas resolvidas', () => {
    const { avisos, registrar } = coletor();
    const resolvidas = [{ qualquer: 1 }];
    const lido = LEITORES.decisions({ pending: [PENDENCIA, { id: 'd2' }], resolved: resolvidas }, registrar);
    expect(lido?.pending).toEqual([PENDENCIA]);
    expect(lido?.resolved).toBe(resolvidas);
    expect(avisos).toEqual(['snapshot: 1 item(ns) de "decisions.pending" com forma inesperada, descartado(s)']);
  });

  it('decisions sem as duas listas é forma errada da chave', () => {
    const { registrar } = coletor();
    for (const torto of [null, [], { pending: [] }, { resolved: [] }, { pending: {}, resolved: [] }]) {
      expect(LEITORES.decisions(torto, registrar)).toBeUndefined();
    }
  });
});
