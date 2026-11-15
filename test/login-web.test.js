// Login do Claude pela tela (voltou em 15/11/2026, com a assinatura). Nenhum `claude` real
// roda: o spawn é trocado por um processo falso que imprime o que o Claude Code imprime sem
// TTY (medido na 2.1.295) e lê o código do stdin. Prova o contrato com o CLI (link na saída,
// código no stdin, saída 0 é sucesso), a pasta do perfil no ambiente, um login por vez e que
// o código nunca sai para a tela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-login-web-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import cp from 'node:child_process';

const { default: loginWeb } = await import('../lib/engine/login-web.js');
const { loginWebHtml } = await import('../ui/pure.js');
const { CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');
const uso = await import('../lib/engine/uso-do-plano.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const LINK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=abc';
const CODIGO = 'codigoDeVerdade123#estado456';

function cliFalso({ falha = '', ecoaCodigo = false } = {}) {
  const chamadas = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 999999;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const chamada = { cmd, args, env: opts.env, opts, recebido: '' };
    chamadas.push(chamada);
    setImmediate(() => child.stdout.write(`Opening browser to sign in…\nIf the browser didn't open, visit: ${LINK}\nPaste code here if prompted > `));
    child.stdin.on('data', (b) => {
      chamada.recebido += String(b);
      if (falha) child.stdout.write(`Login failed: ${falha}${ecoaCodigo ? ` (${String(b).trim()})` : ''} ${LINK}\n`);
      setImmediate(() => child.emit('exit', falha ? 1 : 0));
    });
    return child;
  };
  return { spawn, chamadas };
}

const PASTA = path.join(FAROL_HOME, 'claude', 'pessoal');
const PERFIS = [
  { id: 'p1', label: 'Pessoal', kind: 'dir', dir: PASTA },
  { id: 'novo', label: 'Sem pasta', kind: 'dir', dir: '' },
  { id: 'k', label: 'Chave', kind: 'apikey', apiKey: 'sk-x' },
  { id: 'fora', label: 'Fora', kind: 'dir', dir: '/fora/do/home' },
];

function engineFalso() {
  return {
    config: { claudeProfiles: PERFIS },
    emitidos: [], logs: [], doctorChamado: 0,
    emit(tipo, dados) { this.emitidos.push({ tipo, dados }); },
    log(nivel, msg) { this.logs.push(`${nivel} ${msg}`); },
    doctor() { this.doctorChamado++; return Promise.resolve({}); },
  };
}

test('abre o login na pasta do perfil, devolve o link e entrega o código colado ao CLI', async () => {
  const cli = cliFalso();
  const e = engineFalso();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-herdada';
  process.env.GH_TOKEN = 'gh-herdado';
  let r;
  try { r = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn }); }
  finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.GH_TOKEN; }
  assert.equal(r.ok, true);
  assert.equal(r.url, LINK);
  assert.deepEqual(Object.keys(r).sort(), ['loginId', 'ok', 'url']);
  const chamada = cli.chamadas[0];
  assert.equal(chamada.cmd, '/bin/sh');
  assert.equal(chamada.args[0], '-lc');
  assert.match(chamada.args[1], /exec claude auth login$/);
  assert.equal(chamada.env.CLAUDE_CONFIG_DIR, PASTA);
  assert.equal('ANTHROPIC_API_KEY' in chamada.env, false, 'a chave herdada venceria o login');
  assert.equal('GH_TOKEN' in chamada.env, false);
  assert.equal(fs.statSync(PASTA).isDirectory(), true, 'o motor cria a pasta do perfil');
  const fim = await loginWeb.enviarCodigo(e, r.loginId, `  ${CODIGO}  `);
  assert.deepEqual(fim, { ok: true });
  assert.equal(chamada.recebido, `${CODIGO}\n`);
  assert.equal(e.doctorChamado, 1);
  // o código não aparece em nada que vai para a tela nem para o log
  assert.doesNotMatch(JSON.stringify([e.emitidos, e.logs]), /codigoDeVerdade123/);
  assert.equal(e.emitidos.some((x) => x.tipo === 'toast' && x.dados.kind === 'ok'), true);
  // login usado não aceita outro código
  assert.equal((await loginWeb.enviarCodigo(e, r.loginId, 'outrocodigo999')).code, 'expirou');
});

test('perfil sem pasta informada: o login grava na pasta do próprio perfil, sob o HOME do Farol', async () => {
  const cli = cliFalso();
  const e = engineFalso();
  const r = await loginWeb.iniciar(e, 'novo', { spawn: cli.spawn });
  assert.equal(r.ok, true);
  assert.equal(cli.chamadas[0].env.CLAUDE_CONFIG_DIR, path.join(CLAUDE_PERFIS_DIR, 'novo'));
  assert.equal(fs.statSync(path.join(CLAUDE_PERFIS_DIR, 'novo')).isDirectory(), true);
  loginWeb.cancelar(e, r.loginId);
});

test('um login por vez: o segundo iniciar com login em curso é recusado, e o primeiro segue valendo', async () => {
  const cli = cliFalso();
  const e = engineFalso();
  const primeiro = loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  // ainda esperando o link: já conta como em curso
  const cedo = await loginWeb.iniciar(e, 'novo', { spawn: cli.spawn });
  assert.equal(cedo.ok, false);
  assert.equal(cedo.code, 'login-em-curso');
  const r = await primeiro;
  assert.equal(r.ok, true);
  const segundo = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  assert.equal(segundo.code, 'login-em-curso');
  assert.equal(cli.chamadas.length, 1, 'nenhum outro processo abriu');
  assert.deepEqual(await loginWeb.enviarCodigo(e, r.loginId, CODIGO), { ok: true });
  // terminado (ou cancelado), o próximo abre
  const terceiro = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  assert.equal(terceiro.ok, true);
  assert.deepEqual(loginWeb.cancelar(e, terceiro.loginId), { ok: true });
  const quarto = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  assert.equal(quarto.ok, true);
  loginWeb.cancelar(e, quarto.loginId);
});

test('código que o CLI recusa volta com o motivo, sem o link e sem o código', async () => {
  const cli = cliFalso({ falha: 'Request failed with status code 400', ecoaCodigo: true });
  const e = engineFalso();
  const r = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  const fim = await loginWeb.enviarCodigo(e, r.loginId, 'codigofalso#estadofalso');
  assert.equal(fim.ok, false);
  assert.equal(fim.code, 'recusado');
  assert.match(fim.motivo, /^Login failed: Request failed with status code 400/);
  assert.doesNotMatch(fim.motivo, /https:/);
  assert.doesNotMatch(JSON.stringify([fim, e.emitidos, e.logs]), /codigofalso/, 'o CLI ecoou o código, e ele não passa adiante');
  assert.equal(e.doctorChamado, 0);
});

test('código fora da forma nem chega ao CLI, e só perfil de assinatura utilizável abre login', async () => {
  const cli = cliFalso();
  const e = engineFalso();
  for (const id of ['k', 'fora', 'nao-existe', '']) {
    const r = await loginWeb.iniciar(e, id, { spawn: cli.spawn });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'sem-login', `perfil ${id || '(vazio)'} não abre login`);
  }
  assert.equal(cli.chamadas.length, 0);
  const r = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  for (const ruim of ['', 'curto', 'tem espaco no meio', 'linha\nnova', 'x'.repeat(3000), 'abc"; rm -rf /']) {
    assert.equal((await loginWeb.enviarCodigo(e, r.loginId, ruim)).code, 'codigo-invalido');
  }
  assert.equal(cli.chamadas[0].recebido, '');
  loginWeb.cancelar(e, r.loginId);
});

test('CLI que não mostra link vira falha com motivo, sem pendurar a tela nem segurar a vez', async () => {
  const e = engineFalso();
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 999998;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    setImmediate(() => { child.stderr.write('claude: command not found\n'); child.emit('exit', 127); });
    return child;
  };
  const r = await loginWeb.iniciar(e, 'p1', { spawn, prazoDoLinkMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sem-link');
  const cli = cliFalso();
  const depois = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  assert.equal(depois.ok, true, 'a falha libera a vez');
  loginWeb.cancelar(e, depois.loginId);
});

test('login que dá certo esquece o uso do plano guardado da pasta', async () => {
  const cli = cliFalso();
  const e = engineFalso();
  const saida = { ok: true, code: 0, stdout: JSON.stringify({ result: 'Current session: 5% used', credential_expires_at: '2026-12-04T11:45:01.476Z' }), stderr: '' };
  await uso.lerUso(e, PERFIS[0], { rodar: async () => saida });
  await uso.lerUso(e, PERFIS[1], { rodar: async () => saida });
  assert.deepEqual([...e.usosDoPlano.keys()], ['p1', 'novo']);
  const r = await loginWeb.iniciar(e, 'p1', { spawn: cli.spawn });
  await loginWeb.enviarCodigo(e, r.loginId, CODIGO);
  assert.deepEqual([...e.usosDoPlano.keys()], ['novo'], 'só a pasta que logou é lida de novo');
});

test('as funções puras: link, código e motivo', () => {
  assert.equal(loginWeb.linkDaSaida(`visit: ${LINK}\nPaste`), LINK);
  assert.equal(loginWeb.linkDaSaida('nada aqui'), '');
  assert.equal(loginWeb.codigoValido(' abc123def#xyz '), 'abc123def#xyz');
  assert.equal(loginWeb.codigoValido('abc"; rm -rf /'), '');
  assert.equal(loginWeb.motivoDaFalha('sem a linha'), 'o Claude Code não aceitou o código');
  assert.equal(loginWeb.motivoDaFalha('Login failed: recusei segredo#123 aqui', 'segredo#123'), 'Login failed: recusei  aqui');
});

test('o painel mostra o link só se for https, e não oferece o login pelo terminal', () => {
  const html = loginWebHtml({ estado: 'link', perfil: 'Pessoal Max 20X', url: LINK });
  assert.match(html, /Login do Claude em Pessoal Max 20X/);
  assert.match(html, /href="https:\/\/claude\.com\/cai\/oauth\/authorize/);
  assert.match(html, /id="cpLoginWebCodigo"/);
  assert.match(html, /autocomplete="off"/);
  assert.doesNotMatch(html, /terminal/i);
  const falso = loginWebHtml({ estado: 'link', url: 'javascript:alert(1)', motivo: 'm' });
  assert.doesNotMatch(falso, /javascript:/);
  assert.doesNotMatch(falso, /cpLoginWebCodigo/);
  assert.equal(loginWebHtml({}), '');
  assert.match(loginWebHtml({ estado: 'enviando', url: LINK }), /disabled/);
  assert.match(loginWebHtml({ estado: 'feito', perfil: 'P' }), /Login feito/);
});

// `/bin/sh -lc` lê /etc/profile e ~/.profile DEPOIS do ambiente limpo: um profile que
// exporte CLAUDE_CONFIG_DIR ou ANTHROPIC_* gravaria o login no lugar errado. Prova num shell
// de login de verdade, com um `claude` falso que imprime o que recebeu.
test('o shell de login não deixa o ~/.profile trocar a pasta nem vazar chave', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-login-profile-'));
  try {
    fs.writeFileSync(path.join(home, '.profile'), 'export CLAUDE_CONFIG_DIR=/errado\nexport ANTHROPIC_API_KEY=vazou\n');
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'bin', 'claude'), '#!/bin/sh\necho "dir=${CLAUDE_CONFIG_DIR:-} chave=${ANTHROPIC_API_KEY:-} args=$*"\n', { mode: 0o755 });
    const rodar = (linha) => cp.spawnSync('/bin/sh', ['-lc', linha], { env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).stdout.trim();
    assert.equal(rodar(loginWeb.linhaPosix('/home/farol/.farol/claude/pessoal')), 'dir=/home/farol/.farol/claude/pessoal chave= args=auth login');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// O CLI pode fechar a entrada enquanto o código chega. Sem ouvinte, o EPIPE assíncrono do
// stdin vira exceção não tratada e derruba o engine inteiro.
test('EPIPE no stdin do login não derruba o processo e volta como falha', async () => {
  const { Writable } = await import('node:stream');
  const e = engineFalso();
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 999997;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_c, _e, cb) { cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); } });
    setImmediate(() => child.stdout.write(`visit: ${LINK}\nPaste code here if prompted > `));
    child.stdin.once('error', () => setImmediate(() => child.emit('exit', 1)));
    return child;
  };
  const r = await loginWeb.iniciar(e, 'p1', { spawn });
  const fim = await loginWeb.enviarCodigo(e, r.loginId, CODIGO);
  assert.equal(fim.ok, false);
  assert.equal(fim.code, 'recusado');
});
