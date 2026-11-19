'use client';

// A tela Sistema presa à rota: o assunto aberto sai do caminho da página (`/sistema/<assunto>`).
// Mora no layout de `/sistema`, que fica montado quando só o assunto muda: o que foi digitado
// num assunto sobrevive à troca. Caminho que não é de assunto nenhum mostra a página da rota (o
// 404 do `notFound()`), e não um assunto qualquer no lugar.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { App } from '@/estado/app';
import { assuntoDoCaminho } from '@/sistema/assuntos';
import { Sistema } from './Sistema';

// `app` existe para o teste trocar a instância
export function SistemaNaRota({ children, app }: { children: ReactNode; app?: App }) {
  const caminho = usePathname();
  if (!assuntoDoCaminho(caminho)) return <>{children}</>;
  return app ? <Sistema app={app} caminho={caminho} /> : <Sistema caminho={caminho} />;
}
