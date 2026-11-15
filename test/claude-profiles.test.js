// Perfis de chave de API do Claude por conta: resolver, ambiente do filho e diagnóstico por
// perfil. Segue o padrão de boot.test.js (Engine real contra FAROL_HOME temporário).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-claude-profiles-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const CHAVE = (id, extra = {}) => ({ id, label: `Chave ${id}`, kind: 'apikey', apiKey: `sk-ant-${id}`, baseUrl: '', ...extra });

test('resolveClaudeAuth: perfil apikey da conta vence o padrão global', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [CHAVE('trabalho'), { id: 'chave-pessoal', label: 'Chave pessoal', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: '' }];
  engine.config.claudeProfileId = 'trabalho';
  engine.config.accounts = [{ user: 'bob', owners: ['x'], claudeProfileId: 'chave-pessoal' }];
  assert.deepEqual(engine.resolveClaudeAuth('bob'), { kind: 'apikey', id: 'chave-pessoal', apiKey: 'sk-ant-123', baseUrl: '' });
});

test('resolveClaudeAuth: padrão global apikey, conta sem override', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-456', baseUrl: 'https://proxy.x' }];
  engine.config.claudeProfileId = 'chave';
  engine.config.accounts = [{ user: 'carol', owners: [] }];
  assert.deepEqual(engine.resolveClaudeAuth('carol'), { kind: 'apikey', id: 'chave', apiKey: 'sk-ant-456', baseUrl: 'https://proxy.x' });
});

test('resolveClaudeAuth: padrão sem chave (corrompido) cai no primeiro utilizável; sem nenhum, não há autenticação', () => {
  const engine = new Engine();
  // perfil malformado não sobrevive à normalização em condições normais, mas
  // resolveClaudeAuth precisa ser robusto mesmo contra config.json editado à mão
  engine.config.claudeProfiles = [{ id: 'quebrado', label: 'Sem chave', kind: 'apikey', apiKey: '' }];
  engine.config.claudeProfileId = 'quebrado';
  assert.equal(engine.resolveClaudeAuth('qualquer'), null);
  engine.config.claudeProfiles.push(CHAVE('bom'));
  assert.equal(engine.resolveClaudeAuth('qualquer').id, 'bom');
});

test('resolveClaudeAuth: devolve o id do perfil resolvido; sem perfis não há id', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [CHAVE('chave-x')];
  engine.config.claudeProfileId = 'chave-x';
  assert.equal(engine.resolveClaudeAuth('qualquer').id, 'chave-x');
  engine.config.claudeProfiles = [];
  assert.equal(engine.resolveClaudeAuth('qualquer'), null);
  assert.equal(engine.profileOfAccount('qualquer'), null, 'sem perfil não há a quem atribuir teto');
});

test('profileBudgetStatus (fachada): delega pro usage.js com this.usage', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 1 }];
  const profile = engine.config.claudeProfiles[0];
  // sem nenhum uso registrado ainda: não bloqueia
  assert.equal(engine.profileBudgetStatus(profile).blocked, false);
});

function comEnvDaMaquina(vars, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('ghEnv: perfil apikey seta ANTHROPIC_API_KEY/BASE_URL, nunca CLAUDE_CONFIG_DIR', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: 'https://proxy.x' }];
  engine.config.claudeProfileId = 'chave';
  engine.tokens = { bob: 't-b' };
  const env = engine.ghEnv('bob');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-abc');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://proxy.x');
  assert.equal('CLAUDE_CONFIG_DIR' in env, false);
});

test('ghEnv: perfil apikey sem baseUrl não seta ANTHROPIC_BASE_URL', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-abc', baseUrl: '' }];
  engine.config.claudeProfileId = 'chave';
  engine.tokens = { bob: 't-b' };
  const env = engine.ghEnv('bob');
  assert.equal('ANTHROPIC_BASE_URL' in env, false);
});

test('ghEnv: credencial herdada da máquina não sobrevive ao perfil escolhido, nem sem perfil', () => {
  const heranca = {
    ANTHROPIC_API_KEY: 'sk-da-maquina', ANTHROPIC_AUTH_TOKEN: 'tok-da-maquina',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-expirado-da-maquina', CLAUDE_CONFIG_DIR: 'C:\\herdado', ANTHROPIC_BASE_URL: 'https://de-fora.x',
  };
  comEnvDaMaquina(heranca, () => {
    const engine = new Engine();
    engine.tokens = { bob: 't-b' };
    engine.config.claudeProfiles = [{ id: 'chave', label: 'Chave', kind: 'apikey', apiKey: 'sk-ant-perfil', baseUrl: '' }];
    engine.config.claudeProfileId = 'chave';
    const env = engine.ghEnv('bob');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-perfil');
    for (const k of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL']) {
      assert.equal(k in env, false, `${k} herdado sai do filho`);
    }
    engine.config.claudeProfiles = [];
    const sem = engine.ghEnv('bob');
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL']) {
      assert.equal(k in sem, false, `sem perfil, ${k} herdado também sai`);
    }
  });
});

test('allClaudeAuthInfo: sem perfis, lista vazia; com perfis, uma entrada por perfil, na ordem', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [];
  assert.deepEqual(engine.allClaudeAuthInfo(), []);
  engine.config.claudeProfiles = [CHAVE('a'), CHAVE('b')];
  assert.deepEqual(engine.allClaudeAuthInfo().map(x => x.id), ['a', 'b']);
});

test('allClaudeAuthInfo: perfil apikey com chave preenchida reporta ready + apiKeyMode, sem ler arquivo', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [CHAVE('k')];
  const entry = engine.allClaudeAuthInfo().find(x => x.id === 'k');
  assert.equal(entry.ready, true);
  assert.equal(entry.apiKeyMode, true);
  assert.equal(JSON.stringify(entry).includes('sk-ant-k'), false, 'a chave nunca vai para o diagnóstico');
});

test('allClaudeAuthInfo: perfil apikey sem chave (não deveria existir, mas defensivo) reporta ready:false', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'k', label: 'K', kind: 'apikey', apiKey: '' }];
  assert.equal(engine.allClaudeAuthInfo()[0].ready, false);
});

test('updateSettings: persiste claudeProfiles e claudeProfileId globais, e descarta o que não é chave de API', () => {
  const engine = new Engine();
  engine.updateSettings({
    claudeProfiles: [
      CHAVE('trabalho'),
      { id: 'sem-chave', label: 'Incompleto', kind: 'apikey', apiKey: '' }, // descartado (sem chave)
      { id: 'pasta', label: 'Pasta', dir: 'C:\\biud-trabalho' }, // descartado (outro formato)
      { id: 'cx', label: 'Outro', kind: 'codex' }, // descartado (outro formato)
    ],
    claudeProfileId: 'trabalho',
  });
  assert.deepEqual(engine.config.claudeProfiles, [CHAVE('trabalho')]);
  assert.equal(engine.config.claudeProfileId, 'trabalho');
});

test('updateSettings: persiste claudeProfileId por conta via accounts[]', () => {
  const engine = new Engine();
  engine.updateSettings({
    accounts: [{ user: 'bob', owners: ['biudtech'], claudeProfileId: 'trabalho' }]
  });
  assert.equal(engine.config.accounts[0].claudeProfileId, 'trabalho');
  assert.equal(engine.accountList()[0].claudeProfileId, 'trabalho');
  const snap = engine.snapshot();
  assert.equal(snap.accounts[0].claudeProfileId, 'trabalho');
});

test('updateSettings: accounts sozinho NÃO redispara doctor (allClaudeAuthInfo não lê accounts)', async () => {
  const engine = new Engine();
  let doctorCalls = 0;
  const originalDoctor = engine.doctor.bind(engine);
  engine.doctor = (...args) => { doctorCalls++; return originalDoctor(...args); };
  engine.updateSettings({ accounts: [{ user: 'dave', owners: [] }] });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(doctorCalls, 0, 'editar accounts não deveria recalcular doctor - achado da revisão final');
});

test('updateSettings: claudeProfiles/claudeProfileId continuam disparando doctor normalmente', async () => {
  const engine = new Engine();
  let doctorCalls = 0;
  const originalDoctor = engine.doctor.bind(engine);
  engine.doctor = (...args) => { doctorCalls++; return originalDoctor(...args); };
  engine.updateSettings({ claudeProfileId: 'x' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(doctorCalls, 1);
});

test('boot com config.json malformado (claudeProfiles string, claudeProfileId número): normaliza no construtor, não crasha (execução real em processo novo)', () => {
  // processo próprio (não o deste arquivo de teste): CONFIG_FILE/HOME são consts de
  // módulo lidas no require, então só um processo novo prova o boot real com o
  // config.json malformado já em disco ANTES do require('../server.js').
  const badHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-malformed-boot-'));
  fs.mkdirSync(badHome, { recursive: true });
  fs.writeFileSync(path.join(badHome, 'config.json'), JSON.stringify({
    claudeProfiles: 'abc', // string, não array: .find/.map lançariam TypeError sem o fix
    claudeProfileId: 123,  // número: sem o fix, ficaria cru (não é o crash em si, mas deve normalizar)
  }));
  const script = `
    import { pathToFileURL } from 'node:url';
    process.env.FAROL_HOME = ${JSON.stringify(badHome)};
    const { Engine } = await import(pathToFileURL(${JSON.stringify(path.join(import.meta.dirname, '..', 'server.js'))}).href);
    const e = new Engine();
    const auth = e.resolveClaudeAuth('qualquer');
    const info = e.allClaudeAuthInfo();
    e.tokens = { qualquer: 'tok' };
    const env = e.ghEnv('qualquer');
    console.log(JSON.stringify({
      claudeProfiles: e.config.claudeProfiles,
      claudeProfileId: e.config.claudeProfileId,
      auth, authLen: info.length, hasEnv: 'CLAUDE_CONFIG_DIR' in env,
    }));
  `;
  let out;
  try {
    out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  } finally {
    fs.rmSync(badHome, { recursive: true, force: true });
  }
  const parsed = JSON.parse(out.trim().split('\n').pop());
  assert.deepEqual(parsed.claudeProfiles, [], 'claudeProfiles malformado (string) normaliza pra []');
  assert.equal(parsed.claudeProfileId, '123', 'claudeProfileId normaliza pra string');
  assert.equal(parsed.auth, null, 'resolveClaudeAuth não lança: sem perfil, sem autenticação');
  assert.equal(parsed.authLen, 0, 'allClaudeAuthInfo não lança, devolve lista vazia');
  assert.equal(parsed.hasEnv, false);
});

test('updateSettings: recalcula allClaudeAuthInfo quando claudeProfiles muda', async () => {
  const engine = new Engine();
  engine.updateSettings({ claudeProfiles: [CHAVE('novo')], claudeProfileId: 'novo' });
  // doctor() é assíncrono (dispara subprocessos gh/claude); espera terminar antes de checar
  await new Promise(r => setTimeout(r, 50));
  while (!engine.doctorInfo) await new Promise(r => setTimeout(r, 20));
  const entry = engine.doctorInfo.claudeAuth.find(x => x.id === 'novo');
  assert.ok(entry, 'perfil novo aparece no doctorInfo.claudeAuth após updateSettings');
  assert.equal(entry.ready, true);
  assert.equal(engine.doctorInfo.claudePerfilPronto, true, 'o check do Claude Code sabe que há perfil de chave utilizável');
});

// Fix 3: remover um perfil com 2+ contas referenciando ele podia deixar referência
// órfã, porque o listener cp-remove (ui/app.js) disparava N PATCHes fire-and-forget
// separados (accounts por conta afetada + claudeProfileId + claudeProfiles), sem
// garantia de ordem de chegada — o PATCH mais antigo/parcial podia processar por
// último e sobrescrever o array accounts inteiro, restaurando o id removido. O fix
// (só no front) passou a mandar UM ÚNICO patch combinado. Este teste prova que o
// backend (updateSettings, síncrono, sem await no meio) sempre suportou esse patch
// combinado atomicamente — documentando que o padrão "um patch só" é seguro.
test('updateSettings: patch combinado (claudeProfiles+claudeProfileId+accounts) é atômico', () => {
  const engine = new Engine();
  engine.updateSettings({
    claudeProfiles: [CHAVE('p1')],
    claudeProfileId: 'p1',
    accounts: [
      { user: 'alice', owners: [], claudeProfileId: 'p1' },
      { user: 'bob', owners: [], claudeProfileId: 'p1' }
    ]
  });
  // agora remove p1 num ÚNICO patch (simulando o novo comportamento do front)
  engine.updateSettings({
    claudeProfiles: [],
    claudeProfileId: '',
    accounts: [
      { user: 'alice', owners: [] }, // já sem claudeProfileId, como o front calcularia
      { user: 'bob', owners: [] }
    ]
  });
  assert.equal(engine.config.claudeProfileId, '');
  assert.equal(engine.config.accounts.find(a => a.user === 'alice').claudeProfileId, undefined);
  assert.equal(engine.config.accounts.find(a => a.user === 'bob').claudeProfileId, undefined);
});
