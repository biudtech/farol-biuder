import { describe, expect, it } from 'vitest';
import { LEITORES } from './snapshot';
import { lerPendencia } from './radar';

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

describe('listas do Radar: só o que identifica o item é exigido', () => {
  it('queue descarta o item sem chave ou sem URL e registra a contagem, sem o dado', () => {
    const { avisos, registrar } = coletor();
    const bom = { key: 'dono/repo#1', url: 'https://github.com/dono/repo/pull/1', title: 'Título', isDraft: false };
    const lida = LEITORES.queue([{ ...bom, labels: ['x'] }, { key: 'dono/repo#2' }, null], registrar);
    expect(lida).toEqual([bom]);
    expect(Object.keys(lida?.[0] ?? {})).toEqual(['key', 'url', 'title', 'isDraft']);
    expect(avisos).toEqual(['snapshot: 2 item(ns) de "queue" com forma inesperada, descartado(s)']);
  });

  it('campo opcional torto, ou null, conta como ausente e o item fica', () => {
    const { avisos, registrar } = coletor();
    const lida = LEITORES.queue([{ key: 'a/b#3', url: 'u', title: 9, author: null, updatedAt: null, isDraft: 'sim', number: '3' }], registrar);
    expect(lida).toEqual([{ key: 'a/b#3', url: 'u' }]);
    expect(Object.keys(lida?.[0] ?? {})).toEqual(['key', 'url']);
    expect(avisos).toEqual([]);
  });

  it('queue que não é lista é forma errada da chave', () => {
    const { registrar } = coletor();
    for (const torto of [null, {}, 'fila']) expect(LEITORES.queue(torto, registrar)).toBeUndefined();
  });

  it('activeSessions exige só o id; o PR torto e os campos nulos saem do item', () => {
    const { avisos, registrar } = coletor();
    const boa = { id: 'a1', label: 'Revisão automática de a/b#1', startedAt: 5, keys: ['a/b#1'], cancellable: true, pr: { key: 'a/b#1', url: 'u' } };
    const lidas = LEITORES.activeSessions([{ ...boa, fase: 'modelo' }, { label: 'x', startedAt: 1 }, { id: 'a2', label: null, startedAt: 'já', pr: 'a/b#2', cancelled: null }], registrar);
    expect(lidas).toEqual([boa, { id: 'a2' }]);
    expect(avisos).toHaveLength(1);
  });

  it('buscasPausadas e headlessWaitingPrs conferem cada item', () => {
    const { registrar } = coletor();
    expect(LEITORES.buscasPausadas([{ conta: 'rev', ate: 9 }, { conta: 'rev' }], registrar)).toEqual([{ conta: 'rev', ate: 9 }]);
    expect(LEITORES.headlessWaitingPrs([{ key: 'a/b#1', url: 'u', title: '', author: null, repo: 'a/b', account: 'rev' }, { url: 'u' }], registrar))
      .toEqual([{ key: 'a/b#1', url: 'u', title: '' }]);
    expect(LEITORES.headlessWaiting(['a/b#1'], registrar)).toEqual(['a/b#1']);
    expect(LEITORES.headlessWaiting(['a/b#1', 2], registrar)).toBeUndefined();
  });
});

describe('mapas do Radar', () => {
  it('inicioAutomatico e esperaConflito descartam a entrada torta; parked e a espera ficam com o que deu para ler', () => {
    const { avisos, registrar } = coletor();
    expect(LEITORES.parked({ 'a/b#1': { at: '', motivo: '', tipo: 'legado' }, 'a/b#2': { at: 3, motivo: null }, 'a/b#3': 'parou' }, registrar))
      .toEqual({ 'a/b#1': { at: '', motivo: '', tipo: 'legado' }, 'a/b#2': { at: '', motivo: '', tipo: '' } });
    expect(LEITORES.inicioAutomatico({ 'a/b#1': false, 'a/b#2': 'sim' }, registrar)).toEqual({ 'a/b#1': false });
    expect(LEITORES.esperaConflito({ 'a/b#1': { at: 1, head: 'h' }, 'a/b#2': null }, registrar)).toEqual({ 'a/b#1': { at: 1, head: 'h' } });
    expect(LEITORES.headlessWaitingDetails({ 'a/b#1': { posicao: 1, total: 2, motivo: 'limite-conta', ocupadas: null }, 'a/b#2': { posicao: '1' }, 'a/b#3': 7 }, registrar))
      .toEqual({ 'a/b#1': { posicao: 1, total: 2, motivo: 'limite-conta' }, 'a/b#2': {} });
    expect(avisos).toHaveLength(4);
    expect(LEITORES.parked([], registrar)).toBeUndefined();
  });

  it('activity descarta a linha sem hora ou sem texto e o feed que não é lista', () => {
    const { avisos, registrar } = coletor();
    const linha = { t: 1, k: 'tool', text: 'lendo', a: 'leitor', s: 'leitura' };
    expect(LEITORES.activity({ a1: [linha, { t: 'x' }, { t: 2, text: 'sem tipo', a: null }], a2: 'feed', a3: [] }, registrar))
      .toEqual({ a1: [linha, { t: 2, k: 'info', text: 'sem tipo' }], a3: [] });
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
  it('lê a pendência mínima e a completa que o motor projeta, sem os campos que a tela não usa', () => {
    expect(lerPendencia(PENDENCIA)).toEqual(PENDENCIA);
    const completa = {
      ...PENDENCIA, createdAt: 1, verdict: 'approve', card: 'BT-1', prProprio: true, blockedReason: 'motivo', blockedKind: 'stale_head',
      headSha: 'aaa', blockedHead: 'bbb',
      pr: { repo: 'dono/repo', number: 12, url: 'https://github.com/dono/repo/pull/12', title: 'T', author: 'ana' },
      postRetry: { attempts: 2, exhausted: false },
      esperaCi: { desde: 1, checks: [{ nome: 'ci', estado: 'pending' }] },
      esperaProva: { desde: 1, tentativas: 0, aguardandoCi: false, proximaEm: 0, impedimento: '', pedeVoce: false },
      technical: { state: 'pass', message: 'Critérios técnicos comprovados.' },
      reasons: [{ text: 'regra', kind: 'gate' }], attention: [{ text: 'olhar', kind: 'content' }],
    };
    expect(lerPendencia({ ...completa, author: 'ana', account: 'rev', rounds: {}, technical: { ...completa.technical, violated: 0 }, esperaProva: { ...completa.esperaProva, soEnvelope: false } })).toEqual(completa);
  });

  it('só id e chave são exigidos', () => {
    for (const torta of [null, 'd1', [], {}, { id: 'd1' }, { key: 'a/b#1' }, { id: 7, key: 'a/b#1' }, { id: '', key: 'a/b#1' }, { id: 'd1', key: '' }]) {
      expect(lerPendencia(torta)).toBeUndefined();
    }
    expect(lerPendencia({ id: 'd1', key: 'a/b#1' })).toEqual({ id: 'd1', key: 'a/b#1', reportMarkdown: '', reasons: [], attention: [] });
  });

  it('campo torto ou null vira ausente, e a pendência aparece com o que deu para ler', () => {
    const lida = lerPendencia({
      id: 'd1', key: 'a/b#1', createdAt: 'ontem', verdict: null, card: null, pr: 'a/b#1', prProprio: 'sim', blockedReason: 7, blockedKind: null,
      postRetry: { attempts: '2' }, technical: { state: 'pass' }, reportMarkdown: null,
      reasons: [{ text: 'fica', kind: 'outro' }, { kind: 'gate' }, 'solto', { text: '', kind: 'gate' }], attention: 'x',
    });
    expect(lida).toEqual({ id: 'd1', key: 'a/b#1', reportMarkdown: '', reasons: [{ text: 'fica', kind: 'content' }], attention: [] });
    expect(Object.keys(lida ?? {}).sort()).toEqual(['attention', 'id', 'key', 'reasons', 'reportMarkdown']);
  });

  it('pr com campo torto fica com os campos bons', () => {
    expect(lerPendencia({ ...PENDENCIA, pr: { url: 'u', title: null, number: '12', author: 'ana' } })?.pr).toEqual({ url: 'u', author: 'ana' });
  });

  it('card aceita texto, null e o objeto antigo com key', () => {
    expect(lerPendencia({ ...PENDENCIA, card: 'BT-9' })?.card).toBe('BT-9');
    expect(lerPendencia({ ...PENDENCIA, card: { key: 'BT-9', title: 'x' } })?.card).toBe('BT-9');
    for (const sem of [null, '', {}, { key: 7 }, 9]) expect(lerPendencia({ ...PENDENCIA, card: sem })).toEqual(PENDENCIA);
  });

  // a marca de espera decide o bloco e os botões: torta, continua sendo espera
  it('espera do CI ou da prova que chega torta continua valendo como espera', () => {
    expect(lerPendencia({ ...PENDENCIA, esperaCi: { desde: 'x', checks: [{ nome: 'ci' }, 'solto', { estado: 3 }] } })?.esperaCi)
      .toEqual({ desde: 0, checks: [{ nome: 'ci', estado: '' }, { nome: '', estado: '' }] });
    expect(lerPendencia({ ...PENDENCIA, esperaCi: true })?.esperaCi).toEqual({ desde: 0, checks: [] });
    expect(lerPendencia({ ...PENDENCIA, esperaCi: null })?.esperaCi).toBeUndefined();
    expect(lerPendencia({ ...PENDENCIA, esperaProva: { tentativas: 2, pedeVoce: 'sim', impedimento: null } })?.esperaProva)
      .toEqual({ desde: 0, tentativas: 2, aguardandoCi: false, proximaEm: 0, impedimento: '', pedeVoce: false });
    expect(lerPendencia({ ...PENDENCIA, esperaProva: { pedeVoce: true } })?.esperaProva?.pedeVoce).toBe(true);
  });

  it('decisions descarta só a pendência sem id ou sem chave, e conta quantas foram', () => {
    const { avisos, registrar } = coletor();
    const resolvidas = [{ qualquer: 1 }];
    const lido = LEITORES.decisions({ pending: [PENDENCIA, { id: 'd2' }, null, { id: 'd3', key: 'a/b#3', reasons: 7 }], resolved: resolvidas }, registrar);
    expect(lido?.pending.map((p) => p.id)).toEqual(['d1', 'd3']);
    expect(lido?.ilegiveis).toBe(2);
    expect(lido?.resolved).toBe(resolvidas);
    expect(avisos).toEqual(['snapshot: 2 item(ns) de "decisions.pending" sem id ou sem chave, descartado(s)']);
  });

  it('decisions sem a lista das pendentes é forma errada da chave; sem as resolvidas, segue', () => {
    const { registrar } = coletor();
    for (const torto of [null, [], { resolved: [] }, { pending: {}, resolved: [] }]) expect(LEITORES.decisions(torto, registrar)).toBeUndefined();
    expect(LEITORES.decisions({ pending: [] }, registrar)).toEqual({ pending: [], resolved: [], ilegiveis: 0 });
  });
});
