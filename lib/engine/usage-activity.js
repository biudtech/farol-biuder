import { activityReport } from '../usage/report.js';
import { activityRange, activityDay } from '../usage/activity.js';
import { TEMPOS } from '../constants.js';
import { ocorrenciasDoPeriodo } from './ocorrencias-da-revisao.js';
import { diario } from './usage-diario.js';
import { decisoesConhecidas, autoresDosPrs, comDetalheDaDecisao, consumoEmCsv, nomeDoCsv } from './consumo-das-sessoes.js';

// Rota de leitura sob demanda: o diário inteiro não vai no SSE a cada push. Com o diário no banco
// (lib/engine/usage-diario.js) as linhas vêm de uma consulta, na ordem do diário; o agrupamento
// por operação, a conclusão e as retentativas precisam do histórico inteiro de cada operação, e
// seguem no lib/usage/report.js sobre elas, para o resultado não mudar.
// Das decisões (consumo-das-sessoes.js) vêm o autor do PR de cada linha, para o filtro `author`,
// e, na página, as etapas, o card e os arquivos lidos da rodada (redesenho, lote 2, 19/11/2026).
// `semPagina`: o recorte inteiro, sem os campos da decisão por linha (o CSV).
export async function usageActivity(engine, params, opcoes = {}) {
  return (await relatorioComDecisoes(engine, params, opcoes)).report;
}

// O relatório e as decisões que ele leu, para o CSV não ler as decisões de novo.
async function relatorioComDecisoes(engine, params, { semPagina = false } = {}) {
  const query = Object.fromEntries(params);
  if (!activityRange(query).valid) return { report: { ok: false, motivo: 'Selecione um intervalo válido, sem datas futuras.' }, decisoes: [] };
  const rows = diario(engine).paraAtividade();
  const expected = Number(engine.usage?.totals?.sessions) || 0;
  if (!rows.length && expected > 0) return { report: { ok: false, motivo: 'O agregado tem consumo, mas o diário detalhado não está disponível. O total do registro inteiro continua na Auditoria do registro, no Consumo.' }, decisoes: [] };
  const decisoes = decisoesConhecidas(engine);
  const autores = autoresDosPrs(decisoes);
  const autorDe = (ref) => autores.get(String(ref || '').toLowerCase()) || '';
  const report = activityReport([{ device: 'local', rows }], query, Date.now(), { autorDe, semPagina });
  if (report.ok && !semPagina) report.history.rows = comDetalheDaDecisao(engine, report.history.rows, decisoes);
  return { report: { ...report, incomplete: rows.length < expected }, decisoes };
}

// As ocorrências da revisão do período (ocorrencias-da-revisao.js, 24/11/2026): as revisões que
// terminaram sem publicar e sem decisão, no dia de Brasília do resto da rota e com o filtro `repo`.
// Só no JSON: não entram no CSV nem no snapshot.
function comOcorrencias(engine, report, params) {
  if (!report.ok) return report;
  const { start, end } = report.range;
  // a janela larga cobre qualquer fuso; o corte fino é pelo dia do motor (activityDay)
  const desde = Date.parse(`${start}T00:00:00Z`) - TEMPOS.DIA_MS;
  const ate = Date.parse(`${end}T23:59:59.999Z`) + TEMPOS.DIA_MS;
  const ocorrencias = ocorrenciasDoPeriodo(engine, desde, ate, { repo: params.get('repo') || '' })
    .filter((o) => { const dia = activityDay(o.at); return dia >= start && dia <= end; });
  return { ...report, ocorrencias };
}

// O que a rota responde: `{ status, body }`, ou `{ status, csv, nome }` com `formato=csv` (o único
// formato), que a rota escreve como texto para baixar. Formato desconhecido ou repetido é 400 com o
// campo, como no Histórico; período inválido segue a resposta de sempre, também no CSV.
export async function usageDaRota(engine, params, agora = Date.now()) {
  const formatos = params.getAll('formato');
  if (formatos.length > 1 || (formatos.length === 1 && !['', 'csv'].includes(formatos[0]))) {
    return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'formato' } };
  }
  if (formatos[0] !== 'csv') return { status: 200, body: comOcorrencias(engine, await usageActivity(engine, params), params) };
  const { report: recorte, decisoes } = await relatorioComDecisoes(engine, params, { semPagina: true });
  if (!recorte.ok) return { status: 200, body: recorte };
  return { status: 200, csv: consumoEmCsv(recorte.history.rows, decisoes), nome: nomeDoCsv(agora) };
}
