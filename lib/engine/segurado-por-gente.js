// O registro de "o motor segurou o automático por decisão de gente" (redesenho de 19/11/2026).
//
// Até aqui a decisão de segurar só deixava rastro no toast, numa linha do log e na memória de
// aviso (`historicoAvisado`, que guarda só a chave e o head). A tela "De fora da fila"
// (lib/engine/de-fora.js) precisa dizer quem decidiu, com que estado e quando, e por isso a
// decisão passa a ser gravada aqui, nos mesmos pontos em que o motor já decide segurar:
// `bloqueiaAutomatico` (skip-review.js), a recusa na boca da sessão (review.js), o Revisar
// tudo (lote.js) e o pedido retirado (pedido-de-revisao.js). Nada aqui decide: é só registro.
//
// `engine.seguradoPorGente`: Map key -> { head, motivo, decisivos: [{ quem, estado, em }], desde }.
// `motivo` é `decisao_de_gente` ou `pedido_retirado`; `desde` é a primeira vez que o motor
// segurou por aquele motivo naquele head (o ciclo seguinte que segura de novo não mexe nele).
// Memória de propósito: o reinício zera, e o próximo ciclo que segura grava de novo. Some
// quando o motor deixa de segurar o PR (o gate respondeu que segue) e quando o PR sai do
// panorama (podado junto com a memória de aviso). Sem IO e sem log.

function mapa(engine) {
  if (!(engine.seguradoPorGente instanceof Map)) engine.seguradoPorGente = new Map();
  return engine.seguradoPorGente;
}

function gravarSegurado(engine, pr, { motivo, head = '', decisivos = [] } = {}, agora = Date.now()) {
  if (!pr || !pr.key || !motivo) return;
  const m = mapa(engine);
  const antes = m.get(pr.key);
  const h = String(head || '');
  const mesmo = antes && antes.motivo === motivo && antes.head === h;
  m.set(pr.key, {
    head: h,
    motivo,
    decisivos: (decisivos || []).map(d => ({ quem: String(d.quem || ''), estado: String(d.state || d.estado || ''), em: String(d.em || '') })),
    desde: mesmo ? antes.desde : agora,
  });
}

// Devolve false de propósito: quem solta é o caminho em que o gate respondeu "segue".
function soltarSegurado(engine, key) {
  if (engine.seguradoPorGente instanceof Map) engine.seguradoPorGente.delete(key);
  return false;
}

function podarSegurados(engine, abertos) {
  if (!(engine.seguradoPorGente instanceof Map)) return;
  for (const key of [...engine.seguradoPorGente.keys()]) if (!abertos.has(key)) engine.seguradoPorGente.delete(key);
}

export { gravarSegurado, soltarSegurado, podarSegurados };
