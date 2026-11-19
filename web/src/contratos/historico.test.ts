import { describe, expect, it } from 'vitest';
import { lerCsv, lerDetalheDaRevisao, lerPaginaDoHistorico, lerRevisao } from './historico';
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
      prProprio: true, pr: INTEIRA.pr, technical: INTEIRA.technical,
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

describe('critérios do card (GET /api/decision)', () => {
  it('lê texto e atende; atende fora de booleano é não conferido; item sem texto sai; lista vazia é ausente', () => {
    const lido = lerRevisao({ id: 'd1', key: 'k', criteriosDoCard: [
      { texto: 'A', atende: true }, { texto: 'B', atende: false }, { texto: 'C', atende: 'sim' }, { texto: 'D' },
      { texto: '  ' }, { atende: true }, null, 'solto',
    ] });
    expect(lido?.criteriosDoCard).toEqual([
      { texto: 'A', atende: true }, { texto: 'B', atende: false }, { texto: 'C', atende: null }, { texto: 'D', atende: null },
    ]);
    expect(lerRevisao({ id: 'd1', key: 'k', criteriosDoCard: [] })).not.toHaveProperty('criteriosDoCard');
    expect(lerRevisao({ id: 'd1', key: 'k', criteriosDoCard: { texto: 'A' } })).not.toHaveProperty('criteriosDoCard');
  });

  it('o texto passa pela máscara de segredo', () => {
    const lido = lerRevisao({ id: 'd1', key: 'k', criteriosDoCard: [{ texto: 'usar ghp_0123456789abcdefghijABCDEFGHIJ0123456789 no teste', atende: true }] });
    expect(lido?.criteriosDoCard?.[0]?.texto).not.toContain('ghp_');
  });
});

describe('página do histórico (GET /api/decisions)', () => {
  const resposta = (extra: object = {}) => ({ ok: true, page: 2, pageSize: 30, total: 61, pages: 3, items: [INTEIRA], repos: ['dono/repo'], ...extra });

  it('lê a resposta inteira', () => {
    const lida = lerPaginaDoHistorico(resposta());
    expect(lida).toMatchObject({ page: 2, pageSize: 30, total: 61, pages: 3, repos: ['dono/repo'], descartados: 0 });
    expect(lida?.items.map((i) => i.id)).toEqual(['d1']);
  });

  it('a contagem dos últimos 7 dias entra quando é contagem; o CSV só como texto', () => {
    expect(lerPaginaDoHistorico(resposta({ recentes7Dias: 146 }))?.recentes7Dias).toBe(146);
    expect(lerPaginaDoHistorico(resposta())).not.toHaveProperty('recentes7Dias');
    expect(lerPaginaDoHistorico(resposta({ recentes7Dias: -1 }))).not.toHaveProperty('recentes7Dias');
    expect(lerPaginaDoHistorico(resposta({ recentes7Dias: '3' }))).not.toHaveProperty('recentes7Dias');
    expect(lerCsv('a,b\n')).toBe('a,b\n');
    expect(lerCsv({ csv: 'x' })).toBeNull();
  });

  it('achados, rodadas e tamanho do detalhe: campo a campo, com o texto mascarado', () => {
    const lido = lerRevisao({ id: 'd1', key: 'k',
      achados: [
        { severidade: 'blocking', titulo: 'usa ghp_0123456789abcdefghijABCDEFGHIJ0123456789', resumo: 'r', arquivo: 'a.ts', linha: 3, trecho: [{ linha: 3, tipo: 'adicionada', texto: 'x' }, { linha: 'quatro', texto: 'y' }] },
        { severidade: 'elogio', titulo: 'fora' }, { severidade: 'nitpick', titulo: '  ' }, { severidade: 'question', titulo: 'sem arquivo', linha: 9, trecho: [{ linha: 1, texto: 'z' }] },
      ],
      rodadasDoPr: { itens: [{ id: 'd0', rodada: 1, em: 5, head: 'abc1234', parecer: 'approve', publicado: 'approve' }, { id: 'd1', rodada: 0 }, { id: 'd2', rodada: 2, head: 'x', publicado: '' }], inicioIncerto: true },
      tamanhoDoPr: { arquivos: 14, adicoes: 612, remocoes: null },
    });
    expect(lido?.achados).toHaveLength(2);
    expect(lido?.achados?.[0]?.titulo).not.toContain('ghp_');
    expect(lido?.achados?.[0]?.trecho).toEqual([{ linha: 3, tipo: 'adicionada', texto: 'x' }]);
    expect(lido?.achados?.[1]).toEqual({ severidade: 'question', titulo: 'sem arquivo' });
    expect(lido?.rodadasDoPr).toEqual({ itens: [{ id: 'd0', rodada: 1, em: 5, head: 'abc1234', parecer: 'approve', publicado: 'approve' }, { id: 'd2', rodada: 2, publicado: null }], inicioIncerto: true });
    expect(lido?.tamanhoDoPr).toEqual({ arquivos: 14 });
    expect(lerRevisao({ id: 'd1', key: 'k', achados: [], rodadasDoPr: { itens: [] }, tamanhoDoPr: { arquivos: -1 } })).toEqual(lerRevisao({ id: 'd1', key: 'k' }));
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

// GET /api/decision, execucao.perfis e execucao.sessoes (redesenho, lote 2:
// lib/engine/detalhe-da-decisao.js, sessaoDaLinha).
describe('execução da rodada: perfis e sessões', () => {
  const comExecucao = (execucao: unknown) => lerRevisao({ id: 'd1', key: 'dono/repo#1', execucao })?.execucao;

  it('lê os perfis e as sessões como o motor emite, na ordem dele', () => {
    const lida = comExecucao({
      tentativas: 2, modelos: ['opus'], duracaoMs: 600000, custoUsd: 1.5,
      perfis: ['perfil-a', 'perfil-b'],
      sessoes: [
        { id: 't1', em: 1000, modelo: 'opus', perfil: 'perfil-a', status: 'ok', gatilho: 'primeira', retomada: null, duracaoMs: 240000, custoUsd: 0.5 },
        { id: 't2', em: 2000, modelo: null, perfil: 'perfil-b', status: 'falhou', gatilho: 'commit_novo', retomada: 'retomada' },
      ],
    });
    expect(lida?.perfis).toEqual(['perfil-a', 'perfil-b']);
    expect(lida?.sessoes).toEqual([
      { id: 't1', em: 1000, modelo: 'opus', perfil: 'perfil-a', status: 'ok', gatilho: 'primeira', duracaoMs: 240000, custoUsd: 0.5 },
      { id: 't2', em: 2000, perfil: 'perfil-b', status: 'falhou', gatilho: 'commit_novo', retomada: 'retomada' },
    ]);
  });

  it('entrada torta: item que não é objeto sai, campo de forma errada conta como ausente, lista vazia é ausente', () => {
    const lida = comExecucao({
      tentativas: 1, modelos: [],
      perfis: ['ok', '', 3, null, '  '],
      sessoes: [
        'texto', null, 7,
        { id: 9, em: 'ontem', modelo: 5, perfil: {}, status: 3, gatilho: 'inventado', retomada: 'talvez', duracaoMs: -1, custoUsd: 'caro' },
      ],
    });
    expect(lida?.perfis).toEqual(['ok']);
    // o item com tudo torto fica, sem campo nenhum: ele é uma tentativa do diário
    expect(lida?.sessoes).toEqual([{ id: '', status: 'desconhecido' }]);
    expect(comExecucao({ tentativas: 1, modelos: [], perfis: 'a', sessoes: {} })).toEqual({ tentativas: 1, modelos: [] });
    expect(comExecucao({ tentativas: 1, modelos: [], perfis: [], sessoes: [] })).toEqual({ tentativas: 1, modelos: [] });
  });

  it('o texto de fora passa pela máscara de segredo', () => {
    const segredo = `ghp_${'a1B2'.repeat(9)}`;
    const lida = comExecucao({ tentativas: 1, modelos: [], perfis: [segredo], sessoes: [{ id: 't1', perfil: segredo, modelo: segredo, status: 'ok' }] });
    expect(JSON.stringify(lida)).not.toContain(segredo);
    // o desfecho da sessão também é texto de fora
    const comStatus = comExecucao({ tentativas: 1, modelos: [], sessoes: [{ id: 't1', status: `falhou ${segredo}` }] });
    expect(JSON.stringify(comStatus)).not.toContain(segredo);
    expect(comStatus?.sessoes?.[0]?.status).toBeTruthy();
  });
});
