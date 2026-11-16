// O que a tela Sistema lê do motor (os arquivos citados ficam na raiz do repositório):
// - do snapshot: `doctor` (Engine.doctor, server.js), `accounts` (contasParaTela,
//   lib/engine/contas-config.js), `modelos` (catalogoParaTela, lib/modelos.js), `claudePerfis`
//   (perfisParaTela, lib/engine/perfil-claude.js), `jiraSites` (maskJiraSites,
//   lib/jira/sites.js) e, de `config` (configParaFora, lib/engine/chave-do-perfil.js), as
//   chaves de automação, os perfis do Claude e as chaves que só mudam por arquivo;
// - das rotas: POST /api/auth/sessions e /api/auth/revoke (lib/local-auth/acesso.js),
//   GET /api/doctor e /api/diagnostics, POST /api/claude/profile-test e /api/jira/test.
//
// Segredo não passa daqui. Os tipos lidos só têm campo que a tela mostra, montados um a um, e
// nenhum deles é token, chave, senha ou credencial: do segredo a tela só conhece a presença
// (`tokenOk`, `temChave`, `hasCredential`), que é booleano. Nada daqui é guardado como veio: a
// tela não manda perfil de volta ao motor, então não há lista crua no store. Valor curto que
// chega em formato de credencial conta como ausente (`textoSeguro`), e mensagem do motor
// (erro, motivo, aviso, o relatório de diagnóstico) fica, com o trecho trocado por
// "[segredo omitido]" (`mensagemSegura`, ./segredos).
import {
  campo, ehBooleano, ehListaDeTextos, ehNumero, ehObjeto, ehTexto, lerItens, lerLista, semAusentes,
  type Leitor, type LeitorDeItem, type Registrar,
} from './formas';
import { mascararSegredos, mensagemSegura, semSegredos, textoSeguro } from './segredos';

// ---------- `config`: automação, perfis do Claude e chaves só de arquivo ----------

// Um perfil do Claude como a tela o mostra. A chave (`apiKey`) e a pasta do perfil de
// assinatura (`dir`) não são lidas nem guardadas: da chave só a presença (`temChave`), e a
// pasta é assunto do motor (o caminho dela não vai ao store).
export interface PerfilDoClaude {
  id: string;
  label?: string;
  // `dir` é assinatura e `apikey` é chave de API (normalizeClaudeProfiles, lib/parse.js)
  kind?: string;
  temChave?: boolean;
  // o endereço para onde a chave é enviada, quando não é o da Anthropic
  baseUrl?: string;
  // Não vem assim do motor: o perfil traz algum teto de gasto no arquivo (`budgetDaily`,
  // `budgetTotal`, `budgetByWeekday` ou `budgetDates`). A tela não mostra nem edita o valor:
  // só avisa que ele existe, porque o motor ainda pausa revisão automática por ele.
  temTeto?: true;
}

export interface ConfigDoSistema {
  aguardarCiParaAprovar?: boolean;
  parallelReviews?: number;
  globalParallelReviews?: number;
  reviewModel?: string;
  reviewEffort?: string;
  claudeProfiles?: PerfilDoClaude[];
  claudeProfileId?: string;
  // só por arquivo, com reinício do motor
  bind?: string;
  hostPublico?: string;
  origensPermitidas?: string[];
  port?: number;
  localAuth?: string;
  // Não vem do motor: quantas coisas com cara de segredo a borda descartou desta chave.
  segredosDescartados?: number;
}

// Há teto neste campo: um número (zero também é teto), ou um mapa com algum número.
function haTeto(valor: unknown): boolean {
  if (ehNumero(valor)) return true;
  return ehObjeto(valor) && Object.values(valor).some(ehNumero);
}

const lerPerfil: LeitorDeItem<PerfilDoClaude> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id) || !v.id) return undefined;
  const temTeto = [v.budgetDaily, v.budgetTotal, v.budgetByWeekday, v.budgetDates].some(haTeto);
  return semAusentes({
    id: v.id,
    label: textoSeguro(v.label) || undefined,
    kind: campo(v.kind, ehTexto),
    temChave: campo(v.temChave, ehBooleano),
    baseUrl: textoSeguro(v.baseUrl) || undefined,
    temTeto: temTeto ? (true as const) : undefined,
  });
};

// As chaves de `config` que a tela Sistema usa. O que vem de forma errada conta como ausente,
// e a seção que depende da chave diz que o motor não a mandou.
export function lerConfigDoSistema(valor: unknown, registrar: Registrar): ConfigDoSistema {
  if (!ehObjeto(valor)) return {};
  const config: ConfigDoSistema = semAusentes({
    aguardarCiParaAprovar: campo(valor.aguardarCiParaAprovar, ehBooleano),
    parallelReviews: campo(valor.parallelReviews, ehNumero),
    globalParallelReviews: campo(valor.globalParallelReviews, ehNumero),
    reviewModel: campo(valor.reviewModel, ehTexto),
    reviewEffort: campo(valor.reviewEffort, ehTexto),
    claudeProfileId: campo(valor.claudeProfileId, ehTexto),
    bind: campo(valor.bind, ehTexto),
    hostPublico: campo(valor.hostPublico, ehTexto),
    origensPermitidas: campo(valor.origensPermitidas, ehListaDeTextos),
    port: campo(valor.port, ehNumero),
    localAuth: campo(valor.localAuth, ehTexto),
  });
  if (Array.isArray(valor.claudeProfiles)) {
    // a lista passa por `semSegredos` só para contar o que chegou com cara de segredo
    const { limpo, descartados } = semSegredos(valor.claudeProfiles);
    config.claudeProfiles = lerItens(limpo, lerPerfil)?.itens ?? [];
    // só a contagem vai ao registro: nem o nome do campo nem o valor
    if (descartados) {
      config.segredosDescartados = descartados;
      registrar(`snapshot: ${descartados} campo(s) de "config.claudeProfiles" com cara de segredo, descartado(s) na borda`);
    }
  }
  return config;
}

// ---------- `accounts`: a conta revisora ----------

export interface ContaRevisora {
  // vazio enquanto o motor não tem conta (o gh ainda não foi detectado)
  user: string;
  owners: string[];
  // o motor tem token do gh para esta conta. Só a presença: o token nunca sai do motor.
  tokenOk?: boolean;
  // até quando as buscas estão paradas pelo limite do GitHub, e a assinatura pelo limite do
  // plano (0 é livre)
  limiteGhAte?: number;
  limitePlanoAte?: number;
  autoReview?: boolean;
  onClean?: string;
  onCaveats?: string;
  onReject?: string;
  // Não vem assim do motor: quantas organizações têm regra de review própria (`reviewRules`).
  regrasDeReview: number;
}

const lerContaRevisora: LeitorDeItem<ContaRevisora> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.user)) return undefined;
  return semAusentes({
    user: v.user,
    owners: Array.isArray(v.owners) ? v.owners.filter(ehTexto) : [],
    tokenOk: campo(v.tokenOk, ehBooleano),
    limiteGhAte: campo(v.limiteGhAte, ehNumero),
    limitePlanoAte: campo(v.limitePlanoAte, ehNumero),
    autoReview: campo(v.autoReview, ehBooleano),
    onClean: campo(v.onClean, ehTexto),
    onCaveats: campo(v.onCaveats, ehTexto),
    onReject: campo(v.onReject, ehTexto),
    regrasDeReview: ehObjeto(v.reviewRules) ? Object.keys(v.reviewRules).length : 0,
  });
};

export const lerContas: Leitor<ContaRevisora[]> = lerLista('accounts', lerContaRevisora);

// ---------- `doctor`: a saúde ----------

export interface PerfilNaSaude {
  id: string;
  label?: string;
  ready?: boolean;
  tipo: 'chave' | 'assinatura' | 'desconhecido';
}

// O que o diagnóstico do motor mede (Engine.doctor, server.js). Os caminhos de pasta que ele
// traz (`home`, `workspace`) não são lidos.
export interface Saude {
  node?: string;
  gh?: string;
  claude?: string;
  ghAuth?: boolean;
  root?: boolean;
  instanciaIsolada?: boolean;
  claudeAuth: PerfilNaSaude[];
  claudePerfilPronto?: boolean;
  claudePerfilTipo?: string;
  claudePerfilFalta?: string;
  checkedAt?: number;
}

const lerPerfilNaSaude: LeitorDeItem<PerfilNaSaude> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id)) return undefined;
  const tipo: PerfilNaSaude['tipo'] = v.apiKeyMode === true ? 'chave' : v.assinaturaMode === true ? 'assinatura' : 'desconhecido';
  return semAusentes({ id: v.id, label: textoSeguro(v.label) || undefined, ready: campo(v.ready, ehBooleano), tipo });
};

function saudeDe(v: Record<string, unknown>): Saude {
  return semAusentes({
    node: campo(v.node, ehTexto) || undefined,
    gh: campo(v.gh, ehTexto) || undefined,
    claude: campo(v.claude, ehTexto) || undefined,
    ghAuth: campo(v.ghAuth, ehBooleano),
    root: campo(v.root, ehBooleano),
    instanciaIsolada: campo(v.instanciaIsolada, ehBooleano),
    claudeAuth: lerItens(v.claudeAuth, lerPerfilNaSaude)?.itens ?? [],
    claudePerfilPronto: campo(v.claudePerfilPronto, ehBooleano),
    claudePerfilTipo: campo(v.claudePerfilTipo, ehTexto),
    claudePerfilFalta: campo(v.claudePerfilFalta, ehTexto),
    checkedAt: campo(v.checkedAt, ehNumero),
  });
}

// `null` é valor do motor: o diagnóstico ainda não rodou.
export const lerSaude: Leitor<Saude | null> = (valor) => {
  if (valor === null) return null;
  return ehObjeto(valor) ? saudeDe(valor) : undefined;
};

// A resposta de GET /api/doctor: o mesmo objeto, sem envelope.
export function lerSaudeDaRota(bruto: unknown): Saude | null {
  return ehObjeto(bruto) ? saudeDe(bruto) : null;
}

// ---------- `modelos`: o catálogo e a versão do Claude Code ----------

export interface SelecaoDeModelo {
  // o que vai em `reviewModel`; vazio é o padrão do Claude Code
  valor: string;
  rotulo?: string;
  auto?: boolean;
  aceitaEsforco?: boolean;
}

// avaliarVersao, lib/engine/versao-claude.js
export interface VersaoDoCli {
  instalada?: string;
  maisRecente?: string;
  atualizada?: boolean;
  atrasada?: boolean;
  atrasadaDesde?: number;
  // o motor não conseguiu comparar com a versão publicada
  indisponivel?: boolean;
}

export interface Modelos {
  cli?: VersaoDoCli;
  claude: SelecaoDeModelo[];
}

const lerSelecao: LeitorDeItem<SelecaoDeModelo> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.valor)) return undefined;
  return semAusentes({ valor: v.valor, rotulo: campo(v.rotulo, ehTexto) || undefined, auto: campo(v.auto, ehBooleano), aceitaEsforco: campo(v.aceitaEsforco, ehBooleano) });
};

export const lerModelos: Leitor<Modelos> = (valor) => {
  if (!ehObjeto(valor)) return undefined;
  const cli = ehObjeto(valor.cli)
    ? semAusentes({
      instalada: campo(valor.cli.instalada, ehTexto),
      maisRecente: campo(valor.cli.maisRecente, ehTexto),
      atualizada: campo(valor.cli.atualizada, ehBooleano),
      atrasada: campo(valor.cli.atrasada, ehBooleano),
      atrasadaDesde: campo(valor.cli.atrasadaDesde, ehNumero),
      indisponivel: campo(valor.cli.indisponivel, ehBooleano),
    })
    : undefined;
  return semAusentes({ cli, claude: lerItens(valor.claude, lerSelecao)?.itens ?? [] });
};

// ---------- `claudePerfis`: problemas e uso do plano ----------

export interface JanelaDoPlano {
  nome?: string;
  // a fração usada, de 0 a 1
  usado?: number;
  resetTexto?: string;
}

// usoParaTela, lib/engine/uso-do-plano.js
export interface UsoDoPlano {
  lido: boolean;
  ok?: boolean;
  erro?: string;
  // quando o login deixa de se renovar sozinho, e a faixa do aviso ("vencido", "ultimo-dia",
  // "perto" ou vazio)
  venceEm?: number;
  faixaDoLogin?: string;
  desatualizado?: boolean;
  lidaEm?: number;
  janelas: JanelaDoPlano[];
}

export interface ProblemaDePerfil {
  profileId: string;
  code: string;
}

export interface PerfisDoClaude {
  problemas: ProblemaDePerfil[];
  uso: Record<string, UsoDoPlano>;
}

const lerJanela: LeitorDeItem<JanelaDoPlano> = (v) => {
  if (!ehObjeto(v)) return undefined;
  return semAusentes({ nome: campo(v.nome, ehTexto), usado: campo(v.usado, ehNumero), resetTexto: campo(v.resetTexto, ehTexto) || undefined });
};

function lerUso(v: unknown): UsoDoPlano | undefined {
  if (!ehObjeto(v) || !ehBooleano(v.lido)) return undefined;
  return semAusentes({
    lido: v.lido,
    ok: campo(v.ok, ehBooleano),
    erro: mensagemSegura(v.erro) || undefined,
    venceEm: campo(v.venceEm, ehNumero),
    faixaDoLogin: campo(v.faixaDoLogin, ehTexto) || undefined,
    desatualizado: campo(v.desatualizado, ehBooleano),
    lidaEm: campo(v.lidaEm, ehNumero),
    janelas: lerItens(v.janelas, lerJanela)?.itens ?? [],
  });
}

const lerProblema: LeitorDeItem<ProblemaDePerfil> = (v) => (
  ehObjeto(v) && ehTexto(v.profileId) && ehTexto(v.code) ? { profileId: v.profileId, code: v.code } : undefined
);

export const lerPerfisDoClaude: Leitor<PerfisDoClaude> = (valor) => {
  if (!ehObjeto(valor)) return undefined;
  const uso: Array<[string, UsoDoPlano]> = [];
  for (const [id, bruto] of Object.entries(ehObjeto(valor.uso) ? valor.uso : {})) {
    const lido = lerUso(bruto);
    if (lido) uso.push([id, lido]);
  }
  return { problemas: lerItens(valor.problemas, lerProblema)?.itens ?? [], uso: Object.fromEntries(uso) };
};

// ---------- `jiraSites`: os sites do Jira ----------

export interface SiteDoJira {
  id: string;
  label?: string;
  baseUrl?: string;
  // as organizações do GitHub ligadas ao site, e as chaves de projeto aceitas
  owners: string[];
  projectKeys: string[];
  // o motor tem credencial para o site. Só a presença: a credencial nunca sai do motor.
  hasCredential?: boolean;
}

const lerSite: LeitorDeItem<SiteDoJira> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id) || !v.id) return undefined;
  return semAusentes({
    id: v.id,
    label: textoSeguro(v.label) || undefined,
    baseUrl: textoSeguro(v.baseUrl) || undefined,
    owners: Array.isArray(v.owners) ? v.owners.filter(ehTexto) : [],
    projectKeys: Array.isArray(v.projectKeys) ? v.projectKeys.filter(ehTexto) : [],
    hasCredential: campo(v.hasCredential, ehBooleano),
  });
};

export const lerSitesDoJira: Leitor<SiteDoJira[]> = lerLista('jiraSites', lerSite);

// ---------- rotas ----------

// Uma sessão pareada (listarSessoes, lib/local-auth/sessoes.js). O `id` é um pedaço do hash
// do token, nunca o token: serve só para apontar a linha na revogação.
export interface SessaoPareada {
  id: string;
  rotulo: string;
  criadoEm: number;
  ultimoUsoEm: number;
  // a sessão de quem pediu a lista
  atual: boolean;
}

export interface SessoesPareadas {
  sessoes: SessaoPareada[];
  // Não vem do motor: quantas chegaram fora do formato e ficaram de fora.
  descartadas: number;
}

const ID_DE_SESSAO = /^[0-9a-f]{16}$/;

const lerSessao: LeitorDeItem<SessaoPareada> = (v) => {
  if (!ehObjeto(v) || !ehTexto(v.id) || !ID_DE_SESSAO.test(v.id)) return undefined;
  return {
    id: v.id,
    rotulo: textoSeguro(v.rotulo) ?? '',
    criadoEm: campo(v.criadoEm, ehNumero) ?? 0,
    ultimoUsoEm: campo(v.ultimoUsoEm, ehNumero) ?? 0,
    atual: v.atual === true,
  };
};

// A resposta de POST /api/auth/sessions: `{ ok: true, sessoes }`.
export function lerSessoes(bruto: unknown): SessoesPareadas | null {
  if (!ehObjeto(bruto) || bruto.ok !== true) return null;
  const lido = lerItens(bruto.sessoes, lerSessao);
  return lido ? { sessoes: lido.itens, descartadas: lido.descartados } : null;
}

// A resposta de POST /api/auth/revoke: `{ ok: true, eraAtual }` ou a recusa
// `{ ok: false, code: "sessao_inexistente" }`.
export type Revogacao = { ok: true; eraAtual: boolean } | { ok: false; code?: string };

export function lerRevogacao(bruto: unknown): Revogacao | null {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  return bruto.ok ? { ok: true, eraAtual: bruto.eraAtual === true } : semAusentes({ ok: false as const, code: campo(bruto.code, ehTexto) });
}

// Um campo do teste de perfil: o valor e de onde ele veio (`informado`, `validado`,
// `detectado`, `inferido` ou `desconhecido`), com o motivo quando o motor diz.
export interface CampoDoTeste {
  valor?: string | boolean;
  origem?: string;
  motivo?: string;
}

// A resposta de POST /api/claude/profile-test (testarPerfil, lib/engine/perfil-claude.js).
export type TesteDePerfil =
  | { ok: true; id?: string; label?: string; kind?: string; aviso?: string; campos: Record<string, CampoDoTeste> }
  | { ok: false; code?: string; motivo?: string };

function lerCampoDoTeste(v: unknown): CampoDoTeste | undefined {
  if (!ehObjeto(v)) return undefined;
  const valor = ehBooleano(v.valor) ? v.valor : textoSeguro(v.valor);
  return semAusentes({ valor, origem: campo(v.origem, ehTexto), motivo: mensagemSegura(v.motivo) });
}

// Os campos que o motor manda no teste, e só eles.
const CAMPOS_DO_TESTE = ['tipoAuth', 'chave', 'login', 'email', 'plano'];

export function lerTesteDePerfil(bruto: unknown): TesteDePerfil | null {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  if (!bruto.ok) return semAusentes({ ok: false as const, code: campo(bruto.code, ehTexto), motivo: mensagemSegura(bruto.motivo) });
  if (!ehObjeto(bruto.perfil)) return null;
  const brutos = ehObjeto(bruto.perfil.campos) ? bruto.perfil.campos : {};
  const campos: Array<[string, CampoDoTeste]> = [];
  for (const nome of CAMPOS_DO_TESTE) {
    const lido = lerCampoDoTeste(brutos[nome]);
    if (lido) campos.push([nome, lido]);
  }
  return semAusentes({
    ok: true as const,
    id: campo(bruto.perfil.id, ehTexto),
    label: textoSeguro(bruto.perfil.label) || undefined,
    kind: campo(bruto.perfil.kind, ehTexto),
    aviso: mensagemSegura(bruto.perfil.aviso) || undefined,
    campos: Object.fromEntries(campos),
  });
}

// A resposta de POST /api/jira/test (testarSite, lib/engine/jira.js): quem a credencial
// representa, ou o código e a frase da falha. Nada da credencial vem aqui.
export type TesteDoJira = { ok: true; quem?: string } | { ok: false; code?: string; motivo?: string };

export function lerTesteDoJira(bruto: unknown): TesteDoJira | null {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  return bruto.ok
    ? semAusentes({ ok: true as const, quem: textoSeguro(bruto.quem) || undefined })
    : semAusentes({ ok: false as const, code: campo(bruto.code, ehTexto), motivo: mensagemSegura(bruto.motivo) });
}

// A resposta de GET /api/diagnostics: o relatório em markdown, que o motor já entrega com os
// segredos mascarados (lib/engine/diagnostico.js), e as falhas registradas, de que a tela só
// usa a contagem. É texto livre: a borda não tem como conferir campo a campo. O que ainda
// vier em formato de credencial é trocado por "[segredo omitido]", e a tela o desenha como
// markdown, sem HTML.
export interface Diagnostico {
  markdown: string;
  falhas: number;
}

export function lerDiagnostico(bruto: unknown): Diagnostico | null {
  if (!ehObjeto(bruto) || bruto.ok !== true || !ehTexto(bruto.markdown)) return null;
  return { markdown: mascararSegredos(bruto.markdown), falhas: Array.isArray(bruto.falhas) ? bruto.falhas.length : 0 };
}
