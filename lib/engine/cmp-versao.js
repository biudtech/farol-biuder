// Compara versões semver "a.b.c" numericamente. >0 se a>b, <0 se a<b, 0 se iguais.
// Fonte única da regra: a escolha do motor da casca (casca-motores.js) e as ferramentas de
// release (tools/release) usam a mesma, para nunca divergirem.
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export default { cmpVersion };
export { cmpVersion };
