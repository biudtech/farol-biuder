// Os contratos da autenticação do motor (lib/local-auth/acesso.js). Cada leitor recebe o corpo
// cru e devolve o tipo conferido, ou null quando a forma não é a esperada.
import { tokenValido } from '@/transporte/token';
import { ehBooleano, ehObjeto } from './formas';

// GET /api/auth/status
export interface StatusDaAutenticacao {
  exigida: boolean;
  autenticado: boolean;
}

export function lerStatusDaAutenticacao(bruto: unknown): StatusDaAutenticacao | null {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.exigida) || !ehBooleano(bruto.autenticado)) return null;
  return { exigida: bruto.exigida, autenticado: bruto.autenticado };
}

// POST /api/auth/pair: o token no corpo, ou a recusa única. O motor não diz o motivo nem
// quantas tentativas restam, de propósito.
export type RespostaDoPareamento =
  | { ok: true; token: string }
  | { ok: false; code: 'codigo_invalido' };

export function lerPareamento(bruto: unknown): RespostaDoPareamento | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.ok === true && tokenValido(bruto.token)) return { ok: true, token: bruto.token };
  if (bruto.ok === false && bruto.code === 'codigo_invalido') return { ok: false, code: 'codigo_invalido' };
  return null;
}

// O código de pareamento (lib/local-auth/pareamento.js e LOCAL_AUTH.CODIGO_TAMANHO, na raiz):
// 10 caracteres do base32 da RFC 4648, A a Z e 2 a 7. O motor normaliza antes de conferir
// (maiúsculas, sem espaço e sem hífen), e a tela faz o mesmo para conferir a forma antes do
// POST: tentativa errada conta contra o código pendente, e a quinta o queima.
export const TAMANHO_DO_CODIGO = 10;
const CODIGO = /^[A-Z2-7]{10}$/;

export function normalizarCodigo(texto: string): string {
  return texto.toUpperCase().replace(/[\s-]/g, '');
}

export function codigoBemFormado(codigo: string): boolean {
  return CODIGO.test(codigo);
}
