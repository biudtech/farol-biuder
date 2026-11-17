// O banco da telemetria com mais de uma Engine e com o banco falhando:
//  - a segunda instância no mesmo FAROL_HOME, que não consegue a porta (o listen é a trava de
//    instância única), não escreve nada no banco nem reconcilia as tentativas vivas da primeira;
//  - escrita que falha (disco cheio, I/O) não perde a linha: ela fica em memória, visível, e entra
//    na próxima gravação, com um WARN só na mudança de estado;
//  - leitura que falha não derruba o snapshot.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-instancia-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const farol = await import('../server.js');
const { Engine } = farol;
const { startServer } = await import('../lib/http-server.js');
const { STATE_DIR, TELEMETRIA_DB, CONFIG_FILE, LOG_FILE } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const { todasAsTentativas } = await import('../lib/telemetria/tentativas.js');
const tentativas = await import('../lib/engine/usage-tentativas.js');
const { sessoesDoDiario, fecharTelemetria, iniciarConsumo } = await import('../lib/engine/telemetria-do-motor.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const uso = (n) => ({ usage: { input_tokens: n, output_tokens: n }, total_cost_usd: n / 100 });
const linhasDoLog = (re) => (fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter((l) => re.test(l)) : []);
function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const bytes = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : Buffer.alloc(0));

test('segunda instância sem a porta não escreve no banco nem fecha as tentativas vivas da primeira', async () => {
  const porta = await portaLivre();
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: porta }));
  const primeira = new Engine();
  iniciarConsumo(primeira);
  const servidor = await new Promise((resolve, reject) => {
    const s = startServer(primeira, (url, err) => (err ? reject(err) : resolve(s)));
  });
  try {
    const viva = tentativas.abrirTentativa(primeira, { sessionId: 'a-viva', account: 'dev', profileId: 'p1', model: 'claude-opus-5-5', ref: 'o/r#1' });
    // um JSON antigo sobrando no estado: a segunda instância não pode migrá-lo
    fs.writeFileSync(path.join(STATE_DIR, 'usage-sessions.json'), JSON.stringify({ sessions: [{ id: 'a-velha', at: 1, status: 'ok' }] }));
    const antes = { db: bytes(TELEMETRIA_DB), wal: bytes(`${TELEMETRIA_DB}-wal`) };
    const r = await new Promise((resolve) => {
      const iniciado = farol.start((url, err) => resolve({ err, iniciado }));
    });
    assert.ok(r.err, 'a porta estava ocupada');
    const segunda = r.iniciado.engine;
    assert.equal(segunda.telemetria, null, 'a segunda não abriu o banco');
    assert.deepEqual(Object.keys(todasAsTentativas(primeira.telemetria)), [viva], 'a tentativa viva continua aberta');
    assert.ok(bytes(TELEMETRIA_DB).equals(antes.db) && bytes(`${TELEMETRIA_DB}-wal`).equals(antes.wal), 'o banco não mudou um byte');
    assert.ok(fs.existsSync(path.join(STATE_DIR, 'usage-sessions.json')), 'o JSON não foi migrado nem renomeado');
    assert.deepEqual(sessoesDoDiario(primeira), []);
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolve) => servidor.close(resolve));
    fecharTelemetria(primeira);
  }
});

test('escrita que falha fica em memória, aparece nas leituras e entra na próxima gravação, com um WARN só', () => {
  fs.rmSync(path.join(STATE_DIR, 'usage-sessions.json'), { force: true });
  const e = new Engine();
  iniciarConsumo(e);
  try {
    const db = e.telemetria.db;
    // a tentativa viva do teste anterior foi reconciliada nesta subida: começa sem linha nenhuma
    db.exec('DELETE FROM sessoes');
    db.exec("CREATE TRIGGER disco_cheio BEFORE INSERT ON sessoes BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;");
    const antes = linhasDoLog(/telemetria: /).length;
    e.recordUsage('a-00000000-0000-4000-8000-000000000001', 'dev', uso(1), 'claude-opus-5-5', 'p1', 'o/r#1');
    e.recordUsage('a-00000000-0000-4000-8000-000000000002', 'dev', uso(2), 'claude-opus-5-5', 'p1', 'o/r#2');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 0);
    assert.deepEqual(sessoesDoDiario(e).map((s) => s.ref), ['o/r#1', 'o/r#2'], 'as linhas que não entraram continuam visíveis');
    assert.equal(e.snapshot().usage.recentSessions.length, 2);
    assert.equal(e.marcarDesfecho('a-00000000-0000-4000-8000-000000000002', 'descartada'), true);
    const avisos = linhasDoLog(/\[WARN\] telemetria: /).slice(antes);
    assert.equal(avisos.length, 1, avisos.join('\n'));
    assert.match(avisos[0], /database or disk is full.*ficam em memória/);
    db.exec('DROP TRIGGER disco_cheio');
    e.recordUsage('a-00000000-0000-4000-8000-000000000003', 'dev', uso(3), 'claude-opus-5-5', 'p1', 'o/r#3');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 3, 'as pendentes entraram antes da nova, na ordem');
    assert.deepEqual(sessoesDoDiario(e).map((s) => [s.ref, s.status]), [['o/r#1', 'ok'], ['o/r#2', 'descartada'], ['o/r#3', 'ok']]);
    assert.match(linhasDoLog(/telemetria: /).at(-1), /\[INFO\] telemetria: o banco voltou a gravar: 2 linhas pendentes de sessões gravadas/);
  } finally { fecharTelemetria(e); }
});

test('leitura que falha não derruba o snapshot: sai sem as sessões, com um WARN', () => {
  const e = new Engine();
  iniciarConsumo(e);
  e.telemetria.db.close();
  const snap = e.snapshot();
  assert.ok(snap.usage, 'o snapshot sai');
  assert.deepEqual(snap.usage.recentSessions, []);
  assert.equal(linhasDoLog(/\[WARN\] telemetria: ler/).length >= 1, true);
  e.telemetria = null;
});

test('o arquivo do banco fica na pasta de estado do FAROL_HOME do teste', () => {
  assert.ok(TELEMETRIA_DB.startsWith(FAROL_HOME));
});
