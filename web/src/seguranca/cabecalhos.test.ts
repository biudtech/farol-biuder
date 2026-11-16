import { describe, expect, it } from 'vitest';
import configDoNext from '../../next.config';
import { CABECALHOS_FIXOS } from './cabecalhos';

const valor = (nome: string) => CABECALHOS_FIXOS.find((c) => c.key.toLowerCase() === nome)?.value;

describe('cabeçalhos fixos', () => {
  it('o next.config.ts os devolve para todo caminho', async () => {
    const regras = await configDoNext.headers?.();
    expect(regras).toEqual([{ source: '/:path*', headers: CABECALHOS_FIXOS }]);
  });

  it('tipo de conteúdo não é adivinhado, referência não vaza e ninguém embute a página', () => {
    expect(valor('x-content-type-options')).toBe('nosniff');
    expect(valor('referrer-policy')).toBe('no-referrer');
    expect(valor('x-frame-options')).toBe('DENY');
  });

  it('Permissions-Policy nega câmera, microfone, geolocalização e os outros recursos que o front não usa', () => {
    const politica = new Map((valor('permissions-policy') ?? '').split(',').map((d) => {
      const [recurso, lista] = d.trim().split('=');
      return [recurso as string, lista];
    }));
    for (const recurso of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture', 'browsing-topics']) {
      expect(politica.get(recurso), recurso).toBe('()');
    }
    // nenhum recurso liberado para ninguém
    for (const [recurso, lista] of politica) expect(lista, recurso).toBe('()');
  });

  it('a CSP não está entre os fixos: leva nonce por pedido e nasce no proxy', () => {
    expect(valor('content-security-policy')).toBeUndefined();
  });

  it('o front não se anuncia com X-Powered-By', () => {
    expect(configDoNext.poweredByHeader).toBe(false);
  });
});
