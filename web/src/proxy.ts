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
      // Tudo passa por aqui, menos o que nunca é página: os arquivos de /_next/static/ (com a
      // barra: fora dela o servidor responde texto puro, não HTML), o otimizador de imagem e
      // o ícone, cada um no caminho exato. O que só parece um deles (/icon.svgqualquer,
      // /_next/staticX) é um 404 em HTML e sai com CSP como qualquer página.
      //
      // Não há condição por cabeçalho. O matcher sugerido na documentação do Next deixa de
      // fora o pedido com `purpose: prefetch` e com `next-router-prefetch`, mas a página
      // pedida assim sai em HTML do mesmo jeito, e uma página pré-carregada vira a página de
      // verdade quando o navegador a ativa: ela não pode sair sem CSP.
      source: '/((?!_next/static/|_next/image$|icon\\.svg$).*)',
    },
  ],
};
