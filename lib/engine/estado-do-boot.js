// O que o engine LE do disco no boot, nos formatos que cada arquivo ja teve. PURO.
//
// Saiu do server.js em 30/09/2026 pelo mesmo motivo dos outros dois modulos extraidos
// nesta semana: o arquivo esta acima do teto de tamanho e o ratchet passou a medir
// crescimento, entao codigo novo nao entra sem abrir espaco. E o assunto se sustenta
// sozinho: ler estado gravado por uma versao anterior sem que o boot precise saber
// quantos formatos ja existiram.

// keys do arquivo de estacionamento, nos dois formatos que ele já teve (lista crua até
// a v2.57.3; `{ keys, motivos }` desde a v2.57.4). Qualquer outra forma é vazio.
function chavesEstacionadas(salvo) {
  let lista = [];
  if (Array.isArray(salvo)) lista = salvo;
  else if (salvo && Array.isArray(salvo.keys)) lista = salvo.keys;
  return lista.filter(k => typeof k === 'string');
}

// O estacionamento como o boot o lê: as keys e o motivo de cada uma (só de key que está na
// lista: motivo órfão é lixo de migração e não sobrevive ao boot).
//
// PR estacionado por orçamento não entra. O teto de gasto saiu em 16/11/2026 e nada mais
// estaciona por esse motivo; sem este corte, o que parou por ele num estado gravado antes
// ficaria fora da fila automática para sempre, por uma regra que não existe mais. As keys
// soltas voltam em `soltos`, para o boot registrar e regravar o arquivo uma vez.
function estacionamentoDoBoot(salvo) {
  const salvos = (salvo && !Array.isArray(salvo) && salvo.motivos && typeof salvo.motivos === 'object') ? salvo.motivos : {};
  const keys = [];
  const motivos = {};
  const soltos = [];
  for (const k of chavesEstacionadas(salvo)) {
    const m = salvos[k] && typeof salvos[k] === 'object' ? salvos[k] : null;
    if (m && m.tipo === 'orcamento') { soltos.push(k); continue; }
    keys.push(k);
    if (m) motivos[k] = m;
  }
  return { keys, motivos, soltos };
}

// FIX 3 (v2.53.1): a metade que o recoverInflight aplica na âncora de re-revisão
// de um PR que estava inflight no reinício. Âncora OBJETO ({head,dia,rodadas})
// só libera o head (fica ''), preservando dia/rodadas, pra o teto diário não
// zerar por causa de um reinício; âncora STRING legada devolve undefined (não
// há contador a preservar, então o chamador apaga como sempre). Função pura,
// extraída pra manter a profundidade de chaves do método baixa.
function ancoraAposReinicio(v) {
  if (v && typeof v === 'object') return { ...v, head: '' };
  return undefined;
}

const estadoDoBootMod = { chavesEstacionadas, estacionamentoDoBoot, ancoraAposReinicio };
export default estadoDoBootMod;
export { chavesEstacionadas, estacionamentoDoBoot, ancoraAposReinicio };
