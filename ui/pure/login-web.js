/* Login do Claude pela própria tela (20/10/2026; de volta em 15/11/2026, com a assinatura):
   o motor roda num container, sem terminal. O engine roda o `claude auth login` na pasta do
   perfil (lib/engine/login-web.js) e devolve o link; a pessoa entra pelo navegador, copia o
   código que a página da Anthropic mostra e cola aqui. PURA. */
import { esc } from './comum.js';

const SO_HTTPS = /^https:\/\/[^\s"'<>]+$/;
/**
 * O painel do login pela tela.
 * `recomecar`: o motor recusou por já haver um login aberto, e o painel oferece cancelá-lo.
 * @param {{ estado?: 'abrindo'|'link'|'enviando'|'erro'|'feito', perfil?: string, url?: string, motivo?: string, recomecar?: boolean }} dados
 */
function loginWebHtml(dados = {}) {
  const d = dados || {};
  if (!d.estado) return '';
  const titulo = `<div class="a-add-title">Login do Claude${d.perfil ? ` em ${esc(d.perfil)}` : ''}</div>`;
  const cancelar = '<button class="btn sm ghost" id="cpLoginWebCancelar">Fechar</button>';
  if (d.estado === 'abrindo') return `<div class="card acct-add cp-login-web">${titulo}<span class="pill busy">abrindo o login…</span></div>`;
  if (d.estado === 'feito') {
    return `<div class="card acct-add cp-login-web">${titulo}<div class="a-hint">Login feito. O selo e o uso do plano do perfil atualizam em instantes.</div>${cancelar}</div>`;
  }
  const url = SO_HTTPS.test(String(d.url || '')) ? d.url : '';
  if (!url) {
    return `<div class="card acct-add cp-login-web" role="alert">${titulo}<div class="a-hint">${esc(d.motivo || 'não deu para abrir o login agora')}</div>${d.recomecar ? '<button class="btn sm" id="cpLoginWebRecomecar">Cancelar o login aberto e começar de novo</button>' : ''}${cancelar}</div>`;
  }
  const erro = d.estado === 'erro' && d.motivo ? `<div class="a-hint cp-teste-erro" role="alert">${esc(d.motivo)}</div>` : '';
  const enviando = d.estado === 'enviando';
  const trava = enviando ? ' disabled' : '';
  const rotulo = enviando ? 'Entrando…' : 'Entrar';
  return `<div class="card acct-add cp-login-web">
    ${titulo}
    <div class="a-hint">1. Abra a página de login e entre com a conta desta assinatura.</div>
    <div class="a-editrow"><a class="btn sm" href="${esc(url)}" target="_blank" rel="noreferrer">Abrir a página de login</a></div>
    <div class="a-hint">2. Cole aqui o código que a página mostrar no fim.</div>
    <div class="a-editrow">
      <input id="cpLoginWebCodigo" placeholder="código de autorização" spellcheck="false" autocomplete="off"${trava}>
      <button class="btn sm" id="cpLoginWebEnviar"${trava}>${rotulo}</button>
      ${cancelar}
    </div>
    ${erro}
  </div>`;
}

export { loginWebHtml };
