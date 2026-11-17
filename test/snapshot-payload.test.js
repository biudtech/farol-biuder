import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-snapshot-payload-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const usage = await import('../lib/engine/usage.js');
const { snapshotUsage } = await import('../lib/engine/snapshot-usage.js');
const { snapshotReviewActions } = await import('../lib/engine/snapshot-decisions.js');
const { diario } = await import('../lib/engine/usage-diario.js');
const { sessoesDoDiario } = await import('../lib/engine/telemetria-do-motor.js');
const { fecharTodos } = await import('../lib/telemetria/banco.js');
after(() => { fecharTodos(); fs.rmSync(home, { recursive: true, force: true }); });

function consumoSintetico() {
  const e = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: { claudeProfiles: [] } };
  const now = new Date();
  const measured = usage.extractUsage({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 }, total_cost_usd: .5 }, 'modelo-0');
  for (let i = 119; i >= 0; i--) {
    const day = usage.localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    usage.applyUsage(e.usage, day, 'review', 'fixture', `modelo-${i % 12}`, measured, 'perfil');
    e.usageSessions.sessions.push({ id: `a-${i}`, at: now.getTime() - i * 86400000,
      day, kind: 'review', ref: `fixture/app#${i}`, account: 'fixture', profileId: 'perfil', model: `modelo-${i % 12}`, farol: 'fixture',
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 7, cacheCreationTokens: 3,
      costUsd: .5, costSource: 'medido', status: 'ok', provider: 'claude', billingKind: 'apikey',
      modelUsage: { principal: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0 } },
      accounting: { source: 'fixture', sessionId: `a-${i}`, internal: 'metadado interno da contabilidade' } });
  }
  return e;
}

// O que a projeção compacta pode tirar de um balde: só campo numérico que vale zero (o front lê
// o ausente como zero). Todo o resto tem de chegar igual, campo a campo, e nada pode sobrar.
function assertMesmoBalde(compacto, completo, onde) {
  for (const [campo, valor] of Object.entries(completo)) {
    if (valor === 0) assert.ok(compacto[campo] === undefined || compacto[campo] === 0, `${onde}: ${campo} zerado`);
    else assert.deepEqual(compacto[campo], valor, `${onde}: ${campo}`);
  }
  for (const campo of Object.keys(compacto)) assert.ok(Object.hasOwn(completo, campo), `${onde}: ${campo} não existe no completo`);
}

// Os campos de uma sessão recente que vão ao front. A lista é escrita aqui de propósito: é a
// cópia de CAMPOS_DA_SESSAO (lib/engine/snapshot-usage.js), e tirar um campo de lá reprova.
const CAMPOS_DA_SESSAO_NO_FRONT = [
  'id', 'at', 'day', 'kind', 'ref', 'account', 'profileId', 'model', 'farol',
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens',
  'costUsd', 'costSource', 'status', 'provider', 'billingKind',
];

test('snapshot conserva gráficos e sessões, com menos bytes e sem podar o diário', t => {
  const e = consumoSintetico();
  const antes = structuredClone({ usage: e.usage, sessions: e.usageSessions });
  const completo = usage.usageSummary(e);
  const compacto = snapshotUsage(completo);
  assert.equal(compacto.totals, completo.totals);
  assert.equal(compacto.auditoria, completo.auditoria);
  assert.equal(compacto.retentionDays, completo.retentionDays);
  assert.equal(compacto.recentSessions.length, 100);
  assert.equal(compacto.series.length, 120);
  assert.equal('modelUsage' in compacto.recentSessions[0], false);
  assert.equal('accounting' in compacto.recentSessions[0], false);
  // a série diária: os mesmos dias, na mesma ordem, e cada campo de cada dia
  assert.deepEqual(compacto.series.map(d => d.day), completo.series.map(d => d.day));
  completo.series.forEach((dia, i) => assertMesmoBalde(compacto.series[i], dia, `series[${dia.day}]`));
  assert.ok(completo.series.some(d => d.inputTokens > 0 && d.outputTokens > 0 && d.costUsd > 0 && d.cacheReadTokens > 0 && d.cacheCreationTokens > 0 && d.sessions > 0),
    'a fixture tem dia com todos os campos numéricos acima de zero: tirar um deles da projeção reprova');
  // as séries empilhadas: os mesmos itens na mesma ordem (cores e índices seguem associados)
  assert.deepEqual(Object.keys(compacto.stackedSeries), Object.keys(completo.stackedSeries));
  for (const [dimension, series] of Object.entries(completo.stackedSeries)) {
    assert.equal(compacto.stackedSeries[dimension].length, series.length, dimension);
    series.forEach((dia, i) => {
      const projetado = compacto.stackedSeries[dimension][i];
      assert.equal(projetado.day, dia.day, dimension);
      assert.equal(projetado.items.length, dia.items.length, `${dimension}[${dia.day}]`);
      dia.items.forEach((item, j) => assertMesmoBalde(projetado.items[j], item, `stackedSeries.${dimension}[${dia.day}][${j}]`));
    });
  }
  // a matriz tipo por modelo: cada célula de cada dia
  assert.equal(compacto.matrixSeries.length, completo.matrixSeries.length);
  assert.ok(completo.matrixSeries.length > 0, 'a fixture tem matriz');
  let celulas = 0;
  completo.matrixSeries.forEach((dia, i) => {
    const projetado = compacto.matrixSeries[i];
    assert.equal(projetado.day, dia.day);
    assert.deepEqual(Object.keys(projetado.cells), Object.keys(dia.cells), `matrixSeries[${dia.day}]`);
    for (const [kind, linha] of Object.entries(dia.cells)) {
      assert.deepEqual(Object.keys(projetado.cells[kind]), Object.keys(linha), `matrixSeries[${dia.day}].${kind}`);
      for (const [model, balde] of Object.entries(linha)) {
        assertMesmoBalde(projetado.cells[kind][model], balde, `matrixSeries[${dia.day}].${kind}.${model}`);
        if (balde.costUsd > 0) celulas++;
      }
    }
  });
  assert.ok(celulas > 0, 'há célula com custo para comparar');
  // as sessões recentes: as mesmas, na mesma ordem, com todos os campos que vão ao front
  completo.recentSessions.forEach((sessao, i) => {
    const projetada = compacto.recentSessions[i];
    assert.deepEqual(Object.keys(projetada).sort(), [...CAMPOS_DA_SESSAO_NO_FRONT].sort(), `sessão ${sessao.id}: os campos que saem`);
    for (const campo of CAMPOS_DA_SESSAO_NO_FRONT) assert.deepEqual(projetada[campo], sessao[campo], `sessão ${sessao.id}: ${campo}`);
  });
  assert.equal(compacto.recentSessions[0].costUsd, .5);
  assert.equal(compacto.recentSessions[0].cacheReadTokens, 7);
  assert.deepEqual({ usage: e.usage, sessions: e.usageSessions }, antes);
  const bytesAntes = Buffer.byteLength(JSON.stringify(completo));
  const bytesDepois = Buffer.byteLength(JSON.stringify(compacto));
  assert.ok(bytesDepois < bytesAntes * .5, `${bytesAntes} -> ${bytesDepois}`);
  t.diagnostic(`Consumo sintético, 120 dias: ${bytesAntes} -> ${bytesDepois} bytes; diário e séries preservados.`);
});

test('cache compacto reutiliza séries, mas atualiza falhas e novos registros', () => {
  const e = consumoSintetico();
  const original = usage.usageSummary(e);
  const first = snapshotUsage(original);
  const novasFalhas = { 'a-0': { motivo: 'falha posterior' } };
  const next = snapshotUsage({ ...original, falhasPorSessao: novasFalhas });
  assert.equal(next.series, first.series);
  assert.equal(next.falhasPorSessao, novasFalhas);
  const trocouSessao = snapshotUsage({ ...original, recentSessions: [{ ...original.recentSessions[0], status: 'descartada' }] });
  assert.equal(trocouSessao.recentSessions[0].status, 'descartada');
  const measured = usage.extractUsage({ usage: { output_tokens: 1 }, total_cost_usd: 1 }, 'modelo-novo');
  usage.applyUsage(e.usage, usage.localDay(), 'review', 'fixture', 'modelo-novo', measured);
  const atualizado = snapshotUsage(usage.usageSummary(e));
  assert.notEqual(atualizado.series, first.series);
  assert.equal(atualizado.series.at(-1).sessions, 2);
  assert.equal(snapshotUsage(null), null);
});

test('API de estado limita ações ao que a tela conhece sem perder revisão antiga ou a pendência atual', t => {
  const e = new Engine();
  e.decisions.resolved = Array.from({ length: 1900 }, (_, i) => ({
    id: `d-${i}`, key: `fixture/app#${i}`, status: 'auto_approved', action: 'approve', resolvedAt: 1900 - i,
  }));
  e.panorama = [{ key: 'fixture/app#700' }];
  e.queue = [{ key: 'fixture/app#800' }];
  e.decisions.pending = [{ id: 'p-700', key: 'fixture/app#700', createdAt: 2000, esperaProva: { tentativas: 2 } }];
  const original = structuredClone(e.decisions);
  const inteiro = e.reviewActions();
  const compacto = e.snapshot().reviewActions;
  assert.equal(Object.keys(compacto).length, 32);
  for (const key of Object.keys(compacto)) assert.deepEqual(compacto[key], inteiro[key]);
  assert.equal(compacto['fixture/app#700'].kind, 'pending');
  assert.equal(compacto['fixture/app#700'].esperaProva, true);
  assert.equal(compacto['fixture/app#600'], undefined);
  assert.equal(e.decisionByKey('fixture/app#600').id, 'd-600');
  e.panorama.push({ key: 'fixture/app#600' });
  assert.deepEqual(snapshotReviewActions(e)['fixture/app#600'], inteiro['fixture/app#600']);
  assert.deepEqual(e.decisions, original);
  assert.equal(Object.keys(e.reviewActions()).length, 1900, 'negócio continua consultando o mapa inteiro');
  const bytesAntes = Buffer.byteLength(JSON.stringify(inteiro));
  const bytesDepois = Buffer.byteLength(JSON.stringify(compacto));
  assert.ok(bytesDepois < bytesAntes * .03);
  t.diagnostic(`Ações sintéticas, 1900 chaves e 32 exibidas: ${bytesAntes} -> ${bytesDepois} bytes.`);
});

test('snapshot da Engine aplica a projeção de consumo e mantém os registros para consulta completa', () => {
  const e = new Engine();
  const sintetico = consumoSintetico();
  e.usage = sintetico.usage;
  // o diário da Engine mora no banco da telemetria: as linhas entram por ele
  for (const linha of sintetico.usageSessions.sessions) diario(e).inserir(linha);
  const snapshot = e.snapshot();
  assert.equal('modelUsage' in snapshot.usage.recentSessions[0], false);
  assert.ok(sessoesDoDiario(e).at(-1).modelUsage);
  assert.equal(snapshot.usage.totals.sessions, 120);
});
