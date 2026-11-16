import path from 'node:path';
import type { NextConfig } from 'next';
import { ABA_INICIAL } from './src/navegacao/abas';

// Cabeçalhos fixos, em toda resposta. A CSP não está aqui: ela leva um nonce por pedido e
// por isso nasce em src/proxy.ts (a regra está em src/seguranca/csp.ts).
const CABECALHOS_FIXOS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // O `next dev` escreveria um AGENTS.md nesta pasta. O que ele diz está no README, em
  // "Convenções para os próximos lotes".
  agentRules: false,
  // O repositório tem dois package-lock (o do motor, na raiz, e este): sem isto o Next
  // adivinha a raiz pelo de cima.
  turbopack: { root: path.resolve(__dirname) },
  // A raiz não tem tela: leva à primeira aba.
  async redirects() {
    return [{ source: '/', destination: ABA_INICIAL, permanent: false }];
  },
  async headers() {
    return [{ source: '/:path*', headers: CABECALHOS_FIXOS }];
  },
};

export default config;
