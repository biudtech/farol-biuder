// Os critérios do card um a um, como a sessão os declarou (17/11/2026): o campo OPCIONAL
// `criteriosDoCard` do envelope, `[{ texto, atende }]`, que o prompt pede só quando o card tem
// critérios de aceitação lidos. Serve à linha "Critérios do card" do detalhe da revisão e a mais
// nada: não entra em gate, não muda veredito, ressalva, lacuna nem admissibilidade (quem decide o
// card na política continua sendo `cardMet` e `cardParteDestePr`). Travado em
// test/criterios-do-card.test.js, que roda a mesma revisão com e sem o campo.
//
// Fica gravado nas provas da decisão (`provas.card.criterios`, provas-da-decisao.js). É saída de
// modelo, então passa por aqui antes de ser gravada: lista curta, texto limitado e
// `atende` só booleano (o resto vira null, "não deu para dizer"). Item sem texto sai. Lista que
// não é lista, ou que fica vazia, vira null e a decisão não ganha a chave. A credencial no texto
// sai na gravação da decisão, como em todo campo dela (retirarCredenciais, credencial-no-texto.js).
// PURA.

const TETO_DE_CRITERIOS = 20;
const TETO_DO_TEXTO = 300;

function criterioDeclarado(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.texto !== 'string') return null;
  const texto = c.texto.replace(/\s+/g, ' ').trim();
  if (!texto || !texto.isWellFormed()) return null;
  return { texto: Array.from(texto).slice(0, TETO_DO_TEXTO).join(''), atende: typeof c.atende === 'boolean' ? c.atende : null };
}

function criteriosDoCard(valor) {
  if (!Array.isArray(valor)) return null;
  const lista = valor.slice(0, TETO_DE_CRITERIOS * 2).map(criterioDeclarado).filter(Boolean).slice(0, TETO_DE_CRITERIOS);
  return lista.length ? lista : null;
}

export default { criteriosDoCard, TETO_DE_CRITERIOS, TETO_DO_TEXTO };
export { criteriosDoCard, TETO_DE_CRITERIOS, TETO_DO_TEXTO };
