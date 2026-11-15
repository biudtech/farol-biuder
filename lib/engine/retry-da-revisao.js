// Agendamento da revisão quando ela precisa voltar à fila sem perder a identidade do PR.

// Sem confirmação do head no GitHub, aguarda um ciclo saudável sem gastar tentativa.
// A referência durável continua pendente até o dado necessário ser confirmado.
function aguardarConfirmacaoDeHead(engine, pr, msg) {
  const guardado = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key} (retomada aguardando confirmação do head): ${msg}`);
}

export { aguardarConfirmacaoDeHead };
