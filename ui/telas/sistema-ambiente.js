/* Farol · UI: saúde do ambiente (Sistema > Visão geral). */

import { esc, escAttrSelector, operationChecks, runtimeChecks, versaoClaudeCheck } from '../pure.js';
import { estado, ehWin } from './estado.js';
import { $ } from './infra.js';

/* ---------- render: saúde do ambiente ---------- */
function detalheDoClaude(d) {
  if (!d.claude) return 'claude não encontrado no PATH';
  return d.claudePerfilPronto === true ? `${d.claude}, com perfil de chave de API pronto` : `${d.claude}, mas sem perfil de chave de API utilizável: cadastre a chave em Plano e chaves`;
}

function renderDoctor() {
  const d = estado() && estado().doctor;
  const box = $('#doctor');
  if (!d) { box.innerHTML = '<div class="empty">Verificando o ambiente…</div>'; return; }
  // `goto` (opcional): o check cita uma coisa configurável do app, então clicar
  // leva até ela (a conta abre o card dela em Contas)
  const checks = [
    { ok: !!d.gh, label: 'GitHub CLI', detail: d.gh || 'gh não encontrado no PATH' },
    {
      ok: d.ghAuth, label: estado().config.ghUser ? `Conta @${estado().config.ghUser}` : 'Conta do GitHub',
      detail: d.ghAuth ? 'autenticada no gh' : 'sem token: rode gh auth login (conta de trabalho)',
      goto: estado().config.ghUser ? `sys:accounts:.acct-label[data-user="${escAttrSelector(estado().config.ghUser)}"]` : 'sys:accounts:#accountsManager'
    },
    // o CLI existe E há um perfil de chave de API utilizável: sem um dos dois a sessão não abre
    { ok: !!d.claude && d.claudePerfilPronto === true, label: 'Claude Code', detail: detalheDoClaude(d), goto: 'sys:plans:#claudeProfilesManager' },
    // o check acima diz se o CLI EXISTE; este diz se ele está em dia, porque é o CLI
    // que decide para qual modelo o apelido (opus, sonnet, haiku) aponta
    ...versaoClaudeCheck((estado().modelos || {}).cli),
    // Git Bash é pré-requisito só no Windows (CLAUDE_CODE_GIT_BASH_PATH)
    ...(ehWin() ? [{ ok: !!d.gitBash, label: 'Git Bash', detail: d.gitBash || 'não encontrado: sessões do Claude podem travar' }] : []),
    { ok: true, label: 'Pasta de trabalho', detail: d.workspace },
    // ambiente ok não quer dizer que vai achar PR: os checks de operação (conta
    // sem organização, conta sem token, tudo silenciado) moram no pure.js
    ...operationChecks(estado().accounts),
    // nem que vai conseguir ABRIR a sessão: rodar como root faz toda revisão
    // autônoma morrer no spawn, com o resto da tela verde
    ...runtimeChecks(estado().doctor, estado().config, estado().claudePerfis)
  ];
  box.innerHTML = checks.map(c => `
    <div class="check ${c.ok ? 'ok' : 'bad'}${c.goto ? ' is-goto' : ''}"${c.goto ? ` data-goto="${esc(c.goto)}" role="button" tabindex="0" title="Abrir a configuração deste item"` : ''}>
      <span class="led"></span>
      <div><div class="label">${esc(c.label)}</div><div class="detail">${esc(c.detail)}</div></div>
    </div>`).join('');
  $('#about').innerHTML = `O polling usa só o GitHub CLI (zero tokens de IA). O Claude Code entra apenas quando uma sessão de IA é aberta.`;
  // versão e caminho dos dados moram no rodapé da sidebar, visíveis em qualquer seção.
  $('#sysFoot').innerHTML = `<span>Farol v${esc(estado().app.version)}</span><br>dados em <code>${esc(estado().paths.home)}</code>`;
}

export { renderDoctor };
