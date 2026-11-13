// Spawn headless do motor (Linux). O que ele trava:
//   - shell /bin/sh com -lc (login shell: sem isso o PATH do perfil não entra e o
//     `claude` some)
//   - detached: true, que é a PRÉ-CONDIÇÃO do killTree posix (process.kill(-pid) só mata
//     o grupo se o filho for líder de grupo). Sem isso, cancelar uma revisão deixa o
//     claude e os subagentes rodando órfãos.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-posix-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// mesmo padrão de test/session-claude-profile.test.js: o mock precisa estar em vigor
// ANTES do require de lib/engine/session, que captura `spawn` no load
import childProcess from 'node:child_process';
const realSpawn = childProcess.spawn;
let spawnImpl = null;
childProcess.spawn = function mockableSpawn(...args) {
  if (spawnImpl) return spawnImpl(...args);
  return realSpawn(...args);
};

const { runClaudeStream, buildSessionScript, killTree } = await import('../lib/engine/session.js');
const { claudeAuthShellLines, claudeAuthPosixPrefix } = await import('../lib/parse.js');
const { WORKSPACE } = await import('../lib/paths.js');
const { bashDoTeste } = await import('./helpers/bash-real.js');
import { execFileSync } from 'node:child_process';

after(() => {
  childProcess.spawn = realSpawn;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// filho falso: encerra na hora pra runClaudeStream resolver sem processo de verdade
function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => { }; // runClaudeStream liga utf8 no stream real (M4)
  child.stderr = new EventEmitter();
  // stdin precisa de .on: runClaudeStream registra handler de 'error' (B4)
  child.stdin = Object.assign(new EventEmitter(), { write() { }, end() { } });
  child.pid = 4242;
  setImmediate(() => { child.emit('close', 0); });
  return child;
}

function engineFalso(config = {}) {
  return {
    config,
    ghEnv: () => ({ PATH: '/usr/bin' }),
    pushActivity() { },
    setSessionModel() { },
    // sem chave de API (como o claude de mentira): authProfileId fica vazio
    resolveClaudeAuth: () => ({ kind: 'apikey', id: '', apiKey: '', baseUrl: '' }),
  };
}

// Os `await` de topo vêm ANTES do primeiro caso: com `--test-force-exit`, o processo
// encerra quando os casos já registrados terminam, e um `await` que só volta depois
// disso deixa os casos seguintes CANCELADOS, numa rodada que ainda diz "0 falhas".
const { pickLinuxTerminal, LINUX_TERMINALS } = await import('../lib/engine/session.js');

test('spawn headless posix: /bin/sh -lc, detached e cwd no WORKSPACE', async () => {
  let capturado = null;
  spawnImpl = (...args) => { capturado = args; return filhoFalso(); };
  try {
    await runClaudeStream(engineFalso({ reviewModel: 'opus', reviewEffort: 'high' }), 'prompt qualquer', {});
  } catch { /* o filho falso não devolve envelope; o que importa são os args do spawn */ }
  spawnImpl = null;

  assert.ok(capturado, 'spawn foi chamado');
  const [cmd, argv, opts] = capturado;
  assert.equal(cmd, '/bin/sh');
  assert.equal(argv[0], '-lc', 'login shell, senão o PATH do perfil não entra');
  // o unset vem colado no começo da linha, DEPOIS do sourcing do profile que o -l faz (G21).
  // engineFalso resolve uma auth sem chave, então não há re-export de nada.
  assert.match(argv[1], /^unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN; claude -p --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions/);
  assert.match(argv[1], / --model opus --effort high$/, 'as flags entram no fim da linha');
  assert.equal(opts.detached, true, 'pré-condição do killTree posix (process.kill(-pid))');
  assert.equal(opts.cwd, WORKSPACE);
});

// --- G21: env de auth da máquina não sobrevive ao login shell posix ----------
// O defeito: applyClaudeAuthEnv limpa as vars de auth do env, mas no posix o profile do
// usuário é sourceado DEPOIS disso (o -l do `/bin/sh -lc` no headless; o login shell do
// terminal antes de executar o .command). Um `export ANTHROPIC_API_KEY` perdido no
// ~/.profile re-injeta a chave POR CIMA do perfil resolvido, e a precedência oficial do
// claude CLI põe a chave acima do login OAuth: o perfil de assinatura do Farol seria anulado
// em silêncio. Por isso o unset é emitido DENTRO do shell, depois de qualquer sourcing e
// antes do exec do claude.
//
// A lista cobre também CLAUDE_CODE_OAUTH_TOKEN, que vence o login salvo. A URL base
// redireciona o endpoint e CLAUDE_CONFIG_DIR troca a conta logada: todos precisam
// ceder ao perfil escolhido no Farol depois do sourcing do profile.
const UNSET = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN';

function ordem(texto, ...pedacos) {
  return pedacos.map(p => texto.indexOf(p));
}

function engineLinux(auth) {
  return {
    config: { skipPermissions: false, port: 47170 },
    resolveClaudeAuth: () => auth,
    primaryUser: () => 'default-user',
  };
}


test('claudeAuthShellLines posix (sem perfil de chave de API): unset sem export nenhum', () => {
  const linhas = claudeAuthShellLines(null);
  // sem perfil, o certo é NÃO re-exportar nada: um ANTHROPIC_API_KEY herdado do profile
  // mentiria sobre qual chave está em uso.
  assert.deepEqual(linhas, [UNSET, '# sem perfil de chave de API']);
});

test('claudeAuthShellLines posix (chave de API): a própria chave é setada DEPOIS do unset', () => {
  const linhas = claudeAuthShellLines({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: 'https://proxy.x' });
  assert.deepEqual(linhas, [UNSET, `export ANTHROPIC_API_KEY='sk-ant-1'`, `export ANTHROPIC_BASE_URL='https://proxy.x'`]);
});

test('claudeAuthPosixPrefix: sem perfil de chave de API é só o unset', () => {
  assert.equal(claudeAuthPosixPrefix(null), `${UNSET}; `);
  assert.equal(claudeAuthPosixPrefix({ kind: 'apikey', apiKey: '' }), `${UNSET}; `);
});

test('claudeAuthPosixPrefix: perfil de chave remove só o token OAuth (a chave continua no env)', () => {
  const prefixo = claudeAuthPosixPrefix({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' });
  assert.equal(prefixo, 'unset CLAUDE_CODE_OAUTH_TOKEN; ');
  assert.doesNotMatch(prefixo, /sk-ant-1/);
});

test('scripts POSIX: o segredo de saída é variável de shell, nunca exportada ao claude', () => {
  const sessao = buildSessionScript(engineLinux(null), '/pr-review x', 'id1', 'bob', '', 'segredo1');
  assert.match(sessao, /^FAROL_SESSION_SECRET='segredo1'$/m);
  assert.equal(sessao.includes('export FAROL_SESSION_SECRET'), false);
  assert.match(sessao, /-H "x-farol-session: \$FAROL_SESSION_SECRET"/);
});

test('buildSessionScript (sem perfil de chave de API): o unset vem antes da linha do claude e nada é exportado', () => {
  const script = buildSessionScript(engineLinux(null), '/pr-review x', 'id1', 'bob');
  const [iUnset, iClaude] = ordem(script, UNSET, '\nclaude ');
  assert.ok(iUnset > 0, 'o unset existe no script');
  assert.ok(iUnset < iClaude, 'tudo antes do exec do claude');
  assert.doesNotMatch(script, /export (ANTHROPIC_|CLAUDE_CONFIG_DIR)/);
});

test('buildSessionScript (chave de API): a chave do perfil é exportada DEPOIS do unset', () => {
  const script = buildSessionScript(engineLinux({ kind: 'apikey', apiKey: 'sk-ant-1', baseUrl: '' }), '/pr-review x', 'id1', 'bob');
  const [iUnset, iChave, iClaude] = ordem(script, UNSET, "export ANTHROPIC_API_KEY='sk-ant-1'", '\nclaude ');
  assert.ok(iUnset > 0 && iUnset < iChave, 'o unset não pode apagar a chave do próprio perfil');
  assert.ok(iChave < iClaude);
});



// Prova de EXECUÇÃO (não só leitura do texto montado), no mesmo padrão da prova de injeção
// que já existe em test/session-claude-profile.test.js: um profile sujo é sourceado e o
// prefixo roda depois dele, exatamente como o `/bin/sh -lc` faz com o `-l`.
const bashDisponivel = !!bashDoTeste;

function rodaComProfileSujo(prefixo, extraEnv = {}) {
  /* Diretório EXCLUSIVO (mkdtemp), e não um nome derivado do pid dentro do tmp
     compartilhado. É a mesma correção que o teste do inflight já levou (48545c4):
     nome previsível num diretório que qualquer processo da máquina escreve é a brecha
     clássica de arquivo temporário, e aqui ela vale dobrado, porque o que se escreve é
     um SCRIPT que o teste manda o bash executar em seguida. O CodeQL aponta isso como
     js/insecure-temporary-file, e ele tem razão.

     O diretório inteiro sai no finally, então não sobra rastro por rodada. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-prefixo-'));
  const base = path.join(dir, 'p').replace(/\\/g, '/');
  const profile = `${base}-profile.sh`;
  const script = `${base}-run.sh`;
  fs.writeFileSync(profile, [
    'export ANTHROPIC_API_KEY=chave-do-profile',
    'export ANTHROPIC_AUTH_TOKEN=token-do-profile',
    'export ANTHROPIC_BASE_URL=https://host-de-terceiro',
    'export CLAUDE_CONFIG_DIR=/dir/do/profile',
    'export CLAUDE_CODE_OAUTH_TOKEN=oauth-expirado-do-profile',
  ].join('\n') + '\n');
  // `. profile` é o que o -l faz por dentro; o prefixo vem DEPOIS, como na linha real
  fs.writeFileSync(script, `#!/bin/bash\n. '${profile}'\n${prefixo}echo "[$ANTHROPIC_API_KEY|$ANTHROPIC_AUTH_TOKEN|$ANTHROPIC_BASE_URL|$CLAUDE_CONFIG_DIR|$CLAUDE_CODE_OAUTH_TOKEN]"\n`);
  try {
    return execFileSync(bashDoTeste, [script], { env: { ...process.env, ...extraEnv }, windowsHide: true, timeout: 5000 }).toString().trim();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

test('prefixo posix: profile sujo não deixa credencial sem perfil (execução real com bash)', { skip: bashDisponivel ? false : 'bash não encontrado no PATH' }, () => {
  const semPerfil = rodaComProfileSujo(claudeAuthPosixPrefix(null));
  assert.equal(semPerfil, '[||||]', 'sem perfil: nenhuma var de auth sobrevive ao prefixo');
});


test('prefixo posix: apikey remove OAuth do profile sem apagar a chave/base do perfil', { skip: bashDisponivel ? false : 'bash não encontrado no PATH' }, () => {
  const auth = { kind: 'apikey', apiKey: 'sk-ant-resolvida', baseUrl: 'https://proxy.x' };
  const prefixo = claudeAuthPosixPrefix(auth);
  assert.doesNotMatch(prefixo, /sk-ant-resolvida/);
  const script = `export CLAUDE_CODE_OAUTH_TOKEN=oauth-expirado-do-profile; ${prefixo}echo "[$ANTHROPIC_API_KEY|$ANTHROPIC_BASE_URL|$CLAUDE_CODE_OAUTH_TOKEN]"`;
  const saida = execFileSync(bashDoTeste, ['-c', script], {
    env: { ...process.env, ANTHROPIC_API_KEY: auth.apiKey, ANTHROPIC_BASE_URL: auth.baseUrl },
  }).toString().trim();
  assert.equal(saida, '[sk-ant-resolvida|https://proxy.x|]');
});


/* ---------- killTree posix: a matança de verdade, não só a pré-condição ---------- */
// O detached:true testado acima é a pré-condição; este prova a consequência: o
// process.kill(-pid) derruba o GRUPO (o sh líder E o filho dele), que é o que
// impede cancelamento de revisão deixar claude/subagentes órfãos. Era o único
// caminho de kill sem nenhum assert em SO nenhum (auditoria 16/08).
test('killTree posix: mata o grupo de processo inteiro, não só o líder', async () => {
  const child = realSpawn('/bin/sh', ['-c', 'sleep 30 & sleep 30 & wait'], { detached: true, stdio: 'ignore' });
  child.on('error', () => { });
  await new Promise(r => setTimeout(r, 300));   // grupo montado
  killTree({}, child.pid);
  const deadline = Date.now() + 5000;
  let grupoMorto = false;
  while (Date.now() < deadline) {               // espera por condição, não por timeout cego
    try { process.kill(-child.pid, 0); } catch (e) { if (e.code === 'ESRCH') { grupoMorto = true; break; } }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(grupoMorto, 'o grupo de processos continua vivo depois do killTree');
});

/* ---------- Linux experimental (v2.45.0): escolha do terminal ---------- */


test('pickLinuxTerminal: primeiro candidato existente vence, com os args dele', () => {
  const exists = c => c === 'konsole' || c === 'xterm';
  assert.deepEqual(pickLinuxTerminal(LINUX_TERMINALS, exists), { cmd: 'konsole', args: ['-e'] });
});

test('pickLinuxTerminal: x-terminal-emulator (alternatives do Debian) tem prioridade', () => {
  const tudo = () => true;
  assert.equal(pickLinuxTerminal(LINUX_TERMINALS, tudo).cmd, 'x-terminal-emulator');
});

test('pickLinuxTerminal: nenhum terminal devolve null (o chamador avisa alto)', () => {
  assert.equal(pickLinuxTerminal(LINUX_TERMINALS, () => false), null);
  assert.equal(pickLinuxTerminal(null, () => true), null);
});
