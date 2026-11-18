// A tabela ÚNICA das preferências do Farol: chave, padrão, se a tela edita, e como
// sanear o valor que chega.
//
// Por que existe. Até 18/08/2026 uma preferência morava em CINCO lugares: o
// `DEFAULTS` do server.js, a lista `allowed` do updateSettings, o `if (k === 'x')`
// do saneamento, o `settingsMap` da tela antiga e a linha de leitura no
// renderSettings dela. Esquecer UM deles não quebrava nada visível: o `updateSettings`
// descartava a chave desconhecida em silêncio e devolvia `undefined`, a tela mostrava
// "Configuração salva." do mesmo jeito, e a preferência simplesmente não persistia.
// Foi a queixa que originou este arquivo ("toda vez que ocorre um update estou
// perdendo tudo").
//
// Agora os três primeiros saem daqui. Os dois da tela saíram com ela (16/11/2026): o front
// novo (`web/`) não importa este arquivo, manda só a chave editada em POST /api/settings e
// mostra as `ignoradas` que o motor devolve. test/settings-fonte-unica.test.js trava a tabela.
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
  // `soundEnabled`, `theme` e `autostart` saíram desta tabela em 16/11/2026: eram da tela antiga
  // e nada no motor lia. Num config.json antigo são descartadas na carga (normalizarConfig) e
  // somem na próxima gravação; no POST /api/settings voltam em `ignoradas`
  // (test/preferencias-sem-leitor.test.js).
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
  // `aguardarCiParaRevisar` e `aguardarCiParaAprovar` saíram desta tabela em 17/11/2026, regra do
  // dono: o revisor nunca espera o CI, nem para começar nem para aprovar. Num config.json antigo
  // são descartadas na carga (normalizarConfig) e somem na próxima gravação; no POST
  // /api/settings voltam em `ignoradas` (test/preferencias-sem-leitor.test.js). O estado do CI
  // continua chegando à revisão como informação, e o check obrigatório herdado da base continua
  // sem peso (lib/engine/checks-exigidos.js).
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
  // socket: o caminho absoluto de um socket Unix em que o motor escuta NO LUGAR da porta TCP
  // (hospedagem compartilhada atrás de um proxy, lib/escuta-em-socket.js). Mesma regra do bind:
  // arquivo, com reinício. Com socket, a allowlist aceita só o hostPublico, que passa a ser
  // obrigatório, e por isso a autenticação é sempre exigida (lib/fronteira-hospedada.js).
  { key: 'socket', def: '', ui: false, omitirPadraoAoGravar: true, san: (v, _c, f) => f.sanearSocket(v) },
  // Autenticação da API local (A4): 'exigir' liga a exigência em qualquer ambiente.
  // NÃO vem da tela nem do POST /api/settings, porque uma página sem credencial não pode
  // ligar nem desligar a própria proteção. Edição de arquivo, com reinício.
  // `omitirPadraoAoGravar`: no padrão a chave não é escrita no config.json, para quem
  // nunca ligou o recurso não ganhar chave nova por causa dele (CT-COMPAT, item a).
  { key: 'localAuth', def: '', ui: false, omitirPadraoAoGravar: true },
  // A fronteira do motor hospedado (fase 2a). hostPublico: o nome com que o proxy com TLS
  // chega ao motor, que entra na allowlist de Host sem porta. origensPermitidas: as origens
  // exatas de onde o front chama a API, que ganham CORS (lib/http-guard.js e lib/http-cors.js).
  // Qualquer uma das duas preenchida liga a exigência de autenticação, sem chave que desligue
  // (lib/local-auth/modo.js). Só de arquivo, com reinício, pelo mesmo motivo do localAuth: quem
  // chama a API não pode abrir a própria porta. Valor inválido numa das duas impede o boot
  // (lib/fronteira-hospedada.js).
  { key: 'hostPublico', def: '', ui: false, omitirPadraoAoGravar: true, san: (v, _c, f) => f.sanearHostPublico(v) },
  { key: 'origensPermitidas', def: [], ui: false, omitirPadraoAoGravar: true, san: (v, _c, f) => f.sanearOrigensPermitidas(v) },
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
    if (s.omitirPadraoAoGravar && noPadrao(o[s.key], s.def)) delete o[s.key];
  }
  return o;
}

// Lista vazia é o padrão de quem tem padrão de lista vazia: o saneador devolve uma lista
// nova a cada boot, então a identidade não serve para comparar.
function noPadrao(valor, def) {
  if (Array.isArray(def) && def.length === 0) return Array.isArray(valor) && valor.length === 0;
  return valor === def;
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
   - o desfecho em espera (`wait` em `onClean`, `onCaveats` ou `onReject`) saiu do domínio em
     17/11/2026, regra do dono: o revisor nunca espera decisão de gente. O `wait` de um arquivo
     antigo não atravessa, e o campo cai no padrão autônomo (aprova, aprova, pede mudanças) pela
     leitura da política (contas-config.js, `normalizarPolitica`), que registra a conversão;
   - `autoReview` continua: é o liga e desliga do monitoramento. Com a chave geral antiga
     `autoReview` no arquivo, ou com conta vinda do formato antigo sem o marcador
     `esquemaConfig`, a conta que não escolheu revisa pela chave geral (a instância de teste que
     grava `{"autoReview": false}` não nasce revisando quando o gh for detectado);
   - lista só de contas silenciadas vira uma conta sem login que não revisa sozinha (a
     silenciada nunca agia): revisão desligada, até alguém mudar;
   - `seniority` atravessa: o boot ainda a migra para o perfil por pessoa (server.js);
   - perfil do Claude que não é de assinatura (`dir`) nem de chave de API (`apikey`) sai;
   - chave que não está na tabela nem em CHAVES_SO_DE_ARQUIVO é descartada. */
const CAMPOS_DA_CONTA = Object.freeze(['user', 'owners', 'autoReview', 'onClean', 'onCaveats', 'onReject', 'padroesRevisao', 'reviewRules']);
// Lidas direto do arquivo, sem padrão na tabela (lib/engine/instancia-isolada.js e
// espera-conflito.js), e `seniority`, entrada da migração para `people` no boot.
const CHAVES_SO_DE_ARQUIVO = Object.freeze(['instanciaIsoladaPosta', 'aguardarMergeavelParaRevisar', 'seniority']);
const CHAVES_GERAIS_ANTIGAS = Object.freeze(['autoReview', 'autoApproveAll']);
// A conta que não revisa sozinha: o que sobra de uma config só de contas silenciadas. Os
// desfechos são os autônomos: não existe mais desfecho em espera (17/11/2026).
const NAO_AGE = Object.freeze({ autoReview: false });
// As orgs da conta que o gh detecta no primeiro boot, antes de alguém escolher (era o padrão de `owners`).
const OWNERS_PADRAO = Object.freeze(['biudtech']);
const TIPOS_DE_PERFIL = Object.freeze(['dir', 'apikey']);
// Sem `wait` desde 17/11/2026: o revisor nunca espera decisão de gente (contas-config.js).
const DOMINIO_DA_POLITICA = Object.freeze({
  autoReview: [true, false], onClean: ['approve'], onCaveats: ['approve'], onReject: ['request_changes'],
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

// Devolve a conta do formato antigo e diz que ela veio de lá (`legada`), para a política de
// antes da primeira migração valer para ela.
function contaAntiga(cru) {
  const lista = (Array.isArray(cru.accounts) ? cru.accounts : []).filter((a) => objeto(a) && login(a.user));
  const ativa = lista.find((a) => !a.muted);
  if (ativa) return contaLimpa(ativa);
  // lista só de silenciadas não cai no modo simples: quem a gravou não queria conta agindo
  if (lista.length) return { user: '', owners: [], ...NAO_AGE };
  return login(cru.ghUser) ? contaLimpa({ user: cru.ghUser, owners: cru.owners }) : null;
}

// O que a chave geral de revisar valia, lido como o engine lia: a config em memória era
// `{ ...padrões, ...arquivo }` com `autoReview: true` nos padrões, e a leitura era `!== false`.
// `autoApproveAll` só decidia o com ressalvas, que não espera mais ninguém (17/11/2026).
function politicaGeralAntiga(cru, conta, legada) {
  const temChave = CHAVES_GERAIS_ANTIGAS.some((k) => Object.hasOwn(cru, k));
  const antesDaMigracao = legada && !(Number.parseInt(cru.esquemaConfig, 10) >= 1);
  if (!temChave && !antesDaMigracao) return conta;
  const base = conta || { user: '', owners: [] };
  return { ...base, autoReview: base.autoReview ?? cru.autoReview !== false };
}

function contaDaConfig(cru) {
  const gravada = objeto(cru.conta) ? contaLimpa(cru.conta) : null;
  if (gravada && gravada.user) return politicaGeralAntiga(cru, gravada, false);
  // conta gravada ainda sem login: é a escolha de política feita antes de o gh ser detectado
  const semLogin = gravada && Object.keys(gravada).length > 2 ? gravada : null;
  const antiga = contaAntiga(cru);
  return politicaGeralAntiga(cru, antiga && semLogin ? { ...semLogin, ...antiga } : antiga || semLogin, !!antiga);
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

export default { SETTINGS, EDITAVEIS, CAMPOS_DA_CONTA, CHAVES_SO_DE_ARQUIVO, CHAVES_GERAIS_ANTIGAS, DOMINIO_DA_POLITICA, OWNERS_PADRAO, contaLimpa, defaults, sanear, paraGravar, normalizarConfig };
export { SETTINGS, EDITAVEIS, CAMPOS_DA_CONTA, CHAVES_SO_DE_ARQUIVO, CHAVES_GERAIS_ANTIGAS, DOMINIO_DA_POLITICA, OWNERS_PADRAO, contaLimpa, defaults, sanear, paraGravar, normalizarConfig };
