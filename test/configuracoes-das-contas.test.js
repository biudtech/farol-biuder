// Revisão das configurações das contas (29/09/2026, pedido do dono: "não quero de maneira
// nenhuma habilitar um botão à toa"), e a consequência dela em 30/09/2026: "Preciso que não
// exista mais sobreposição de configurações". A política mora só na conta.
//
// Este arquivo conferia o cartão de Contas e a seção de Automação da tela antiga contra o que o
// motor faz. A tela saiu em 16/11/2026; fica a regra do motor que o cartão espelhava: o valor
// ausente tem um padrão só. Até 17/11/2026 a regra era também "o com ressalvas nunca é mais
// permissivo que o limpo", que só existia por causa do `wait`; o `wait` saiu (o revisor nunca
// espera decisão de gente) e a leitura de toda conta é o padrão autônomo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BIUDER = { user: 'biuder', autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
const contasConfig = (await import('../lib/engine/contas-config.js')).default;

function engineCom(contas) {
  return { config: {}, accountList: () => contas };
}

test('o wait gravado à mão é lido como o padrão autônomo, em qualquer combinação', () => {
  const espera = { ...BIUDER, user: 'cautelosa', onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };
  const torta = { ...BIUDER, user: 'torta', onClean: 'wait', onCaveats: 'approve' };
  for (const conta of [espera, torta]) {
    const e = engineCom([conta]);
    assert.equal(contasConfig.acaoAoAprovar(e, conta.user, true), 'approve', conta.user);
    assert.equal(contasConfig.acaoAoAprovar(e, conta.user, false), 'approve', conta.user);
    assert.equal(contasConfig.acaoAoReprovar(e, conta.user), 'request_changes', conta.user);
  }
});

test('toda combinação de conta tem uma leitura só: a autônoma', () => {
  const eixo = { autoReview: [undefined, true, false], onClean: [undefined, 'approve', 'wait'], onCaveats: [undefined, 'approve', 'wait'], onReject: [undefined, 'wait', 'request_changes'] };
  for (const autoReview of eixo.autoReview) for (const onClean of eixo.onClean) for (const onCaveats of eixo.onCaveats) for (const onReject of eixo.onReject) {
    const conta = { user: 'x', autoReview, onClean, onCaveats, onReject };
    const e = engineCom([conta]);
    const caso = JSON.stringify(conta);
    assert.equal(typeof contasConfig.revisaSozinho(e, 'x'), 'boolean', caso);
    const limpo = contasConfig.acaoAoAprovar(e, 'x', true);
    const comRessalvas = contasConfig.acaoAoAprovar(e, 'x', false);
    assert.equal(limpo, 'approve', caso);
    assert.equal(comRessalvas, 'approve', caso);
    assert.equal(contasConfig.acaoAoReprovar(e, 'x'), 'request_changes', caso);
  }
});
