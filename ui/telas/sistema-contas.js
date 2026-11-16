/* Farol · UI: a conta revisora do GitHub (Sistema). */
import { configurarRegrasDeReview } from './review-scope.js';

import { textoDaMudancaDePolitica, politicaDaContaNaTela, politicaParaDesfazer, accountsManagerHtml, camposDaEdicao } from '../pure.js';
import { estado } from './estado.js';
import { $, api, toast, toastRich } from './infra.js';

/* ---------- editor da conta (Sistema) ----------
   A tela manda a OPERAÇÃO (este campo da conta), e o servidor aplica sobre a config
   atual (lib/engine/contas-config.js). Mandar o objeto inteiro, como antes, gravava por cima
   tudo o que esta tela tinha velho ou não conhecia (25/09/2026). */
function salvarConta(op) {
  api('/api/accounts/edit', op).then((r) => { if (r && r.ok === false) toast('error', r.erro || 'A conta não foi salva.'); });
}
function editAccount(user, patch) {
  estado().accounts = (estado().accounts || []).map(a => a.user === user ? { ...a, ...patch } : a);
  renderAccountsManager();
  salvarConta({ tipo: 'editar', user, campos: camposDaEdicao(patch) });
}

export function renderAccountsManager() {
  const box = $('#accountsManager'); if (!box) return;
  if (box.querySelector('.review-scope[data-saving="true"]')) return;
  if (document.activeElement && box.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const abertos = new Set([...box.querySelectorAll('.review-scope[open]')].map(b => b.dataset.user));
  box.innerHTML = accountsManagerHtml({ accounts: estado().accounts, config: estado().config });
  for (const bloco of box.querySelectorAll('.review-scope')) bloco.open = abertos.has(bloco.dataset.user);
}

configurarRegrasDeReview(renderAccountsManager);

/* mudar um campo da política grava na hora e avisa com Desfazer (8 s): o seletor muda o que
   o Farol posta no GitHub sozinho, e antes a mudança era silenciosa */
function mudarPolitica(user, campo, para) {
  const conta = (estado().accounts || []).find(a => a.user === user) || {};
  const antes = politicaDaContaNaTela(conta), de = antes[campo];
  editAccount(user, { [campo]: para });
  const texto = textoDaMudancaDePolitica({ user, campo, de, para });
  let desfazer;
  const aviso = toastRich('ok', (el) => {
    const msg = document.createElement('span');
    msg.textContent = texto;
    desfazer = document.createElement('button');
    desfazer.className = 'undo';
    desfazer.textContent = 'Desfazer';
    el.appendChild(msg);
    el.appendChild(desfazer);
  }, 8000);
  desfazer.onclick = () => { editAccount(user, politicaParaDesfazer(antes, campo)); aviso.remove(); };
}

/* editor da conta: orgs, política e padrões do time */
$('#accountsManager').addEventListener('change', (e) => {
  const t = e.target, user = t.dataset && t.dataset.user;
  if (!user) return;
  if (t.classList.contains('acct-owners')) return editAccount(user, { owners: (t.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) });
  // política de automação da conta: cada seletor grava o valor por extenso, sem herança
  if (t.classList.contains('acct-autoreview')) return mudarPolitica(user, 'autoReview', t.value === 'true');
  if (t.classList.contains('acct-onclean')) return mudarPolitica(user, 'onClean', t.value === 'wait' ? 'wait' : 'approve');
  if (t.classList.contains('acct-oncaveats')) return mudarPolitica(user, 'onCaveats', t.value === 'approve' ? 'approve' : 'wait');
  if (t.classList.contains('acct-onreject')) return mudarPolitica(user, 'onReject', t.value === 'request_changes' ? 'request_changes' : 'wait');
  // padrões do time que a revisão considera; vazio tira o campo
  if (t.classList.contains('acct-padroes')) {
    editAccount(user, { padroesRevisao: (t.value || '').trim() || undefined });
    toast('ok', `Padrões do time de @${user} salvos.`, 2500);
    return;
  }
});
