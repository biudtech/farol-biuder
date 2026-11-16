import { describe, expect, it } from 'vitest';
import { lerDetalheDaRevisao, lerPaginaDoHistorico, lerRevisao } from './historico';
import { LEITORES } from './snapshot';

// O que decisionForUi (lib/engine/public-review.js) emite numa revisão resolvida.
const INTEIRA = {
  id: 'd1', createdAt: 1, resolvedAt: 2, key: 'dono/repo#12', card: 'BT-9', cardMet: true, verdict: 'approve',
  status: 'auto_approved', action: 'approve', account: 'revisora', headSha: 'abc', viaAdmin: true, prProprio: true,
  pr: { repo: 'dono/repo', number: 12, url: 'https://github.com/dono/repo/pull/12', title: 'Corrige', author: 'ana' },
  technical: { state: 'pass', message: 'Critérios técnicos comprovados.' },
  rounds: { schema: 1, id: 'r1', ordinal: 2, mode: 'enforce', parentCount: 1, lateCount: 0, droppedCount: 0, resolvedOnUnchangedCount: 1, unresolvedCount: 3, unverified: false, changedContext: true },
  stages: { totalMs: 9000, stages: [{ id: 'ler', label: 'Leitura', ms: 4000 }, { id: 'x', label: 'Outra', ms: 5000 }] },
  verificationCheckpoint: { total: 5, confirmedCount: 4, conflictCount: 1 },
  reportMarkdown: '## Review', reasons: [{ text: 'regra', kind: 'gate' }], attention: [{ text: 'ponto', kind: 'content' }],
};

describe('revisão do histórico', () => {
  it('lê o que a projeção do motor emite, e larga o que a tela não usa', () => {
    expect(lerRevisao(INTEIRA)).toEqual({
      id: 'd1', createdAt: 1, resolvedAt: 2, key: 'dono/repo#12', card: 'BT-9', verdict: 'approve', status: 'auto_approved', action: 'approve',
      viaAdmin: true, prProprio: true, pr: INTEIRA.pr, technical: INTEIRA.technical,
      rounds: { id: 'r1', ordinal: 2, mode: 'enforce', parentCount: 1, lateCount: 0, droppedCount: 0, resolvedOnUnchangedCount: 1, unresolvedCount: 3, unverified: false, changedContext: true },
      stages: INTEIRA.stages, verificationCheckpoint: INTEIRA.verificationCheckpoint,
      reportMarkdown: '## Review', reasons: INTEIRA.reasons, attention: INTEIRA.attention,
    });
  });

  it('só id e chave são exigidos: sem um deles o item é descartado', () => {
    expect(lerRevisao({ id: 'd1', key: 'dono/repo#1' })).toEqual({ id: 'd1', key: 'dono/repo#1', reportMarkdown: '', reasons: [], attention: [] });
    for (const torto of [null, 'x', [], {}, { id: 'd1' }, { key: 'k' }, { id: '', key: 'k' }, { id: 'd1', key: 7 }]) expect(lerRevisao(torto)).toBeUndefined();
  });

  it('campo de forma errada conta como ausente, e o item fica', () => {
    const lido = lerRevisao({
      id: 'd1', key: 'k', resolvedAt: 'ontem', status: 7, action: null, verdict: {}, card: { key: 'BT-1' }, pr: 'x', viaAdmin: 'sim',
      technical: { message: '' }, rounds: { schema: 2 }, stages: { totalMs: 'x', stages: 'y' }, verificationCheckpoint: { total: 'x' },
      reportMarkdown: 9, reasons: 'x', attention: [{ text: 'a' }, { text: '' }, 3],
    });
    expect(lido).toEqual({ id: 'd1', key: 'k', card: 'BT-1', reportMarkdown: '', reasons: [], attention: [{ text: 'a', kind: 'content' }] });
  });

  it('etapa sem duração sai, e as outras ficam', () => {
    expect(lerRevisao({ id: 'd1', key: 'k', stages: { totalMs: 10, stages: [{ id: 'a', label: 'A', ms: 10 }, { id: 'b' }, null] } })?.stages)
      .toEqual({ totalMs: 10, stages: [{ id: 'a', label: 'A', ms: 10 }] });
  });
});

describe('página do histórico (GET /api/decisions)', () => {
  const resposta = (extra: object = {}) => ({ ok: true, page: 2, pageSize: 30, total: 61, pages: 3, items: [INTEIRA], repos: ['dono/repo'], ...extra });

  it('lê a resposta inteira', () => {
    const lida = lerPaginaDoHistorico(resposta());
    expect(lida).toMatchObject({ page: 2, pageSize: 30, total: 61, pages: 3, repos: ['dono/repo'], descartados: 0 });
    expect(lida?.items.map((i) => i.id)).toEqual(['d1']);
  });

  it('item sem id ou sem chave é descartado e contado, e os outros entram', () => {
    const lida = lerPaginaDoHistorico(resposta({ items: [INTEIRA, { key: 'sem-id' }, null, { id: 'd2', key: 'dono/repo#2' }] }));
    expect(lida?.items.map((i) => i.id)).toEqual(['d1', 'd2']);
    expect(lida?.descartados).toBe(2);
  });

  it('repos de forma errada vira lista vazia, e entrada que não é texto sai', () => {
    expect(lerPaginaDoHistorico(resposta({ repos: 'x' }))?.repos).toEqual([]);
    expect(lerPaginaDoHistorico(resposta({ repos: ['a/b', 3, '', null] }))?.repos).toEqual(['a/b']);
  });

  it('sem o envelope esperado a resposta é recusada', () => {
    for (const torta of [
      null, [], {}, resposta({ ok: false }), resposta({ items: 'x' }), resposta({ page: '1' }), resposta({ total: -1 }),
      resposta({ pages: 1.5 }), resposta({ pageSize: Number.NaN }), { ok: false, code: 'parametro_invalido', campo: 'q' },
    ]) expect(lerPaginaDoHistorico(torta)).toBeNull();
  });
});

describe('detalhe por chave (GET /api/decision)', () => {
  it('lê o envelope: encontrada com a revisão, ou não encontrada', () => {
    expect(lerDetalheDaRevisao({ found: true, decision: { id: 'd1', key: 'k' } })).toEqual({
      encontrada: true, revisao: { id: 'd1', key: 'k', reportMarkdown: '', reasons: [], attention: [] },
    });
    expect(lerDetalheDaRevisao({ found: false, decision: null })).toEqual({ encontrada: false });
  });

  it('recusa o que não é o envelope, e o encontrado que não dá para ler', () => {
    for (const torto of [null, {}, { found: 'sim' }, { found: true, decision: null }, { found: true, decision: { key: 'k' } }, { id: 'd1', key: 'k' }]) {
      expect(lerDetalheDaRevisao(torto)).toBeNull();
    }
  });
});

describe('pushbacks do snapshot', () => {
  it('lê a contestação de cada PR, e descarta a entrada sem desfecho', () => {
    const avisos: string[] = [];
    const lido = LEITORES.pushbacks({
      'dono/repo#1': { author: 'ana', outcome: 'author_right', note: 'era intencional', at: 5, source: 'auto', confidence: 'low', status: 'pending' },
      'dono/repo#2': { outcome: 'mixed', note: '', author: 7 },
      'dono/repo#3': { note: 'sem desfecho' },
      'dono/repo#4': null,
    }, (a) => { avisos.push(a); });
    expect(lido).toEqual({
      'dono/repo#1': { author: 'ana', outcome: 'author_right', note: 'era intencional', at: 5, source: 'auto', status: 'pending' },
      'dono/repo#2': { outcome: 'mixed' },
    });
    expect(avisos).toEqual(['snapshot: 2 entrada(s) de "pushbacks" com forma inesperada, descartada(s)']);
  });

  it('o que não é mapa é forma errada da chave', () => {
    for (const torto of [null, [], 'x', 3]) expect(LEITORES.pushbacks(torto, () => {})).toBeUndefined();
  });
});
