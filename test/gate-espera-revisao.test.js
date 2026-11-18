import { criteriaFixture } from './helpers/criteria-fixture.js';
// A aprovação automática com CI obrigatório vermelho ou em andamento, na revisão de verdade.
//
// De 30/09 a 17/11/2026 este arquivo provava a ESPERA AUTOMÁTICA do CI: o resultado aprovável
// ficava guardado esperando o CI e saía sozinho quando ele fechava verde no mesmo head. Regra do
// dono de 17/11/2026: o revisor nunca espera o CI, nem para começar nem para aprovar. Agora a prova
// é a de que o CI não segura nada (a aprovação sai na hora, com o estado da pipe como nota no app)
// e a de que a espera gravada antes termina sozinha (lib/engine/espera-ci.js): a aprovação sai pelo
// caminho de sempre, nunca em head que a sessão não leu, e o gate de consciência vale na hora do post.
// Dependência em aberto é ressalva, e a política da conta decide.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-gate-espera-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const HEAD_NOVO = 'b8722a3f09f3cef5043ec47e5eebbc5e8c44eb9c';
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-09-30T12:00:00Z' });

// o gh é a fronteira de rede. `gh` guarda o que o GitHub responderia AGORA; os testes mudam
// isso entre um ciclo e outro, que é como a pipe anda.
const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const runReal = io.run;
let envios = [];
let leiturasDoCi = 0;
let chamadas = 0;
let leiturasDeReviewsAlheios = 0;
let gh;
io.run = async (_cmd, args) => {
  chamadas++;
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    if (gh.postFalha) return { ok: false, code: 1, stdout: '', stderr: gh.postFalha };
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  // reviews dos OUTROS (gate de consciência): o jq filtra por login diferente do meu
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('!= "eu"')) {
    leiturasDeReviewsAlheios++;
    return { ok: true, code: 0, stdout: JSON.stringify(gh.reviewsAlheios), stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: JSON.stringify(gh.meusReviews), stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    leiturasDoCi++;
    if (gh.leituraFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
    return {
      ok: true, code: 0, stderr: '',
      stdout: JSON.stringify({ state: gh.state, headRefOid: gh.head, baseRefName: 'main', statusCheckRollup: gh.rollup, reviewRequests: gh.pedidos }),
    };
  }
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(gh.exigidos), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: gh.head, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: gh.state }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { technicalRuntime } = await import('../lib/technical-review/runtime.js');
const { cleanup, criarMaterial } = await import('../lib/technical-review/cleanup.js');
const { STATE_DIR } = await import('../lib/paths.js');
const { avisoDoCi } = await import('../lib/engine/gate-espera.js');


after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = []; leiturasDoCi = 0; chamadas = 0; leiturasDeReviewsAlheios = 0;
  gh = {
    state: 'OPEN', head: HEAD, exigidos: ['test', 'audit'], meusReviews: [], reviewsAlheios: [], postFalha: '', leituraFalha: false,
    rollup: [check('test', '', 'IN_PROGRESS'), check('audit', 'SUCCESS')],
    pedidos: [{ __typename: 'User', login: 'eu' }],
  };
});

// `politica` = [limpo, com ressalvas]
function motor(checks, politica = ['approve', 'approve']) {
  const e = new Engine();
  e.token = 'token-falso';
  // A política é a da conta, gravada por extenso e lida pelos métodos reais do motor
  // (contas-config.js). Até 17/11/2026 a conta daqui não reprovava sozinha (onReject: wait); o
  // `wait` saiu, e o pedido de mudanças só pelo CI também não sai (o CI não decide)
  e.config.conta = { user: 'eu', owners: ['acme'], onClean: politica[0], onCaveats: politica[1], onReject: 'request_changes' };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.log = () => { };
  e.toasts = [];
  e.eventos = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', (p) => e.eventos.push(['needs-decision', p.item.key]));
  e.on('auto-approved', (p) => e.eventos.push(['auto-approved', p.result.key, (p.points || []).length]));
  e.bloqueadoPorChecks = async () => ({ faltando: checks });
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

const PR = (n) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', requested: true });
const pendente = (e, n) => e.decisions.pending.find((x) => x.key === `acme/app#${n}`);
const resolvida = (e, n) => decisoesResolvidas(e).find((x) => x.key === `acme/app#${n}`);
const textos = (d) => (d.reasons || []).map((r) => r.text || r);

// A espera do CI gravada antes de 17/11/2026: é o ponto de partida de quase tudo. Nenhuma revisão
// arma essa marca hoje, então a pendência nasce de uma revisão real cuja postagem falhou por
// instabilidade, e a marca é posta como o decisions.json de uma instalação antiga a traria.
async function emEspera(n, { politica, extra, checks = [{ nome: 'test', estado: 'rodando' }] } = {}) {
  const e = motor(checks, politica);
  sessao(e, extra);
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await e.runHeadlessReview(PR(n));
  gh.postFalha = '';
  envios = [];
  const d = pendente(e, n);
  assert.ok(d, 'a revisão deixou a pendência que vira a espera antiga');
  // os pontos da espera são as ressalvas que a revisão leu: sem a falha da postagem e sem a nota do
  // CI que o desfecho acrescentou às reasons da pendência (a nota volta na liberação, pelo estado lido)
  const doCi = new Set(avisoDoCi({ checksObrigatorios: checks }).map((r) => r.text));
  const pontos = (d.reasons || []).filter((r) => r && r.kind !== 'infra' && !doCi.has(r.text));
  Object.assign(d, { postRetry: null, reasons: [], esperaCi: { desde: Date.now(), checks, pontos } });
  e.eventos.length = 0;
  e.toasts.length = 0;
  // o que a revisão em si consultou fica fora da conta de "uma leitura por ciclo"
  e.chamadasAntes = chamadas;
  leiturasDoCi = 0;
  return e;
}


test('espera gravada antes: a aprovação sai no ciclo seguinte, ancorada no head lido, sem clique', async () => {
  const e = await emEspera(2);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1, 'um APPROVE, e só um');
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].commit_id, HEAD);
  assert.equal(envios[0].body, 'Leitura completa, sem bloqueios.');
  assert.equal(pendente(e, 2), undefined, 'saiu da lista de pendências');
  const r = resolvida(e, 2);
  assert.equal(r.status, 'auto_approved');
  assert.equal(r.esperaCi, null);
  assert.deepEqual(r.attention, [], 'limpo: sem ressalva');
  assert.deepEqual(textos(r), [], 'o motivo da espera sai do registro');
  assert.deepEqual(e.eventos, [['auto-approved', 'acme/app#2', 0]]);
  assert.ok(e.toasts.some((t) => /a espera do CI saiu, então a aprovação que esperava saiu sozinha/.test(t)), e.toasts.join(' | '));
  assert.equal(await e.varrerEsperas(), 0, 'ciclo seguinte não tem o que fazer');
  assert.equal(envios.length, 1, 'nunca posta duas vezes');
});

test('espera gravada antes com o CI VERMELHO: a aprovação sai do mesmo jeito, com o CI como nota', async () => {
  const e = await emEspera(3, { checks: [{ nome: 'audit', estado: 'vermelho' }] });
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.match(resolvida(e, 3).attention.map((p) => p.text).join(' | '), /vermelho no head \(audit\)/);
  assert.equal(await e.varrerEsperas(), 0, 'sem laço');
  assert.equal(envios.length, 1);
});

test('head andou durante a espera: NÃO posta, larga a espera e devolve o PR ao round automático', async () => {
  const e = await emEspera(5);
  gh.head = HEAD_NOVO;
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, [], 'CI verde no head NOVO não aprova o texto do head antigo');
  const d = pendente(e, 5);
  assert.equal(d.esperaCi, null);
  assert.equal(d.blockedKind, 'stale_head', 'é o carimbo que o round automático (reReviewTargets) destrava');
  assert.equal(d.blockedHead, HEAD_NOVO);
  assert.match(textos(d)[0], /commit novo enquanto a aprovação esperava o CI \(706cc81 -> b8722a3\)/);
  assert.equal(await e.varrerEsperas(), 0, 'e a espera não volta');
  assert.equal(leiturasDoCi, 1, 'pendência sem espera não custa leitura');
});

test('leitura do PR que falha NÃO libera: sem prova do head, espera o próximo ciclo', async () => {
  const e = await emEspera(6);
  gh.leituraFalha = true;
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, []);
  assert.ok(pendente(e, 6).esperaCi, 'continua esperando, sem ir para a mesa');
  gh.leituraFalha = false;
  gh.rollup = null;
  assert.equal(await e.varrerEsperas(), 1, 'o CI ilegível não segura: só o head precisava ser conferido');
});

test('com ressalvas e conta que aprova com ressalvas: a espera gravada antes aprova, com a ressalva visível', async () => {
  const e = await emEspera(7, { extra: { decision: 'needs_decision', reasons: ['vale olhar a validação do upload'] } });
  const d = pendente(e, 7);
  assert.equal(d.esperaCi.pontos.length, 1);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1);
  const r = resolvida(e, 7);
  assert.deepEqual(r.attention.map((p) => p.text), ['vale olhar a validação do upload']);
  assert.deepEqual(e.eventos, [['auto-approved', 'acme/app#7', 1]]);
});

// Até 17/11/2026 a política mudada para "esperar você" durante a espera largava a espera e ia à
// mesa. O `wait` saiu (o revisor nunca espera decisão de gente): gravado na conta, é lido como o
// padrão autônomo, e a espera gravada antes aprova do mesmo jeito.
test('o wait gravado na conta durante a espera não segura: a aprovação sai no ciclo seguinte', async () => {
  const e = await emEspera(9);
  Object.assign(e.config.conta, { onClean: 'wait', onCaveats: 'wait' });
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(pendente(e, 9), undefined);
  assert.equal(resolvida(e, 9).status, 'auto_approved');
  assert.equal(e.eventos.some((x) => x[0] === 'needs-decision'), false, 'ninguém foi chamado');
});

// O GitHub tira a conta de reviewRequests quando ela posta um review. No round 2 (pedi
// mudanças, o autor corrigiu, o CI está rodando) a lista chega sem mim, e conferir "ainda
// pedido a mim" por ela mandava para a mesa justamente a aprovação que a conta mandou sair.
test('round 2: a conta não está mais em reviewRequests e a aprovação sai do mesmo jeito', async () => {
  const e = await emEspera(10);
  gh.pedidos = [{ __typename: 'User', login: 'outra-pessoa' }];
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1, 'o APPROVE saiu');
  assert.equal(pendente(e, 10), undefined);
});

test('PR fechado ou mergeado na espera: não posta (quem tira a pendência é o reconcilePending)', async () => {
  const e = await emEspera(11);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.state = 'MERGED';
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, []);
  assert.equal(await e.reconcilePending(), 1);
  assert.equal(resolvida(e, 11).status, 'already_merged');
});

test('você aprovou por fora durante a espera: resolve sem postar de novo', async () => {
  const e = await emEspera(12);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.meusReviews = [{ state: 'APPROVED', submitted_at: '2026-09-30T12:30:00Z', commit_id: HEAD }];
  assert.equal(await e.varrerEsperas(), 1);
  assert.deepEqual(envios, []);
  assert.equal(resolvida(e, 12).status, 'already_reviewed');
});

test('o clique em Aprovar continua valendo durante a espera', async () => {
  const e = await emEspera(13);
  const r = await e.decide(pendente(e, 13).id, 'approve');
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 13).status, 'posted');
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await e.varrerEsperas(), 0);
  assert.equal(envios.length, 1, 'a espera morreu junto com a pendência');
});

test('a espera sobrevive a reinício: a marca vai gravada na decisão', async () => {
  const e = await emEspera(14);
  const disco = JSON.parse(JSON.stringify(e.decisions));
  const depois = motor([]);
  depois.decisions = disco;
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  assert.equal(await depois.varrerEsperas(), 1);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].commit_id, HEAD);
});

test('a postagem falhou depois do CI verde: passageira vai para o reenvio de sempre, permanente diz o que houve', async () => {
  const e = await emEspera(15);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  gh.postFalha = 'gh: No server is currently available to service your request. Sorry about that. (HTTP 503)';
  assert.equal(await e.varrerEsperas(), 0);
  const d = pendente(e, 15);
  assert.equal(d.esperaCi, null);
  const { atencaoAoPublicar, ...retry } = d.postRetry;
  assert.deepEqual(retry, { event: 'approve', attempts: 0 }, 'o retryFailedPosts assume');
  assert.ok(Array.isArray(atencaoAoPublicar), 'com os pontos que o card terá quando o reenvio publicar');
  assert.equal(d.reasons[0].kind, 'infra');
  assert.deepEqual(e.eventos, [], 'falha passageira não pede você');
  gh.postFalha = '';
  assert.equal(await e.retryFailedPosts(), 1);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 15).status, 'auto_approved');

  const f = await emEspera(16);
  gh.postFalha = 'gh: Resource not accessible by personal access token (HTTP 403)';
  assert.equal(await f.varrerEsperas(), 0);
  const p = pendente(f, 16);
  assert.equal(p.esperaCi, null);
  assert.equal(p.postRetry, null);
  assert.match(textos(p)[0], /falha ao postar o APPROVE/);
  // desde 17/11/2026 a falha permanente não vai à mesa: vai ao desfecho sem mesa, que posta o
  // COMMENT neutro numa varredura seguinte, sem chamar ninguém
  assert.equal(p.semMesa?.motivo, 'nao_aprovavel');
  assert.deepEqual(f.eventos, []);
});

/* ---------- gate de consciência na hora do post atrasado (30/09/2026) ----------
   A regra de bloqueadoPorHistorico (skip-review.js) só era consultada ao LANÇAR a revisão
   automática. Com a espera do CI passam minutos ou horas entre a revisão e o post, e uma
   pessoa pode ter pedido mudanças naquele commit: a aprovação sairia por cima. A mesma
   função é consultada de novo, só no instante do post (CI verde, head igual). */
const VERDE = () => [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
const review = (quem, state, extra = {}) => ({ quem, tipo: 'User', state, commit_id: HEAD, ...extra });

// Regra de 05/11/2026: decisão de gente no head dispensa a aprovação automática; nada vai para a mesa.
test('uma pessoa pediu mudanças no mesmo commit durante a espera: nada é postado, sem mesa', async () => {
  const e = await emEspera(20);
  gh.reviewsAlheios = [review('ana', 'CHANGES_REQUESTED')];
  leiturasDeReviewsAlheios = 0;
  gh.rollup = VERDE();
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(leiturasDeReviewsAlheios, 1);
  assert.equal(envios.length, 0);
  assert.equal(pendente(e, 20), undefined);
  assert.equal(resolvida(e, 20).status, 'approval_not_needed');
  assert.equal(e.eventos.some(([tipo]) => tipo === 'needs-decision'), false, 'nada vai para a mesa');
});

test('review de ferramenta (acrity) durante a espera não é pessoa: a aprovação sai', async () => {
  const e = await emEspera(21);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('acrity', 'CHANGES_REQUESTED'), review('acrity-review-bot', 'CHANGES_REQUESTED', { tipo: 'Bot' })];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1);
  assert.equal(resolvida(e, 21).status, 'auto_approved');
});

test('uma aprovação de pessoa dispensa a automática, sem mesa', async () => {
  const f = await emEspera(23);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('ana', 'APPROVED')];
  assert.equal(await f.varrerEsperas(), 1, 'a espera se resolve');
  assert.equal(envios.length, 0, 'nada postado');
  assert.equal(pendente(f, 23), undefined, 'nada fica pendente');
  const d = resolvida(f, 23);
  assert.equal(d.status, 'approval_not_needed');
  assert.match(textos(d)[0], /outra pessoa já decidiu este commit \(@ana\)/);
  assert.equal(f.eventos.some(([tipo]) => tipo === 'needs-decision'), false);
  assert.equal(await f.varrerEsperas(), 0, 'e não volta a ler nada');
});

test('meu pedido automático aberto não faz a aprovação sair por cima de quem decidiu durante a espera', async () => {
  const e = await emEspera(25);
  e.decisions.resolved.push({ key: 'acme/app#25', headSha: HEAD_NOVO, status: 'auto_rejected', pr: { account: 'eu' } });
  e.staleInfo = { 'acme/app#25': { stale: true, head: HEAD, lastState: 'CHANGES_REQUESTED' } };
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('ana', 'APPROVED')];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.filter((p) => p.event === 'APPROVE').length, 0);
  assert.equal(resolvida(e, 25).status, 'approval_not_needed');
});

test('pedido de mudanças em commit ANTERIOR não segura', async () => {
  const e = await emEspera(24);
  gh.rollup = VERDE();
  gh.reviewsAlheios = [review('ana', 'CHANGES_REQUESTED', { commit_id: HEAD_NOVO })];
  assert.equal(await e.varrerEsperas(), 1);
  assert.equal(envios.length, 1);
});

test('a regra é a de skip-review.js, sem cópia: o espera-ci só chama bloqueadoPorHistorico', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'espera-ci.js'), 'utf8');
  assert.match(fonte, /await engine\.bloqueadoPorHistorico\(pr\)/);
  assert.doesNotMatch(fonte, /ehFerramenta|reviewsDeOutros\(/, 'nenhuma segunda versão da regra');
});

// "dependência em aberto ... a conta que espera nas ressalvas não posta" saiu em 17/11/2026 com o
// `wait`: a conta sempre aprova com ressalvas, e o teste abaixo prova o card com a dependência.

// De 16 a 17/10/2026 (PR #244) a dependência era lacuna obrigatória e este caso não aprovava em
// política nenhuma. Decisão do dono de 17/10/2026: volta a ser ressalva, porque a dependência
// aberta costuma ser o PR irmão do mesmo card, também esperando aprovação.
test('a mesma dependência, em conta que aprova com ressalvas: aprova sozinho e a ressalva fica no app', async () => {
  const e = motor([], ['approve', 'approve']);
  sessao(e, { dependenciasAbertas: ['acme/infra#189 ainda aberto'] });
  await e.runHeadlessReview(PR(18));
  assert.equal(envios.length, 1);
  assert.doesNotMatch(JSON.stringify(envios[0]), /infra#189/, 'a ressalva não entra no texto do PR');
  assert.ok(resolvida(e, 18).attention.some((p) => /acme\/infra#189 ainda aberto/.test(p.text)), JSON.stringify(resolvida(e, 18).attention));
});

test('sem check pendente e sem ressalva, a aprovação automática segue saindo na hora', async () => {
  const e = motor([]);
  sessao(e);
  await e.runHeadlessReview(PR(19));
  assert.equal(envios.length, 1);
  assert.equal(pendente(e, 19), undefined);
});

test('check() roda a espera do CI depois do reconcilePending e antes do retryFailedPosts', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  const pend = fonte.indexOf('await this.reconcilePending();');
  const espera = fonte.indexOf('await this.varrerEsperas();');
  const retry = fonte.indexOf('await this.retryFailedPosts();');
  assert.ok(pend > 0 && pend < espera && espera < retry);
});

/* ---------- o revisor nunca espera o CI (17/11/2026) ---------- */
// A aprovação sai na hora, com o estado da pipe guardado como nota no app, e nada dele vai ao PR.
// Nem um config.json antigo com a chave ligada religa a espera.

function motorPadrao(checks, politica) {
  const e = motor(checks, politica);
  e.config.aguardarCiParaAprovar = true;
  return e;
}

test('check obrigatório rodando não segura, a aprovação sai na hora com o CI como nota', async () => {
  const e = motorPadrao([{ nome: 'test', estado: 'rodando' }]);
  sessao(e);
  await e.runHeadlessReview(PR(30));
  assert.equal(envios.length, 1, 'um APPROVE, sem esperar a pipe');
  assert.equal(envios[0].commit_id, HEAD);
  assert.doesNotMatch(JSON.stringify(envios[0]), /check obrigatório/, 'o estado do CI não entra no texto do PR');
  assert.equal(pendente(e, 30), undefined, 'nada fica esperando o CI');
  const r = resolvida(e, 30);
  assert.equal(r.status, 'auto_approved');
  assert.match(r.attention.map((p) => p.text).join(' | '), /check obrigatório ainda sem resultado no head \(test\)/);
  assert.equal(e.toasts.some((t) => /esperando o CI/.test(t)), false);
});

test('CI VERMELHO também não segura nem vira pedido de mudanças, e a nota nomeia o check', async () => {
  const e = motorPadrao([{ nome: 'audit', estado: 'vermelho' }]);
  sessao(e);
  await e.runHeadlessReview(PR(31));
  assert.deepEqual(envios.map((x) => x.event), ['APPROVE']);
  assert.match(resolvida(e, 31).attention.map((p) => p.text).join(' | '), /check obrigatório vermelho no head \(audit\)/);
});

test('checks que não deu para ler no commit revisado também não seguram', async () => {
  const e = motorPadrao([]);
  e.bloqueadoPorChecks = async () => ({ faltando: [] }); // sem verifiedHead: leitura não confirmada
  sessao(e);
  await e.runHeadlessReview(PR(35));
  assert.deepEqual(envios.map((x) => x.event), ['APPROVE']);
  assert.equal(resolvida(e, 35).status, 'auto_approved');
});

// Até 17/11/2026 a conta que mandava esperar você ia à mesa pela política, com o aviso do CI. O
// `wait` saiu: gravado na conta, é lido como o padrão autônomo, e a aprovação sai com a nota do CI.
test('o wait gravado na conta não segura: a aprovação sai na hora, com o aviso do CI', async () => {
  const e = motorPadrao([{ nome: 'test', estado: 'rodando' }], ['wait', 'wait']);
  sessao(e);
  await e.runHeadlessReview(PR(32));
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(pendente(e, 32), undefined);
  const r = resolvida(e, 32);
  assert.equal(r.esperaCi, undefined);
  assert.ok(r.attention.some((p) => /check obrigatório ainda sem resultado/.test(p.text)));
});

test('espera gravada antes: o próximo ciclo posta no mesmo head sem olhar o CI, uma vez só', async () => {
  const e = await emEspera(33, { checks: [{ nome: 'audit', estado: 'vermelho' }] });
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'FAILURE')];
  assert.equal(await e.varrerEsperas(), 1, 'sai no primeiro ciclo');
  assert.equal(envios.length, 1);
  assert.equal(envios[0].event, 'APPROVE');
  assert.equal(envios[0].commit_id, HEAD);
  const r = resolvida(e, 33);
  assert.equal(r.status, 'auto_approved');
  assert.match(r.attention.map((p) => p.text).join(' | '), /vermelho no head \(audit\)/);
  assert.ok(e.toasts.some((t) => /a espera do CI saiu, então a aprovação que esperava saiu sozinha/.test(t)), e.toasts.join(' | '));
  assert.equal(await e.varrerEsperas(), 0, 'sem laço: nada volta a esperar');
  assert.equal(envios.length, 1);
});

test('a liberação da espera gravada antes não afrouxa o head: commit novo continua largando, sem postar', async () => {
  const e = await emEspera(34);
  gh.head = HEAD_NOVO;
  assert.equal(await e.varrerEsperas(), 0);
  assert.deepEqual(envios, []);
  assert.equal(pendente(e, 34).blockedKind, 'stale_head');
});

test('a pendência nova não carrega a marca da espera do CI, e a gravada antes sai no ciclo seguinte', async () => {
  // revisão nova cuja postagem falhou de passagem (até 17/11/2026 era a conta esperando você pela
  // política): a pendência do reenvio não fala do CI como espera
  const e = motorPadrao([{ nome: 'test', estado: 'rodando' }]);
  sessao(e);
  gh.postFalha = 'HTTP 502: Bad Gateway';
  await e.runHeadlessReview(PR(36));
  gh.postFalha = '';
  assert.equal(pendente(e, 36).esperaCi, undefined);
  assert.equal(e.decisionForUi(pendente(e, 36)).esperaCi, undefined);
  // espera gravada antes: sai no ciclo seguinte
  const a = await emEspera(37);
  assert.ok(pendente(a, 37).esperaCi, 'gravada antes');
  assert.ok(a.decisionForUi(pendente(a, 37)).esperaCi);
  assert.equal(await a.varrerEsperas(), 1);
  assert.equal(pendente(a, 37), undefined, 'aprovada e resolvida: não fica mais como pendência');
});

test('a preferência de esperar o CI para aprovar saiu da tabela e não tem leitor', async () => {
  const { SETTINGS, EDITAVEIS } = await import('../lib/settings.js');
  const gate = await import('../lib/engine/gate-espera.js');
  assert.equal(SETTINGS.some((x) => x.key === 'aguardarCiParaAprovar'), false);
  assert.equal(EDITAVEIS.has('aguardarCiParaAprovar'), false);
  assert.equal('aguardaCiParaAprovar' in gate, false);
});

test('falha da sessão antes do resultado limpa o material privado e libera a revisão ativa', async () => {
  const prepare = technicalRuntime.prepareTechnicalReview;
  const clean = technicalRuntime.cleanup;
  let snapshot;
  technicalRuntime.prepareTechnicalReview = async (...args) => {
    const context = await prepare(...args);
    const parent = path.join(STATE_DIR, 'technical-review');
    fs.mkdirSync(parent, { recursive: true });
    snapshot = criarMaterial(parent);
    fs.writeFileSync(path.join(snapshot, 'privado.js'), 'material privado');
    return { ...context, snapshot };
  };
  technicalRuntime.cleanup = cleanup;
  const e = motor([]);
  e.runClaudeStream = async () => { throw new Error('fixture: sessão interrompida antes do resultado'); };
  try {
    await assert.rejects(e.runHeadlessReview(PR(500)), /sessão interrompida/);
    assert.ok(snapshot);
    assert.equal(fs.existsSync(snapshot), false);
    assert.equal(e.activeReviews.size, 0);
  } finally { technicalRuntime.prepareTechnicalReview = prepare; technicalRuntime.cleanup = clean; }
});
