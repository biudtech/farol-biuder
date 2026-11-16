// Os cabeçalhos fixos, que o next.config.ts põe em toda resposta. A CSP não está aqui: ela
// leva um nonce por pedido e por isso nasce em src/proxy.ts (a regra está em ./csp.ts).

// O front não usa nenhum recurso do aparelho: todos negados, para a própria origem e para
// qualquer quadro embutido. A lista vazia `()` é "ninguém".
const RECURSOS_NEGADOS = [
  'accelerometer', 'autoplay', 'browsing-topics', 'camera', 'display-capture', 'encrypted-media',
  'fullscreen', 'geolocation', 'gyroscope', 'hid', 'magnetometer', 'microphone', 'midi', 'payment',
  'picture-in-picture', 'publickey-credentials-get', 'screen-wake-lock', 'serial', 'usb',
  'xr-spatial-tracking',
];

export interface Cabecalho {
  key: string;
  value: string;
}

export const CABECALHOS_FIXOS: Cabecalho[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: RECURSOS_NEGADOS.map((recurso) => `${recurso}=()`).join(', ') },
];
