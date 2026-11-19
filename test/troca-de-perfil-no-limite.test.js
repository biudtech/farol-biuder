// Troca de perfil do Claude no limite do plano (pedido do dono de 18/11/2026: "faz o motor
// trocar de perfil sozinho no limite").
//
// Até aqui o motor usava o perfil padrão (ou o primeiro utilizável) e, quando o plano batia no
// limite, a fila ESPERAVA o reset desse perfil mesmo havendo outro perfil pronto e livre. No
// servidor há dois perfis de assinatura, e o revisor tem de ser autônomo e nunca travar.
//
// A regra nova (resolveClaudeAuth): o padrão primeiro, depois os demais na ordem da lista; usa o
// primeiro que não está no limite; com todos no limite, o de reset mais cedo (a fila espera só
// até ele). Só o registro de limite do plano faz trocar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-troca-perfil-'));
process.env.FAROL_HOME = FAROL_HOME;
delete process.env.FAROL_HEADLESS_CMD;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { criteriaFixture } from './helpers/criteria-fixture.js';
const { Engine } = await import('../server.js');
const { LIMITE_PLANO_FILE, CLAUDE_PERFIS_DIR } = await import('../lib/paths.js');
const { aposLimite, limiteAte, registrarLimite, comPerfilDaSessao } = await import('../lib/engine/limite-plano.js');
const perfilMod = (await import('../lib/engine/perfil-claude.js')).default;
const { pedirEnvelope } = await import('../lib/engine/reparo-envelope.js');
const fanout = (await import('../lib/engine/fanout.js')).default;

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  delete process.env.FAROL_HEADLESS_CMD;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => {
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(path.join(FAROL_HOME, 'workspace', 'state', 'auto-review-parked.json'), { force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(path.join(FAROL_HOME, 'workspace', 'state', 'inflight.json'), { force: true }); } catch { /* best-effort */ }
});

const HORA = 3600e3;
const MSG_LIMITE = "claude saiu com código 1: You've hit your limit · resets 5:50pm";
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

const A = { id: 'biud', label: 'BIUD', kind: 'apikey', apiKey: 'sk-fixture-a', baseUrl: '' };
const B = { id: 'biud-2', label: 'BIUD 2', kind: 'apikey', apiKey: 'sk-fixture-b', baseUrl: '' };
const chave = (p) => `${p.kind}:${p.id}`;

function engineCom(perfis = [A, B], padrao = 'biud') {
  // o registro mora em disco: sem limpar, a Engine nova herdaria o limite da anterior
  try { fs.rmSync(LIMITE_PLANO_FILE, { force: true }); } catch { /* best-effort */ }
  const e = new Engine();
  e.logs = [];
  e.log = (nivel, texto) => { e.logs.push([nivel, texto]); };
  e.pushState = () => { };
  e.doctor = async () => ({});
  e.saveConfig = () => { };
  e.accountForPr = () => 'eu';
  e.token = 't1';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  e.prState = async () => 'OPEN';
  e.config.conta = { user: 'eu', owners: ['o'] };
  e.config.claudeProfiles = perfis;
  e.config.claudeProfileId = padrao;
  return e;
}

function travar(e, perfil, ate, agora = Date.now()) {
  registrarLimite(e, 'eu', ate, agora, { auth: { kind: perfil.kind, id: perfil.id } });
}

/* ---------- 1 a 3: a escolha do perfil ---------- */

test('dois perfis prontos, padrão no limite: a conta resolve para o outro, e a conta não está no limite', () => {
  const e = engineCom();
  travar(e, A, Date.now() + HORA);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud-2');
  assert.equal(limiteAte(e, 'eu'), 0, 'há perfil livre: a fila não espera');
  assert.equal(e.limiteDoPlanoAte('eu'), 0);
});

test('os dois no limite: usa o de reset mais cedo, e a conta espera só até ele', () => {
  const e = engineCom();
  const agora = Date.now();
  travar(e, A, agora + 3 * HORA, agora);
  travar(e, B, agora + HORA, agora);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud-2');
  assert.equal(limiteAte(e, 'eu'), agora + HORA);
  // e o inverso: o padrão volta primeiro
  const f = engineCom();
  travar(f, A, agora + HORA, agora);
  travar(f, B, agora + 3 * HORA, agora);
  assert.equal(f.resolveClaudeAuth('eu').id, 'biud');
  assert.equal(limiteAte(f, 'eu'), agora + HORA);
});

test('padrão com limite vencido: volta ao padrão sozinho', () => {
  const e = engineCom();
  e.limitesDePlano.set(chave(A), { ate: Date.now() - 1000, em: Date.now() - HORA, estimado: false });
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud');
  assert.equal(e.limitesDePlano.has(chave(A)), false, 'o vencido sai na leitura');
  // e a escolha é refeita a cada chamada: travar e soltar o padrão muda a resposta na hora
  travar(e, A, Date.now() + HORA);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud-2');
  e.limitesDePlano.delete(chave(A));
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud');
});

test('sem padrão, a ordem é a da lista; sem perfil utilizável, null como antes', () => {
  const e = engineCom([A, B], '');
  travar(e, A, Date.now() + HORA);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud-2');
  const f = engineCom([B, A], 'biud');
  assert.equal(f.resolveClaudeAuth('eu').id, 'biud', 'o padrão vem antes da ordem da lista');
  const g = engineCom([], '');
  assert.equal(g.resolveClaudeAuth('eu'), null);
  assert.equal(limiteAte(g, 'eu'), 0);
});

test('perfil de assinatura sem login não entra como alternativa: a fila espera o reset do padrão', () => {
  const semLogin = { id: 'biud-sem-login', label: 'Sem login', kind: 'dir' };
  const e = engineCom([A, semLogin], 'biud');
  const ate = Date.now() + HORA;
  travar(e, A, ate);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud', 'trocar para um perfil sem login estacionaria o PR por credencial');
  assert.equal(limiteAte(e, 'eu'), ate);
  // com o login feito, ele passa a ser alternativa
  const dir = path.join(CLAUDE_PERFIS_DIR, semLogin.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'), '{}');
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud-sem-login');
  assert.equal(limiteAte(e, 'eu'), 0);
});

test('o diagnóstico e a tela não dizem "sem perfil" quando o padrão está só no limite', () => {
  const e = engineCom([A], 'biud');
  travar(e, A, Date.now() + HORA);
  assert.equal(e.resolveClaudeAuth('eu').id, 'biud', 'perfil único no limite segue sendo o perfil da conta');
  assert.deepEqual(perfilMod.problemasDePerfil(e.config), []);
  assert.deepEqual(perfilMod.prontidaoDoPerfil(e.config), { pronto: true, tipo: 'chave', falta: '' });
  assert.equal(perfilMod.authDaConta(e.config).id, 'biud', 'authDaConta segue puro: o padrão, sem olhar limite');
  const f = engineCom();
  travar(f, A, Date.now() + HORA);
  assert.deepEqual(perfilMod.problemasDePerfil(f.config), []);
  assert.equal(perfilMod.prontidaoDoPerfil(f.config).pronto, true);
});

test('a troca por limite deixa uma linha WARN por mudança, não uma por chamada', () => {
  const e = engineCom();
  travar(e, A, Date.now() + HORA);
  for (let i = 0; i < 5; i++) e.resolveClaudeAuth('eu');
  const warns = e.logs.filter(([n, t]) => n === 'WARN' && /no limite/.test(t));
  assert.equal(warns.length, 1, JSON.stringify(e.logs));
  assert.match(warns[0][1], /perfil "BIUD" no limite até \d\d:\d\d; usando o perfil "BIUD 2"/);
  // de volta ao padrão e de novo no limite: é outra mudança, outra linha
  e.limitesDePlano.delete(chave(A));
  e.resolveClaudeAuth('eu');
  travar(e, A, Date.now() + HORA);
  e.resolveClaudeAuth('eu');
  assert.equal(e.logs.filter(([n, t]) => n === 'WARN' && /no limite/.test(t)).length, 2);
});

/* ---------- 4: aposLimite ---------- */

test('aposLimite com outro perfil livre: o PR relança no próximo ciclo e o aviso cita o perfil novo', () => {
  const e = engineCom();
  const agora = Date.now();
  const r = aposLimite(e, prDe('o/r#1'), { perfilDaSessao: { kind: 'apikey', id: 'biud' } }, MSG_LIMITE, agora);
  assert.equal(r.notBefore, null);
  assert.equal(r.trocou, true);
  assert.match(r.aviso, /perfil "BIUD"/);
  assert.match(r.aviso, /perfil "BIUD 2"/);
  assert.ok(e.limitesDePlano.has(chave(A)), 'o limite fica registrado no perfil que estourou');
});

test('aposLimite com todos no limite: espera o reset mais cedo', () => {
  const e = engineCom();
  const agora = Date.now();
  travar(e, B, agora + 20 * 60e3, agora);
  const r = aposLimite(e, prDe('o/r#2'), { perfilDaSessao: { kind: 'apikey', id: 'biud' } }, "You've hit your limit", agora);
  assert.equal(r.trocou, false);
  assert.equal(r.notBefore, agora + 20 * 60e3, 'o B volta antes da hora estimada do A');
  const f = engineCom();
  travar(f, B, agora + 5 * HORA, agora);
  const s = aposLimite(f, prDe('o/r#3'), { perfilDaSessao: { kind: 'apikey', id: 'biud' } }, "You've hit your limit", agora);
  assert.equal(s.notBefore, agora + HORA, 'o A, com a hora estimada de uma hora, volta antes do B');
});

/* ---------- 6: perfil único, o comportamento de antes ---------- */

test('perfil único no limite: espera o reset, sem estacionar', async () => {
  const e = engineCom([A], 'biud');
  e.runHeadlessReview = async () => { throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: { kind: 'apikey', id: 'biud' } }); };
  await e.runOneHeadless(prDe('o/r#6'), 'eu');
  const guardado = e.retryAfterNet.get('o/r#6');
  assert.ok(guardado.notBefore > Date.now());
  assert.equal(guardado.notBefore, e.limiteDoPlanoAte('eu'));
  assert.equal(guardado.tries, 1);
  assert.equal(e.autoReviewParked.has('o/r#6'), false);
});

/* ---------- o teto de tentativas não conta a troca ---------- */

test('trocar de perfil não gasta tentativa nem estaciona, mesmo com o teto já alcançado', async () => {
  const e = engineCom();
  const toasts = [];
  e.on('toast', (t) => toasts.push(t.text));
  const pr = prDe('o/r#7');
  e.retryAfterNet.set(pr.key, { tries: 12, pr, notBefore: null });
  e.runHeadlessReview = async () => { throw Object.assign(new Error(MSG_LIMITE), { perfilDaSessao: { kind: 'apikey', id: 'biud' } }); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.autoReviewParked.has(pr.key), false, 'a troca de perfil não é falha deste PR');
  const guardado = e.retryAfterNet.get(pr.key);
  assert.equal(guardado.tries, 12);
  assert.equal(guardado.notBefore, null);
  assert.match(toasts.at(-1), /BIUD 2/);
});

/* ---------- a continuação que mudou de perfil vira sessão nova ---------- */

test('continuação que mudou de perfil ou modelo: relança como sessão nova, sem estacionar e sem gastar tentativa', async () => {
  const e = engineCom();
  const pr = { ...prDe('o/r#8'), retomarSid: 'sessao-a-0001' };
  e.retomadas.set(pr.key, { key: pr.key, retomarSid: 'sessao-a-0001', provedor: 'apikey', perfilId: 'biud', knownHead: 'h1' });
  e.runHeadlessReview = async () => {
    throw Object.assign(new Error('o perfil ou modelo mudou; a conversa anterior não pode ser retomada neste perfil'), { continuationChanged: true, sessionId: 'sessao-a-0001' });
  };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  const guardado = e.retryAfterNet.get(pr.key);
  assert.ok(guardado, 'volta no próximo ciclo');
  assert.equal(guardado.tries, 0);
  assert.equal(guardado.notBefore, null);
  assert.equal(guardado.pr.retomarSid, undefined, 'a conversa do outro perfil não é retomada');
  assert.equal(e.retomadas.has(pr.key), false);
});

test('o reparo do envelope não engole a mudança de perfil: ela sobe para virar sessão nova', async () => {
  const engine = {
    pushActivity() { },
    runClaudeStream: async () => { throw Object.assign(new Error('o perfil ou modelo mudou'), { continuationChanged: true }); },
  };
  const err = Object.assign(new Error('sem envelope'), { code: 'FAROL_RESULT_MISSING' });
  await assert.rejects(pedirEnvelope(engine, err, { sessionId: 'sessao-a-0001', sessionBinding: {} }, 'x', {}), (e2) => e2.continuationChanged === true);
});

test('o sucesso no perfil B não libera o A', async () => {
  const e = engineCom();
  travar(e, A, Date.now() + HORA);
  await comPerfilDaSessao(e, Promise.resolve({ text: 'ok' }), e.resolveClaudeAuth('eu'));
  assert.equal(e.limitesDePlano.has(chave(A)), true);
});

/* ---------- 5: o fluxo inteiro, com o claude trocado por um stub ---------- */

const HEAD = 'c0ffee1234ab';
const ENVELOPE = {
  ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', cardMet: true,
  reasons: [], reportMarkdown: 'relatório', payloads: {},
};

function mesAbreviado(d) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]; }

test('revisão cai por limite no perfil A, relança no B como sessão nova, conclui, não estaciona, e o A segue no limite', async () => {
  const dirA = path.join(CLAUDE_PERFIS_DIR, 'fluxo-a');
  const dirB = path.join(CLAUDE_PERFIS_DIR, 'fluxo-b');
  for (const d of [dirA, dirB]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.credentials.json'), '{}'); }
  const registro = path.join(FAROL_HOME, 'chamadas.jsonl');
  const stub = path.join(FAROL_HOME, 'stub-claude.mjs');
  const reset = new Date(Date.now() + 3 * 24 * HORA);
  const frase = `You've hit your weekly limit · resets ${mesAbreviado(reset)} ${reset.getDate()} at 5am`;
  fs.writeFileSync(stub, `
import fs from 'node:fs';
const dir = process.env.CLAUDE_CONFIG_DIR || '';
fs.appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ dir, args: process.argv.slice(2) }) + '\\n');
if (dir === ${JSON.stringify(dirA)}) {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sessao-a-0001' }));
  console.log(JSON.stringify({ type: 'result', is_error: true, result: ${JSON.stringify(frase)}, session_id: 'sessao-a-0001', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }));
} else {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sessao-b-0001' }));
  console.log(JSON.stringify({ type: 'result', is_error: false, result: ${JSON.stringify(JSON.stringify(ENVELOPE))}, session_id: 'sessao-b-0001', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }));
}
`);
  process.env.FAROL_HEADLESS_CMD = `node ${stub}`;
  try {
    const e = engineCom([{ id: 'fluxo-a', label: 'Fluxo A', kind: 'dir' }, { id: 'fluxo-b', label: 'Fluxo B', kind: 'dir' }], 'fluxo-a');
    e.accountForPr = () => 'trabalho';
    e.config.conta = { user: 'trabalho', owners: [], onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
    e.scopeLabel = () => 'Conta Trabalho';
    e.writeMemory = () => { };
    e.headSha = async () => HEAD;
    e.myReviewsWithTime = async () => [];
    e.postReview = async () => ({ ok: true });
    e.decididos = [];
    const decidirOriginal = e.recordDecision.bind(e);
    e.recordDecision = (pr, result, extra) => { e.decididos.push(result); return decidirOriginal(pr, result, extra); };
    const PR = { key: 'o/r#21', repo: 'o/r', number: 21, url: 'https://github.com/o/r/pull/21', requested: true, title: 'fix: algo', author: 'alguem' };

    await e.runOneHeadless({ ...PR }, 'trabalho');
    assert.equal(e.decididos.length, 0, 'a primeira sessão caiu no limite');
    assert.ok(e.limitesDePlano.has('dir:fluxo-a'), 'o limite ficou no perfil A');
    const guardado = e.retryAfterNet.get(PR.key);
    assert.ok(guardado, 'o PR volta sozinho');
    assert.equal(guardado.notBefore, null, 'com o B livre, não espera o reset do A');
    assert.equal(guardado.tries, 0, 'trocar de perfil não gasta tentativa');
    assert.equal(e.autoReviewParked.has(PR.key), false);
    assert.equal(e.retomadas.get(PR.key)?.perfilId, 'fluxo-a', 'a retomada guardada é a do perfil A');

    await e.runOneHeadless(guardado.pr, 'trabalho');
    const chamadas = fs.readFileSync(registro, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(chamadas.length, 2, JSON.stringify(chamadas));
    assert.equal(chamadas[0].dir, dirA);
    assert.equal(chamadas[1].dir, dirB, 'a segunda sessão roda no perfil B');
    assert.equal(chamadas[1].args.includes('--resume'), false, 'sessão nova: a conversa do A não é retomada no B');
    assert.equal(e.decididos.length, 1, 'a revisão concluiu no B');
    assert.equal(e.autoReviewParked.has(PR.key), false, 'não estacionou');
    assert.equal(e.retryAfterNet.has(PR.key), false);
    assert.equal(e.retomadas.has(PR.key), false);
    assert.ok(e.limitesDePlano.has('dir:fluxo-a'), 'o sucesso no B não libera o A');
    assert.equal(e.limitesDePlano.has('dir:fluxo-b'), false);
  } finally {
    delete process.env.FAROL_HEADLESS_CMD;
  }
});
