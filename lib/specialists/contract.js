// Forma do conhecimento curado. Texto do repositório continua sendo dado não confiável.
import { safeStringify } from '../io.js';
import { SHA, digest, check, sourceRef, safeText } from '../review-context/contrato.js';

const KINDS = ['architecture', 'contract', 'convention', 'critical', 'lesson'];
const ID = /^[a-f0-9]{32}$/;
const MAX_ENTRIES = 50, MAX_PATHS = 20;
const MAX_CONTEXT_BYTES = 64 * 1024;

function identityOf(raw) {
  check(raw && typeof raw === 'object', 'Informe conta, repositório e branch.');
  const { account, repo } = raw;
  check(typeof account === 'string' && /^[\w-]{1,39}$/.test(account), 'Conta inválida.');
  check(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && repo.length <= 200, 'Repositório inválido.');
  return { account: account.toLowerCase(), repo: repo.toLowerCase() };
}
function scopeOf(raw) {
  const identity = identityOf(raw), { branch } = raw;
  check(typeof branch === 'string' && branch.length > 0 && branch.length <= 240 && branch !== '@'
    && !/[\s\x00-\x1f~^:?*\[\\]/.test(branch) && !/\.\.|@\{|\/\//.test(branch)
    && branch.split('/').every(s => s && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith('.lock')), 'Branch inválida.');
  return { ...identity, branch };
}

function entryInput(raw) {
  check(raw && KINDS.includes(raw.kind), 'Tipo de conhecimento inválido.');
  check(Array.isArray(raw.sources) && raw.sources.length > 0 && raw.sources.length <= 8, 'Informe entre 1 e 8 evidências.');
  const sources = raw.sources.map(sourceRef);
  check(new Set(sources.map(s => `${s.path}:${s.start}:${s.end}`)).size === sources.length, 'Evidência duplicada.');
  check(raw.scope === undefined || ['global', 'module'].includes(raw.scope), 'Escopo da conclusão inválido.');
  return { kind: raw.kind, title: safeText(raw.title, 140, 'Título'), text: safeText(raw.text, 2000, 'Conclusão'), sources,
    ...(raw.scope ? { scope: raw.scope } : {}) };
}

function storedEntry(raw) {
  const entry = entryInput(raw);
  check(ID.test(raw.id) && Number.isFinite(raw.curatedAt) && raw.curatedAt > 0 && typeof raw.enabled === 'boolean', 'Curadoria inválida.');
  entry.sources = raw.sources.map(s => {
    const ref = sourceRef(s);
    check(SHA.test(s.commit) && SHA.test(s.blob), 'Revisão da fonte inválida.');
    return { ...ref, commit: s.commit, blob: s.blob, excerpt: safeText(s.excerpt, 4000, 'Evidência') };
  });
  const origin = raw.origin;
  check(origin?.type === 'manual' || (['pushback', 'audit'].includes(origin?.type) && typeof origin.key === 'string' && /^[\w.-]+\/[\w.-]+#[1-9]\d*(?:@[a-f0-9]{32}:[a-f0-9]{32})?$/.test(origin.key)
    && /^[a-f0-9]{64}$/.test(origin.fingerprint)), 'Origem inválida.');
  const provenance = { type: origin.type };
  if (origin.type !== 'manual') Object.assign(provenance, { key: origin.key, fingerprint: origin.fingerprint });
  return { ...entry, id: raw.id, curatedAt: raw.curatedAt, enabled: raw.enabled, origin: provenance };
}

function validateEntries(entries, scope) {
  check(Array.isArray(entries) && entries.length <= MAX_ENTRIES, `Limite de ${MAX_ENTRIES} conclusões; nada será truncado.`);
  const result = entries.map(storedEntry);
  check(new Set(result.map(e => e.id)).size === result.length, 'Conclusão duplicada.');
  check(new Set(result.flatMap(e => e.sources.map(s => s.path))).size <= MAX_PATHS, `Limite de ${MAX_PATHS} arquivos distintos.`);
  check(result.every(e => e.origin.type === 'manual' || e.origin.key.toLowerCase().startsWith(scope.repo + '#')), 'Lição de outro repositório.');
  check(Buffer.byteLength(safeStringify(result.filter(e => e.enabled)), 'utf8') <= MAX_CONTEXT_BYTES, 'Contexto ativo acima de 64 KiB. Reduza os trechos ou desative conclusões antes de continuar; nada foi truncado.');
  return result;
}
export { KINDS, SHA, ID, MAX_ENTRIES, MAX_PATHS, digest, check, identityOf, scopeOf, sourceRef, safeText, entryInput, storedEntry, validateEntries };
