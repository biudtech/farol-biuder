/* Farol · UI: log de falhas e diagnóstico em Markdown (GET /api/log, /api/log/triage e
   /api/diagnostics). */

import { logSummaryShort, diagnosticoHtml, falhasSecaoHtml } from '../pure.js';
import { $, get, toast, copyToClipboard } from './infra.js';

async function loadLog() {
  const [lines, grupos] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  const linhas = lines || [];
  $('#logBox').textContent = linhas.length ? linhas.join('\n') : 'Log vazio.';
  // resumo agrupado ANTES do despejo: contagem crua não distingue "1 problema repetido
  // 70 vezes" de "70 problemas". Fica num parágrafo próprio de propósito, e não dentro
  // da .section-head: aquela linha é flex e quebra cedo (ver o CSS da aba).
  const resumo = $('#logResumo');
  const sumario = logSummaryShort(grupos || [], 3);
  const texto = sumario ? `No log: ${sumario}` : '';
  resumo.textContent = texto;
  resumo.hidden = !texto;
  const box = $('#logBox');
  box.scrollTop = box.scrollHeight;
  // as falhas registradas vivem ao lado do log, e a mesma ida à aba atualiza as duas
  carregarDiagnostico();
}

/* ---------- diagnóstico unificado (A3) ----------
   UM texto só, montado no engine (GET /api/diagnostics): ambiente, falhas registradas e
   resumo do log, com segredo mascarado, menção e URL em código e texto livre em cerca. A
   tela mostra esse texto inerte, e o botão copia o próprio texto, nunca o HTML. O export
   antigo montado aqui saiu junto com a função pura que o montava: ele juntava contas e
   configuração inteiras no texto
   copiado, e havia três superfícies dizendo a mesma coisa de jeitos diferentes. */
const falhas = { estado: 'carregando', lista: [], lidoEm: 0 };
let ultimoDiagnostico = '';

function renderFalhas() {
  const alvo = $('#diagFalhas');
  if (alvo) alvo.innerHTML = falhasSecaoHtml({ estado: falhas.estado, falhas: falhas.lista, lidoEm: falhas.lidoEm });
}

// Leitura que falha preserva a última lista boa e diz de quando ela é: vazio e falha são
// estados diferentes, e confundir os dois é o defeito que o brief nomeia.
async function carregarDiagnostico() {
  const r = await get('/api/diagnostics');
  if (r && r.ok) {
    ultimoDiagnostico = String(r.markdown || '');
    falhas.estado = 'pronto';
    falhas.lista = Array.isArray(r.falhas) ? r.falhas : [];
    falhas.lidoEm = Date.now();
  } else {
    falhas.estado = 'erro';
  }
  renderFalhas();
  return falhas.estado === 'pronto' ? ultimoDiagnostico : '';
}

$('#btnDiag').onclick = async () => {
  const btn = $('#btnDiag'), prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'Lendo…';
  const texto = await carregarDiagnostico();
  btn.disabled = false; btn.textContent = prev;
  if (!texto) { toast('error', 'Não deu para montar o diagnóstico agora.', 4000); return; }
  $('#diagBox').innerHTML = diagnosticoHtml(texto);
  $('#diagPanel').hidden = false;
  const ok = await copyToClipboard(texto);
  const recado = ok ? 'Diagnóstico copiado como texto, com segredos mascarados.' : 'Diagnóstico pronto. Use "Copiar" para levar o texto.';
  toast(ok ? 'ok' : 'info', recado, 4500);
  $('#diagPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#btnDiagCopy').onclick = async () => {
  const ok = await copyToClipboard(ultimoDiagnostico);
  toast(ok ? 'ok' : 'error', ok ? 'Copiado como texto.' : 'Não consegui copiar (permissão do navegador).', 2500);
};
$('#btnDiagClear').onclick = () => { $('#diagPanel').hidden = true; };
// cada cartão copia SÓ a própria falha, já mascarada pelo engine
$('#diagFalhas').addEventListener('click', async (ev) => {
  const botao = ev.target.closest('[data-copiar-falha]');
  if (!botao) return;
  const f = falhas.lista.find((x) => x.id === botao.dataset.copiarFalha);
  const ok = f ? await copyToClipboard(f.markdown) : false;
  toast(ok ? 'ok' : 'error', ok ? 'Falha copiada como texto.' : 'Não consegui copiar esta falha.', 2500);
});

export { loadLog, carregarDiagnostico };
