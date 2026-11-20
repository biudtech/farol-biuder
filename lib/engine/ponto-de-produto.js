// Decisão de produto não é do Farol (regra do dono de 20/11/2026).
//
// Caso de origem: num PR do dono do produto, a revisão levantou "Pergunta de produto em aberto"
// nos motivos e mandou para quem decide o merge que "aceitar esse efeito é uma decisão de produto
// e segurança". O revisor analisa se o código está correto; a escolha de produto é de quem faz o
// produto, e o Farol nunca a questiona. O prompt diz isso à sessão; aqui o motor garante que um
// item marcado como produto não chegue ao texto público nem aos motivos, venha de onde vier.
//
// A marca é estreita de propósito: só a expressão explícita ("decisão de produto", "pergunta de
// produto", "escolha de produto", "questão de produto", no singular ou no plural). Ponto técnico
// sobre a qualidade do código, mesmo que a funcionalidade seja de produto, não leva essa marca e
// segue intacto. O filtro age só sobre ITENS (um motivo, um item para quem mergeia, um comentário
// de linha), nunca recorta o corpo do review.
//
// PURO: só lê e normaliza o envelope. Não decide postagem, não toca gate.
const MARCA_DE_PRODUTO = /\b(?:decis(?:ão|ao|ões|oes)|perguntas?|escolhas?|quest(?:ão|ao|ões|oes))\s+de\s+produto\b/i;

function textoDoItem(item) {
  if (typeof item === 'string') return item;
  return (item && typeof item === 'object' && typeof item.text === 'string') ? item.text : '';
}

function ehPontoDeProduto(item) {
  return MARCA_DE_PRODUTO.test(textoDoItem(item));
}

// Tira do envelope os itens marcados como produto: os motivos que a sessão escreveu e os
// comentários de linha dos três payloads. Muta o envelope de propósito, como os outros passos do
// conferirEnvelope (envelope-revisao.js), e devolve quantos itens saíram.
function semPontosDeProduto(result) {
  if (!result || typeof result !== 'object') return 0;
  let tirados = 0;
  if (Array.isArray(result.reasons)) {
    const antes = result.reasons.length;
    result.reasons = result.reasons.filter((r) => !ehPontoDeProduto(r));
    tirados += antes - result.reasons.length;
  }
  for (const payload of Object.values(result.payloads || {})) {
    if (!payload || !Array.isArray(payload.comments)) continue;
    const antes = payload.comments.length;
    payload.comments = payload.comments.filter((c) => !ehPontoDeProduto(c && c.body));
    tirados += antes - payload.comments.length;
  }
  return tirados;
}

export default { ehPontoDeProduto, semPontosDeProduto };
export { ehPontoDeProduto, semPontosDeProduto };
