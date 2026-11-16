// Identidade de conta (raiz P1 do relatório de gaps): o Farol NUNCA age no GitHub nem
// abre sessão Claude com uma identidade que não seja a da conta revisora. tokenFor é a fonte
// única do token dela, sem herdar; as guardas das tarefas seguintes usam ele.
// Desde o corte para uma conta por instância (lote 14) não existe segunda conta: o cenário
// "conta do PR sem token" virou "a conta revisora sem token", e as mesmas guardas valem. O
// login diferente do configurado é provado em test/conta-unica-identidade.test.js.
// Padrões seguidos: espião no io.run ANTES do require do server.js (merge-gates.test.js)
// e Engine real contra FAROL_HOME temporário (claude-profiles.test.js).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-identidade-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião no run: os módulos de engine capturam a referência na desestruturação do
// require, então a troca tem que acontecer antes do require('../server.js'). O default
// devolve ok vazio: NENHUM gh real roda neste arquivo.
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [], env: (opts || {}).env });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true });

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { chamadas.length = 0; runImpl = null; });

// engine com a conta revisora `alice` (orgs acme e biudtech). `comToken: false` é o flake de
// keyring que dispara o A1: a conta existe, o gh não devolveu o token dela neste ciclo.
function engineDaConta({ comToken = true } = {}) {
  const e = new Engine();
  e.config.conta = { user: 'alice', owners: ['acme', 'biudtech'] };
  e.token = comToken ? 'tok-alice' : null;
  e.tokenOk = comToken;
  e.refreshTokens = async () => { };
  e.refreshToken = async () => { };
  e.log = () => { };            // não sujar o farol.log do temp
  e.on('toast', () => { });
  e.pushState = () => { };
  return e;
}

test('tokenFor: conta sem token devolve null, nunca inventa', () => {
  assert.equal(engineDaConta({ comToken: false }).tokenFor('alice'), null);
  assert.equal(engineDaConta().tokenFor('alice'), 'tok-alice');
});

test('tokenFor: sem user devolve o token da conta revisora (contrato das chamadas sem PR)', () => {
  const e = engineDaConta();
  assert.equal(e.tokenFor(''), 'tok-alice');
  assert.equal(e.tokenFor(undefined), 'tok-alice');
  e.token = null;
  assert.equal(e.tokenFor(undefined), null, 'conta sem token = null, não inventa');
});

/* ---------- buscas gh: nunca com a identidade errada (A1, M11) ---------- */

test('searchPRs: conta sem token não roda gh nenhum e devolve null (falha de busca, não identidade errada)', async () => {
  const e = engineDaConta({ comToken: false });
  const r = await e.searchPRs(['--review-requested=@me'], 'alice');
  assert.equal(r, null);
  assert.equal(chamadas.length, 0, 'zero chamadas gh: o @me nunca resolve na conta errada');
});

test('searchPRs: conta com token busca com o token DELA', async () => {
  const e = engineDaConta();
  runImpl = () => Promise.resolve({ ok: true, code: 0, stdout: '[]', stderr: '' });
  const r = await e.searchPRs(['--owner', 'acme'], 'alice');
  assert.deepEqual(r, []);
  assert.equal(chamadas[0].env.GH_TOKEN, 'tok-alice');
});

/* ---------- postagem: nunca com a identidade errada (A1, consequência 2) ---------- */

test('postReview: conta sem token NÃO posta (o APPROVE não sai pelo chaveiro do gh)', async () => {
  const e = engineDaConta({ comToken: false });
  const pr = { key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 };
  const r = await e.postReview(pr, { event: 'APPROVE', body: 'ok' });
  assert.equal(r.ok, false);
  assert.match(r.error, /sem token/);
  assert.equal(chamadas.length, 0, 'nenhum gh api reviews foi chamado');
});

test('myReviewStates: conta sem token devolve null (não confirma dedup pela identidade errada)', async () => {
  const e = engineDaConta({ comToken: false });
  const s = await e.myReviewStates({ key: 'biudtech/app#9', repo: 'biudtech/app', number: 9 });
  assert.equal(s, null);
  assert.equal(chamadas.length, 0);
});

/* ---------- leitores best-effort: sem token = incerteza pelo contrato ---------- */

test('staleForReview: conta sem token devolve indeterminado (nunca reativa Re-revisar nem relança por incerteza)', async () => {
  const e = engineDaConta({ comToken: false });
  const info = await e.staleForReview({ key: 'biudtech/app#8', repo: 'biudtech/app', number: 8, url: 'https://github.com/biudtech/app/pull/8' });
  assert.equal(info.stale, false);
  assert.equal(info.head, '', 'sem head, o gate de re-revisão automática também não arma');
  assert.equal(chamadas.length, 0);
});

/* ---------- lançamento de revisão: só conta com token abre sessão ---------- */

test('launchReview: com token, todo PR entra marcado com a conta revisora, qualquer que seja a org', async () => {
  const e = engineDaConta();
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview([
    'https://github.com/acme/app/pull/1',
    'https://github.com/outra-org/app/pull/2'
  ], 'auto');
  assert.equal(r.ok, true);
  assert.deepEqual(enfileirados.map(p => p.account), ['alice', 'alice']);
});

test('launchReview: conta sem token devolve erro sem enfileirar nada', async () => {
  const e = engineDaConta({ comToken: false });
  const enfileirados = [];
  e.enqueueHeadless = (pr) => { enfileirados.push(pr); };
  const r = await e.launchReview(['https://github.com/acme/app/pull/1'], 'auto');
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
});

test('runOneHeadless: falha por "sem token" é transitória (retry no próximo ciclo, não estaciona)', async () => {
  const e = engineDaConta({ comToken: false });
  e.runHeadlessReview = async () => { throw new Error('conta alice sem token no gh (gh auth login --user alice)'); };
  e.writeInflight = () => { };
  const pr = { key: 'biudtech/app#2', url: 'https://github.com/biudtech/app/pull/2', repo: 'biudtech/app', number: 2, account: 'alice' };
  await e.runOneHeadless(pr, 'alice');
  assert.equal(e.autoReviewParked.has('biudtech/app#2'), false, 'flake de keyring se resolve sozinho, não pode estacionar');
  // desde a Onda 7 (tarefa 7.4) o Map guarda { tries, pr }, não o número cru
  assert.equal(e.retryAfterNet.get('biudtech/app#2').tries, 1);
});

/* ---------- a raiz (A1): ghEnv nunca herda identidade ---------- */

test('ghEnv: conta pedida sem token LANÇA em vez de seguir sem identidade', () => {
  assert.throws(() => engineDaConta({ comToken: false }).ghEnv('alice'), /alice sem token no gh/);
  const e = engineDaConta();
  assert.equal(e.ghEnv('alice').GH_TOKEN, 'tok-alice');
  assert.equal(e.ghEnv().GH_TOKEN, 'tok-alice', 'sem user = a conta revisora');
});

test('ghEnv: sem user e sem token nenhum não lança (comportamento legado do doctor/boot)', () => {
  const e = engineDaConta({ comToken: false });
  const env = e.ghEnv();
  assert.equal('GH_TOKEN' in env, false);
});

// Token da MÁQUINA no ambiente é o mesmo A1 por outra porta: ghEnv parte de
// { ...process.env }, então, sem token resolvido, o filho saía agindo como a
// identidade do shell de quem abriu o Farol. Mesma correção (e mesma lição) do
// loginConsoleEnv em G21: quem cumpre a promessa tem que ser o código, não o
// ambiente. O helper suja o ambiente de propósito e restaura no fim; sem ele,
// estes casos passariam só nas máquinas que não exportam token nenhum.
function comEnvDaMaquina(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('ghEnv: GH_TOKEN da máquina no ambiente não vaza pro filho quando não há token resolvido', () => {
  const e = engineDaConta({ comToken: false });
  comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina' }, () => {
    assert.equal('GH_TOKEN' in e.ghEnv(), false, 'o gh sairia agindo como a identidade do shell, não como a conta do Farol');
  });
});

test('ghEnv: GITHUB_TOKEN da máquina também não vaza (o gh lê os dois no github.com)', () => {
  const e = engineDaConta({ comToken: false });
  comEnvDaMaquina({ GITHUB_TOKEN: 'tok-da-maquina' }, () => {
    assert.equal('GITHUB_TOKEN' in e.ghEnv(), false, 'limpar só o GH_TOKEN deixaria a mesma herança pela variável vizinha');
  });
});

test('ghEnv: token da conta resolvida vence o do ambiente, e o GITHUB_TOKEN sai junto', () => {
  const e = engineDaConta();
  comEnvDaMaquina({ GH_TOKEN: 'tok-da-maquina', GITHUB_TOKEN: 'tok-da-maquina' }, () => {
    const env = e.ghEnv('alice');
    assert.equal(env.GH_TOKEN, 'tok-alice');
    assert.equal('GITHUB_TOKEN' in env, false, 'GH_TOKEN vence no gh, mas GITHUB_TOKEN sobrando é identidade de reserva no filho');
  });
});
