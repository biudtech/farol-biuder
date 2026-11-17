// Parsers/normalizadores de config, puros (texto do textarea de Sistema OU objeto ->
// forma canônica). Sem estado, sem IO. Ver docs/QUALITY.md.
import { PAPEL_LEVELS, DOMAINS, DOMAIN_LEVELS } from './taxonomy.js';
import { APELIDOS_CLAUDE, aceitaEsforco, modeloFraco } from './modelos.js';

// Padrões do time de uma conta (lib/engine/padroes-do-time.js): só texto, sem espaços nas
// pontas e no teto de gravação, que protege o config.json (ele trafega para a tela).
// Vazio devolve '', e quem grava remove o campo.
const TETO_PADROES_GRAVADO = 20000;
function normalizarPadroes(valor) {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, TETO_PADROES_GRAVADO);
}

// mapa de PERFIL { login(minúsculo): { papel?, dominios?{dominio: nivel} } }, validado.
// A UI manda o mapa inteiro; papel/domínio/nível inválidos são descartados, e a
// pessoa sem nada útil sai do mapa (não guarda entrada vazia).
function parsePeople(val) {
  const out = {};
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    for (const [login, p] of Object.entries(val)) {
      const k = String(login || '').trim().toLowerCase();
      if (!k || !p || typeof p !== 'object') continue;
      const person = {};
      if (PAPEL_LEVELS.includes(p.papel)) person.papel = p.papel;
      if (p.dominios && typeof p.dominios === 'object') {
        const dom = {};
        for (const d of DOMAINS) if (DOMAIN_LEVELS.includes(p.dominios[d])) dom[d] = p.dominios[d];
        if (Object.keys(dom).length) person.dominios = dom;
      }
      if (person.papel || person.dominios) out[k] = person;
    }
  }
  return out;
}

// migra o formato antigo (config.seniority = {login: nivel}) pro perfil novo:
// o nível de senioridade vira o `papel` da pessoa. Idempotente.
function migrateSeniorityToPeople(seniority, people) {
  const out = { ...(people || {}) };
  if (seniority && typeof seniority === 'object' && !Array.isArray(seniority)) {
    for (const [login, lvl] of Object.entries(seniority)) {
      const k = String(login || '').trim().toLowerCase();
      if (!k || !PAPEL_LEVELS.includes(lvl)) continue;
      out[k] = { ...(out[k] || {}), papel: (out[k] && out[k].papel) || lvl };
    }
  }
  return out;
}

// Caracteres sem uso legítimo em diretório, chave, URL e que quebram a linha de comando da
// sessão (aspa dupla + newline permitem injeção de comando no shell que abre o claude).
// Nome ficou "ClaudeDir" por ter nascido só pro dir, hoje sanitiza qualquer
// valor que vira variável de shell (dir, apiKey, baseUrl, ver normalizeClaudeProfiles).
// Rejeita em vez de tentar escapar aqui, não existe path, chave ou URL real que precise
// desses caracteres. A aspa simples é tratada por escaping de verdade (shEsc), não por
// rejeição, por ser um caractere que PODE aparecer legitimamente (raro).
function sanitizeClaudeDir(v) {
  let s = String(v == null ? '' : v).trim();
  // "Copiar como caminho" do Explorer do Windows vem com aspas duplas envolvendo o valor
  // inteiro - tira só esse par externo antes de validar,
  // senão todo mundo que colar assim perde o perfil silenciosamente. Aspas no MEIO do
  // valor continuam rejeitadas (motivo de segurança, ver injecao de shell no .cmd).
  const wrapped = s.match(/^"(.*)"$/s);
  if (wrapped) s = wrapped[1].trim();
  if (/["\r\n]/.test(s)) return '';
  return s;
}

function sanitizaParChaveUrl(rawApiKey, rawBaseUrl) {
  const apiKey = typeof rawApiKey === 'string' ? sanitizeClaudeDir(rawApiKey) : '';
  const baseUrl = typeof rawBaseUrl === 'string' ? sanitizeClaudeDir(rawBaseUrl) : '';
  if ((typeof rawApiKey === 'string' && rawApiKey && !apiKey) ||
      (typeof rawBaseUrl === 'string' && rawBaseUrl && !baseUrl)) {
    return null;
  }
  return { apiKey, baseUrl };
}

// Perfil de assinatura: a pasta passa pelo mesmo sanitizador anti-injeção (ela vira valor de
// variável de shell na linha da sessão). Pasta FORNECIDA que não passa rejeita o perfil.
function perfilDePasta(p) {
  const dir = typeof p.dir === 'string' ? sanitizeClaudeDir(p.dir) : '';
  if (typeof p.dir === 'string' && p.dir.trim() && !dir) return null;
  return { id: String(p.id || '').trim(), label: String(p.label || '').trim(), kind: 'dir', dir };
}

// Perfis nomeados de executor do Claude Code. Dois shapes, nunca misturados no mesmo objeto:
//   dir:    {id, label, kind:'dir', dir}           (assinatura; voltou em 15/11/2026. `dir` vazio
//           = a pasta do próprio perfil sob o HOME do Farol, lib/engine/pasta-do-perfil.js)
//   apikey: {id, label, kind:'apikey', apiKey, baseUrl}
// Perfil de outro tipo (login da máquina, o formato de pasta sem `kind` e os demais formatos
// antigos) que ainda esteja num config.json antigo é IGNORADO na leitura, sem derrubar o boot. O array
// de entrada pode vir malformado (config.json editado à mão, ou do PATCH /api/settings) e a
// função devolve SEMPRE um array limpo. Não-array (string, número, objeto, null) vira [].
// Só os campos do shape saem daqui. Os de teto de gasto que um config.json antigo ainda traga
// (`budgetDaily`, `budgetTotal`, `budgetSince`, `budgetByWeekday`, `budgetDates`) não têm
// leitor desde 16/11/2026: são descartados em silêncio, e o perfil continua valendo.
function normalizeClaudeProfiles(val) {
  if (!Array.isArray(val)) return [];
  return val.map(p => {
    if (p && p.kind === 'dir') return perfilDePasta(p);
    if (!p || p.kind !== 'apikey') return null;
    const id = String(p.id || '').trim();
    const label = String(p.label || '').trim();
    // apiKey/baseUrl passam pelo sanitizador anti-injeção: os dois viram valor de variável de
    // shell na linha da sessão headless. Se uma delas foi FORNECIDA mas não
    // passa na sanitização, o perfil inteiro é rejeitado (tratamento agressivo pra segurança:
    // não tenta "corrigir").
    const par = sanitizaParChaveUrl(p.apiKey, p.baseUrl);
    if (!par) return null;
    return { id, label, kind: 'apikey', apiKey: par.apiKey, baseUrl: par.baseUrl };
  }).filter(p => p && p.id && (p.kind === 'dir' || p.apiKey));
}

function normalizeClaudeProfileId(val) {
  return String(val || '').trim();
}

// Objeto env (JS): usado só por Engine.ghEnv (server.js), que por sua vez alimenta as
// sessões headless.
//
// Limpa a autenticação herdada ANTES de aplicar só a do kind resolvido.
// ghEnv parte de `{ ...process.env }`: se a própria máquina já tiver ANTHROPIC_API_KEY
// setada no ambiente (uso pessoal do claude CLI fora do Farol, por exemplo), um perfil
// de assinatura seria silenciosamente ANULADO, a ordem de precedência oficial do
// claude CLI dá a API key do ambiente por cima do login OAuth, sem erro nenhum aparecer.
// CLAUDE_CODE_OAUTH_TOKEN também vence o login salvo e precisa sumir: um token expirado
// herdado continuaria sendo usado mesmo depois de renovar o /login do perfil.
function applyClaudeAuthEnv(env, auth) {
  delete env.CLAUDE_CONFIG_DIR;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (auth && auth.kind === 'apikey' && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.baseUrl) env.ANTHROPIC_BASE_URL = auth.baseUrl;
  } else if (auth && auth.kind === 'dir' && auth.dir) {
    env.CLAUDE_CONFIG_DIR = auth.dir;
  }
}

// Escaping de aspa simples pra valor que entra numa atribuição shell (achado de auditoria
// adversarial documentado no CLAUDE.md: sem escapar, um valor com aspa simples escapava da
// atribuição e executava comando arbitrário). Compartilhado pelos dois montadores posix.
const shEsc = s => String(s).replace(/'/g, "'\\''");

// As mesmas cinco vars de auth Claude que applyClaudeAuthEnv apaga do env: as três da API
// (`ANTHROPIC_*`), o CLAUDE_CODE_OAUTH_TOKEN e o CLAUDE_CONFIG_DIR. applyClaudeAuthEnv já
// as apaga do env do filho, mas isso não basta: o profile do usuário é sourceado
// DEPOIS do env montado (o -l do `/bin/sh -lc` do headless),
// então um `export ANTHROPIC_API_KEY` perdido no ~/.profile
// re-injeta a chave POR CIMA do perfil resolvido e anula em silêncio o perfil de assinatura
// do Farol. Por isso o unset é emitido DENTRO do shell, depois de qualquer sourcing e antes
// do exec do claude (G21).
//
//
// A lista cobre as cinco, e não só as três de credencial, porque as outras duas são a mesma
// classe de furo: ANTHROPIC_BASE_URL redireciona o endpoint (mandaria credencial de
// assinatura pra host de terceiro) e CLAUDE_CONFIG_DIR troca a conta logada. O shell cobrir
// menos que o env seria uma inconsistência sem razão.
const POSIX_AUTH_UNSET = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN';

// Prefixo da linha headless posix (`/bin/sh -lc "<isto><comando>"`).
//
// O unset limpa o que o profile do usuário tenha exportado depois do env montado. Perfil de
// chave de API limpa só o token OAuth: a chave dele viaja pelo env, e re-setar seu valor aqui
// a colocaria na linha de comando, visível no `ps` de qualquer processo. Perfil de assinatura
// limpa tudo e re-exporta a pasta, escapada: o unset seco apagaria junto a pasta do perfil, e
// a sessão cairia no login padrão do usuário do processo (a pasta não é segredo).
function claudeAuthPosixPrefix(auth) {
  if (auth && auth.kind === 'apikey' && auth.apiKey) return 'unset CLAUDE_CODE_OAUTH_TOKEN; ';
  if (auth && auth.kind === 'dir' && auth.dir) return `${POSIX_AUTH_UNSET}; export CLAUDE_CONFIG_DIR='${shEsc(auth.dir)}'; `;
  return `${POSIX_AUTH_UNSET}; `;
}

// --- modelo e esforco das sessoes autonomas ---------------------------------
// Estes dois valores entram na LINHA DE COMANDO montada por concatenacao e passada a um
// shell (/bin/sh -lc). Sao a unica config do Farol
// nessa posicao, entao a validacao aqui e por allowlist, nunca por escaping.
//
// Fora da lista de proposito:
//  - opusplan: alterna Opus no plan mode e Sonnet na execucao, e `claude -p` nao tem plan
//    mode. A sessao inteira cairia pra Sonnet sob um rotulo que diz Opus.
//  - default: so se distingue de '' quando existe ANTHROPIC_MODEL ou model no settings.json,
//    e o Farol nunca seta nenhum dos dois. Seriam duas opcoes indistinguiveis.
//  - opus[1m] / sonnet[1m]: colchete e glob pro /bin/sh. Rodando com cwd no WORKSPACE, a
//    palavra `opus[1m]` casaria com um arquivo chamado `opus1` e viraria outro argumento,
//    calado. Sem match o sh deixa passar, entao "funciona quase sempre", que e pior.
// 'auto' é alias do Farol (roteador por métricas do PR), nunca flag do CLI.
// A lista sai do catalogo (lib/modelos.js): selecao nova entra la, e a config passa a
// aceita-la sem uma segunda lista aqui que alguem precisaria lembrar de atualizar.
const MODEL_ALIASES = APELIDOS_CLAUDE;
// escotilha pra modelo novo sem precisar de release do Farol: aceita nome completo
// (claude-opus-5) escrito a mao no config.json. So [a-z0-9-], zero metacaractere.
const MODEL_FULL_RE = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];

// Devolve o valor limpo, ou null quando invalido (o chamador decide se descarta ou se
// mantem o anterior). '' e valido e significa "nao passa a flag".
function sanitizeModel(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  if (s.length > 60 || modeloFraco(s)) return null;
  if (MODEL_ALIASES.includes(s)) return s;
  return MODEL_FULL_RE.test(s) ? s : null;
}

function sanitizeEffort(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  return EFFORT_LEVELS.includes(s) ? s : null;
}

function sanitizeClaudeModel(v) {
  const s = sanitizeModel(v);
  if (s === null) return null;
  if (s === '') return '';
  // 'auto' permanece válido na config (roteador do Farol); buildModelFlags
  // é quem impede --model auto na cmdline.
  return s;
}

function sanitizeClaudeEffort(v) {
  return sanitizeEffort(v);
}

// Revisões headless simultâneas por conta: inteiro 1..4, null pro inválido (o
// chamador mantém o anterior/padrão). Diferente de modelo/esforço, NÃO entra em
// linha de shell (só controla o escalonador), então clamp simples basta. O teto 4
// segue a régua do MAX_LOTES do fan-out: acima disso o gargalo vira a máquina.
function sanitizeParallelReviews(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(4, Math.max(1, n));
}

/* Teto GLOBAL de revisoes simultaneas somando todas as contas (Politica 3 da spec
   2026-09-10-justica-de-fila-entre-orgs). Difere do sanitizeParallelReviews em duas
   coisas, e as duas sao de proposito:

   - 0 e um valor VALIDO e significa DESLIGADO (sem teto global), que e o default e o
     comportamento de sempre. O teto por conta nao tem esse estado: ele sempre vale.
   - o clamp e 1..8 em vez de 1..4, porque este teto soma contas e nao PRs da mesma.

   Lixo (NaN, string, null) devolve null, e quem chama resolve pro default. Negativo
   vira 0 (desligado) em vez de 1: config torta nao pode ligar uma trava que ninguem
   pediu. */
function sanitizeGlobalParallelReviews(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  return Math.min(8, n);
}

/* Endereço em que o servidor HTTP escuta (config.bind, só por arquivo). Aceita IPv4,
   IPv6 entre colchetes (a forma que aparece no cabeçalho Host) ou nome de host; o valor
   entra no listen e na allowlist de Host, então qualquer outra coisa (porta junto,
   esquema, espaço, vazio) volta para o loopback, que é o lado seguro. No boot, o valor
   preenchido no arquivo que cairia nesse retorno impede a subida (lib/fronteira-hospedada.js). */
const BIND_PADRAO = '127.0.0.1';
// IPv6 tem pelo menos dois `:` (o menor é `::`); `[:]` passava e caía no erro do listen
const BIND_IPV6 = /^\[[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*\]$/;
// nome de host: rótulos de 1 a 63, separados por um ponto só, que nunca começam nem terminam
// em `-` (então `-`, `.farol`, `farol.` e `farol..x` voltam para o loopback)
const BIND_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
function sanearBind(valor) {
  // o navegador manda o Host em caixa baixa, e a allowlist compara por igualdade exata;
  // o que não é texto vira vazio, que nenhuma das formas aceita
  const v = typeof valor === 'string' ? valor.toLowerCase() : '';
  if (BIND_IPV6.test(v)) return v;
  // só dígitos e pontos é IPv4, e então cada octeto precisa caber em 0..255
  if (/^[\d.]+$/.test(v)) return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every(o => Number(o) <= 255) ? v : BIND_PADRAO;
  return v.length <= 253 && BIND_HOST.test(v) ? v : BIND_PADRAO;
}

/* Nome público do motor hospedado (config.hostPublico, só por arquivo): o Host que chega
   pelo proxy com TLS. Um nome de host ou um IPv4, em caixa baixa, e mais nada: sem esquema,
   sem caminho, sem porta, sem espaço. É o molde do bind, menos o IPv6 entre colchetes. O que
   não serve vira vazio, que é "sem host público": a allowlist de Host fica só com o
   loopback. Nunca lança. */
function sanearHostPublico(valor) {
  const v = typeof valor === 'string' ? valor.toLowerCase() : '';
  if (v === '' || BIND_IPV6.test(v)) return '';
  return sanearBind(v) === v ? v : '';
}

/* Origens de onde o front pode chamar a API (config.origensPermitidas, só por arquivo). Cada
   item é a origem EXATA, como o navegador a escreve no cabeçalho Origin: `https://host` ou
   `https://host:porta`, em caixa baixa, sem caminho, sem barra final, sem curinga, sem
   usuário. A porta padrão do esquema não se escreve: o navegador nunca a manda, e o item
   ficaria na lista sem casar com nada. `http://` só vale para `localhost` e `127.0.0.1`: é o
   front em desenvolvimento, na máquina de quem desenvolve; em qualquer outro host seria
   aceitar chamada de uma página que a rede pode ter trocado no caminho. Item que não serve é
   descartado, e o que não é lista vira lista vazia. Nunca lança. */
const ORIGEM_EXATA = /^(https?):\/\/([^/:?#@\s]+)(?::([1-9]\d{0,4}))?$/;
const PORTA_PADRAO_DO_ESQUEMA = { https: 443, http: 80 };
const HOSTS_DE_DESENVOLVIMENTO = ['localhost', '127.0.0.1'];
function sanearOrigem(item) {
  const m = ORIGEM_EXATA.exec(typeof item === 'string' ? item.toLowerCase() : '');
  if (!m) return '';
  const [origem, esquema, host, porta] = m;
  if (sanearHostPublico(host) !== host) return '';
  if (porta !== undefined && (Number(porta) > 65535 || Number(porta) === PORTA_PADRAO_DO_ESQUEMA[esquema])) return '';
  if (esquema === 'http' && !HOSTS_DE_DESENVOLVIMENTO.includes(host)) return '';
  return origem;
}
function sanearOrigensPermitidas(valor) {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.map(sanearOrigem).filter(Boolean))];
}

// Nem todo modelo aceita todo nivel de esforco. O alias so diz a FAMILIA, nao a versao
// concreta (o alias `opus` pode resolver num Opus 4.6, que nao tem xhigh), entao o Farol
// nao adivinha: filtra so o que o catalogo afirma por familia. Quem decide e o catalogo, e
// por familia: o nome completo fixado a mao segue a mesma regra do apelido. Nos demais,
// deixa o CLI decidir.
function effortForModel(model, effort) {
  if (!effort) return '';
  return aceitaEsforco(model) ? effort : '';
}

// Chave de card no formato PROJETO-NUMERO. O texto vem em maiúscula porque a
// branch quase sempre nasce minúscula, e a chave é a mesma coisa nos dois casos.
// O limite de 6 dígitos evita casar número de versão colado num identificador.
const CHAVE_CARD = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

function extractCardKeys(texto, projectKeys = []) {
  const permitidos = new Set((projectKeys || []).map((p) => String(p).toUpperCase()));
  const vistos = new Set();
  const saida = [];
  for (const m of String(texto || '').toUpperCase().matchAll(CHAVE_CARD)) {
    const chave = `${m[1]}-${m[2]}`;
    if (permitidos.size && !permitidos.has(m[1])) continue;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(chave);
  }
  return saida;
}

// Pre-confianca do workspace no ~/.claude.json: decide O QUE muda, sem tocar em disco.
// O chamador (ensureWorkspaceTrusted, server.js) le, chama isto e so grava se changed.
//
// A condicao de reescrita olha SO hasTrustDialogAccepted de proposito. O onboarding e
// cortesia (pula a tela de boas-vindas); a confianca e o que evita o dialogo bloqueante
// que mata a autonomia. O Claude Code regrava o arquivo inteiro a partir da copia que
// tem em memoria e, nisso, come o campo de onboarding que o Farol acabou de escrever:
// exigir os dois true fazia o Farol reescrever o arquivo a cada boot pra sempre, e cada
// reescrita e uma chance de o outro lado ler o arquivo pela metade (farol.log de 10 e
// 11/09/2026, "~/.claude.json ilegivel" em todo boot).
//
// O claude ora registra a chave com \ ora com /: semeia as duas variantes.
function workspaceTrust(data, workspace) {
  const saida = data && typeof data === 'object' ? data : {};
  saida.projects = saida.projects && typeof saida.projects === 'object' ? saida.projects : {};
  let changed = false;
  for (const key of [workspace, String(workspace).replace(/\\/g, '/')]) {
    const entry = saida.projects[key] || {};
    if (entry.hasTrustDialogAccepted === true) continue;
    entry.hasTrustDialogAccepted = true;
    entry.hasCompletedProjectOnboarding = true;
    saida.projects[key] = entry;
    changed = true;
  }
  return { data: saida, changed };
}

/* Socket Unix em que o motor escuta no lugar da porta TCP (config.socket, só por arquivo;
   lib/escuta-em-socket.js). O formato, sem tocar no disco: caminho absoluto, sem nulo, sem
   caractere de controle, sem barra no fim e dentro do limite do sun_path do Linux (108 bytes
   com o nulo do fim, então 107). Devolve '' quando serve, senão o motivo. A pasta é conferida
   no boot, com o disco (lib/fronteira-hospedada.js). */
const SOCKET_MAX_BYTES = 107;
function motivoDoFormatoDoSocket(valor) {
  if (typeof valor !== 'string') return 'não é texto';
  if (valor.includes('\0')) return 'tem o caractere nulo';
  if (!valor.startsWith('/')) return 'não é um caminho absoluto';
  if (valor.endsWith('/')) return 'termina em barra, é uma pasta';
  if (/[\u0001-\u001f\u007f]/.test(valor)) return 'tem caractere de controle';
  const bytes = Buffer.byteLength(valor, 'utf8');
  if (bytes > SOCKET_MAX_BYTES) return `tem ${bytes} bytes, e o limite de socket Unix no Linux é ${SOCKET_MAX_BYTES}`;
  return '';
}

/* O saneador da tabela: o caminho como veio quando o formato serve, '' quando não (sem socket,
   a porta TCP). Valor preenchido que não serve impede o boot antes daqui. Nunca lança. */
function sanearSocket(valor) {
  return typeof valor === 'string' && valor !== '' && !motivoDoFormatoDoSocket(valor) ? valor : '';
}

const parse = {
  parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId, workspaceTrust,
  applyClaudeAuthEnv, claudeAuthPosixPrefix, shEsc,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
  sanitizeClaudeModel, sanitizeClaudeEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, extractCardKeys,
  normalizarPadroes, TETO_PADROES_GRAVADO, sanearBind, sanearHostPublico, sanearOrigensPermitidas,
  SOCKET_MAX_BYTES, motivoDoFormatoDoSocket, sanearSocket,
};
export default parse;
export {
  parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId, workspaceTrust,
  applyClaudeAuthEnv, claudeAuthPosixPrefix, shEsc,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
  sanitizeClaudeModel, sanitizeClaudeEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, extractCardKeys,
  normalizarPadroes, TETO_PADROES_GRAVADO, sanearBind, sanearHostPublico, sanearOrigensPermitidas,
  SOCKET_MAX_BYTES, motivoDoFormatoDoSocket, sanearSocket,
};
