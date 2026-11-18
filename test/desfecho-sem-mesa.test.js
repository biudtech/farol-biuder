// O desfecho sem mesa (17/11/2026). Regra do dono: o revisor nunca espera decisão de gente, e
// nenhum desfecho termina parado à espera de um clique (lib/engine/desfecho-sem-mesa.js).
//
// Cada caso abaixo ia para "Precisa de você" até a v3.0.0-dev de 17/11/2026:
//   - resultado sem confiança (origem sem marca, rodada que não fecha): revisa de novo com limite
//     e, esgotado, posta um COMMENT neutro, montado só pelo motor, pelos portões de sempre;
//   - pendência da mesa gravada antes: a varredura adota e segue o mesmo caminho;
//   - texto recusado (credencial): o COMMENT mínimo, sem o texto do modelo;
//   - PR fechado, PR próprio, instância isolada, gente no head: encerra sem postar;
//   - reenvio que falha: continua tentando com recuo longo, nunca vira pendência de gente;
//   - política em `wait`: some na carga, convertida no padrão autônomo.
// Os portões de postagem não afrouxam: o COMMENT neutro passa por todos eles.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-desfecho-sem-mesa-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { criteriaFixture } from './helpers/criteria-fixture.js';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';
const GH = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    const payload = JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(payload);
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) return { ok: true, code: 0, stdout: JSON.stringify(gh.reviewsAlheios), stderr: '' };
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: JSON.stringify(gh.meusReviews), stderr: '' };
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, author: { login: 'dev' } }) };
  }
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.state }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const semMesa = (await import('../lib/engine/desfecho-sem-mesa.js')).default;
const { publicReviewLanguageIssues } = await import('../lib/engine/public-review.js');
const contasConfig = (await import('../lib/engine/contas-config.js')).default;
const { normalizarConfig } = await import('../lib/settings.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { head: HEAD, state: 'OPEN', meusReviews: [], reviewsAlheios: [], postFalha: '' };
});

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'], autoReview: true };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.saveAutoReviewParked = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.linhas = [];
  e.log = (nivel, texto) => e.linhas.push(`${nivel} ${texto}`);
  e.eventos = [];
  for (const ev of ['needs-decision', 'auto-approved', 'auto-rejected', 'auto-commented']) {
    e.on(ev, (p) => e.eventos.push([ev, (p.item || p.result).key]));
  }
  e.on('toast', () => { });
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  return e;
}

function sessao(e, extra) {
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 0, reviewed: [], missing: [] },
      payloads: { approve: { event: 'APPROVE', body: 'Leitura completa, sem bloqueios.' } },
      reportMarkdown: '# ok', ...extra,
    }),
    sessionId: 's1',
  });
}

const PR = (n, marcas = { requested: true }) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', ...marcas });
const pendente = (e, n) => e.decisions.pending.find((x) => x.key === `acme/app#${n}`);
const resolvida = (e, n) => decisoesResolvidas(e).find((x) => x.key === `acme/app#${n}`);
const semMesaNenhuma = (e) => assert.equal(e.eventos.some(([t]) => t === 'needs-decision'), false, JSON.stringify(e.eventos));
const vencer = (d) => { d.semMesa.proximaEm = 0; if (d.semMesa.relancadaEm) d.semMesa.relancadaEm = 1; };
// o que é entregue ao desfecho anda na varredura seguinte, nunca na mesma: adota e vence o ciclo
async function varrerAdotadas(e) {
  semMesa.adotar(e);
  for (const d of e.decisions.pending) if (d.semMesa && !d.semMesa.relancadaEm) d.semMesa.proximaEm = 0;
  return semMesa.varrer(e);
}
// a rodada extra que o round automático rodaria: a mesma revisão, de novo, no mesmo head
async function rodadaExtra(e, n, marcas) { await e.runHeadlessReview(PR(n, marcas)); }

/* ---------- o COMMENT neutro ---------- */

test('o COMMENT neutro diz o que foi revisado e o que faltou, passa a trava de linguagem e não decide', () => {
  for (const motivo of ['analise_incompleta', 'inventario_no_limite', 'texto', 'bloqueio_de_estado', 'criterios_inconsistentes', 'rodada', '', 'outro']) {
    const p = semMesa.comentarioNeutro(motivo, HEAD, { changedFiles: 3 });
    assert.equal(p.event, 'COMMENT');
    assert.deepEqual(p.comments, []);
    assert.match(p.body, /Li as mudanças do commit `706cc81` \(3 arquivos alterados\), mas não consegui concluir a revisão com segurança: /);
    assert.match(p.body, /Por isso não aprovo nem peço mudanças neste commit\.$/);
    assert.deepEqual(publicReviewLanguageIssues(p, 'eu'), [], p.body);
    assert.doesNotMatch(p.body, /—/);
  }
  assert.match(semMesa.comentarioNeutro('texto', '', null).body, /^Li as mudanças, mas/);
});

test('armar: até RODADAS_EXTRAS rodadas no mesmo commit, com recuo; motivo definitivo ou sem commit vai direto ao COMMENT', () => {
  const e = motor();
  const pr = PR(1);
  const r = { headSha: HEAD, reasons: [] };
  const primeira = semMesa.armar(e, pr, r, 'origem_desconhecida');
  assert.equal(primeira.extra.semMesa.rodadas, 0);
  assert.ok(primeira.extra.semMesa.proximaEm >= Date.now() + semMesa.RECUOS_MS[0] - 1000);
  assert.ok(primeira.reasons[0].espera, 'a linha da espera é do app, e a varredura a troca');
  e.decisions.pending = [{ key: pr.key, headSha: HEAD, semMesa: { head: HEAD, rodadas: semMesa.RODADAS_EXTRAS - 1 } }];
  assert.equal(semMesa.armar(e, pr, r, 'origem_desconhecida').extra.semMesa.rodadas, semMesa.RODADAS_EXTRAS - 1);
  e.decisions.pending[0].semMesa.rodadas = semMesa.RODADAS_EXTRAS;
  assert.equal(semMesa.armar(e, pr, r, 'origem_desconhecida'), null, 'limite esgotado');
  assert.ok(semMesa.armar(e, pr, { headSha: HEAD_NOVO, reasons: [] }, 'origem_desconhecida'), 'commit novo zera a conta');
  assert.equal(semMesa.armar(motor(), pr, r, 'inventario_no_limite'), null, 'outra rodada não muda nada');
  assert.equal(semMesa.armar(motor(), pr, r, 'texto'), null);
  assert.equal(semMesa.armar(motor(), pr, { reasons: [] }, 'origem_desconhecida'), null, 'sem commit lido não há rodada a ancorar');
});

/* ---------- o ciclo inteiro, na revisão de verdade ---------- */

test('origem sem marca: revisa de novo com limite e, esgotado, posta o COMMENT neutro; nunca APPROVE', async () => {
  const e = motor();
  sessao(e);
  await rodadaExtra(e, 2, {});
  assert.deepEqual(envios, [], 'nada sai na primeira rodada');
  let d = pendente(e, 2);
  assert.equal(d.semMesa.rodadas, 0);
  assert.equal(await semMesa.varrer(e), 0, 'dentro do recuo, nada anda');
  for (let rodada = 1; rodada <= semMesa.RODADAS_EXTRAS; rodada++) {
    vencer(d);
    assert.equal(await semMesa.varrer(e), 1);
    assert.equal(d.blockedKind, 'stale_head', 'o round automático relança no mesmo head');
    assert.equal(d.blockedHead, HEAD);
    assert.equal(d.semMesa.rodadas, rodada);
    await rodadaExtra(e, 2, {});
    d = pendente(e, 2);
    if (rodada < semMesa.RODADAS_EXTRAS) assert.deepEqual(envios, [], `nada sai na rodada extra ${rodada}`);
  }
  // a última rodada extra concluiu sem confiança: o COMMENT neutro sai na hora, sem outra espera
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.match(envios[0].body, /não consegui concluir a revisão com segurança/);
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(pendente(e, 2), undefined, 'nada fica pendente');
  assert.equal(resolvida(e, 2).status, 'commented_inconclusive');
  assert.equal(resolvida(e, 2).action, 'comment');
  semMesaNenhuma(e);
});

test('a rodada extra pedida que não chega a rodar (round segurado) conta como esgotada depois do teto', async () => {
  const e = motor();
  sessao(e);
  await rodadaExtra(e, 3, {});
  const d = pendente(e, 3);
  vencer(d);
  assert.equal(await semMesa.varrer(e), 1);
  assert.ok(d.semMesa.relancadaEm);
  assert.equal(await semMesa.varrer(e), 0, 'dentro do teto da rodada, espera o round');
  d.semMesa.relancadaEm = Date.now() - semMesa.TETO_DA_RODADA_MS - 1;
  assert.equal(await semMesa.varrer(e), 1);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(resolvida(e, 3).status, 'commented_inconclusive');
});

test('commit novo antes da rodada extra: larga o desfecho sem mesa e deixa o PR na fila do head novo', async () => {
  const e = motor();
  sessao(e);
  await rodadaExtra(e, 4, {});
  const d = pendente(e, 4);
  vencer(d);
  gh.head = HEAD_NOVO;
  assert.equal(await semMesa.varrer(e), 1);
  assert.equal(d.semMesa, null);
  assert.equal(d.blockedKind, 'stale_head');
  assert.equal(d.blockedHead, HEAD_NOVO);
  assert.deepEqual(envios, []);
});

/* ---------- o que já estava no disco ---------- */

function mesaAntiga(n, extra = {}) {
  return { id: `d${n}`, key: `acme/app#${n}`, pr: { ...PR(n), origemDono: true }, headSha: HEAD, status: 'pending', verdict: 'approve', reasons: [{ text: 'a política da conta manda aguardar', kind: 'gate' }], payloads: {}, createdAt: Date.now(), ...extra };
}

test('a pendência da mesa gravada antes é adotada na varredura e não fica parada para sempre', async () => {
  const e = motor();
  e.decisions.pending.push(mesaAntiga(10));
  assert.equal(semMesa.adotar(e), 1);
  const d = pendente(e, 10);
  assert.equal(d.semMesa.adotada, true);
  assert.equal(d.semMesa.rodadas, 0, 'com commit lido, revisa de novo antes do COMMENT');
  assert.ok(e.linhas.some((l) => /adotada pelo desfecho sem mesa/.test(l)));
  assert.equal(semMesa.adotar(e), 0, 'uma vez só');
  // sem commit lido não há rodada a ancorar: vai direto ao COMMENT neutro
  e.decisions.pending.push(mesaAntiga(11, { headSha: '' }));
  await varrerAdotadas(e);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(resolvida(e, 11).status, 'commented_inconclusive');
});

test('pendência com caminho automático não é adotada', () => {
  const e = motor();
  const casos = [{ esperaProva: {} }, { esperaCi: {} }, { postRetry: { event: 'approve' } }, { semMesa: { head: HEAD } },
    { blockedKind: 'stale_head' }, { blockedKind: 'conflito' }, { blockedKind: 'technical_recheck' }];
  e.decisions.pending = casos.map((c, i) => mesaAntiga(20 + i, c));
  assert.equal(semMesa.adotar(e), 0);
});

test('revisão automática desligada para o PR: encerra sem postar', async () => {
  const e = motor();
  e.config.conta.autoReview = false;
  e.decisions.pending.push(mesaAntiga(30, { headSha: '' }));
  await varrerAdotadas(e);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 30).status, 'not_posted');
  assert.match(resolvida(e, 30).reasons[0].text, /revisão automática está desligada/);
});

test('gente já decidiu o commit: o PR sai do automático e encerra sem postar', async () => {
  const e = motor();
  e.bloqueadoPorHistorico = async () => ({ bloqueado: true, decidido: true, head: HEAD, quem: ['ana'] });
  e.decisions.pending.push(mesaAntiga(31, { headSha: '' }));
  await varrerAdotadas(e);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 31).status, 'not_posted');
  assert.match(resolvida(e, 31).reasons[0].text, /@ana/);
});

test('PR da própria conta: encerra sem postar', async () => {
  const e = motor();
  e.decisions.pending.push(mesaAntiga(32, { prProprio: true }));
  await varrerAdotadas(e);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 32).status, 'not_posted');
});

/* ---------- o COMMENT passa pelos portões ---------- */

test('o portão que recusa o COMMENT neutro encerra sem postar, com o motivo no card', async () => {
  const e = motor();
  e.postReview = async () => ({ ok: false, blocked: 'criterios_inconsistentes', attempted: false, error: 'A revisão tem critérios ou evidências inconsistentes.' });
  e.decisions.pending.push(mesaAntiga(40, { headSha: '' }));
  await varrerAdotadas(e);
  assert.equal(pendente(e, 40), undefined);
  assert.equal(resolvida(e, 40).status, 'not_posted');
  assert.match(resolvida(e, 40).reasons[0].text, /nada foi publicado: A revisão tem critérios/);
});

test('falha passageira do COMMENT vai ao reenvio de sempre, que publica com o status do desfecho sem mesa', async () => {
  const e = motor();
  e.decisions.pending.push(mesaAntiga(41));
  pendente(e, 41).semMesa = { head: HEAD, motivo: '', rodadas: semMesa.RODADAS_EXTRAS, proximaEm: 0 };
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await semMesa.varrer(e);
  const d = pendente(e, 41);
  assert.equal(d.postRetry.event, 'comment');
  assert.equal(d.postRetry.statusAoPublicar, 'commented_inconclusive');
  assert.equal(d.semMesa, null);
  gh.postFalha = '';
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.equal(resolvida(e, 41).status, 'commented_inconclusive');
});

test('o reenvio nunca desiste para uma pessoa: depois das tentativas rápidas, recuo longo', async () => {
  const e = motor();
  e.decisions.pending.push(mesaAntiga(42, { postRetry: { event: 'approve', attempts: 0 }, payloads: { approve: { event: 'APPROVE', body: 'ok' } } }));
  e.postReview = async () => ({ ok: false, attempted: true, error: 'HTTP 502: Bad Gateway' });
  for (let i = 0; i < 3; i++) await e.retryFailedPosts();
  const d = pendente(e, 42);
  assert.equal(d.postRetry.attempts, 3);
  assert.equal(d.postRetry.exhausted, false);
  assert.ok(d.postRetry.proximaEm > Date.now(), 'espera mais, sem desistir');
  assert.equal(await e.retryFailedPosts(), 0, 'dentro do recuo não tenta');
  d.postRetry.proximaEm = 0;
  e.postReview = async () => ({ ok: true });
  assert.equal(await e.retryFailedPosts(), 1);
  assert.equal(resolvida(e, 42).status, 'auto_approved');
});

test('o reenvio sem o texto gravado vai ao desfecho sem mesa, e o head que andou vira commit novo', async () => {
  const e = motor();
  e.decisions.pending.push(mesaAntiga(43, { postRetry: { event: 'approve', attempts: 0 } }));
  await e.retryFailedPosts();
  assert.equal(pendente(e, 43).postRetry, null);
  assert.equal(pendente(e, 43).semMesa.motivo, 'nao_aprovavel');
  e.decisions.pending.push(mesaAntiga(44, { postRetry: { event: 'approve', attempts: 0 }, payloads: { approve: { event: 'APPROVE', body: 'ok' } } }));
  gh.head = HEAD_NOVO;
  await e.retryFailedPosts();
  assert.equal(pendente(e, 44).blockedKind, 'stale_head');
  assert.equal(pendente(e, 44).blockedHead, HEAD_NOVO);
});

/* ---------- recusas na revisão ---------- */

test('texto com credencial: o card registra agora, e na varredura sai o COMMENT mínimo sem o texto do modelo', async () => {
  const e = motor();
  sessao(e, { payloads: { approve: { event: 'APPROVE', body: `Leitura completa. Chave em uso: ${GH}.` } } });
  await rodadaExtra(e, 50);
  assert.deepEqual(envios, [], 'a trava de credencial recusou');
  const d = pendente(e, 50);
  assert.equal(d.semMesa.motivo, 'texto');
  assert.ok(d.reasons.some((r) => /parece uma credencial/.test(r.text || r)));
  assert.equal(await semMesa.varrer(e), 0, 'o COMMENT sai na varredura seguinte, não na mesma');
  vencer(d);
  await semMesa.varrer(e);
  assert.deepEqual(envios.map((p) => p.event), ['COMMENT']);
  assert.match(envios[0].body, /o parecer não pôde ser publicado como foi escrito/);
  assert.doesNotMatch(envios[0].body, /Leitura completa|ghp_/, 'nada do texto do modelo');
  assert.equal(resolvida(e, 50).status, 'commented_inconclusive');
  semMesaNenhuma(e);
});

test('instância isolada e PR fechado: o portão recusa, e o desfecho encerra sem postar e sem pendência', async () => {
  for (const [n, recusa, status] of [
    [51, { ok: false, blocked: 'instancia_isolada', attempted: false, error: 'instância isolada (FAROL_HOME fora de ~/.farol) não posta review no GitHub' }, 'not_posted'],
    [52, { ok: false, blocked: 'pr_fechado', attempted: false, estado: 'MERGED', error: 'PR já mesclado, então o review não foi postado' }, 'already_merged'],
  ]) {
    const e = motor();
    sessao(e);
    e.postReview = async () => recusa;
    await rodadaExtra(e, n);
    assert.equal(pendente(e, n), undefined);
    assert.equal(resolvida(e, n).status, status);
    assert.equal(resolvida(e, n).action, 'skip');
  }
});

test('conta sem token: o reenvio assume, sem pendência de gente', async () => {
  const e = motor();
  sessao(e);
  e.postReview = async () => ({ ok: false, error: 'conta eu sem token no gh, review não postado', semToken: true });
  await rodadaExtra(e, 53);
  assert.deepEqual(pendente(e, 53).postRetry, { event: 'approve', attempts: 0, atencaoAoPublicar: [] });
});

/* ---------- a política sem `wait` ---------- */

test('o `wait` antigo vira o padrão autônomo na leitura, com uma linha de log, uma vez', () => {
  const { conta, convertidos } = contasConfig.normalizarPolitica({ user: 'eu', onClean: 'wait', onCaveats: 'wait', onReject: 'wait', autoReview: false });
  assert.deepEqual(convertidos, ['onClean', 'onCaveats', 'onReject']);
  assert.deepEqual([conta.onClean, conta.onCaveats, conta.onReject, conta.autoReview], ['approve', 'approve', 'request_changes', false]);
  assert.deepEqual(contasConfig.politicaExplicita({ onClean: 'wait', onCaveats: 'wait', onReject: 'wait', autoReview: false }),
    { autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  const lida = normalizarConfig({ conta: { user: 'eu', owners: ['acme'], onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } });
  assert.equal('onClean' in lida.conta, false, 'o wait não atravessa a leitura');
  const e = motor();
  e.configCrua = { conta: { user: 'eu', owners: ['acme'], onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } };
  contasConfig.aoCarregar(e);
  assert.equal(e.linhas.filter((l) => /o desfecho em espera \(wait\) saiu/.test(l)).length, 1);
  contasConfig.aoCarregar(e);
  assert.equal(e.linhas.filter((l) => /o desfecho em espera \(wait\) saiu/.test(l)).length, 1, 'uma vez: a config crua é consumida');
});

test('a edição que pede `wait` volta em ignorados, e autoReview continua o liga e desliga', () => {
  const r = contasConfig.aplicarEdicao({ user: 'eu', owners: ['acme'] }, { tipo: 'editar', user: 'eu', campos: { onClean: 'wait', onCaveats: 'wait', onReject: 'wait', autoReview: false } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ignorados.sort(), ['onCaveats', 'onClean', 'onReject']);
  assert.equal(r.conta.autoReview, false);
});
