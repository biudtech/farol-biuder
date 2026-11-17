// As três chaves de automação que a tela Sistema edita, sem React: paralelismo, modelo e
// esforço. A espera do CI antes de aprovar saiu da tela (desenho de 17/11/2026: o revisor é
// autônomo e nunca espera): o motor ainda aceita a chave, mas só pelo arquivo ou pela API, e
// nenhum corpo daqui a manda. São preferências de topo de `config`, e POST /api/settings
// mescla por chave (updateSettings, server.js, na raiz): só a chave que vai no corpo muda, e
// cada uma passa pelo saneador dela (SETTINGS, lib/settings.js). Por isso o corpo leva só o
// que foi editado, e a resposta é conferida contra ele: valor que o motor não aceita não é
// recusado, o motor mantém o anterior ou ajusta para a faixa.
import type { ConfigDoSistema, SelecaoDeModelo } from '@/contratos/sistema';

// Os níveis de esforço (EFFORT_LEVELS, lib/parse.js). Vazio é "não manda a flag". O teste ao
// lado confere contra o motor.
export const ESFORCOS = ['low', 'medium', 'high', 'xhigh'] as const;

export const ROTULO_DO_ESFORCO: Record<string, string> = { low: 'Baixo (low)', medium: 'Médio (medium)', high: 'Alto (high)', xhigh: 'Muito alto (xhigh)' };

// O nome do campo traz o termo oficial do Claude Code (`effort`), como as opções.
export const NOME_DO_CAMPO_DE_ESFORCO = 'Esforço (effort) da revisão';

// A faixa de `parallelReviews` (sanitizeParallelReviews, lib/parse.js): fora dela o motor
// ajusta para a ponta. O teste ao lado confere contra o motor.
export const PARALELO_MINIMO = 1;
export const PARALELO_MAXIMO = 4;

export interface Automacao {
  parallelReviews: number;
  reviewModel: string;
  reviewEffort: string;
}

export const CHAVES_DA_AUTOMACAO = ['parallelReviews', 'reviewModel', 'reviewEffort'] as const;
export type ChaveDaAutomacao = (typeof CHAVES_DA_AUTOMACAO)[number];
export type CorpoDaAutomacao = Partial<Automacao>;

// As três chaves como o motor as mandou, ou null se faltar alguma: sem o valor de agora a
// tela não tem de onde partir, e mostra a seção sem edição.
export function automacaoDe(config: ConfigDoSistema | undefined): Automacao | null {
  if (!config) return null;
  const { parallelReviews, reviewModel, reviewEffort } = config;
  if (parallelReviews === undefined || reviewModel === undefined || reviewEffort === undefined) return null;
  return { parallelReviews, reviewModel, reviewEffort };
}

export function marcaDaAutomacao(a: Automacao): string {
  return JSON.stringify([a.parallelReviews, a.reviewModel, a.reviewEffort]);
}

// O corpo de POST /api/settings: só as chaves que mudaram, e só as três desta seção.
export function corpoDaAutomacao(antes: Automacao, rascunho: Automacao): CorpoDaAutomacao {
  const corpo: Record<string, unknown> = {};
  for (const chave of CHAVES_DA_AUTOMACAO) if (rascunho[chave] !== antes[chave]) corpo[chave] = rascunho[chave];
  return corpo as CorpoDaAutomacao;
}

export function paraleloValido(valor: number): boolean {
  return Number.isInteger(valor) && valor >= PARALELO_MINIMO && valor <= PARALELO_MAXIMO;
}

// A seleção do catálogo do motor com este valor, se houver.
export function selecaoDe(selecoes: readonly SelecaoDeModelo[], valor: string): SelecaoDeModelo | undefined {
  return selecoes.find((s) => s.valor === valor);
}

// O motor não manda `--effort` para a seleção que o catálogo diz que não aceita (o Auto, que
// escolhe o esforço sozinho). Valor fora do catálogo aceita: quem decide é o motor.
export function aceitaEsforco(selecoes: readonly SelecaoDeModelo[], modelo: string): boolean {
  return selecaoDe(selecoes, modelo)?.aceitaEsforco !== false;
}

export function rotuloDoModelo(selecoes: readonly SelecaoDeModelo[], valor: string): string {
  const selecao = selecaoDe(selecoes, valor);
  if (selecao) return selecao.rotulo || selecao.valor || 'Padrão do Claude Code';
  return valor ? `${valor} (fixado no arquivo de configuração; não está no catálogo)` : 'Padrão do Claude Code';
}

export function rotuloDoEsforco(valor: string): string {
  if (valor === '') return 'Padrão do Claude Code (não manda a flag)';
  return Object.hasOwn(ROTULO_DO_ESFORCO, valor) ? (ROTULO_DO_ESFORCO[valor] as string) : `${valor} (valor que esta tela não conhece)`;
}

// O efeito de cada chave, numa linha, como o motor a usa (os arquivos são da raiz):
// parallelLimit (lib/engine/headless-fila.js) e buildModelFlags (lib/engine/session.js).
export const EFEITO_DO_PARALELO = `Quantas sessões de revisão a conta roda ao mesmo tempo, de ${PARALELO_MINIMO} a ${PARALELO_MAXIMO}. Mais sessões juntas esvaziam a fila mais rápido e gastam o plano ou a chave mais depressa.`;
export const EFEITO_DO_MODELO = 'Vira a flag --model da sessão de revisão do Claude Code. As opções são apelidos de família: quem decide a versão é o Claude Code instalado no motor. O Auto é do Farol, não vira flag: o motor escolhe modelo e effort pelo PR. Um nome completo de modelo (claude-...) só entra pelo arquivo de configuração.';
export const EFEITO_DO_ESFORCO = 'Vira a flag --effort da sessão de revisão. Mais effort deixa a sessão mais longa e mais cara.';

// O limite total de sessões da instância, que esta tela não edita: com ele ligado vale o menor dos dois.
export function notaDoLimiteTotal(total: number | undefined): string | null {
  if (!total || total <= 0) return null;
  return `A instância tem também um limite total de ${total} ${total === 1 ? 'sessão' : 'sessões'} ao mesmo tempo (globalParallelReviews), que esta tela não edita: vale o menor dos dois.`;
}

const NOME_DA_CHAVE: Record<ChaveDaAutomacao, string> = {
  parallelReviews: 'revisões ao mesmo tempo',
  reviewModel: 'modelo',
  reviewEffort: 'esforço (effort)',
};

function valorDaChave(chave: ChaveDaAutomacao, valor: unknown): string {
  if (valor === undefined) return 'sem valor na resposta';
  if (chave === 'parallelReviews') return String(valor);
  return valor === '' ? 'padrão do Claude Code' : String(valor);
}

// O pedido numa frase: "revisões ao mesmo tempo: 2; modelo: opus".
export function textoDaAutomacao(corpo: CorpoDaAutomacao): string {
  return CHAVES_DA_AUTOMACAO.filter((chave) => corpo[chave] !== undefined).map((chave) => `${NOME_DA_CHAVE[chave]}: ${valorDaChave(chave, corpo[chave])}`).join('; ');
}

// A chave que a pessoa e o motor mudaram, cada um para um valor: a tela mostra os dois. Só
// enquanto os dois ainda diferem.
export function conflitosDaAutomacao(conflitos: readonly string[], noMotor: Automacao, rascunho: Automacao): string[] {
  return CHAVES_DA_AUTOMACAO
    .filter((chave) => conflitos.includes(chave) && noMotor[chave] !== rascunho[chave])
    .map((chave) => `${NOME_DA_CHAVE[chave]}: no motor agora está "${valorDaChave(chave, noMotor[chave])}", e no seu formulário, "${valorDaChave(chave, rascunho[chave])}". Salvar grava o seu.`);
}

// A conferência do que voltou: cada chave enviada cujo valor gravado difere do pedido, com o
// que ficou. O motor não recusa valor inválido: mantém o anterior ou ajusta para a faixa.
export function diferencasDaAutomacao(corpo: CorpoDaAutomacao, gravado: ConfigDoSistema): string[] {
  return CHAVES_DA_AUTOMACAO
    .filter((chave) => corpo[chave] !== undefined && gravado[chave] !== corpo[chave])
    .map((chave) => `${NOME_DA_CHAVE[chave]} ficou ${valorDaChave(chave, gravado[chave])}, e o pedido era ${valorDaChave(chave, corpo[chave])}`);
}

// O resumo da linha fechada: "2 ao mesmo tempo, Opus".
export function resumoDaAutomacao(a: Automacao, selecoes: readonly SelecaoDeModelo[]): string {
  const modelo = selecaoDe(selecoes, a.reviewModel);
  const nome = modelo ? modelo.rotulo || modelo.valor || 'padrão do Claude Code' : a.reviewModel || 'padrão do Claude Code';
  return `${a.parallelReviews} ao mesmo tempo, ${nome}`;
}
