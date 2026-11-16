// A porta de execução desta máquina (28/09/2026): a UMA pergunta que toda revisão headless
// faz antes de existir. A regra de hoje mora no próprio módulo: PR da própria conta
// (pr-proprio.js). A revisão roda com o GH_TOKEN da conta e põe a label `<conta>:revisando`.
import prProprio from './pr-proprio.js';
import { comAutor } from './autor-do-pr.js';

function motivoParaNaoExecutar(engine, pr) {
  return prProprio.ehMeu(engine, pr) ? 'pr-proprio' : '';
}

// Tira do lote o que não pode executar aqui, com um aviso por PR barrado.
function executaveis(engine, itens) {
  const fica = [];
  const avisos = new Set();
  for (const it of itens) {
    if (!motivoParaNaoExecutar(engine, it)) { fica.push(it); continue; }
    const aviso = { kind: 'info', text: prProprio.avisoPrProprio(it.key) };
    if (!avisos.has(aviso.text)) engine.emit('toast', aviso);
    avisos.add(aviso.text);
  }
  return fica;
}

// A sessao deste PR terminou ou nem vai comecar: libera a vaga da conta, persiste o
// inflight, atualiza a tela e chama a proxima da fila. Os quatro passos andavam copiados
// em cinco ramos deste arquivo, e separa-los ja custou vaga presa.
function encerrarSemSessao(engine, pr, acct) {
  engine.freeHeadlessSlot(acct, pr);
  engine.writeInflight();
  engine.pushState();
  engine.processHeadless();
}

export default { comAutor, motivoParaNaoExecutar, executaveis, encerrarSemSessao };
export { comAutor, motivoParaNaoExecutar, executaveis, encerrarSemSessao };
