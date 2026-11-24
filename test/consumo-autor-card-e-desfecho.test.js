// O registro de consumo sem depender do teto do histórico das decisões (24/11/2026):
//  - o autor do PR e o card lido vão na própria linha da sessão (marcas farol_autor e farol_card),
//    e a tela de Consumo os lê dali; só a linha antiga, sem eles, ainda os busca nas decisões, que
//    guardam até 3.000 e descartam as mais antigas;
//  - a revisão que termina sem resultado depois de uma sessão concluída troca o `ok` dessa sessão
//    por `erro` (marcarDesfecho com `seEra`), sem apagar o `parcial` de quem morreu no meio.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-consumo-autor-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const banco = await import('../lib/telemetria/banco.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { camposDaTentativa, autorDaSessao, cardDaSessao } = await import('../lib/engine/usage-desfechos.js');
const { activityReport } = await import('../lib/usage/report.js');
const { comDetalheDaDecisao, consumoEmCsv } = await import('../lib/engine/consumo-das-sessoes.js');
const { sessoesDoDiario, fecharTelemetria, iniciarConsumo } = await import('../lib/engine/telemetria-do-motor.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const ID = (n) => `a-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uso = (n, extra = {}) => ({ usage: { input_tokens: n, output_tokens: n }, total_cost_usd: n / 100, ...extra });

test('o autor e o card do evento vão para a linha, só na forma de login e de chave', () => {
  assert.deepEqual(camposDaTentativa({ farol_autor: ' Dev-Um ', farol_card: 'PROJ-123' }), { author: 'dev-um', card: 'PROJ-123' });
  assert.equal(autorDaSessao('dependabot[bot]'), 'dependabot[bot]');
  for (const torto of ['', '-dev', 'a b', 'x'.repeat(40), 7, null, 'dev;rm']) assert.equal(autorDaSessao(torto), '', String(torto));
  for (const torto of ['', 'proj-1', 'PROJ-', 'PROJ 1', `B${'T'.repeat(40)}-1`, 9]) assert.equal(cardDaSessao(torto), '', String(torto));
  assert.deepEqual(camposDaTentativa({}), {});
});

test('a linha guarda o autor e o card, e o relatório usa o da linha antes do das decisões', () => {
  const eng = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { } };
  usage.recordUsage(eng, ID(1), 'eu', uso(3, { farol_autor: 'Gravado', farol_card: 'PROJ-9' }), 'claude-opus-5', '', 'o/r#1');
  usage.recordUsage(eng, ID(2), 'eu', uso(3), 'claude-opus-5', '', 'o/r#2');
  const [nova, antiga] = [eng.usageSessions.sessions[0], eng.usageSessions.sessions[1]];
  assert.equal(nova.author, 'gravado');
  assert.equal(nova.card, 'PROJ-9');
  assert.equal('author' in antiga, false);

  const agora = Math.max(nova.at, antiga.at) + 1000;
  const r = activityReport([{ device: 'local', rows: eng.usageSessions.sessions }], {}, agora,
    { autorDe: (ref) => (ref === 'o/r#1' ? 'outro' : 'das-decisoes') });
  const porRef = Object.fromEntries(r.history.rows.map((l) => [l.ref, l]));
  assert.equal(porRef['o/r#1'].author, 'gravado', 'o gravado na linha vale, mesmo com decisão dizendo outro');
  assert.equal(porRef['o/r#2'].author, 'das-decisoes', 'a linha antiga busca nas decisões');
  assert.equal(porRef['o/r#1'].card, 'PROJ-9');
  assert.equal('card' in porRef['o/r#2'], false, 'sem card não sai a chave');
  assert.deepEqual(r.options.author, ['das-decisoes', 'gravado']);
  const soGravado = activityReport([{ device: 'local', rows: eng.usageSessions.sessions }], { author: 'Gravado' }, agora, { autorDe: () => '' });
  assert.equal(soGravado.history.total, 1, 'o filtro por autor acha a linha sem nenhuma decisão guardada');
});

test('sem decisão da rodada (descartada pelo teto), o card da linha continua na página e no CSV', () => {
  const linha = { kind: 'review', ref: 'o/r#1', at: 1000, card: 'PROJ-9', author: 'dev' };
  const engine = { decisions: { pending: [] } };
  assert.equal(comDetalheDaDecisao(engine, [linha], [])[0].card, 'PROJ-9');
  const decisao = { id: 'd1', key: 'o/r#1', createdAt: 2000, card: { key: 'PROJ-1' } };
  assert.equal(comDetalheDaDecisao({ decisions: { pending: [decisao] } }, [linha], [decisao])[0].card, 'PROJ-1', 'o card da decisão vale');
  const csv = consumoEmCsv([linha], []);
  assert.match(csv.split('\n')[1], /,o\/r#1,dev,PROJ-9,/);
});

test('desfecho condicional no JSON: só a linha em ok vira erro', () => {
  const eng = { usage: usage.defaultUsage(), usageSessions: { sessions: [] }, config: {}, pushState() { }, log() { } };
  usage.recordUsage(eng, ID(3), 'eu', uso(2), 'claude-opus-5', '', 'o/r#3');
  usage.recordUsage(eng, ID(4), 'eu', { usage: { input_tokens: 1, output_tokens: 1 }, farol_parcial: true }, 'claude-opus-5', '', 'o/r#4');
  assert.equal(usage.marcarDesfecho(eng, ID(3), 'erro', 'ok'), true);
  assert.equal(usage.marcarDesfecho(eng, ID(4), 'erro', 'ok'), false, 'o parcial fica');
  assert.equal(usage.marcarDesfecho(eng, ID(3), 'erro', 'inventado'), false);
  assert.deepEqual(eng.usageSessions.sessions.map((s) => s.status), ['erro', 'parcial']);
});

test('desfecho condicional no banco e na fila do que o banco recusou', () => {
  const e = new Engine();
  iniciarConsumo(e);
  try {
    const db = e.telemetria.db;
    db.exec('DELETE FROM sessoes');
    e.recordUsage(ID(5), 'dev', uso(5), 'claude-opus-5-5', 'p1', 'o/r#5');
    e.recordUsage(ID(6), 'dev', { usage: { input_tokens: 1, output_tokens: 1 }, farol_parcial: true }, 'claude-opus-5-5', 'p1', 'o/r#6');
    assert.equal(e.marcarDesfecho(ID(5), 'erro', 'ok'), true);
    assert.equal(e.marcarDesfecho(ID(6), 'erro', 'ok'), false);
    assert.equal(e.marcarDesfecho(ID(5), 'cancelada', 'ok'), false, 'já não está em ok');

    // o banco recusa: a linha fica pendente em memória e a condição vale sobre ela
    db.exec("CREATE TRIGGER disco_cheio BEFORE INSERT ON sessoes BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;");
    e.recordUsage(ID(7), 'dev', uso(7), 'claude-opus-5-5', 'p1', 'o/r#7');
    assert.equal(e.marcarDesfecho(ID(7), 'erro', 'ok'), true);
    assert.equal(e.marcarDesfecho(ID(7), 'descartada', 'ok'), false);
    db.exec('DROP TRIGGER disco_cheio');
    e.recordUsage(ID(8), 'dev', uso(8), 'claude-opus-5-5', 'p1', 'o/r#8');
    assert.deepEqual(sessoesDoDiario(e).map((s) => [s.ref, s.status]),
      [['o/r#5', 'erro'], ['o/r#6', 'parcial'], ['o/r#7', 'erro'], ['o/r#8', 'ok']]);
    assert.deepEqual(db.prepare('SELECT status FROM sessoes ORDER BY seq').all().map((r) => r.status), ['erro', 'parcial', 'erro', 'ok']);
  } finally { fecharTelemetria(e); }
});
