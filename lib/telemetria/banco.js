// O banco da telemetria (decisão do dono, 16/11/2026): um arquivo SQLite no volume do motor
// (TELEMETRIA_DB, lib/paths.js), pelo `node:sqlite` do próprio Node, sem pacote (invariante 1).
// É o único módulo que abre o arquivo; o SQL mora só nos módulos desta pasta, sempre com
// parâmetro. O motor é um processo e um escritor só: a conexão abre uma vez por caminho e é
// compartilhada (os testes que sobem mais de uma Engine no mesmo processo usam a mesma), e fecha
// quando o último dono fecha, na saída ordenada do motor ou, em último caso, no exit do processo.
//
// Pragmas: WAL (leitor não espera escritor e a queda no meio não corrompe), synchronous NORMAL
// (com WAL, o que se pode perder numa queda de energia é a última transação, nunca a integridade),
// busy_timeout, foreign_keys e temp_store em memória, para o SQLite nunca gravar na pasta
// temporária do sistema (test/boot-vazio.test.js). O arquivo nasce com permissão 600; o -wal e o
// -shm o SQLite cria com a mesma permissão.
//
// O esquema é versionado por PRAGMA user_version: cada migração é numerada, idempotente (IF NOT
// EXISTS) e roda numa transação própria. Banco de versão mais nova que este motor conhece (o motor
// voltou de versão) é recusado sem ser tocado, e quem abre segue nos JSON.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BUSY_MS = 5000;

// Lote 1 (16/11/2026): o consumo. `seq` é a ordem de inserção, que é a ordem do diário.
// `accounting` e `model_usage` são objetos, guardados em JSON na coluna; `accounting` (o cursor,
// a maior parte de cada linha) tem coluna própria para a leitura do relatório poder deixá-lo de
// fora. `cursor_sessao` não é campo do registro: é o accounting.sessionId copiado para o índice
// do cursor das retomadas. Tudo o que não tem coluna fica em `extra`, em JSON, sem perda.
const MIGRACOES = [
  `CREATE TABLE IF NOT EXISTS sessoes (
     seq INTEGER PRIMARY KEY,
     id TEXT, at INTEGER, day TEXT, kind TEXT, ref TEXT, account TEXT, model TEXT, profile_id TEXT,
     input_tokens INTEGER, output_tokens INTEGER, thinking_tokens INTEGER,
     cache_read_tokens INTEGER, cache_creation_tokens INTEGER, cost_usd REAL,
     farol TEXT, cost_source TEXT, provider TEXT, billing_kind TEXT, status TEXT,
     attempt_id TEXT, iniciada_em INTEGER, resume_outcome TEXT, accounting TEXT, model_usage TEXT,
     cursor_sessao TEXT, extra TEXT
   );
   CREATE INDEX IF NOT EXISTS sessoes_por_id ON sessoes (id);
   CREATE INDEX IF NOT EXISTS sessoes_por_tentativa ON sessoes (attempt_id);
   CREATE INDEX IF NOT EXISTS sessoes_por_cursor ON sessoes (cursor_sessao, account);
   CREATE INDEX IF NOT EXISTS sessoes_por_modelo ON sessoes (model, status);
   CREATE TABLE IF NOT EXISTS tentativas (
     seq INTEGER PRIMARY KEY, chave TEXT NOT NULL UNIQUE,
     attempt_id TEXT, session_id TEXT, kind TEXT, account TEXT, profile_id TEXT, model TEXT,
     provider_session_id TEXT, ref TEXT, provedor TEXT, aberta_em INTEGER, parcial TEXT, parcial_em INTEGER,
     extra TEXT
   );
   CREATE TABLE IF NOT EXISTS falhas (
     seq INTEGER PRIMARY KEY,
     id TEXT, at INTEGER, session_id TEXT, attempt_id TEXT, cli_session_id TEXT, kind TEXT, account TEXT,
     ref TEXT, classe TEXT, motivo TEXT, extra TEXT
   );
   CREATE INDEX IF NOT EXISTS falhas_por_id ON falhas (id);
   CREATE INDEX IF NOT EXISTS falhas_por_sessao ON falhas (session_id);`,
];
const VERSAO_DO_ESQUEMA = MIGRACOES.length;

const abertos = new Map();
let saidaRegistrada = false;

function transacao(h, fn) {
  h.db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    h.db.exec('COMMIT');
    return r;
  } catch (err) {
    if (h.db.isTransaction) h.db.exec('ROLLBACK');
    throw err;
  }
}

function versao(db) { return Number(db.prepare('PRAGMA user_version').get().user_version) || 0; }

// PRAGMA não aceita parâmetro: o número vem da lista de migrações do código, nunca de fora.
function migrar(h) {
  const atual = versao(h.db);
  if (atual > VERSAO_DO_ESQUEMA) throw new Error(`banco na versão ${atual} do esquema, e este motor conhece até a ${VERSAO_DO_ESQUEMA}`);
  for (let n = atual + 1; n <= VERSAO_DO_ESQUEMA; n++) {
    transacao(h, () => {
      h.db.exec(MIGRACOES[n - 1]);
      h.db.exec(`PRAGMA user_version = ${Number.parseInt(String(n), 10)}`);
    });
  }
}

// A soma de float na ordem das linhas e sem compensação, igual ao `+=` do JavaScript que o
// diário em memória fazia. O SUM do SQLite compensa o erro de arredondamento (Kahan) e dá outro
// número nos últimos bits: medido em 16/11/2026, a tela mudaria. Use com ORDER BY seq.
function somaEmOrdem(acumulado, valor) {
  if (valor === null || valor === undefined) return acumulado;
  return acumulado + (Number(valor) || 0);
}

function criarArquivo(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  if (!fs.existsSync(caminho)) fs.closeSync(fs.openSync(caminho, 'a', 0o600));
  fs.chmodSync(caminho, 0o600);
}

function conectar(caminho, somenteLeitura) {
  if (!somenteLeitura) criarArquivo(caminho);
  const db = new DatabaseSync(caminho, { readOnly: somenteLeitura, timeout: BUSY_MS, enableForeignKeyConstraints: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_MS}; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;`);
    if (!somenteLeitura) db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.aggregate('soma_em_ordem', { start: 0, step: somaEmOrdem });
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function registrarSaida() {
  if (saidaRegistrada) return;
  saidaRegistrada = true;
  process.once('exit', fecharTodos);
}

// Devolve { db, caminho }. `somenteLeitura` é para ferramenta e teste que olham um banco de
// outro processo: não migra, não cria e não entra no compartilhamento.
function abrirBanco(caminho, { somenteLeitura = false } = {}) {
  if (somenteLeitura) return { db: conectar(caminho, true), caminho, donos: 1, avulso: true };
  const chave = path.resolve(caminho);
  const existente = abertos.get(chave);
  if (existente) { existente.donos++; return existente; }
  const h = { db: conectar(chave, false), caminho: chave, donos: 1 };
  try { migrar(h); } catch (err) { h.db.close(); throw err; }
  abertos.set(chave, h);
  registrarSaida();
  return h;
}

function fecharBanco(h) {
  if (!h || !h.db.isOpen) return;
  h.donos--;
  if (h.donos > 0) return;
  if (!h.avulso) abertos.delete(h.caminho);
  h.db.close();
}

function fecharTodos() {
  for (const h of abertos.values()) { if (h.db.isOpen) h.db.close(); }
  abertos.clear();
}

export { abrirBanco, fecharBanco, fecharTodos, transacao, VERSAO_DO_ESQUEMA };
