// Revisão das configurações das contas (29/09/2026, pedido do dono: "não quero de maneira
// nenhuma habilitar um botão à toa"), e a consequência dela em 30/09/2026: "Preciso que não
// exista mais sobreposição de configurações". A política mora só na conta.
//
// Este arquivo conferia o cartão de Contas e a seção de Automação da tela antiga contra o que o
// motor faz. A tela saiu em 16/11/2026; fica a regra do motor que o cartão espelhava: o com
// ressalvas nunca é mais permissivo que o limpo, e o valor ausente tem um padrão só.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BIUDER = { user: 'biuder', autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes' };
const contasConfig = (await import('../lib/engine/contas-config.js')).default;

function engineCom(contas) {
  return { config: {}, accountList: () => contas };
}

test('com o sem ressalvas esperando você, o com ressalvas também espera, inclusive no par proibido gravado à mão', () => {
  const espera = { ...BIUDER, user: 'cautelosa', onClean: 'wait', onCaveats: 'wait' };
  const aprova = { ...BIUDER, user: 'solta', onCaveats: 'approve' };
  assert.equal(contasConfig.acaoAoAprovar(engineCom([espera, aprova]), 'cautelosa', false), 'wait');
  assert.equal(contasConfig.acaoAoAprovar(engineCom([espera, aprova]), 'solta', false), 'approve');
  // par proibido gravado à mão: vale o que o engine faz, não o que está no arquivo
  const torta = { ...BIUDER, user: 'torta', onClean: 'wait', onCaveats: 'approve' };
  assert.equal(contasConfig.acaoAoAprovar(engineCom([torta]), 'torta', false), 'wait');
});

test('toda combinação de conta tem uma leitura só, e o com ressalvas nunca passa do limpo', () => {
  const eixo = { autoReview: [undefined, true, false], onClean: [undefined, 'approve', 'wait'], onCaveats: [undefined, 'approve', 'wait'], onReject: [undefined, 'wait', 'request_changes'] };
  for (const autoReview of eixo.autoReview) for (const onClean of eixo.onClean) for (const onCaveats of eixo.onCaveats) for (const onReject of eixo.onReject) {
    const conta = { user: 'x', autoReview, onClean, onCaveats, onReject };
    const e = engineCom([conta]);
    const caso = JSON.stringify(conta);
    assert.equal(typeof contasConfig.revisaSozinho(e, 'x'), 'boolean', caso);
    const limpo = contasConfig.acaoAoAprovar(e, 'x', true);
    const comRessalvas = contasConfig.acaoAoAprovar(e, 'x', false);
    assert.ok(['approve', 'wait'].includes(limpo), caso);
    assert.ok(['approve', 'wait'].includes(comRessalvas), caso);
    if (limpo === 'wait') assert.equal(comRessalvas, 'wait', caso);
    assert.ok(['request_changes', 'wait'].includes(contasConfig.acaoAoReprovar(e, 'x')), caso);
  }
});
