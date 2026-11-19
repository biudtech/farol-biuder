import { activityReport } from '../usage/report.js';
import { activityRange } from '../usage/activity.js';
import { diario } from './usage-diario.js';
import { decisoesConhecidas, autoresDosPrs, comDetalheDaDecisao, consumoEmCsv, nomeDoCsv } from './consumo-das-sessoes.js';

// Rota de leitura sob demanda: o diário inteiro não vai no SSE a cada push. Com o diário no banco
// (lib/engine/usage-diario.js) as linhas vêm de uma consulta, na ordem do diário; o agrupamento
// por operação, a conclusão e as retentativas precisam do histórico inteiro de cada operação, e
// seguem no lib/usage/report.js sobre elas, para o resultado não mudar.
// Das decisões (consumo-das-sessoes.js) vêm o autor do PR de cada linha, para o filtro `author`,
// e, na página, as etapas, o card e os arquivos lidos da rodada (redesenho, lote 2, 19/11/2026).
// `semPagina`: o recorte inteiro, sem os campos da decisão por linha (o CSV).
export async function usageActivity(engine, params, { semPagina = false } = {}) {
  const query = Object.fromEntries(params);
  if (!activityRange(query).valid) return { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' };
  const rows = diario(engine).paraAtividade();
  const expected = Number(engine.usage?.totals?.sessions) || 0;
  if (!rows.length && expected > 0) return { ok: false, motivo: 'O agregado tem consumo, mas o diário detalhado não está disponível. O total do registro inteiro continua na Auditoria do registro, no Consumo.' };
  const decisoes = decisoesConhecidas(engine);
  const autores = autoresDosPrs(decisoes);
  const autorDe = (ref) => autores.get(String(ref || '').toLowerCase()) || '';
  const report = activityReport([{ device: 'local', rows }], query, Date.now(), { autorDe, semPagina });
  if (report.ok && !semPagina) report.history.rows = comDetalheDaDecisao(engine, report.history.rows, decisoes);
  return { ...report, incomplete: rows.length < expected };
}

// O que a rota responde: `{ status, body }`, ou `{ status, csv, nome }` com `formato=csv` (o único
// formato), que a rota escreve como texto para baixar. Formato desconhecido ou repetido é 400 com o
// campo, como no Histórico; período inválido segue a resposta de sempre, também no CSV.
export async function usageDaRota(engine, params, agora = Date.now()) {
  const formatos = params.getAll('formato');
  if (formatos.length > 1 || (formatos.length === 1 && !['', 'csv'].includes(formatos[0]))) {
    return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'formato' } };
  }
  if (formatos[0] !== 'csv') return { status: 200, body: await usageActivity(engine, params) };
  const recorte = await usageActivity(engine, params, { semPagina: true });
  if (!recorte.ok) return { status: 200, body: recorte };
  return { status: 200, csv: consumoEmCsv(recorte.history.rows, decisoesConhecidas(engine)), nome: nomeDoCsv(agora) };
}
