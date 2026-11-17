// O motor escutando num socket Unix (config.socket, lib/escuta-em-socket.js), para a hospedagem
// compartilhada atrás de um proxy: escuta no socket EM VEZ da porta, com permissão 600; socket
// órfão é removido e socket vivo recusa a subida (a trava de instância única); a saída ordenada
// remove o arquivo; e as recusas de boot de valor, de nome e das combinações (com bind, sem
// hostPublico). Pelo socket só vale o Host público, e a falta de endereço de origem não libera
// nada: a autenticação é sempre exigida.
//
// Os sockets ficam em os.tmpdir() do Linux (socket Unix não funciona em pasta montada do
// Windows), numa pasta 700 criada pelo mkdtemp. Em processo; o processo de verdade, com o
// SIGTERM, fica no último teste.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-socket-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
const { recusasDaFronteira } = await import('../lib/fronteira-hospedada.js');
const { avisosDaHospedagem, recusasDaHospedagem } = await import('../lib/instancia-hospedada.js');
const { validarHostEOrigem } = await import('../lib/http-guard.js');
const { exigida } = await import('../lib/local-auth/acesso.js');
const { aoSair } = await import('../lib/engine/saida-ordenada.js');
const { removerSocketProprio } = await import('../lib/escuta-em-socket.js');
const parse = await import('../lib/parse.js');

const PARSERS = { sanearBind: parse.sanearBind, sanearHostPublico: parse.sanearHostPublico, sanearOrigensPermitidas: parse.sanearOrigensPermitidas, sanearSocket: parse.sanearSocket };
// a pasta dos sockets fica fora do FAROL_HOME, que o beforeEach apaga
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sock-'));
const HOST = 'farol.exemplo.invalid';
const ORIGEM = `https://${HOST}`;
const servidores = new Set();
const filhos = new Set();

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true }); });
after(async () => {
  for (const s of servidores) { s.closeAllConnections?.(); await new Promise((r) => s.close(() => r())); }
  for (const f of filhos) if (f.exitCode === null && f.signalCode === null) f.kill('SIGKILL');
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(RUN, { recursive: true, force: true });
});

let serie = 0;
function caminhoNovo() { return path.join(RUN, `m${++serie}.sock`); }

function gravar(config) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config)); }

function configDoSocket(socket, extra = {}) {
  return { socket, hostPublico: HOST, origensPermitidas: [ORIGEM], localAuth: 'exigir', ...extra };
}

// Sobe a Engine com a config dada e devolve { engine, server } quando o listen der certo, ou o erro.
function subir(config) {
  gravar(config);
  const engine = new Engine();
  return new Promise((resolve) => {
    const server = startServer(engine, (url, err) => resolve({ engine, server, url, err }));
    servidores.add(server);
  });
}

async function fechar(server) {
  servidores.delete(server);
  server.closeAllConnections?.();
  await new Promise((r) => server.close(() => r()));
}

function pedir(socketPath, rota, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: rota, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

function escutaNaPorta(porta) {
  return new Promise((resolve) => {
    const s = net.connect(porta, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/* ---------- subir e responder pelo socket ---------- */

test('com socket o motor escuta no socket, com permissão 600, e a porta TCP não abre', async () => {
  const caminho = caminhoNovo();
  const porta = await portaLivre();
  const { server, url, err, engine } = await subir({ ...configDoSocket(caminho), port: porta });
  assert.equal(err, undefined, err && err.message);
  try {
    assert.equal(url, `unix:${caminho}`);
    assert.equal(server.address(), caminho, 'o servidor escuta no caminho, não numa porta');
    const st = fs.lstatSync(caminho);
    assert.ok(st.isSocket());
    assert.equal(st.mode & 0o777, 0o600, `modo ${(st.mode & 0o777).toString(8)}`);
    assert.equal(await escutaNaPorta(porta), false, 'a porta TCP da config não abre');
    const big = fs.lstatSync(caminho, { bigint: true });
    assert.deepEqual(engine.socketEscutado, { caminho, dev: String(big.dev), ino: String(big.ino), ctimeNs: String(big.ctimeNs) });
    const saude = await pedir(caminho, '/api/health');
    assert.equal(saude.status, 200);
    assert.equal(saude.body, '{"ok":true}');
  } finally { await fechar(server); }
});

test('pelo socket só vale o Host público, e sem Bearer a API responde 401: a origem sem endereço não libera nada', async () => {
  const caminho = caminhoNovo();
  const { server, engine } = await subir(configDoSocket(caminho));
  try {
    assert.equal(exigida(engine.config), true, 'com socket a autenticação é exigida');
    // nenhum nome de loopback passa pelo socket, com ou sem porta
    for (const host of ['localhost', '127.0.0.1', '127.0.0.1:47170', 'localhost:47170', '[::1]:47170', `${HOST}:443`, 'outro.exemplo.invalid']) {
      const r = await pedir(caminho, '/api/state', { headers: { host } });
      assert.equal(r.status, 403, `Host ${host}: ${r.body}`);
    }
    const semToken = await pedir(caminho, '/api/state', { headers: { host: HOST } });
    assert.equal(semToken.status, 401, semToken.body);
    const sse = await pedir(caminho, '/api/events', { headers: { host: HOST } });
    assert.equal(sse.status, 401, 'o SSE também pede a credencial');
    const status = await pedir(caminho, '/api/auth/status', { headers: { host: HOST } });
    assert.deepEqual(JSON.parse(status.body), { exigida: true, autenticado: false });
  } finally { await fechar(server); }
});

test('front na mesma origem: o POST do navegador com Origin igual à origem pública passa pela allowlist', async () => {
  const caminho = caminhoNovo();
  const { server } = await subir(configDoSocket(caminho));
  try {
    const headers = { host: HOST, origin: ORIGEM, 'x-farol': '1', 'content-type': 'application/json' };
    const par = await pedir(caminho, '/api/auth/pair', { method: 'POST', headers });
    assert.equal(par.status, 200, par.body);
    assert.deepEqual(JSON.parse(par.body), { ok: false, code: 'codigo_invalido' });
    const acao = await pedir(caminho, '/api/check', { method: 'POST', headers });
    assert.equal(acao.status, 401, 'ação sem Bearer segue recusada');
    const outra = await pedir(caminho, '/api/auth/pair', { method: 'POST', headers: { ...headers, origin: 'https://outro.exemplo.invalid' } });
    assert.equal(outra.status, 403);
  } finally { await fechar(server); }
});

// Código que lê o endereço de origem, fora das linhas de comentário (o comentário que explica
// por que não se lê não conta).
function leEndereco(fonte) {
  return fonte.split('\n').some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /remoteAddress|remoteFamily|remotePort/.test(l));
}

test('nada em lib/ lê o endereço de origem do pedido: pelo socket ele é indefinido e não pode virar regra', () => {
  assert.equal(leEndereco('const ip = req.socket.remoteAddress;'), true, 'controle: a leitura é achada');
  const achados = [];
  const andar = (pasta) => {
    for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
      const p = path.join(pasta, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith('.js') && leEndereco(fs.readFileSync(p, 'utf8'))) achados.push(p);
    }
  };
  andar(path.join(import.meta.dirname, '..', 'lib'));
  assert.deepEqual(achados, []);
  assert.equal(leEndereco(fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8')), false);
});

test('allowlist pura: com socket, sem porta, só o hostPublico; sem socket e sem porta, recusa como antes', () => {
  assert.equal(validarHostEOrigem({ host: HOST, socket: true, hostPublico: HOST }).ok, true);
  assert.equal(validarHostEOrigem({ host: 'localhost', socket: true, hostPublico: HOST }).ok, false);
  assert.equal(validarHostEOrigem({ host: '127.0.0.1:47170', porta: 47170, socket: true, hostPublico: HOST }).ok, false, 'com socket nem a porta de config devolve o loopback');
  assert.equal(validarHostEOrigem({ host: '', socket: true, hostPublico: '' }).ok, false, 'Host vazio com hostPublico vazio não casa');
  assert.equal(validarHostEOrigem({ host: HOST, hostPublico: HOST }).ok, false, 'sem socket, porta inválida segue recusando');
  assert.deepEqual(validarHostEOrigem({ host: HOST, origin: ORIGEM, socket: true, hostPublico: HOST, origensPermitidas: [ORIGEM] }), { ok: true, cors: ORIGEM });
  assert.deepEqual(validarHostEOrigem({ host: HOST, origin: ORIGEM, socket: true, hostPublico: HOST }), { ok: false, motivo: 'origin' }, 'a origem pública só vale escrita em origensPermitidas');
});

/* ---------- a trava de instância única ---------- */

test('socket órfão (ninguém escuta) é removido e o motor sobe', async () => {
  const caminho = caminhoNovo();
  // um socket que fica no disco sem ninguém escutando: o processo que o criou morreu
  const orfao = await new Promise((resolve) => {
    const filho = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(caminho)}, () => process.kill(process.pid, 'SIGKILL'))`]);
    filho.on('exit', resolve);
  });
  assert.equal(orfao, null);
  assert.ok(fs.lstatSync(caminho).isSocket(), 'o órfão está no disco');
  const { server, err } = await subir(configDoSocket(caminho));
  assert.equal(err, undefined, err && err.message);
  try {
    // o inode do órfão pode ser reaproveitado pelo socket novo: a prova é o socket responder
    assert.equal(fs.lstatSync(caminho).mode & 0o777, 0o600);
    assert.equal((await pedir(caminho, '/api/health')).status, 200);
  } finally { await fechar(server); }
});

test('socket vivo recusa a subida, como a porta ocupada, e o socket do outro fica intacto', async () => {
  const caminho = caminhoNovo();
  const vivo = net.createServer((c) => c.end());
  await new Promise((r) => vivo.listen(caminho, r));
  servidores.add(vivo);
  const antes = fs.lstatSync(caminho).ino;
  const { server, err, engine } = await subir(configDoSocket(caminho));
  try {
    assert.ok(err, 'a subida tem de falhar');
    assert.equal(err.code, 'EADDRINUSE');
    assert.match(err.message, /já está em uso/);
    assert.equal(server.listening, false);
    assert.equal(engine.socketEscutado, undefined, 'quem não subiu não guarda socket para remover');
    assert.equal(fs.lstatSync(caminho).ino, antes, 'o socket vivo não foi tocado');
    assert.equal(removerSocketProprio(engine.socketEscutado), false);
    assert.ok(fs.existsSync(caminho));
  } finally {
    servidores.delete(server);
    servidores.delete(vivo);
    await new Promise((r) => vivo.close(() => r()));
  }
});

test('no caminho do socket há um arquivo comum: a subida é recusada e o arquivo não é apagado', async () => {
  const caminho = caminhoNovo();
  fs.writeFileSync(caminho, 'dado de alguém');
  const { err } = await subir(configDoSocket(caminho));
  assert.ok(err);
  assert.match(err.message, /não é um socket/);
  assert.equal(fs.readFileSync(caminho, 'utf8'), 'dado de alguém');
});

test('a saída ordenada remove o socket que o motor criou, e só ele', async () => {
  const caminho = caminhoNovo();
  const { server, engine } = await subir(configDoSocket(caminho));
  const escutado = engine.socketEscutado;
  await fechar(server);
  assert.equal(fs.existsSync(caminho), false, 'o close do servidor tira o arquivo');
  // a saída por sinal não fecha o servidor, e aí quem tira é a saída ordenada. Outro socket no
  // mesmo caminho (mesmo que o sistema reaproveite o inode) não é o deste processo.
  const outro = net.createServer();
  await new Promise((resolve, reject) => { outro.once('error', reject); outro.listen(caminho, resolve); });
  try {
    aoSair({ log() {}, socketEscutado: escutado });
    assert.ok(fs.existsSync(caminho), 'o socket de outro processo no mesmo caminho não é removido');
  } finally { await new Promise((r) => outro.close(() => r())); }
  const segundo = await subir(configDoSocket(caminho));
  assert.equal(segundo.err, undefined);
  servidores.delete(segundo.server);
  aoSair({ log() {}, socketEscutado: segundo.engine.socketEscutado });
  assert.equal(fs.existsSync(caminho), false, 'o socket deste processo é removido, com o servidor ainda de pé');
  await new Promise((r) => segundo.server.close(() => r()));
  aoSair({ log() {} });
});

/* ---------- recusas de boot ---------- */

function recusaDoEngine(config) {
  gravar(config);
  const antes = fs.readFileSync(CONFIG_FILE);
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.ok(erro, 'a Engine tem de lançar');
  assert.equal(erro.code, 'FRONTEIRA_INVALIDA', erro.message);
  assert.match(erro.message, /o motor não sobe/);
  assert.doesNotMatch(erro.message, /—/);
  assert.deepEqual(fs.readFileSync(CONFIG_FILE), antes, 'o config.json fica como estava');
  return erro.message;
}

test('valor de socket que não serve impede o boot, com o motivo na mensagem', () => {
  const aberta = fs.mkdtempSync(path.join(RUN, 'aberta-'));
  fs.chmodSync(aberta, 0o777);
  const doGrupo = fs.mkdtempSync(path.join(RUN, 'grupo-'));
  fs.chmodSync(doGrupo, 0o770);
  const arquivo = path.join(RUN, 'arquivo-comum');
  fs.writeFileSync(arquivo, '');
  const casos = [
    ['run/motor.sock', /não é um caminho absoluto/],
    ['./motor.sock', /não é um caminho absoluto/],
    [`${RUN}/motor\u0000.sock`, /caractere nulo/],
    [`${RUN}/motor\n.sock`, /caractere de controle/],
    [`${RUN}/`, /termina em barra/],
    [`${RUN}/${'a'.repeat(120)}.sock`, /bytes, e o limite de socket Unix no Linux é 107/],
    [`${RUN}/nao-existe/motor.sock`, /não existe/],
    [`${aberta}/motor.sock`, /gravável pelo grupo ou pelos outros \(modo 777\)/],
    [`${doGrupo}/motor.sock`, /gravável pelo grupo ou pelos outros \(modo 770\)/],
    [`${arquivo}/motor.sock`, /não é uma pasta/],
    [47170, /não é texto/],
    [['/tmp/x.sock'], /não é texto/],
    [true, /não é texto/],
  ];
  for (const [valor, motivo] of casos) {
    const mensagem = recusaDoEngine(configDoSocket(valor));
    assert.match(mensagem, /"socket" tem valor recusado/, String(valor));
    assert.match(mensagem, motivo, mensagem);
    assert.match(mensagem, /Formato aceito: o caminho absoluto de um socket Unix/);
    assert.equal(mensagem.includes('\n'), false, 'a mensagem é uma linha só, sem o controle cru');
  }
});

test('o limite do sun_path: 107 bytes passam, 108 não', () => {
  const base = `${RUN}/`;
  const cabe = base + 'x'.repeat(107 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(cabe), 107);
  assert.equal(parse.motivoDoFormatoDoSocket(cabe), '');
  assert.match(parse.motivoDoFormatoDoSocket(`${cabe}x`), /108 bytes/);
  assert.match(parse.motivoDoFormatoDoSocket(base + 'ç'.repeat(60)), /bytes/, 'conta bytes, não caracteres');
});

test('vazio legítimo não é socket: ausente, null e "" sobem na porta, como antes', () => {
  for (const socket of [undefined, null, '']) {
    gravar(socket === undefined ? {} : { socket });
    const engine = new Engine();
    assert.equal(engine.config.socket, '', String(socket));
  }
  assert.deepEqual(recusasDaFronteira({ socket: '' , bind: '0.0.0.0' }, PARSERS), [], 'socket vazio não briga com bind');
});

for (const escrita of ['sock', 'socketPath', 'Socket', 'SOCKET', 'socket_path', 'unixSocket', 'unix_socket']) {
  test(`nome de chave errado: "${escrita}" impede o boot e a mensagem diz a grafia certa "socket"`, () => {
    const mensagem = recusaDoEngine({ hostPublico: HOST, [escrita]: path.join(RUN, 'motor.sock') });
    assert.ok(mensagem.includes(JSON.stringify(escrita)), mensagem);
    assert.match(mensagem, /a grafia certa é "socket"/);
  });
}

test('socket com bind ao mesmo tempo impede o boot, e a mensagem diz por quê', () => {
  for (const bind of ['127.0.0.1', '0.0.0.0']) {
    const mensagem = recusaDoEngine(configDoSocket(caminhoNovo(), { bind }));
    assert.match(mensagem, /"socket" e "bind" juntos/);
    assert.match(mensagem, /a porta TCP não abre/);
  }
});

test('socket sem hostPublico impede o boot: pelo socket o motor só aceita o Host público', () => {
  const mensagem = recusaDoEngine({ socket: caminhoNovo(), origensPermitidas: [ORIGEM], localAuth: 'exigir' });
  assert.match(mensagem, /"socket" sem "hostPublico"/);
  assert.match(mensagem, /403/);
});

test('o socket é só de arquivo: POST /api/settings não o muda', () => {
  const caminho = caminhoNovo();
  gravar(configDoSocket(caminho));
  const engine = new Engine();
  const r = engine.updateSettings({ socket: '/tmp/outro.sock' });
  assert.equal(engine.config.socket, caminho);
  assert.ok((r.ignoradas || r.ignored || []).includes('socket'), JSON.stringify(r));
});

test('a config com socket é gravada com a chave, e sem socket a chave não aparece', () => {
  const caminho = caminhoNovo();
  gravar(configDoSocket(caminho));
  const engine = new Engine();
  engine.updateSettings({ parallelReviews: 2 });
  assert.equal(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).socket, caminho);
  gravar({ hostPublico: HOST });
  const semSocket = new Engine();
  semSocket.updateSettings({ parallelReviews: 2 });
  assert.equal('socket' in JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')), false);
});

/* ---------- a instância hospedada ---------- */

test('instância hospedada com socket: passa pela trava e não avisa do bind em loopback', () => {
  const config = { socket: caminhoNovo(), hostPublico: HOST, origensPermitidas: [ORIGEM], localAuth: 'exigir', bind: '127.0.0.1', port: 47171 };
  const ligada = { ligada: true, invalido: false };
  assert.deepEqual(recusasDaHospedagem(config, ligada), []);
  assert.deepEqual(avisosDaHospedagem(config, ligada), []);
  assert.equal(avisosDaHospedagem({ ...config, socket: '' }, ligada).length, 1, 'controle: sem socket o aviso do loopback continua');
});

/* ---------- o processo de verdade ---------- */

test('node server.js com socket: escuta no socket com 600, não abre a porta, e o SIGTERM remove o socket', async () => {
  const casa = fs.mkdtempSync(path.join(RUN, 'casa-'));
  const bin = path.join(casa, 'bin');
  fs.mkdirSync(path.join(casa, '.farol'), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "You are not logged into any GitHub hosts." >&2\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude-falso'), '#!/bin/sh\necho \'{"result":"{}"}\'\n', { mode: 0o755 });
  const caminho = path.join(casa, 'motor.sock');
  const porta = await portaLivre();
  fs.writeFileSync(path.join(casa, '.farol', 'config.json'), JSON.stringify({
    port: porta, socket: caminho, hostPublico: HOST, origensPermitidas: [ORIGEM], localAuth: 'exigir',
    conta: { user: '', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' },
  }));
  const env = {
    HOME: casa, TMPDIR: casa, FAROL_INSTANCIA_HOSPEDADA: '1',
    PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    FAROL_HEADLESS_CMD: path.join(bin, 'claude-falso'),
  };
  const filho = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.js')], { cwd: casa, env, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.add(filho);
  let saida = '';
  let erros = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { erros += d; });
  const fim = new Promise((resolve) => filho.on('exit', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error(`o motor não subiu em 30 s\nstdout: ${saida}\nstderr: ${erros}`)), 30000);
    const olhar = () => {
      if (saida.includes('[farol] monitorando')) { clearTimeout(limite); return resolve(); }
      if (filho.exitCode !== null) { clearTimeout(limite); return reject(new Error(`o motor saiu\nstdout: ${saida}\nstderr: ${erros}`)); }
      setTimeout(olhar, 50);
    };
    olhar();
  });
  try {
    assert.match(saida, new RegExp(`API em unix:${caminho.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
    assert.equal(fs.lstatSync(caminho).mode & 0o777, 0o600);
    assert.equal(await escutaNaPorta(porta), false, 'a porta TCP não abre');
    assert.equal((await pedir(caminho, '/api/state', { headers: { host: HOST } })).status, 401);
    assert.doesNotMatch(erros, /bind/, 'sem o aviso do bind em loopback');
  } finally {
    filho.kill('SIGTERM');
  }
  const r = await fim;
  assert.equal(r.code, 0, erros);
  assert.equal(fs.existsSync(caminho), false, 'a saída ordenada removeu o socket');
});
