// O banco da telemetria (lib/telemetria/banco.js, decisão de 16/11/2026): um arquivo em
// ~/.farol/workspace/state, aberto uma vez pelo processo, com WAL, permissão 600 e o esquema
// versionado por PRAGMA user_version. Cada teste abre numa pasta temporária e fecha no fim.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-banco-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const banco = await import('../lib/telemetria/banco.js');
const { TELEMETRIA_DB, STATE_DIR } = await import('../lib/paths.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

function pasta() { return fs.mkdtempSync(path.join(FAROL_HOME, 'b-')); }

test('o arquivo mora na pasta de estado do motor, dentro do FAROL_HOME', () => {
  assert.equal(TELEMETRIA_DB, path.join(STATE_DIR, 'telemetria.db'));
  assert.ok(TELEMETRIA_DB.startsWith(FAROL_HOME + path.sep));
});

test('abrir cria o arquivo com permissão 600, WAL, synchronous FULL, busy_timeout e foreign_keys', () => {
  const caminho = path.join(pasta(), 'telemetria.db');
  const h = banco.abrirBanco(caminho);
  try {
    assert.equal(fs.statSync(caminho).mode & 0o777, 0o600);
    const pragma = (nome) => Object.values(h.db.prepare(`PRAGMA ${nome}`).get())[0];
    assert.equal(pragma('journal_mode'), 'wal');
    // FULL: com WAL, o NORMAL perde numa queda de energia tudo desde o último checkpoint
    assert.equal(pragma('synchronous'), 2, 'FULL');
    assert.ok(pragma('busy_timeout') >= 1000);
    assert.equal(pragma('foreign_keys'), 1);
    assert.equal(pragma('temp_store'), 2, 'MEMORY: nada vai para a pasta temporária do sistema');
    assert.equal(pragma('user_version'), banco.VERSAO_DO_ESQUEMA);
    const tabelas = h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    for (const t of ['falhas', 'sessoes', 'tentativas']) assert.ok(tabelas.includes(t), t);
  } finally { banco.fecharBanco(h); }
});

test('o processo abre uma vez: o mesmo caminho devolve a mesma conexão, que só fecha na última saída', () => {
  const caminho = path.join(pasta(), 'telemetria.db');
  const a = banco.abrirBanco(caminho);
  const b = banco.abrirBanco(caminho);
  assert.equal(a, b);
  banco.fecharBanco(a);
  assert.equal(b.db.isOpen, true, 'ainda há quem use');
  banco.fecharBanco(b);
  assert.equal(b.db.isOpen, false);
});

test('a migração do esquema é idempotente: reabrir não refaz nem muda a versão', () => {
  const caminho = path.join(pasta(), 'telemetria.db');
  let h = banco.abrirBanco(caminho);
  h.db.prepare('INSERT INTO sessoes (id, at) VALUES (?, ?)').run('a-1', 1);
  banco.fecharBanco(h);
  h = banco.abrirBanco(caminho);
  try {
    assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, banco.VERSAO_DO_ESQUEMA);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 1);
  } finally { banco.fecharBanco(h); }
});

test('banco de versão mais nova que o motor conhece é recusado, sem tocar nele', () => {
  const caminho = path.join(pasta(), 'telemetria.db');
  const h = banco.abrirBanco(caminho);
  h.db.exec(`PRAGMA user_version = ${banco.VERSAO_DO_ESQUEMA + 1}`);
  banco.fecharBanco(h);
  assert.throws(() => banco.abrirBanco(caminho), /versão \d+ do esquema/);
  const leitura = banco.abrirBanco(caminho, { somenteLeitura: true });
  try { assert.equal(leitura.db.prepare('PRAGMA user_version').get().user_version, banco.VERSAO_DO_ESQUEMA + 1); }
  finally { banco.fecharBanco(leitura); }
});

test('transação desfaz tudo quando a função lança', () => {
  const h = banco.abrirBanco(path.join(pasta(), 'telemetria.db'));
  try {
    assert.throws(() => banco.transacao(h, () => {
      h.db.prepare('INSERT INTO sessoes (id) VALUES (?)').run('a-x');
      throw new Error('falhou no meio');
    }), /falhou no meio/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 0);
    assert.equal(banco.transacao(h, () => 7), 7);
  } finally { banco.fecharBanco(h); }
});

test('a soma em ordem do banco é a mesma soma ingênua do JavaScript, não a compensada do SUM', () => {
  const h = banco.abrirBanco(path.join(pasta(), 'telemetria.db'));
  try {
    const valores = Array.from({ length: 3000 }, (_, i) => ((i * 7919) % 1000) / 37 + 0.1);
    banco.transacao(h, () => { for (const v of valores) h.db.prepare('INSERT INTO sessoes (cost_usd) VALUES (?)').run(v); });
    let ingenua = 0;
    for (const v of valores) ingenua += v;
    const r = h.db.prepare('SELECT soma_em_ordem(cost_usd ORDER BY seq) AS s FROM sessoes').get();
    assert.equal(r.s, ingenua);
  } finally { banco.fecharBanco(h); }
});
