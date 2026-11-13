// O boot do SO comprova o término de toda a árvore, inclusive filhos órfãos.
import fs from 'node:fs/promises';

async function bootEpoch() {
  let text;
  try { text = await fs.readFile('/proc/stat', 'utf8'); }
  catch { return null; } // Sem prova do SO a operação continua protegida.
  const match = /^btime\s+(\d+)$/m.exec(text);
  const value = match ? Number(match[1]) * 1000 : undefined;
  return Number.isSafeInteger(value) && value > 0 && value <= Date.now() ? value : null;
}
const recoveryBoot = { read: bootEpoch };
export { recoveryBoot };
