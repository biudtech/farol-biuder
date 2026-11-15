import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { instalarDom } from './helpers/dom-stub.js';
import { activityReport } from '../lib/usage/report.js';

const NOW = Date.parse('2026-10-26T16:00:00Z');
const row = n => ({ id: `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at: NOW,
  kind: 'review', status: 'ok', ref: 'org/repo#1', account: 'dev', model: 'Sonnet', inputTokens: 10, outputTokens: 5 });

test('atualização periódica repinta indicadores, recursos e modelos quando chegam execuções', async t => {
  const { doc } = instalarDom();
  let clock = NOW;
  const rows = [row(1)];
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async url => ({ json: async () => activityReport([{ device: 'local', rows }],
    Object.fromEntries(new URL(url, 'http://localhost').searchParams), clock) }));
  const { renderActivity } = await import('../ui/telas/consumo-atividade.js?refresh');
  await renderActivity({ window: 30 });
  assert.match(doc.querySelector('#activityBody').innerHTML, /Revisões concluídas.*?<b>1<\/b>/s);
  rows.push(row(2));
  clock += 31000;
  await renderActivity({ window: 30 });
  const body = doc.querySelector('#activityBody').innerHTML;
  assert.match(body, /Revisões concluídas.*?<b>2<\/b>/s);
  assert.match(body, /Tokens registrados · entrada \+ saída<\/span><b>30<\/b>/);
  assert.match(body, /Sonnet<\/span><span>2 execuções/);
  assert.match(doc.querySelector('#activityHistory').innerHTML, /de 2 execuções/);
});

test('tabela vazia vira estado vazio e a tela usa um termo só para execução', async () => {
  const { activityBodyHtml, activityHistoryHtml } = await import('../ui/pure/consumo-atividade.js');
  const vazio = activityBodyHtml(activityReport([{ device: 'local', rows: [] }], {}, NOW));
  assert.match(vazio, /<h3>Atividade por tipo<\/h3>/);
  assert.match(vazio, /<p class="sys-note activity-empty">Nenhuma execução de IA neste período\.<\/p>/);
  assert.doesNotMatch(vazio, /<table class="activity-table"/);
  const relatorio = activityReport([{ device: 'local', rows: [row(1)] }], {}, NOW);
  const cheio = activityBodyHtml(relatorio);
  assert.match(cheio, /<table class="activity-table"/);
  assert.doesNotMatch(cheio, /activity-empty/);
  const hist = activityHistoryHtml(relatorio);
  assert.match(hist, /Tokens da execução/);
  assert.doesNotMatch(hist, /Tokens da operação/);
});

test('index: orçamento fora do details, termos de entrada e saída e título geral', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const top = html.indexOf('id="usageBudgetTop"'), adv = html.indexOf('id="usageAdvanced"');
  assert.ok(top > 0 && top < adv, 'usageBudgetTop antes de usageAdvanced');
  assert.ok(html.indexOf('id="usageBudget"') < adv, 'usageBudget fora do details');
  assert.match(html, /data-metric="input"[^>]*>Entrada</);
  assert.match(html, /data-metric="output"[^>]*>Saída</);
  assert.match(html, /<h3>Linha do tempo geral \(sem filtros\)<\/h3>/);
  assert.match(html, /<h3>Execuções recentes<\/h3>/);
  assert.doesNotMatch(html, /Sessões recentes/);
});
