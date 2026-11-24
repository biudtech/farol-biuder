import { ACTIVITY_KINDS, activityRows, activityOptions, activityRange, activityDay, groupActivity, matchesActivity } from './activity.js';

const UNKNOWN_COST = new Set(['desconhecido', 'sem-base']);
const FIELDS = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens'];
const zero = () => ({ attempts: 0, ok: 0, erro: 0, cancelada: 0, interrompida: 0, parcial: 0, descartada: 0, desconhecido: 0,
  inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  costUsd: 0, estimatedUsd: 0, unknownCost: 0, apiUsd: 0, apiEstimatedUsd: 0, apiUnknown: 0, subscription: 0, unknownBilling: 0 });

function add(bucket, row) {
  bucket.attempts++;
  bucket[row.status]++;
  for (const field of FIELDS) bucket[field] += row[field];
  if (UNKNOWN_COST.has(row.costSource)) bucket.unknownCost++;
  else bucket.costUsd += row.costUsd;
  if (row.costSource === 'estimado') bucket.estimatedUsd += row.costUsd;
  if (['assinatura', 'dir', 'maquina', 'codex', 'agy'].includes(row.billing)) bucket.subscription++;
  else if (['apikey', 'openrouter'].includes(row.billing)) addApi(bucket, row);
  else bucket.unknownBilling++;
}

function addApi(bucket, row) {
  if (UNKNOWN_COST.has(row.costSource)) bucket.apiUnknown++;
  else bucket.apiUsd += row.costUsd;
  if (row.costSource === 'estimado') bucket.apiEstimatedUsd += row.costUsd;
}

function aggregate(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!map.has(key)) map.set(key, zero());
    add(map.get(key), row);
  }
  return [...map].map(([name, values]) => ({ name, ...values }));
}

// Custo e tentativas por repositório no período, pelo `ref` da linha (`dono/nome#N`). Linha sem
// PR (ferramenta, conversa, registro antigo só com hash) entra no nome vazio, que a tela chama de
// "sem repositório": a soma das linhas fecha com o total do período.
function aggregateRepos(rows) {
  return aggregate(rows.map(row => ({ ...row, repo: row.ref.includes('#') ? row.ref.split('#')[0] : '' })), 'repo');
}

// Por modelo: tentativas, tokens, pensamento e custo. O custo é o que o provedor mediu por modelo
// quando fecha com a linha (activity.js, modelParts), senão o da linha; a linha de custo desconhecido
// não soma, e conta em `unknownCost` de cada modelo dela, como nos totais.
function aggregateModels(rows) {
  const map = new Map();
  for (const row of rows) {
    const parts = row.modelParts ?? [{ model: row.model, inputTokens: row.inputTokens, outputTokens: row.outputTokens, thinkingTokens: row.thinkingTokens, costUsd: row.costUsd }];
    const counted = new Set();
    const unknown = UNKNOWN_COST.has(row.costSource);
    for (const part of parts) {
      if (!map.has(part.model)) map.set(part.model, { name: part.model, attempts: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, unknownCost: 0 });
      const bucket = map.get(part.model);
      if (!counted.has(part.model)) { bucket.attempts++; if (unknown) bucket.unknownCost++; }
      counted.add(part.model);
      bucket.inputTokens += part.inputTokens; bucket.outputTokens += part.outputTokens; bucket.thinkingTokens += part.thinkingTokens;
      if (!unknown) bucket.costUsd += part.costUsd;
    }
  }
  return [...map.values()];
}

// A página do histórico de sessões: 8 por padrão, até 50; valor torto vale o padrão.
const PAGE_SIZE = 8;
const PAGE_SIZE_MAX = 50;
function pageSizeOf(query) {
  const n = Math.floor(Number(query.pageSize));
  return n >= 1 ? Math.min(n, PAGE_SIZE_MAX) : PAGE_SIZE;
}

// `all`: o recorte inteiro numa página só (o CSV, lib/engine/usage-activity.js).
function historyOf(groups, query, all = false) {
  let rows = groups;
  if (query.focus === 'review') rows = rows.filter(r => r.completedInRange && r.kind === query.focus);
  if (query.focus === 'pr') {
    const seen = new Set();
    rows = rows.filter(r => {
      if (!r.completedInRange || r.kind !== 'review' || !r.pr || seen.has(r.pr)) return false;
      seen.add(r.pr); return true;
    });
  }
  const search = String(query.search || '').toLocaleLowerCase().slice(0, 200);
  rows = rows.filter(r => `${r.ref} ${r.kind} ${r.model}`.toLocaleLowerCase().includes(search));
  if (all) return { total: rows.length, page: 0, pages: 1, pageSize: rows.length, rows };
  const size = pageSizeOf(query);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(0, Math.floor(Number(query.page) || 0)), pages - 1);
  return { total: rows.length, page, pages, pageSize: size, rows: rows.slice(page * size, page * size + size) };
}

// Agrupa antes de filtrar: uma retomada conserva a identidade; seu consumo pertence
// ao dia em que ocorreu, e a conclusão ao último resultado da operação.
// `contexto`: `autorDe(ref)`, o autor do PR de cada linha (sem ele ninguém tem autor), e
// `semPagina`, o histórico inteiro do recorte numa página só.
export function activityReport(sources, query = {}, now = Date.now(), contexto = {}) {
  const range = activityRange(query, now);
  if (!range.valid) return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' };
  const all = activityRows(sources);
  // o autor gravado na linha vale; só a linha antiga, sem ele, o busca nas decisões (que têm teto)
  if (typeof contexto.autorDe === 'function') for (const row of all) if (!row.author) row.author = String(contexto.autorDe(row.ref) || '').toLowerCase();
  const selected = all.filter(row => matchesActivity(row, query));
  const inRange = row => row.day >= range.start && row.day <= range.end;
  const attempts = selected.filter(inRange);
  const groups = groupActivity(all).filter(row => row.attempts.some(a => inRange(a) && matchesActivity(a, query))).sort((a, b) => b.at - a.at);
  for (const row of groups) row.completedInRange = row.identified && row.status === 'ok' && inRange(row) && matchesActivity(row, query);
  // No recorte sem página (o CSV), cada operação leva as tentativas dela que passam no período e
  // nos filtros, para a linha somar só elas e o arquivo fechar com `totals`.
  if (contexto.semPagina === true) for (const row of groups) row.noRecorte = row.attempts.filter(a => inRange(a) && matchesActivity(a, query));
  const completed = groups.filter(row => row.completedInRange);
  const reviews = completed.filter(row => row.kind === 'review');
  const totals = zero(); attempts.forEach(row => add(totals, row));
  const byKind = ACTIVITY_KINDS.map(name => ({ name, ...zero() }));
  for (const row of attempts) add(byKind.find(bucket => bucket.name === row.kind), row);
  const since = all.reduce((earliest, row) => Math.min(earliest, row.at), Infinity);
  return {
    ok: true, range, options: activityOptions(all), totals, byKind,
    completed: { reviews: reviews.length,
      prs: new Set(reviews.map(r => r.pr).filter(Boolean)).size },
    retries: groups.reduce((n, row) => n + row.attempts.slice(1).filter(a => inRange(a) && matchesActivity(a, query)).length, 0),
    unidentified: attempts.filter(row => !row.identified).length,
    since: Number.isFinite(since) ? since : null, sinceDay: activityDay(since), series: aggregate(attempts, 'day'), models: aggregateModels(attempts),
    repos: aggregateRepos(attempts), porGatilho: aggregate(attempts, 'gatilho'),
    history: historyOf(groups, query, contexto.semPagina === true),
  };
}
