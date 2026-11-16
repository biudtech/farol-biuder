// Apoio dos testes do Histórico: a navegação do Next de mentira e os itens que o motor emite.
// Não entra na tela.
//
// A tela lê o endereço por useSearchParams e escreve pela History API, que o Next integra ao
// roteador. Aqui o endereço é o do jsdom: pushState e replaceState avisam quem lê, como o Next
// faz, e o `popstate` também (é o voltar do navegador).
import { useMemo, useSyncExternalStore } from 'react';

const ouvintes = new Set<() => void>();
const avisar = (): void => { for (const ouvinte of [...ouvintes]) ouvinte(); };
let instalada = false;

function instalar(): void {
  if (instalada) return;
  instalada = true;
  const { pushState, replaceState } = window.history;
  window.history.pushState = function empilhar(...args: Parameters<History['pushState']>) {
    pushState.apply(window.history, args);
    avisar();
  };
  window.history.replaceState = function trocar(...args: Parameters<History['replaceState']>) {
    replaceState.apply(window.history, args);
    avisar();
  };
  window.addEventListener('popstate', avisar);
}

function assinar(ouvinte: () => void): () => void {
  instalar();
  ouvintes.add(ouvinte);
  return () => { ouvintes.delete(ouvinte); };
}

// O que o teste põe no lugar de `next/navigation`.
export const navegacaoDeMentira = {
  usePathname: (): string => useSyncExternalStore(assinar, () => window.location.pathname),
  useSearchParams: (): URLSearchParams => {
    const busca = useSyncExternalStore(assinar, () => window.location.search);
    return useMemo(() => new URLSearchParams(busca), [busca]);
  },
};

// O voltar do navegador, visto pela página: o endereço muda e chega um `popstate`.
export function voltarPara(url: string): void {
  instalar();
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export const URL_DO_PR = 'https://github.com/dono/repo/pull/12';

// Uma revisão resolvida, como decisionForUi (lib/engine/public-review.js) a emite.
export function revisaoDoMotor(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `d${n}`,
    key: `dono/repo#${n}`,
    createdAt: Date.UTC(2026, 10, 16, 14, 30),
    resolvedAt: Date.UTC(2026, 10, 16, 14, 32),
    status: 'auto_approved',
    action: 'approve',
    verdict: 'approve',
    card: `BT-${n}`,
    pr: { repo: 'dono/repo', number: n, url: `https://github.com/dono/repo/pull/${n}`, title: `Título do PR ${n}`, author: 'ana' },
    technical: { state: 'pass', message: 'Critérios técnicos comprovados.' },
    reportMarkdown: `## Review ${n}\n\nTudo **certo**.`,
    reasons: [],
    attention: [],
    ...extra,
  };
}

// A resposta 200 de GET /api/decisions.
export function paginaDoMotor(itens: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, page: 1, pageSize: 30, total: itens.length, pages: itens.length ? 1 : 0, items: itens, repos: ['dono/outro', 'dono/repo'], ...extra };
}
