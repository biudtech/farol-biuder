// Tema escuro por padrão, claro como alternativa. A escolha fica no localStorage deste
// navegador e vai para o atributo data-theme do <html>, que é o que o CSS lê.
import { useSyncExternalStore } from 'react';
import { CHAVE_DO_TEMA } from './script';

export type Tema = 'dark' | 'light';

const ouvintes = new Set<() => void>();

function temaAtual(): Tema {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function definirTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema;
  try { localStorage.setItem(CHAVE_DO_TEMA, tema); } catch { /* vale só até recarregar */ }
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

export function useTema(): Tema {
  return useSyncExternalStore(assinar, temaAtual, () => 'dark');
}
