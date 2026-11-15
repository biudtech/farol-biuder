// PR de autoria da PRÓPRIA conta nunca vira revisão headless (28/09/2026).
//
// Medido num PR do engine-ai: o autor era a conta deste Farol, e um aparelho do grupo
// abriu revisão headless nele com essa mesma conta. A label `<conta>:revisando` ficou
// oito minutos no PR, e o time viu o autor "revisando" o próprio trabalho. A fila
// automática nunca traz PR próprio (o GitHub não deixa pedir revisão ao autor), mas os
// outros caminhos até o enqueueHeadless (clique no panorama, URL avulsa, re-revisão e os
// comandos entre aparelhos) não conferiam o autor.
//
// Não existe revisão headless legítima de PR próprio: a regra vale inclusive para o clique.
//
// Sem rede de propósito: o autor vem do item (fila, panorama, comando e distribuição o
// trazem). Item que chega sem autor (a URL avulsa, a postagem de sessão) tem o autor lido do
// GitHub antes de chegar aqui, na porta de execução e no portão de postagem
// (autor-do-pr.js). Se a leitura falhar, o item segue sem autor: falta de dado nunca bloqueia.

// PURA. Autor ou conta vazios não provam nada, então dão false.
function ehPrProprio(autor, conta) {
  const a = String(autor || '').trim().toLowerCase();
  const c = String(conta || '').trim().toLowerCase();
  return !!a && !!c && a === c;
}

function ehMeu(engine, pr) {
  return ehPrProprio(pr.author, engine.accountForPr(pr));
}

function avisoPrProprio(key) {
  return `${key} é seu: revisão não abre em PR próprio.`;
}

// O desfecho de uma revisão de PR próprio que chegou ao gate mesmo assim (17/10/2026,
// biud-frontend#1479, a conta que revisa era a autora): o GitHub recusa APPROVE e
// REQUEST_CHANGES do autor, então nenhuma prova destrava a postagem. O gate de postagem
// (approval-policy.js) nunca posta nem arma espera, e o card vai para a mesa com este texto.
function textoDoPrProprio(conta, veredito) {
  const quem = `o PR é da própria conta que revisa (@${String(conta || '').trim()})`;
  if (veredito === 'request_changes') return `${quem}; o GitHub não aceita pedido de mudanças do autor, então outra pessoa precisa revisar`;
  return `${quem}; o GitHub não aceita APPROVE do autor, então outra pessoa precisa aprovar`;
}

// Tirar os PRs próprios de um lote é da porta de execução (porta-de-execucao.js), que
// junta esta regra com a do aparelho admin.
export { ehPrProprio, ehMeu, avisoPrProprio, textoDoPrProprio };
export default { ehPrProprio, ehMeu, avisoPrProprio, textoDoPrProprio };
