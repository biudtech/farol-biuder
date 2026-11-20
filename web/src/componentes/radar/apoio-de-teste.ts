// Apoio dos testes dos blocos do Radar: um controle de ações de mentira e os itens mínimos
// que o motor emite. Não entra na tela.
import { vi } from 'vitest';
import type { Pendencia } from '@/contratos/radar';
import type { Acao } from '@/radar/acoes';
import type { ControleDeAcoes, ResultadoDaAcao } from './useAcoes';

export const URL_DO_PR = 'https://github.com/dono/repo/pull/12';

// `noAr`: alvo para o id da ação que o teste quer ver "enviando"; `resultados`: o resultado que
// o teste quer ver no lugar da ação.
export function controleFalso(noAr: Record<string, string> = {}, resultados: Record<string, ResultadoDaAcao> = {}) {
  const disparar = vi.fn(async (acao: Acao) => { void acao; return true; });
  const focarResultado = vi.fn();
  const controle: ControleDeAcoes = { emCurso: (alvo) => noAr[alvo] ?? null, resultadoDe: (alvo) => resultados[alvo] ?? null, disparar, focarResultado };
  return { controle, disparar, focarResultado };
}

export function pendencia(extra: Partial<Pendencia> = {}): Pendencia {
  return {
    id: 'd1',
    key: 'dono/repo#12',
    verdict: 'approve',
    pr: { repo: 'dono/repo', number: 12, url: URL_DO_PR, title: 'Corrige o cálculo', author: 'ana' },
    reportMarkdown: '## Review\n\nTudo certo.',
    reasons: [],
    attention: [],
    ...extra,
  };
}

export const nomes = (botoes: HTMLElement[]): string[] => botoes.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
