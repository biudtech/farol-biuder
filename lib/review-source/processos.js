// Snapshot sem nome, comando, caminho, usuário ou ambiente dos processos.
import io from '../io.js';
import { semAsVariaveis } from '../env.js';
const PROCESS_QUERY_TIMEOUT_MS = 8000;

function validProcess(row) {
  return Number.isInteger(row.pid) && row.pid > 0 && Number.isInteger(row.parent) && row.parent >= 0
    && Number.isFinite(row.rss) && row.rss >= 0 && Number.isFinite(row.cpuMs) && row.cpuMs >= 0 && Number.isFinite(row.born);
}
function cpuTime(raw) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(raw);
  if (!m) return NaN;
  return ((Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + Number(m[3]) * 60 + Number(m[4])) * 1000;
}
function posixProcesses(raw) {
  const rows = String(raw).trim().split('\n').map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) return null;
    return { pid: Number(m[1]), parent: Number(m[2]), rss: Number(m[3]) * 1024, cpuMs: cpuTime(m[4]), born: Date.parse(m[5]) };
  });
  return rows.length && rows.every(r => r && validProcess(r)) && new Set(rows.map(r => r.pid)).size === rows.length ? rows : null;
}
async function readProcesses() {
  const result = await io.run('ps', ['-axo', 'pid=,ppid=,rss=,time=,lstart='], { env: { ...semAsVariaveis([]), LC_ALL: 'C' }, timeout: PROCESS_QUERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  if (!result.ok) return null;
  return posixProcesses(result.stdout);
}
function descendants(rows, roots) {
  const owned = new Set(roots), children = new Map();
  for (const r of rows) {
    if (!children.has(r.parent)) children.set(r.parent, []);
    children.get(r.parent).push(r);
  }
  const queue = [...roots];
  for (const pid of queue) for (const child of children.get(pid) || []) {
    const parent = rows.find(r => r.pid === pid);
    if (!owned.has(child.pid) && (!parent || child.born >= parent.born)) { owned.add(child.pid); queue.push(child.pid); }
  }
  return owned;
}
function classifyProcesses(rows, rootPid, sessions) {
  const own = descendants(rows, [rootPid]), cliRoots = [], missing = [], measured = [];
  for (const session of sessions) {
    const row = rows.find(r => r.pid === session.pid);
    if (row && own.has(row.pid) && row.born >= session.startedAt - 2000) { cliRoots.push(row.pid); measured.push(session); }
    else missing.push(session.id);
  }
  const clis = descendants(rows, cliRoots);
  const bySession = measured.map(session => {
    const ids = descendants(rows, [session.pid]);
    return { id: session.id, rows: rows.filter(r => ids.has(r.pid)) };
  });
  return { farol: rows.filter(r => own.has(r.pid) && !clis.has(r.pid)), clis: rows.filter(r => clis.has(r.pid)), missing, bySession };
}
export { readProcesses, posixProcesses, classifyProcesses, cpuTime };
