// A forma canônica do PR (`owner/repo#N` em minúsculas): a identidade única de fila, label e
// registro de consumo. Sem estado, sem IO, sem rede.
const PR_KEY_RE = /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/;

function canonicalPrKey(key) {
  const m = PR_KEY_RE.exec(String(key || '').trim());
  if (!m) return '';
  return `${m[1].toLowerCase()}/${m[2].toLowerCase()}#${Number(m[3])}`;
}

export default { canonicalPrKey };
export { canonicalPrKey };
