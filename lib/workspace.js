// Leitura dos artefatos do workspace do Claude (dossiês por autor).
// Puro: lê arquivos de state e devolve estrutura, sem tocar no engine. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './paths.js';

// dossiês por autor (state/authors/<login>.md): histórico de reviews que fiz.
function parseTeam() {
  const dir = path.join(STATE_DIR, 'authors');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return []; }
  const team = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const login = f.replace(/\.md$/, '');
    const title = text.match(/^#\s+(.+)$/m);
    const nameM = title ? title[1].match(/\(([^)]+)\)/) : null;
    const entries = [];
    const blocks = text.split(/^##\s+/m).slice(1);
    for (const b of blocks) {
      const lines = b.split(/\r?\n/);
      const head = lines[0].split('·').map(s => s.trim());
      entries.push({
        date: head[0] || '',
        ref: head[1] || '',
        verdict: head[2] || '',
        bullets: lines.slice(1).filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\s*-\s*/, ''))
      });
    }
    team.push({ login, name: nameM ? nameM[1] : login, entries });
  }
  team.sort((a, b) => (b.entries[0] && b.entries[0].date || '').localeCompare(a.entries[0] && a.entries[0].date || ''));
  return team;
}

export default { parseTeam };
export { parseTeam };
