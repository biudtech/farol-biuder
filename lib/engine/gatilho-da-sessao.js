// O gatilho de uma sessão de IA, gravado no registro de consumo (redesenho, lote 2, 19/11/2026):
// por que ela rodou. Só informa a tela de Consumo e o detalhe da revisão; nenhuma regra de gate,
// fila ou postagem lê o campo.
//   - `primeira`: a revisão pedida, pela fila ou pelo clique;
//   - `commit_novo`: o round automático depois de um push (o review postado que ficou para trás,
//     ou a pendência stale_head de um commit que a sessão não leu);
//   - `rodada_extra`: o motor revisando de novo o MESMO commit, pelo desfecho sem mesa
//     (desfecho-sem-mesa.js), pela busca da prova (espera-prova.js) ou pela reconferência
//     técnica (technical-review/recheck.js);
//   - `contestacao`: a leitura do pushback do autor (pushback.js).
// Quem sabe o gatilho marca o PR enfileirado (`pr.gatilho`) ou o opts da sessão, e o session.js
// o leva ao evento (`farol_gatilho`), que o recordUsage grava por camposDaTentativa
// (usage-desfechos.js). O registro gravado antes desta marca, e o que a perdeu num reinício (a
// fila durável não a guarda), conta como `primeira` na revisão e `contestacao` no pushback.
const GATILHOS = Object.freeze(['primeira', 'commit_novo', 'rodada_extra', 'contestacao']);

// PURA: o gatilho do round automático, pela pendência stale_head do PR (null no gatilho A, o
// review postado que o push deixou para trás). A rodada extra é a que pede de novo o commit que a
// sessão anterior leu; o resto é commit novo.
function gatilhoDoRound(pendencia) {
  const p = pendencia && typeof pendencia === 'object' ? pendencia : null;
  const mesmoCommit = !!p && !!p.blockedHead && p.blockedHead === p.headSha;
  return mesmoCommit && (!!p.semMesa || !!p.esperaProva) ? 'rodada_extra' : 'commit_novo';
}

// PURA: o gatilho de uma linha do diário, com o padrão do registro antigo. Conversa e ferramenta
// não têm gatilho de PR, e saem vazias.
function gatilhoDaLinha(linha) {
  const kind = linha && linha.kind;
  if (kind === 'pushback') return 'contestacao';
  if (kind !== 'review') return '';
  return GATILHOS.includes(linha.gatilho) ? linha.gatilho : 'primeira';
}

export default { GATILHOS, gatilhoDoRound, gatilhoDaLinha };
export { GATILHOS, gatilhoDoRound, gatilhoDaLinha };
