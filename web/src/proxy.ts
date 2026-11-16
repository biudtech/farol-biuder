// A CSP nasce aqui, por pedido, porque leva um nonce novo a cada resposta. O Next lê o nonce
// do cabeçalho do pedido e o põe nos scripts que ele mesmo escreve na página. Por isso toda
// página é desenhada no servidor a cada pedido (src/app/layout.tsx lê o cabeçalho).
import { NextResponse, type NextRequest } from 'next/server';
import { montarCsp } from '@/seguranca/csp';
import { enderecoDoMotor } from '@/transporte/endereco';

export function proxy(pedido: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = montarCsp({ nonce, motor: enderecoDoMotor(), dev: process.env.NODE_ENV === 'development' });

  const cabecalhos = new Headers(pedido.headers);
  cabecalhos.set('x-nonce', nonce);
  cabecalhos.set('Content-Security-Policy', csp);

  const resposta = NextResponse.next({ request: { headers: cabecalhos } });
  resposta.headers.set('Content-Security-Policy', csp);
  return resposta;
}

export const config = {
  matcher: [
    {
      // tudo menos os arquivos estáticos do build, que não são página
      source: '/((?!_next/static|_next/image|icon.svg).*)',
      // a busca antecipada do next/link não desenha página com script
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
