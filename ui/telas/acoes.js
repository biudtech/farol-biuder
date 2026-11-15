/* Farol · UI: ações de topo (checar agora, revisar tudo, tweaks de exibição,
   doctor), os cliques de Sessões ativas/Fila/
   Decisões pendentes, e o laço que liga settingsMap aos toggles de Sistema. */

import { settingsIgnoradasTexto } from '../pure.js';
import { estado } from './estado.js';
import {
  $, api, get, toast, toastRich, confirmModal,
} from './infra.js';
import { TWEAK, scopeVisible, prUser, guardarMutedHandling, guardarIdentityStyle } from './contas.js';
import { filaSemRevisoesAtivas } from '../pure/fila.js';
import { revisarUrls } from './consumo.js';
import { loadLog } from './diagnostico.js';
import { cancelarSessao } from './sessao-cancelar.js';

/* decisão pendente: caminho ÚNICO de POST, usado pelo card (#decisions) e pela paleta
   (telas/paleta.js). O achado A5: a paleta chamava um decide() que nunca existiu
   (ReferenceError engolido). */
function decide(id, action) {
  return api('/api/decide', { id, action }).then(r => {
    if (!r || !r.ok) toast('error', (r && r.error) || 'não consegui registrar a decisão');
    return r;
  });
}

/* decidir com confirmação: REQUEST_CHANGES ganha um modal antes, porque posta no
   GitHub e bloqueia o PR pro autor. Fonte ÚNICA do texto da confirmação (achado da
   correção 4 da Task 11a: o card e a paleta tinham duas cópias divergentes, uma com
   o parágrafo do bloqueio e outra sem, apesar do comentário dizer "a MESMA
   confirmação"). Usado pelo card (#decisions, abaixo) e pela paleta
   (telas/paleta.js). */
const CONFIRMA_NO_TECLADO = {
  approve: { titulo: (ref) => `Aprovar ${ref}?`, confirma: 'Aprovar', o: 'uma aprovação' },
  comment: { titulo: (ref) => `Comentar em ${ref}?`, confirma: 'Comentar', o: 'um comentário' },
};
async function decideComConfirmacao(id, action, ref, { sempre = false } = {}) {
  const alvo = ref || 'este PR';
  // o teclado passa sempre: true, porque uma tecla errada postaria aprovação ou comentário
  // sem o clique deliberado; o clique no botão segue como era
  const pergunta = sempre ? CONFIRMA_NO_TECLADO[action] : null;
  if (pergunta) {
    const ok = await confirmModal({
      title: pergunta.titulo(alvo), confirmLabel: pergunta.confirma, cancelLabel: 'Voltar',
      body: `<p>Isso <b>posta ${pergunta.o} no GitHub</b>, visível pra todo mundo do PR.</p>`,
    });
    if (!ok) return { ok: false };
  }
  if (action === 'request_changes') {
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref || 'este PR'}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>
        <p>O PR fica <b>bloqueado</b> até o autor tratar e você reavaliar. Pra reverter, é só dispensar o seu review depois.</p>`
    });
    if (!ok) return { ok: false };
  }
  return decide(id, action);
}

/* ---------- ações ---------- */
$('#btnCheck').onclick = () => api('/api/check');
$('#btnReviewAll').onclick = () => {
  // revisa só o que está visível no escopo atual; a lista vai SEMPRE explícita
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = filaSemRevisoesAtivas(estado().queue || [], estado().activeSessions || [], prUser)
    .filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  // lote: o head já decidido e o pedido removido seguram, como no automático (05/11/2026)
  revisarUrls(urls, { lote: true });
};

/* tweaks de exibição (guardados no navegador, não vão pro engine). `rerenderScope`
   fica no bootstrap (ui/app.js): ela conhece TODAS as telas, e este módulo não pode
   sem criar ciclo de volta pro app.js. */
function initTweaks(rerenderScope) {
  const mh = $('#setMutedHandling'), is = $('#setIdentityStyle');
  if (mh) { mh.value = TWEAK.muted; mh.onchange = () => { TWEAK.muted = mh.value; guardarMutedHandling(mh.value); rerenderScope(); }; }
  if (is) { is.value = TWEAK.ident; is.onchange = () => { TWEAK.ident = is.value; guardarIdentityStyle(is.value); rerenderScope(); }; }
}
$('#btnDoctor').onclick = async () => { await get('/api/doctor'); };
$('#btnLogRefresh').onclick = loadLog;

$('#activeSessions').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-cancel');
  if (!btn) return;
  return cancelarSessao(btn);
});

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { revisarUrls([rev.dataset.url]); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { revisarUrls([term.dataset.url], {}, 'terminal'); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
    api('/api/ignore', { key });
    let undo;
    const t = toastRich('info', (el) => {
      const message = document.createElement('span');
      message.textContent = `${key} ignorado.`;
      undo = document.createElement('button');
      undo.className = 'undo';
      undo.textContent = 'Desfazer';
      el.appendChild(message);
      el.appendChild(undo);
    }, 8000);
    undo.onclick = () => { api('/api/restore', { key }); t.remove(); };
  }
});

// o mesmo card aparece em duas seções: Precisa de você e Esperando o CI (30/09/2026)
const cliqueNoCardDeDecisao = async (e) => {
  // revisar de novo: mesma rota do Revisar da fila. O .act-review NÃO tem listener
  // global (cada seção escuta o seu, ver #resolved), e o card bloqueado por head
  // velho é o único caso em que ele aparece aqui: o round novo substitui este card.
  const rev = e.target.closest('.act-review');
    if (rev) { if (rev.disabled) return; rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
  const action = btn.dataset.action;
  const ref = (btn.closest('.decision').querySelector('.dec-ref')?.textContent || 'este PR').trim();
  btn.disabled = true;
  const r = await decideComConfirmacao(id, action, ref);
  if (!r?.ok) btn.disabled = false;
};
$('#decisions').addEventListener('click', cliqueNoCardDeDecisao);
$('#esperaCi').addEventListener('click', cliqueNoCardDeDecisao);

/* configurações: aplica na mudança */
const settingsMap = [
  ['#setInterval', 'intervalSeconds', el => parseInt(el.value, 10)],
  ['#setReviewModel', 'reviewModel', el => el.value],
  ['#setParallelReviews', 'parallelReviews', el => parseInt(el.value, 10)],
  ['#setGlobalParallelReviews', 'globalParallelReviews', el => parseInt(el.value, 10)],
  // radio: o change borbulha até o container, então e.target já é o rádio marcado
  ['#setReviewEffort', 'reviewEffort', el => el.value],
  ['#setAutoPushback', 'autoPushback', el => el.checked],
  ['#setDebugSpawns', 'debugSpawns', el => el.checked],
  ['#setReviewFast', 'reviewFast', el => el.checked],
  ['#setAguardarCi', 'aguardarCiParaRevisar', el => el.checked],
  ['#setAguardarCiAprovar', 'aguardarCiParaAprovar', el => el.checked],
  ['#setReReviewResume', 'reReviewResume', el => el.checked],
  ['#setSkipPerms', 'skipPermissions', el => el.checked],
  ['#setSound', 'soundEnabled', el => el.checked],
  ['#setAutostart', 'autostart', el => el.checked]
];
for (const [sel, key, read] of settingsMap) {
  $(sel).addEventListener('change', async (e) => {
    const r = await api('/api/settings', { [key]: read(e.target) });
    // o servidor devolve o que NÃO aceitou. Dizer "salva" sem olhar isso foi o que
    // fez preferência sumir em silêncio: a tela confirmava, o config não guardava.
    const recusa = settingsIgnoradasTexto(r);
    if (recusa) {
      toast('error', recusa, 6000);
      return;
    }
    toast('ok', 'Configuração salva.', 2500);
  });
}

export { decide, decideComConfirmacao, initTweaks };
