// Os campos da projeção do motor (decisionForUi) de que depende o Aprovar da mesa.
//
// A tela antiga derivava "Aprovar desligado" destes cinco, e os testes de gate afirmavam o
// resultado dela. A tela saiu em 16/11/2026; os testes passam a afirmar os campos, um a um,
// com o valor esperado escrito no teste. Quem desenha o botão é o front, a partir disto:
//   - `esperaProva` ou `esperaCi` presentes: a decisão não está na mesa;
//   - `prProprio`: o GitHub recusa a decisão do autor;
//   - `technical` em 'pending' ou 'violation', ou `recheck`: a prova técnica segura o Aprovar.
function camposDoAprovar(tela) {
  const t = tela || {};
  return {
    esperaProva: !!t.esperaProva,
    esperaCi: !!t.esperaCi,
    prProprio: t.prProprio === true,
    technical: (t.technical && t.technical.state) || null,
    recheck: t.blockedKind === 'technical_recheck',
  };
}

export { camposDoAprovar };
