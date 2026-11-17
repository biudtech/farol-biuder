// Concern de consumo de tokens (colaborador). Toda sessão headless do Claude emite um
// evento "result" com usage (input/output/cache) e total_cost_usd; aqui a gente registra
// isso de forma persistente e agregada (por dia, tipo, conta e modelo), sem gastar nada a
// mais. Só leitura do que a sessão já reporta. Funções recebem o engine como ctx; a Engine
// mantém fachadas finas. Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, APP_VERSION } from '../paths.js';
import { writeJsonAtomic } from '../io.js';
import { modelLabel } from '../format.js';
import { accountResult, modelBuckets, extractUsage } from './usage-accounting.js';
// vocabulário do registro (desfechos, origens de custo e as marcas farol_* do evento)
import { DESFECHOS, ORIGENS_DESCONHECIDAS, camposDaTentativa, auditoriaDeConsumo } from './usage-desfechos.js';
import { falhasPorSessao } from './falhas.js';
import { invalidateUsage, invalidateUsageStore, usageProjection } from './usage-projection-cache.js';
import { KIND_LABEL, KIND_ORDER, RESTO, emptyBucket, addBucket, matrixSeriesFrom, stackedSeriesFor } from './usage-series.js';

const USAGE_FILE = path.join(STATE_DIR, 'usage.json');
const SESSIONS_FILE = path.join(STATE_DIR, 'usage-sessions.json');
const MAX_DAYS = 120; // guarda ~4 meses de timeline diária (totais nunca se perdem)


function defaultUsage() {
  return {
    totals: emptyBucket(), days: {}, byKind: {}, byAccount: {}, byModel: {}, byProfileDay: {},
    daysByKind: {}, daysByModel: {}, daysByAccount: {}, daysByKindModel: {},
  };
}

function defaultSessions() { return { sessions: [] }; }

// tipo da sessão pelo prefixo do id (a=review, pb=pushback, f=ferramenta, c=chat)
function kindFromId(id) {
  const s = String(id || '');
  if (s.startsWith('pb')) return 'pushback';
  return ({ a: 'review', f: 'tool', c: 'chat' })[s[0]] || 'outro';
}

/* ---------- custo de sessão que morreu no meio (auditoria, 31/08/2026) ----------

   O custo em dólar SÓ existe no evento final da sessão (`total_cost_usd`). As
   mensagens do stream trazem token e nunca custo, conferido no transcript real de uma
   sessão do Farol. Então sessão morta no meio tem token MEDIDO e custo desconhecido, e
   as duas saídas ruins seriam gravar zero (o dinheiro some da tela, que foi o buraco de
   31/08) ou inventar tabela de preço (segunda fonte de verdade pro mesmo número, que
   envelhece calada quando o preço muda).

   A saída é medir do PRÓPRIO registro: as sessões já concluídas dizem quanto custou o
   token daquele tipo e modelo, e a taxa se corrige sozinha quando o preço muda.

   O DENOMINADOR É O TOKEN DE SAÍDA, e isso foi medido, não escolhido por gosto. Sobre
   as 448 sessões medidas em disco, a dispersão p90/p10 da taxa por denominador:

     token total          review 10,7x   self 17,6x
     só saída             review  4,9x   self  4,6x   <- o mais estável
     input+output         review  4,9x   self  4,6x
     ponderado 1/5/1,25/0,1  review  6,9x   self  8,5x

   O token total perde porque a fatia de cache varia demais entre sessões, e cache lido
   é ordens de grandeza mais barato. Mesmo o melhor denominador erra por um fator de ~5
   na cauda, e é por isso que o registro carrega `costSource`: estimativa entra na
   soma (o dinheiro foi gasto de verdade), e nunca se disfarça de medição. */
const MIN_AMOSTRA_TAXA = 3;

function tokensDeCusto(s) { return Number(s && s.outputTokens) || 0; }

// US$ por token de saída, mediana das sessões MEDIDAS do mesmo modelo. Prefere o mesmo
// tipo (uma revisão custa por token diferente de um pushback) e cai pro modelo inteiro
// quando o tipo não tem amostra. Modelo diferente NUNCA empresta taxa: preço de modelo
// não é fungível. PURA.
function taxaObservada(sessions, kind, model) {
  const base = (sessions || []).filter(s => s && s.status === 'ok'
    && Number(s.costUsd) > 0 && tokensDeCusto(s) > 0 && s.model === model);
  const doTipo = base.filter(s => s.kind === kind);
  const amostra = doTipo.length >= MIN_AMOSTRA_TAXA ? doTipo : base;
  if (amostra.length < MIN_AMOSTRA_TAXA) return null;
  return mediana(amostra.map(s => s.costUsd / tokensDeCusto(s)));
}

// Custo estimado de um gasto que não teve evento final. Sem base, devolve ZERO dizendo
// `desconhecido` (até a v2.59.3 era `sem-base`, que continua sendo lido igual): o token
// continua registrado (ele é medido) e o custo fica declarado como desconhecido, em vez
// de virar um número que ninguém pode auditar. PURA.
function estimarCusto(sessions, kind, model, outputTokens) {
  const taxa = taxaObservada(sessions, kind, model);
  if (taxa === null || !(Number(outputTokens) > 0)) return { costUsd: 0, source: 'desconhecido' };
  return { costUsd: taxa * Number(outputTokens), source: 'estimado' };
}


// Corrige o DESFECHO de uma sessão já registrada, pelo id. Não toca no dinheiro: o
// gasto aconteceu e continua contado no agregado; o que muda é se ele virou
// resultado. Só o log individual carrega desfecho (o agregado soma dinheiro, não
// história), então é só ele que se corrige.
function marcarDesfecho(engine, id, status) {
  if (!id || !DESFECHOS.includes(status)) return false;
  const lista = (engine.usageSessions && engine.usageSessions.sessions) || [];
  const alvo = [...lista].reverse().find(s => s && s.id === id);
  if (!alvo) return false;
  alvo.status = status;
  saveSessions(engine);
  engine.pushState();
  return true;
}

// extrai os tokens do evento result do stream-json (0 quando ausente: stub de teste, CLI antigo)

// soma os tokens de uma sessão num bucket (conta como 1 sessão)
function addSession(bucket, u) {
  bucket.sessions += 1;
  bucket.inputTokens += u.inputTokens;
  bucket.outputTokens += u.outputTokens;
  bucket.cacheReadTokens += u.cacheReadTokens;
  bucket.cacheCreationTokens += u.cacheCreationTokens;
  bucket.costUsd += u.costUsd;
}

// soma um bucket inteiro em outro (pra agregar janelas de dias)

function pick(store, mapName, key) {
  const map = store[mapName];
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

function pickComposite(map, dim, day) {
  const key = `${dim}|${day}`;
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

function pickKindModel(map, kind, model, day) {
  const key = `${kind}|${model}|${day}`;
  if (!map[key]) map[key] = emptyBucket();
  return map[key];
}

// poda os dias mais antigos de `days` E dos 4 buckets cruzados por dia, no mesmo
// corte (MAX_DAYS): eles só alimentam grafico/matriz de ate 90 dias, ao contrario
// do log de sessoes (usage-sessions.json), que nao tem poda (registro permanente).
function pruneOldDays(store) {
  const days = Object.keys(store.days).sort();
  if (days.length <= MAX_DAYS) return;
  const doomed = days.slice(0, days.length - MAX_DAYS);
  for (const d of doomed) {
    delete store.days[d];
    for (const map of [store.daysByKind, store.daysByModel, store.daysByAccount]) {
      for (const k of Object.keys(map)) if (k.endsWith(`|${d}`)) delete map[k];
    }
    for (const k of Object.keys(store.daysByKindModel)) if (k.endsWith(`|${d}`)) delete store.daysByKindModel[k];
  }
}

// aplica uma sessão a todos os eixos do store (PURO: não toca em disco nem no relógio;
// recebe o dia pronto, pra ser testável). profileId é opcional: sessão sem perfil (ou com
// '') não gera entrada no bucket byProfileDay. Devolve o próprio store.
function applyUsage(store, day, kind, account, model, u, profileId) {
  addSession(store.totals, u);
  addSession(pick(store, 'days', day), u);
  addSession(pick(store, 'byKind', kind), u);
  addSession(pick(store, 'byAccount', account), u);

  // defaultUsage() sempre entrega os 4 mapas prontos, mas um store vindo de
  // outro lugar (disco antigo, teste) pode faltar um deles; mesma defesa que
  // byProfileDay já tinha logo abaixo, por consistência (nunca perder o
  // rastreio inteiro calado por causa de uma chave ausente).
  if (!store.daysByKind) store.daysByKind = {};
  if (!store.daysByModel) store.daysByModel = {};
  if (!store.daysByAccount) store.daysByAccount = {};
  if (!store.daysByKindModel) store.daysByKindModel = {};
  addSession(pickComposite(store.daysByKind, kind, day), u);

  addSession(pickComposite(store.daysByAccount, account, day), u);
  applyModelBuckets(store, day, kind, u.modelBuckets || [[model, u]]);
  // byProfileDay é medição gravada (o gasto por perfil e dia) e hoje não tem leitor: quem o
  // lia era o teto de gasto, que saiu em 16/11/2026. Fica porque o registro é permanente.
  if (profileId) {
    if (!store.byProfileDay) store.byProfileDay = {};
    const key = `${profileId}|${day}`;
    if (!store.byProfileDay[key]) store.byProfileDay[key] = emptyBucket();
    addSession(store.byProfileDay[key], u);
  }
  pruneOldDays(store);
  invalidateUsageStore(store);
  return store;
}

function applyModelBuckets(store, day, kind, buckets) {
  for (const [model, u] of buckets) {
    const key = modelLabel(model) || 'desconhecido';
    addSession(pick(store, 'byModel', key), u);
    addSession(pickComposite(store.daysByModel, key, day), u);
    addSession(pickKindModel(store.daysByKindModel, kind, key, day), u);
  }
}

function saveUsage(engine) {
  invalidateUsage(engine);
  try { writeJsonAtomic(USAGE_FILE, engine.usage); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage.json: ${err.message}`); }
}

function saveSessions(engine) {
  invalidateUsage(engine);
  try { writeJsonAtomic(SESSIONS_FILE, engine.usageSessions); }
  catch (err) { if (engine.log) engine.log('WARN', `salvar usage-sessions.json: ${err.message}`); }
}

// Dia LOCAL do processo (YYYY-MM-DD). Regra do projeto: horário de Brasília na
// tela, nunca UTC cru; com o corte UTC, às 21h locais o dia virava e o card
// "Hoje" zerava. Buckets antigos gravados em dia UTC ficam COMO ESTÃO (decisão:
// sem migração, o registro é permanente); só o registro novo corta no local, e a
// transição pode deslocar na série as sessões da noite anterior por um dia.
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// registra o consumo de uma sessao que terminou (sucesso OU erro) nos dois lugares:
// o agregado (usage.json, via applyUsage) e o log individual permanente, sem poda
// (usage-sessions.json), que alimenta a tabela "Sessoes recentes" da aba Consumo.
// `ref` e a referencia amigavel mostrada na tela (chave do PR, do chat, ou o
// rotulo da ferramenta); ausente vira null, nunca quebra o registro.
function recordUsage(engine, id, account, resultEvent, model, profileId, ref) {
  const rows = engine.usageSessions?.sessions || [];
  if (resultEvent?.farol_attempt && rows.some(r => r.attemptId === resultEvent.farol_attempt)) return;
  const acc = String(account || '').toLowerCase() || '(sem conta)';
  const ev = accountResult(resultEvent || {}, rows, { account: acc, profileId: profileId || '' });
  const u = extractUsage(ev, model);
  // custo desconhecido DECLARADO (sessão que falhou, tentativa interrompida sem token) é
  // gasto que existe sem valor conhecido: registrar é o que impede de sumir da tela.
  // Sem a marca, tudo zerado continua sendo stub de teste ou CLI antigo.
  const desconhecido = ev.farol_custo_desconhecido === true || ev.farol_interrompida === true;
  // so ignora sessao com token E custo zerados (stub de teste, CLI antigo): custo sem
  // token contabiliza, senao dinheiro real ficaria fora da tela.
  if (!desconhecido && !u.inputTokens && !u.outputTokens && !u.cacheReadTokens && !u.cacheCreationTokens && !u.costUsd) return;
  if (!engine.usage) engine.usage = defaultUsage();
  if (!engine.usageSessions) engine.usageSessions = defaultSessions();
  const day = localDay();
  const kind = kindFromId(id);
  // PARCIAL: a sessao morreu antes do evento final, entao o token e medido e o custo
  // nao existe em lugar nenhum. Estima pela taxa que as sessoes concluidas mediram, e
  // carimba a origem: entra na soma (o dinheiro foi gasto) sem se passar por medicao.
  const parcial = !!(resultEvent && resultEvent.farol_parcial);
  let costSource = desconhecido && !parcial ? 'desconhecido' : 'medido';
  if (parcial) {
    const est = estimarCusto(engine.usageSessions.sessions, kind, modelLabel(model) || 'desconhecido', u.outputTokens);
    u.costUsd = est.costUsd;
    costSource = est.source;
  }
  u.modelBuckets = modelBuckets(ev, u, model);
  applyUsage(engine.usage, day, kind, acc, model, u, profileId);
  saveUsage(engine);
  // tabela NA ORDEM DE PRECEDÊNCIA; a primeira marca ligada nomeia o desfecho.
  // `interrompida` vem antes de `parcial`: a tentativa interrompida quase sempre também é
  // parcial, e "o Farol morreu no meio" é o que explica a linha.
  const marcas = [[ev.farol_interrompida, 'interrompida'], [parcial, 'parcial'], [ev.farol_cancelled, 'cancelada'], [ev.is_error, 'erro']];
  const status = (marcas.find(([ligada]) => ligada) || [true, 'ok'])[1];
  engine.usageSessions.sessions.push({
    // id da sessao: e por ele que o desfecho se corrige depois (marcarDesfecho), no
    // caso em que a sessao termina bem e o RESULTADO e que e jogado fora
    id: id || null,
    at: Date.now(), day, kind, ref: ref || null, account: acc,
    model: modelLabel(model) || 'desconhecido', profileId: profileId || '',
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, thinkingTokens: u.thinkingTokens || undefined,
    cacheReadTokens: u.cacheReadTokens, cacheCreationTokens: u.cacheCreationTokens,
    costUsd: u.costUsd,
    // versao do Farol que gravou esta sessao (pedido do dono, 15/08/2026):
    // so aparece na tabela "Sessoes recentes" da aba Consumo, NUNCA em prompt
    // (recordUsage roda pos-sessao, depois que o Claude ja encerrou). Sessoes
    // gravadas antes desta feature nao tem o campo, e ficam assim pra sempre
    // (registro permanente, sem migracao).
    farol: APP_VERSION,
    // 'medido' | 'estimado' | 'sem-base'. Existe pra que qualquer total possa ser
    // quebrado em quanto foi medido e quanto foi estimado: sem isso a estimativa se
    // dissolve no número e a auditoria deixa de poder responder de onde ele veio.
    costSource,
    provider: ev.farol_provider || '',
    billingKind: ev.farol_billing_kind || '',
    accounting: ev.farol_accounting,
    modelUsage: ev.farol_model_usage,
    // 'parcial' vem primeiro porque uma sessão morta no meio quase sempre também
    // carrega a marca de cancelamento, e "não chegou ao fim" é o que explica a linha.
    // 'cancelada' (marca farol_cancelled posta pelo session.js) tem precedência sobre
    // 'erro': o desfecho que o usuário provocou explica melhor a linha que o is_error
    // que o kill costuma produzir junto.
    status,
    ...camposDaTentativa(ev),
  });
  saveSessions(engine);
  engine.pushState();
}

// mediana de uma lista de números (a taxa observada do custo por token de saída)
function mediana(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// as ultimas `limit` sessoes do log permanente, mais nova primeiro (so o que
// trafega pra UI e cortado; o arquivo em disco guarda tudo, sem poda).
function recentSessionsFrom(engine, limit = 100) {
  const list = (engine.usageSessions && engine.usageSessions.sessions) || [];
  return list.slice(-limit).reverse();
}

// resumo pro snapshot/UI (tela Consumo). FONTE UNICA da aba inteira: a serie
// diaria (days, eixo autoritativo), as series empilhadas e a matriz JA
// RECONCILIADAS contra ela (camada _resto), e o log de sessoes. A UI so fatia
// janela e formata; nenhuma definicao de dado mora la. E so leitura/agregacao;
// nao ha como zerar (o registro e permanente, por decisao).
// Invariantes (travados em test/usage.test.js): pra todo dia, a soma dos items
// de stackedSeries[dim] == series[day] e o total de matrixSeries == series[day],
// campo a campo. Janela (hoje/7/30/90) e quem consome que corta, sobre a MESMA
// serie: por isso nao existem mais today/last7/last30 pre-somados aqui (payload
// morto com definicao propria de janela, aposentado na v2.40.0, junto com
// byKind/byAccount/byModel/byProfile que nenhum painel lia).
function staticUsageSummary(engine) {
  const store = engine.usage || defaultUsage();
  const series = Object.entries(store.days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, ...b }));
  const kindNames = KIND_ORDER.slice();
  const modelNames = Object.keys(store.byModel);
  const accountNames = Object.keys(store.byAccount);
  const byKind = stackedSeriesFor(store, store.daysByKind || {}, kindNames, k => KIND_LABEL[k] || k);
  const byModel = stackedSeriesFor(store, store.daysByModel || {}, modelNames, m => m);
  const byAccount = stackedSeriesFor(store, store.daysByAccount || {}, accountNames, a => a);
  const matrix = matrixSeriesFrom(store);
  const sessions = (engine.usageSessions && engine.usageSessions.sessions) || [];
  const recentSessions = recentSessionsFrom(engine);
  return {
    totals: store.totals,
    series,
    // _resto so entra na lista de nomes quando existe resto em algum dia: a UI
    // esconde serie zerada na janela sozinha, entao a camada some naturalmente
    // quando a janela escolhida ja e 100% detalhada
    kindNames: byKind.hasResto ? [...kindNames, RESTO] : kindNames,
    modelNames: byModel.hasResto ? [...modelNames, RESTO] : modelNames,
    accountNames: byAccount.hasResto ? [...accountNames, RESTO] : accountNames,
    matrixKindNames: matrix.hasResto ? [...kindNames, RESTO] : kindNames,
    matrixModelNames: matrix.hasResto ? [...modelNames, RESTO] : modelNames,
    stackedSeries: { byKind: byKind.series, byModel: byModel.series, byAccount: byAccount.series },
    matrixSeries: matrix.series,
    recentSessions,
    // falha durável das sessões da tabela, pelo id da linha (A1, item 6)
    // AUDITORIA: quanto do gasto virou resultado, e quanto do custo é estimativa.
    // Vive aqui e não na UI pela mesma razão do resto deste resumo: definição de dado
    // é do engine. A janela é o registro INTEIRO, que é permanente e sem poda, então
    // "todo o histórico" é uma janela bem definida, ao contrário das do gráfico.
    auditoria: auditoriaDeConsumo(sessions),
    sessionsSince: sessions.length ? sessions[0].at : null,
    retentionDays: MAX_DAYS,
  };
}

function usageSummary(engine) {
  const value = usageProjection(engine, () => staticUsageSummary(engine));
  return { ...value, falhasPorSessao: falhasPorSessao(engine, value.recentSessions.map(s => s && s.id)) };
}

const usageMod = {
  USAGE_FILE, defaultUsage, SESSIONS_FILE, defaultSessions, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, RESTO, mediana,
  taxaObservada, estimarCusto, auditoriaDeConsumo, marcarDesfecho, DESFECHOS, ORIGENS_DESCONHECIDAS,
};
export default usageMod;
export {
  USAGE_FILE, defaultUsage, SESSIONS_FILE, defaultSessions, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay, RESTO, mediana,
  taxaObservada, estimarCusto, auditoriaDeConsumo, marcarDesfecho, DESFECHOS, ORIGENS_DESCONHECIDAS,
};
