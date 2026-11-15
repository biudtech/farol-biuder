/* Farol · UI: as linhas da Compacta (07/11/2026) nas telas do Radar. Junta o estado da tela
   com o desenho de ui/pure/densidade.js (linha, frases, resumo do topo e rodapé de Revisões
   recentes) e o que está aberto em densidade.js, e devolve o HTML pronto para radar.js,
   meus-prs.js e sessoes.js não incharem. */
import {
  esc, avatar, setaDaLinhaHtml, linhaCompactaHtml, fraseDaDecisao, acaoDaDecisaoHtml,
  fraseDaEspera, fraseDaFila, fraseDaFilaDeExecucao, rodapeDasRecentes, resolvidasHoje, resumoPraMimHtml, separarPendentes,
} from '../pure.js';
import { estado } from './estado.js';
import { $ } from './infra.js';
import { ehCompacta, cardCheio } from './densidade.js';

// a seta que recolhe o card cheio, só na Compacta (na Expandida não há linha para voltar)
function setaDoCard(key) { return ehCompacta() ? setaDaLinhaHtml(key, true, key) : ''; }

/* ---------- Meus PRs ---------- */
function linhaDoMeuPr(pr, o) {
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: o.mark.dot, style: o.mark.style,
    classe: ['mypr-linha', o.escondido && 'oculto', o.classeExtra].filter(Boolean).join(' '), barra: o.barra,
    acoes: o.merge || '', ...(o.andamento || {}),
  });
}

/* ---------- Pra mim ---------- */
function linhaDaDecisao(d, meta, o) {
  const frase = o.espera ? fraseDaEspera(o.ciObrigatorio) : fraseDaDecisao(d, meta);
  const acao = o.espera ? '' : acaoDaDecisaoHtml(d, meta, o.ciObrigatorio);
  return linhaCompactaHtml({
    key: d.key, url: d.pr?.url, titulo: d.pr?.title || '', inicio: avatar(d.pr?.author || d.author || ''),
    style: o.mark.style, classe: 'decision', refClasse: 'dec-ref', attrs: `data-id="${esc(d.id)}"`,
    estado: frase, acoes: acao,
  });
}

function linhaDaFila(pr, o) {
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: avatar(pr.author), style: o.mark.style, classe: 'fila-linha',
    estado: fraseDaFila(pr, { posicao: o.posicao, parado: o.parado, manual: o.manual }),
    acoes: `<button class="btn primary sm act-review" data-url="${esc(pr.url)}">${esc(o.rotulo || 'Revisar')}</button>`,
  });
}

function linhaDaFilaDeExecucao(pr, o) {
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: avatar(pr.author), style: o.mark.style, classe: 'fila-linha',
    estado: fraseDaFilaDeExecucao(o.distribuindo),
  });
}

// Revisões recentes na Compacta: uma linha que abre a lista; aberta, a mesma linha recolhe
function rodapeDasRecentesHtml(resolved, aberto) {
  const texto = rodapeDasRecentes(resolvidasHoje(resolved), (resolved || []).length, aberto);
  return `<button type="button" class="mypr-hidden-toggle pron-rodape" data-recentes-alternar aria-expanded="${aberto ? 'true' : 'false'}">${esc(texto)}</button>`;
}

// A linha do topo de Pra mim, que leva a cada seção. Conta o que as seções mostram.
function renderResumoPraMim(filtro, totalDaFila) {
  const el = $('#praMimResumo');
  if (!el) return;
  const { precisam, esperandoCi } = separarPendentes((estado().decisions?.pending || []).filter(filtro));
  const analisando = (estado().activeSessions || []).filter(s => (s.mode === 'auto' || s.mode === 'self')).length;
  const html = resumoPraMimHtml({
    analisando, precisam: precisam.length, sozinhos: esperandoCi.length, fila: totalDaFila,
    resolvidas: resolvidasHoje((estado().decisions?.resolved || []).filter(filtro)),
  });
  el.innerHTML = html;
  el.hidden = !html;
}

// A seta do cartão de "Analisando agora": na Compacta o cartão encolhe e a seta o abre (ou o
// recolhe). O cartão é incremental, então quem chama troca só este pedaço a cada estado.
function setaDaSessaoHtml(key) {
  if (!key) return '';
  // aberto, a seta fica na mesma linha e no mesmo canto em que estava fechada
  if (cardCheio(key)) return ehCompacta() ? `<div class="sess-pron-aberta">${setaDoCard(key)}</div>` : '';
  return `<div class="sess-pron-curta">${setaDaLinhaHtml(key, false, key)}</div>`;
}

export {
  setaDoCard, linhaDoMeuPr, linhaDaDecisao, linhaDaFila, linhaDaFilaDeExecucao, rodapeDasRecentesHtml, renderResumoPraMim,
  setaDaSessaoHtml,
};
