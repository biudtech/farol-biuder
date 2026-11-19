// As regras de review por organização e autor, sem React. São exceções à conta revisora: decidem
// se o PR de uma organização, ou de um autor dentro dela, começa sozinho (`auto`) ou só no
// clique (`manual`), antes da revisão automática da conta. O motor as guarda em
// `conta.reviewRules` e as edita por operação pontual, uma regra por vez
// (`POST /api/accounts/edit` com `tipo: "regra-review"`, editarRegra, lib/engine/review-scope.js,
// na raiz): `mode: "inherit"` tira a regra. O autor vence a organização, e a organização vence a
// conta (politicaDeInicio). Não há regra por repositório: o motor não tem.
import type { ModoDaRegra, RegraDeReview } from '@/contratos/sistema';

// A forma do identificador que o motor aceita (`identificador`, review-scope.js), em minúsculas e
// sem o @ da frente. O teste ao lado confere contra o motor.
export const IDENTIFICADOR_DA_REGRA = /^[a-z0-9][a-z0-9-]*(?:\[bot\])?$/;
export const TETO_DO_IDENTIFICADOR = 100;

export const ROTULO_DO_MODO: Record<ModoDaRegra, string> = { auto: 'Revisa sozinho', manual: 'Só no clique' };

export const EFEITO_DO_MODO: Record<ModoDaRegra, string> = {
  auto: 'O motor revisa e publica sozinho pela política da conta, mesmo com a revisão automática da conta desligada.',
  manual: 'O PR entra na lista "De fora da fila" e só é revisado quando alguém clica em Revisar mesmo assim.',
};

// Como o motor grava: sem espaço nas pontas, sem o @ e em minúsculas.
export function nomeDaRegra(texto: string): string {
  return texto.trim().replace(/^@/, '').toLowerCase();
}

export function identificadorValido(texto: string): boolean {
  const nome = nomeDaRegra(texto);
  return nome.length > 0 && nome.length <= TETO_DO_IDENTIFICADOR && IDENTIFICADOR_DA_REGRA.test(nome);
}

// Por que a regra digitada não pode ir, ou null. O autor é opcional: sem ele a regra vale para a
// organização inteira.
export function erroDaRegra(organizacao: string, autor: string): string | null {
  if (!identificadorValido(organizacao)) return 'Informe a organização como aparece no GitHub: letras, dígitos e hífen.';
  if (autor.trim() && !identificadorValido(autor)) return 'Informe o login do autor como aparece no GitHub: letras, dígitos e hífen (robôs terminam em [bot]).';
  return null;
}

export interface CorpoDaRegra {
  tipo: 'regra-review';
  user: string;
  organization: string;
  author?: string;
  mode: ModoDaRegra | 'inherit';
}

// O corpo da operação. `inherit` tira a regra (a de organização tira só o modo dela; as dos
// autores ficam).
export function corpoDaRegra(user: string, organizacao: string, autor: string | undefined, modo: ModoDaRegra | 'inherit'): CorpoDaRegra {
  const corpo: CorpoDaRegra = { tipo: 'regra-review', user, organization: nomeDaRegra(organizacao), mode: modo };
  if (autor && autor.trim()) corpo.author = nomeDaRegra(autor);
  return corpo;
}

export function alvoDaRegra(organizacao: string, autor: string | undefined): string {
  return `sistema:regra:${nomeDaRegra(organizacao)}:${autor ? nomeDaRegra(autor) : ''}`;
}

export function nomeDoAlvoDaRegra(organizacao: string, autor: string | undefined): string {
  return autor ? `@${nomeDaRegra(autor)} em ${nomeDaRegra(organizacao)}` : `a organização ${nomeDaRegra(organizacao)}`;
}

// A regra em uma frase, como ela vale no motor.
export function fraseDaRegra(regra: RegraDeReview): string {
  if (regra.autor) {
    return regra.modo === 'auto'
      ? `Os PRs de @${regra.autor} em ${regra.organizacao} são revisados sozinhos, qualquer que seja a regra da organização.`
      : `Os PRs de @${regra.autor} em ${regra.organizacao} só são revisados no clique, qualquer que seja a regra da organização.`;
  }
  return regra.modo === 'auto'
    ? `Os PRs de ${regra.organizacao} são revisados sozinhos, mesmo com a revisão automática da conta desligada.`
    : `Os PRs de ${regra.organizacao} só são revisados no clique, mesmo com a revisão automática da conta ligada.`;
}

// A ordem da lista: por organização, a regra da organização antes das dos autores dela.
export function regrasOrdenadas(regras: readonly RegraDeReview[]): RegraDeReview[] {
  return [...regras].sort((a, b) => a.organizacao.localeCompare(b.organizacao) || (a.autor ? 1 : 0) - (b.autor ? 1 : 0) || (a.autor ?? '').localeCompare(b.autor ?? ''));
}

// A regra que já existe para o mesmo alvo, se houver: criar de novo troca o modo dela.
export function regraDoAlvo(regras: readonly RegraDeReview[], organizacao: string, autor: string): RegraDeReview | undefined {
  const org = nomeDaRegra(organizacao);
  const quem = autor.trim() ? nomeDaRegra(autor) : undefined;
  return regras.find((r) => r.organizacao === org && r.autor === quem);
}

// O resumo do menu: quantas exceções há.
export function resumoDasRegras(regras: readonly RegraDeReview[]): string {
  if (!regras.length) return 'Nenhuma exceção';
  return regras.length === 1 ? '1 exceção' : `${regras.length} exceções`;
}
