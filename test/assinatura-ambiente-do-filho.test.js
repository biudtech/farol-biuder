// O ambiente do processo filho da sessão headless, por tipo de perfil (15/11/2026, a
// assinatura voltou ao motor). Perfil de assinatura por pasta: o filho recebe o
// CLAUDE_CONFIG_DIR da pasta do perfil e NENHUMA chave de API, nem a herdada do ambiente do
// motor (a precedência do Claude Code põe a chave acima do login, sem erro nenhum). Perfil de
// chave de API: o inverso, como já era. Engine real, spawn trocado por um filho falso.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-assinatura-filho-'));
process.env.FAROL_HOME = FAROL_HOME;
delete process.env.FAROL_HEADLESS_CMD;

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';

// o mock precisa estar em vigor ANTES do import de lib/engine/session, que captura o módulo
import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { Engine } = await import('../server.js');
const { claudeAuthPosixPrefix, normalizeClaudeProfiles } = await import('../lib/parse.js');
const { CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');
const { aposLimite, limiteAte } = await import('../lib/engine/limite-plano.js');
const { provedorDoPerfil } = await import('../lib/engine/provedores.js');
const { bashDoTeste } = await import('./helpers/bash-real.js');

const HERDADAS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'];

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => {
  // credencial da máquina plantada de propósito: nenhuma pode chegar ao filho
  process.env.ANTHROPIC_API_KEY = 'sk-ant-herdada-do-motor';
  process.env.ANTHROPIC_AUTH_TOKEN = 'token-herdado-do-motor';
  process.env.ANTHROPIC_BASE_URL = 'https://host-herdado.exemplo';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-herdado-do-motor';
  process.env.CLAUDE_CONFIG_DIR = '/pasta/herdada/do/motor';
});

afterEach(() => {
  for (const nome of HERDADAS) delete process.env[nome];
  spawnImpl = null;
});

function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => { };
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4243;
  setImmediate(() => { child.emit('close', 0); });
  return child;
}

function engineCom(perfis, padrao) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  Object.assign(e.config, { claudeProfiles: normalizeClaudeProfiles(perfis), claudeProfileId: padrao, accounts: [] });
  return e;
}

async function spawnDaSessao(engine) {
  let capturado = null;
  spawnImpl = (...args) => { capturado = args; return filhoFalso(); };
  try { await engine.runClaudeStream('prompt qualquer', {}); }
  catch { /* o filho falso não devolve envelope; o que importa é o spawn */ }
  spawnImpl = null;
  assert.ok(capturado, 'a sessão chegou ao spawn');
  return { linha: capturado[1][1], env: capturado[2].env };
}

test('perfil de assinatura: o filho recebe a pasta do perfil e nenhuma chave de API, nem a herdada', async () => {
  const dir = path.join(FAROL_HOME, 'claude', 'plano');
  const { linha, env } = await spawnDaSessao(engineCom([{ id: 's1', label: 'Plano', kind: 'dir', dir }], 's1'));
  assert.equal(env.CLAUDE_CONFIG_DIR, dir);
  for (const nome of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.equal(nome in env, false, `${nome} herdada do motor não chega ao filho`);
  }
  // o `-l` lê o profile DEPOIS do ambiente montado: o prefixo limpa e repõe a pasta do perfil
  assert.ok(linha.startsWith(`unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN; export CLAUDE_CONFIG_DIR='${dir}'; claude -p `), linha.slice(0, 200));
});

test('perfil de assinatura sem pasta informada: a pasta é a do perfil, sob o HOME do Farol', async () => {
  const { env } = await spawnDaSessao(engineCom([{ id: 'plano-2', label: 'Plano 2', kind: 'dir' }], 'plano-2'));
  assert.equal(env.CLAUDE_CONFIG_DIR, path.join(CLAUDE_PERFIS_DIR, 'plano-2'));
  assert.ok(env.CLAUDE_CONFIG_DIR.startsWith(FAROL_HOME + path.sep));
  assert.equal('ANTHROPIC_API_KEY' in env, false);
});

test('perfil de chave de API: o filho recebe a chave do perfil e nenhuma pasta, como já era', async () => {
  const { linha, env } = await spawnDaSessao(engineCom([{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-do-perfil' }], 'k1'));
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-do-perfil');
  assert.equal('CLAUDE_CONFIG_DIR' in env, false, 'a pasta herdada do motor não chega ao filho');
  assert.equal('ANTHROPIC_BASE_URL' in env, false);
  assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
  assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in env, false);
  assert.ok(linha.startsWith('unset CLAUDE_CODE_OAUTH_TOKEN; claude -p '));
  assert.doesNotMatch(linha, /sk-ant-do-perfil/);
});

test('com os dois perfis, vale o padrão; sem padrão, o primeiro utilizável (regra de sempre)', async () => {
  const perfis = [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-do-perfil' }, { id: 's1', label: 'Plano', kind: 'dir' }];
  assert.equal((await spawnDaSessao(engineCom(perfis, 's1'))).env.CLAUDE_CONFIG_DIR, path.join(CLAUDE_PERFIS_DIR, 's1'));
  const semPadrao = await spawnDaSessao(engineCom(perfis, ''));
  assert.equal(semPadrao.env.ANTHROPIC_API_KEY, 'sk-ant-do-perfil');
  assert.equal('CLAUDE_CONFIG_DIR' in semPadrao.env, false);
});

test('sem perfil utilizável a sessão não abre, e a frase cai na classe que estaciona', async () => {
  const { classify } = await import('../lib/log-taxonomy.js');
  const e = engineCom([{ id: 'fora', label: 'Fora', kind: 'dir', dir: '/fora/do/home' }], 'fora');
  let abriu = false;
  spawnImpl = () => { abriu = true; return filhoFalso(); };
  await assert.rejects(e.runClaudeStream('prompt', {}), (err) => {
    assert.equal(classify(err.message).id, 'sem-perfil-de-chave');
    assert.equal(classify(err.message).kind, 'permanente');
    return true;
  });
  assert.equal(abriu, false);
});

test('prefixo posix do perfil de assinatura: o profile sujo não troca a pasta nem deixa chave (execução real)', { skip: bashDoTeste ? false : 'bash não encontrado no PATH' }, () => {
  const prefixo = claudeAuthPosixPrefix({ kind: 'dir', id: 's1', dir: "/home/farol/.farol/claude/com'aspa" });
  const sujo = 'export ANTHROPIC_API_KEY=chave-do-profile; export ANTHROPIC_AUTH_TOKEN=t; export ANTHROPIC_BASE_URL=https://x; export CLAUDE_CONFIG_DIR=/dir/do/profile; export CLAUDE_CODE_OAUTH_TOKEN=o; ';
  const saida = execFileSync(bashDoTeste, ['-c', `${sujo}${prefixo}echo "[$ANTHROPIC_API_KEY|$ANTHROPIC_AUTH_TOKEN|$ANTHROPIC_BASE_URL|$CLAUDE_CONFIG_DIR|$CLAUDE_CODE_OAUTH_TOKEN]"`]).toString().trim();
  assert.equal(saida, "[|||/home/farol/.farol/claude/com'aspa|]");
});

test('config antiga: perfis de tipos que saíram são ignorados sem lançar; pasta e chave ficam', () => {
  const lidos = normalizeClaudeProfiles([
    { id: 's1', label: 'Plano', kind: 'dir' },
    { id: 's2', label: 'Com pasta', kind: 'dir', dir: path.join(FAROL_HOME, 'claude', 'x') },
    { id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-x' },
    { id: 'maquina', label: 'Máquina', kind: 'maquina' },
    { id: 'c', label: 'Codex', kind: 'codex' },
    { id: 'g', label: 'Agy', kind: 'agy', email: 'a@b.c' },
    { id: 'o', label: 'OR', kind: 'openrouter', apiKey: 'sk-or' },
    { id: 'legado', label: 'Sem kind', dir: '/home/x/.claude-antigo' },
    { id: 'inj', label: 'Injeção', kind: 'dir', dir: '/a"; rm -rf /' },
    null, 'lixo', 7,
  ]);
  assert.deepEqual(lidos.map((p) => [p.id, p.kind]), [['s1', 'dir'], ['s2', 'dir'], ['k1', 'apikey']]);
  assert.deepEqual(lidos[0], { id: 's1', label: 'Plano', kind: 'dir', dir: '' });
  assert.equal('apiKey' in lidos[0], false);
  const e = new Engine();
  e.config.claudeProfiles = lidos;
  assert.doesNotThrow(() => e.snapshot());
});

test('o perfil de assinatura é do Claude, e o limite do plano espera o reset no perfil que a sessão usou', () => {
  assert.equal(provedorDoPerfil({ id: 's1', kind: 'dir' }).id, 'claude');
  for (const kind of ['maquina', 'codex', 'agy', 'openrouter', undefined]) assert.equal(provedorDoPerfil({ id: 'x', kind }), null);
  const e = engineCom([{ id: 's1', label: 'Plano Max', kind: 'dir' }], 's1');
  e.limitesDePlano = new Map();
  e.accountForPr = () => 'conta';
  const agora = Date.now();
  const erro = Object.assign(new Error("You've hit your session limit"), { perfilDaSessao: { kind: 'dir', id: 's1' } });
  const r = aposLimite(e, { key: 'o/r#1' }, erro, erro.message, agora);
  assert.equal(r.estimado, true);
  assert.ok(r.notBefore > agora, 'o PR espera, não estaciona');
  assert.match(r.aviso, /Plano Max/);
  assert.equal(limiteAte(e, 'conta', agora), r.notBefore, 'a boca da sessão segura a conta até o reset');
});
