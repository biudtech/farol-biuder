// Projeção de leitura do diário permanente. Não altera registros.
import { canonicalPrKey } from '../engine/chaves-de-postagem.js';
import { FUSO_DO_DIA, TEMPOS } from '../constants.js';
import { modelLabel } from '../format.js';
import { gatilhoDaLinha } from '../engine/gatilho-da-sessao.js';

export const ACTIVITY_KINDS = ['review', 'pushback', 'chat', 'tool', 'outro'];
const STATES = ['ok', 'erro', 'cancelada', 'interrompida', 'parcial', 'descartada'];
const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens'];
const text = v => typeof v === 'string' ? v : '';
const number = v => Number.isFinite(v) && v >= 0 ? v : 0;
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_DIA, year: 'numeric', month: '2-digit', day: '2-digit' });

function prReference(row) {
  const local = canonicalPrKey(row.ref);
  if (local) return local;
  return /^[a-f0-9]{64}$/.test(text(row.refHash)) ? row.refHash : '';
}

// O uso por modelo da linha: tokens, pensamento e o custo que o provedor mediu por modelo
// (`costUSD`). Sem a medição por modelo que feche com os tokens da linha, a linha inteira (com o
// custo dela) fica num modelo só, "Sem atribuição por modelo".
function modelParts(row) {
  if (!row.modelUsage || typeof row.modelUsage !== 'object') return null;
  const fields = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'costUSD'];
  const parts = Object.entries(row.modelUsage).slice(0, 50)
    .filter(([, usage]) => fields.some(field => number(usage?.[field]) > 0)).map(([model, usage]) => ({
    model: modelLabel(model) || model, inputTokens: number(usage?.inputTokens), outputTokens: number(usage?.outputTokens),
    thinkingTokens: number(usage?.thinkingTokens), costUsd: number(usage?.costUSD),
  }));
  const input = parts.reduce((n, p) => n + p.inputTokens, 0);
  const output = parts.reduce((n, p) => n + p.outputTokens, 0);
  if (input !== number(row.inputTokens) || output !== number(row.outputTokens)) {
    return [{ model: 'Sem atribuição por modelo', inputTokens: number(row.inputTokens), outputTokens: number(row.outputTokens),
      thinkingTokens: number(row.thinkingTokens), costUsd: number(row.costUsd) }];
  }
  return parts;
}

export function activityDay(at) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? DAY_FORMAT.format(date) : '';
}

export function validActivityDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return false;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function activityRange(query, now = Date.now()) {
  const end = query.end ?? activityDay(now);
  const start = query.start ?? activityDay(now - 29 * TEMPOS.DIA_MS);
  const valid = validActivityDay(start) && validActivityDay(end) && start <= end && end <= activityDay(now);
  return { start, end, valid };
}

export function normalizeActivity(row, index, device = 'local') {
  const s = row || {};
  const id = text(s.id || s.localId);
  const identified = /^(a|s|pb|f|c)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const account = text(s.account || s.accountHash);
  const ref = text(s.ref || s.refHash);
  const kind = ACTIVITY_KINDS.includes(s.kind) ? s.kind : 'outro';
  const profile = text(s.profileId);
  const identity = [device, account, profile, kind, id];
  const key = identity.map(v => `${v.length}:${v}`).join('|');
  const status = STATES.includes(s.status) ? s.status : 'desconhecido';
  const item = {
    key: identified ? key : `legacy:${device}:${index}`, identified,
    attemptId: text(s.attemptId), at: number(s.at), day: activityDay(number(s.at)),
    kind, status, account, profile, ref, pr: prReference(s), device, model: text(s.model) || 'desconhecido',
    provider: text(s.provider) || 'desconhecido', billing: text(s.billingKind) || 'desconhecido',
    costUsd: number(s.costUsd), costSource: text(s.costSource) || 'medido',
    duration: number(s.at) - number(s.iniciadaEm), durationKnown: number(s.iniciadaEm) > 0,
    modelParts: modelParts(s), gatilho: gatilhoDaLinha({ kind, gatilho: s.gatilho }), author: '',
  };
  for (const field of TOKEN_FIELDS) item[field] = number(s[field]);
  return item;
}

export function activityRows(sources) {
  const seen = new Set();
  return sources.flatMap(source => (source.rows || []).map((s, i) => normalizeActivity(s, i, source.device)))
    .filter(row => {
      if (!row.at || !row.day) return false;
      const key = row.attemptId && `${row.device}:${row.attemptId}`;
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
}

export function groupActivity(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.key)) grouped.set(row.key, []);
    grouped.get(row.key).push(row);
  }
  return [...grouped.values()].map(attempts => {
    attempts.sort((a, b) => a.at - b.at);
    return { ...attempts.at(-1), attempts };
  });
}

// `profile` é o perfil do Claude da sessão; `author`, o autor do PR (lido do histórico das
// decisões, sem caixa: lib/engine/usage-activity.js).
const FILTER_FIELDS = ['account', 'provider', 'model', 'kind', 'device', 'profile'];

export function matchesActivity(row, query) {
  if (FILTER_FIELDS.some(field => query[field] && query[field] !== 'all' && row[field] !== query[field])) return false;
  if (query.author && query.author !== 'all' && row.author !== String(query.author).toLowerCase()) return false;
  return !query.repo || query.repo === 'all' || row.ref.split('#')[0] === query.repo;
}

export function activityOptions(rows) {
  const options = {};
  for (const field of FILTER_FIELDS) options[field] = [...new Set(rows.map(r => r[field]))].sort();
  options.repo = [...new Set(rows.map(r => r.ref).filter(r => r.includes('#')).map(r => r.split('#')[0]))].sort();
  options.author = [...new Set(rows.map(r => r.author).filter(Boolean))].sort();
  return options;
}
