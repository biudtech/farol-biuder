/* Farol · UI: Sistema > Sobre (privacidade, licença e origem). */

import { personMention } from '../pure.js';
import { $ } from './infra.js';

/* ---------- Sistema > Sobre: privacidade, licença e origem ---------- */
function renderAbout() {
  // crédito de ORIGEM é fixo de propósito: a inspiração não está no git (o código
  // atual foi reconstruído do zero), então não há lista a sincronizar, e história
  // não muda, logo não há manutenção. Decisão do Wanderson, 15/08/2026.
  const origem = $('#aboutOrigem');
  if (!origem) return;
  origem.innerHTML = `<span class="origem-label">Origem</span> O Farol nasceu de uma iniciativa do Thiago (${personMention('thiagopcdev', 'xs')}): um revisor de PRs que rodava numa janela de terminal e dependia de ação manual. O app atual foi reconstruído do zero em cima dessa essência.`;
}

export { renderAbout };
