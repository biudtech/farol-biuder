import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lerConsumoDoSnapshot, lerCsvDoConsumo, lerRespostaDoConsumo, type Relatorio } from './consumo';

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
    // três por assinatura; a de chave de API tem custo desconhecido, e por isso não soma em apiUsd
    expect(r.totals).toEqual({
      attempts: 4, inputTokens: 317, outputTokens: 125, thinkingTokens: 0, cacheReadTokens: 900, cacheCreationTokens: 30, costUsd: 3.75, estimatedUsd: 0.25, unknownCost: 1,
      subscription: 3, unknownBilling: 0, apiUsd: 0, apiEstimatedUsd: 0, apiUnknown: 1,
    });
    expect(r.series.map((dia) => [dia.name, dia.attempts, dia.costUsd])).toEqual([['2026-11-14', 1, 1.5], ['2026-11-15', 2, 2.25], ['2026-11-16', 1, 0]]);
    // todos os tipos, na ordem do motor, inclusive os zerados
    expect(r.byKind.map((tipo) => [tipo.name, tipo.attempts])).toEqual([['review', 3], ['pushback', 1], ['chat', 0], ['tool', 0], ['outro', 0]]);
    // o custo por modelo é o que o motor somou; a de custo desconhecido conta à parte
    expect(r.models).toEqual([
      { name: 'Sonnet 5', attempts: 3, inputTokens: 310, outputTokens: 125, thinkingTokens: 0, costUsd: 3.75, unknownCost: 0 },
      { name: 'Opus 5', attempts: 1, inputTokens: 7, outputTokens: 0, thinkingTokens: 0, costUsd: 0, unknownCost: 1 },
    ]);
    expect(r.options).toEqual({ kind: ['pushback', 'review'], model: ['Opus 5', 'Sonnet 5'], repo: ['Dono/Repo', 'dono/outro', 'dono/repo'], author: [], profile: [] });
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

  it('a modalidade vem em três parcelas: assinatura contada, chave de API só em dólar, e sem registro contada à parte', async () => {
    const relatar = await relatorDoMotor();
    const sessao = (n: number, extra: Record<string, unknown>) => ({ id: id(n), at: AGORA - n * HORA, kind: 'review', status: 'ok', ref: `dono/repo#${n}`, account: 'rev', model: 'Sonnet 5', inputTokens: 1, outputTokens: 1, costUsd: 1, costSource: 'medido', ...extra });
    // uma com modalidade conhecida e duas gravadas sem ela (registro antigo)
    const lido = lerRespostaDoConsumo(relatar([{ device: 'local', rows: [sessao(1, { billingKind: 'dir' }), sessao(2, {}), sessao(3, { billingKind: '' })] }], {}, AGORA));
    if (!lido?.ok) throw new Error('não leu');
    expect(lido.relatorio.totals).toMatchObject({ attempts: 3, subscription: 1, unknownBilling: 2, apiUsd: 0, apiUnknown: 0 });
    // com chave de API o motor soma o dólar, e não conta as execuções
    const comApi = lerRespostaDoConsumo(relatar([{ device: 'local', rows: [sessao(1, { billingKind: 'apikey', costUsd: 2 }), sessao(2, { billingKind: 'apikey', costUsd: 0.5, costSource: 'estimado' })] }], {}, AGORA));
    if (!comApi?.ok) throw new Error('não leu');
    expect(comApi.relatorio.totals).toMatchObject({ attempts: 2, subscription: 0, unknownBilling: 0, apiUsd: 2.5, apiEstimatedUsd: 0.5, apiUnknown: 0 });
    const soma = fonte('lib/usage/report.js');
    expect(soma).toContain("if (['assinatura', 'dir', 'maquina', 'codex', 'agy'].includes(row.billing)) bucket.subscription++;");
    expect(soma).toContain("else if (['apikey', 'openrouter'].includes(row.billing)) addApi(bucket, row);");
    expect(soma).toContain('else bucket.unknownBilling++;');
  });

  it('a operação traz também a tentativa que ficou fora do período, com o dia de Brasília dela', async () => {
    const relatar = await relatorDoMotor();
    const tentativa = (horasAtras: number, status: string) => ({ id: id(9), at: AGORA - horasAtras * HORA, kind: 'review', status, ref: 'dono/repo#9', account: 'rev', model: 'Sonnet 5', billingKind: 'dir', inputTokens: 10, outputTokens: 5, costUsd: 1, costSource: 'medido' });
    // a mesma operação com uma tentativa no dia 14 e a retomada no dia 15; o pedido é só do dia 15
    const lido = lerRespostaDoConsumo(relatar([{ device: 'local', rows: [tentativa(50, 'parcial'), tentativa(25, 'ok')] }], { start: '2026-11-15', end: '2026-11-15' }, AGORA));
    if (!lido?.ok) throw new Error('não leu');
    const r = lido.relatorio;
    // a soma conta só a do período, e a linha do diário traz as duas
    expect(r.totals).toMatchObject({ attempts: 1, costUsd: 1 });
    expect(r.history.rows.map((op) => op.attempts.map((t) => [t.day, t.status]))).toEqual([[['2026-11-14', 'parcial'], ['2026-11-15', 'ok']]]);
    // a operação entra quando alguma tentativa passa, e viaja com todas
    expect(fonte('lib/usage/report.js')).toContain('const groups = groupActivity(all).filter(row => row.attempts.some(a => inRange(a) && matchesActivity(a, query)))');
    expect(fonte('lib/usage/activity.js')).toContain('return { ...attempts.at(-1), attempts };');
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

  it('a recusa de período responde 200 com { ok: false, motivo }, também no CSV, e sem código nem campo', () => {
    const rota = fonte('lib/engine/usage-activity.js');
    expect(rota).toContain("{ ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }");
    expect(rota).toContain('if (formatos[0] !== \'csv\') return { status: 200, body: comOcorrencias(engine, await usageActivity(engine, params), params) };');
    expect(rota).toContain('if (!report.ok) return report;');
    expect(rota).toContain('if (!recorte.ok) return { status: 200, body: recorte };');
    expect(fonte('lib/http-server.js')).toContain("if (p === '/api/usage' && req.method === 'GET') return enviarHistorico(res, send, await usageDaRota(engine, url.searchParams));");
  });

  it('o único 400 da rota é o do formato torto, com o campo "formato"', () => {
    const rota = fonte('lib/engine/usage-activity.js');
    expect(rota.match(/status: 400/g)).toHaveLength(1);
    expect(rota.match(/code:/g)).toHaveLength(1);
    expect(rota.match(/campo:/g)).toHaveLength(1);
    expect(rota).toContain("if (formatos.length > 1 || (formatos.length === 1 && !['', 'csv'].includes(formatos[0]))) {\n    return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'formato' } };");
  });
});

describe('GET /api/usage: as revisões que não publicaram (24/11/2026)', () => {
  const comOcorrencias = async (ocorrencias: unknown): Promise<Relatorio> => {
    const relatar = await relatorDoMotor();
    const bruto = { ...(relatar([{ device: 'local', rows: SESSOES }], {}, AGORA) as Record<string, unknown>), ocorrencias };
    const lido = lerRespostaDoConsumo(bruto);
    if (!lido?.ok) throw new Error('o leitor não leu o relatório');
    return lido.relatorio;
  };

  it('lê cada ocorrência como o motor a projeta, e descarta a torta', async () => {
    const boa = { at: AGORA - HORA, ref: 'dono/repo#64', tipo: 'nao_iniciada', motivo: 'pr_mergeado', texto: 'A revisão não chegou a abrir a sessão do Claude: o PR já tinha sido mergeado.', origem: 'clique', sessao: id(9), head: 'a'.repeat(40), etapa: 'antes_da_sessao' };
    const semOrigem = { at: boa.at, ref: boa.ref, tipo: boa.tipo, motivo: boa.motivo, texto: boa.texto, sessao: boa.sessao, head: boa.head, etapa: boa.etapa, classe: 'rede' };
    const r = await comOcorrencias([boa, { ...boa, at: 'ontem' }, { ...boa, texto: '' }, { ...boa, ref: 7 }, null, { ...boa, classe: 'rede', origem: 3 }]);
    expect(r.ocorrencias).toEqual([boa, semOrigem]);
  });

  it('ausente ou fora de forma vira lista vazia, e o relatório continua', async () => {
    expect((await comOcorrencias(undefined)).ocorrencias).toEqual([]);
    expect((await comOcorrencias({ a: 1 })).ocorrencias).toEqual([]);
  });

  it('os campos e os textos vêm do módulo do motor, e o CSV não os leva', () => {
    const modulo = fonte('lib/engine/ocorrencias-da-revisao.js');
    expect(modulo).toContain("const CAMPOS_DA_TELA = ['at', 'ref', 'sessao', 'tipo', 'motivo', 'texto', 'origem', 'head', 'etapa', 'classe'];");
    expect(modulo).toContain("pr_mergeado: 'o PR já tinha sido mergeado',");
    expect(fonte('lib/engine/consumo-das-sessoes.js')).not.toContain('ocorrencia');
  });
});

describe('GET /api/usage: o que o redesenho acrescentou (lote 2)', () => {
  type RelatarComContexto = (fontes: unknown[], consulta: Record<string, string>, agora: number, contexto?: Record<string, unknown>) => unknown;
  const comLote2 = [
    { id: id(1), at: AGORA - 3 * HORA, iniciadaEm: AGORA - 3 * HORA - 90_000, kind: 'review', status: 'ok', ref: 'dono/repo#12', account: 'rev', profileId: 'perfil-a', gatilho: 'commit_novo', model: 'Sonnet 5', billingKind: 'dir', inputTokens: 10, outputTokens: 4, thinkingTokens: 6, cacheReadTokens: 100, cacheCreationTokens: 20, costUsd: 0.5, costSource: 'medido' },
    { id: id(2), at: AGORA - 2 * HORA, kind: 'review', status: 'ok', ref: 'dono/outro#3', account: 'rev', profileId: 'perfil-b', model: 'Opus 5', billingKind: 'dir', inputTokens: 1, outputTokens: 1, thinkingTokens: 0, costUsd: 1, costSource: 'medido' },
  ];

  async function relatarCom(consulta: Record<string, string> = {}): Promise<Relatorio> {
    const { activityReport } = await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ, 'lib/usage/report.js')).href) as { activityReport: RelatarComContexto };
    const autorDe = (ref: string) => (ref === 'dono/repo#12' ? 'Ana' : '');
    const lido = lerRespostaDoConsumo(activityReport([{ device: 'local', rows: comLote2 }], consulta, AGORA, { autorDe }));
    if (!lido?.ok) throw new Error('não leu');
    return lido.relatorio;
  }

  it('lê o pensamento, o perfil, o gatilho, o autor e a duração de cada linha, e as opções de autor e perfil', async () => {
    const r = await relatarCom();
    expect(r.totals.thinkingTokens).toBe(6);
    expect(r.options).toMatchObject({ author: ['ana'], profile: ['perfil-a', 'perfil-b'] });
    const [maisNova, maisAntiga] = r.history.rows;
    expect(maisAntiga).toMatchObject({ profile: 'perfil-a', gatilho: 'commit_novo', author: 'ana', thinkingTokens: 6, duracaoMs: 90_000 });
    // sem a hora de início o motor não sabe a duração: a linha fica sem ela, e não com zero
    expect(maisNova?.duracaoMs).toBeUndefined();
    // registro sem marca conta como primeira na revisão; linha sem autor fica sem ele
    expect(maisNova).toMatchObject({ gatilho: 'primeira', profile: 'perfil-b' });
    expect(maisNova?.author).toBeUndefined();
    expect(r.history.pageSize).toBe(8);
  });

  it('o custo e o pensamento por modelo, e a soma por gatilho', async () => {
    const r = await relatarCom();
    expect(r.models).toEqual([
      { name: 'Sonnet 5', attempts: 1, inputTokens: 10, outputTokens: 4, thinkingTokens: 6, costUsd: 0.5, unknownCost: 0 },
      { name: 'Opus 5', attempts: 1, inputTokens: 1, outputTokens: 1, thinkingTokens: 0, costUsd: 1, unknownCost: 0 },
    ]);
    expect(r.porGatilho?.map((g) => [g.name, g.attempts, g.costUsd])).toEqual([['commit_novo', 1, 0.5], ['primeira', 1, 1]]);
  });

  it('os filtros de autor e perfil são do motor', async () => {
    expect((await relatarCom({ author: 'ANA' })).totals.attempts).toBe(1);
    expect((await relatarCom({ profile: 'perfil-b' })).history.rows.map((op) => op.pr)).toEqual(['dono/outro#3']);
  });

  it('a decisão da rodada: etapas, card e arquivos lidos, cada um só quando vem', () => {
    const lido = lerRespostaDoConsumo({
      ok: true, range: { start: '2026-11-01', end: '2026-11-16' }, totals: {},
      porGatilho: [{ name: '', attempts: 1 }, { name: 'primeira', attempts: 2 }, { attempts: 3 }],
      history: {
        total: 2, page: 0, pages: 1, pageSize: 8,
        rows: [
          { key: 'k1', at: 5, decisaoId: 'd1', card: 'PROJ-9', arquivosLidos: 12, etapas: [{ id: 'fontes', label: 'Fontes', ms: 300 }, { id: 'x', label: 'Torta', ms: -1 }, { label: 'sem id', ms: 3 }, 'nada'], attempts: [{ at: 5 }] },
          { key: 'k2', at: 6, card: '', arquivosLidos: 1.5, etapas: 'x', attempts: [] },
        ],
      },
    });
    if (!lido?.ok) throw new Error('não leu');
    const [primeira, segunda] = lido.relatorio.history.rows;
    expect(primeira).toMatchObject({ decisaoId: 'd1', card: 'PROJ-9', arquivosLidos: 12, etapas: [{ id: 'fontes', label: 'Fontes', ms: 300 }, { id: 'x', label: 'Torta' }] });
    expect(segunda).toEqual({ key: 'k2', at: 6, attempts: [] });
    // o gatilho vazio (conversa e ferramenta) fica, como o repositório vazio; sem nome é descartado
    expect(lido.relatorio.porGatilho?.map((g) => g.name)).toEqual(['', 'primeira']);
    expect(lido.relatorio.descartados).toBe(1);
  });

  it('os nomes lidos são os que o motor grava', () => {
    const sessoes = fonte('lib/engine/consumo-das-sessoes.js');
    for (const trecho of ["const out = { ...linha, decisaoId: String(d.id || '') };", 'out.etapas = etapas;', 'out.card = card;', 'out.arquivosLidos = lidos;', "({ id: String(s.id || '').slice(0, 40), label: String(s.label || '').slice(0, 80), ms: Number(s.ms) >= 0 ? Number(s.ms) : 0 })"]) {
      expect(sessoes, trecho).toContain(trecho);
    }
    const diario = fonte('lib/usage/activity.js');
    expect(diario).toContain('duration: number(s.at) - number(s.iniciadaEm), durationKnown: number(s.iniciadaEm) > 0,');
    expect(diario).toContain('modelParts: modelParts(s), gatilho: gatilhoDaLinha({ kind, gatilho: s.gatilho }),');
    expect(diario).toContain('author: text(s.author).toLowerCase(),');
    expect(diario).toContain('if (text(s.card)) item.card = text(s.card);');
    expect(fonte('lib/usage/report.js')).toContain("repos: aggregateRepos(attempts), porGatilho: aggregate(attempts, 'gatilho'),");
  });
});

describe('GET /api/usage: forma inesperada', () => {
  const minimo = { ok: true, range: { start: '2026-11-01', end: '2026-11-16' }, totals: {}, history: { total: 0, page: 0, pages: 1, rows: [] } };

  it('só o período, as somas e a página do diário são exigidos; o resto entra vazio', () => {
    const lido = lerRespostaDoConsumo(minimo);
    expect(lido).toEqual({
      ok: true,
      relatorio: { range: minimo.range, totals: {}, series: [], byKind: [], models: [], history: { ...minimo.history, descartados: 0 }, options: { kind: [], model: [], repo: [], author: [], profile: [] }, ocorrencias: [], descartados: 0 },
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
    expect(r.options).toEqual({ kind: ['review'], model: [], repo: [], author: [], profile: [] });
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

  const sessao = { id: id(1), at: 1000, day: '2026-11-16', kind: 'review', ref: 'dono/repo#12', account: 'rev', profileId: 'p1', model: 'Sonnet 5', farol: '3.0.0-dev', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5, costSource: 'medido', status: 'ok', provider: 'claude', billingKind: 'dir' };
  const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });

  it('guarda as sessões recentes, a auditoria e a contagem do agregado', () => {
    const lido = lerConsumoDoSnapshot({
      totals: { sessions: 42, costUsd: 900 },
      series: [{ day: '2026-11-16', sessions: 1 }],
      recentSessions: [sessao],
      auditoria: { total: parte(42, 900), util: parte(40, 880), perdido: parte(2, 20), medido: parte(41, 890), estimado: parte(1, 10), desconhecido: parte(0, 0) },
      sessionsSince: 500,
      retentionDays: 120,
    }, registrar);
    expect(lido).toEqual({
      recentSessions: [{ at: 1000, day: '2026-11-16', kind: 'review', status: 'ok', ref: 'dono/repo#12', model: 'Sonnet 5', profile: 'p1', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5, costSource: 'medido' }],
      auditoria: { total: parte(42, 900), util: parte(40, 880), perdido: parte(2, 20), medido: parte(41, 890), estimado: parte(1, 10), desconhecido: parte(0, 0) },
      sessionsSince: 500,
      sessoesContadas: 42,
    });
    expect(avisos).toEqual([]);
  });

  it('o que não é objeto mantém o valor anterior; chave sem as listas vira objeto vazio', () => {
    for (const torto of [null, 'x', 3, []]) expect(lerConsumoDoSnapshot(torto, registrar)).toBeUndefined();
    expect(lerConsumoDoSnapshot({}, registrar)).toEqual({});
    expect(lerConsumoDoSnapshot({ recentSessions: {}, auditoria: { total: { sessions: 1 } }, totals: { sessions: -1 } }, registrar)).toEqual({});
  });

  it('sessão sem hora é descartada, contada e registrada sem o dado', () => {
    avisos.length = 0;
    const lido = lerConsumoDoSnapshot({ recentSessions: [sessao, { ref: 'dono/segredo#1' }] }, registrar);
    expect(lido?.recentSessions).toHaveLength(1);
    expect(lido?.sessoesDescartadas).toBe(1);
    expect(avisos).toEqual(['snapshot: 1 item(ns) de "usage.recentSessions" com forma inesperada, descartado(s)']);
  });

  // O teto de gasto saiu do motor em 16/11/2026. Um motor antigo ainda manda `usage.budgets`:
  // a tela não guarda a lista, não registra aviso e não lê bloqueio dela.
  it('a lista de teto de um motor antigo não é guardada nem vira aviso', () => {
    avisos.length = 0;
    const teto = { id: 'p1', label: 'Assinatura do time', kind: 'assinatura', budgetDaily: 0, capHoje: 0, capOrigem: 'base', today: 12.5, blocked: true, reason: 'diario' };
    const lido = lerConsumoDoSnapshot({ budgets: [teto, { label: 'sem id' }], recentSessions: [sessao] }, registrar);
    expect(lido).toEqual({ recentSessions: [expect.objectContaining({ at: 1000 })] });
    expect(JSON.stringify(lido)).not.toMatch(/budget|blocked|capHoje/);
    expect(avisos).toEqual([]);
  });

  it('os campos lidos existem no que o motor emite', () => {
    const projecao = /const CAMPOS_DA_SESSAO = \[([\s\S]*?)\];/.exec(fonte('lib/engine/snapshot-usage.js'))?.[1] ?? '';
    for (const nome of ['at', 'kind', 'ref', 'model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd', 'costSource', 'status']) {
      expect(projecao, nome).toContain(`'${nome}'`);
    }
    // a tela diz que o motor manda no máximo as 100 sessões mais recentes
    expect(fonte('lib/engine/usage.js')).toContain('function recentSessionsFrom(engine, limit = 100) {');
    const resumo = fonte('lib/engine/usage.js');
    // a auditoria vem do diário, onde ele morar (o banco da telemetria ou o JSON): lib/engine/usage-diario.js
    for (const nome of ['totals: store.totals', 'recentSessions,', 'auditoria: d.auditoria()', 'sessionsSince:']) expect(resumo, nome).toContain(nome);
    // o motor não tem teto de gasto: nem a lista por perfil, nem o gate
    expect(resumo).not.toMatch(/budgets|budgetBlockedFor|profileBudgetStatus/);
  });
});

describe('o CSV de GET /api/usage?formato=csv', () => {
  const csv = (corpo: unknown, cabecalhos: Record<string, string | null> = {}) => lerCsvDoConsumo({ corpo, cabecalhos: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': null, ...cabecalhos } });

  it('o texto do arquivo, com o nome que o motor deu no Content-Disposition', () => {
    expect(csv('Quando,Tipo\n', { 'content-disposition': 'attachment; filename="farol-consumo-2026-11-16.csv"' })).toEqual({ ok: true, csv: 'Quando,Tipo\n', nome: 'farol-consumo-2026-11-16.csv' });
    // sem o cabeçalho (o motor em outra origem não o expõe ao navegador), o nome fica com a tela
    expect(csv('Quando,Tipo\n')).toEqual({ ok: true, csv: 'Quando,Tipo\n', nome: null });
    // nome que não é um arquivo simples não é seguido
    for (const ruim of ['attachment; filename="../x.csv"', 'attachment; filename="a/b.csv"', 'attachment; filename=""', 'attachment; filename="x.exe"', 'inline']) {
      expect(csv('a\n', { 'content-disposition': ruim }), ruim).toEqual({ ok: true, csv: 'a\n', nome: null });
    }
  });

  it('a resposta em JSON não é arquivo: a recusa do motor volta com a frase dele', () => {
    const recusa = JSON.stringify({ ok: false, motivo: 'Período inválido.' });
    expect(csv(recusa, { 'content-type': 'application/json; charset=utf-8' })).toEqual({ ok: false, motivo: 'Período inválido.' });
    // mesmo sem o tipo, um corpo que é o objeto JSON da recusa não vira arquivo
    expect(csv(recusa, { 'content-type': null })).toEqual({ ok: false, motivo: 'Período inválido.' });
    // JSON que não é a recusa é resposta torta
    expect(csv(JSON.stringify({ ok: true }), { 'content-type': 'application/json' })).toBeNull();
    expect(csv('{torto', { 'content-type': 'application/json' })).toBeNull();
  });

  it('o que não é texto com cabeçalhos é resposta torta', () => {
    expect(lerCsvDoConsumo('a,b\n')).toBeNull();
    expect(lerCsvDoConsumo({ corpo: 1, cabecalhos: {} })).toBeNull();
    expect(lerCsvDoConsumo(null)).toBeNull();
  });
});
