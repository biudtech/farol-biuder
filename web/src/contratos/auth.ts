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
