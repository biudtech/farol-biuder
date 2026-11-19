// O Jira na tela Sistema, sem React: os últimos cards lidos de cada site e o que a troca da
// credencial manda.
//
// Os últimos cards saem das decisões resolvidas do snapshot (`decisions.resolved`, as 30 mais
// recentes, cada uma com o `card` que a sessão leu): o motor não guarda um registro de leitura
// por site. A tela liga o card ao site pela organização do PR (`owners` do site) e pela chave
// do projeto (`projectKeys`), como o motor escolhe o site (lib/engine/jira.js, na raiz).
import { ehNumero, ehObjeto, ehTexto } from '@/contratos/formas';
import { lerCard } from '@/contratos/radar';
import type { SiteDoJira } from '@/contratos/sistema';

export const ROTA_DA_CREDENCIAL_DO_JIRA = '/api/jira/credential';
export const TETO_DE_CARDS = 5;

export interface CardLido {
  card: string;
  // quando a revisão que o leu foi resolvida
  em?: number;
}

function orgDaChave(chave: unknown): string {
  return ehTexto(chave) ? (chave.split('/')[0] ?? '').toLowerCase() : '';
}

function projetoDoCard(card: string): string {
  return card.split('-')[0]?.toUpperCase() ?? '';
}

// Os cards mais recentes lidos nos PRs deste site, um por card, do mais novo para o mais
// antigo. Item torto das decisões (sem card, chave que não é texto) fica de fora.
export function ultimosCardsLidos(resolvidas: readonly unknown[] | undefined, site: SiteDoJira, teto = TETO_DE_CARDS): CardLido[] {
  const owners = site.owners.map((o) => o.toLowerCase());
  const projetos = site.projectKeys.map((p) => p.toUpperCase());
  const vistos = new Map<string, CardLido>();
  for (const item of resolvidas ?? []) {
    if (!ehObjeto(item)) continue;
    const card = lerCard(item.card);
    if (!card) continue;
    if (owners.length && !owners.includes(orgDaChave(item.key))) continue;
    if (projetos.length && !projetos.includes(projetoDoCard(card))) continue;
    const em = ehNumero(item.resolvedAt) ? item.resolvedAt : undefined;
    const antes = vistos.get(card);
    if (!antes || (em ?? 0) > (antes.em ?? 0)) vistos.set(card, em === undefined ? { card } : { card, em });
  }
  return [...vistos.values()].sort((a, b) => (b.em ?? 0) - (a.em ?? 0)).slice(0, teto);
}

// O e-mail da conta do Atlassian, como o motor exige: não vazio. A forma completa quem confere é
// o Jira, no teste.
export function erroDaCredencial(email: string, temToken: boolean): string | null {
  if (!email.trim() || !email.includes('@')) return 'Informe o e-mail da conta do Atlassian dona do token.';
  if (!temToken) return 'Cole o token de API do Atlassian.';
  return null;
}

// O corpo de POST /api/jira/credential. É montado na hora do envio e não fica guardado.
export function corpoDaCredencial(siteId: string, email: string, token: string): { siteId: string; email: string; token: string } {
  return { siteId, email: email.trim(), token: token.trim() };
}
