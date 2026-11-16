// A revisão ativa prevalece sobre a espera, sem alterar o snapshot do motor. Com uma conta
// revisora por instância, a identidade da revisão é a chave do PR.
const identidade = (pr) => String(pr.key).toLowerCase();

export function mesmaRevisao(a, b) {
  return identidade(a) === identidade(b);
}

export function filaSemRevisoesAtivas(fila, sessoes) {
  const ativos = new Set(sessoes.flatMap(s => (s.keys || []).map(key => identidade({ key }))));
  return fila.filter(pr => !ativos.has(identidade(pr)));
}

export function revisaoAtiva(pr, sessoes) {
  return filaSemRevisoesAtivas([pr], sessoes).length === 0;
}
