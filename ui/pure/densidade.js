// A Compacta de Pra mim (07/11/2026): o estado de cada PR numa frase, a ação principal, o
// resumo do topo que leva às seções e o rodapé de Revisões recentes. A Expandida continua
// sendo os cards de sempre. Desenho: artboard PraMim em
// docs/superpowers/specs/2026-11-07-meus-prs-prontidao-anexos/PraMim.dc.html.
import { esc, plural, localDayKey } from './comum.js';
import { tituloDoAprovarDesligado } from './review.js';

export const DENSIDADES = ['compacta', 'expandida'];

// preferência lida do armazenamento local: qualquer coisa fora das duas vira a padrão
export function densidadeValida(valor) {
  return DENSIDADES.includes(valor) ? valor : 'compacta';
}

// O card de "Precisa de você" numa frase: "Aprovar com 2 ressalvas", "Pedir mudanças · 1 motivo".
export function fraseDaDecisao(d, meta = {}) {
  if (meta.stale) return { texto: 'Commit novo depois da revisão', tom: 'wait' };
  const n = Array.isArray(meta.reasons) ? meta.reasons.length : 0;
  if (d?.verdict === 'approve') return { texto: n ? `Aprovar com ${plural(n, 'ressalva', 'ressalvas')}` : 'Aprovar', tom: 'wait' };
  return { texto: n ? `Pedir mudanças · ${plural(n, 'motivo', 'motivos')}` : 'Pedir mudanças', tom: 'fail' };
}

// A única ação da linha compacta: a principal. As outras (Comentar, Pular) ficam no card cheio.
export function acaoDaDecisaoHtml(d, meta = {}, ciObrigatorio = true) {
  if (meta.stale || meta.semDecisivos) {
    const revisar = (meta.reviewBtn === 'primary' || meta.reviewBtn === 'secondary') && d?.pr?.url;
    return revisar ? `<button class="btn primary sm act-review" data-url="${esc(d.pr.url)}">Revisar agora</button>` : '';
  }
  if (d?.verdict === 'approve') {
    const desligado = meta.approveDisabled ? ` disabled title="${esc(tituloDoAprovarDesligado(ciObrigatorio))}"` : '';
    return `<button class="btn ok sm dec-act" data-action="approve"${desligado}>Aprovar</button>`;
  }
  return '<button class="btn sm dec-act dec-rc" data-action="request_changes">Pedir mudanças</button>';
}

// "Resolução automática": nada a fazer, o Farol posta sozinho quando o CI ou a análise fechar.
export function fraseDaEspera(ciObrigatorio) {
  return { texto: ciObrigatorio ? 'Esperando os checks · posta sozinho' : 'Resolvendo sozinho', tom: 'run' };
}

// O PR da fila numa frase: parado, automática desligada na conta, pedido de novo ou a posição
// na fila.
export function fraseDaFila(pr, o = {}) {
  if (o.parado) return { texto: 'Revisão automática parada', tom: 'fail' };
  if (o.manual) return { texto: 'Revisão automática desligada', tom: 'none' };
  if (pr?.reRequested) return { texto: 'Pedida de novo', tom: 'wait' };
  return { texto: `${Number(o.posicao) || 1}º na fila`, tom: 'none' };
}

export function fraseDaFilaDeExecucao(distribuindo) {
  return { texto: distribuindo ? 'Esperando distribuição' : 'Na fila de execução', tom: 'run' };
}

// Quantas revisões do histórico recente foram resolvidas hoje (dia local).
export function resolvidasHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  return (resolved || []).filter(r => r?.resolvedAt && localDayKey(r.resolvedAt) === hoje).length;
}

// O rodapé que substitui Revisões recentes na Compacta: "2 resolvidas hoje · mostrar".
export function rodapeDasRecentes(hoje, total, aberto) {
  if (aberto) return 'Esconder revisões recentes';
  if (hoje > 0) return `${plural(hoje, 'resolvida hoje', 'resolvidas hoje')} · mostrar`;
  return `${plural(total, 'revisão recente', 'revisões recentes')} · mostrar`;
}

function precisam(n) { return n === 1 ? '1 precisa de você' : `${n} precisam de você`; }
function sozinhos(n) { return n === 1 ? '1 se resolve sozinho' : `${n} se resolvem sozinhos`; }

const ITENS_DO_RESUMO = [
  ['analisando', 't-run', 'aba:radar:#activeWrap', n => `${n} analisando`],
  ['precisam', 't-wait', 'aba:radar:#decisionsWrap', precisam],
  ['sozinhos', 't-run', 'aba:radar:#esperaCiWrap', sozinhos],
  ['fila', 't-none', 'aba:radar:#queueSection', n => `${n} na fila`],
  ['resolvidas', 't-ok', 'aba:radar:#resolvedWrap', n => plural(n, 'resolvida hoje', 'resolvidas hoje')],
];

// A linha do topo de Pra mim: cada item leva à sua seção (data-goto). Vazio sem nada a contar.
export function resumoPraMimHtml(contagem = {}) {
  const itens = ITENS_DO_RESUMO.filter(([campo]) => Number(contagem[campo]) > 0).map(([campo, tom, goto, texto]) =>
    `<button type="button" class="pron-resumo-item" data-goto="${goto}"><span class="pl-estado ${tom}"><span class="pl-pt" aria-hidden="true"></span></span>${esc(texto(Number(contagem[campo])))}</button>`);
  return itens.length ? `<div class="pron-resumo-mim" aria-label="Resumo do que está acontecendo">${itens.join('')}</div>` : '';
}

// Cinco tons, nenhuma cor nova: ok (--settled), run (--working), wait (--urgent), fail
// (--blocked) e none (--muted). Tom desconhecido vira o neutro.
const TONS = new Set(['ok', 'run', 'wait', 'fail', 'none']);
export function classeDoTom(tom) {
  return `t-${TONS.has(tom) ? tom : 'none'}`;
}

// "owner/repo#N" vira "repo#N", como no desenho da linha compacta
export function chaveCurta(key) {
  return String(key || '').replace(/^[^/]+\//, '');
}

const SETA = { abrir: '<path d="M6 9l6 6 6-6"/>', recolher: '<path d="M6 15l6-6 6 6"/>' };

// A seta que abre o card cheio de um PR na Compacta (e recolhe, no card aberto).
export function setaDaLinhaHtml(key, aberta, rotulo = '') {
  const acao = aberta ? 'Recolher' : 'Expandir';
  return `<button type="button" class="pron-seta" data-linha="${esc(key)}" aria-expanded="${!!aberta}" aria-label="${acao} ${esc(rotulo || key)}" title="${acao}">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${aberta ? SETA.recolher : SETA.abrir}</svg></button>`;
}

function estadoDaLinha(estado) {
  if (!estado || !estado.texto) return '';
  return `<span class="pl-estado ${classeDoTom(estado.tom)}"><span class="pl-pt" aria-hidden="true"></span>${esc(estado.texto)}</span>`;
}

// Uma linha da Compacta: barra de estado, o começo (ponto da conta ou avatar), repo#N, título
// cortado, o estado numa frase, a ação principal e a seta. O.attrs leva os atributos que o
// listener da seção precisa (data-id da decisão, por exemplo).
export function linhaCompactaHtml(o = {}) {
  const ref = `<a class="pl-ref${o.refClasse ? ` ${o.refClasse}` : ''}" href="${esc(o.url || '#')}" target="_blank" rel="noreferrer" title="${esc(o.key)}">${esc(chaveCurta(o.key))}</a>`;
  return `<div class="pr-linha ${o.classe || ''} ${o.barra || ''}" data-key="${esc(o.key)}" data-url="${esc(o.url || '')}" ${o.attrs || ''} style="${o.style || ''}">
    ${o.inicio || ''}
    <div class="pl-main">${ref}<span class="pl-titulo" title="${esc(o.titulo)}">${esc(o.titulo)}</span></div>
    ${estadoDaLinha(o.estado)}${o.meio || ''}${o.acoes || ''}
    ${setaDaLinhaHtml(o.key, false, o.key)}${o.rodape || ''}
  </div>`;
}
