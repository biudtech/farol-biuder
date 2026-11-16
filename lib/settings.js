// A tabela ÚNICA das preferências do Farol: chave, padrão, se a tela edita, e como
// sanear o valor que chega.
//
// Por que existe. Até 18/08/2026 uma preferência morava em CINCO lugares: o
// `DEFAULTS` do server.js, a lista `allowed` do updateSettings, o `if (k === 'x')`
// do saneamento, o `settingsMap` do ui/app.js e a linha de leitura no
// renderSettings. Esquecer UM deles não quebrava nada visível: o `updateSettings`
// descartava a chave desconhecida em silêncio e devolvia `undefined`, a tela mostrava
// "Configuração salva." do mesmo jeito, e a preferência simplesmente não persistia.
// Foi a queixa que originou este arquivo ("toda vez que ocorre um update estou
// perdendo tudo").
//
// Agora os três primeiros saem daqui. Os dois da UI não podem importar este arquivo
// (o servidor estático só serve `ui/`, ver lib/http-server.js), então a ponte é um
// TESTE que cruza o `settingsMap` da tela com esta tabela: esquecer aqui quebra a
// suíte em vez de sumir com a preferência de alguém.
//
// Puro: sem estado, sem IO, sem rede. Os saneadores que dependem de parsers vivem em
// lib/parse.js e entram por injeção (`fns`), pra este arquivo não puxar o mundo.

// ui: true  = a tela edita e o updateSettings aceita
// ui: false = existe no config, mas não vem da tela (só de código ou do arquivo)
// san: (valor, cfgAtual, fns) -> valor saneado. Ausente = entra como veio.
function finiteNumber(v, min, max, fallback) {
  if (typeof v !== 'number' && typeof v !== 'string') return fallback;
  const number = Number(v);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}
function contextMode(value) {
  if (['off', 'observe', 'assist'].includes(value)) return value;
  return 'off';
}

const SETTINGS = [
  // A conta revisora desta instância (corte do lote 14: uma instância, uma conta). Não vem do
  // POST /api/settings: a tela muda a conta por operação (POST /api/accounts/edit), e o login
  // é do arquivo ou da detecção do gh no primeiro boot.
  { key: 'conta', def: null, ui: false, omitirPadraoAoGravar: true },
  { key: 'jiraSites', def: [], ui: true, san: (v, _c, f) => f.parseJiraSites(v) },
  { key: 'intervalSeconds', def: 300, ui: true, san: (v) => clamp(parseInt(v, 10) || 300, 180, 3600) },
  // `autoReview` e `autoApproveAll` saíram desta tabela em 30/09/2026: a política de
  // revisar e de aprovar mora só na conta, e as duas chaves são só entrada do normalizarConfig
  // (abaixo). Não são preferência, não têm padrão e a tela não as edita.
  // Limite POR CONTA, sempre.
  { key: 'parallelReviews', def: 1, ui: true, san: (v, c, f) => ouAtual(f.sanitizeParallelReviews(v), c.parallelReviews) },
  // Teto TOTAL desta instância: revisoes simultaneas somando TODAS as contas (Politica 3 da
  // spec 2026-09-10-justica-de-fila-entre-orgs). 0 = sem teto total, e e o default: o unico
  // limite e o por conta. So e seguro ligar porque o rodizio de org decide quem ocupa cada
  // vaga; sem ele, um teto total concentraria.
  { key: 'globalParallelReviews', def: 0, ui: true, san: (v, c, f) => ouAtual(f.sanitizeGlobalParallelReviews(v), c.globalParallelReviews) },
  { key: 'soundEnabled', def: true, ui: true },
  { key: 'theme', def: 'dark', ui: true },
  { key: 'autostart', def: false, ui: true },
  // opt-in: só liga com valor verdadeiro explícito
  { key: 'reviewSingleOutput', def: false, ui: false, san: (v) => v === true },
  { key: 'reviewRoundsMode', def: 'observe', ui: false, san: (v) => v === 'enforce' ? 'enforce' : 'observe' },
  // Seleção nova depende de avaliação de decisões: off preserva a análise anterior;
  // observe mede recuperação sem injetar contexto; assist é ativação controlada.
  { key: 'reviewContextMode', def: 'off', ui: false, san: contextMode },
  { key: 'reviewNavigationFacts', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewBatchedReads', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewAgentOwnership', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewContextTokens', def: 3000, ui: false, san: v => finiteNumber(v, 256, 12000, 3000) },
  { key: 'reviewContextLimits', def: {}, ui: false },
  { key: 'sourceCacheLimits', def: {}, ui: false },
  // Ligada por padrão desde 06/11/2026 (pedido do dono): a segunda rodada continua a conversa
  // da primeira.
  { key: 'reReviewResume', def: true, ui: true, san: (v) => v !== false },
  { key: 'reviewFast', def: false, ui: true, san: (v) => !!v },
  // Começar antes do CI continua escolha de agendamento.
  { key: 'aguardarCiParaRevisar', def: false, ui: true, san: (v) => v === true },
  // CI obrigatório antes da aprovação (de novo uma escolha desde 06/11/2026, pedido do dono:
  // "isso aqui tem que ter como desativar no Farol ... e deve vir por default como
  // desabilitado"). Desligada (padrão), o estado do CI obrigatório não segura, não adia e não
  // barra a decisão. Só é seguro onde o check é obrigatório no ruleset: sem isso, desligar
  // permite APPROVE com o CI vermelho e nada barra o merge (a linha da tela diz o mesmo).
  // Ligada, a aprovação espera os checks verdes no commit revisado, como de 17/10 a
  // 06/11/2026. Lida só por aguardaCiParaAprovar (lib/engine/gate-espera.js).
  { key: 'aguardarCiParaAprovar', def: false, ui: true, san: (v) => v === true },
  { key: 'people', def: {}, ui: true, san: (v, _c, f) => f.parsePeople(v) },
  // null do saneador = valor inválido: mantém o que já estava, não derruba pro padrão
  { key: 'reviewModel', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeClaudeModel(v), c.reviewModel) },
  { key: 'reviewEffort', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeClaudeEffort(v), c.reviewEffort) },
  // Quando o Auto sobe para o Opus pelo contexto do PR (25/09/2026). `null` é a lista inicial
  // do roteador, que é quem saneia a cada leitura (parseAutoOpus em
  // lib/engine/model-router.js): por isso não há `san` aqui. Por enquanto só do arquivo; a
  // tela vem do Claude Design, e aí a chave passa a `ui: true` com o saneador injetado.
  { key: 'autoOpus', def: null, ui: false, omitirPadraoAoGravar: true },
  { key: 'autoPushback', def: true, ui: true, san: (v) => !!v },
  { key: 'debugSpawns', def: false, ui: true, san: (v) => !!v },
  { key: 'claudeProfiles', def: [], ui: true, san: (v, _c, f) => f.normalizeClaudeProfiles(v) },
  { key: 'claudeProfileId', def: '', ui: true, san: (v, _c, f) => f.normalizeClaudeProfileId(v) },
  // porta: existe no config e NÃO vem da tela. Trocar porta em runtime derrubaria o
  // servidor que respondeu o pedido, então é edição de arquivo, com reinício.
  { key: 'port', def: null, ui: false },
  // bind: o endereço em que o servidor escuta (implantação web atrás de um proxy). Mesma
  // regra da porta: arquivo, com reinício. Fora do loopback, o Host do bind entra na
  // allowlist (lib/http-guard.js) e a autenticação local passa a ser exigida.
  { key: 'bind', def: '127.0.0.1', ui: false, omitirPadraoAoGravar: true, san: (v, _c, f) => f.sanearBind(v) },
  // Autenticação da API local (A4): 'exigir' liga a exigência em qualquer ambiente.
  // NÃO vem da tela nem do POST /api/settings, porque uma página sem credencial não pode
  // ligar nem desligar a própria proteção. Edição de arquivo, com reinício.
  // `omitirPadraoAoGravar`: no padrão a chave não é escrita no config.json, para quem
  // nunca ligou o recurso não ganhar chave nova por causa dele (CT-COMPAT, item a).
  { key: 'localAuth', def: '', ui: false, omitirPadraoAoGravar: true },
];

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function ouAtual(saneado, atual) { return saneado === null ? atual : saneado; }

// Padrões prontos pro construtor. `port` sai daqui com o valor injetado, porque o
// número mora em lib/constants.js e este arquivo não importa nada.
function defaults(port) {
  const o = {};
  for (const s of SETTINGS) o[s.key] = s.def;
  o.port = port;
  return o;
}

// As chaves que o updateSettings aceita. Quem não está aqui é reportado como
// ignorada, nunca descartada em silêncio.
const EDITAVEIS = new Set(SETTINGS.filter(s => s.ui).map(s => s.key));

// A config como ela vai para o disco. O saveConfig grava o objeto INTEIRO a cada
// preferência salva, então chave marcada com `omitirPadraoAoGravar` some do arquivo
// enquanto estiver no padrão: recurso não habilitado não deixa rastro no config.json de
// ninguém (CT-COMPAT, item a). Quem editou o arquivo para ligar continua gravado.
function paraGravar(config) {
  const o = { ...(config || {}) };
  for (const s of SETTINGS) {
    if (s.omitirPadraoAoGravar && o[s.key] === s.def) delete o[s.key];
  }
  return o;
}

// Sanea UM valor pela tabela. `fns` traz os parsers de lib/parse.js.
function sanear(key, valor, cfgAtual, fns) {
  const s = SETTINGS.find(x => x.key === key);
  if (!s || !s.san) return valor;
  return s.san(valor, cfgAtual || {}, fns || {});
}

/* ---------- config.json antigo ----------
   O arquivo pode vir de antes do corte para uma conta: lista `accounts`, o modo simples
   `ghUser` + `owners`, conta silenciada, perfis de tipos que saíram, `sync`, `cadeiaPerfis`.
   normalizarConfig devolve só o que o motor ainda lê, sem lançar:
   - `conta` do formato novo vale; sem ela, a primeira conta NÃO silenciada da lista antiga
     (a silenciada não agia, então não vira a conta revisora); sem lista, `ghUser` + `owners`;
   - da conta ficam só os campos de CAMPOS_DA_CONTA, e só valor do domínio;
   - as chaves gerais antigas `autoReview` e `autoApproveAll` valem para a conta que não
     escolheu, inclusive antes de existir login (a instância de teste que grava
     `{"autoReview": false}` não pode nascer revisando sozinha quando o gh for detectado);
   - perfil do Claude que não é de assinatura (`dir`) nem de chave de API (`apikey`) sai;
   - chave que não está na tabela nem em CHAVES_SO_DE_ARQUIVO é descartada. */
const CAMPOS_DA_CONTA = Object.freeze(['user', 'owners', 'autoReview', 'onClean', 'onCaveats', 'onReject', 'padroesRevisao', 'reviewRules']);
// Lidas direto do arquivo, sem padrão na tabela (lib/engine/instancia-isolada.js e espera-conflito.js).
const CHAVES_SO_DE_ARQUIVO = Object.freeze(['instanciaIsoladaPosta', 'aguardarMergeavelParaRevisar']);
// As orgs da conta que o gh detecta no primeiro boot, antes de alguém escolher (era o padrão de `owners`).
const OWNERS_PADRAO = Object.freeze(['biudtech']);
const TIPOS_DE_PERFIL = Object.freeze(['dir', 'apikey']);
const DOMINIO_DA_POLITICA = Object.freeze({
  autoReview: [true, false], onClean: ['approve', 'wait'], onCaveats: ['approve', 'wait'], onReject: ['request_changes', 'wait'],
});

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function listaDeTexto(v) {
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean);
  return typeof v === 'string' ? v.split(/[,;\s]+/).filter(Boolean) : [];
}

function login(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Só os campos que a conta tem hoje, e só valor do domínio de cada um.
function contaLimpa(a) {
  const conta = { user: login(a.user), owners: listaDeTexto(a.owners) };
  for (const campo of Object.keys(DOMINIO_DA_POLITICA)) {
    if (DOMINIO_DA_POLITICA[campo].includes(a[campo])) conta[campo] = a[campo];
  }
  if (typeof a.padroesRevisao === 'string' && a.padroesRevisao.trim()) conta.padroesRevisao = a.padroesRevisao;
  if (objeto(a.reviewRules) || Array.isArray(a.reviewRules)) conta.reviewRules = a.reviewRules;
  return conta;
}

function contaAntiga(cru) {
  const lista = (Array.isArray(cru.accounts) ? cru.accounts : []).filter((a) => objeto(a) && login(a.user));
  const ativa = lista.find((a) => !a.muted);
  if (ativa) return contaLimpa(ativa);
  // lista só de silenciadas não cai no modo simples: quem a gravou não queria conta agindo
  if (lista.length || !login(cru.ghUser)) return null;
  return contaLimpa({ user: cru.ghUser, owners: cru.owners });
}

function politicaGeralAntiga(cru, conta) {
  const geral = {};
  if (Object.hasOwn(cru, 'autoReview')) geral.autoReview = cru.autoReview !== false;
  if (Object.hasOwn(cru, 'autoApproveAll')) geral.onCaveats = cru.autoApproveAll !== false ? 'approve' : 'wait';
  if (!Object.keys(geral).length) return conta;
  return { ...(conta || { user: '', owners: [] }), ...geral, ...(conta || {}) };
}

function contaDaConfig(cru) {
  const gravada = objeto(cru.conta) ? contaLimpa(cru.conta) : null;
  if (gravada && gravada.user) return politicaGeralAntiga(cru, gravada);
  // conta gravada ainda sem login: é a escolha de política feita antes de o gh ser detectado
  const semLogin = gravada && Object.keys(gravada).length > 2 ? gravada : null;
  const antiga = contaAntiga(cru);
  return politicaGeralAntiga(cru, antiga && semLogin ? { ...semLogin, ...antiga } : antiga || semLogin);
}

function normalizarConfig(cru) {
  if (!objeto(cru)) return {};
  const saida = {};
  for (const chave of [...SETTINGS.map((s) => s.key), ...CHAVES_SO_DE_ARQUIVO]) {
    if (chave !== 'conta' && Object.hasOwn(cru, chave)) saida[chave] = cru[chave];
  }
  if (Object.hasOwn(saida, 'claudeProfiles')) {
    const perfis = Array.isArray(saida.claudeProfiles) ? saida.claudeProfiles : [];
    saida.claudeProfiles = perfis.filter((p) => objeto(p) && TIPOS_DE_PERFIL.includes(p.kind));
  }
  const conta = contaDaConfig(cru);
  if (conta) saida.conta = conta;
  return saida;
}

export default { SETTINGS, EDITAVEIS, CAMPOS_DA_CONTA, DOMINIO_DA_POLITICA, OWNERS_PADRAO, contaLimpa, defaults, sanear, paraGravar, normalizarConfig };
export { SETTINGS, EDITAVEIS, CAMPOS_DA_CONTA, DOMINIO_DA_POLITICA, OWNERS_PADRAO, contaLimpa, defaults, sanear, paraGravar, normalizarConfig };
