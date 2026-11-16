/* Farol · UI: login da assinatura do Claude pela própria tela (Sistema > Plano e chaves).
   O motor roda num container, sem terminal: o engine abre o `claude auth login` na pasta do
   perfil e devolve o link (lib/engine/login-web.js); a pessoa entra pelo navegador e cola
   aqui o código que a página da Anthropic mostra. O painel é o loginWebHtml (ui/pure/
   login-web.js), pintado dentro do gerenciador de perfis (telas/sistema-perfis.js).

   O código colado é credencial de uso único: sai do campo direto para a chamada e não fica
   em variável deste módulo, em armazenamento do navegador nem em aviso. */

import { loginWebHtml } from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast } from './infra.js';

let loginWeb = null;
// cada abertura ganha um número, e a resposta de uma tentativa que já foi fechada ou
// substituída não mexe no painel atual (o engine só mantém um login vivo por vez)
let tentativa = 0;
const vigente = (n) => loginWeb && loginWeb.tentativa === n;

export function renderLoginWeb() {
  const alvo = $('#cpLoginWeb');
  if (alvo) alvo.innerHTML = loginWebHtml(loginWeb || {});
}

function nomeDoPerfil(id) {
  const p = (estado().config.claudeProfiles || []).find(x => x.id === id);
  return p ? p.label : '';
}

function abrirLoginWeb(profileId) {
  const n = ++tentativa;
  // o engine recusa o segundo login com um em curso: o que esta tela abriu sai antes
  const aberto = loginWeb && loginWeb.loginId && loginWeb.estado !== 'feito' ? loginWeb.loginId : '';
  const livre = aberto ? api('/api/claude/login-web/cancel', { loginId: aberto }) : Promise.resolve();
  loginWeb = { estado: 'abrindo', perfil: nomeDoPerfil(profileId), tentativa: n };
  renderLoginWeb();
  livre.then(() => api('/api/claude/login-web/start', { profileId })).then((r) => {
    // fechado antes do link chegar: o login aberto no engine não tem mais tela, encerra
    if (!vigente(n)) { if (r && r.ok) api('/api/claude/login-web/cancel', { loginId: r.loginId }); return; }
    if (r && r.ok) loginWeb = { ...loginWeb, estado: 'link', url: r.url, loginId: r.loginId };
    // já há um login aberto no motor (outra aba, ou esta página recarregada): o painel oferece
    // cancelar aquele e começar de novo, em vez de derrubá-lo calado
    else if (r && r.code === 'login-em-curso') loginWeb = { ...loginWeb, estado: 'erro', motivo: r.motivo, recomecar: true, profileId, perfilAberto: r.perfilAberto || '' };
    else loginWeb = { ...loginWeb, estado: 'erro', motivo: (r && r.motivo) || 'não deu para abrir o login agora' };
    renderLoginWeb();
  });
}

function recomecarLogin() {
  if (!loginWeb || !loginWeb.recomecar) return;
  const { profileId, perfilAberto } = loginWeb;
  loginWeb = null;
  api('/api/claude/login-web/cancel', { profileId: perfilAberto }).then(() => abrirLoginWeb(profileId));
}

function enviarCodigoDoLogin() {
  const campo = $('#cpLoginWebCodigo');
  const code = ((campo && campo.value) || '').trim();
  if (!loginWeb || !loginWeb.loginId) return;
  if (!code) { toast('info', 'Cole o código que a página de login mostrou.', 3500); return; }
  const n = loginWeb.tentativa;
  loginWeb = { ...loginWeb, estado: 'enviando', motivo: '' };
  renderLoginWeb();
  api('/api/claude/login-web/code', { loginId: loginWeb.loginId, code }).then((r) => {
    if (!vigente(n)) return;
    if (r && r.ok) loginWeb = { estado: 'feito', perfil: loginWeb.perfil, tentativa: n };
    // código fora da forma: o login segue aberto, dá para colar de novo
    else if (r && r.code === 'codigo-invalido') loginWeb = { ...loginWeb, estado: 'erro', motivo: r.motivo };
    // login que expirou ou que o CLI recusou não volta: o link é de uso único
    else loginWeb = { ...loginWeb, estado: 'erro', url: '', loginId: '', motivo: `${(r && r.motivo) || 'o login não deu certo'}. Clique de novo em Entrar com a assinatura para recomeçar.` };
    renderLoginWeb();
  });
}

function fecharLoginWeb() {
  if (loginWeb && loginWeb.loginId && loginWeb.estado !== 'feito') api('/api/claude/login-web/cancel', { loginId: loginWeb.loginId });
  loginWeb = null;
  renderLoginWeb();
}

/* Os cliques do login dentro do gerenciador de perfis; devolve true quando tratou, pra o
   handler de lá sair cedo. */
export function tratouLoginWeb(t) {
  if (t.classList.contains('cp-login')) { abrirLoginWeb(t.dataset.id || ''); return true; }
  if (t.id === 'cpLoginWebEnviar') { enviarCodigoDoLogin(); return true; }
  if (t.id === 'cpLoginWebRecomecar') { recomecarLogin(); return true; }
  if (t.id === 'cpLoginWebCancelar') { fecharLoginWeb(); return true; }
  return false;
}
