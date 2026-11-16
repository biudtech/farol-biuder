// Quando as tentativas erradas bloqueiam o código de pareamento pendente, o motor registra UMA
// linha WARN no farol.log: hospedada, a rota é alcançável por qualquer um, e quem opera precisa
// saber que alguém queimou o código. Uma linha por bloqueio, não por tentativa, e sem o código
// nem o valor tentado. A resposta para fora continua a mesma recusa de sempre.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-bloqueio-log-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const { LOCAL_AUTH } = await import('../lib/constants.js');
const { criarCodigo, revogarCodigos } = await import('../lib/local-auth/pareamento.js');
const acesso = (await import('../lib/local-auth/acesso.js')).default;

const ERRADO = 'AAAAAAAAAA';
let engine, server, porta;

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  porta = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => revogarCodigos());

function parear(codigo) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/auth/pair', method: 'POST', headers: { 'x-farol': '1', 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ codigo, rotulo: 'teste' }));
  });
}

function linhasDeBloqueio() {
  let log = '';
  try { log = fs.readFileSync(LOG_FILE, 'utf8'); } catch { /* ainda não há log */ }
  return log.split('\n').filter((l) => /pareamento/.test(l));
}

test('pela rota: o erro que bloqueia o código grava uma linha WARN, e só ele', async () => {
  const antes = linhasDeBloqueio().length;
  const codigo = criarCodigo();
  for (let i = 0; i < LOCAL_AUTH.CODIGO_MAX_ERROS - 1; i++) {
    assert.deepEqual(await parear(ERRADO), { ok: false, code: 'codigo_invalido' });
  }
  assert.equal(linhasDeBloqueio().length, antes, 'tentativa errada que não bloqueia não vai para o log');
  assert.deepEqual(await parear(ERRADO), { ok: false, code: 'codigo_invalido' }, 'para fora, a recusa é a mesma');
  const linhas = linhasDeBloqueio().slice(antes);
  assert.equal(linhas.length, 1, linhas.join('\n'));
  assert.match(linhas[0], /\[WARN\] pareamento: .*bloqueado.*tentativas erradas/);
  assert.equal(linhas[0].includes(codigo), false, 'a linha não leva o código');
  assert.equal(linhas[0].includes(ERRADO), false, 'nem o valor tentado');
  // depois do bloqueio não há código pendente: mais tentativas não repetem a linha
  for (let i = 0; i < 3; i++) await parear(ERRADO);
  assert.deepEqual(await parear(codigo), { ok: false, code: 'codigo_invalido' }, 'o código bloqueado não vale mais');
  assert.equal(linhasDeBloqueio().length, antes + 1, 'uma linha por bloqueio, não por tentativa');
});

test('cada bloqueio avisa uma vez, mesmo com outro código ainda pendente, e o acerto não avisa', () => {
  const avisos = [];
  const avisar = (m) => avisos.push(m);
  const primeiro = criarCodigo();
  for (let i = 0; i < LOCAL_AUTH.CODIGO_MAX_ERROS - 2; i++) acesso.parear({ codigo: ERRADO }, avisar);
  const segundo = criarCodigo();
  acesso.parear({ codigo: ERRADO }, avisar);
  assert.deepEqual(avisos, [], 'ninguém bloqueado ainda');
  acesso.parear({ codigo: ERRADO }, avisar);
  assert.equal(avisos.length, 1, 'o primeiro código chegou ao limite, com o segundo ainda pendente');
  assert.equal(acesso.parear({ codigo: primeiro }, avisar).ok, false);
  assert.equal(avisos.length, 1, 'o código que já saiu conta como erro para o que ficou, sem novo bloqueio');
  assert.equal(acesso.parear({ codigo: segundo, rotulo: 'x' }, avisar).ok, true, 'o segundo código segue valendo');
  for (const aviso of avisos) {
    assert.match(aviso, /^pareamento: /);
    assert.equal([primeiro, segundo, ERRADO].some((s) => aviso.includes(s)), false);
    assert.doesNotMatch(aviso, /\u2014/);
  }
  // sem quem ouvir, a rota segue funcionando (o comando local e os testes antigos chamam assim)
  assert.deepEqual(acesso.parear({ codigo: ERRADO }), { ok: false, code: 'codigo_invalido' });
});
