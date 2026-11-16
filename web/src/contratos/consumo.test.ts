import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lerConsumoDoSnapshot, lerRespostaDoConsumo, type Relatorio } from './consumo';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

// O relatório é montado pelo próprio motor: lib/usage/report.js é função pura (sem disco, sem
// rede e com o "agora" por parâmetro), então o teste lê o que ele produz de verdade, em vez de
// uma cópia escrita à mão. Só o teste importa o arquivo; a tela, não.
type Relatar = (fontes: unknown[], consulta: Record<string, string>, agora: number) => unknown;

async function relatorDoMotor(): Promise<Relatar> {
  const modulo = await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ, 'lib/usage/report.js')).href) as { activityReport: Relatar };
  return modulo.activityReport;
}

// 16/11/2026, 15h em Brasília
const AGORA = Date.UTC(2026, 10, 16, 18, 0);
const HORA = 3600_000;
const id = (n: number): string => `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SESSOES = [
  { id: id(1), at: AGORA - 50 * HORA, kind: 'review', status: 'ok', ref: 'Dono/Repo#12', account: 'rev', model: 'Sonnet 5', billingKind: 'dir', provider: 'claude', inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 30, costUsd: 1.5, costSource: 'medido' },
  { id: id(2), at: AGORA - 26 * HORA, kind: 'review', status: 'parcial', ref: 'dono/repo#13', account: 'rev', model: 'Sonnet 5', billingKind: 'dir', provider: 'claude', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.25, costSource: 'estimado' },
  { id: id(2), at: AGORA - 25 * HORA, kind: 'review', status: 'ok', ref: 'dono/repo#13', account: 'rev', model: 'Sonnet 5', billingKind: 'dir', provider: 'claude', inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 2, costSource: 'medido' },
  { id: `pb-${id(3).slice(2)}`, at: AGORA - 2 * HORA, kind: 'pushback', status: 'erro', ref: 'dono/outro#4', account: 'rev', model: 'Opus 5', billingKind: 'apikey', provider: 'claude', inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, costSource: 'desconhecido' },
];

async function relatorio(consulta: Record<string, string> = {}): Promise<Relatorio> {
  const relatar = await relatorDoMotor();
  const lido = lerRespostaDoConsumo(relatar([{ device: 'local', rows: SESSOES }], consulta, AGORA));
  if (!lido?.ok) throw new Error('o leitor não leu o relatório do motor');
  return lido.relatorio;
}

describe('GET /api/usage: o leitor lê o que o motor monta', () => {
  it('o período, as somas, a série por dia e as quebras', async () => {
    const r = await relatorio();
    // sem start nem end o motor usa os 30 dias que terminam no dia de hoje dele
    expect(r.range).toEqual({ start: '2026-10-18', end: '2026-11-16' });
    expect(r.totals).toEqual({ attempts: 4, inputTokens: 317, outputTokens: 125, cacheReadTokens: 900, cacheCreationTokens: 30, costUsd: 3.75, estimatedUsd: 0.25, unknownCost: 1, subscription: 3 });
    expect(r.series.map((dia) => [dia.name, dia.attempts, dia.costUsd])).toEqual([['2026-11-14', 1, 1.5], ['2026-11-15', 2, 2.25], ['2026-11-16', 1, 0]]);
    // todos os tipos, na ordem do motor, inclusive os zerados
    expect(r.byKind.map((tipo) => [tipo.name, tipo.attempts])).toEqual([['review', 3], ['pushback', 1], ['chat', 0], ['tool', 0], ['outro', 0]]);
    expect(r.models).toEqual([
      { name: 'Sonnet 5', attempts: 3, inputTokens: 310, outputTokens: 125 },
      { name: 'Opus 5', attempts: 1, inputTokens: 7, outputTokens: 0 },
    ]);
    expect(r.options).toEqual({ kind: ['pushback', 'review'], model: ['Opus 5', 'Sonnet 5'], repo: ['Dono/Repo', 'dono/outro', 'dono/repo'] });
    expect(r.completed).toEqual({ reviews: 2, prs: 2 });
    expect(r.retries).toBe(1);
    expect(r.unidentified).toBe(0);
    expect(r.sinceDay).toBe('2026-11-14');
    expect(r.descartados).toBe(0);
  });

  it('o diário: a operação mais nova primeiro, com as tentativas dela da mais antiga à mais nova', async () => {
    const { history } = await relatorio();
    expect({ total: history.total, page: history.page, pages: history.pages, descartados: history.descartados }).toEqual({ total: 3, page: 0, pages: 1, descartados: 0 });
    expect(history.rows.map((op) => [op.kind, op.status, op.pr, op.attempts.length])).toEqual([
      ['pushback', 'erro', 'dono/outro#4', 1],
      ['review', 'ok', 'dono/repo#13', 2],
      ['review', 'ok', 'dono/repo#12', 1],
    ]);
    const retomada = history.rows[1];
    expect(retomada?.attempts.map((t) => [t.status, t.costUsd, t.costSource])).toEqual([['parcial', 0.25, 'estimado'], ['ok', 2, 'medido']]);
    // a operação leva os campos da tentativa mais recente
    expect(retomada).toMatchObject({ at: AGORA - 25 * HORA, model: 'Sonnet 5', ref: 'dono/repo#13', inputTokens: 200, outputTokens: 80, costUsd: 2 });
  });

  it('os filtros são do motor: o tipo recorta as somas, e a busca só o diário', async () => {
    const porTipo = await relatorio({ kind: 'pushback' });
    expect(porTipo.totals.attempts).toBe(1);
    expect(porTipo.series.map((dia) => dia.name)).toEqual(['2026-11-16']);
    const porBusca = await relatorio({ search: 'repo#12' });
    expect(porBusca.totals.attempts).toBe(4);
    expect(porBusca.history.rows.map((op) => op.pr)).toEqual(['dono/repo#12']);
  });

  it('período inválido: o motor responde ok false com a frase dele, sem campo', async () => {
    const relatar = await relatorDoMotor();
    const bruto = relatar([{ device: 'local', rows: SESSOES }], { start: '2026-11-20', end: '2026-11-10' }, AGORA);
    expect(lerRespostaDoConsumo(bruto)).toEqual({ ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' });
  });

  it('a rota responde 200 também na recusa, e não tem código nem campo', () => {
    const rota = fonte('lib/engine/usage-activity.js');
    expect(rota).toContain("return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }");
    expect(rota).not.toMatch(/code:|campo:/);
    expect(fonte('lib/http-server.js')).toContain("if (p === '/api/usage' && req.method === 'GET') return send(200, await usageActivity(engine, url.searchParams));");
  });
});

describe('GET /api/usage: forma inesperada', () => {
  const minimo = { ok: true, range: { start: '2026-11-01', end: '2026-11-16' }, totals: {}, history: { total: 0, page: 0, pages: 1, rows: [] } };

  it('só o período, as somas e a página do diário são exigidos; o resto entra vazio', () => {
    const lido = lerRespostaDoConsumo(minimo);
    expect(lido).toEqual({
      ok: true,
      relatorio: { range: minimo.range, totals: {}, series: [], byKind: [], models: [], history: { ...minimo.history, descartados: 0 }, options: { kind: [], model: [], repo: [] }, descartados: 0 },
    });
  });

  it('sem o que é exigido, a resposta não é lida', () => {
    for (const torto of [null, 'x', [], {}, { ok: true }, { ...minimo, range: { start: '16/11/2026', end: '2026-11-16' } }, { ...minimo, totals: null }, { ...minimo, history: { total: 0, page: 0, pages: 1 } }, { ...minimo, history: { total: '0', page: 0, pages: 1, rows: [] } }, { ok: false }, { ok: false, motivo: 3 }]) {
      expect(lerRespostaDoConsumo(torto), JSON.stringify(torto)).toBeNull();
    }
  });

  it('campo de forma errada conta como ausente, e item sem nome ou sem chave é descartado e contado', () => {
    const lido = lerRespostaDoConsumo({
      ...minimo,
      totals: { attempts: 3, costUsd: '1', inputTokens: -1, outputTokens: null, unknownCost: 1.5 },
      series: [{ name: '2026-11-16', costUsd: 2, attempts: 'dois' }, { costUsd: 1 }, null],
      byKind: [{ name: 'review' }, { name: '' }],
      models: [{ name: 'Sonnet 5', attempts: 1 }, 7],
      options: { kind: ['review', 3, ''], model: 'x' },
      history: { total: 2, page: 0, pages: 1, rows: [{ key: 'k1', at: 0, attempts: [{ at: 5, costUsd: 1 }, { costUsd: 2 }] }, { at: 5 }] },
      completed: { reviews: 1 },
      incomplete: 'sim',
    });
    if (!lido?.ok) throw new Error('não leu');
    const r = lido.relatorio;
    expect(r.totals).toEqual({ attempts: 3 });
    expect(r.series).toEqual([{ name: '2026-11-16', costUsd: 2 }]);
    expect(r.byKind).toEqual([{ name: 'review' }]);
    expect(r.models).toEqual([{ name: 'Sonnet 5', attempts: 1 }]);
    expect(r.descartados).toBe(4);
    expect(r.options).toEqual({ kind: ['review'], model: [], repo: [] });
    // a operação sem hora válida entra com o que há; a tentativa sem hora fica de fora
    expect(r.history.rows).toEqual([{ key: 'k1', attempts: [{ at: 5, costUsd: 1 }] }]);
    expect(r.history.descartados).toBe(1);
    expect(r.completed).toBeUndefined();
    expect(r.incomplete).toBeUndefined();
  });
});

describe('a chave usage do snapshot', () => {
  const avisos: string[] = [];
  const registrar = (aviso: string): void => { avisos.push(aviso); };

  // uma linha como linhaDeOrcamento (lib/engine/usage.js) a monta
  const teto = {
    id: 'p1', label: 'Assinatura do time', kind: 'assinatura', budgetDaily: 50, budgetTotal: null, budgetSince: null,
    budgetByWeekday: {}, budgetDates: {}, capHoje: 50, capOrigem: 'base', today: 12.5, sinceCutoff: 300,
    blocked: false, reason: null, parcialmenteEstimado: false, tipicoReview: 4.1, sugestaoDiaria: 70,
  };
  const sessao = { id: id(1), at: 1000, day: '2026-11-16', kind: 'review', ref: 'dono/repo#12', account: 'rev', profileId: 'p1', model: 'Sonnet 5', farol: '3.0.0-dev', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5, costSource: 'medido', status: 'ok', provider: 'claude', billingKind: 'dir' };
  const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });

  it('guarda o teto por perfil, as sessões recentes, a auditoria e a contagem do agregado', () => {
    const lido = lerConsumoDoSnapshot({
      totals: { sessions: 42, costUsd: 900 },
      series: [{ day: '2026-11-16', sessions: 1 }],
      budgets: [teto],
      recentSessions: [sessao],
      auditoria: { total: parte(42, 900), util: parte(40, 880), perdido: parte(2, 20), medido: parte(41, 890), estimado: parte(1, 10), desconhecido: parte(0, 0) },
      sessionsSince: 500,
      retentionDays: 120,
    }, registrar);
    expect(lido).toEqual({
      budgets: [{ id: 'p1', label: 'Assinatura do time', kind: 'assinatura', capHoje: 50, capOrigem: 'base', today: 12.5, sinceCutoff: 300, blocked: false, parcialmenteEstimado: false, tipicoReview: 4.1 }],
      recentSessions: [{ at: 1000, kind: 'review', status: 'ok', ref: 'dono/repo#12', model: 'Sonnet 5', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5, costSource: 'medido' }],
      auditoria: { total: parte(42, 900), util: parte(40, 880), perdido: parte(2, 20), medido: parte(41, 890), estimado: parte(1, 10), desconhecido: parte(0, 0) },
      sessionsSince: 500,
      sessoesContadas: 42,
    });
    expect(avisos).toEqual([]);
  });

  it('o que não é objeto mantém o valor anterior; chave sem as listas vira objeto vazio', () => {
    for (const torto of [null, 'x', 3, []]) expect(lerConsumoDoSnapshot(torto, registrar)).toBeUndefined();
    expect(lerConsumoDoSnapshot({}, registrar)).toEqual({});
    expect(lerConsumoDoSnapshot({ budgets: 'x', recentSessions: {}, auditoria: { total: { sessions: 1 } }, totals: { sessions: -1 } }, registrar)).toEqual({});
  });

  it('perfil sem id e sessão sem hora são descartados, contados e registrados sem o dado', () => {
    avisos.length = 0;
    const lido = lerConsumoDoSnapshot({ budgets: [teto, { label: 'sem id' }, null], recentSessions: [sessao, { ref: 'dono/segredo#1' }] }, registrar);
    expect(lido?.budgets).toHaveLength(1);
    expect(lido?.budgetsDescartados).toBe(2);
    expect(lido?.recentSessions).toHaveLength(1);
    expect(lido?.sessoesDescartadas).toBe(1);
    expect(avisos).toEqual([
      'snapshot: 2 item(ns) de "usage.budgets" com forma inesperada, descartado(s)',
      'snapshot: 1 item(ns) de "usage.recentSessions" com forma inesperada, descartado(s)',
    ]);
  });

  it('os campos lidos existem no que o motor emite', () => {
    const linha = /function linhaDeOrcamento\([\s\S]*?\n\}/.exec(fonte('lib/engine/usage.js'))?.[0] ?? '';
    for (const nome of ['id', 'label', 'kind', 'budgetTotal', 'budgetSince', 'capHoje', 'capOrigem', 'today', 'sinceCutoff', 'blocked', 'reason', 'parcialmenteEstimado', 'tipicoReview']) {
      expect(linha, nome).toMatch(new RegExp(`\\b${nome}\\b`));
    }
    const projecao = /const CAMPOS_DA_SESSAO = \[([\s\S]*?)\];/.exec(fonte('lib/engine/snapshot-usage.js'))?.[1] ?? '';
    for (const nome of ['at', 'kind', 'ref', 'model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd', 'costSource', 'status']) {
      expect(projecao, nome).toContain(`'${nome}'`);
    }
    // a tela diz que o motor manda no máximo as 100 sessões mais recentes
    expect(fonte('lib/engine/usage.js')).toContain('function recentSessionsFrom(engine, limit = 100) {');
    const resumo = fonte('lib/engine/usage.js');
    for (const nome of ['totals: store.totals', 'recentSessions,', 'auditoria: auditoriaDeConsumo(sessions)', 'sessionsSince:', 'budgets: budgetsFrom(']) expect(resumo, nome).toContain(nome);
  });
});
