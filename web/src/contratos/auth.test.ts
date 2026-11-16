import { describe, expect, it } from 'vitest';
import { lerPareamento, lerStatusDaAutenticacao } from './auth';

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
