// Rede de proteção do Farol: funções puras exportadas pelo server.js.
// Runner nativo do Node (node --test), ZERO dependências. Ver docs/QUALITY.md.
// FAROL_HOME temporário por segurança (o require não toca disco, mas fixar o
// home garante que nenhum teste esbarre no ~/.farol real).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-pure-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';
const farol = (await import('../server.js')).default;
const { modelLabel, isPermanentBranch, parseAccounts,
  normalizeClaudeProfiles, applyClaudeAuthEnv, claudeAuthShellLines } = farol;
const {
  sanitizeModel, sanitizeClaudeModel, sanitizeClaudeDir,
} = await import('../lib/parse.js');

test('modelLabel: família + versão pontuada', () => {
  assert.equal(modelLabel('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(modelLabel('claude-sonnet-4-5'), 'Sonnet 4.5');
  assert.equal(modelLabel('claude-3-5-haiku'), 'Haiku 3.5');
});

test('modelLabel: major único + data de snapshot não vira versão gigante', () => {
  // a regex antiga casava "4-20250514" e rotulava "Sonnet 4.20250514"
  assert.equal(modelLabel('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('modelLabel: família sem versão devolve só a família', () => {
  assert.equal(modelLabel('haiku'), 'Haiku');
});

test('modelLabel: vazio e desconhecido', () => {
  assert.equal(modelLabel(''), '');
  assert.equal(modelLabel(null), '');
  assert.equal(modelLabel('gpt-4o'), 'gpt-4o'); // sem família conhecida devolve cru
});

test('isPermanentBranch: nomes canônicos e vazio são permanentes', () => {
  for (const b of ['main', 'master', 'develop', 'release', 'hml', 'hmg', 'staging', 'production']) {
    assert.equal(isPermanentBranch(b), true, b);
  }
  assert.equal(isPermanentBranch(''), true);
  assert.equal(isPermanentBranch(null), true);
  assert.equal(isPermanentBranch('DEVELOP'), true); // case-insensitive
});

test('isPermanentBranch: famílias versionadas de ambiente', () => {
  for (const b of ['release/1.2', 'release_1.2', 'hmg-v1.2', 'hml-x', 'env/prod', 'homolog-2']) {
    assert.equal(isPermanentBranch(b), true, b);
  }
});

test('isPermanentBranch: branches descartáveis', () => {
  for (const b of ['feat/x', 'fix/y', 'task-123', 'hotfix/z', 'bugfix/w', 'chore/deps']) {
    assert.equal(isPermanentBranch(b), false, b);
  }
});

test('parseAccounts: texto "login: org1, org2" e a ordem preservada', () => {
  const out = parseAccounts('alice: biudtech, foo\nbob');
  assert.deepEqual(out, [
    { user: 'alice', owners: ['biudtech', 'foo'] },
    { user: 'bob', owners: [] },
  ]);
});

test('parseAccounts: array normalizado, metadados e políticas válidas', () => {
  const out = parseAccounts([
    { user: 'a', owners: ['x', 'y'], muted: true, onClean: 'approve', onReject: 'request_changes', label: 'Trabalho' },
    { user: '', owners: ['z'] }, // sem user: descartado
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { user: 'a', owners: ['x', 'y'], label: 'Trabalho', muted: true, onClean: 'approve', onReject: 'request_changes' });
});

test('parseAccounts: valores de política inválidos são ignorados', () => {
  const [acct] = parseAccounts([{ user: 'a', owners: [], onClean: 'lol', onReject: 'nope' }]);
  assert.equal('onClean' in acct, false);
  assert.equal('onReject' in acct, false);
});

test('parseAccounts: claudeProfileId é preservado quando presente e string não-vazia', () => {
  const out = parseAccounts([
    { user: 'a', owners: [], claudeProfileId: 'trabalho' },
    { user: 'b', owners: [], claudeProfileId: '' },
    { user: 'c', owners: [] }
  ]);
  assert.equal(out[0].claudeProfileId, 'trabalho');
  assert.equal('claudeProfileId' in out[1], false);
  assert.equal('claudeProfileId' in out[2], false);
});

test('normalizeClaudeProfiles: não-array vira [] (string, número, objeto, null)', () => {
  assert.deepEqual(normalizeClaudeProfiles('abc'), []);
  assert.deepEqual(normalizeClaudeProfiles(123), []);
  assert.deepEqual(normalizeClaudeProfiles({ not: 'array' }), []);
  assert.deepEqual(normalizeClaudeProfiles(null), []);
});

test('normalizeClaudeProfiles: perfil de outro formato (pasta, máquina, OpenRouter, Codex, Antigravity) é ignorado, sem erro', () => {
  const out = normalizeClaudeProfiles([
    { id: 'a', label: 'A', dir: 'C:\\a' },
    { id: 'b', label: 'B', kind: 'dir', dir: 'C:\\b' },
    { id: 'c', label: 'C', kind: 'maquina' },
    { id: 'd', label: 'D', kind: 'openrouter', apiKey: 'sk-or-1' },
    { id: 'e', label: 'E', kind: 'codex' },
    { id: 'f', label: 'F', kind: 'agy' },
    { id: 'g', label: 'G', kind: 'apikey', apiKey: 'sk-ant-g' },
  ]);
  assert.deepEqual(out, [{ id: 'g', label: 'G', kind: 'apikey', apiKey: 'sk-ant-g', baseUrl: '' }]);
});

test('normalizeClaudeProfiles: kind "apikey" exige apiKey válida, baseUrl é opcional', () => {
  const out = normalizeClaudeProfiles([
    { id: 'k1', label: 'Com base', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.example.com' },
    { id: 'k2', label: 'Sem base', kind: 'apikey', apiKey: 'sk-ant-456' },
    { id: 'k3', label: 'Sem chave', kind: 'apikey', apiKey: '' }, // descartado
  ]);
  assert.deepEqual(out, [
    { id: 'k1', label: 'Com base', kind: 'apikey', apiKey: 'sk-ant-123', baseUrl: 'https://proxy.example.com' },
    { id: 'k2', label: 'Sem base', kind: 'apikey', apiKey: 'sk-ant-456', baseUrl: '' },
  ]);
});

test('normalizeClaudeProfiles: apiKey/baseUrl com aspas ou quebra de linha são rejeitados (mesmo risco de injeção do dir)', () => {
  const out = normalizeClaudeProfiles([
    { id: 'bad1', label: 'Aspa na chave', kind: 'apikey', apiKey: 'sk-ant"; rm -rf ~ #' },
    { id: 'bad2', label: 'Newline na base', kind: 'apikey', apiKey: 'sk-ant-ok', baseUrl: 'https://x\ny' },
    { id: 'ok', label: 'Ok', kind: 'apikey', apiKey: 'sk-ant-ok' },
  ]);
  assert.deepEqual(out.map(p => p.id), ['ok']);
});

test('normalizeClaudeProfiles: kind desconhecido é ignorado, mesmo com chave', () => {
  const out = normalizeClaudeProfiles([
    { id: 'y', label: 'Y', kind: 'bedrock', apiKey: 'sk-ant-y' },
  ]);
  assert.deepEqual(out, []);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal válidos são aceitos como número', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 3, budgetTotal: 20.5 },
  ]);
  assert.equal(out[0].budgetDaily, 3);
  assert.equal(out[0].budgetTotal, 20.5);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal malformados (string não numérica, negativo) viram undefined', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 'abc', budgetTotal: -5 },
  ]);
  assert.equal(out[0].budgetDaily, undefined);
  assert.equal(out[0].budgetTotal, undefined);
});

test('normalizeClaudeProfiles: budgetSince válido (YYYY-MM-DD) é aceito, formato errado vira undefined', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetSince: '2026-08-01' },
    { id: 'p2', label: 'P2', kind: 'apikey', apiKey: 'sk-2', budgetSince: '01/08/2026' },
    { id: 'p3', label: 'P3', kind: 'apikey', apiKey: 'sk-3' },
  ]);
  assert.equal(out[0].budgetSince, '2026-08-01');
  assert.equal(out[1].budgetSince, undefined);
  assert.equal(out[2].budgetSince, undefined);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal rejeita tipos garbage (array, boolean, objeto) como undefined', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: [5], budgetTotal: true },
    { id: 'p2', label: 'P2', kind: 'apikey', apiKey: 'sk-2', budgetDaily: { value: 10 }, budgetTotal: null },
  ]);
  assert.equal(out[0].budgetDaily, undefined);
  assert.equal(out[0].budgetTotal, undefined);
  assert.equal(out[1].budgetDaily, undefined);
  assert.equal(out[1].budgetTotal, undefined);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal vazio (string vazia) vira undefined, não zero', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: '', budgetTotal: '  ' },
  ]);
  assert.equal(out[0].budgetDaily, undefined);
  assert.equal(out[0].budgetTotal, undefined);
});

test('normalizeClaudeProfiles: budgetDaily/budgetTotal aceitam zero explícito (número 0) e strings numéricas válidas', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetDaily: 0, budgetTotal: '3.5' },
  ]);
  assert.equal(out[0].budgetDaily, 0);
  assert.equal(out[0].budgetTotal, 3.5);
});

test('sanitizeClaudeDir: rejeita aspas duplas e quebras de linha, aceita o resto', () => {
  assert.equal(sanitizeClaudeDir('C:\\ok'), 'C:\\ok');
  assert.equal(sanitizeClaudeDir('C:\\bad"quote'), '');
  assert.equal(sanitizeClaudeDir('C:\\bad\r\nline'), '');
  assert.equal(sanitizeClaudeDir(null), '');
  assert.doesNotThrow(() => sanitizeClaudeDir({ obj: true }));
});

test('sanitizeClaudeDir: tira aspas duplas que envolvem o valor inteiro (Copiar como caminho do Windows)', () => {
  assert.equal(sanitizeClaudeDir('"C:\\Users\\voce\\.claude"'), 'C:\\Users\\voce\\.claude');
  // aspas no MEIO continuam rejeitadas (não é o mesmo caso)
  assert.equal(sanitizeClaudeDir('C:\\bad"quote\\path'), '');
  assert.equal(sanitizeClaudeDir('"C:\\bad"quote"'), ''); // aspas extras além do par externo: ainda rejeita
});

test('sanitizeClaudeModel: auto é aceito em sanitizeModel e persiste (roteador resolve na revisão)', () => {
  assert.equal(sanitizeModel('auto'), 'auto');
  assert.equal(sanitizeClaudeModel('auto'), 'auto');
});

test('applyClaudeAuthEnv: limpa CLAUDE_CONFIG_DIR/ANTHROPIC_* residuais do objeto recebido (achado crítico de vazamento de ambiente)', () => {
  // simula ghEnv partindo de { ...process.env }: se a MÁQUINA já tiver ANTHROPIC_API_KEY
  // setada (uso pessoal do claude CLI fora do Farol), o perfil de chave de API não
  // pode deixar a chave residual da máquina passar, ela venceria a do perfil, sem erro.
  const env = { ANTHROPIC_API_KEY: 'chave-de-fora', ANTHROPIC_BASE_URL: 'https://de-fora.x', OUTRA_VAR: 'preservada' };
  applyClaudeAuthEnv(env, { kind: 'apikey', apiKey: 'sk-ant-perfil', baseUrl: '' });
  assert.deepEqual(env, { ANTHROPIC_API_KEY: 'sk-ant-perfil', OUTRA_VAR: 'preservada' });

  const env2 = { CLAUDE_CONFIG_DIR: 'C:\\de-fora', OUTRA_VAR: 'preservada' };
  applyClaudeAuthEnv(env2, { kind: 'apikey', apiKey: 'sk-ant-novo', baseUrl: '' });
  assert.deepEqual(env2, { ANTHROPIC_API_KEY: 'sk-ant-novo', OUTRA_VAR: 'preservada' });
});

test('applyClaudeAuthEnv: limpa ANTHROPIC_AUTH_TOKEN residual (precedencia oficial fica acima de ANTHROPIC_API_KEY)', () => {
  // ANTHROPIC_AUTH_TOKEN vence ANTHROPIC_API_KEY na precedencia oficial do CLI (ver docs/CONFIGURATION.md, secao Assinatura).
  // Se a maquina/ambiente do processo do Farol tiver essa var setada por fora (ex.: perfil de
  // shell do usuario, sem relacao com o Farol), ela venceria em silencio o perfil apikey
  // recem aplicado, derrotando a garantia desta funcao.
  const env = { ANTHROPIC_AUTH_TOKEN: 'token-de-fora', OUTRA_VAR: 'preservada' };
  applyClaudeAuthEnv(env, { kind: 'apikey', apiKey: 'sk-ant-perfil', baseUrl: '' });
  assert.deepEqual(env, { ANTHROPIC_API_KEY: 'sk-ant-perfil', OUTRA_VAR: 'preservada' });
});

test('applyClaudeAuthEnv: OAuth herdado não substitui o perfil escolhido nem o login renovado', () => {
  const casos = [
    [null, {}],
    [{ kind: 'apikey', apiKey: 'sk-ant-perfil', baseUrl: 'https://proxy.x' },
      { ANTHROPIC_API_KEY: 'sk-ant-perfil', ANTHROPIC_BASE_URL: 'https://proxy.x' }],
  ];
  for (const [auth, esperado] of casos) {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-expirado-da-maquina', OUTRA_VAR: 'preservada' };
    applyClaudeAuthEnv(env, auth);
    assert.deepEqual(env, { ...esperado, OUTRA_VAR: 'preservada' }, `perfil ${auth ? auth.kind : 'nenhum'}`);
  }
});

// no posix a lista abre com o unset das vars de auth da máquina (G21, ver POSIX_AUTH_UNSET
// em lib/parse.js): o profile do usuário é sourceado DEPOIS do env montado, então limpar só
// o env não basta. A ordem é contrato: o perfil resolvido vem sempre DEPOIS do unset. As
// vars são as mesmas de auth Claude que applyClaudeAuthEnv apaga, incluindo o token OAuth.
const UNSET_POSIX = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN';

test('claudeAuthShellLines: sem perfil de chave de API só limpa, não exporta nada', () => {
  assert.deepEqual(claudeAuthShellLines(null), [UNSET_POSIX, '# sem perfil de chave de API']);
  assert.deepEqual(claudeAuthShellLines({ kind: 'apikey', apiKey: '' }), [UNSET_POSIX, '# sem perfil de chave de API']);
});

test('claudeAuthShellLines: kind apikey, com escaping de aspa simples na chave', () => {
  const lines = claudeAuthShellLines({ kind: 'apikey', apiKey: "sk-ant-123' ; touch /tmp/PROOF #", baseUrl: '' });
  // a chave do próprio perfil é setada DEPOIS do unset, senão o unset a apagaria junto
  assert.deepEqual(lines, [UNSET_POSIX, `export ANTHROPIC_API_KEY='sk-ant-123'\\'' ; touch /tmp/PROOF #'`, '# sem base url propria']);
});

test('logStamp: carimbo do farol.log em Brasília com offset explícito, nunca UTC cru', async () => {
  const { logStamp } = await import('../lib/format.js');
  // o instante do incidente real que motivou (WARN do restart do #763): o log em
  // UTC mostrava 01:04:36 de 17/08 pra um evento de 22:04:36 de 16/08 em Brasília
  assert.equal(logStamp(new Date('2026-08-17T01:04:36Z')), '2026-08-16 22:04:36 -03:00');
  // formato estável pro LINHA_RE do log-taxonomy: data hora offset, tudo ASCII
  assert.match(logStamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
});

/* ---------- orçamento por dia da semana e por data (v2.50.0) ---------- */

test('normalizeClaudeProfiles: aceita teto por dia da semana e por data', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetByWeekday: { '0': 10, '6': 20 }, budgetDates: { '2026-08-25': 300 } },
  ]);
  assert.deepEqual(out[0].budgetByWeekday, { '0': 10, '6': 20 });
  assert.deepEqual(out[0].budgetDates, { '2026-08-25': 300 });
});

// config editada à mão com UMA linha torta não pode levar as outras seis junto
test('normalizeClaudeProfiles: chave ou valor invalido é descartado sem levar o resto', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1',
      budgetByWeekday: { '1': 10, '9': 5, 'seg': 7, '2': -1, '3': [4] },
      budgetDates: { '2026-08-25': 300, '25/08/2026': 50, '2026-08-26': 'lixo' } },
  ]);
  assert.deepEqual(out[0].budgetByWeekday, { '1': 10 });
  assert.deepEqual(out[0].budgetDates, { '2026-08-25': 300 });
});

test('normalizeClaudeProfiles: mapa vazio ou nao-objeto vira campo ausente', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetByWeekday: {}, budgetDates: 'nao-e-objeto' },
    { id: 'p2', label: 'P2', kind: 'apikey', apiKey: 'sk-2', budgetByWeekday: ['array'], budgetDates: null },
  ]);
  assert.equal('budgetByWeekday' in out[0], false);
  assert.equal('budgetDates' in out[0], false);
  assert.equal('budgetByWeekday' in out[1], false);
  assert.equal('budgetDates' in out[1], false);
});

// 0 é um teto VÁLIDO ("não gaste nada neste dia"), não ausência de teto
test('normalizeClaudeProfiles: teto 0 sobrevive nos mapas', () => {
  const out = normalizeClaudeProfiles([
    { id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', budgetByWeekday: { '0': 0 }, budgetDates: { '2026-08-25': 0 } },
  ]);
  assert.equal(out[0].budgetByWeekday['0'], 0);
  assert.equal(out[0].budgetDates['2026-08-25'], 0);
});
