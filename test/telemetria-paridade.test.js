// A tela não muda com o banco (decisão de 16/11/2026): `GET /api/usage` e a chave `usage` do
// snapshot devolvem o MESMO JSON lendo o diário em memória (como antes) e lendo o telemetria.db
// depois da migração, para 7, 30 e 90 dias, com filtros e páginas. A comparação é byte a byte do
// JSON de chaves ordenadas, pela mesma ferramenta da prova com os dados reais
// (tools/comparar-consumo-sqlite.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-paridade-'));
process.env.FAROL_HOME = FAROL_HOME;
process.env.TZ = 'America/Sao_Paulo';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { STATE_DIR } = await import('../lib/paths.js');
const usage = await import('../lib/engine/usage.js');
const { usageActivity } = await import('../lib/engine/usage-activity.js');
const { snapshotUsage } = await import('../lib/engine/snapshot-usage.js');
const { activityDay } = await import('../lib/usage/activity.js');
const { safeStringify } = await import('../lib/io.js');
const motor = await import('../lib/engine/telemetria-do-motor.js');
const banco = await import('../lib/telemetria/banco.js');
const consumo = await import('../lib/telemetria/consumo.js');
const { diario } = await import('../lib/engine/usage-diario.js');
const { DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS } = await import('../lib/engine/usage-desfechos.js');
const { ordenado, retratoDoConsumo, somasDoDiario } = await import('../tools/comparar-consumo-sqlite.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const DIA = 24 * 3600 * 1000;
const MODELOS = ['Opus 5.5', 'Sonnet 5', 'Haiku 5.5', 'desconhecido'];
const STATUS = ['ok', 'ok', 'ok', 'erro', 'cancelada', 'parcial', 'descartada', 'interrompida'];
const ORIGENS = [undefined, 'medido', 'medido', 'estimado', 'desconhecido', 'sem-base'];
const KINDS = ['review', 'review', 'review', 'pushback', 'self', 'chat', 'tool'];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Um diário de 100 dias com a variedade do real: retentativas do mesmo id, linha sem id (antiga),
// custo em float, uso por modelo que fecha e que não fecha, cursor de retomada, desfecho corrigido.
function diarioSintetico(agora) {
  const linhas = [];
  let semente = 7;
  const rnd = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  for (let i = 0; i < 1500; i++) {
    const at = agora - Math.floor(rnd() * 100 * DIA) - 1;
    const kind = KINDS[i % KINDS.length];
    const prefixo = kind === 'pushback' ? 'pb' : kind[0];
    const model = MODELOS[i % MODELOS.length];
    const inputTokens = Math.floor(rnd() * 5000);
    const outputTokens = Math.floor(rnd() * 900);
    const linha = { at, day: activityDay(at), kind, ref: `org/repo-${i % 5}#${i % 37}`, account: i % 9 ? 'dev' : 'outra',
      model, profileId: i % 4 ? 'p1' : '', inputTokens, outputTokens, cacheReadTokens: Math.floor(rnd() * 90000),
      cacheCreationTokens: Math.floor(rnd() * 2000), costUsd: rnd() * 3, status: STATUS[i % STATUS.length] };
    if (i % 10) linha.id = `${prefixo}-${uuid(Math.floor(i / 2))}`;
    const origem = ORIGENS[i % ORIGENS.length];
    if (origem) linha.costSource = origem;
    if (i % 3 === 0) Object.assign(linha, { provider: 'claude', billingKind: i % 2 ? 'apikey' : 'assinatura', farol: '2.70.0' });
    if (i % 4 === 0) linha.attemptId = `t-${i}`;
    if (i % 5 === 0) linha.iniciadaEm = at - 60000;
    if (i % 6 === 0) linha.modelUsage = { 'claude-opus-5-5': { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 } };
    if (i % 12 === 0) linha.modelUsage = { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
    if (i % 7 === 0) linha.accounting = { version: 1, sessionId: `prov-${i}`, scope: 'tree', snapshot: { models: {}, costUsd: 1 } };
    if (i % 11 === 0) linha.corrigidoEm = at + 5;
    if (i % 13 === 0) linha.thinkingTokens = 12;
    linhas.push(linha);
  }
  return linhas.sort((a, b) => a.at - b.at);
}

test('rota e snapshot devolvem o mesmo JSON antes e depois da migração, em todos os períodos, filtros e páginas', async () => {
  const agora = Date.now();
  const hoje = activityDay(agora);
  const linhas = diarioSintetico(agora);
  const agregado = usage.defaultUsage();
  for (const s of linhas) usage.applyUsage(agregado, s.day, s.kind, s.account, s.model, { ...s }, s.profileId);
  const falhas = linhas.filter((s, i) => s.id && i % 17 === 0).map((s, i) => ({ id: `f-${i}`, at: s.at, sessionId: s.id, attemptId: '',
    cliSessionId: '', kind: s.kind, account: s.account, ref: s.ref, motivo: `falha ${i}`, motivoTruncado: false, classe: 'desconhecido', etapas: null }));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'usage-sessions.json'), safeStringify({ sessions: linhas }));
  fs.writeFileSync(path.join(STATE_DIR, 'usage.json'), safeStringify(agregado));
  fs.writeFileSync(path.join(STATE_DIR, 'falhas-sessao.json'), safeStringify({ falhas }));

  const deps = { usageActivity, usageSummary: usage.usageSummary, snapshotUsage };
  const antesEngine = { usage: structuredClone(agregado), usageSessions: { sessions: structuredClone(linhas) }, config: {} };
  const antes = await retratoDoConsumo(antesEngine, deps, hoje);

  const depoisEngine = { config: {}, log() { }, pushState() { } };
  motor.carregarConsumo(depoisEngine, () => { });
  motor.iniciarConsumo(depoisEngine, () => { }, { reconciliar: false });
  try {
    assert.ok(depoisEngine.telemetria, 'migrou para o banco');
    assert.equal(fs.existsSync(path.join(STATE_DIR, 'usage-sessions.json')), false);
    assert.deepEqual(somasDoDiario(motor.sessoesDoDiario(depoisEngine)), somasDoDiario(linhas));
    const depois = await retratoDoConsumo(depoisEngine, deps, hoje);
    assert.ok(antes.consultas > 150, `${antes.consultas} consultas`);
    assert.ok(Object.values(antes.rota).some((r) => r.history.rows.length === 8 && r.history.pages > 2), 'há páginas cheias no meio');
    assert.ok(antes.snapshot.recentSessions.length === 100 && Object.keys(antes.snapshot.falhasPorSessao).length > 0);
    assert.equal(safeStringify(ordenado(depois)), safeStringify(ordenado(antes)));
    // o cache da atividade e da auditoria cresce com a sessão nova e segue igual à leitura cheia
    const d = diario(depoisEngine);
    const h = depoisEngine.telemetria;
    const vocabulario = { perdidos: [...DESFECHOS_PERDIDOS], desconhecidas: [...ORIGENS_DESCONHECIDAS] };
    const nova = { ...linhas.at(-1), id: 'a-00000000-0000-4000-8000-0000000fffff', at: agora, costUsd: 0.123456789, accounting: { sessionId: 'x' } };
    d.inserir(nova);
    assert.deepEqual(d.paraAtividade(), consumo.sessoesDaAtividade(h));
    assert.deepEqual(d.auditoria(), consumo.auditoriaDasSessoes(h, vocabulario));
    assert.equal(d.marcarStatus(nova.id, 'descartada'), true);
    assert.deepEqual(d.paraAtividade(), consumo.sessoesDaAtividade(h));
    assert.deepEqual(d.auditoria(), consumo.auditoriaDasSessoes(h, vocabulario));
  } finally { motor.fecharTelemetria(depoisEngine); }
});
