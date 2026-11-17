// A migração do consumo para o banco (decisão de 16/11/2026), pelo boot de verdade da Engine:
// com os JSON antigos e a tabela vazia, o boot importa tudo numa transação, confere contagem e
// somas, e só então renomeia cada JSON para <nome>.migrado-<dia>. Repetir não duplica. Falha não
// derruba o motor nem perde dado: ele segue nos JSON, com uma linha só no log, e tenta de novo na
// próxima subida.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-migracao-'));
process.env.FAROL_HOME = FAROL_HOME;
process.env.TZ = 'America/Sao_Paulo';

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { STATE_DIR, TELEMETRIA_DB, LOG_FILE } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const migracao = await import('../lib/telemetria/migracao.js');
const usage = await import('../lib/engine/usage.js');
const { sessoesDoDiario, fecharTelemetria } = await import('../lib/engine/telemetria-do-motor.js');
const { classify } = await import('../lib/log-taxonomy.js');

const engines = [];
function motor() { const e = new Engine(); engines.push(e); return e; }
function fecharMotores() { while (engines.length) fecharTelemetria(engines.pop()); banco.fecharTodos(); }

after(() => { fecharMotores(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const ARQ = {
  sessoes: path.join(STATE_DIR, 'usage-sessions.json'),
  agregado: path.join(STATE_DIR, 'usage.json'),
  tentativas: path.join(STATE_DIR, 'usage-tentativas.json'),
  falhas: path.join(STATE_DIR, 'falhas-sessao.json'),
};

const SESSOES = [
  { at: 1786454890096, day: '2026-08-01', kind: 'review', ref: 'o/r#1', account: 'dev', model: 'Opus 4.8', profileId: '',
    inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.1, status: 'ok' },
  { id: 'a-00000000-0000-4000-8000-000000000001', at: 1786454990097, day: '2026-08-02', kind: 'review', ref: null, account: 'dev',
    model: 'Opus 5.5', profileId: 'p1', inputTokens: 1, outputTokens: 2, thinkingTokens: 9, cacheReadTokens: 0, cacheCreationTokens: 0,
    costUsd: 0.2, farol: '2.70.0', costSource: 'medido', provider: 'claude', billingKind: 'apikey', status: 'ok', attemptId: 't-1',
    accounting: { version: 1, sessionId: 'prov-1', snapshot: { models: {}, costUsd: 0.2 } }, corrigidoEm: 1786454999999 },
];
const TENTATIVA = { attemptId: 't-aberta', sessionId: 'a-00000000-0000-4000-8000-000000000002', kind: 'review', account: 'dev',
  profileId: 'p1', model: 'claude-opus-5-5', providerSessionId: 'prov-2', ref: 'o/r#2', provedor: 'claude', abertaEm: 1786455000000,
  parcial: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, parcialEm: 1786455000100 };
const FALHAS = [
  { id: 'f-1', at: 1786454890100, sessionId: 'a-x', attemptId: 't-x', cliSessionId: '', kind: 'review', account: 'dev', ref: 'o/r#1',
    motivo: 'sessão retornou erro: x', motivoTruncado: false, classe: 'desconhecido', etapas: null },
  { id: 'f-2', at: 1786454890200, sessionId: 'a-y', attemptId: '', cliSessionId: 'c', kind: 'review', account: 'dev', ref: 'o/r#3',
    motivo: 'hit your limit', motivoTruncado: false, classe: 'limite-plano', etapas: { totalMs: 3, stages: [] }, primeiraAt: 1, ocorrencias: 4 },
];

function gravarJsonAntigos() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(ARQ.sessoes, JSON.stringify({ sessions: SESSOES }, null, 2));
  fs.writeFileSync(ARQ.agregado, JSON.stringify(usage.defaultUsage(), null, 2));
  fs.writeFileSync(ARQ.tentativas, JSON.stringify({ tentativas: { [TENTATIVA.attemptId]: TENTATIVA } }, null, 2));
  fs.writeFileSync(ARQ.falhas, JSON.stringify({ falhas: FALHAS }, null, 2));
}

function limparEstado() {
  fecharMotores();
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function linhasDeTelemetria() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter((l) => /\] telemetria: /.test(l));
}

const migrados = () => fs.readdirSync(STATE_DIR).filter((n) => n.includes('.migrado-')).sort();

beforeEach(limparEstado);

test('boot sem JSON antigo nem banco: cria o banco, nada a migrar e nenhuma linha de log', () => {
  const e = motor();
  assert.ok(e.telemetria, 'o motor grava no banco');
  assert.ok(fs.existsSync(TELEMETRIA_DB));
  assert.deepEqual(linhasDeTelemetria(), []);
  assert.deepEqual(migrados(), []);
});

test('boot com os JSON antigos: importa tudo, confere, renomeia e registra uma linha INFO', () => {
  gravarJsonAntigos();
  const bytes = fs.readFileSync(ARQ.sessoes, 'utf8');
  const e = motor();
  assert.ok(e.telemetria);
  const dia = usage.localDay();
  assert.deepEqual(migrados(), [`falhas-sessao.json.migrado-${dia}`, `usage-sessions.json.migrado-${dia}`, `usage-tentativas.json.migrado-${dia}`]);
  for (const nome of ['usage-sessions.json', 'usage-tentativas.json', 'falhas-sessao.json']) assert.equal(fs.existsSync(path.join(STATE_DIR, nome)), false, nome);
  assert.equal(fs.readFileSync(path.join(STATE_DIR, `usage-sessions.json.migrado-${dia}`), 'utf8'), bytes, 'renomeado, não reescrito');
  assert.ok(fs.existsSync(ARQ.agregado), 'o agregado continua JSON');
  const linhas = sessoesDoDiario(e);
  assert.deepEqual(linhas.slice(0, 2), SESSOES);
  assert.equal(linhas.length, 3, 'a tentativa aberta virou linha interrompida no boot');
  assert.equal(linhas[2].status, 'interrompida');
  assert.equal(linhas[2].attemptId, 't-aberta');
  assert.deepEqual(e.falhasRecentes({ limite: 10 }).map((f) => f.id), ['f-2', 'f-1']);
  const log = linhasDeTelemetria();
  assert.equal(log.length, 1, log.join('\n'));
  assert.match(log[0], /\[INFO\] telemetria: consumo migrado para telemetria\.db: 2 sessões, 1 tentativa aberta e 2 falhas/);
});

test('boot de novo depois da migração: não duplica nada e não escreve log', () => {
  gravarJsonAntigos();
  motor();
  const depois = sessoesDoDiario(motor());
  assert.equal(depois.length, 3);
  fecharMotores();
  assert.equal(sessoesDoDiario(motor()).length, 3);
  assert.equal(linhasDeTelemetria().length, 1, 'só a linha da migração, da primeira subida');
});

test('JSON que reaparece com o banco já preenchido não é importado de novo: uma linha WARN, o banco vale', () => {
  gravarJsonAntigos();
  motor();
  fecharMotores();
  fs.copyFileSync(path.join(STATE_DIR, `usage-sessions.json.migrado-${usage.localDay()}`), ARQ.sessoes);
  const e = motor();
  assert.ok(e.telemetria);
  assert.equal(sessoesDoDiario(e).length, 3);
  assert.ok(fs.existsSync(ARQ.sessoes), 'o arquivo fica onde está, para quem for olhar');
  const avisos = linhasDeTelemetria().filter((l) => l.includes('[WARN]'));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /usage-sessions\.json/);
  assert.equal(classify(avisos[0].replace(/^.*?\] telemetria/, 'telemetria')).id, 'telemetria-anormal');
});

test('banco que não abre: o motor sobe nos JSON, grava neles, uma linha WARN, e migra na subida seguinte', () => {
  gravarJsonAntigos();
  fs.mkdirSync(TELEMETRIA_DB);
  const e = motor();
  assert.equal(e.telemetria, null);
  e.recordUsage('a-00000000-0000-4000-8000-000000000009', 'dev', { usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.01 }, 'claude-opus-5-5', 'p1', 'o/r#9');
  const noArquivo = JSON.parse(fs.readFileSync(ARQ.sessoes, 'utf8')).sessions;
  assert.equal(noArquivo.length, 4, 'as duas antigas, a interrompida do boot e a nova');
  assert.deepEqual(migrados(), []);
  const avisos = linhasDeTelemetria();
  assert.equal(avisos.length, 1, avisos.join('\n'));
  assert.match(avisos[0], /\[WARN\] telemetria: /);
  assert.equal(classify(avisos[0].replace(/^.*?\] telemetria/, 'telemetria')).id, 'telemetria-anormal');
  fecharMotores();
  fs.rmdirSync(TELEMETRIA_DB);
  const depois = motor();
  assert.ok(depois.telemetria);
  assert.deepEqual(sessoesDoDiario(depois), noArquivo);
});

test('JSON de sessões com formato errado: nada é importado nem renomeado, e o motor segue como hoje', () => {
  gravarJsonAntigos();
  fs.writeFileSync(ARQ.sessoes, JSON.stringify({ sessions: { nao: 'é lista' } }));
  const e = motor();
  assert.equal(e.telemetria, null);
  assert.deepEqual(migrados(), []);
  assert.ok(fs.existsSync(ARQ.tentativas) && fs.existsSync(ARQ.falhas));
  const avisos = linhasDeTelemetria();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /\[WARN\] telemetria: .*usage-sessions\.json/);
});

test('conferência que não fecha desfaz a transação inteira e não renomeia nada', () => {
  gravarJsonAntigos();
  const h = banco.abrirBanco(path.join(FAROL_HOME, 'conferencia.db'));
  try {
    const fontes = migracao.lerFontes({ sessoes: ARQ.sessoes, tentativas: ARQ.tentativas, falhas: ARQ.falhas });
    let pulou = false;
    const r = migracao.importarConsumo(h, fontes, { dia: '2026-11-16', inserirSessao: (hh, linha) => {
      if (!pulou) { pulou = true; return; }
      migracao.inserirSessaoPadrao(hh, linha);
    } });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /conferência/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM falhas').get().n, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM tentativas').get().n, 0);
    assert.deepEqual(migrados(), []);
  } finally { banco.fecharBanco(h); }
});

test('no modo banco o registro de uma sessão é uma linha nova, sem regravar arquivo de sessões', () => {
  const e = motor();
  e.recordUsage('a-00000000-0000-4000-8000-00000000000a', 'dev', { usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.5 }, 'claude-opus-5-5', 'p1', 'o/r#1');
  assert.equal(fs.existsSync(ARQ.sessoes), false);
  assert.ok(fs.existsSync(ARQ.agregado), 'o agregado continua sendo gravado');
  assert.equal(sessoesDoDiario(e).length, 1);
  assert.equal(e.marcarDesfecho('a-00000000-0000-4000-8000-00000000000a', 'descartada'), true);
  assert.equal(sessoesDoDiario(motor())[0].status, 'descartada', 'o desfecho marcado depois persiste');
  e.registrarFalha({ sessionId: 'a-f', kind: 'review', motivo: 'quebrou' });
  assert.equal(fs.existsSync(ARQ.falhas), false);
  assert.equal(motor().falhaDaSessao('a-f').motivo, 'quebrou');
  assert.equal(fs.existsSync(ARQ.tentativas), false);
});
