// Agendamento da revisão quando ela precisa voltar à fila sem perder a identidade do PR.
import retomadaMod from './retomada-duravel.js';

// Sem confirmação do head no GitHub, aguarda um ciclo saudável sem gastar tentativa.
// A referência durável continua pendente até o dado necessário ser confirmado.
function aguardarConfirmacaoDeHead(engine, pr, msg) {
  const guardado = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key} (retomada aguardando confirmação do head): ${msg}`);
}

// A continuação na mesma conversa (reparo do envelope, recuperação dos critérios) encontrou
// outro perfil, modelo ou esforço do que a sessão que a abriu (conferirAssinatura,
// lib/engine/sessao-continuacao.js): o caso comum é a troca de perfil no limite do plano
// (18/11/2026), e o mesmo vale para modelo ou esforço trocados de propósito. A conversa não é
// levada a outra sessão; a revisão recomeça como sessão NOVA no próximo ciclo, sem estacionar
// e sem gastar tentativa, porque nada falhou neste PR.
function recomecarEmSessaoNova(engine, pr, msg) {
  retomadaMod.consumirRetomada(engine, pr.key);
  const guardado = engine.retryAfterNet.get(pr.key);
  const semRetomada = { ...pr };
  delete semRetomada.retomarSid;
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr: semRetomada, notBefore: null });
  engine.log('WARN', `revisao ${pr.key}: ${msg}; recomeça em sessão nova no próximo ciclo`);
}

// As duas voltas à fila que não são falha do PR, pela marca do erro.
function reagendarSemTentativa(engine, pr, err, msg) {
  if (err && err.continuationChanged) recomecarEmSessaoNova(engine, pr, msg);
  else aguardarConfirmacaoDeHead(engine, pr, msg);
}

export { aguardarConfirmacaoDeHead, recomecarEmSessaoNova, reagendarSemTentativa };
