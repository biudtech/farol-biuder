import { activityReport } from '../usage/report.js';
import { activityRange } from '../usage/activity.js';
import { diario } from './usage-diario.js';

// Rota de leitura sob demanda: o diário inteiro não vai no SSE a cada push. Com o diário no banco
// (lib/engine/usage-diario.js) as linhas vêm de uma consulta, na ordem do diário; o agrupamento
// por operação, a conclusão e as retentativas precisam do histórico inteiro de cada operação, e
// seguem no lib/usage/report.js sobre elas, para o resultado não mudar.
export async function usageActivity(engine, params) {
  const query = Object.fromEntries(params);
  if (!activityRange(query).valid) return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' };
  const rows = diario(engine).paraAtividade();
  const expected = Number(engine.usage?.totals?.sessions) || 0;
  if (!rows.length && expected > 0) return { ok: false, motivo: 'O agregado tem consumo, mas o diário detalhado não está disponível. O total do registro inteiro continua na Auditoria do registro, no Consumo.' };
  return { ...activityReport([{ device: 'local', rows }], query), incomplete: rows.length < expected };
}
