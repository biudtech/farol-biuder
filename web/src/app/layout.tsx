import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Aplicacao } from '@/componentes/Aplicacao';
import { SCRIPT_DO_TEMA } from '@/tema/script';
import './globals.css';

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
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT_DO_TEMA }} />
      </head>
      <body>
        <Aplicacao>{children}</Aplicacao>
      </body>
    </html>
  );
}
