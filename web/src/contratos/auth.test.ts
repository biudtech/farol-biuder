import { describe, expect, it } from 'vitest';
import { codigoBemFormado, lerPareamento, lerStatusDaAutenticacao, normalizarCodigo } from './auth';

const TOKEN = 'Zm9v-bar_'.padEnd(43, 'x');

describe('resposta de GET /api/auth/status', () => {
  it('aceita os dois booleanos que o motor manda', () => {
    expect(lerStatusDaAutenticacao({ exigida: true, autenticado: false })).toEqual({ exigida: true, autenticado: false });
  });

  it('recusa forma errada', () => {
    for (const torto of [null, [], 'ok', {}, { exigida: 'sim', autenticado: false }, { exigida: true }]) {
      expect(lerStatusDaAutenticacao(torto)).toBeNull();
    }
  });
});

describe('resposta de POST /api/auth/pair', () => {
  it('aceita o token na forma que o motor emite', () => {
    expect(lerPareamento({ ok: true, token: TOKEN })).toEqual({ ok: true, token: TOKEN });
  });

  it('aceita a recusa única', () => {
    expect(lerPareamento({ ok: false, code: 'codigo_invalido' })).toEqual({ ok: false, code: 'codigo_invalido' });
  });

  it('recusa o resto: token torto, recusa com outro código, corpo torto', () => {
    const tortos = [null, [], {}, { ok: true }, { ok: true, token: 'curto' }, { ok: true, token: 12 }, { ok: false }, { ok: false, code: 'bloqueado' }, { ok: 'true', token: TOKEN }];
    for (const torto of tortos) expect(lerPareamento(torto)).toBeNull();
  });
});

// O motor normaliza assim antes de conferir (lib/local-auth/pareamento.js): maiúsculas, sem
// espaço e sem hífen. O código tem 10 caracteres do base32 da RFC 4648 (A a Z e 2 a 7).
describe('código de pareamento', () => {
  it('normaliza como o motor: maiúsculas, sem espaço e sem hífen', () => {
    expect(normalizarCodigo('  abcde-23456 ')).toBe('ABCDE23456');
    expect(normalizarCodigo('ab cd-e2 34-56')).toBe('ABCDE23456');
    expect(normalizarCodigo('ABCDE\t23456\n')).toBe('ABCDE23456');
    expect(normalizarCodigo('')).toBe('');
  });

  it('aceita só 10 caracteres de A a Z e de 2 a 7', () => {
    expect(codigoBemFormado('ABCDE23456')).toBe(true);
    expect(codigoBemFormado('ZZZZZ77777')).toBe(true);
    for (const torto of ['', 'ABCDE2345', 'ABCDE234567', 'ABCDE01234', 'ABCDE89234', 'abcde23456', 'ABCDE_2345', 'ABCDE 2345', 'ÁBCDE23456']) {
      expect(codigoBemFormado(torto), torto).toBe(false);
    }
  });
});
