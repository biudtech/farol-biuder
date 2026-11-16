// O Radar: os cards da fila, a nota de PR estacionado e o vazio que
// confirma o que o app fez. Extraído do ui/pure.js na Fase 1a da reorganização; o
// conteúdo não mudou.
//
// Os cards saíram do app.js na onda 5, quarto passo: o render lê o estado, filtra e seta
// os contadores; o CARD em si só recebe o PR e um ctx.
//
// O vazio que CONFIRMA: vazio bom merece dizer o que o app fez, não só que não há nada
// (quantos PRs foram aprovados sozinhos hoje, quais orgs são monitoradas e de quanto em
// quanto tempo). `aprovadosHoje` mora em comum.js e é chamada pelo app.js: ela lê
// `decisions.resolved`, que é estado, e o construtor recebe só o número pronto. Ficar em
// comum.js é também o que impede o ciclo radar -> review -> sessao -> radar.
import { esc, fmtRel, fmtStamp, fmtWhenDay, plural } from './comum.js';
import { avatar, personMention } from './mencoes.js';
import { papelPicker } from './pessoas.js';
import { filaEsperaHtml } from './fila-espera.js';
import { avisosDoCard, limitNoteHtml, othersLineHtml } from './revisando.js';

/* As orgs que o vazio da fila pode NOMEAR. PURA.

   Existe porque a frase saía de `config.owners` (`ui/app.js`), o campo legado do modo
   simples: `accountList()` (server.js) só cai nele quando NÃO há conta cadastrada, então
   com contas o motor ignorava aquele campo e a tela seguia exibindo ele. Medido em
   12/09/2026: `config.owners` dizia uma org enquanto as contas monitoravam cinco.

   A régua é o que de fato é BUSCADO: `searchPRs` pula conta sem token
   (`lib/engine/gh-queries.js`). */
export function orgsMonitoradas(accounts) {
  // minúscula -> primeira grafia vista: quem lê deve ver o nome do jeito que cadastrou
  const vistas = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || !a.tokenOk) continue;
    for (const org of orgsDaConta(a)) if (!vistas.has(org.toLowerCase())) vistas.set(org.toLowerCase(), org);
  }
  return [...vistas.values()];
}

function orgsDaConta(a) {
  return (Array.isArray(a.owners) ? a.owners : []).map(o => String(o || '').trim()).filter(Boolean);
}

export function queueEmptyOkHtml(ctx = {}) {
  const aprovados = ctx.aprovados || 0;
  const orgs = (ctx.owners || []).map(o => `<b>${esc(o)}</b>`).join(', ');
  const min = Math.round((ctx.intervalSeconds || 300) / 60);
  const plural = aprovados === 1 ? 'PR' : 'PRs';
  const feito = aprovados
    ? `O Farol aprovou ${aprovados} ${plural} sozinho hoje e monitora `
    : 'O Farol monitora ';
  const quem = orgs || 'as organizações configuradas';
  const cadencia = min === 1 ? 'minuto' : 'minutos';
  const botaoAprovados = aprovados ? '<button class="btn sm ghost eo-resolved">Ver o que foi aprovado</button>' : '';
  return `<div class="empty-ok">
      <div class="eo-check" aria-hidden="true">✓</div>
      <div class="eo-title">Nada esperando por você</div>
      <p class="eo-sub">${feito}${quem} a cada ${min} ${cadencia}. Quando pedirem sua revisão, o card aparece aqui.</p>
      <div class="eo-acts">
        ${botaoAprovados.replace('btn sm ghost', 'btn sm')}
        <button class="btn sm ghost eo-check-now">Verificar agora</button>
      </div>
    </div>`;
}

// Frase do estacionamento por tipo (ver `estacionar` em lib/engine/review.js). O
// motivo só entra onde ele diz algo que o tipo não diz: o cancelamento já é a
// explicação inteira.
function comMotivo(base, motivo, rotulo = '') {
  if (!motivo) return base;
  return `${base} (${rotulo}${motivo})`;
}

const PARKED_FRASE = {
  cancelado: () => 'cancelada por você',
  autenticacao: () => 'a credencial usada na revisão expirou; renove o login do perfil em Sistema > Plano e chaves antes de clicar em Revisar',
  'label-retirada': () => 'a label de revisão foi retirada do PR; a revisão volta por clique, commit novo ou pedido novo',
  esgotado: (motivo) => comMotivo('falhou várias vezes seguidas', motivo, 'último erro: '),
  falha: (motivo) => comMotivo('falhou', motivo),
  // estacionada antes da v2.57.4: o arquivo antigo não guardava motivo nem hora
  legado: () => 'parou antes desta versão, sem motivo registrado',
};

// Aviso no card da fila de que a revisão automática PAROU, com quando e por quê.
// Existe porque o estacionamento era invisível: o toast morria em cinco segundos e o
// card voltava idêntico ao de um PR nunca revisado (biud-core#317, 03/09/2026: duas
// horas parado no Farol de um colega enquanto ele revisava os vizinhos). '' sem info.
export function parkedNoteHtml(info, rotulo = 'Revisar') {
  if (!info || typeof info !== 'object') return '';
  const frase = (PARKED_FRASE[info.tipo] || PARKED_FRASE.falha)(String(info.motivo || '').trim());
  const quando = info.at ? ` <span title="${esc(fmtStamp(info.at))}">${esc(fmtWhenDay(info.at))}</span>` : '';
  return `<div class="pr-parked">Revisão automática parada${quando}: ${esc(frase)}. Ela não relança sozinha; o botão ${esc(rotulo)} tenta de novo.</div>`;
}

export function queueCardHtml(pr, ctx) {
  // os selos inline saem do template: dentro dele o gate conta todos os ternarios
  // do literal como um statement so, e o template fica ilegivel de tao denso
  const seloRascunho = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedida = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const papel = pr.author ? ` ${papelPicker(pr.author, ctx.people)}` : '';
  // Os avisos da execução seguem a precedência do Claude Design (02/10/2026,
  // ui/pure/revisando.js): parada, depois limite do plano. Com alguém
  // revisando, o limite some, porque fala de uma revisão automática que não
  // vai acontecer.
  // a decisão do motor por PR (conta, organização e autor); sem ela, a conta
  const automaticaDesativada = ctx.manual === true;
  const parkedInfo = (ctx.parked || {})[pr.key];
  const av = avisosDoCard(pr, { temParada: !!parkedInfo, limiteAtivo: !automaticaDesativada && Number(ctx.limiteAte) > Date.now(), limiteNoTopo: !!ctx.limiteNoTopo });
  const parked = parkedNoteHtml(parkedInfo, av.rotulo);
  const pessoas = av.forma ? othersLineHtml(av.logins, av.forma) : '';
  const limite = av.nota === 'limite' ? limitNoteHtml(ctx.limiteAte, av.formaLimite, av.rotulo) : '';
  const manual = automaticaDesativada ? `<div class="pr-coord">Revisão automática desativada para este PR. Para iniciar aqui, clique em ${esc(av.rotulo)}.</div>` : '';
  const conflito = (ctx.esperaConflito || {})[pr.key] ? '<div class="pr-coord">Em conflito com a base: a revisão automática abre quando o conflito for resolvido. O botão Revisar não espera.</div>' : '';
  const acaoRevisar = `<button class="btn primary sm act-review" data-url="${esc(pr.url)}">${av.rotulo}</button>`;
  // O ponto da conta abre a linha do PR, e não é filho do card: a grade tem uma coluna
  // por filho (avatar, conteúdo, ações, na anatomia do Claude Design), e um quarto filho
  // jogava o avatar na coluna elástica e as ações para baixo (visão Todas, 25/09/2026).
  return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}">
      ${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${seloRascunho}${seloRepedida}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
        ${parked}${pessoas}${limite}${manual}${conflito}
      </div>
      <div class="pr-actions">
        ${acaoRevisar}
        <button class="btn icon sm ghost act-more" data-key="${esc(pr.key)}" title="Mais ações" aria-label="Mais ações" aria-expanded="false">···</button>
        ${ctx.pronLado || ''}
      </div>
      <!-- O menu abre DENTRO do card, empurrando o conteúdo, em vez de flutuar por cima:
           num card já estreito, dropdown flutuante sai da tela ou cobre o card vizinho.
           Ignorar veio pra cá porque é destrutivo e estava a um
           toque de distância do Revisar. -->
      <div class="pr-menu" data-menu="${esc(pr.key)}" hidden>
        <a href="${esc(pr.url)}" target="_blank" rel="noreferrer">Abrir no GitHub ↗</a>
        <button class="danger act-ignore" data-key="${esc(pr.key)}">Marcar como visto sem revisar</button>
      </div>
    </div>`;
}

// Pedido ja retirado da fila acionavel, mas ainda sem sessao ou decisao. Nao oferece
// Revisar/Ignorar: o executor ainda pode pega-lo, e um
// segundo disparo aqui criaria duas revisoes para o mesmo commit.
export function queueWaitingCardHtml(pr, ctx) {
  const estado = 'Na fila de execução';
  const espera = filaEsperaHtml(ctx.espera);
  return `<div class="card pr-card" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}">
    ${avatar(pr.author)}
    <div class="info">
      <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a></div>
      <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
      <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}</div>
      <div class="pr-coord">${estado}. Ainda não há resultado desta execução.</div>${espera}
    </div>
    <div class="pr-actions"><a class="btn sm ghost" href="${esc(pr.url)}" target="_blank" rel="noreferrer">Abrir PR ↗</a>${ctx.pronLado || ''}</div>
  </div>`;
}
