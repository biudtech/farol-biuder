// Os rótulos do Histórico: a tabela única que traduz o que o motor grava numa revisão
// resolvida. A tela só escreve: `status`, `action` e `verdict` chegam prontos. Valor que esta
// tabela não conhece aparece cru, em vez de sumir ou de quebrar a linha.
//
// De onde vem cada valor (arquivos na raiz do repositório):
// - `status`: quem resolve a revisão grava um destes. `auto_approved`, `auto_rejected` e
//   `commented_own_pr` saem de statusAutomatico (lib/engine/desfecho-automatico.js);
//   `posted`, `already_reviewed`, `skipped`, `superseded`, `already_merged` e
//   `already_closed`, de lib/engine/decision.js; `approval_not_needed`, de
//   lib/engine/desfecho-da-revisao.js, espera-ci.js, espera-prova-decidida.js e
//   postagem-recusada.js. `pending` não é de item resolvido: é a pendência da mesa, que só
//   chega aqui pelo detalhe por chave (GET /api/decision);
// - `action`: os quatro valores de `VEREDITOS` em lib/engine/historico-paginado.js, que são
//   também os do filtro `veredito`.
// O teste ao lado lê esses arquivos e reprova se o motor passar a gravar um valor sem rótulo.

function proprio(mapa: Record<string, string>, chave: string | undefined): string | undefined {
  return chave !== undefined && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

// Como a revisão foi resolvida.
export const ROTULO_DO_STATUS: Record<string, string> = {
  auto_approved: 'Publicado automaticamente',
  auto_rejected: 'Publicado automaticamente',
  commented_own_pr: 'Publicado automaticamente, como comentário (PR da própria conta)',
  posted: 'Publicado por você',
  already_reviewed: 'Já havia review seu no PR: nada foi publicado de novo',
  approval_not_needed: 'Outra pessoa já decidiu o commit: a publicação automática não foi necessária',
  already_merged: 'PR já mesclado: a revisão pendente foi cancelada',
  already_closed: 'PR fechado sem merge: a revisão pendente foi cancelada',
  skipped: 'Pulado na mesa',
  superseded: 'Substituído por rodada nova',
  pending: 'Esperando a sua decisão no Radar',
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

export function textoDaAcao(action: string | undefined): string {
  return proprio(ROTULO_DA_ACAO, action) ?? action ?? 'Sem registro do que foi publicado';
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
