// O motor não tem teto de gasto (decisão do dono, 16/11/2026): nenhuma revisão, rodada,
// retentativa, recuperação, busca de contestação ou lote é barrada, adiada ou estacionada por
// dinheiro. O consumo continua medido e mostrado; ele só não decide mais nada.
//
// O cenário é o pior de antes: um config.json antigo, com teto zero em todos os eixos num
// perfil que já gastou hoje, e um PR estacionado por orçamento no estado gravado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-teto-'));
process.env.FAROL_HOME = home;
const CONFIG = path.join(home, 'config.json');
const TETOS = ['budgetDaily', 'budgetTotal', 'budgetSince', 'budgetByWeekday', 'budgetDates'];
const PERFIL_ANTIGO = {
  id: 'p1', label: 'Perfil antigo', kind: 'apikey', apiKey: 'sk-teste', baseUrl: '',
  budgetDaily: 0, budgetTotal: 0, budgetSince: '2026-01-01',
  budgetByWeekday: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, budgetDates: { '2026-11-16': 0 },
};
const CONFIG_ANTIGA = JSON.stringify({
  esquemaConfig: 1,
  conta: { user: 'me', owners: ['acme'], autoReview: true, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' },
  claudeProfiles: [PERFIL_ANTIGO], claudeProfileId: 'p1',
});
fs.writeFileSync(CONFIG, CONFIG_ANTIGA);

const { Engine } = await import('../server.js');
const { STATE_DIR, BASELINE_FILE } = await import('../lib/paths.js');
const usage = (await import('../lib/engine/usage.js')).default;
const { normalizeClaudeProfiles } = await import('../lib/parse.js');
const { retryTargets } = await import('../lib/engine/review-retry.js');
const { pushbackTargets } = await import('../lib/engine/pushback.js');
const { pausaDaRecuperacao } = await import('../lib/engine/recuperacao-prova.js');
const reviewMod = (await import('../lib/engine/review.js')).default;

after(() => fs.rmSync(home, { recursive: true, force: true }));

const PARKED_FILE = path.join(STATE_DIR, 'auto-review-parked.json');
const PR = {
  key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'PR de teste',
  author: 'alice', repo: 'acme/app', number: 1, updatedAt: '2026-08-01T10:00:00Z', account: 'me',
};
const gasto = () => ({ sessions: 3, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 500 });

// O motor do cenário: o perfil antigo já gastou hoje, e toda saída é guardada para conferir.
function motor() {
  const e = new Engine();
  e.avisos = [];
  e.linhas = [];
  e.on('toast', (t) => e.avisos.push(t));
  e.log = (nivel, msg) => e.linhas.push(`${nivel} ${msg}`);
  e.pushState = () => { };
  e.token = 'tok-me';
  e.tokenFor = () => 'tok-me';
  e.usage.byProfileDay = { [`p1|${usage.localDay()}`]: gasto() };
  e.usageSessions = { sessions: [
    { id: 'a1', at: Date.now(), day: usage.localDay(), kind: 'review', account: 'me', profileId: 'p1', costUsd: 500, costSource: 'medido', status: 'ok' },
    { id: 'a2', at: Date.now(), day: usage.localDay(), kind: 'review', account: 'me', profileId: 'p1', costUsd: 0, costSource: 'desconhecido', status: 'erro' },
  ] };
  return e;
}

const falaDeTeto = (texto) => /or[çc]amento|teto|estour/i.test(String(texto));

test('config antiga com teto no perfil sobe, os campos de teto somem do perfil e o arquivo não é regravado na carga', () => {
  const e = new Engine();
  assert.equal(e.config.claudeProfiles.length, 1, 'o perfil continua valendo');
  assert.equal(e.config.claudeProfiles[0].id, 'p1');
  for (const campo of TETOS) assert.equal(campo in e.config.claudeProfiles[0], false, `${campo} não chega ao motor`);
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), CONFIG_ANTIGA, 'a carga não reescreve o config.json');
  assert.equal(e.resolveClaudeAuth('me').id, 'p1', 'o perfil antigo segue sendo o da conta');
});

test('a primeira gravação da config não leva campo de teto para o disco', () => {
  const copia = fs.readFileSync(CONFIG, 'utf8');
  try {
    const e = new Engine();
    e.saveConfig();
    const gravado = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    assert.equal(gravado.claudeProfiles[0].apiKey, 'sk-teste', 'o perfil é gravado inteiro');
    for (const campo of TETOS) assert.equal(campo in gravado.claudeProfiles[0], false, `${campo} não volta ao arquivo`);
  } finally { fs.writeFileSync(CONFIG, copia); }
});

test('o saneador de perfis descarta os cinco campos de teto, nos dois tipos de perfil', () => {
  const [chave, pasta] = normalizeClaudeProfiles([PERFIL_ANTIGO, { ...PERFIL_ANTIGO, id: 'p2', kind: 'dir', dir: '' }]);
  assert.deepEqual(Object.keys(chave).sort(), ['apiKey', 'baseUrl', 'id', 'kind', 'label']);
  assert.deepEqual(Object.keys(pasta).sort(), ['dir', 'id', 'kind', 'label']);
});

test('o motor não tem mais gate, fachada nem aviso de teto', () => {
  const e = motor();
  for (const nome of ['budgetBlockedFor', 'profileBudgetStatus', 'quotaBlockedFor', 'custoTipicoReview', 'budgetWarned']) {
    assert.equal(e[nome], undefined, `${nome} saiu da Engine`);
  }
  for (const nome of ['profileBudgetStatus', 'budgetStatusFor', 'budgetsFrom', 'dailyCapFor', 'dailyCapSource', 'sugestaoTetoDiario', 'custoTipicoDeReview', 'contarDesconhecidas']) {
    assert.equal(usage[nome], undefined, `${nome} saiu do registro de consumo`);
  }
});

test('o ciclo lança a revisão automática do perfil que passou do teto antigo, sem toast e sem WARN de gasto', async () => {
  const e = motor();
  e.seen = new Set();
  e.queue = [];
  e.decisions = { pending: [], resolved: [] };
  e.resolveAccount = async () => { };
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.refreshStaleStates = async () => { };
  e.refreshReviewSignals = async () => { };
  e.scanPushbacks = async () => { };
  e.schedule = () => { };
  e.saveSeen = () => { };
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.searchPRs = async () => [{ ...PR }];
  const lancados = [];
  e.launchReview = (urls) => { lancados.push(...urls); };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, '2020-01-01T00:00:00.000Z\n');

  await e.check('test');
  await e.check('test');

  assert.deepEqual([...new Set(lancados)], [PR.url], 'o PR foi lançado');
  assert.deepEqual(e.avisos.filter(t => falaDeTeto(t.text)), [], 'nenhum toast de gasto');
  assert.deepEqual(e.linhas.filter(falaDeTeto), [], 'nenhuma linha de gasto no log');
});

test('na vez do PR a sessão abre, do automático e do lote, e nada estaciona por orçamento', async () => {
  for (const extra of [{}, { lote: true, manual: true }]) {
    const e = motor();
    e.prState = async () => 'OPEN';
    let abriu = 0;
    e.runHeadlessReview = async () => { abriu++; throw new Error('sessão de teste'); };
    e.headlessBusyAccounts.set('me', 1);
    await e.runOneHeadless({ ...PR, ...extra }, 'me');
    assert.equal(abriu, 1, 'a sessão abriu');
    assert.notEqual((e.parkedMotivos[PR.key] || {}).tipo, 'orcamento');
    assert.deepEqual(e.avisos.filter(t => falaDeTeto(t.text)), []);
  }
});

test('a retentativa, a busca de contestação e a nova rodada não olham o gasto', () => {
  const e = motor();
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR } });
  assert.deepEqual(retryTargets(e, new Set(), new Set()).map(p => p.key), [PR.key], 'a retentativa volta');

  e.panorama = [{ ...PR }];
  e.pushbackScanned = {};
  e.decisions = { pending: [], resolved: [{ key: PR.key, status: 'auto_rejected', action: 'request_changes', reasons: ['quebra'], resolvedAt: 1 }] };
  assert.deepEqual(pushbackTargets(e, e.reviewActions()).map(p => p.key), [PR.key], 'a busca de contestação segue');

  const fonte = fs.readFileSync(new URL('../lib/engine/review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /parado\('orcamento'/, 'a nova rodada não tem motivo de orçamento');
  assert.equal(typeof reviewMod.reReviewTargets, 'function');
});

test('PR estacionado por orçamento num estado gravado antes volta a ser elegível no boot, e os outros motivos ficam', () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PARKED_FILE, JSON.stringify({
    keys: ['acme/app#1', 'acme/app#2', 'acme/app#3'],
    motivos: {
      'acme/app#1': { at: '2026-11-10T10:00:00.000Z', motivo: 'perfil "Perfil antigo"', tipo: 'orcamento', head: 'abc' },
      'acme/app#2': { at: '2026-11-10T10:00:00.000Z', motivo: 'cancelada por você', tipo: 'cancelado' },
    },
  }));
  try {
    const e = new Engine();
    assert.equal(e.autoReviewParked.has('acme/app#1'), false, 'o de orçamento saiu do estacionamento');
    assert.equal('acme/app#1' in e.parkedMotivos, false, 'e o motivo dele também');
    assert.equal(e.autoReviewParked.has('acme/app#2'), true, 'o cancelado continua parado');
    assert.equal(e.parkedMotivos['acme/app#2'].tipo, 'cancelado');
    assert.equal(e.autoReviewParked.has('acme/app#3'), true, 'o sem motivo (formato antigo) continua parado');
    assert.deepEqual(Object.keys(e.parkedParaUi()).sort(), ['acme/app#2', 'acme/app#3']);
  } finally { fs.rmSync(PARKED_FILE, { force: true }); }
});

test('a recuperação da prova do PR que estava estacionado por orçamento segue sem pausa depois do boot', async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PARKED_FILE, JSON.stringify({
    keys: [PR.key], motivos: { [PR.key]: { at: '2026-11-10T10:00:00.000Z', motivo: 'perfil "Perfil antigo"', tipo: 'orcamento' } },
  }));
  try {
    const e = motor();
    assert.equal(await pausaDaRecuperacao(e, { key: PR.key, pr: { ...PR } }), '');
  } finally { fs.rmSync(PARKED_FILE, { force: true }); }
});

test('o snapshot mede o consumo e não leva teto nem bloqueio', () => {
  const e = motor();
  const snap = e.snapshot();
  assert.equal('budgets' in snap.usage, false, 'usage.budgets saiu');
  assert.equal(snap.usage.auditoria.total.sessions, 2, 'a auditoria do registro fica');
  assert.equal(snap.usage.auditoria.desconhecido.sessions, 1);
  assert.equal(snap.usage.recentSessions.length, 2, 'as sessões recentes ficam');
  assert.deepEqual(Object.keys(snap.filaJusta).sort(), ['emCurso', 'porOrg', 'tetoGlobal'], 'a fila não traz cota por perfil');
  const texto = JSON.stringify(snap);
  for (const campo of [...TETOS, 'capHoje', 'capOrigem', 'tipicoReview', 'sugestaoDiaria', 'parcialmenteEstimado']) {
    assert.equal(texto.includes(`"${campo}"`), false, `${campo} não viaja no snapshot`);
  }
});
