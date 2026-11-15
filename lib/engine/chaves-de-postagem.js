// Hash e id puros que a revisão e a postagem usam para identificar conta e PR. Sem
// estado, sem IO, sem rede. A forma canônica do PR (`owner/repo#N` em minúsculas) é a
// identidade única de fila, label e registro de consumo.
import { createHash, randomUUID } from 'node:crypto';

const PR_KEY_RE = /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/;

function sha256Hex(texto) {
  return createHash('sha256').update(String(texto)).digest('hex');
}

function accountHash(login) {
  return sha256Hex('acct:' + String(login || '').trim().toLowerCase());
}

function canonicalPrKey(key) {
  const m = PR_KEY_RE.exec(String(key || '').trim());
  if (!m) return '';
  return `${m[1].toLowerCase()}/${m[2].toLowerCase()}#${Number(m[3])}`;
}

function prHash(key) {
  const canonica = canonicalPrKey(key);
  return canonica ? sha256Hex('pr:' + canonica) : '';
}

function novoId() {
  return randomUUID();
}

export default { sha256Hex, accountHash, canonicalPrKey, prHash, novoId };
export { sha256Hex, accountHash, canonicalPrKey, prHash, novoId };
