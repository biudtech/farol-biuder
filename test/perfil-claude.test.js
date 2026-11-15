// Plano e chaves explícito (spec 7.A2), o comportamento: perfil de assinatura por pasta e de
// chave de API (a assinatura voltou em 15/11/2026, por decisão do dono).
// Aqui se prova o que a tela consome: o teste do perfil como ATO EXPLÍCITO (nada é gravado e
// nada roda), a origem de cada informação e o aviso de perfil apontado que não resolve.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-perfil-claude-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');

import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { problemasDePerfil, authFromProfile } = await import('../lib/engine/perfil-claude.js');
const { HOME, WORKSPACE, CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');
const { default: io } = await import('../lib/io.js');
const { runtimeChecks } = await import('../ui/pure.js');
const { startServer } = await import('../lib/http-server.js');

after(() => {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => {
  // credencial da máquina plantada de propósito: o teste do perfil não pode herdá-la
  process.env.ANTHROPIC_API_KEY = 'sk-ant-da-maquina-nao-deve-vazar';
  process.env.ANTHROPIC_AUTH_TOKEN = 'token-da-maquina';
  process.env.GH_TOKEN = 'gh-da-maquina';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.GH_TOKEN;
});

const CHAVE_A = { id: 'p1', label: 'A', kind: 'apikey', apiKey: 'sk-ant-a', baseUrl: '' };

function engineCom(config) {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.doctor = async () => ({});
  Object.assign(e.config, config);
  return e;
}

function configEmDisco() {
  const arq = path.join(process.env.FAROL_HOME, 'config.json');
  return fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
}

// --- perfil apontado que não resolve -----------------------------------------------

test('perfil padrão apontando para id que não existe é problema, não "usa o padrão"', () => {
  const p = problemasDePerfil({ claudeProfiles: [CHAVE_A], claudeProfileId: 'sumiu', accounts: [] });
  assert.deepEqual(p, [{ escopo: 'padrao', user: '', profileId: 'sumiu', code: 'perfil-inexistente' }]);
});

test('override de conta para id inexistente é problema da conta', () => {
  const p = problemasDePerfil({ claudeProfiles: [CHAVE_A], claudeProfileId: 'p1', accounts: [{ user: 'conta-x', claudeProfileId: 'apagado' }] });
  assert.deepEqual(p, [{ escopo: 'conta', user: 'conta-x', profileId: 'apagado', code: 'perfil-inexistente' }]);
});

test('id preenchido com a lista de perfis vazia também é problema (a resolução ignora o id)', () => {
  const p = problemasDePerfil({ claudeProfiles: [], claudeProfileId: 'p9', accounts: [] });
  assert.equal(p[0].code, 'perfil-inexistente');
});

test('perfil que existe mas não resolve (sem chave) é inválido', () => {
  const p = problemasDePerfil({ claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: '' }], claudeProfileId: 'k1', accounts: [] });
  assert.equal(p[0].code, 'perfil-invalido');
});

test('configuração saudável não tem problema, e sem id nenhum também não', () => {
  assert.deepEqual(problemasDePerfil({ claudeProfiles: [CHAVE_A], claudeProfileId: 'p1', accounts: [{ user: 'c', claudeProfileId: 'p1' }] }), []);
  assert.deepEqual(problemasDePerfil({ claudeProfiles: [], claudeProfileId: '', accounts: [{ user: 'c' }] }), []);
});

test('o snapshot leva os problemas, e o Diagnóstico mostra um check por problema', () => {
  const e = engineCom({ claudeProfiles: [CHAVE_A], claudeProfileId: 'sumiu', accounts: [] });
  const s = e.snapshot();
  assert.equal(s.claudePerfis.problemas.length, 1);
  const checks = runtimeChecks({}, {}, s.claudePerfis);
  const alvo = checks.find((c) => c.label === 'Perfil de chave de API');
  assert.ok(alvo, 'check presente');
  assert.equal(alvo.ok, false);
  assert.match(alvo.detail, /não existe/);
  assert.doesNotMatch(alvo.detail, /usa o padrão/i);
  assert.equal(alvo.goto, 'sys:plans:#claudeProfilesManager');
});

test('sem problema, nenhum check de perfil aparece', () => {
  assert.equal(runtimeChecks({}, {}, { problemas: [] }).some((c) => c.label === 'Perfil de chave de API'), false);
  assert.equal(runtimeChecks({}, {}).some((c) => c.label === 'Perfil de chave de API'), false);
});

test('a resolução real usa a mesma regra de perfil utilizável', () => {
  assert.equal(authFromProfile({ id: 'k', kind: 'apikey', apiKey: '' }), null);
  assert.deepEqual(authFromProfile(CHAVE_A), { kind: 'apikey', id: 'p1', apiKey: 'sk-ant-a', baseUrl: '' });
  const e = engineCom({ claudeProfiles: [CHAVE_A], claudeProfileId: 'p1', accounts: [] });
  assert.equal(e.resolveClaudeAuth('qualquer').apiKey, 'sk-ant-a');
});

// --- teste explícito do perfil --------------------------------------------------
// O que o teste PROVA: que o perfil existe e tem chave preenchida (a forma). O que NÃO prova:
// que a chave vale, porque isso exigiria uma chamada paga ao provedor, e o teste nunca gasta.

test('perfil de chave de API: nada roda, a chave nunca sai e a origem é informado', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-segredo-de-teste-123456', baseUrl: '' }], claudeProfileId: 'k1', accounts: [] });
  const antes = configEmDisco();
  const r = await e.claudeTestarPerfil({ profileId: 'k1' });
  assert.equal(r.ok, true);
  assert.equal(r.escreveu, false);
  assert.equal(configEmDisco(), antes, 'testar não grava a configuração');
  assert.equal(JSON.stringify(r).includes('sk-ant-segredo'), false);
  assert.deepEqual(r.perfil.campos.tipoAuth, { valor: 'chave-de-api', origem: 'informado' });
  assert.deepEqual(r.perfil.campos.chave, { valor: 'preenchida', origem: 'informado' });
  assert.equal(r.perfil.campos.login.origem, 'desconhecido');
  assert.equal(r.perfil.campos.plano.valor, null, 'o nome do plano não é exposto');
  assert.match(r.perfil.campos.plano.motivo, /não é detectável/);
  assert.equal(r.perfil.label, 'Chave');
});

test('testar perfil que não existe devolve erro, sem cair no padrão', async () => {
  const e = engineCom({ claudeProfiles: [CHAVE_A], claudeProfileId: 'p1', accounts: [] });
  const r = await e.claudeTestarPerfil({ profileId: 'apagado' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'perfil-inexistente');
});

test('testar perfil sem chave devolve erro de perfil incompleto', async () => {
  const e = engineCom({ claudeProfiles: [{ id: 'k1', label: 'Chave', kind: 'apikey', apiKey: '' }], claudeProfileId: '', accounts: [] });
  const r = await e.claudeTestarPerfil({ profileId: 'k1' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'perfil-invalido');
});

test('sem id, o teste é do perfil que a resolução usa; sem nenhum perfil, diz que não há', async () => {
  const e = engineCom({ claudeProfiles: [CHAVE_A], claudeProfileId: '', accounts: [] });
  const r = await e.claudeTestarPerfil({});
  assert.equal(r.ok, true);
  assert.equal(r.perfil.id, 'p1');
  const vazio = engineCom({ claudeProfiles: [], claudeProfileId: '', accounts: [] });
  const sem = await vazio.claudeTestarPerfil({});
  assert.equal(sem.ok, false);
  assert.equal(sem.code, 'sem-perfil');
});

// --- assinatura por pasta e chave de API ----------------------------------------------
// Decisão do dono de 15/11/2026: o Claude roda pelo plano de assinatura, e o perfil de pasta
// volta ao motor ao lado do de chave de API (o corte 09 tinha deixado só a chave).

test('authFromProfile aceita o perfil de assinatura por pasta e o de chave de API, e nenhum outro tipo', () => {
  assert.deepEqual(authFromProfile({ id: 'a', kind: 'apikey', apiKey: 'k' }), { kind: 'apikey', id: 'a', apiKey: 'k', baseUrl: '' });
  assert.deepEqual(authFromProfile({ id: 'a', kind: 'apikey', apiKey: 'k', baseUrl: 'https://proxy.exemplo.com' }), { kind: 'apikey', id: 'a', apiKey: 'k', baseUrl: 'https://proxy.exemplo.com' });
  // sem pasta informada, o motor usa a do próprio perfil, sob o HOME do Farol
  assert.deepEqual(authFromProfile({ id: 'plano-1', kind: 'dir' }), { kind: 'dir', id: 'plano-1', dir: path.join(CLAUDE_PERFIS_DIR, 'plano-1') });
  assert.ok(path.join(CLAUDE_PERFIS_DIR, 'plano-1').startsWith(HOME + path.sep), 'a pasta do perfil mora dentro do HOME do Farol');
  // pasta informada vale quando mora dentro do HOME do Farol
  const dentro = path.join(HOME, 'assinaturas', 'trabalho');
  assert.deepEqual(authFromProfile({ id: 'b', kind: 'dir', dir: dentro }), { kind: 'dir', id: 'b', dir: dentro });
  // fora do HOME o perfil não resolve: no container só esse volume persiste
  assert.equal(authFromProfile({ id: 'b', kind: 'dir', dir: '/x' }), null);
  assert.equal(authFromProfile({ id: 'b', kind: 'dir', dir: path.join(HOME, '..', 'fora') }), null);
  assert.equal(authFromProfile({ id: 'b', kind: 'dir', dir: path.join(WORKSPACE, 'claude') }), null, 'nunca dentro do workspace da sessão');
  assert.equal(authFromProfile({ id: '../escapa', kind: 'dir' }), null, 'id que não serve de nome de pasta');
  assert.equal(authFromProfile({ id: 'c', dir: '/x' }), null, 'perfil sem kind não é de pasta');
  assert.equal(authFromProfile({ id: 'c', dir: dentro }), null, 'perfil sem kind não é de pasta');
  assert.equal(authFromProfile({ id: 'd', kind: 'apikey', apiKey: '' }), null);
  assert.equal(authFromProfile({ id: 'e', kind: 'apikey' }), null);
  assert.equal(authFromProfile({ id: 'f', kind: 'maquina' }), null);
  assert.equal(authFromProfile({ id: 'g', kind: 'openrouter', apiKey: 'k' }), null);
  assert.equal(authFromProfile({ id: 'h', kind: 'codex' }), null);
  assert.equal(authFromProfile({ id: 'i', kind: 'agy' }), null);
  assert.equal(authFromProfile(null), null);
});

// --- a rota ---------------------------------------------------------------------

// --- teste explícito do perfil de assinatura -----------------------------------------
// `claude auth status --json` roda contra uma CÓPIA efêmera da configuração: o CLI reescreve
// o `.claude.json` da pasta que recebe, e testar não pode alterar a pasta da assinatura.

test('perfil de assinatura: o status roda na cópia efêmera, lê a credencial da pasta original e nada é gravado', async () => {
  const dir = path.join(HOME, 'claude', 'teste-status');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dona@exemplo.com' } }));
  fs.writeFileSync(path.join(dir, '.credentials.json'), '{"segredo":"nao-copiar"}');
  const antesDaPasta = fs.readdirSync(dir).sort();
  const e = engineCom({ claudeProfiles: [{ id: 's1', label: 'Plano', kind: 'dir', dir }], claudeProfileId: 's1', accounts: [] });
  const chamadas = [];
  const original = io.runShell;
  io.runShell = async (cmd, opts) => {
    chamadas.push({ cmd, env: { ...opts.env }, copiados: fs.readdirSync(opts.env.CLAUDE_CONFIG_DIR).sort() });
    return { ok: true, code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'dona@exemplo.com', subscriptionType: 'max' }), stderr: '' };
  };
  try {
    const antes = configEmDisco();
    const r = await e.claudeTestarPerfil({ profileId: 's1' });
    assert.equal(r.ok, true);
    assert.equal(r.escreveu, false);
    assert.equal(configEmDisco(), antes);
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].cmd, 'claude auth status --json');
    assert.notEqual(chamadas[0].env.CLAUDE_CONFIG_DIR, dir, 'a configuração é a cópia');
    assert.equal(chamadas[0].env.CLAUDE_SECURESTORAGE_CONFIG_DIR, dir, 'a credencial é lida da pasta original');
    assert.deepEqual(chamadas[0].copiados, ['.claude.json'], 'a credencial nunca é copiada');
    assert.equal(fs.existsSync(chamadas[0].env.CLAUDE_CONFIG_DIR), false, 'a cópia some no fim');
    for (const nome of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GH_TOKEN']) assert.equal(nome in chamadas[0].env, false, `${nome} herdada não entra`);
    assert.deepEqual(fs.readdirSync(dir).sort(), antesDaPasta, 'a pasta da assinatura não muda');
    assert.equal(r.perfil.kind, 'dir');
    assert.deepEqual(r.perfil.campos.login, { valor: true, origem: 'validado' });
    assert.deepEqual(r.perfil.campos.email, { valor: 'dona@exemplo.com', origem: 'validado' });
    assert.equal(r.perfil.campos.plano.valor, null, 'o nome do plano não é exposto');
    assert.equal(JSON.stringify(r).includes('max'), false);
    assert.equal(JSON.stringify(r).includes('nao-copiar'), false);
  } finally { io.runShell = original; }
});

test('perfil de assinatura: CLI que não responde vira leitura dos arquivos, com aviso', async () => {
  const dir = path.join(HOME, 'claude', 'teste-mudo');
  fs.mkdirSync(dir, { recursive: true });
  const e = engineCom({ claudeProfiles: [{ id: 's2', label: 'Plano', kind: 'dir', dir }], claudeProfileId: 's2', accounts: [] });
  const original = io.runShell;
  io.runShell = async () => ({ ok: false, code: 127, stdout: '', stderr: 'claude: not found' });
  try {
    const r = await e.claudeTestarPerfil({ profileId: 's2' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.perfil.campos.login, { valor: false, origem: 'inferido', motivo: 'pelos arquivos da pasta' });
    assert.match(r.perfil.aviso, /não respondeu/);
  } finally { io.runShell = original; }
});

test('a rota de teste faz o mesmo que a fachada, e as rotas de adoção e de login pelo terminal continuam fora', async () => {
  const e = engineCom({ claudeProfiles: [CHAVE_A], claudeProfileId: 'p1', accounts: [] });
  e.config.port = 0;
  const server = await new Promise((resolve, reject) => {
    const srv = startServer(e, (url, err) => (err ? reject(err) : resolve(srv)));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // node:http, não fetch: o agente com keep-alive do fetch segura socket e derruba o processo
  const pedir = (rota, corpo) => new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = http.request(base + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-farol': '1', 'Content-Length': Buffer.byteLength(dados), Connection: 'close' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: d }));
    });
    req.on('error', reject);
    req.end(dados);
  });
  try {
    const teste = await pedir('/api/claude/profile-test', {});
    assert.equal(teste.status, 200);
    const json = JSON.parse(teste.corpo);
    assert.equal(json.ok, true);
    assert.equal(json.escreveu, false);
    assert.equal(teste.corpo.includes('sk-ant-a'), false, 'a chave nunca sai pela rota');
    for (const rota of ['/api/claude/profile-adopt', '/api/claude-login']) {
      const r = await pedir(rota, { confirmar: true });
      assert.equal(r.status, 404, `${rota} saiu`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
