// Os rótulos do Histórico: a tabela única que traduz o que o motor grava numa revisão
// resolvida. A tela só escreve: `status`, `action` e `verdict` chegam prontos. Valor que esta
// tabela não conhece aparece cru, em vez de sumir ou de quebrar a linha.
//
// De onde vem cada valor (arquivos na raiz do repositório):
// - `status`: quem resolve a revisão grava um destes, em lib/engine/decision.js,
//   desfecho-da-revisao.js, desfecho-automatico.js (o mapa STATUS), desfecho-sem-mesa.js,
//   espera-ci.js, espera-pr-proprio.js, espera-prova-decidida.js e postagem-recusada.js. `pending` não é
//   de item resolvido: é a pendência da mesa, que só chega aqui pelo detalhe por chave
//   (GET /api/decision);
// - `action`: os quatro valores de `VEREDITOS` em lib/engine/historico-paginado.js, que são
//   também os do filtro `veredito`.
// O que o teste ao lado garante, e só isto: ele varre lib/engine/*.js, pega todo arquivo que
// chama resolveIntoHistory ou recordDecision e reprova se um literal escrito num `status:`
// (ou `const status =`) desses arquivos, ou no mapa STATUS, não tiver rótulo aqui. Status
// montado de outro jeito (vindo de variável de outro arquivo, por exemplo) escapa da
// varredura, e na tela aparece cru.

function proprio(mapa: Record<string, string>, chave: string | undefined): string | undefined {
  return chave !== undefined && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

// Como a revisão foi resolvida.
export const ROTULO_DO_STATUS: Record<string, string> = {
  auto_approved: 'Publicado automaticamente',
  auto_rejected: 'Publicado automaticamente',
  commented_own_pr: 'Publicado automaticamente, como comentário (PR da própria conta)',
  commented_inconclusive: 'Publicado automaticamente, como comentário neutro (a revisão não chegou a uma conclusão segura)',
  not_posted: 'Encerrado sem publicar: um portão de postagem recusou, ou o PR saiu do automático',
  posted: 'Publicado por você',
  already_reviewed: 'Já havia review seu no PR: nada foi publicado de novo',
  approval_not_needed: 'Outra pessoa já decidiu o commit: a publicação automática não foi necessária',
  already_merged: 'PR já mesclado: a revisão pendente foi cancelada',
  already_closed: 'PR fechado sem merge: a revisão pendente foi cancelada',
  skipped: 'Pulado na mesa',
  superseded: 'Substituído por rodada nova',
  pending: 'O motor ainda não postou nada desta revisão',
};

export function textoDoStatus(status: string | undefined): string {
  return proprio(ROTULO_DO_STATUS, status) ?? status ?? 'Sem registro de como foi resolvida';
}

// O que foi publicado no PR. Em `already_reviewed` é o review que já estava lá.
export const ROTULO_DA_ACAO: Record<string, string> = {
  approve: 'Aprovação',
  request_changes: 'Pedido de mudanças',
  comment: 'Comentário',
  skip: 'Nada publicado',
};

// O que o motor conta como publicado (PUBLICADOS, lib/engine/historico-paginado.js). Todo o
// resto, inclusive `action` ausente ou de valor desconhecido, ele trata como não publicado
// (é o que o filtro "Não publicados" traz), e a tela segue a mesma régua.
export const PUBLICADOS: readonly string[] = ['approve', 'request_changes', 'comment'];

export function foiPublicado(action: string | undefined): boolean {
  return action !== undefined && PUBLICADOS.includes(action);
}

// O campo "Publicado" de uma revisão. A pendência da mesa ainda não publicou nada, qualquer
// que seja o `action` dela. Valor que a tabela não conhece aparece cru, sem contar como
// publicado.
export function textoDoPublicado(revisao: { action?: string; status?: string }): string {
  if (revisao.status === 'pending') return 'Nada publicado ainda';
  const { action } = revisao;
  if (foiPublicado(action)) return proprio(ROTULO_DA_ACAO, action) ?? (action as string);
  if (action === undefined || action === 'skip') return ROTULO_DA_ACAO.skip as string;
  return `${ROTULO_DA_ACAO.skip} (o motor registrou "${action}")`;
}

const PARECER: Record<string, string> = {
  approve: 'aprovar',
  request_changes: 'pedir mudanças',
};

// O parecer da sessão (`verdict`), só quando ele difere do que foi publicado: parecer de
// aprovar que saiu como pedido de mudanças, ou que nem foi publicado. Vazio quando coincide
// ou quando o motor não mandou parecer.
export function parecerQueDifere(revisao: { verdict?: string; action?: string }): string {
  if (revisao.verdict === undefined || revisao.verdict === revisao.action) return '';
  return proprio(PARECER, revisao.verdict) ?? revisao.verdict;
}

// O filtro `veredito` de GET /api/decisions, na ordem do seletor. O rótulo diz o que foi
// publicado, porque é isso que o motor filtra (o `action`, não o parecer).
export const FILTROS_DE_DESFECHO: ReadonlyArray<readonly [valor: string, rotulo: string]> = [
  ['approve', 'Aprovados'],
  ['request_changes', 'Mudanças pedidas'],
  ['comment', 'Comentados'],
  ['skip', 'Não publicados'],
];

// Os desfechos de uma contestação (PUSHBACK_OUTCOMES, lib/taxonomy.js). "nós" no motor é a
// revisão, e é assim que a tela escreve.
export const DESFECHOS_DA_CONTESTACAO: ReadonlyArray<readonly [valor: string, rotulo: string]> = [
  ['author_right', 'O autor tinha razão'],
  ['we_right', 'A revisão tinha razão'],
  ['mixed', 'Meio-termo'],
];

export function textoDoDesfecho(outcome: string): string {
  return DESFECHOS_DA_CONTESTACAO.find(([valor]) => valor === outcome)?.[1] ?? outcome;
}

// O tom da bolinha e do chip de uma revisão, pelo que foi publicado: aprovação verde,
// comentário âmbar, pedido de mudanças vermelho, nada postado cinza. A pendência da mesa é
// sempre "nada postado", qualquer que seja o `action` dela.
export type TomDoDesfecho = 'ok' | 'aviso' | 'ruim' | 'neutro';

const TOM: Record<string, TomDoDesfecho> = { approve: 'ok', comment: 'aviso', request_changes: 'ruim' };
const CHIP: Record<string, string> = { approve: 'Aprovado', comment: 'Comentado', request_changes: 'Pediu mudanças' };

export function tomDoDesfecho(revisao: { action?: string; status?: string }): TomDoDesfecho {
  if (revisao.status === 'pending') return 'neutro';
  const { action } = revisao;
  return action !== undefined && Object.hasOwn(TOM, action) ? (TOM[action] ?? 'neutro') : 'neutro';
}

// O texto do chip do desfecho, no detalhe.
export function rotuloDoDesfecho(revisao: { action?: string; status?: string }): string {
  if (revisao.status === 'pending') return 'Nada postado';
  return proprio(CHIP, revisao.action) ?? 'Nada postado';
}

// A legenda das cores, no pé da lista, na ordem do desenho.
export const LEGENDA_DAS_CORES: ReadonlyArray<readonly [tom: TomDoDesfecho, rotulo: string]> = [
  ['ok', 'aprovado'],
  ['aviso', 'comentado'],
  ['ruim', 'pediu mudanças'],
  ['neutro', 'nada postado'],
];
