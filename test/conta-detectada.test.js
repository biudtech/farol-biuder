// A conta revisora detectada pelo gh no primeiro boot, a instância de teste do guia, a config
// antiga só de contas silenciadas e a receita da instância que sobe sem agir.
//
// O guia manda subir a instância isolada com `{"port": 47180, "autoReview": false}` no
// config.json, justamente para ela NÃO revisar sozinha com a conta real de quem a abriu. A
// chave geral `autoReview` saiu em 30/09/2026 e virou campo da conta; aqui a escolha gravada
// antes de existir login tem de sobreviver até o gh ser detectado, inclusive a um reinício no
// meio (medido em 20/10/2026 no desenho antigo: a conta nascia revisando e aprovando sozinha).
// A regra de todos os casos: ler uma config antiga nunca deixa a conta mais permissiva.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-conta-detectada-'));
process.env.FAROL_HOME = FAROL_HOME;
const CONFIG = path.join(FAROL_HOME, 'config.json');

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let login = '';
const pedidos = [];
io.run = async (cmd, args) => {
  const sub = args.join(' ');
  pedidos.push(sub);
  if (sub === 'api user --jq .login') return { ok: !!login, code: login ? 0 : 1, stdout: `${login}\n`, stderr: '' };
  if (sub.startsWith('auth token')) return { ok: true, code: 0, stdout: 'tok-da-conta\n', stderr: '' };
  if (sub.startsWith('search prs')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { POLITICA_HISTORICO_FILE } = await import('../lib/paths.js');
const C = (await import('../lib/engine/contas-config.js')).default;

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const gravada = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const rastro = () => (fs.existsSync(POLITICA_HISTORICO_FILE) ? JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8')) : []);
function comecar(config) {
  fs.rmSync(POLITICA_HISTORICO_FILE, { force: true });
  if (config === null) fs.rmSync(CONFIG, { force: true });
  else fs.writeFileSync(CONFIG, JSON.stringify(config));
}
function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.avisos = [];
  e.on('toast', (t) => e.avisos.push(t));
  return e;
}
const politica = (e, user) => [e.autoReviewFor(user), e.approvePolicyFor(user, true), e.approvePolicyFor(user, false), e.rejectPolicyFor(user)];
const NAO_AGE = { autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };

test('instância de teste: a escolha gravada antes do login vale quando o gh é detectado, mesmo com um reinício no meio', async () => {
  comecar({ port: 47180, autoReview: false });
  login = '';
  const primeiro = motor();
  await primeiro.resolveAccount();
  assert.equal(primeiro.primaryUser(), '', 'sem gh logado não há conta');
  assert.deepEqual(politica(primeiro, ''), [false, 'approve', 'wait', 'wait']);
  assert.deepEqual(gravada().conta, { user: '', owners: [], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }, 'a escolha foi para o disco, na conta ainda sem login');
  assert.equal('autoReview' in gravada(), false, 'a chave geral antiga não volta para o arquivo');

  // reinício antes do login: a escolha não pode se perder na segunda carga
  const segundo = motor();
  assert.equal(segundo.config.conta.autoReview, false);
  login = 'detectada';
  await segundo.resolveAccount();
  assert.equal(segundo.primaryUser(), 'detectada');
  assert.deepEqual(politica(segundo, 'detectada'), [false, 'approve', 'wait', 'wait'], 'a conta real não revisa sozinha, e espera você nas ressalvas e na reprovação');
  // como na origin/main: revisão desligada pela chave geral, ressalvas e reprovação esperando você
  assert.deepEqual(gravada().conta, { user: 'detectada', owners: ['biudtech'], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });
  assert.equal(segundo.avisos.length, 1);
  assert.match(segundo.avisos[0].text, /Conta do GitHub detectada: @detectada/);
});

test('com a conta configurada, o gh não é consultado para detectar outra', async () => {
  login = 'intrusa';
  const e = motor();
  pedidos.length = 0;
  await e.resolveAccount();
  assert.equal(e.primaryUser(), 'detectada');
  assert.deepEqual(pedidos, []);
});

test('config antiga só com contas silenciadas: a conta que nasce da detecção não age, nem depois de reiniciar', async () => {
  comecar({ accounts: [{ user: 'calada', owners: ['acme'], muted: true }, { user: 'outra', owners: ['beta'], muted: true, onReject: 'request_changes' }] });
  login = '';
  const primeiro = motor();
  assert.deepEqual(gravada().conta, { user: '', owners: [], ...NAO_AGE }, 'a escolha de não agir vai para o disco antes de existir login');
  assert.equal('accounts' in gravada(), false);
  await primeiro.resolveAccount();
  assert.equal(primeiro.primaryUser(), '');

  login = 'ativa-no-gh';
  const segundo = motor();
  await segundo.check('test');
  assert.equal(segundo.primaryUser(), 'ativa-no-gh');
  assert.deepEqual(gravada().conta, { user: 'ativa-no-gh', owners: ['biudtech'], ...NAO_AGE });
  assert.deepEqual(politica(segundo, 'ativa-no-gh'), [false, 'wait', 'wait', 'wait'], 'na origin/main a silenciada nunca agia');

  const terceiro = motor();
  assert.deepEqual(politica(terceiro, 'ativa-no-gh'), [false, 'wait', 'wait', 'wait'], 'e continua sem agir no boot seguinte');
});

test('instalação nova: a conta detectada nasce com as orgs padrão e a política por extenso', async () => {
  comecar(null);
  login = 'nova';
  const e = motor();
  assert.equal(fs.existsSync(CONFIG), true, 'o primeiro boot grava a config');
  assert.equal('conta' in gravada(), false, 'sem login ainda não há conta no arquivo');
  await e.resolveAccount();
  assert.deepEqual(gravada().conta, { user: 'nova', owners: ['biudtech'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.deepEqual(e.accountList(), [{ user: 'nova', owners: ['biudtech'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }]);
});

// A receita da instância nova que sobe SEM agir: monitora e não posta nada sozinha. É o
// conteúdo mínimo do config.json; o login vem do gh no primeiro check().
const RECEITA_SEM_AGIR = { conta: { autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } };

test('receita da instância que sobe sem agir: sobrevive ao primeiro check(), à detecção da conta e ao reinício', async () => {
  comecar(RECEITA_SEM_AGIR);
  login = 'revisora';
  const e = motor();
  const lancadas = [];
  e.launchReview = async (...a) => { lancadas.push(a); return { ok: true }; };
  e.searchPRs = async (extra) => (extra[0] === '--review-requested=@me'
    ? [{ key: 'biudtech/app#1', repo: 'biudtech/app', number: 1, url: 'https://github.com/biudtech/app/pull/1', title: 'PR', author: 'dev', account: 'revisora', updatedAt: '2026-11-15T10:00:00Z', labels: [] }]
    : []);
  await e.check('test');   // a primeira checagem só marca o estoque
  await e.check('test');
  assert.equal(e.primaryUser(), 'revisora');
  assert.equal(e.tokenOk, true, 'a conta monitora com o token dela');
  assert.deepEqual(gravada().conta, { user: 'revisora', owners: ['biudtech'], ...NAO_AGE });
  assert.deepEqual(politica(e, 'revisora'), [false, 'wait', 'wait', 'wait']);
  assert.deepEqual(lancadas, [], 'nenhuma revisão automática foi lançada');
  assert.deepEqual(politica(motor(), 'revisora'), [false, 'wait', 'wait', 'wait'], 'e o boot seguinte lê a mesma coisa');
});

test('os padrões de Automação da instalação nova: retomada ligada, sem chave de espera do CI', () => {
  comecar(null);
  const e = motor();
  assert.equal(e.config.reReviewResume, true);
  assert.equal('aguardarCiParaAprovar' in e.config, false, 'o revisor nunca espera o CI: a chave não existe');
  assert.equal('aguardarCiParaRevisar' in e.config, false);
  assert.equal('esquemaConfig' in gravada(), false, 'o marcador das migrações antigas saiu com elas');
});

/* ---------- o rastro: o que a carga e a detecção decidem fica registrado, uma vez ---------- */

test('a carga de uma config antiga registra o que decidiu, com origem de migração, e o segundo boot não repete', () => {
  comecar({ port: 47197, autoReview: false, autoApproveAll: true, accounts: [
    { user: 'calada', owners: ['org0'], muted: true },
    { user: 'herda', owners: ['org1'] },
    { user: 'propria', owners: ['org2'], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes' },
  ] });
  const e = motor();
  assert.equal(e.primaryUser(), 'herda');
  const hist = rastro();
  assert.ok(hist.every((h) => h.origem === 'migração' && Number(h.at) > 0));
  assert.deepEqual(hist.map((h) => [h.conta, h.campo, h.de, h.para]), [
    [null, 'autoReview', false, null],
    [null, 'autoApproveAll', true, null],
    ['herda', 'autoReview', null, false],
    ['herda', 'onClean', null, 'approve'],
    ['herda', 'onCaveats', null, 'approve'],
    ['herda', 'onReject', null, 'wait'],
  ]);
  const disco = fs.readFileSync(CONFIG, 'utf8');
  motor();
  assert.equal(rastro().length, hist.length, 'a carga fica registrada uma vez só');
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), disco);
  e.politicaHistorico = [{ at: Date.now(), conta: 'herda', campo: 'onClean', de: null, para: 'wait', origem: 'migração' }];
  e.config.conta.onClean = 'wait';
  assert.match(C.motivoDaPolitica(e, 'herda', true), /definido em \d{2}\/\d{2} \d{2}:\d{2}, quando a política foi lida da configuração antiga/);
});

test('conta que já tinha tudo escrito não gera rastro na carga', () => {
  comecar({ conta: { user: 'pronta', owners: ['o'], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes' } });
  motor();
  assert.deepEqual(rastro(), []);
});

test('a detecção registra a política com que a conta nasceu, com a origem dita, e uma vez só', async () => {
  comecar({ port: 47180, autoReview: false });
  login = 'detectada';
  const e = motor();
  assert.deepEqual(rastro().map((h) => [h.conta, h.campo, h.de, h.para, h.origem]), [[null, 'autoReview', false, null, 'migração']]);
  await e.resolveAccount();
  const daConta = rastro().filter((h) => h.conta === 'detectada');
  assert.deepEqual(daConta.map((h) => [h.campo, h.de, h.para, h.origem]), [
    ['autoReview', null, false, 'detecção do gh'],
    ['onClean', null, 'approve', 'detecção do gh'],
    ['onCaveats', null, 'wait', 'detecção do gh'],
    ['onReject', null, 'wait', 'detecção do gh'],
  ]);
  const total = rastro().length;
  await motor().resolveAccount();
  assert.equal(rastro().length, total, 'o boot seguinte não detecta nem registra de novo');
});

test('a senioridade antiga do config.json ainda vira perfil por pessoa no boot', () => {
  comecar({ seniority: { Ana: 'senior' } });
  const e = motor();
  assert.equal('seniority' in e.config, false);
  assert.equal(e.config.people.ana && e.config.people.ana.papel, 'senior', JSON.stringify(e.config.people));
});
