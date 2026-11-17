import type { Metadata, Viewport } from 'next';
import { Mulish } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Aplicacao } from '@/componentes/Aplicacao';
import { SCRIPT_DO_TEMA } from '@/tema/script';
import './globals.css';

// A fonte da BIUD, auto-hospedada: o next/font baixa a Mulish no build e serve o arquivo pelo
// próprio front, sem pedido ao Google em tempo de execução (font-src 'self' na CSP).
const mulish = Mulish({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--fonte-mulish',
});

export const metadata: Metadata = {
  title: { default: 'Farol', template: '%s · Farol' },
  description: 'Revisor autônomo de pull requests da BIUD',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function Raiz({ children }: { children: ReactNode }) {
  // Ler o cabeçalho torna a página dinâmica, que é o que o nonce da CSP exige (src/proxy.ts).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // O script do tema troca o data-theme antes da hidratação: a diferença é esperada.
    <html lang="pt-BR" data-theme="light" className={mulish.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT_DO_TEMA }} />
      </head>
      <body>
        <Aplicacao>{children}</Aplicacao>
      </body>
    </html>
  );
}
