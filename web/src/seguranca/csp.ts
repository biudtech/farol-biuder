// A Content-Security-Policy do front, montada por pedido em src/proxy.ts.
//
// Script e estilo só entram da própria origem e com o nonce do pedido: o App Router escreve
// scripts em linha para hidratar a página, e o nonce é o que os libera sem 'unsafe-inline'.
// O navegador só fala com a própria origem e com o motor (connect-src).

export interface OpcoesDaCsp {
  nonce: string;
  // a origem do motor, já saneada por enderecoDoMotor; vazia quando não está configurada
  motor: string;
  dev: boolean;
}

const NONCE_VALIDO = /^[A-Za-z0-9+/=_-]+$/;

export function montarCsp({ nonce, motor, dev }: OpcoesDaCsp): string {
  if (!NONCE_VALIDO.test(nonce)) throw new Error('nonce fora do alfabeto de base64');
  const fonte = `'nonce-${nonce}'`;
  // Só no servidor de desenvolvimento (`next dev`): o React usa eval para remontar a pilha de
  // erro, e as ferramentas de desenvolvimento do Next aplicam estilo em linha sem nonce
  // (medido: só com o nonce, o console acusa a violação a cada carga). Em style-src o
  // 'unsafe-inline' entra no lugar do nonce, porque ao lado de um nonce o navegador o ignora.
  const script = ["'self'", fonte, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])];
  const estilo = dev ? ["'self'", "'unsafe-inline'"] : ["'self'", fonte];
  const diretivas = [
    ['default-src', "'self'"],
    ['script-src', ...script],
    ['style-src', ...estilo],
    ['img-src', "'self'", 'data:'],
    ['font-src', "'self'"],
    ['connect-src', "'self'", ...(motor ? [motor] : [])],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    // com o motor em http (desenvolvimento local), subir o pedido para https o quebraria
    ...(!dev && motor.startsWith('https://') ? [['upgrade-insecure-requests']] : []),
  ];
  return diretivas.map((d) => d.join(' ')).join('; ');
}
