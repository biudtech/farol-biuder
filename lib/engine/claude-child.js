// Spawn da sessão do Claude pelo shell de login.
import cp from 'node:child_process';
import { WORKSPACE } from '../paths.js';
import { claudeAuthPosixPrefix } from '../parse.js';

function spawnClaudeChild(opts, cmdline, env, auth) {
  // O shell de login pode repor credenciais: o prefixo restaura o perfil após o sourcing.
  return cp.spawn('/bin/sh', ['-lc', claudeAuthPosixPrefix(auth) + cmdline], {
    cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true
  });
}

export { spawnClaudeChild };
