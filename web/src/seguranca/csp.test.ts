import { describe, expect, it } from 'vitest';
import { montarCsp } from './csp';

function diretivas(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [nome, ...valores] = d.split(/\s+/);
    return [nome as string, valores];
  }));
}

describe('CSP do front', () => {
  const texto = montarCsp({ nonce: 'abc123', motor: 'https://farol.exemplo.com', dev: false });
  const producao = diretivas(texto);

  it('em produção não tem unsafe-eval, unsafe-inline nem curinga', () => {
    expect(texto).not.toContain('unsafe-eval');
    expect(texto).not.toContain('unsafe-inline');
    expect(texto).not.toContain('*');
  });

  it('script e estilo só da própria origem e com o nonce do pedido', () => {
    expect(producao.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(producao.get('style-src')).toEqual(["'self'", "'nonce-abc123'"]);
    expect(producao.get('default-src')).toEqual(["'self'"]);
  });

  it('connect-src é a própria origem e o motor, e mais nada', () => {
    expect(producao.get('connect-src')).toEqual(["'self'", 'https://farol.exemplo.com']);
  });

  it('ninguém embute a página, e não há plugin, base de fora nem formulário para fora', () => {
    expect(producao.get('frame-ancestors')).toEqual(["'none'"]);
    expect(producao.get('object-src')).toEqual(["'none'"]);
    expect(producao.get('base-uri')).toEqual(["'self'"]);
    expect(producao.get('form-action')).toEqual(["'self'"]);
  });

  it('sem endereço do motor, connect-src fica só na própria origem', () => {
    expect(diretivas(montarCsp({ nonce: 'n', motor: '', dev: false })).get('connect-src')).toEqual(["'self'"]);
  });

  it('só sobe pedido inseguro para https quando o motor é https', () => {
    expect(producao.has('upgrade-insecure-requests')).toBe(true);
    const local = diretivas(montarCsp({ nonce: 'n', motor: 'http://127.0.0.1:47170', dev: false }));
    expect(local.has('upgrade-insecure-requests')).toBe(false);
  });

  it('em desenvolvimento libera o que o servidor de desenvolvimento do Next exige, e só nele', () => {
    const dev = diretivas(montarCsp({ nonce: 'n', motor: 'http://127.0.0.1:47170', dev: true }));
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.has('upgrade-insecure-requests')).toBe(false);
  });

  it('nonce fora do alfabeto de base64 não entra no cabeçalho', () => {
    expect(() => montarCsp({ nonce: "x'; script-src *", motor: '', dev: false })).toThrow();
  });
});
