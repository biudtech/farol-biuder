import { assertExternalNodeRuntime } from './lib/node-runtime.js';
import { repescarRetry } from './lib/engine/review-retry.js';
assertExternalNodeRuntime();
// Farol: engine de monitoramento de PRs + servidor http da API.
// Porta a logica do antigo pr-reviewer.ps1: o polling do GitHub roda aqui
// (so comandos gh, sem gastar tokens de IA); a revisao em si roda numa sessao
// headless do Claude Code.
// Zero dependencias externas: roda com Node puro.
import fs from 'node:fs';
import { politicaDeInicio } from './lib/engine/review-scope.js';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { iniciarManutencaoDoEngine } from './lib/technical-review/material-session-proof.js';
import { snapshotDecisions, snapshotReviewActions } from './lib/engine/snapshot-decisions.js';
import { snapshotUsage } from './lib/engine/snapshot-usage.js';
import { deForaParaTela, emRetentativaParaTela } from './lib/engine/de-fora.js';
import { iniciarChecagem, buscarOrganizacao, checagemParaTela } from './lib/engine/checagem-em-curso.js';

// Camada base: versão, plataforma e caminhos (compartilhada com os módulos de lib/).
import {
  instanciaIsolada, executadoDireto, rodandoComoRoot, APP_VERSION, APP_NAME,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, IGNORED_FILE, BASELINE_FILE,
  INFLIGHT_FILE, TEMPLATE_DIR, CLAUDE_JSON_DA_CONFIANCA,
} from './lib/paths.js';

// Helpers puros e utilitários movidos pra lib/ (ver docs/QUALITY.md).
// A Engine abaixo compõe estes módulos; a decomposição por responsabilidade segue nas ondas 2+.
import { DEFAULT_PORT, TEMPOS } from './lib/constants.js';
import env from './lib/env.js';
import { modelLabel, isPermanentBranch, logStamp, semControle } from './lib/format.js';
import { gravarLinhaDeLog } from './lib/log-arquivo.js';
import {
  parsePeople, migrateSeniorityToPeople,
  normalizeClaudeProfiles, normalizeClaudeProfileId, workspaceTrust, applyClaudeAuthEnv,
  sanitizeClaudeModel, sanitizeClaudeEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, sanearBind, sanearHostPublico, sanearOrigensPermitidas, sanearSocket } from './lib/parse.js';
import io, { ensureDir, readJson, writeJsonAtomic, writeTextAtomic, copyRecursive, prependPathDirs, priorizarNoPath } from './lib/io.js';
import pushbackMod from './lib/engine/pushback.js';
import { carregarLimites, limiteAte, escolherPerfil } from './lib/engine/limite-plano.js';
import decisionMod from './lib/engine/decision.js';
import ghMod from './lib/engine/gh-queries.js';
import limiteGhMod from './lib/engine/limite-gh.js';
import { estacionamentoDoBoot, ancoraAposReinicio } from './lib/engine/estado-do-boot.js';
import contasConfig from './lib/engine/contas-config.js';
import versaoClaude from './lib/engine/versao-claude.js';
import { catalogoParaTela as catalogoDeModelos } from './lib/modelos.js';
import sessionMod from './lib/engine/session.js';
import staleMod from './lib/engine/rereview-stale.js';
import labelsATirar from './lib/engine/labels-a-tirar.js';
import labelPropriaOrfa from './lib/engine/label-propria-orfa.js';
import { registrarBaseline, lerBaseline } from './lib/engine/baseline.js';
import scopeMod from './lib/engine/pr-scope.js';
import reviewMod from './lib/engine/review.js';
import retomadaMod from './lib/engine/retomada-duravel.js';
import retomadaVarredura from './lib/engine/retomada-varredura.js';

// Resolve o shape de auth a partir de um perfil já escolhido (sem cascata de conta). Mora em
// lib/engine/perfil-claude.js desde a A2: o aviso de perfil quebrado lê a MESMA regra.
import perfilMod from './lib/engine/perfil-claude.js';
import fileProofMod from './lib/engine/file-proof.js';
import wsTmpMod from './lib/engine/workspace-tmp.js';
import skipMod from './lib/engine/skip-review.js';
import destravaMod from './lib/engine/destrava.js';
import vistosMod from './lib/engine/vistos-reconciliacao.js';
import checksMod from './lib/engine/checks-exigidos.js';
import esperaProvaMod from './lib/engine/espera-prova.js';
import usageMod from './lib/engine/usage.js';
import falhasMod from './lib/engine/falhas.js';
import tentativasMod from './lib/engine/usage-tentativas.js';
import { carregarConsumo, iniciarTelemetria, historicoIndisponivel, chavesComDecisao } from './lib/engine/telemetria-do-motor.js';
import diagnosticoMod from './lib/engine/diagnostico.js';
import { EDITAVEIS, defaults as settingsDefaults, sanear, paraGravar, normalizarConfig } from './lib/settings.js';
import { sanearSoDeArquivo, lerConfigOuRecusar, subirOuRecusar } from './lib/fronteira-hospedada.js';
import { parseJiraSites, maskJiraSites } from './lib/jira/sites.js';
import credMod from './lib/jira/credentials.js';
import jiraMod from './lib/engine/jira.js';
import { startServer } from './lib/http-server.js';
import { registrarSaidaOrdenada } from './lib/engine/saida-ordenada.js';

function aplicarPathDoBoot(extras, sempre = []) {
  const atual = process.env.PATH;
  process.env.PATH = priorizarNoPath(prependPathDirs(atual, extras, fs.existsSync) || atual, sempre);
}

// App aberto pelo Finder/Dock ou atalho herda PATH reduzido (gh/claude somem). O ~/.local/bin do instalador
// do claude vai SEMPRE na frente, exista ou não, para nenhum claude antigo ganhar dele (26/09/2026).
const extras = ['/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin')];
aplicarPathDoBoot(extras, [path.join(os.homedir(), '.local', 'bin')]);

// A telemetria do GitHub CLI relanca um "gh send-telemetry" DESTACADO (sem console)
// que roda tzutil /g; como processo destacado nao herda o console oculto do Farol,
// o Windows aloca um console novo VISIVEL e pisca uma janela a cada batch. Todos os filhos herdam process.env (ghEnv espalha,
// e chamadas gh sem env herdam direto), entao UMA linha aqui cobre gh direto, gh
// dentro das sessoes do claude.
process.env.GH_TELEMETRY = 'false';

// Os padrões vêm da tabela ÚNICA (lib/settings.js), que é também quem diz o que a
// tela pode editar e como cada valor é saneado. Antes eram três listas paralelas
// aqui dentro, e esquecer uma delas fazia a preferência sumir em silêncio.
const DEFAULTS = settingsDefaults(DEFAULT_PORT);

// Os saneadores da tabela recebem os parsers por injeção: assim lib/settings.js
// continua puro (sem importar meio mundo) e existe UM lugar só onde a lista de
// parsers usada por preferência é montada.
const PARSERS = {
  parsePeople, normalizeClaudeProfiles, normalizeClaudeProfileId,
  sanitizeClaudeModel, sanitizeClaudeEffort,
  sanitizeParallelReviews, sanitizeGlobalParallelReviews, parseJiraSites, sanearBind, sanearHostPublico, sanearOrigensPermitidas, sanearSocket,
};

// carência anti-lag do índice de busca do GitHub: logo após EU postar um review, o PR
// ainda ecoa em --review-requested por alguns minutos (a busca é indexação assíncrona).
// Nesse eco, "está pedido" não é o autor re-solicitando, é atraso do índice; sem a
// carência, todo auto-approve virava um segundo review headless completo. Custo do
// trade-off: um re-request REAL feito dentro da janela entra com atraso máximo de
// carência + 1 intervalo de polling.
const REREQ_GRACE_MS = 10 * 60 * 1000;

// A poda do ESTACIONAMENTO segue a mesma régua (v2.57.4): uma ausência do panorama não
// prova PR fechado, e aqui a poda errada custa mais do que na autoanálise, porque
// des-estacionar relança sozinha uma sessão fadada à mesma falha (o loop pago do G15).
// Leitura mais provável das 7 linhas ERROR do biud-esg#268 em 83 minutos (03/09/2026),
// sem commit novo: o índice piscou, a key saiu, a sessão relançou e estacionou de novo.
const PARKED_PRUNE_STRIKES = 2;
// --- Engine -----------------------------------------------------------------
class Engine extends EventEmitter {
  constructor() {
    super();
    const warn = (m) => this.log('WARN', m); // corrupção de estado precisa aparecer no farol.log
    // config.json antigo (várias contas, modo simples, chaves do que saiu) vira o formato de hoje sem lançar
    // o arquivo como veio, para o rastro da carga (contas-config.js). Presente e ilegível, LANÇA: o motor não sobe com os padrões no lugar dele
    this.configCrua = lerConfigOuRecusar((m) => this.log('ERROR', m));
    this.config = { ...DEFAULTS, ...normalizarConfig(this.configCrua) };
    // bind, hostPublico e origensPermitidas são só de arquivo e chegam ao listen, à allowlist e ao
    // porteiro: saneia aqui, uma vez, para todo leitor. Valor inválido nas duas da fronteira LANÇA,
    // antes de qualquer gravação: o motor não sobe (lib/fronteira-hospedada.js)
    sanearSoDeArquivo(this, PARSERS);
    delete this.config.autoOpenReview; // chave antiga (sessão interativa); o modo autonomo tem semantica nova
    // config.json pode estar malformado (editado à mão,
    // corrompido, versão antiga/incompatível) — normaliza no boot pra nunca derrubar o
    // app (achado de auditoria: claudeProfiles como string/objeto lançava TypeError em
    // resolveClaudeConfigDir/allClaudeAuthInfo/ghEnv, quebrando toda busca de PR).
    this.config.claudeProfiles = normalizeClaudeProfiles(this.config.claudeProfiles);
    this.config.claudeProfileId = normalizeClaudeProfileId(this.config.claudeProfileId);
    // config antiga com chaves de formatos que saíram (corte 09) não derruba o boot: chave sem
    // leitor é ignorada, e perfil que não é de assinatura nem de chave de API cai fora no normalizeClaudeProfiles
    this.config.reviewModel = sanitizeClaudeModel(this.config.reviewModel) || '';
    this.config.reviewEffort = sanitizeClaudeEffort(this.config.reviewEffort) || '';
    // intervalo do polling: o caminho HTTP (updateSettings) já clampa em 180..3600, mas
    // o boot engolia config.json editado à mão. Não numérico virava Math.max(180, NaN)
    // = NaN no schedule(), e setTimeout(fn, NaN) dispara em ~1ms: polling contínuo
    // contra o GitHub até o rate limit. Mesma expressão do updateSettings, de propósito.
    // Piso de 180s (decisão do dono, 16/08/2026): 1 e 2 minutos eram curtos
    // demais; config antiga com 60/120 é clampada pra 180 aqui mesmo.
    this.config.intervalSeconds = Math.min(3600, Math.max(180, parseInt(this.config.intervalSeconds, 10) || DEFAULTS.intervalSeconds));
    // paralelismo por conta: mesmo tratamento (boot engole config.json editado à mão);
    // o escalonador clampa de novo por defesa em profundidade (parallelLimit em review.js)
    this.config.parallelReviews = sanitizeParallelReviews(this.config.parallelReviews) ?? DEFAULTS.parallelReviews;
    // teto TOTAL desta instância (Politica 3): mesmo tratamento de boot, e o escalonador
    // clampa de novo (globalParallelLimit em review.js). 0 = sem teto total.
    this.config.globalParallelReviews = sanitizeGlobalParallelReviews(this.config.globalParallelReviews) ?? DEFAULTS.globalParallelReviews;
    // perfil de review por pessoa (papel + matriz por domínio); migra a senioridade plana antiga pro campo `papel`
    this.config.people = migrateSeniorityToPeople(this.config.seniority, parsePeople(this.config.people));
    delete this.config.seniority;
    env.setDebugSpawns(this.config.debugSpawns); // espelha pro logger de spawns
    this.status = 'starting';        // starting | checking | idle | error
    this.lastError = null;
    this.lastCheckAt = null;
    this.nextCheckAt = null;
    this.panorama = [];
    this.queue = [];
    // assinatura do Claude -> { ate, em }: até quando ela está no limite do plano
    carregarLimites(this);
    this.staleInfo = {};              // key do PR -> { stale, head, lastState } (gate da re-revisao automatica; interno, fora do snapshot)
    this.activeReviews = new Map();  // id -> { keys, label, mode, startedAt }
    this.sessionSeq = 0;
    this.headlessQueue = [];
    this.headlessBusyAccounts = new Map(); // conta -> nº de revisões headless rodando (teto por conta = config.parallelReviews, default 1)
    /* Rodizio por org (Politica 1 da spec 2026-09-10-justica-de-fila-entre-orgs):
       org (owner, minusculo) -> { seq, at } da ultima revisao headless INICIADA dela.
       O escalonador da a proxima vaga pra org de menor `seq`, e org ausente do Map
       (nunca atendida) ganha de todas. `seq` e um contador monotonico e nao o relogio,
       porque o escalonador dispara varias revisoes no mesmo milissegundo e o empate
       apagaria a alternancia justamente no lote que a feature existe pra resolver;
       `at` fica so pra tela dizer "atendida ha 12 min", nunca decide a vez.

       EFEMERO de proposito, como headlessBusyAccounts: o rodizio e sobre a fila VIVA.
       Persistir a ultima org atendida faria o primeiro PR depois de um restart herdar
       uma divida de ontem, e o app abriria ja devendo a vez pra alguem. */
    this.orgLastStart = new Map();
    this.headlessSeq = 0;
    this.decisions = readJson(path.join(STATE_DIR, 'decisions.json'), { pending: [], resolved: [] }, warn);
    this.pushbacks = readJson(path.join(STATE_DIR, 'pushbacks.json'), {}, warn); // { key do PR: { author, outcome, note, at, source, status, confidence } }
    // registros antigos (sem source) eram todos marcados à mão e confirmados
    for (const v of Object.values(this.pushbacks)) { if (v && !v.source) { v.source = 'manual'; v.status = 'confirmed'; } }
    this.pushbackScanned = readJson(path.join(STATE_DIR, 'pushback-scanned.json'), {}, warn); // { key: marcador da última atividade do autor já avaliada }
    this.reReviewLaunched = readJson(path.join(STATE_DIR, 'rereview-launched.json'), {}, warn); // { key: { head, dia, rodadas } da re-revisão automática; string legada = só o head }
    this.headQuietoDesde = {}; // { key: { head, at } } debounce do round automático, só memória
    // Relógio LOCAL das labels `<login>:revisando` de outras pessoas: { key do PR:
    // { login minúsculo: epochMs da primeira vez que ESTE Farol viu } }. Existe
    // porque a label não carrega hora nenhuma e uma sessão que morreu deixa a
    // label presa pra sempre, calando a frota naquele PR (ver marcarLabelsVistas).
    this.labelVistaDesde = readJson(path.join(STATE_DIR, 'label-vista.json'), {}, warn);
    this.labelVistaObservadaEm = readJson(path.join(STATE_DIR, 'label-vista-observada.json'), 0, warn);
    // { key: epoch do sinal } do destrave por estado novo (lib/engine/destrava.js): o mesmo
    // commit ou pedido de revisão nunca destrava duas vezes, nem depois de reinício
    this.destravados = destravaMod.loadDestravados(warn);
    this.skipComentado = skipMod.loadSkipComentado(warn); // { key: { at, quem } } âncora da saída de cena silenciosa ("outra pessoa já está revisando"; desde 28/08/2026 nada é comentado no PR, o aviso é toast)
    this.activity = new Map();       // id de sessão -> feed de eventos ao vivo
    this.running = new Map();        // id de sessão -> { child, cancelled } (só headless)
    this.retryAfterNet = new Map();  // key do PR -> { tries, pr } da re-revisão pós-falha transitória
    // referência de retomada durável (CT-RET): key do PR -> entrada, espelhada no
    // inflight.json por writeInflight; só um desfecho a consome (lib/engine/retomada-duravel.js)
    this.retomadas = new Map();
    // G15: estacionamento persistido; era memória pura e cada reinício (inclusive
    // o do próprio auto-update) relançava sessões fadadas à mesma falha conhecida
    // o Array.isArray é o guarda-corpo do formato: readJson só protege de JSON
    // inválido, e `{}` é JSON VÁLIDO que faz `new Set` lançar (objeto não é
    // iterável), derrubando o boot inteiro por causa de um arquivo de estado
    // corrompido (gravação interrompida, edição à mão). Formato errado degrada
    // pra estacionamento vazio, que é recuperável.
    // Dois formatos no disco: a lista crua de keys (até a v2.57.3) e `{ keys, motivos }`
    // (v2.57.4, ver saveAutoReviewParked em lib/engine/review.js). Lista antiga entra
    // sem motivo; objeto sem `keys` (inclusive o `{}` corrompido) degrada pra vazio.
    // O que parou por orçamento num estado antigo não volta ao estacionamento: o teto de
    // gasto saiu em 16/11/2026 (estacionamentoDoBoot, lib/engine/estado-do-boot.js).
    const parkedSalvo = estacionamentoDoBoot(readJson(path.join(STATE_DIR, 'auto-review-parked.json'), [], warn));
    this.autoReviewParked = new Set(parkedSalvo.keys); // keys que falharam sem ser rede (ou foram canceladas): aguardam ação manual, não relançam sozinhas
    // motivo e hora de cada estacionamento, pra tela (só de key que está no Set)
    this.parkedMotivos = parkedSalvo.motivos;
    // Uma linha, uma vez: o arquivo é regravado sem os soltos, e o boot seguinte não repete.
    if (parkedSalvo.soltos.length) {
      this.saveAutoReviewParked();
      this.log('INFO', `teto de gasto removido: ${parkedSalvo.soltos.length} PR(s) estacionado(s) por orçamento voltaram à fila automática: ${parkedSalvo.soltos.join(', ')}.`);
    }
    this.parkedPruneStrikes = new Map(); // key estacionada -> ausências SEGUIDAS do panorama (memória; reinício zera, lado seguro)
    // registro de consumo: o agregado (usage.json, por dia/tipo/conta/modelo) e o diário de
    // sessões, permanente e sem poda. Aqui só se lê; o banco da telemetria (this.telemetria) abre,
    // importa os JSON e passa a guardar o diário no start(), depois do listen (iniciarConsumo)
    carregarConsumo(this, warn);
    this.seen = new Set();
    this.reviewedKeys = new Set(); // PRs abertos que eu ja revisei (gh --reviewed-by)
    this.reReviewedKeys = new Set(); // re-requests que ja voltaram pra fila (evita re-surgir todo ciclo)
    // keys pedidos a mim no último ciclo BOM: preserva fila e "é meu" quando as buscas
    // --review-requested falham (falha parcial não zera o radar). De propósito NÃO é
    // persistido: após reinício, um 1º ciclo já com falha preserva um Set vazio, igual
    // ao comportamento antigo nesse canto (seen e baseline cobrem o essencial entre boots).
    this.mineKeys = new Set();
    this.token = null;
    this.tokenOk = false;
    this.doctorInfo = null;
    this.timer = null;
    this.checking = false;

    this.prepareHome();
    this.loadSeen();
    this.loadIgnorados();
    this.recoverInflight();
    // a tentativa de sessão que o processo anterior deixou aberta vira linha `interrompida` no
    // Consumo (A1, item 9), mas só no start(), depois do listen: aqui uma segunda instância no
    // mesmo FAROL_HOME fecharia as tentativas vivas da primeira (iniciarConsumo)
    // prova por arquivo de PR morto há semanas não serve pra nada (G20, best-effort):
    // podar só custa uma revisão cheia na próxima vez, nunca postagem errada
    try { fileProofMod.pruneFileProofs(); } catch { /* best-effort */ }
    try { scopeMod.pruneScopes(); } catch { /* best-effort */ } // escopo materializado do PR
    // rascunho que a SESSÃO deixou em workspace/tmp (clone, patch avulso). As duas
    // podas acima cuidam do que o APP cria; esta fecha a assimetria, e ela existia
    // porque aquele diretório não tinha dono nenhum no código.
    try { wsTmpMod.pruneWorkspaceTmp(); } catch { /* best-effort */ }
    // e o mesmo rascunho largado um nivel acima, na raiz do workspace: preserva o que
    // o app semeia (derivado do template) e o state, e nunca apaga sem saber o que preservar
    try { wsTmpMod.pruneWorkspaceRaiz(); } catch { /* best-effort */ }
  }

  // revisões que estavam rodando ou na fila quando o app morreu: devolve à fila (o PR
  // já tinha sido marcado como visto, então sem isso ele sumiria em silêncio)
  recoverInflight() {
    const inflight = readJson(INFLIGHT_FILE, [], (m) => this.log('WARN', m));
    if (!Array.isArray(inflight) || !inflight.length) return;
    for (const pr of inflight) { if (pr && pr.key) this.unsee(pr.key); }
    // CT-RET: a referência de retomada vai pro Map durável e o arquivo é REGRAVADO com
    // ela em estado pendente, nunca esvaziado. Até a A5 o boot gravava [] logo depois
    // de mover o sid pra memória, e um segundo reinício antes de o PR reaparecer perdia
    // a única referência recuperável. Quem tira a entrada é um desfecho.
    retomadaMod.restaurarRetomadas(this, inflight);
    this.writeInflight();
    // só o que estava em fila ou em execução é "revisão em andamento": a linha
    // pendente de um boot anterior repetiria o aviso, a poda e a limpeza de label
    // a cada reinício
    const emCurso = retomadaMod.emAndamentoNoBoot(inflight);
    // G7: a âncora do round 2 é gravada ANTES de enfileirar; se o app morreu com
    // a re-revisão na fila/rodando, a âncora sem a revisão mataria o round pra
    // sempre naquele head. Poda em duas metades via ancoraAposReinicio (head
    // vazio nunca casa com headRound e o gate re-arma igual, mas o teto do dia
    // sobrevive ao reinício); a âncora legada não tem contador a preservar.
    let podado = false;
    for (const pr of emCurso) {
      if (!this.reReviewLaunched) continue;
      const v = this.reReviewLaunched[pr.key];
      if (v === undefined) continue;
      const nova = ancoraAposReinicio(v);
      if (nova === undefined) delete this.reReviewLaunched[pr.key];
      else this.reReviewLaunched[pr.key] = nova;
      podado = true;
    }
    if (podado) this.saveReReviewLaunched();
    // a label `<conta>:revisando` desses PRs ficou presa (o finally que a remove
    // não roda quando o processo morre); o start() limpa, já com token na mão
    this.inflightRecuperado = emCurso.filter(p => p.url);
    if (emCurso.length) this.log('WARN', `app reiniciado com revisão em andamento: ${emCurso.map(p => p.key).join(', ')} devolvido(s) à fila`);
  }

  writeInflight() {
    try {
      writeJsonAtomic(INFLIGHT_FILE, retomadaMod.montarInflight(this));
    } catch { /* melhor perder a recuperação que derrubar a revisão */ }
  }

  prepareHome() {
    ensureDir(HOME);
    ensureDir(STATE_DIR);
    ensureDir(path.join(STATE_DIR, 'authors'));
    // semeia o workspace do Claude na primeira execucao
    if (!fs.existsSync(path.join(WORKSPACE, 'CLAUDE.md')) && fs.existsSync(TEMPLATE_DIR)) {
      copyRecursive(TEMPLATE_DIR, WORKSPACE);
    }
    // o template de prompt autonomo pode chegar por atualizacao em workspace ja existente
    if (!fs.existsSync(path.join(WORKSPACE, 'prompts', 'pr-review-auto.md')) &&
        fs.existsSync(path.join(TEMPLATE_DIR, 'prompts'))) {
      copyRecursive(path.join(TEMPLATE_DIR, 'prompts'), path.join(WORKSPACE, 'prompts'));
    }
    // prompts novos chegam por atualizacao em workspace ja semeado:
    // copie um a um o que faltar, sem sobrescrever o que o usuario possa ter ajustado
    try {
      const tplPrompts = path.join(TEMPLATE_DIR, 'prompts');
      const wsPrompts = path.join(WORKSPACE, 'prompts');
      if (fs.existsSync(tplPrompts)) {
        ensureDir(wsPrompts);
        for (const f of fs.readdirSync(tplPrompts)) {
          const dst = path.join(wsPrompts, f);
          if (!fs.existsSync(dst)) fs.copyFileSync(path.join(tplPrompts, f), dst);
        }
      }
    } catch { /* semear prompt novo nunca derruba o boot */ }
    // PROTOCOLO de review (formato/tom) é do Farol, não do usuário: mantém sincronizado
    // com a fonte a cada boot, pra mudanças (ex.: review humano/personalizado) chegarem
    // nas cópias já semeadas. NUNCA toca em state/ (dados do usuário) nem em settings.json.
    try {
      const espelhados = [
        'CLAUDE.md',
        path.join('prompts', 'pr-review-auto.md'),
        path.join('.claude', 'agents', 'pr-reviewer.md'),
        path.join('.claude', 'agents', 'claim-verifier.md'),
        path.join('.claude', 'commands', 'pr-review.md'),
      ];
      for (const rel of espelhados) {
        const src = path.join(TEMPLATE_DIR, rel), dst = path.join(WORKSPACE, rel);
        if (fs.existsSync(src)) { ensureDir(path.dirname(dst)); fs.copyFileSync(src, dst); }
      }
    } catch { /* sincronizar o protocolo nunca derruba o boot */ }
    // a política mora só na conta (30/09/2026): vai por extenso para o arquivo, com o rastro do que a carga decidiu
    if (contasConfig.aoCarregar(this) || !fs.existsSync(CONFIG_FILE)) this.saveConfig();
    this.ensureWorkspaceTrusted();
  }

  // Pre-semeia a confianca do Claude Code neste workspace (~/.claude.json).
  // Sem isso, a primeira sessao para no dialogo "confiar nesta pasta?" e a
  // autonomia quebra. Escreve so o que falta e preserva o resto do arquivo.
  ensureWorkspaceTrusted() {
    try {
      const file = CLAUDE_JSON_DA_CONFIANCA;
      let data = {};
      if (fs.existsSync(file)) {
        // parse falhou nas tres tentativas = arquivo ilegivel de verdade (nao foi a corrida
        // com a escrita do proprio Claude Code): ABORTA, jamais sobrescrever a config dele
        const lido = io.lerJsonTeimoso(file);
        if (!lido.ok) {
          this.log('WARN', `~/.claude.json ilegivel em ${lido.tentativas} tentativas; nao vou pre-confiar o workspace (primeira sessao pode pedir confianca)`);
          return;
        }
        data = lido.data;
      }
      // a decisao (o que muda, e se muda) mora em lib/parse.js, testada sem disco
      const { data: atualizado, changed } = workspaceTrust(data, WORKSPACE);
      if (!changed) return;
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.farol-bak');
      // ATOMICO: escreve no .tmp e renomeia. O writeFileSync direto trunca o arquivo
      // final e so depois preenche, e essa janela era exatamente o que o Claude Code
      // (que le o mesmo arquivo o tempo todo) pegava pela metade. Do outro lado do
      // espelho, o proprio Farol lia "~/.claude.json ilegivel" e desistia de confiar
      // no workspace, o que faz a primeira sessao parar no dialogo bloqueante.
      writeJsonAtomic(file, atualizado);
    } catch (err) {
      this.log('WARN', `nao consegui pre-confiar o workspace no ~/.claude.json: ${err.message}`);
    }
  }

  saveConfig() {
    ensureDir(HOME);
    // paraGravar tira as chaves que estão no padrão e são marcadas para não viajar
    // (hoje só localAuth, da A4): recurso não habilitado não escreve no config.json
    // de quem nunca o ligou (CT-COMPAT, item a). O que está em memória não muda.
    writeJsonAtomic(CONFIG_FILE, paraGravar(this.config));
  }

  // --- log: so falhas, sem ruido (mesmo contrato do tool antigo) ---
  log(level, msg) {
    try {
      // Brasília com offset explícito na linha (logStamp), nunca UTC cru: o log em
      // UTC deslocava a linha do tempo em 3h contra o resto do app e enganava a
      // reconstrução de incidentes. Linhas antigas em UTC seguem parseáveis.
      gravarLinhaDeLog(LOG_FILE, `[${logStamp()}] [${level}] ${semControle(msg)}\n`, TEMPOS.LOG_ROTACAO_BYTES);
    } catch { /* log nunca derruba o app */ }
  }

  // --- seen (mesmo formato do tool antigo: uma key por linha) ---
  loadSeen() {
    try {
      const lines = fs.readFileSync(SEEN_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      this.seen = new Set(lines.map(l => l.split(/\s+/)[0]));
    } catch { this.seen = new Set(); }
  }

  // Marcado como visto DE PROPÓSITO: o clique em "marcar como visto sem revisar" e o
  // baseline da primeira execução. Existe porque `seen` sozinho não distingue esses
  // dois de uma revisão que foi LANÇADA e morreu antes de decidir: os três deixam a
  // mesma marca, e sem separar não dá pra devolver à fila só o que vazou. Ver
  // reconciliarVistos.
  marcarIgnorado(key) {
    if (!this.ignorados) this.ignorados = new Set();
    if (!this.ignorados.has(key)) { this.ignorados.add(key); this.saveIgnorados(); }
  }

  // Migração de uma vez: instalação que já rodava antes deste arquivo tem `seen`
  // misturando os três casos e NÃO dá pra saber, olhando pra trás, qual era qual.
  // A escolha conservadora é tratar todo visto-sem-decisão existente como descarte
  // deliberado: ressuscitar dezenas de PRs antigos de um golpe seria pior que o
  // vazamento que isto conserta. Daqui pra frente a distinção é registrada.
  migrarIgnorados() {
    if (this.ignorados) return;                 // já existe: nada a migrar
    const comDecisao = chavesComDecisao(this);
    if (!comDecisao) return;                    // histórico indisponível: a migração espera outra subida
    this.ignorados = new Set([...this.seen].filter(k => !comDecisao.has(k)));
    this.saveIgnorados();
    if (this.ignorados.size > 0) this.log('WARN', `migração: ${this.ignorados.size} PR(s) já vistos sem decisão tratados como descarte deliberado`);
  }

  // Devolve à fila o que foi marcado como visto por uma revisão que NUNCA decidiu:
  // a sessão morreu no meio (app fechado, crash, falha não classificada) e o PR
  // saiu da fila pra sempre, exigindo clique manual. Não toca no que foi descartado
  // de propósito, no que tem decisão, nem no que está em andamento, estacionado ou
  // aguardando retry, que são
  // estados legítimos.
  // PR visto sem decisão: volta à fila, salvo se já está resolvido neste head (vistos-reconciliacao.js)
  reconciliarVistos(mineList) { return vistosMod.reconciliarVistos(this, mineList); }

  loadIgnorados() {
    try {
      const lines = fs.readFileSync(IGNORED_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      this.ignorados = new Set(lines);
    } catch { this.ignorados = null; }   // null = arquivo ainda não existe (migração abaixo)
  }

  saveIgnorados() {
    ensureDir(STATE_DIR);
    const arr = [...(this.ignorados || [])];
    writeTextAtomic(IGNORED_FILE, arr.join('\n') + (arr.length ? '\n' : ''));
  }

  saveSeen() {
    ensureDir(STATE_DIR);
    writeTextAtomic(SEEN_FILE, [...this.seen].join('\n') + (this.seen.size ? '\n' : ''));
  }

  markSeen(key) { if (!this.seen.has(key)) { this.seen.add(key); this.saveSeen(); } }
  // o PR que volta à fila (re-request, destrave, restore, bloqueio de coordenação) deixa
  // de ser "visto por recibo": a proteção do reconciliarVistos vale só enquanto ele está visto
  unsee(key) { if (this.seen.delete(key)) this.saveSeen(); }

  // --- GitHub ---
  // Uma instância, uma conta revisora (corte do lote 14). A lista tem UM elemento, vindo de
  // config.conta: os consumidores do núcleo seguem iterando, e a fila não foi reescrita.
  accountList() { return [contasConfig.contaConfigurada(this.config)]; }

  // política de automação POR CONTA, lida só da conta. A regra de cada pergunta mora em
  // lib/engine/contas-config.js, junto da edição e do rastro.
  // ao chegar PR nesta conta: revisar sozinho (headless) ou só colocar na fila?
  autoReviewFor(user) { return contasConfig.revisaSozinho(this, user); }
  // nome da conta nos motivos do card (o login); vazio para "todas"
  scopeLabel(scope) { return contasConfig.rotuloDaConta(this, scope); }
  inicioAutomaticoDaFila() { return Object.fromEntries(this.queue.map(p => [p.key, politicaDeInicio(this, p).automatic])); }
  // quando aprovável: sempre 'approve' desde 17/11/2026 (o revisor nunca espera decisão de gente)
  approvePolicyFor(user, clean) { return contasConfig.acaoAoAprovar(this, user, clean); }
  // quando a revisão pede mudanças: sempre 'request_changes' desde 17/11/2026
  rejectPolicyFor(user) { return contasConfig.acaoAoReprovar(this, user); }

  // login da conta revisora (a única identidade que age no GitHub)
  primaryUser() { return this.accountList()[0].user; }

  // todo PR é da conta revisora: a marca `account` de um item antigo não escolhe identidade
  accountForPr() { return this.primaryUser(); }

  // sem conta configurada, detecta a conta ativa do gh desta maquina: cada
  // pessoa do time usa a propria autenticacao, nada viaja com o app
  async resolveAccount() {
    if (this.primaryUser()) return;
    const r = await io.run('gh', ['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_PAGER: 'cat' } });
    const login = r.ok ? r.stdout.trim() : '';
    if (login) {
      contasConfig.contaDetectada(this, login); // herda a política gravada antes do login (contas-config.js)
      this.saveConfig();
      this.emit('toast', { kind: 'info', text: `Conta do GitHub detectada: @${login}. Para revisar com outra, grave a conta no config.json e reinicie o motor (docs/CONFIGURATION.md).` });
    }
  }

  // token da conta revisora, buscado on-demand do gh (nunca persistido)
  async refreshTokens() {
    let ok = false;
    for (const acc of this.accountList()) {
      if (!acc.user) continue;
      const r = await io.run('gh', ['auth', 'token', '--user', acc.user]);
      this.token = r.ok ? r.stdout.trim() || null : null;
      ok = !!this.token;
      // sem token é estado: uma linha quando começa, não uma por ciclo (gh-queries.js)
      if (ok) ghMod.tokenVoltou(this, acc.user);
      else ghMod.avisarSemToken(this, acc.user, `gh auth token --user ${acc.user} falhou: ${r.stderr.trim() || 'sem saida'} (conta sem token no gh)`);
    }
    this.tokenOk = ok;
    return ok;
  }

  // compat: alguns caminhos chamam refreshToken (singular)
  async refreshToken() { return this.refreshTokens(); }

  // O token da conta revisora, o único que existe. O login pedido não escolhe token: um
  // login diferente do configurado (item antigo, chamador desatualizado) é ignorado, e
  // quem precisa agir continua checando isto ANTES de rodar gh.
  tokenFor() { return this.token || null; }

  // env de child-process com o GH_TOKEN da conta revisora. O argumento não escolhe
  // identidade (login diferente de config.conta.user é ignorado); ele só diz que o chamador
  // AGE em nome de uma conta, e aí sem token é erro alto (raiz A1): seguir sem GH_TOKEN
  // faria o gh cair no chaveiro ou no ambiente e a busca @me, o review postado e a sessão
  // Claude sairiam com a identidade errada. Sem user é o caminho legado do doctor e do
  // boot, que nunca lança. Os call sites de produção pré-checam com tokenFor e caem nos
  // seus caminhos de falha; este throw é a rede de segurança fail-loud. A frase "sem token
  // no gh" é contrato com a classificação de erro transitório do runOneHeadless.
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const conta = this.primaryUser();
    const tok = this.tokenFor();
    if (user && !tok) throw new Error(`conta ${conta || user} sem token no gh (rode: gh auth login --user ${conta || user})`);
    // limpa ANTES de setar, pela mesma razão do applyClaudeAuthEnv: o env parte de
    // { ...process.env }, e um token exportado no shell de quem abriu o Farol é
    // identidade herdada igual à do A1, só que vinda de fora. Sem token resolvido
    // (caminho legado do doctor/boot) o filho saía agindo como o dono daquela variável,
    // calado; agora o gh cai no próprio keyring, que é o que "sem token" sempre quis
    // dizer. As DUAS variáveis porque o gh lê as duas no github.com (GH_TOKEN vence,
    // GITHUB_TOKEN é a reserva) e limpar uma só deixaria a mesma herança entrar pela vizinha.
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    if (tok) env.GH_TOKEN = tok;
    // perfil do Claude (assinatura ou chave de API) que o Farol usa: ver resolveClaudeAuth
    // (perfil padrão do Farol > demais perfis utilizáveis, trocando no limite do plano).
    applyClaudeAuthEnv(env, this.resolveClaudeAuth());
    return env;
  }

  // Consultas ao GitHub (leitura, zero IA): colaborador lib/engine/gh-queries.js.
  async searchPRs(extraArgs, user, agora = Date.now()) { return ghMod.searchPRs(this, extraArgs, user, agora); }
  async prState(pr) { return ghMod.prState(this, pr); }
  async prEstadoELabels(pr) { return ghMod.prEstadoELabels(this, pr); }
  async headSha(pr) { return ghMod.headSha(this, pr); }
  async prCardSources(pr) { return ghMod.prCardSources(this, pr); }
  async fetchPrFiles(pr) { return fileProofMod.fetchPrFiles(this, pr); }
  async fetchPrInventory(pr, headSha) { return fileProofMod.fetchPrInventory(this, pr, headSha); }


  async check(reason = 'timer') {
    if (this.checking) return;
    // a contagem do ciclo anterior nunca aparece no novo (checagem-em-curso.js)
    this.checking = true; this.checagemEmCurso = null;
    this.setStatus('checking');
    try {
      const { panorama, queue, fresh, mineList, ownersOk, monitoredOwners } = await this._coletarPanorama();

      // G15: poda do estacionamento (mesmo padrão da poda do reReviewLaunched em
      // launchReReviews): key fora do panorama (PR fechado/mergeado) não guarda
      // estacionamento pra sempre, senão o arquivo só cresce. MAS, diferente do
      // reReviewLaunched (onde uma poda errada custa no máximo UMA sessão repetida,
      // com o dedup por head protegendo), aqui uma poda errada relança sozinha uma
      // sessão fadada à mesma falha conhecida, reabrindo o próprio G15. Por isso a
      // poda é gateada POR OWNER (mesmo padrão do G5): só mexe na key cujo owner
      // respondeu neste ciclo (ownersOk); owner que falhou fica intocado, porque
      // "sumiu do panorama" não prova PR fechado quando a busca dele caiu.
      // EXCEÇÃO determinística: owner que saiu de TODA a config (nem está em
      // monitoredOwners) nunca mais vai responder, então nunca entraria em ownersOk;
      // sem tratar este caso à parte a key ficaria presa pra sempre e o arquivo só
      // cresceria, contradizendo o propósito da própria poda. Presença na config não
      // depende de rede, então esta parte dispensa ownersOk. MAS ela dispensa só o
      // gate de rede, nunca a prova de que o PR sumiu: a fila mine
      // (--review-requested=@me) resolve por TOKEN, não por owner, então PR de org
      // não monitorada entra na fila normalmente e o estacionamento dele é legítimo.
      // Podar incondicionalmente devolvia esse PR pro toReview a cada ciclo, que
      // relançava a sessão fadada à mesma falha, que estacionava de novo: loop pago
      // de 30 em 30 segundos, o próprio G15 reaberto (revisão final da onda 3).
      this._podarEstacionamento(panorama, ownersOk, monitoredOwners);
      // âncora da saída de cena: some junto com o PR. Mesmo compromisso do
      // reReviewLaunched, e por isso a mesma fonte (o panorama deste ciclo). A
      // memória de aviso do gate de consciência segue a mesma poda.
      const chavesDoPanorama = new Set(panorama.map(p => p.key));
      this.podarSkipComentado(chavesDoPanorama);
      this.podarHistoricoAvisado(chavesDoPanorama);

      // estado novo destrava o que esperava clique (v2.59.3): commit novo ou pedido de
      // revisão depois de uma revisão estacionada, pulada ou presa em head velho devolve
      // o PR aos caminhos automáticos. ANTES do _dispararAutomacoes, pro toReview deste
      // mesmo ciclo já enxergar o PR de volta na fila.
      try { await this.destravarPorEstadoNovo(); } catch (e) { this.log('WARN', `destrave por estado novo: ${e.message}`); }

      await this._dispararAutomacoes(fresh);
      await retomadaVarredura.varrerFechadas(this);

      // label :revisando cuja remoção falhou no fim da revisão (labels-a-tirar.js)
      try { await labelsATirar.tirarPendentes(this); } catch (e) { this.log('WARN', `labels a tirar: ${e.message}`); }
      try { await labelPropriaOrfa.tirarOrfas(this, panorama); } catch (e) { this.log('WARN', `label própria sem dono: ${e.message}`); }
      // stale: PRs que EU revisei e receberam commit novo depois (reativa o "Re-revisar")
      try { await this.refreshStaleStates(); } catch (e) { this.log('WARN', `refreshStaleStates: ${e.message}`); }
      // round 2 sozinho: PR onde EU pedi mudanças e o autor empurrou commit novo volta
      // pra fila de revisão sem esperar clique (âncora por head impede repetição; era o
      // elo manual do ciclo, medido no biud-frontend#756). Depende do staleInfo que o
      // refreshStaleStates acabou de preencher, por isso a ordem aqui importa.
      try { await this.launchReReviews(); } catch (e) { this.log('WARN', `re-revisão pós-push: ${e.message}`); }
      // pendência já atendida por fora (review postado pelo chat, pela web do GitHub ou
      // por gh na mão): tira o card de "Precisa de você", que antes ficava preso pra
      // sempre porque só o clique no botão esvaziava decisions.pending
      try { await this.reconcilePending(); } catch (e) { this.log('WARN', `reconcilePending: ${e.message}`); }
      // posts que falharam por instabilidade transitória (rede, gateway do GitHub fora
      // do ar) tentam de novo sozinhos aqui, reusando o payload já decidido: roda DEPOIS
      // do reconcilePending de propósito, pra nunca reenviar em cima de uma pendência que
      // já foi atendida por fora nesse mesmo ciclo.
      // aprovação que esperava o CI obrigatório sai sozinha quando ele fecha verde no mesmo
      // head (lib/engine/espera-ci.js): antes do reenvio, que assume a postagem que falhar aqui.
      // Na mesma varredura, a que esperava a prova técnica revisa de novo sozinha quando o PR
      // muda (lib/engine/espera-prova.js, 17/10/2026), sem nunca postar com lacuna
      try { await this.varrerEsperas(); } catch (e) { this.log('WARN', `esperas automáticas: ${e.message}`); }
      try { await this.retryFailedPosts(); } catch (e) { this.log('WARN', `retryFailedPosts: ${e.message}`); }
      // pushback automático: contestação do autor a um review meu (fire-and-forget:
      // roda em background pra não segurar a checagem, com guarda anti-concorrência)
      this.scanPushbacks().catch(e => this.log('WARN', `scanPushbacks: ${e.message}`));
      // versao do Claude Code contra o registro do npm (lib/engine/versao-claude.js):
      // intervalo proprio de 6 h e nunca lanca, entao o ciclo so dispara e segue
      versaoClaude.atualizarVersaoClaude(this);
      this.setStatus('idle');
    } catch (err) {
      this.lastError = err.message;
      this.log('ERROR', `ciclo de monitoramento: ${err.message}`);
      this.setStatus('error');
    } finally {
      this.checking = false; this.checagemEmCurso = null;
      this.schedule();
      this.pushState();
    }
  }

  async _coletarPanorama() {
      await this.resolveAccount();
      await this.refreshTokens();
      const accounts = this.accountList();
      iniciarChecagem(this, accounts); // o Radar conta as organizações buscadas (checagem-em-curso.js)

      // painel: todos os PRs abertos das orgs monitoradas (sem alerta), com o token da
      // conta revisora; dedup por chave (o mesmo PR não entra duas vezes)
      const panoramaMap = new Map();
      let anyOk = false;
      // G15: owners cuja busca RESPONDEU neste ciclo (list !== null). A poda do
      // estacionamento mais abaixo só pode agir sobre a key de um owner que está
      // neste Set; owner que falhou não prova PR nenhum fechado (mesmo padrão do
      // G5 em autOk/authOk).
      const ownersOk = new Set();
      // G15 (re-revisão): owners que ainda estão na config, em QUALQUER conta.
      // Fato determinístico, não depende de rede: um owner removido do monitoramento
      // nunca mais vai responder (nunca entra em ownersOk), e sem este Set a key dele
      // ficaria presa no estacionamento pra sempre, o arquivo só crescendo, o oposto
      // do que o comentário da poda promete.
      const monitoredOwners = new Set(accounts.flatMap(acc => (acc.owners || []).map(o => String(o).toLowerCase())));
      for (const acc of accounts) {
        for (const owner of acc.owners) {
          const list = await buscarOrganizacao(this, owner, acc.user);
          if (list === null) continue;
          anyOk = true;
          ownersOk.add(String(owner).toLowerCase());
          for (const pr of list) if (!panoramaMap.has(pr.key)) panoramaMap.set(pr.key, pr);
        }
      }
      const panorama = [...panoramaMap.values()];

      // alerta + fila: PRs onde sou o revisor pedido, em QUALQUER conta (o @me
      // resolve por token, entao cada conta acha os seus). Dedup por chave.
      let mine = null, mineAnyOk = false;
      const mineMap = new Map();
      for (const acc of accounts) {
        const part = await this.searchPRs(['--review-requested=@me'], acc.user);
        if (part === null) continue;
        mineAnyOk = true;
        for (const pr of part) if (!mineMap.has(pr.key)) mineMap.set(pr.key, pr);
      }
      if (mineAnyOk) mine = [...mineMap.values()];
      if (mine === null && !anyOk) throw new Error('todas as buscas gh falharam (veja o log)');

      // indicador no panorama: PRs que EU ja revisei (qualquer conta, inclusive fora
      // do Farol). Se todas as buscas falharem, preserva o que ja se sabia.
      const revSet = new Set();
      let revAnyOk = false;
      for (const acc of accounts) {
        const part = await this.searchPRs(['--reviewed-by=@me'], acc.user);
        if (part === null) continue;
        revAnyOk = true;
        for (const pr of part) revSet.add(pr.key);
      }
      if (revAnyOk) this.reviewedKeys = revSet;

      // falha só das --review-requested (ex.: rate limit da API de search): preserva
      // fila, "é meu" e marcadores do último ciclo bom, no MESMO padrão de reviewedKeys
      // logo acima. Zerar aqui apagava reReviewedKeys (markReRequests com Set
      // vazio) e ressuscitava PRs que o usuário ignorou, re-notificando tudo na volta.
      const mineFailed = mine === null;
      const mineList = mineFailed ? [...this.queue] : mine;
      const mineKeys = mineFailed ? this.mineKeys : new Set(mineList.map(p => p.key));
      if (!mineFailed) this.mineKeys = mineKeys;
      for (const pr of panorama) pr.mine = mineKeys.has(pr.key);
      for (const pr of mineList) {
        if (!panoramaMap.has(pr.key)) { pr.mine = true; panorama.push(pr); }
      }
      // re-request de review: fui pedido de novo (mine) num PR que EU já revisei
      // (reviewedByMe). No fluxo normal, revisar te tira dos pedidos; voltar aos pedidos
      // = o autor re-solicitou (a review antiga vira DISMISSED no GitHub). markReRequests
      // des-marca esses como "visto" pra voltarem à fila (acionáveis de novo).
      const reReq = this.markReRequests(mineFailed ? null : mineKeys);
      for (const pr of panorama) { pr.reviewedByMe = this.reviewedKeys.has(pr.key); pr.reRequested = reReq.has(pr.key); }
      for (const pr of mineList) pr.reRequested = reReq.has(pr.key);
      panorama.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));

      // primeira execucao da vida: baseline silencioso (nao notifica o estoque)
      if (!fs.existsSync(BASELINE_FILE)) registrarBaseline(this, BASELINE_FILE, mineList);

      // devolve à fila o que foi marcado visto por revisão que nunca decidiu, ANTES
      // do filtro abaixo (o `seen` é justamente o que o filtro usa)
      this.reconciliarVistos(mineList);
      const prevQueue = new Set(this.queue.map(p => p.key));
      const queue = mineList.filter(p => !this.seen.has(p.key));
      const fresh = queue.filter(p => !prevQueue.has(p.key));

      this.panorama = panorama;
      // sinais de outras pessoas revisando, ANTES de qualquer gate síncrono ler (skip-review.js)
      skipMod.lerSinaisDoCiclo(this, panorama, queue);
      this.queue = queue;
      this.lastCheckAt = Date.now();
      this.lastError = null;

      return { panorama, queue, fresh, mineList, ownersOk, monitoredOwners };
  }

  // G15: poda do estacionamento (mesmo padrão da poda do reReviewLaunched em
  // launchReReviews): key fora do panorama (PR fechado/mergeado) não guarda
  // estacionamento pra sempre, senão o arquivo só cresce. MAS, diferente do
  // reReviewLaunched (onde uma poda errada custa no máximo UMA sessão repetida,
  // com o dedup por head protegendo), aqui uma poda errada relança sozinha uma
  // sessão fadada à mesma falha conhecida, reabrindo o próprio G15. Por isso a
  // poda é gateada POR OWNER (mesmo padrão do G5): só mexe na key cujo owner
  // respondeu neste ciclo (ownersOk); owner que falhou fica intocado, porque
  // "sumiu do panorama" não prova PR fechado quando a busca dele caiu.
  // EXCEÇÃO determinística: owner que saiu de TODA a config (nem está em
  // monitoredOwners) nunca mais vai responder, então nunca entraria em ownersOk;
  // sem tratar este caso à parte a key ficaria presa pra sempre e o arquivo só
  // cresceria, contradizendo o propósito da própria poda. Presença na config não
  // depende de rede, então esta parte dispensa ownersOk. MAS ela dispensa só o
  // gate de rede, nunca a prova de que o PR sumiu: a fila mine
  // (--review-requested=@me) resolve por TOKEN, não por owner, então PR de org
  // não monitorada entra na fila normalmente e o estacionamento dele é legítimo.
  // Podar incondicionalmente devolvia esse PR pro toReview a cada ciclo, que
  // relançava a sessão fadada à mesma falha, que estacionava de novo: loop pago
  // de 30 em 30 segundos, o próprio G15 reaberto (revisão final da onda 3).
  _podarEstacionamento(panorama, ownersOk, monitoredOwners) {
    const abertosParked = new Set(panorama.map(p => p.key));
    let parkedMudou = false;
    for (const k of [...this.autoReviewParked]) {
      const owner = String(k.split('/')[0] || '').toLowerCase();
      if (monitoredOwners.has(owner) && !ownersOk.has(owner)) continue;
      if (abertosParked.has(k)) { this.parkedPruneStrikes.delete(k); continue; }
      // ausência tem que ser SEGUIDA (PARKED_PRUNE_STRIKES): o gh search é índice, e
      // índice atrasado responde `ok` sem o PR que está aberto
      const faltas = (this.parkedPruneStrikes.get(k) || 0) + 1;
      if (faltas < PARKED_PRUNE_STRIKES) { this.parkedPruneStrikes.set(k, faltas); continue; }
      this.parkedPruneStrikes.delete(k);
      if (reviewMod.desestacionar(this, k)) parkedMudou = true;
    }
    for (const k of [...this.parkedPruneStrikes.keys()]) if (!this.autoReviewParked.has(k)) this.parkedPruneStrikes.delete(k);
    if (parkedMudou) this.saveAutoReviewParked();
  }

  async _dispararAutomacoes(fresh) {
      // auto-revisão respeita a política POR CONTA e vale pra TODA a fila elegível,
      // não só os que acabaram de chegar: ligar "revisa na hora" numa conta passa a
      // valer pros PRs que JÁ estavam esperando (era o gap de "configurei e não agiu").
      // Exclui os já em andamento, os "estacionados" (falha não-transitória/cancelados,
      // que aguardam ação manual) e os em retry de rede (repescados no bloco abaixo).
      const inflight = new Set([
        ...this.headlessQueue.map(p => p.key),
        ...(this.headlessIniciando || []),
        ...[...this.activeReviews.values()].flatMap(s => s.keys || [])
      ]);
      // UM Farol por PR: quem já saiu de cena naquele head fica fora, e quem vê o sinal de
      // outra pessoa sai agora. Os dois são coletados aqui e resolvidos depois do filtro,
      // porque consultar review é IO e este filtro é síncrono. Ferramenta não conta como
      // pessoa, e clique manual nunca passa por aqui (lib/engine/skip-review.js).
      const pulados = [];
      const foraDeCena = [];
      const toReview = this.queue.filter(p => {
        const acct = this.accountForPr(p);
        if (!this.tokenFor(acct)) return false;
        // conta, organização e autor numa decisão só (review-scope.js): Automático na organização
        // revisa sozinho mesmo com a conta só na fila
        if (!politicaDeInicio(this, p).automatic) return false;
        if (inflight.has(p.key)) return false;
        if (this.autoReviewParked.has(p.key)) return false;
        if (this.retryAfterNet.has(p.key)) return false;
        // assinatura do Claude no limite do plano: nem entra na fila até o reset, senão
        // cada PR abria sessão, punha a label e morria em segundos (21/09/2026)
        if (this.limiteDoPlanoAte(acct)) return false;
        if (this.skipComentado[p.key]) { foraDeCena.push(p); return false; }
        if (this._registraPulo(p, pulados)) return false;
        return true;
      });
      if (fresh.length > 0) {
        // `auto` fala dos PRs que ACABARAM de chegar, não de qualquer PR da fila automática
        this.emit('new-prs', { items: fresh, total: this.queue.length, auto: fresh.some(p => toReview.some(t => t.key === p.key)) });
      }
      if (toReview.length) this.launchReview(toReview.map(p => p.url), 'auto');
      // fire-and-forget, no padrão do scanPushbacks: sair de cena é cortesia com quem
      // já pegou o PR, nunca pré-requisito do ciclo de polling.
      if (pulados.length || foraDeCena.length) {
        this.resolvePulos(pulados, foraDeCena).catch(err => this.log('WARN', `saída de cena: ${err.message}`));
      }

      // a checagem funcionou = a rede voltou: relança revisões que caíram por algo
      // transitório. Vale pra QUALQUER revisão que caiu (clique no panorama e conta
      // sem autoReview inclusive): a promessa do toast não depende da política da conta.
      await this._repescarRetry(fresh, inflight);
  }

  // Repesca do retry pós-transitório (extraído do _dispararAutomacoes quando o
  // gate de consciência entrou no caminho, pra manter a profundidade no teto do
  // gate de qualidade). O comportamento é o de sempre, mais o gate novo no meio.
  async _repescarRetry(fresh, inflight) { return repescarRetry(this, fresh, inflight); }

  setStatus(s) { this.status = s; this.pushState(); }

  schedule() {
    clearTimeout(this.timer);
    const ms = Math.max(180, this.config.intervalSeconds) * 1000;
    this.nextCheckAt = Date.now() + ms;
    this.timer = setTimeout(() => this.check('timer'), ms);
    if (this.timer.unref) this.timer.unref();
  }

  checkNow() { clearTimeout(this.timer); this.check('manual'); }

  // Re-requests de review: PRs pedidos a mim DE NOVO (mine) que EU já revisei.
  // Sinal do GitHub: revisar te remove dos pedidos; estar pedido de novo = o autor
  // clicou "re-request review" (a review antiga vira DISMISSED). Isso deve voltar
  // pra fila (e reentrar na auto-revisão) mesmo já "visto" na 1ª rodada, então
  // des-marca como visto UMA vez. "Já revisei" vem do HISTÓRICO LOCAL do Farol
  // (reviewActions, sem I/O), não de uma 2ª busca no gh (`--reviewed-by=@me`):
  // essa busca é indexação assíncrona do GitHub e pode ficar atrasada em relação
  // a `--review-requested=@me` no mesmo ciclo, fazendo o re-request nunca bater
  // (bug real reportado: PR pedido de novo não era identificado nem reanalisado
  // sozinho). O histórico local é instantâneo e reflete exatamente o que o Farol
  // postou; "pulado" (Pular) não conta como revisado (nada foi postado no GitHub,
  // então não há como ser re-request de verdade). O marcador reReviewedKeys evita
  // re-surgir todo ciclo (pra você poder ignorar depois) e é limpo quando o PR sai
  // dos pedidos (re-revisado ou fechado). Devolve o conjunto de keys re-solicitadas,
  // pra a UI rotular ("pedida de novo") e a auto-revisão relançar sozinha.
  markReRequests(mineKeys) {
    // null = as buscas --review-requested falharam NESTE ciclo: sem saber quem segue
    // pedido, preserva visto e marcadores e devolve o rótulo do último ciclo bom
    // (cópia, nunca o Set interno). Set VAZIO é outra coisa: "ninguém está mais
    // pedido", e aí limpa como sempre. Sem essa distinção, um rate limit da API de
    // search apagava reReviewedKeys e ressuscitava PRs que o usuário ignorou.
    if (mineKeys === null) return new Set(this.reReviewedKeys);
    const actions = this.reviewActions(); // histórico indisponível: o rótulo do último ciclo, sem rearmar nem esquecer
    if (historicoIndisponivel(this)) return new Set(this.reReviewedKeys);
    const reReq = new Set();
    const now = Date.now();
    for (const key of mineKeys) {
      const a = actions[key];
      if (!a || a.kind === 'pending') continue;
      // eco do índice: review MEU recém-postado ainda aparece nos pedidos; não é
      // re-request (ver REREQ_GRACE_MS). Sem carimbo (registro legado), vale o sinal.
      if (a.at && (now - a.at) < REREQ_GRACE_MS) continue;
      reReq.add(key);
    }
    for (const key of reReq) {
      if (this.seen.has(key) && !this.reReviewedKeys.has(key)) { this.unsee(key); this.reReviewedKeys.add(key); }
    }
    for (const k of [...this.reReviewedKeys]) if (!reReq.has(k)) this.reReviewedKeys.delete(k);
    return reReq;
  }

  // Pipeline de revisão headless: colaborador lib/engine/review.js (gate intacto).
  prFromUrl(url) { return reviewMod.prFromUrl(this, url); }
  async launchReview(urls, mode = 'auto', origem = 'auto', extras = {}) { return reviewMod.launchReview(this, urls, mode, origem, extras); }
  enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); }
  headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); }
  processHeadless() { return reviewMod.processHeadless(this); }
  freeHeadlessSlot(acct, pr) { return reviewMod.freeHeadlessSlot(this, acct, pr); }
  async runOneHeadless(pr, acct) { return reviewMod.runOneHeadless(this, pr, acct); }
  // re-revisão automática pós-push (round 2 sem clique): gate + lançamento + âncora
  reReviewTargets(inflightKeys, agora) { return reviewMod.reReviewTargets(this, inflightKeys, agora); }
  reRoundParaUi() { return reviewMod.reRoundParaUi(this); }
  destravarPorEstadoNovo() { return destravaMod.destravarPorEstadoNovo(this); }
  saveDestravados() { return destravaMod.saveDestravados(this); }
  launchReReviews() { return reviewMod.launchReReviews(this); }
  saveReReviewLaunched() { return reviewMod.saveReReviewLaunched(this); }
  // G15: estacionamento pós-falha persistido (padrão do savePushbackScanned)
  saveAutoReviewParked() { return reviewMod.saveAutoReviewParked(this); }
  // projeção do estacionamento pra tela (at, motivo curto, tipo), só das keys estacionadas
  parkedParaUi() { return reviewMod.parkedParaUi(this); }
  saveSkipComentado() { return skipMod.saveSkipComentado(this); }
  saveLabelVistaDesde() {
    try { writeJsonAtomic(path.join(STATE_DIR, 'label-vista.json'), this.labelVistaDesde); }
    catch { /* best-effort: perder o relógio só reinicia a contagem de validade da label */ }
  }
  saveLabelVistaObservada() {
    try { writeJsonAtomic(path.join(STATE_DIR, 'label-vista-observada.json'), this.labelVistaObservadaEm); }
    catch { /* best-effort: sem o instante, o carimbo antigo segue valendo como antes */ }
  }
  // UM Farol por PR (lib/engine/skip-review.js): sair de cena
  outrosRevisando(pr) { return skipMod.outrosRevisando(this, pr); }
  saiDeCena(pr, outros, head) { return skipMod.saiDeCena(this, pr, outros, head); }
  seguirForaDeCena(pr, registro, head) { return skipMod.seguirForaDeCena(this, pr, registro, head); }
  podarSkipComentado(abertos) { return skipMod.podarSkipComentado(this, abertos); }
  // gate de consciência do review automático (28/08/2026 à tarde): head ativo com
  // review decisivo de outra pessoa deixa o caminho automático aguardando você
  bloqueadoPorHistorico(pr) { return skipMod.bloqueadoPorHistorico(this, pr); }
  // 100% dos checks obrigatórios verdes antes de gastar sessão (31/08/2026). Fachada,
  // e não chamada direta do bloqueiaAutomatico, pelo mesmo motivo do gate acima: é
  // aqui que a suíte substitui a ida ao gh.
  bloqueadoPorChecks(pr, opcoes) { return checksMod.bloqueadoPorChecks(this, pr, opcoes); }
  bloqueiaAutomatico(pr) { return skipMod.bloqueiaAutomatico(this, pr); }
  podarHistoricoAvisado(abertos) { return skipMod.podarHistoricoAvisado(this, abertos); }

  /* Resolve, num ciclo, os dois lados do "um Farol por PR". Assíncrono e
     best-effort: nada aqui é pré-requisito do polling.
     - `pulados`: acabei de ver o sinal de outra pessoa (a label).
       Saio de cena AGORA, de forma durável naquele head, e o aviso é um toast
       no app (desde 28/08/2026 nada é comentado no PR: o comentário era template
       detectável e denunciava a automação).
     - `foraDeCena`: já estava fora. Aqui é onde a saída pode CADUCAR (a sessão do
       colega morreu sem deixar review).
     O head vem de `headSha`, e falha ali degrada pra head vazio: sem head, a
     âncora vale pro PR inteiro, que é o lado seguro de "um Farol por PR". */
  async resolvePulos(pulados, foraDeCena) {
    for (const { pr, outros } of pulados || []) {
      // regra PLANA (28/08/2026 à tarde): ver alguém revisando SEMPRE segura o automático
      await this.saiDeCena(pr, outros, await this._headSeguro(pr));
    }
    for (const pr of foraDeCena || []) {
      await this.seguirForaDeCena(pr, this.skipComentado[pr.key] || {}, await this._headSeguro(pr));
    }
  }

  async _headSeguro(pr) {
    try { return await this.headSha(pr); } catch { return ''; }
  }
  // `agora` com default nos DOIS lados de propósito: a fachada repassa o parâmetro
  // (nada é engolido) e o Function.length segue casando com o da implementação, que
  // é o que test/facades.test.js confere lendo este fonte.
  retryTargets(freshKeys, inflightKeys, agora = Date.now()) { return reviewMod.retryTargets(this, freshKeys, inflightKeys, agora); }

  // perfil marcado pra uma pessoa (por login); {} quando não marcada
  // Pushback (memória de contestação do autor): colaborador lib/engine/pushback.js.
  personProfile(login) { return pushbackMod.personProfile(this, login); }
  pushbacksFor(login) { return pushbackMod.pushbacksFor(this, login); }
  recordPushback(body) { return pushbackMod.recordPushback(this, body); }
  savePushbacks() { return pushbackMod.savePushbacks(this); }
  savePushbackScanned() { return pushbackMod.savePushbackScanned(this); }

  // bloco injetado no prompt de revisão: ajusta TOM + POSTURA, nunca a decisão.
  // Papel dá o tom-base; a matriz por domínio calibra a postura por área do PR;
  // o histórico de pushback calibra humildade/assertividade com aquela pessoa.
  personProfileBlock(login) { return reviewMod.personProfileBlock(this, login); }
  reviewFormatBlock() { return reviewMod.reviewFormatBlock(this); }
  thirdPartyReviewBlock() { return reviewMod.thirdPartyReviewBlock(); }
  // A implementação é headlessPromptFor(engine, url, author, lotes, metrics). Esta fachada
  // declarava só (url, author) e ENGOLIA lotes/metrics: o plano de fan-out era calculado
  // em runHeadlessReview e jogado fora, então o bloco de PR grande NUNCA chegou no prompt
  // (defeito desde a v2.26.0). Ver test/review-prompt.test.js, que trava os dois lados.
  headlessPromptFor(url, author, lotes, metrics) { return reviewMod.headlessPromptFor(this, url, author, lotes, metrics); }

  // Grava o nivel do modelo (Opus/Sonnet/...) na sessao ativa pra UI mostrar
  // qual agente esta rodando. O id cru vem do evento system/init da sessao.
  setSessionModel(id, rawModel) { return sessionMod.setSessionModel(this, id, rawModel); }
  // fachada com argumento de comportamento (agent, o rótulo do subagente na linha
  // do feed): a aridade importa
  pushActivity(id, kind, text, agent, stage) { return sessionMod.pushActivity(this, id, kind, text, agent, stage); }
  toolSummary(name, input) { return sessionMod.toolSummary(this, name, input); }
  killTree(pid) { return sessionMod.killTree(this, pid); }
  cancelSession(id) { return sessionMod.cancelSession(this, id); }
  runClaudeStream(prompt, opts = {}) { return sessionMod.runClaudeStream(this, prompt, opts); }
  parseEnvelope(raw) { return sessionMod.parseEnvelope(this, raw); }
  parseHeadlessResult(raw) { return sessionMod.parseHeadlessResult(this, raw); }

  async runHeadlessReview(pr) { return reviewMod.runHeadlessReview(this, pr); }

  async refreshStaleStates(agora) { return staleMod.refreshStaleStates(this, agora); }
  async staleForReview(pr) { return staleMod.staleForReview(this, pr); }

  // --- pushback automático: detecta e classifica a contestação do autor ------
  // Best-effort: qualquer incerteza não registra nada. O
  // gatilho barato via gh evita acender IA à toa; a classificação é 1 sessão
  // Claude por candidato novo, LEITURA pura (nunca posta), limitada por ciclo.
  async scanPushbacks() { return pushbackMod.scanPushbacks(this); }
  async detectAuthorPushback(pr, seen) { return pushbackMod.detectAuthorPushback(this, pr, seen); }
  async classifyPushback(pr, marker) { return pushbackMod.classifyPushback(this, pr, marker); }

  // Decisão + postagem no GitHub: colaborador lib/engine/decision.js (gate intacto).
  recordDecision(pr, result, extra) { return decisionMod.recordDecision(this, pr, result, extra); }
  resolveIntoHistory(item) { return decisionMod.resolveIntoHistory(this, item); }
  decisionByKey(key) { return decisionMod.decisionByKey(this, key); }
  reviewActions() { return decisionMod.reviewActions(this); }
  saveDecisions() { return decisionMod.saveDecisions(this); }
  async myReviewsWithTime(pr) { return decisionMod.myReviewsWithTime(this, pr); }
  async myReviewStates(pr, headSha) { return decisionMod.myReviewStates(this, pr, headSha); }
  async reconcilePending(keys) { return decisionMod.reconcilePending(this, keys); }
  async retryFailedPosts() { return decisionMod.retryFailedPosts(this); }
  async varrerEsperas() { return esperaProvaMod.varrerEsperas(this); }
  shouldAutoApprove(pr, result) { return decisionMod.shouldAutoApprove(this, pr, result); }
  shouldAutoReject(pr, result) { return decisionMod.shouldAutoReject(this, pr, result); }
  rejectBodyWithMark(body) { return decisionMod.rejectBodyWithMark(this, body); }
  attentionPoints(result) { return decisionMod.attentionPoints(this, result); }
  contestations(result) { return decisionMod.contestations(result); }
  coverageGap(result) { return decisionMod.coverageGap(result); }
  checkpointGap(result) { return decisionMod.checkpointGap(result); }
  checksVermelhos(result) { return decisionMod.checksVermelhos(result); }
  async postReview(pr, payload, opcoes) { return decisionMod.postReview(this, pr, payload, opcoes); }
  decisionForUi(item) { return decisionMod.decisionForUi(item); }
  writeMemory(result, actionLabel) { return decisionMod.writeMemory(this, result, actionLabel); }
  removeTeamMember(login) { return decisionMod.removeTeamMember(this, login); }
  async decide(id, action, ...opcoes) { return decisionMod.decide(this, id, action, ...opcoes); }

  // diagnóstico unificado (A3): o MESMO markdown para a tela, para a cópia e para a IA
  diagnosticoMarkdown() { return diagnosticoMod.diagnosticoMarkdown(this); }
  diagnosticoFalhas() { return diagnosticoMod.falhasParaTela(this); }
  // plano e chaves explícito (A2): testar é ato explícito e nunca grava; adotar só com confirmação
  claudeTestarPerfil(dados) { return perfilMod.testarPerfil(this, dados); }
  ignore(key) {
    this.markSeen(key);
    this.marcarIgnorado(key);
    this.queue = this.queue.filter(p => p.key !== key);
    this.pushState();
  }

  restore(key) {
    this.unsee(key);
    if (this.ignorados) { this.ignorados.delete(key); this.saveIgnorados(); }
    this.checkNow();
  }

  // qual AUTENTICAÇÃO usar pras sessões. Candidatos: 1) claudeProfileId (padrão do Farol);
  // 2) os demais perfis utilizáveis, de assinatura ou de chave de API, na ordem da lista. Usa
  // o primeiro fora do limite do plano; todos no limite, o de reset mais cedo (18/11/2026,
  // escolherPerfil em lib/engine/limite-plano.js). null = sem perfil utilizável (a sessão não
  // abre; lib/engine/perfil-claude.js).
  resolveClaudeAuth() { return escolherPerfil(this, perfilMod.candidatosDaConta(this.config), perfilMod.authPronto); }

  // status de TODOS os perfis salvos, pro doctor mostrar quem está pronto: chave preenchida
  // ou pasta da assinatura com login gravado. Não abre o CLI nem toca a rede.
  allClaudeAuthInfo() { return perfilMod.infoDosPerfis(this.config); }

  async doctor({ forcarVersaoClaude = false } = {}) {
    const leitura = {};
    this.doctorLeitura = leitura;
    const primary = this.primaryUser();
    const tokenArgs = primary ? ['auth', 'token', '--user', primary] : ['auth', 'token'];
    const [gh, claude, avaliacaoTecnica, auth] = await Promise.all([
      io.run('gh', ['--version']),
      io.runShell('claude --version'), diagnosticoMod.avaliacaoTecnicaDoDoctor().catch(() => null),
      // o probe roda no MESMO env que o engine usa, e nao no herdado: `gh auth
      // token` SEM --user honra o GH_TOKEN do ambiente, entao sem conta primaria
      // o check ficava verde por um token que o ghEnv recusa, e o doctor mentia
      // pro lado pior, o de dizer que da pra rodar. Com conta primaria o --user
      // ja lia o keyring; passar o env mantem os dois casos falando da mesma
      // identidade. ghEnv() sem user nunca lanca (o contrato legado do doctor).
      io.run('gh', tokenArgs, { env: this.ghEnv() }),
    ]);
    if (this.doctorLeitura !== leitura) return this.doctorInfo;
    this.doctorInfo = {
      node: process.version,
      gh: gh.ok ? gh.stdout.split('\n')[0].trim() : null,
      claude: claude.ok ? claude.stdout.trim().split('\n')[0] : null,
      ghAuth: auth.ok && !!auth.stdout.trim(),
      // rodar como root quebra a revisão autônoma INTEIRA, e não é opção de
      // config: o `--dangerously-skip-permissions` do headless é fixo na linha
      // do runClaudeStream, sem chave que o desligue. Sem este campo, o sintoma é
      // um "saiu com código 1" por ciclo, pra sempre, com o doctor todo verde.
      root: rodandoComoRoot(),
      instanciaIsolada, // FAROL_HOME fora de ~/.farol: não escreve no GitHub sem opt-in por arquivo
      // saude: no ar desde, commit, disco e telemetria (saude-do-motor.js)
      home: HOME, workspace: WORKSPACE, avaliacaoTecnica, saude: diagnosticoMod.saudeDoMotor(this),
      claudeAuth: this.allClaudeAuthInfo(), // status de cada perfil do Claude salvo
      ...perfilMod.prontidaoParaDoctor(this.config), // o perfil que o motor vai usar tem credencial?
      checkedAt: Date.now()
    };
    if (forcarVersaoClaude || this.claudeVersao) {
      await versaoClaude.atualizarVersaoClaude(this, { forcar: forcarVersaoClaude, instalada: this.doctorInfo.claude });
    }
    if (this.doctorLeitura !== leitura) return this.doctorInfo;
    this.pushState();
    return this.doctorInfo;
  }

  sanearPreferencia(key, value, config = this.config) { return sanear(key, value, config, PARSERS); }

  updateSettings(patch, origem) {
    const previous = this.config;
    this.config = { ...previous };
    let intervalChanged = false;
    const politicaAntes = contasConfig.retratoDaPolitica(this.config);
    // itera o PATCH, não a allowlist: é o que permite VER a chave que ninguém
    // reconhece e devolvê-la em `ignoradas`, em vez de deixar a tela dizer
    // "Configuração salva." pra algo que nunca foi salvo.
    const ignoradas = [];
    for (const k of Object.keys(patch || {})) {
      if (!EDITAVEIS.has(k)) { ignoradas.push(k); continue; }
      // O saneamento inteiro vive na tabela (lib/settings.js). Aqui fica só o efeito
      // colateral, que é de ciclo de vida do engine e não do valor: reprogramar o polling.
      if (k === 'intervalSeconds') intervalChanged = true;
      this.config[k] = this.sanearPreferencia(k, patch[k]);
    }
    try { this.saveConfig(); }
    catch (error) { this.config = previous; throw error; }
    contasConfig.registrarMudancas(this, contasConfig.mudancasDePolitica(politicaAntes, contasConfig.retratoDaPolitica(this.config)), origem);
    env.setDebugSpawns(this.config.debugSpawns); // liga/desliga o logger depois de salvar
    if (intervalChanged) this.checkNow();
    // perfil (lista ou padrão global) mudou: o badge do perfil de chave de API (doctor.claudeAuth)
    // fica desatualizado até o próximo boot ou clique em "Reverificar" - recalcula na hora
    // pra badge refletir o estado real logo após salvar.
    if ('claudeProfiles' in patch || 'claudeProfileId' in patch) {
      this.doctor().catch(() => {});
    }
    this.emit('settings-changed', this.config);
    this.pushState();
    // devolve o que NÃO foi aceito. Antes esta função não devolvia nada, então a tela
    // dizia "Configuração salva." mesmo quando o servidor tinha descartado a chave, e
    // a preferência sumia sem ninguém saber. Vazio = tudo entrou.
    if (ignoradas.length) this.log('WARN', `updateSettings ignorou chave desconhecida: ${ignoradas.join(', ')}`);
    return { ok: true, ignoradas };
  }
  origemDe(userAgent) { return contasConfig.origemDaRequisicao(userAgent); }
  // conta editada por OPERAÇÃO sobre a config atual, nunca pelo que a tela tinha na memória
  editarConta(op, origem) { return contasConfig.editarConta(this, op, origem); }

  // Credencial do Jira: colaborador lib/jira/credentials.js, único lugar que lê ou
  // escreve o arquivo separado (o token nunca entra no config.json, que trafega
  // pra UI). Nunca ecoe o retorno com o valor: as duas devolvem só booleano.
  //
  // O pushState não é enfeite: o selo "credencial cadastrada" sai do snapshot, e
  // sem empurrar o estado a tela só descobria a mudança no próximo ciclo de
  // polling (300s por padrão). Quem removia via clicar de novo no botão e receber
  // false, que a UI mostra como erro vermelho de uma remoção que já tinha dado certo.
  setJiraCredential(siteId, valor) { const ok = credMod.setCredential(siteId, valor); this.pushState(); return ok; }
  removeJiraCredential(siteId) { const ok = credMod.removeCredential(siteId); this.pushState(); return ok; }

  // Testa o site cadastrado contra o Jira de verdade (ver testarSite em lib/engine/jira.js).
  testarJiraSite(siteId) { return jiraMod.testarSite(this, siteId); }

  // A projeção das sessões ativas, com quem mais está revisando o PR da sessão: o motor anota
  // isso a cada ciclo nos PRs abertos (skip-review.js), e o PR da sessão já saiu da fila.
  sessoesParaTela() {
    const outros = new Map((this.panorama || []).map(p => [p.key, p.outrosRevisando]));
    return sessionMod.projectSessions([...this.activeReviews.values()]).map((s) => {
      const quem = outros.get((s.keys || [])[0]);
      return Array.isArray(quem) && quem.length ? { ...s, outrosRevisando: quem } : s;
    });
  }

  snapshot() {
    return {
      // `app` é a IDENTIDADE do app (nome, versão e plataforma), e só ela: o
      // catálogo de seleções (lib/modelos.js), de onde a tela monta os seletores, é outra coisa
      app: { name: APP_NAME, version: APP_VERSION, platform: process.platform },
      modelos: catalogoDeModelos(this.claudeVersao || null),
      // perfil apontado que a resolução não usa (A2): a queda não é silenciosa
      claudePerfis: perfilMod.perfisParaTela(this), // e o uso do plano de cada perfil de assinatura
      status: this.status, agora: Date.now(), // agora: a hora do motor no retrato, para a tela medir a diferença de relógio
      error: this.lastError,
      baseline: this.baseline ??= lerBaseline(BASELINE_FILE),   // desde quando vigia (lido uma vez)
      account: { user: this.primaryUser(), tokenOk: this.tokenOk },
      // lista de UM: a conta revisora como a tela a vê (lib/engine/contas-config.js)
      accounts: contasConfig.contasParaTela(this),
      pushbacks: this.pushbacks,
      config: perfilMod.configParaFora(this.config), // sem a chave de API: só `temChave` (lib/engine/chave-do-perfil.js)
      // lista mascarada dos sites do Jira: mesmos campos do config, mais só a
      // EXISTÊNCIA da credencial (hasCredential), nunca o valor (ver lib/jira/sites.js).
      jiraSites: maskJiraSites(this.config.jiraSites || [], credMod.hasCredential),
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      checagem: checagemParaTela(this), // as organizações do ciclo em curso, ou null (checagem-em-curso.js)
      // contas com as buscas paradas por limite do GitHub, e ate quando: sem isto a tela
      // exibe panorama velho sem dizer que ele esta velho (lib/engine/limite-gh.js)
      buscasPausadas: limiteGhMod.buscasPausadas(this),
      queue: this.queue,
      inicioAutomatico: this.inicioAutomaticoDaFila(),
      // PRs em conflito com a base: { key: { at, head } }, sem sessão nem label (lib/engine/espera-conflito.js)
      esperaConflito: Object.fromEntries(Object.entries(this.esperaConflito || {}).map(([k, v]) => [k, { at: v.at, head: v.head, updatedAt: v.updatedAt }])),
      // PRs da fila que estacionaram (falha, cancelamento, label retirada): o card mostra
      // quando e por quê, senão "nunca revisou" e "revisou e caiu" são idênticos na tela
      parked: this.parkedParaUi(),
      // De fora da fila: os pedidos que o motor não revisa sozinho, com o motivo, e a retentativa
      // por PR, { tentativas, aPartirDe } (lib/engine/de-fora.js). A `queue` não muda: a tela fatia
      deFora: deForaParaTela(this), emRetentativa: emRetentativaParaTela(this),
      // card de commit novo (pendência stale_head): o que o round automático vai fazer e
      // quando, ou por que não vai. Sem isto o card pedia clique no caso em que o app agia sozinho
      reRounds: this.reRoundParaUi(),
      // projeção pura: tira o interno (fileBlobs, mapa cru de agents) e entrega a
      // contagem/lista compacta de subagentes que a UI mostra no card da sessão
      activeSessions: this.sessoesParaTela(),
      activity: Object.fromEntries(this.activity),
      ...reviewMod.esperaParaTela(this),
      // Justiça de fila (spec 2026-09-10): leitura PURA do estado que o rodízio entre
      // organizações e o teto de revisões simultâneas já produzem, sem coleta nova. É o
      // que torna o rodízio visível: uma automação que cede a vez, vista de fora, é
      // idêntica a uma automação quebrada.
      filaJusta: this.filaJusta(),
      decisions: snapshotDecisions(this),
      reviewActions: snapshotReviewActions(this),
      usage: snapshotUsage(this.usageSummary()),
      doctor: this.doctorInfo,
      paths: { home: HOME, workspace: WORKSPACE }
    };
  }

  // Outra PESSOA já revisando este PR? Registra no acumulador do ciclo e devolve
  // true pro filtro do toReview cortar (registraPulo, lib/engine/skip-review.js).
  _registraPulo(pr, pulados) { return skipMod.registraPulo(this, pr, pulados); }

  // Consumo de tokens: colaborador lib/engine/usage.js (registro permanente, sem custo);
  // ref é a referência amigável (PR/chat/ferramenta) que alimenta a tabela de sessões.
  recordUsage(id, account, resultEvent, model, profileId, ref) { return usageMod.recordUsage(this, id, account, tentativasMod.comInicioDaTentativa(this, resultEvent), model, profileId, ref); }
  // corrige o DESFECHO de uma sessão já registrada (o gasto continua contado; o que
  // muda é se ele virou resultado). Ver a seção de auditoria no lib/engine/usage.js.
  marcarDesfecho(id, status, seEra) { return usageMod.marcarDesfecho(this, id, status, seEra ?? null); }
  // registro durável de falha por sessão, fora do farol.log (lib/engine/falhas.js)
  registrarFalha(dados) { return falhasMod.registrarFalha(this, dados); }
  falhasRecentes(opcoes) { return falhasMod.falhasRecentes(this, opcoes); }
  falhaDaSessao(sessionId) { return falhasMod.falhaDaSessao(this, sessionId); }
  usageSummary() { return usageMod.usageSummary(this); }
  // Até quando a assinatura do Claude desta conta está no limite do plano (0 = livre).
  // Fachada de lib/engine/limite-plano.js.
  limiteDoPlanoAte(acct) { return limiteAte(this, acct); }

  /* Painel de Justiça de fila (spec 2026-09-10-justica-de-fila-entre-orgs). Junta o que
     o escalonador já sabe, sem medir nada novo:

     - por ORG: quantos PRs esperam, há quanto tempo espera o mais antigo, e quando ela
       foi atendida pela última vez (o critério do rodízio, em cima da mesa);
     - teto GLOBAL de revisões simultâneas: em curso contra teto, só quando ligado.

     A cota de gasto por conta dentro do perfil saiu junto com o teto de gasto (16/11/2026).

     Leitura pura: não decide nada, não escreve nada. */
  filaJusta() {
    const agora = Date.now();
    const orgs = new Map();
    for (const pr of this.queue) {
      const org = reviewMod.headlessOrg(pr);
      const o = orgs.get(org) || { org, esperando: 0, esperaMaisAntigaMs: 0, ultimaVezMs: null };
      o.esperando++;
      const desde = Date.parse(pr.updatedAt || pr.createdAt || '') || 0;
      if (desde) o.esperaMaisAntigaMs = Math.max(o.esperaMaisAntigaMs, agora - desde);
      orgs.set(org, o);
    }
    for (const [org, v] of this.orgLastStart) {
      const o = orgs.get(org) || { org, esperando: 0, esperaMaisAntigaMs: 0, ultimaVezMs: null };
      o.ultimaVezMs = agora - v.at;
      orgs.set(org, o);
    }
    // sem ordem aqui: a tela ordena como o escalonador atende (ordemDoEscalonador, fila-justa.js)
    const porOrg = [...orgs.values()];

    let total = 0;
    for (const n of this.headlessBusyAccounts.values()) total += n;
    const tetoGlobal = Number(this.config.globalParallelReviews) || 0;
    return { porOrg, emCurso: total, tetoGlobal };
  }

  pushState() { this.emit('state', this.snapshot()); }

  // Deep-link de alerta: o shell (clique na notificação) pede pra UI levar
  // o usuário direto ao card do PR (a UI rola e destaca via SSE 'focus-pr').
  focusPr(url) { if (url) this.emit('focus-pr', { url }); }

  async start() {
    // o start() só roda com a porta (a trava de instância única) já tomada: é a hora de abrir o
    // banco da telemetria, importar os JSON (e o histórico de decisões) e reconciliar as tentativas
    iniciarTelemetria(this);
    iniciarManutencaoDoEngine(this);
    // depois do loadDecisions do construtor: a migração precisa saber quem tem decisão
    this.migrarIgnorados();
    // Só o engine que subiu de verdade lê o uso do plano do Claude (lib/engine/uso-do-plano.js):
    // o de teste nunca abre o CLI. A chave divide a linha com o doctor porque o server.js está
    // no teto do ratchet de tamanho.
    this.usoDoPlanoLigado = true; this.doctor().then(() => diagnosticoMod.registrarAvaliacaoNoBoot(this)).catch(() => {});
    // label presa por morte do processo: limpa antes do primeiro ciclo, pra a
    // frota não continuar saindo de cena por uma sessão que não existe mais
    if (this.inflightRecuperado && this.inflightRecuperado.length) {
      const presos = this.inflightRecuperado;
      this.inflightRecuperado = [];
      // o token ANTES da limpeza: `this.token` nasce vazio no construtor e só é
      // preenchido pelo refreshTokens de dentro do check(), que roda depois daqui.
      // Sem isto, o `if (!engine.tokenFor(acc)) continue` do limparLabelsOrfas caía
      // em TODA iteração, de forma síncrona, e a cura da label presa nunca removeu
      // uma label sequer: a função ficava verde em teste (que injeta tokenFor) e era
      // um no-op garantido em produção.
      this.refreshTokens()
        .then(() => reviewMod.limparLabelsOrfas(this, presos))
        .catch(() => {});
    }
    await this.check('startup');
  }
}

// --- bootstrap ---------------------------------------------------------------

function start(onReady) {
  const engine = new Engine();
  let began = false;
  const server = startServer(engine, (url, err) => {
    // O listen na porta é o lock de instância única do motor
    // (`node server.js`). Com a porta ocupada já existe um Farol
    // usando este ~/.farol: um segundo engine com polling próprio revisaria PR
    // em dobro e escreveria seen/inflight/usage sem lock (A7). Por isso o
    // monitoramento só começa DEPOIS do listen dar certo.
    if (!err && !began) { began = true; engine.schedule(); engine.start(); registrarSaidaOrdenada(engine); }
    if (onReady) onReady(url, err);
  });
  return { engine, server, port: engine.config.port };
}

const farol = { start, HOME, WORKSPACE, Engine, modelLabel, isPermanentBranch,
  normalizeClaudeProfiles, normalizeClaudeProfileId, applyClaudeAuthEnv };
export default farol;
export { start, registrarSaidaOrdenada, HOME, WORKSPACE, Engine, modelLabel, isPermanentBranch,
  normalizeClaudeProfiles, normalizeClaudeProfileId, applyClaudeAuthEnv };

// execucao direta: modo servidor (`node server.js`)
if (executadoDireto(import.meta.url)) {
  // a recusa da fronteira (config.json com hostPublico ou origensPermitidas inválidos) sai limpa no stderr
  subirOuRecusar(() => start((url, err) => {
    if (err) { console.error('[farol] erro ao subir o servidor:', err.message); process.exit(1); }
    // um console.log só, com as duas linhas de sempre: o server.js está no teto de linhas do ratchet
    console.log(`[farol] monitorando · API em ${url}\n[farol] Ctrl+C para sair`);
  }));
}
