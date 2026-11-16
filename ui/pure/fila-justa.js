// Justiça de fila entre orgs (spec 2026-09-10-justica-de-fila-entre-orgs).
//
// O painel existe porque uma automação que CEDE A VEZ, vista de fora, é idêntica a uma
// automação QUEBRADA: nos dois casos o PR fica parado e nada na tela explica. É a mesma
// lição do estacionamento visível (v2.57.4).
//
// Puro: recebe o `filaJusta` do snapshot e devolve HTML. Não decide nada.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou. O import
// abaixo é a camada de baixo do diretório.

// "há 12m" / "agora" pra um intervalo já medido em ms (o snapshot manda a diferença
// pronta, não o instante, pra tela não depender do relógio da máquina bater com o do
// engine). null = nunca aconteceu.
import { esc, fmtDur } from './comum.js';

export function fjQuando(ms) {
  if (ms == null) return 'nunca';
  const d = fmtDur(ms);
  return d ? `há ${d}` : 'agora';
}

// A ordem em que o escalonador atende (proximoHeadless, lib/engine/review.js): primeiro as
// orgs com PR esperando; entre elas, a nunca atendida e depois a atendida HÁ MAIS TEMPO.
// Até 30/09/2026 o painel ordenava por quem espera há mais tempo e prometia, no cabeçalho,
// "quem é atendido primeiro": a tabela mostrava uma ordem que a fila não segue.
export function ordemDoEscalonador(porOrg) {
  const haMaisTempo = (o) => (o.ultimaVezMs == null ? Infinity : o.ultimaVezMs);
  return [...porOrg].sort((a, b) => (b.esperando > 0) - (a.esperando > 0)
    || haMaisTempo(b) - haMaisTempo(a) || (b.esperaMaisAntigaMs || 0) - (a.esperaMaisAntigaMs || 0));
}

function fjOrgsHtml(porOrg) {
  if (!porOrg || !porOrg.length) return '';
  const linhas = ordemDoEscalonador(porOrg).map(o => {
    const espera = o.esperando > 0 ? `${o.esperando} esperando` : 'fila vazia';
    const maisAntigo = o.esperando > 0 && o.esperaMaisAntigaMs ? ` · mais antigo ${fjQuando(o.esperaMaisAntigaMs)}` : '';
    return `<tr>
      <td class="fj-org">${esc(o.org)}</td>
      <td>${esc(espera)}${esc(maisAntigo)}</td>
      <td class="fj-num">${esc(fjQuando(o.ultimaVezMs))}</td>
    </tr>`;
  }).join('');
  return `<div class="fj-bloco">
    <h4>Por org</h4>
    <p class="fj-nota">A próxima vaga vai para a org atendida há mais tempo. Dentro da mesma org, vale a ordem de chegada.</p>
    <table class="fj-tab"><thead><tr><th>Org</th><th>Fila</th><th class="fj-num">Última vez atendida</th></tr></thead><tbody>${linhas}</tbody></table>
  </div>`;
}

export function filaJustaHtml(fj) {
  if (!fj) return '';
  const global = fj.tetoGlobal > 0
    ? `<div class="fj-bloco"><h4>Teto total desta instalação</h4><p class="fj-nota">${esc(fj.emCurso)} de ${esc(fj.tetoGlobal)} revisões simultâneas em curso, somando todas as contas.</p></div>`
    : '';
  const corpo = fjOrgsHtml(fj.porOrg) + global;
  // Sem nada a mostrar, o painel some inteiro em vez de exibir tabela vazia: sem org na
  // fila não há rodízio nenhum pra explicar, e um card vazio parece defeito.
  return corpo;
}
