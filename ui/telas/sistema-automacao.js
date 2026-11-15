/* Farol · UI: automação (Sistema > Plano e chaves): modelo e esforço do Claude. */

import { opcoesDeModeloHtml, selecaoAceitaEsforco } from '../pure.js';
import { estado } from './estado.js';
import { $ } from './infra.js';

// Redesenha as opções só quando o catálogo muda: o snapshot chega a cada poucos segundos,
// e recriar o <select> a cada push fecharia a lista aberta na mão de quem está escolhendo.
function preencherSeletor(select, lista) {
  if (!select) return;
  const html = opcoesDeModeloHtml(lista);
  if (select.dataset.catalogo === html) return;
  select.innerHTML = html;
  select.dataset.catalogo = html;
}

function addCustomOption(select, value) {
  if (!value || !select || !select.options) return;
  if (Array.from(select.options).some(o => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = `${value} (config.json)`;
  select.appendChild(opt);
}

/* Cartões de esforço: marca o que está salvo e explica o estado. Valor desconhecido
   cai no cartão do padrão, em vez de deixar nenhum marcado. */
function renderEffortBox(box, eff) {
  if (!box) return;
  const alvo = box.querySelector(`input[value="${CSS.escape(eff)}"]`) || box.querySelector('input[value=""]');
  if (alvo) alvo.checked = true;
}

function renderAutomationSettings(c) {
  const claudeModel = String(c.reviewModel || '');
  // as seleções vêm do catálogo do engine (lib/modelos.js), não de uma lista fixa no HTML
  const modelos = estado().modelos || {};
  preencherSeletor($('#setReviewModel'), modelos.claude);
  addCustomOption($('#setReviewModel'), claudeModel);
  $('#setReviewModel').value = claudeModel;
  renderEffortBox($('#setReviewEffort'), String(c.reviewEffort || ''));

  // quem aceita esforço é o catálogo que diz, a mesma resposta que o engine usa na flag
  const selecao = (modelos.claude || []).find(s => s.valor === claudeModel) || null;
  const semEsforco = !selecaoAceitaEsforco(modelos.claude, claudeModel);
  $('#setReviewEffort').classList.toggle('disabled', semEsforco);
  // sem nome de modelo escrito aqui: cada opção já diz o que é, e o Auto diz quais usa
  $('#reviewModelHint').textContent = 'O Auto revisa todo PR na faixa de qualidade do Opus e sobe o raciocínio para Muito alto (esforço máximo) em repositório crítico, caminho sensível ou PR muito grande, só na revisão em segundo plano.';
  let effortHint = 'Quanto o Claude pensa nas sessões autônomas. Mais esforço aumenta profundidade e consumo do limite.';
  if (selecao && selecao.auto) {
    effortHint = 'No modo Auto a revisão usa o Opus no raciocínio padrão dele e sobe para Muito alto (esforço máximo) quando o contexto do PR pede; o nível fixo desta seção e o modo rápido não entram.';
  } else if (semEsforco) {
    effortHint = `O ${(selecao && selecao.nome) || 'modelo escolhido'} não aceita nível de esforço, então o Farol não passa a flag enquanto ele estiver escolhido.`;
  }
  $('#effortHint').textContent = effortHint;
}

export { renderAutomationSettings };
