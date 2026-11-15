// As três rotas do login do Claude pela tela (15/11/2026), pela camada HTTP de verdade:
// exigem o x-farol como toda rota de escrita, recusam o segundo login com um em curso, e o
// código colado (credencial de uso único) não aparece em resposta nenhuma, no farol.log, em
// arquivo nenhum do HOME do Farol, no snapshot nem em toast. O `claude` é um processo falso.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-login-web-http-'));
process.env.FAROL_HOME = HOME;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { LOG_FILE } = await import('../lib/paths.js');
const { classeDaRota } = await import('../lib/local-auth/inventario.js');

const LINK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc';
const CODIGO_BOM = 'codigoSecretoBom123#estadoBom456';
const CODIGO_RUIM = 'codigoSecretoRuim789#estadoRuim000';
const SEGREDOS = ['codigoSecretoBom123', 'estadoBom456', 'codigoSecretoRuim789', 'estadoRuim000'];

let server, base, engine;
const toasts = [];
const respostas = [];
const processos = [];

function cliFalso(falha) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 999996;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    const p = { cmd, args, env: opts.env, recebido: '' };
    processos.push(p);
    setImmediate(() => child.stdout.write(`If the browser didn't open, visit: ${LINK}\nPaste code here if prompted > `));
    child.stdin.on('data', (b) => {
      p.recebido += String(b);
      // o pior caso: o CLI devolve o código na própria mensagem de erro
      if (falha) child.stdout.write(`Login failed: ${falha} (${String(b).trim()})\n`);
      setImmediate(() => child.emit('exit', falha ? 1 : 0));
    });
    return child;
  };
}

before(async () => {
  engine = new Engine();
  engine.config.port = 0;
  engine.doctor = async () => ({});
  engine.on('toast', (t) => toasts.push(t));
  engine.config.claudeProfiles = [
    { id: 's1', label: 'Plano', kind: 'dir', dir: '' },
    { id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-x', baseUrl: '' },
  ];
  engine.config.claudeProfileId = 's1';
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  childProcess.spawn = realSpawn;
  try { server.closeAllConnections(); await new Promise((r) => server.close(() => r())); } catch { /* ok */ }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function post(rota, corpo, { comHeader = true } = {}) {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo || {});
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), Connection: 'close' };
    if (comHeader) headers['x-farol'] = '1';
    const req = http.request(base + rota, { method: 'POST', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        respostas.push(d);
        let json = null;
        try { json = JSON.parse(d); } catch { /* corpo que não é JSON */ }
        resolve({ status: res.statusCode, corpo: d, json });
      });
    });
    req.on('error', reject);
    req.end(dados);
  });
}

function arquivosDe(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...arquivosDe(p));
    else if (item.isFile()) out.push(p);
  }
  return out;
}

const ROTAS = ['/api/claude/login-web/start', '/api/claude/login-web/code', '/api/claude/login-web/cancel'];

test('as três rotas exigem o x-farol, e sem ele nenhum processo abre', async () => {
  spawnImpl = cliFalso('');
  try {
    for (const rota of ROTAS) {
      const r = await post(rota, { profileId: 's1', loginId: 'x', code: CODIGO_BOM }, { comHeader: false });
      assert.equal(r.status, 403, `${rota} sem x-farol`);
    }
    assert.equal(processos.length, 0);
  } finally { spawnImpl = null; }
});

test('a rota que recebe o código é da classe de segredo; iniciar e cancelar são rotas comuns', () => {
  assert.equal(classeDaRota('/api/claude/login-web/code'), 'recebe-segredo');
  assert.equal(classeDaRota('/api/claude/login-web/start'), 'demais');
  assert.equal(classeDaRota('/api/claude/login-web/cancel'), 'demais');
});

test('perfil de chave de API e perfil que não existe não abrem login', async () => {
  spawnImpl = cliFalso('');
  try {
    for (const profileId of ['k1', 'sumiu', '']) {
      const r = await post('/api/claude/login-web/start', { profileId });
      assert.equal(r.status, 200);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'sem-login');
    }
    assert.equal(processos.length, 0);
  } finally { spawnImpl = null; }
});

test('o login inteiro pela rota: link, segundo iniciar recusado, código recusado, código aceito, cancelar', async () => {
  // 1. o CLI recusa o primeiro código (e o devolve na mensagem de erro)
  spawnImpl = cliFalso('Request failed with status code 400');
  const a = await post('/api/claude/login-web/start', { profileId: 's1' });
  assert.equal(a.status, 200);
  assert.deepEqual(Object.keys(a.json).sort(), ['loginId', 'ok', 'url']);
  assert.equal(a.json.url, LINK);
  assert.equal(processos.at(-1).env.CLAUDE_CONFIG_DIR, path.join(HOME, 'claude', 's1'), 'a pasta do perfil mora no HOME do Farol');
  assert.equal('ANTHROPIC_API_KEY' in processos.at(-1).env, false);

  const concorrente = await post('/api/claude/login-web/start', { profileId: 's1' });
  assert.equal(concorrente.status, 200);
  assert.equal(concorrente.json.ok, false);
  assert.equal(concorrente.json.code, 'login-em-curso');
  assert.equal(processos.length, 1, 'o segundo pedido não abriu processo');

  const torto = await post('/api/claude/login-web/code', { loginId: a.json.loginId, code: 'com espaco no meio' });
  assert.equal(torto.json.code, 'codigo-invalido');

  const recusado = await post('/api/claude/login-web/code', { loginId: a.json.loginId, code: CODIGO_RUIM });
  assert.equal(recusado.status, 200);
  assert.equal(recusado.json.ok, false);
  assert.equal(recusado.json.code, 'recusado');
  assert.match(recusado.json.motivo, /^Login failed/);
  assert.equal(processos.at(-1).recebido, `${CODIGO_RUIM}\n`, 'o código chegou ao stdin do CLI, e só lá');

  // 2. o segundo login dá certo
  spawnImpl = cliFalso('');
  const b = await post('/api/claude/login-web/start', { profileId: 's1' });
  assert.equal(b.json.ok, true);
  const aceito = await post('/api/claude/login-web/code', { loginId: b.json.loginId, code: CODIGO_BOM });
  assert.deepEqual(aceito.json, { ok: true });
  assert.equal(processos.at(-1).recebido, `${CODIGO_BOM}\n`);
  assert.equal(toasts.some((t) => t.kind === 'ok' && /Login do Claude feito/.test(t.text)), true);

  // 3. login usado não aceita código, e cancelar é idempotente
  const tarde = await post('/api/claude/login-web/code', { loginId: b.json.loginId, code: CODIGO_BOM });
  assert.equal(tarde.json.code, 'expirou');
  const c = await post('/api/claude/login-web/start', { profileId: 's1' });
  assert.deepEqual((await post('/api/claude/login-web/cancel', { loginId: c.json.loginId })).json, { ok: true });
  assert.deepEqual((await post('/api/claude/login-web/cancel', { loginId: 'nao-existe' })).json, { ok: true });
  assert.equal((await post('/api/claude/login-web/code', { loginId: c.json.loginId, code: CODIGO_BOM })).json.code, 'expirou');
  spawnImpl = null;
});

test('o código não vaza: nem em resposta, nem no farol.log, nem em arquivo do HOME, nem no snapshot, nem em toast', async () => {
  // uma falha registrada de propósito, para o farol.log existir e a prova não ser sobre arquivo ausente
  engine.log('ERROR', 'falha de controle do teste do login pela tela');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(LOG_FILE), true, 'o farol.log existe');
  assert.match(fs.readFileSync(LOG_FILE, 'utf8'), /falha de controle/);
  assert.ok(respostas.length >= 10, 'as respostas das rotas foram guardadas');
  const lugares = {
    respostas: respostas.join('\n'),
    toasts: JSON.stringify(toasts),
    snapshot: JSON.stringify(engine.snapshot()),
    loginsEmMemoria: JSON.stringify([...(engine.loginsWeb || new Map()).keys()]),
  };
  const arquivos = arquivosDe(HOME);
  assert.ok(arquivos.includes(LOG_FILE));
  for (const arq of arquivos) lugares[`arquivo ${path.relative(HOME, arq)}`] = fs.readFileSync(arq, 'utf8');
  for (const [onde, texto] of Object.entries(lugares)) {
    for (const segredo of SEGREDOS) assert.equal(texto.includes(segredo), false, `o código apareceu em ${onde}`);
  }
  // o link de autorização também não vai para arquivo (traz o estado do OAuth)
  for (const arq of arquivos) assert.equal(fs.readFileSync(arq, 'utf8').includes('oauth/authorize'), false, `o link apareceu em ${path.relative(HOME, arq)}`);
});
