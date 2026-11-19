import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerCancelamentoDoLogin, lerFimDoLogin, lerInicioDoLogin } from '@/contratos/sistema';
import { ROTA_DO_CODIGO_DO_LOGIN, ROTA_DO_FIM_DO_LOGIN, ROTA_DO_INICIO_DO_LOGIN, entraPorLogin, fraseDaRecusaDoLogin } from './login-web';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

describe('o login da assinatura pela tela', () => {
  it('as rotas são as do motor, e estão no inventário', () => {
    const servidor = raiz('lib/http-server.js');
    const inventario = raiz('lib/local-auth/inventario.js');
    for (const rota of [ROTA_DO_INICIO_DO_LOGIN, ROTA_DO_CODIGO_DO_LOGIN, ROTA_DO_FIM_DO_LOGIN]) {
      expect(servidor).toContain(`p === '${rota}'`);
      expect(inventario).toContain(`'${rota}'`);
    }
    // o motor lê o perfil, o login e o código destes nomes
    expect(servidor).toContain("loginWeb.iniciar(engine, String(body.profileId || ''))");
    expect(servidor).toContain("loginWeb.enviarCodigo(engine, String(body.loginId || ''), body.code)");
    expect(servidor).toContain("loginWeb.cancelar(engine, String(body.loginId || ''), String(body.profileId || ''))");
  });

  it('só o perfil de assinatura entra por login', () => {
    expect(entraPorLogin('dir')).toBe(true);
    expect(entraPorLogin('apikey')).toBe(false);
    expect(entraPorLogin(undefined)).toBe(false);
  });

  it('o início: id e endereço https, ou a recusa com o perfil do login aberto', () => {
    expect(lerInicioDoLogin({ ok: true, loginId: 'l1', url: 'https://claude.com/cai/oauth/authorize?code=true&x=1' })).toEqual({ ok: true, loginId: 'l1', url: 'https://claude.com/cai/oauth/authorize?code=true&x=1' });
    expect(lerInicioDoLogin({ ok: true, loginId: 'l1', url: 'javascript:alert(1)' })).toBeNull();
    expect(lerInicioDoLogin({ ok: true, loginId: 'l1', url: 'http://claude.com/x' })).toBeNull();
    expect(lerInicioDoLogin({ ok: true, url: 'https://claude.com/x' })).toBeNull();
    expect(lerInicioDoLogin({ ok: false, code: 'login-em-curso', perfilAberto: 'outro', motivo: 'já há um login' })).toEqual({ ok: false, code: 'login-em-curso', perfilAberto: 'outro', motivo: 'já há um login' });
    expect(lerInicioDoLogin({ ok: false, code: 3 })).toEqual({ ok: false });
    expect(lerInicioDoLogin('x')).toBeNull();
  });

  it('o fim e o cancelamento', () => {
    expect(lerFimDoLogin({ ok: true })).toEqual({ ok: true });
    expect(lerFimDoLogin({ ok: false, code: 'recusado', motivo: 'Login failed' })).toEqual({ ok: false, code: 'recusado', motivo: 'Login failed' });
    expect(lerFimDoLogin({})).toBeNull();
    expect(lerCancelamentoDoLogin({ ok: true })).toEqual({ ok: true });
    expect(lerCancelamentoDoLogin({ ok: false })).toBeNull();
  });

  it('a frase de cada recusa', () => {
    expect(fraseDaRecusaDoLogin('recusado', 'Login failed: 400')).toBe('O Claude Code não aceitou o código: comece de novo e cole o código da página nova. O motor disse: Login failed: 400.');
    expect(fraseDaRecusaDoLogin('novo', 'algo')).toBe('O motor recusou: algo.');
    expect(fraseDaRecusaDoLogin(undefined, undefined)).toBe('O motor recusou o login e não disse o motivo.');
  });
});
