// Validações compartilhadas do contexto de revisão. Texto do repositório continua sendo dado não confiável.
import crypto from 'node:crypto';
import { safeStringify } from '../io.js';
import { mascararSegredos } from '../engine/falhas.js';

const SHA = /^[a-f0-9]{40}$/;
const digest = value => crypto.createHash('sha256').update(safeStringify(value)).digest('hex');
function check(ok, message) { if (!ok) throw new Error(message); }

function sourceRef(raw) {
  const p = raw?.path;
  check(typeof p === 'string' && p.length <= 400 && !/[\x00-\x1f\\]/.test(p)
    && p.split('/').every(s => s && s !== '.' && s !== '..'), 'Caminho de fonte inválido.');
  check(!/(^|\/)(?:\.env[^/]*|\.git|\.ssh|\.aws|\.codex|node_modules|credentials?[^/]*|secrets?[^/]*|id_rsa)(\/|$)/i.test(p)
    && !/\.(?:key|pem|p12|pfx|kdbx)$/i.test(p), 'Fonte sensível não pode entrar no especialista.');
  check(Number.isInteger(raw.start) && raw.start >= 1 && Number.isInteger(raw.end)
    && raw.end >= raw.start && raw.end - raw.start < 20, 'Selecione de 1 a 20 linhas por evidência.');
  return { path: p, start: raw.start, end: raw.end };
}

function safeText(value, max, label) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} inválido ou acima do limite (${max}).`);
  check(mascararSegredos(value) === value && !/(?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*["']?[^\s"']{6,}/i.test(value)
    && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    && !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)
    && !/(?:[A-Z]:\\Users\\|\/(?:Users|home)\/)/i.test(value), `${label} contém possível credencial ou dado pessoal. Remova antes de continuar.`);
  return value.trim();
}
export { SHA, digest, check, sourceRef, safeText };
