import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';

// O que o matcher casa passa pelo proxy e sai com CSP. A regra: só fica de fora o que nunca é
// página. Tudo o que pode virar HTML (inclusive o 404 de um caminho parecido com arquivo
// estático) tem de casar. Conferido com a função do próprio Next, que compila o matcher como
// o servidor compila.
const casa = (url: string, headers: Record<string, string> = {}) => unstable_doesMiddlewareMatch({ config, url, headers });

describe('matcher do proxy', () => {
  it.each([
    '/', '/radar', '/historico', '/time', '/consumo', '/sistema', '/naoexiste', '/radar/qualquer',
    // parecem arquivo estático e não são: respondem o 404 em HTML
    '/icon.svgqualquer', '/icon.svg/x', '/iconXsvg', '/icon-svg', '/radar/icon.svg',
    '/_next/staticX', '/_next/static', '/_next/imageX', '/_next/image/x', '/_next', '/_next/outro',
    '/_nextstatic/a.js', '/x/_next/static/a.js',
  ])('%s passa pelo proxy', (url) => {
    expect(casa(url)).toBe(true);
  });

  it.each([
    '/_next/static/chunks/a.js', '/_next/static/css/b.css', '/_next/static/media/c.woff2',
    '/_next/image', '/_next/image?url=%2Fa.png&w=64&q=75', '/icon.svg', '/icon.svg?abc123',
  ])('%s é arquivo do build e fica de fora', (url) => {
    expect(casa(url)).toBe(false);
  });

  // Uma página pedida por pré-carregamento vira a página de verdade quando o navegador a
  // ativa: se saísse sem CSP, a navegação inteira ficaria sem CSP.
  it.each<Record<string, string>>([
    { purpose: 'prefetch' },
    { 'sec-purpose': 'prefetch' },
    { 'sec-purpose': 'prefetch;prerender' },
    { 'next-router-prefetch': '1' },
    { rsc: '1', 'next-router-prefetch': '1' },
  ])('pedido de pré-carregamento (%o) também passa pelo proxy', (headers) => {
    expect(casa('/radar', headers)).toBe(true);
    expect(casa('/naoexiste', headers)).toBe(true);
  });

  it('o matcher não tem condição por cabeçalho nem por cookie', () => {
    for (const regra of config.matcher) {
      expect(Object.keys(regra)).toEqual(['source']);
    }
  });
});

describe('proxy', () => {
  it('põe a CSP na resposta e no pedido, com um nonce novo a cada pedido', () => {
    const nonces = [1, 2].map(() => {
      const resposta = proxy(new NextRequest('http://localhost:3100/radar'));
      const csp = resposta.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      // o Next lê o nonce do cabeçalho do PEDIDO que segue para a página
      expect(resposta.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
      expect(resposta.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
      return nonce;
    });
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});
