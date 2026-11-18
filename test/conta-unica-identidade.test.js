// Uma instância, uma conta revisora: toda chamada `gh` do motor sai com o token DESSA conta.
// Um login diferente do configurado (item antigo com `account` de outra conta, chamador
// desatualizado) é ignorado: nunca resolve para outro token, nunca para o GH_TOKEN herdado do
// ambiente, e sem o token da conta revisora a chamada nomeada continua lançando alto.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-conta-unica-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineDe(conta, token) {
  const e = new Engine();
  e.config.conta = conta;
  e.token = token;
  e.tokenOk = !!token;
  e.log = () => { };
  return e;
}

function comEnvDaMaquina(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// a versão que espera: o ambiente fica sujo durante toda a chamada assíncrona
async function comEnvDaMaquinaAte(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const REVISORA = { user: 'revisora', owners: ['biudtech'] };

test('accountList devolve lista de um, vinda de config.conta', () => {
  const e = engineDe({ ...REVISORA, autoReview: false, onClean: 'approve', padroesRevisao: 'sem any' }, 'tok-revisora');
  const lista = e.accountList();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].user, 'revisora');
  assert.deepEqual(lista[0].owners, ['biudtech']);
  assert.equal(lista[0].autoReview, false);
  assert.equal(lista[0].onClean, 'approve');
  assert.equal(lista[0].padroesRevisao, 'sem any');
  for (const campo of ['muted', 'color', 'kind', 'label']) assert.equal(campo in lista[0], false, campo);
  assert.equal(e.primaryUser(), 'revisora');
});

test('a lista de contas antiga em memória não é lida', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  e.config.accounts = [{ user: 'intrusa', owners: ['acme'] }];
  assert.deepEqual(e.accountList().map((a) => a.user), ['revisora']);
});

test('o PR é sempre da conta revisora, mesmo marcado com outra conta', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  assert.equal(e.accountForPr({ key: 'acme/app#1', repo: 'acme/app', account: 'outra' }), 'revisora');
  assert.equal(e.accountForPr({ key: 'biudtech/app#2', repo: 'biudtech/app' }), 'revisora');
});

test('ghEnv sem user: token da conta revisora', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  assert.equal(e.ghEnv().GH_TOKEN, 'tok-revisora');
});

test('ghEnv com o user da conta: token dela, sem diferenciar caixa', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  assert.equal(e.ghEnv('revisora').GH_TOKEN, 'tok-revisora');
  assert.equal(e.ghEnv('Revisora').GH_TOKEN, 'tok-revisora');
});

test('ghEnv com user diferente: o argumento é ignorado e sai o token da conta revisora', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina', GITHUB_TOKEN: 'tok-da-maquina' }, () => {
    const env = e.ghEnv('outra');
    assert.equal(env.GH_TOKEN, 'tok-revisora', 'nunca o token herdado do ambiente');
    assert.equal('GITHUB_TOKEN' in env, false);
  });
  assert.equal(e.tokenFor('outra'), 'tok-revisora');
});

test('ghEnv com user (igual ou diferente) e a conta sem token: lança, e nomeia a conta configurada', () => {
  const e = engineDe(REVISORA, null);
  comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina' }, () => {
    assert.throws(() => e.ghEnv('revisora'), /conta revisora sem token no gh/);
    assert.throws(() => e.ghEnv('outra'), /conta revisora sem token no gh/, 'sem token não cai no ambiente nem no chaveiro');
  });
  assert.equal(e.tokenFor('outra'), null);
  assert.equal(e.tokenFor('revisora'), null);
});

test('ghEnv sem user e sem token não lança (o doctor chama assim), e o token do ambiente não vaza', () => {
  const e = engineDe(REVISORA, null);
  comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina', GITHUB_TOKEN: 'tok-da-maquina' }, () => {
    const env = e.ghEnv();
    assert.equal('GH_TOKEN' in env, false);
    assert.equal('GITHUB_TOKEN' in env, false);
  });
});

test('sem conta configurada: ghEnv sem user não lança e com user lança', () => {
  const e = engineDe(undefined, null);
  assert.equal(e.primaryUser(), '');
  assert.equal('GH_TOKEN' in e.ghEnv(), false);
  assert.throws(() => e.ghEnv('qualquer'), /sem token no gh/);
});

test('refreshTokens pede o token só da conta revisora', async () => {
  const io = (await import('../lib/io.js')).default;
  const real = io.run;
  const pedidos = [];
  io.run = async (cmd, args) => { pedidos.push(args.join(' ')); return { ok: true, code: 0, stdout: 'tok-novo\n', stderr: '' }; };
  try {
    const e = engineDe(REVISORA, null);
    e.config.accounts = [{ user: 'intrusa', owners: ['acme'] }];
    assert.equal(await e.refreshTokens(), true);
    assert.deepEqual(pedidos, ['auth token --user revisora']);
    assert.equal(e.tokenFor(), 'tok-novo');
    assert.equal(e.tokenOk, true);
  } finally { io.run = real; }
});

/* ---------- o que sobrou dos módulos de várias contas, com uma conta só ---------- */

test('sem token é estado: uma linha quando começa, e só volta a avisar depois de o token voltar', async () => {
  const gh = (await import('../lib/engine/gh-queries.js')).default;
  const linhas = [];
  const e = { log: (nivel, msg) => linhas.push(msg) };
  assert.equal(gh.avisarSemToken(e, 'maria', 'maria sem token no gh'), true);
  assert.equal(gh.avisarSemToken(e, 'maria', 'maria sem token no gh'), false);
  assert.equal(gh.avisarSemToken(e, 'Maria', 'maria sem token no gh'), false, 'login do GitHub não distingue caixa');
  gh.tokenVoltou(e, 'maria');
  assert.equal(gh.avisarSemToken(e, 'maria', 'maria sem token no gh'), true);
  assert.equal(linhas.length, 2);
});

test('a sessão ativa leva a conta revisora, mesmo quando o item veio marcado com outra', async () => {
  const io = (await import('../lib/io.js')).default;
  const real = io.run;
  io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  try {
    const e = engineDe(REVISORA, 'tok-revisora');
    e.refreshTokens = async () => { };
    e.pushState = () => { };
    // captura o registro no instante em que a sessão nasce e interrompe ali
    const parou = new Error('registro capturado');
    const vistos = [];
    e.activity = new Map();
    e.activity.set = function set(id) {
      if (e.activeReviews.has(id)) vistos.push(e.snapshot().activeSessions.find((x) => x.id === id));
      throw parou;
    };
    const pr = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7, author: 'bob', title: 'Ajuste', account: 'outra' };
    await assert.rejects(e.runHeadlessReview(pr), parou);
    assert.equal(vistos.length, 1);
    assert.equal(vistos[0].pr.account, 'revisora');
  } finally { io.run = real; }
});

test('a fila de espera vai à tela com a posição e o motivo, sem o mapa de conta por PR', () => {
  const e = engineDe(REVISORA, 'tok-revisora');
  e.pushState = () => { };
  e.config.parallelReviews = 1;
  e.config.globalParallelReviews = 2;
  const pr = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7, author: 'bob', title: 'Ajuste', requested: true };
  e.headlessQueue = [pr];
  e.headlessBusyAccounts.set('revisora', 1);
  e.processHeadless();
  const snap = e.snapshot();
  assert.deepEqual(snap.headlessWaiting, ['acme/app#7']);
  assert.deepEqual(snap.headlessWaitingDetails[pr.key], { posicao: 1, total: 1, motivo: 'limite-conta', ocupadas: 1, limite: 1 });
  assert.equal(snap.headlessWaitingPrs[0].account, 'revisora');
  assert.equal('headlessWaitingContas' in snap, false);
  assert.equal(e.activeReviews.size, 0, 'a leitura não abre uma sessão');
});

test('postar num PR de org que a conta não lista sai com o token da conta revisora, nunca com outro', async () => {
  const io = (await import('../lib/io.js')).default;
  const real = io.run;
  const envios = [];
  io.run = async (cmd, args, opts) => {
    if ((args || []).includes('--input')) envios.push({ rota: args[1], token: opts.env.GH_TOKEN, github: opts.env.GITHUB_TOKEN });
    return { ok: true, code: 0, stdout: '{}', stderr: '' };
  };
  try {
    const e = engineDe(REVISORA, 'tok-revisora');
    e.refreshTokens = async () => { };
    e.pushState = () => { };
    const pr = { key: 'Desconhecida/app#9', repo: 'Desconhecida/app', number: 9, author: 'alguem', account: 'outra' };
    const r = await comEnvDaMaquinaAte({ GH_TOKEN: 'tok-da-maquina', GITHUB_TOKEN: 'tok-da-maquina' },
      () => e.postReview(pr, { event: 'COMMENT', body: 'Ok por aqui.' }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(envios, [{ rota: 'repos/Desconhecida/app/pulls/9/reviews', token: 'tok-revisora', github: undefined }]);
  } finally { io.run = real; }
});

test('sem o token da conta revisora, a postagem não sai nem com token no ambiente', async () => {
  const io = (await import('../lib/io.js')).default;
  const real = io.run;
  const chamadas = [];
  io.run = async (cmd, args) => { chamadas.push(args || []); return { ok: true, code: 0, stdout: '', stderr: '' }; };
  try {
    const e = engineDe(REVISORA, null);
    e.refreshTokens = async () => { };
    e.pushState = () => { };
    const pr = { key: 'biudtech/app#3', repo: 'biudtech/app', number: 3, author: 'alguem', account: 'outra' };
    const r = await comEnvDaMaquinaAte({ GH_TOKEN: 'tok-da-maquina' }, () => e.postReview(pr, { event: 'COMMENT', body: 'Ok por aqui.' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /conta revisora sem token/);
    assert.equal(chamadas.filter((a) => a.some((x) => /pulls|reviews/.test(String(x)))).length, 0, 'nenhuma chamada tocou o PR');
  } finally { io.run = real; }
});

test('sem conta revisora configurada a sessão de revisão não abre (não há identidade para o gh)', async () => {
  const e = engineDe(undefined, null);
  e.pushState = () => { };
  const r = await e.runHeadlessReview({ key: 'acme/app#8', url: 'https://github.com/acme/app/pull/8', repo: 'acme/app', number: 8, author: 'bob' });
  assert.deepEqual(r, { ok: false, code: 'sem_conta' });
  assert.equal(e.activeReviews.size, 0);
});
