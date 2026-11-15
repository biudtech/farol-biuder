// Limite do plano e resolução do perfil com um perfil do Claude Code por chave de API
// (corte 09). O registro por assinatura, a espera do PR até o reset, o prazo estimado quando
// a mensagem não diz a hora e a conta com perfil próprio seguem como eram, sem a troca de
// perfil que a cadeia fazia.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-limite-apikey-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { LIMITE_PLANO_FILE } = await import('../lib/paths.js');
const { comPerfilDaSessao, registrarLimite } = await import('../lib/engine/limite-plano.js');
const perfilMod = (await import('../lib/engine/perfil-claude.js')).default;
const pushback = await import('../lib/engine/pushback.js');
const prov = (await import('../lib/engine/provedores.js')).default;
const { runClaudeStream } = await import('../lib/engine/session.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const MSG_LIMITE = "claude saiu com código 1: You've hit your limit · resets 5:50pm";
const MSG_OAUTH = 'Failed to authenticate: OAuth session expired and could not be refreshed';
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

const A = { id: 'ka', label: 'Chave A', kind: 'apikey', apiKey: 'sk-a', baseUrl: '' };
const B = { id: 'kb', label: 'Chave B', kind: 'apikey', apiKey: 'sk-b', baseUrl: '' };

function engineCom(perfis = [A], extra = {}) {
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { /* best-effort */ }
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  e.saveConfig = () => { };
  e.accountForPr = () => 'eu';
  e.isMuted = () => false;
  e.tokens = { eu: 't1' };
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.prState = async () => 'OPEN';
  e.config.accounts = [{ user: 'eu', owners: ['o'] }];
  e.config.claudeProfiles = perfis;
  e.config.claudeProfileId = '';
  Object.assign(e.config, extra);
  return e;
}

const chave = (p) => `apikey:${p.id}`;

/* ---------- qual perfil atende a conta ---------- */

test('o perfil padrão vale; sem padrão, o primeiro de chave de API utilizável', () => {
  const e = engineCom([A, B], { claudeProfileId: 'kb' });
  assert.equal(e.resolveClaudeAuth('eu').id, 'kb');
  e.config.claudeProfileId = '';
  assert.equal(e.resolveClaudeAuth('eu').id, 'ka');
  e.config.claudeProfileId = 'sumiu';
  assert.equal(e.resolveClaudeAuth('eu').id, 'ka', 'padrão que não existe cai no primeiro utilizável');
  e.config.claudeProfiles = [{ ...A, apiKey: '' }, B];
  assert.equal(e.resolveClaudeAuth('eu').id, 'kb', 'perfil sem chave não é utilizável');
});

test('sem perfil utilizável não há autenticação, e a sessão nem abre', async () => {
  const e = engineCom([]);
  assert.equal(e.resolveClaudeAuth('eu'), null);
  assert.equal(e.allClaudeAuthInfo().length, 0);
  const antes = process.env.FAROL_HEADLESS_CMD;
  delete process.env.FAROL_HEADLESS_CMD;
  try {
    await assert.rejects(() => runClaudeStream(e, 'x', { account: 'eu', id: 'sem-perfil' }), /sem perfil de chave de API utilizável/);
  } finally {
    if (antes !== undefined) process.env.FAROL_HEADLESS_CMD = antes;
  }
});

test('conta com perfil próprio usa só ele: perfil próprio quebrado não transborda para o padrão', () => {
  const e = engineCom([A, B], { claudeProfileId: 'ka' });
  e.config.accounts = [{ user: 'eu', owners: ['o'], claudeProfileId: 'kb' }];
  assert.equal(e.resolveClaudeAuth('eu').id, 'kb');
  e.config.accounts[0].claudeProfileId = 'apagado';
  assert.equal(e.resolveClaudeAuth('eu'), null, 'a conta presa a um perfil que sumiu fica sem perfil em vez de gastar a chave de outro');
  assert.deepEqual(perfilMod.problemasDePerfil(e.config), [{ escopo: 'conta', user: 'eu', profileId: 'apagado', code: 'perfil-inexistente' }]);
});

test('orçamento estourado pausa a automação do perfil, sem trocar de perfil', () => {
  const e = engineCom([A, B], { claudeProfileId: 'ka' });
  e.profileBudgetStatus = (p) => ({ blocked: p.id === 'ka' });
  assert.equal(e.resolveClaudeAuth('eu').id, 'ka');
  assert.equal(e.budgetBlockedFor('eu').id, 'ka');
});

/* ---------- limite do plano ---------- */

test('o limite fica no perfil, e o PR espera o reset sem estacionar e sem abrir sessão', async () => {
  const e = engineCom([A]);
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  e.runHeadlessReview = async () => {
    throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: e.resolveClaudeAuth('eu') });
  };
  await e.runOneHeadless(prDe('o/r#1'), 'eu');
  const guardado = e.retryAfterNet.get('o/r#1');
  assert.ok(guardado.notBefore > Date.now(), 'espera a hora do reset');
  assert.equal(e.autoReviewParked.has('o/r#1'), false);
  assert.equal(e.limiteDoPlanoAte('eu'), guardado.notBefore);
  assert.match(toasts.at(-1), /Limite atingido no perfil "Chave A"\. Retomo o\/r#1 sozinho depois das 17:50/);
  let abriu = 0;
  e.runHeadlessReview = async () => { abriu++; };
  await e.runOneHeadless(guardado.pr, 'eu');
  assert.equal(abriu, 0, 'nenhuma sessão paga enquanto o perfil está no limite');
  assert.equal(e.retryAfterNet.get('o/r#1').notBefore, guardado.notBefore);
});

test('limite sem hora: prazo estimado, visível como estimado', async () => {
  const e = engineCom([A]);
  e.runHeadlessReview = async () => {
    throw Object.assign(new Error("claude saiu com código 1: You've hit your limit"), { perfilDaSessao: e.resolveClaudeAuth('eu') });
  };
  const antes = Date.now();
  await e.runOneHeadless(prDe('o/r#3'), 'eu');
  const reg = e.limitesDePlano.get(chave(A));
  assert.equal(reg.estimado, true);
  assert.ok(reg.ate >= antes + 3600e3 - 1000 && reg.ate <= Date.now() + 3600e3);
  assert.equal(e.retryAfterNet.get('o/r#3').notBefore, reg.ate);
});

test('o limite trava o perfil que a sessão USOU, mesmo que a conta já resolva para outro', async () => {
  const e = engineCom([A, B], { claudeProfileId: 'ka' });
  e.runHeadlessReview = async () => {
    const usado = e.resolveClaudeAuth('eu');
    e.config.claudeProfileId = 'kb'; // a configuração mudou enquanto a sessão rodava
    throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: usado });
  };
  await e.runOneHeadless(prDe('o/r#4'), 'eu');
  assert.equal(e.limitesDePlano.has(chave(A)), true);
  assert.equal(e.limitesDePlano.has(chave(B)), false);
});

test('a sessão real estampa na falha a assinatura que usou, sem a chave', async () => {
  const e = engineCom([A]);
  fs.mkdirSync(path.join(process.env.FAROL_HOME, 'workspace'), { recursive: true });
  process.env.FAROL_HEADLESS_CMD = `node -e "console.log(JSON.stringify({type:'result', is_error:true, result:'You have hit your limit', usage:{input_tokens:1,output_tokens:1}, total_cost_usd:0}))"`;
  try {
    await assert.rejects(() => runClaudeStream(e, 'x', { account: 'eu', id: 'a-limite' }), (err) => {
      assert.deepEqual(err.perfilDaSessao, { kind: 'apikey', id: 'ka' });
      assert.equal('apiKey' in err.perfilDaSessao, false, 'a chave nunca viaja no erro');
      return true;
    });
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
  const erro = new Error('x');
  await assert.rejects(comPerfilDaSessao(e, Promise.reject(erro), { kind: 'apikey', id: 'k', apiKey: 'segredo' }));
  assert.deepEqual(erro.perfilDaSessao, { kind: 'apikey', id: 'k' });
});

test('sessão que conclui libera o perfil que ELA usou, não o que a conta resolve agora', async () => {
  const e = engineCom([A, B], { claudeProfileId: 'kb' });
  e.limitesDePlano.set(chave(A), { ate: Date.now() + 3600e3, em: Date.now(), estimado: true });
  e.limitesDePlano.set(chave(B), { ate: Date.now() + 1800e3, em: Date.now() });
  await comPerfilDaSessao(e, Promise.resolve({ text: 'ok' }), { kind: 'apikey', id: 'ka', apiKey: 'sk-a' });
  assert.equal(e.limitesDePlano.has(chave(A)), false, 'a sessão no A concluiu: o A voltou');
  assert.equal(e.limitesDePlano.has(chave(B)), true, 'o B continua no limite dele');
});

test('reset citado pelo provedor substitui o prazo estimado, mesmo mais cedo', () => {
  const e = engineCom([A]);
  const agora = Date.now();
  const auth = { kind: 'apikey', id: 'ka' };
  registrarLimite(e, 'eu', agora + 3600e3, agora, { auth, estimado: true });
  registrarLimite(e, 'eu', agora + 600e3, agora, { auth });
  assert.deepEqual(e.limitesDePlano.get(chave(A)), { ate: agora + 600e3, em: agora, estimado: false });
  // e um novo palpite não desfaz o reset confirmado
  registrarLimite(e, 'eu', agora + 300e3, agora, { auth, estimado: true });
  assert.equal(e.limitesDePlano.get(chave(A)).ate, agora + 600e3);
});

test('pushback sem hora de reset trava o perfil usado por prazo estimado', () => {
  const e = engineCom([A]);
  const agora = Date.now();
  const ate = pushback.default.esperarResetDePlano(e, "sessão retornou erro: You've hit your limit", agora, 'eu', { kind: 'apikey', id: 'ka' });
  assert.equal(ate, agora + 3600e3);
  assert.equal(e.limitesDePlano.get(chave(A)).estimado, true);
});

test('credencial expirada estaciona a revisão, sem laço de retentativa', async () => {
  const e = engineCom([A]);
  e.runHeadlessReview = async () => { throw Object.assign(new Error(MSG_OAUTH), { perfilDaSessao: e.resolveClaudeAuth('eu') }); };
  await e.runOneHeadless(prDe('o/r#802'), 'eu');
  assert.equal(e.autoReviewParked.has('o/r#802'), true);
  assert.equal(e.retryAfterNet.has('o/r#802'), false);
});

/* ---------- provedor ---------- */

test('o perfil de chave de API é do Claude, e o limite é lido pela tabela única de falhas', () => {
  const agora = new Date(2026, 9, 20, 12, 0).getTime();
  assert.equal(prov.provedorDoPerfil(A).id, 'claude');
  assert.equal(prov.provedorDoPerfil({ kind: 'dir' }), null, 'outros formatos não são mais de provedor nenhum');
  assert.equal(prov.semCustoEmDolar('apikey'), false);
  assert.deepEqual(prov.modeloDoProvedor({ reviewModel: 'opus', reviewEffort: 'high' }, 'claude'), { modelo: 'opus', esforco: 'high' });
  const lido = prov.limiteDaMensagem('claude', "You've hit your usage limit · resets 5:50pm", agora);
  assert.equal(lido.limite, true);
  assert.equal(new Date(lido.ate).getHours(), 17);
  assert.deepEqual(prov.limiteDaMensagem('claude', 'ECONNRESET', agora), { limite: false, ate: null });
  assert.deepEqual(prov.limiteDaMensagem('claude', "You've hit your limit", agora), { limite: true, ate: null });
});

/* ---------- config antiga ---------- */

test('config antiga com perfis de outros tipos e chaves que saíram sobe sem erro, e só a chave de API fica', () => {
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({
    claudeProfiles: [
      { id: 'd', label: 'Pasta', dir: '/perfis/x' },
      { id: 'm', label: 'Máquina', kind: 'maquina' },
      { id: 'o', label: 'OR', kind: 'openrouter', apiKey: 'sk-or' },
      { id: 'c', label: 'Outro', kind: 'codex' },
      { id: 'g', label: 'Outro 2', kind: 'agy' },
      A,
    ],
    claudeProfileId: 'd',
    claudeConfigDir: '/legado',
    cadeiaPerfis: [{ id: 'd', ativo: true }],
    codexReviewModel: 'gpt-6.1-sol',
    agyReviewModel: 'gemini-3.8-flash-high',
    accounts: [{ user: 'eu', owners: ['o'] }],
  }));
  try {
    const e = new Engine();
    assert.deepEqual(e.config.claudeProfiles.map((p) => p.id), ['ka']);
    assert.equal(e.resolveClaudeAuth('eu').id, 'ka', 'o padrão apontava para um perfil ignorado: cai no primeiro utilizável');
    assert.deepEqual(perfilMod.problemasDePerfil(e.config).map((p) => p.code), ['perfil-inexistente']);
  } finally {
    fs.rmSync(path.join(process.env.FAROL_HOME, 'config.json'), { force: true });
  }
});
