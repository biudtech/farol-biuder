// Perfil de assinatura SEM LOGIN não é perfil pronto (revisão do diff de 15/11/2026). A pasta
// do perfil resolver não basta: sem o arquivo de credencial nela, o doctor não fica verde, o
// check de ambiente diz que falta entrar com a assinatura, e a sessão é recusada ANTES de
// abrir o processo, numa classe permanente (a revisão estaciona com o motivo dito, em vez de
// abrir a cada ciclo uma sessão que morre por falta de login). O motor só confere que o
// arquivo existe; nunca o abre.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-assinatura-sem-login-'));
process.env.FAROL_HOME = FAROL_HOME;
delete process.env.FAROL_HEADLESS_CMD;

import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';

const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const perfilMod = await import('../lib/engine/perfil-claude.js');
const { classify } = await import('../lib/log-taxonomy.js');
const { CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');
const { caminhoSensivel } = await import('../lib/engine/leitura-sensivel.js');
const { ARQUIVO_DE_GUARDAS } = await import('../lib/engine/guardas-da-sessao.js');
const { aoSair } = await import('../lib/engine/saida-ordenada.js');
const { default: loginWeb } = await import('../lib/engine/login-web.js');

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});
afterEach(() => { spawnImpl = null; });

const pasta = (id) => path.join(CLAUDE_PERFIS_DIR, id);
// o login gravado: o motor só olha se o arquivo existe
function logar(id) {
  fs.mkdirSync(pasta(id), { recursive: true });
  fs.writeFileSync(path.join(pasta(id), '.credentials.json'), '{}');
}

function engineCom(perfis, padrao) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  Object.assign(e.config, { claudeProfiles: perfis, claudeProfileId: padrao });
  return e;
}

function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() { } });
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4244;
  setImmediate(() => child.emit('close', 0));
  return child;
}

const PLANO = (id) => ({ id, label: `Plano ${id}`, kind: 'dir', dir: '' });
const CHAVE = { id: 'k', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-x', baseUrl: '' };

test('prontidão do perfil que o motor vai usar: assinatura só conta com a credencial na pasta', () => {
  assert.deepEqual(perfilMod.prontidaoDoPerfil({ claudeProfiles: [PLANO('sem')], claudeProfileId: 'sem' }, ''), { pronto: false, tipo: 'assinatura', falta: 'login' });
  // a conta no .claude.json não é login: quem vale é o arquivo da credencial
  fs.mkdirSync(pasta('so-conta'), { recursive: true });
  fs.writeFileSync(path.join(pasta('so-conta'), '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));
  assert.equal(perfilMod.prontidaoDoPerfil({ claudeProfiles: [PLANO('so-conta')], claudeProfileId: 'so-conta' }, '').pronto, false);
  assert.equal(perfilMod.infoDosPerfis({ claudeProfiles: [PLANO('so-conta')] })[0].ready, false);
  logar('com');
  assert.deepEqual(perfilMod.prontidaoDoPerfil({ claudeProfiles: [PLANO('com')], claudeProfileId: 'com' }, ''), { pronto: true, tipo: 'assinatura', falta: '' });
  assert.equal(perfilMod.infoDosPerfis({ claudeProfiles: [PLANO('com')] })[0].ready, true);
  assert.deepEqual(perfilMod.prontidaoDoPerfil({ claudeProfiles: [CHAVE], claudeProfileId: 'k' }, ''), { pronto: true, tipo: 'chave', falta: '' });
  assert.deepEqual(perfilMod.prontidaoDoPerfil({ claudeProfiles: [], claudeProfileId: '' }, ''), { pronto: false, tipo: '', falta: 'perfil' });
  // é o perfil que o motor USA: outro perfil pronto na lista não deixa o check verde
  const cfg = { claudeProfiles: [PLANO('sem'), CHAVE], claudeProfileId: 'sem' };
  assert.equal(perfilMod.prontidaoDoPerfil(cfg).pronto, false);
});

test('o doctor não fica verde com o perfil de assinatura sem login, e fica depois do login', async () => {
  const e = engineCom([PLANO('doc')], 'doc');
  await e.doctor();
  assert.equal(e.doctorInfo.claudePerfilPronto, false);
  assert.equal(e.doctorInfo.claudePerfilTipo, 'assinatura');
  assert.equal(e.doctorInfo.claudePerfilFalta, 'login');
  assert.equal(e.doctorInfo.claudeAuth[0].ready, false);
  logar('doc');
  await e.doctor();
  assert.equal(e.doctorInfo.claudePerfilPronto, true);
  assert.equal(e.doctorInfo.claudePerfilFalta, '');
});

test('sessão com perfil de assinatura sem login é recusada antes do processo, numa classe que estaciona', async () => {
  const e = engineCom([PLANO('boca')], 'boca');
  let abriu = 0;
  spawnImpl = () => { abriu += 1; return filhoFalso(); };
  await assert.rejects(e.runClaudeStream('prompt', {}), (err) => {
    assert.match(err.message, /sem login/);
    assert.match(err.message, /Plano boca/);
    const c = classify(err.message);
    assert.equal(c.id, 'sem-perfil-de-chave');
    assert.equal(c.kind, 'permanente');
    assert.equal(c.grupo, 'credencial');
    return true;
  });
  assert.equal(abriu, 0, 'nenhum processo abriu');
  logar('boca');
  try { await e.runClaudeStream('prompt', {}); } catch { /* o filho falso não devolve envelope */ }
  assert.equal(abriu, 1, 'com a credencial na pasta a sessão abre');
});

test('a frase do Claude Code para "não logado" cai em credencial, não em desconhecido', () => {
  const c = classify('sessão retornou erro: Not logged in · Please run /login');
  assert.equal(c.id, 'credencial-invalida');
  assert.equal(c.kind, 'permanente');
});

test('as guardas da sessão negam a leitura do arquivo de credencial do Claude', () => {
  const deny = JSON.parse(fs.readFileSync(ARQUIVO_DE_GUARDAS, 'utf8')).permissions.deny;
  assert.ok(deny.includes('Read(**/.credentials.json)'));
  assert.ok(deny.includes('Bash(*.credentials.json*)'));
});

test('o detector de leitura sensível enxerga a credencial na pasta padrão do perfil, sob o HOME do Farol', () => {
  // âncora no home do usuário de propósito em outro lugar: o HOME do Farol pode ficar fora dele
  const opcoes = { home: '/home/outro', perfis: [{ id: 'p1', label: 'P', kind: 'dir', dir: '' }, CHAVE] };
  const alvo = path.join(CLAUDE_PERFIS_DIR, 'p1', '.credentials.json');
  assert.equal(caminhoSensivel(alvo, opcoes), alvo);
  assert.equal(caminhoSensivel(path.join(CLAUDE_PERFIS_DIR, 'p1', 'settings.json'), opcoes), null);
  assert.equal(caminhoSensivel(path.join(CLAUDE_PERFIS_DIR, 'outro', '.credentials.json'), opcoes), null, 'pasta que não é de perfil nenhum');
  const informada = path.join(FAROL_HOME, 'assinaturas', 'x');
  assert.equal(caminhoSensivel(path.join(informada, '.credentials.json'), { home: '/home/outro', perfis: [{ id: 'p2', kind: 'dir', dir: informada }] }), path.join(informada, '.credentials.json'));
});

test('o motivo da recusa do login sai sem o código inteiro e sem cada metade dele', () => {
  const codigo = 'metadeUm12345#metadeDois67890';
  assert.equal(loginWeb.motivoDaFalha(`Login failed: recusei ${codigo} aqui`, codigo), 'Login failed: recusei  aqui');
  assert.equal(loginWeb.motivoDaFalha('Login failed: code=metadeUm12345 state=metadeDois67890 fim', codigo), 'Login failed: code= state= fim');
  // metade curta demais não é apagada do texto (apagaria letra solta da frase)
  assert.equal(loginWeb.motivoDaFalha('Login failed: a b', 'aaaaaaaaaa#b'), 'Login failed: a b');
});

// --- login pela tela: cancelar pelo perfil, e a saída ordenada -------------------------------

const LINK = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';
function cliDeMentira(processos) {
  return (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 999995;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write() { } });
    processos.push({ env: opts.env });
    setImmediate(() => child.stdout.emit('data', `visit: ${LINK}\nPaste code here if prompted > `));
    return child;
  };
}

test('cancelar pelo perfil encerra o login aberto dele (a tela que perdeu o loginId destrava o próximo)', async () => {
  const e = engineCom([PLANO('c1'), PLANO('c2')], 'c1');
  const processos = [];
  const spawn = cliDeMentira(processos);
  const a = await loginWeb.iniciar(e, 'c1', { spawn });
  assert.equal(a.ok, true);
  const b = await loginWeb.iniciar(e, 'c2', { spawn });
  assert.equal(b.code, 'login-em-curso');
  assert.equal(b.perfilAberto, 'c1', 'a recusa diz de qual perfil é o login aberto');
  assert.deepEqual(loginWeb.cancelar(e, '', 'c2'), { ok: true });
  assert.equal((await loginWeb.iniciar(e, 'c2', { spawn })).code, 'login-em-curso', 'cancelar por outro perfil não derruba o login aberto');
  assert.deepEqual(loginWeb.cancelar(e, '', 'c1'), { ok: true });
  const c = await loginWeb.iniciar(e, 'c2', { spawn });
  assert.equal(c.ok, true);
  loginWeb.cancelar(e, c.loginId);
});

test('a saída ordenada encerra o claude auth login em curso (o filho nasce destacado)', async () => {
  const e = engineCom([PLANO('sai')], 'sai');
  let filho = null;
  // processo de verdade, destacado como o do login: imprime o link e fica esperando
  const spawn = (cmd, args, opts) => {
    filho = realSpawn('/bin/sh', ['-c', `echo "visit: ${LINK}"; sleep 60`], { detached: true, stdio: 'pipe', env: opts.env });
    return filho;
  };
  const r = await loginWeb.iniciar(e, 'sai', { spawn });
  assert.equal(r.ok, true);
  const fim = new Promise((resolve) => filho.on('exit', (code, sinal) => resolve(sinal)));
  aoSair(e);
  assert.equal(await fim, 'SIGKILL');
  assert.equal((e.loginsWeb || new Map()).size, 0);
});

// --- a rota: cancelar pelo perfil e a pasta que a tela não escolhe ------------------------------

test('pela rota: cancel aceita o profileId, e POST /api/settings não aceita pasta vinda da tela', async () => {
  const noArquivo = path.join(FAROL_HOME, 'assinaturas', 'do-arquivo');
  const e = engineCom([{ id: 'arq', label: 'Do arquivo', kind: 'dir', dir: noArquivo }, PLANO('r1')], 'r1');
  e.doctor = async () => ({});
  e.config.port = 0;
  const server = await new Promise((resolve, reject) => { const s = startServer(e, (url, err) => (err ? reject(err) : resolve(s))); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (rota, corpo) => new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = http.request(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(dados), Connection: 'close' } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(dados);
  });
  try {
    const processos = [];
    spawnImpl = cliDeMentira(processos);
    const a = await post('/api/claude/login-web/start', { profileId: 'r1' });
    assert.equal(a.ok, true);
    const b = await post('/api/claude/login-web/start', { profileId: 'r1' });
    assert.equal(b.code, 'login-em-curso');
    assert.equal(b.perfilAberto, 'r1');
    assert.deepEqual(await post('/api/claude/login-web/cancel', { profileId: 'r1' }), { ok: true });
    const c = await post('/api/claude/login-web/start', { profileId: 'r1' });
    assert.equal(c.ok, true, 'cancelado pelo perfil, o próximo abre');
    await post('/api/claude/login-web/cancel', { loginId: c.loginId });
    spawnImpl = null;

    // a tela manda a lista inteira: pasta nova não entra, e a que veio do arquivo não se perde
    const r = await post('/api/settings', { claudeProfiles: [
      { id: 'arq', label: 'Renomeado', kind: 'dir', dir: '/tmp/trocada-pela-tela' },
      { id: 'r1', label: 'Plano r1', kind: 'dir', dir: path.join(FAROL_HOME, 'outra') },
      { id: 'novo', label: 'Novo', kind: 'dir', dir: path.join(FAROL_HOME, 'escolhida-na-tela') },
      CHAVE,
    ] });
    assert.equal(r.ok, true);
    assert.deepEqual(e.config.claudeProfiles.map((p) => [p.id, p.label, p.dir]), [
      ['arq', 'Renomeado', noArquivo], ['r1', 'Plano r1', ''], ['novo', 'Novo', ''], ['k', 'Chave', undefined],
    ]);
  } finally {
    spawnImpl = null;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
