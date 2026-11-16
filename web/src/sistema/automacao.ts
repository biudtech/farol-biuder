// As quatro chaves de automação que a tela Sistema edita, sem React: CI antes de aprovar,
// paralelismo, modelo e esforço. São preferências de topo de `config`, e POST /api/settings
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
  aguardarCiParaAprovar: boolean;
  parallelReviews: number;
  reviewModel: string;
  reviewEffort: string;
}

export const CHAVES_DA_AUTOMACAO = ['aguardarCiParaAprovar', 'parallelReviews', 'reviewModel', 'reviewEffort'] as const;
export type ChaveDaAutomacao = (typeof CHAVES_DA_AUTOMACAO)[number];
export type CorpoDaAutomacao = Partial<Automacao>;

// As quatro chaves como o motor as mandou, ou null se faltar alguma: sem o valor de agora a
// tela não tem de onde partir, e mostra a seção sem edição.
export function automacaoDe(config: ConfigDoSistema | undefined): Automacao | null {
  if (!config) return null;
  const { aguardarCiParaAprovar, parallelReviews, reviewModel, reviewEffort } = config;
  if (aguardarCiParaAprovar === undefined || parallelReviews === undefined || reviewModel === undefined || reviewEffort === undefined) return null;
  return { aguardarCiParaAprovar, parallelReviews, reviewModel, reviewEffort };
}

export function marcaDaAutomacao(a: Automacao): string {
  return JSON.stringify([a.aguardarCiParaAprovar, a.parallelReviews, a.reviewModel, a.reviewEffort]);
}

// O corpo de POST /api/settings: só as chaves que mudaram.
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
// aguardaCiParaAprovar (lib/engine/gate-espera.js), parallelLimit (lib/engine/headless-fila.js)
// e buildModelFlags (lib/engine/session.js).
export function efeitoDoCi(ligado: boolean): string {
  return ligado
    ? 'Ligado: a aprovação automática espera os checks obrigatórios ficarem verdes no commit revisado, e sai sozinha quando fecham.'
    : 'Desligado: o estado do CI não segura nem adia a decisão, e o motor pode aprovar com o CI vermelho ou ainda rodando. Só é seguro onde o check é obrigatório no ruleset do repositório, porque aí o GitHub barra o merge.';
}

export const EFEITO_DO_PARALELO = `Quantas sessões de revisão a conta roda ao mesmo tempo, de ${PARALELO_MINIMO} a ${PARALELO_MAXIMO}. Mais sessões juntas esvaziam a fila mais rápido e gastam o plano ou a chave mais depressa.`;
export const EFEITO_DO_MODELO = 'Vira a flag --model da sessão de revisão do Claude Code. As opções são apelidos de família: quem decide a versão é o Claude Code instalado no motor. O Auto é do Farol, não vira flag: o motor escolhe modelo e effort pelo PR. Um nome completo de modelo (claude-...) só entra pelo arquivo de configuração.';
export const EFEITO_DO_ESFORCO = 'Vira a flag --effort da sessão de revisão. Mais effort deixa a sessão mais longa e mais cara.';

// O limite total de sessões da instância, que esta tela não edita: com ele ligado vale o menor dos dois.
export function notaDoLimiteTotal(total: number | undefined): string | null {
  if (!total || total <= 0) return null;
  return `A instância tem também um limite total de ${total} ${total === 1 ? 'sessão' : 'sessões'} ao mesmo tempo (globalParallelReviews), que esta tela não edita: vale o menor dos dois.`;
}

// Só uma mudança da automação amplia o que o motor publica sozinho: desligar o CI antes de
// aprovar. As outras não mudam o que é publicado. O efeito tem duas partes, e a segunda é
// imediata: com a chave desligada, a varredura das esperas já armadas (umaEspera e
// liberarSemCi, lib/engine/espera-ci.js, na raiz) publica a aprovação de cada PR que estava
// esperando o CI, com o CI não verde como nota; a pendência que pediu mudanças só pelo CI vai
// para a mesa.
export function ampliacoesDaAutomacao(antes: Automacao, corpo: CorpoDaAutomacao): string[] {
  if (corpo.aguardarCiParaAprovar !== false || antes.aguardarCiParaAprovar === false) return [];
  return [
    'Efeito imediato: toda aprovação que já está em "Esperando o CI" é publicada (APPROVE) na próxima varredura do motor, sem esperar os checks, mesmo com o CI vermelho ou ainda rodando, desde que o commit ainda seja o revisado e a política da conta ainda mande aprovar. A pendência que pediu mudanças só por causa do CI não é publicada: vai para "Precisa de você".',
    'Daqui em diante: a aprovação automática deixa de esperar os checks obrigatórios, e o motor passa a poder publicar APPROVE com o CI vermelho ou ainda rodando. Onde o check não é obrigatório no ruleset do repositório, nada barra o merge depois dessa aprovação.',
  ];
}

const NOME_DA_CHAVE: Record<ChaveDaAutomacao, string> = {
  aguardarCiParaAprovar: 'CI antes de aprovar',
  parallelReviews: 'revisões ao mesmo tempo',
  reviewModel: 'modelo',
  reviewEffort: 'esforço (effort)',
};

function valorDaChave(chave: ChaveDaAutomacao, valor: unknown): string {
  if (valor === undefined) return 'sem valor na resposta';
  if (chave === 'aguardarCiParaAprovar') return valor === true ? 'ligado' : 'desligado';
  if (chave === 'parallelReviews') return String(valor);
  return valor === '' ? 'padrão do Claude Code' : String(valor);
}

// O pedido numa frase: "CI antes de aprovar: ligado; modelo: opus".
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
