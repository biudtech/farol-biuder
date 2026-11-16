import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-review-scope-'));
process.env.FAROL_HOME = testHome;
const { Engine } = await import('../server.js');
const { editarRegra, normalizarRegras, politicaDeInicio } = await import('../lib/engine/review-scope.js');
after(() => fs.rmSync(testHome, { recursive: true, force: true }));

const pr = (author = 'joao', org = 'acme') => ({ key: `${org}/app#1`, repo: `${org}/app`, number: 1, url: `https://github.com/${org}/app/pull/1`, account: 'revisor', author });
function engine(reviewRules, autoReview = true) {
  const e = new Engine();
  e.config.conta = { user: 'revisor', owners: ['acme'], autoReview, onClean: 'wait', onCaveats: 'wait', onReject: 'wait', ...(reviewRules ? { reviewRules } : {}) };
  e.token = 'token-de-teste';
  e.log = () => {};
  e.pushState = () => {};
  e.writeInflight = () => {};
  e.processHeadless = () => {};
  e.bloqueiaAutomatico = async () => false;
  e.outrosRevisando = () => [];
  e.prState = async () => 'OPEN';
  e.jaResolvido = async () => false;
  return e;
}
const manual = { acme: { mode: 'manual' } };
const automatico = { acme: { mode: 'auto' } };

test('sem regra nova, preserva automático, manual e o contrato anterior de retry', () => {
  for (const ligado of [true, false]) {
    const e = engine(undefined, ligado);
    assert.equal(politicaDeInicio(e, pr()).automatic, ligado);
    assert.equal(politicaDeInicio(e, pr(), { retry: true }).automatic, true);
    assert.equal(Object.hasOwn(e.config.conta, 'reviewRules'), false);
  }
});

test('organização manual bloqueia só a organização escolhida, inclusive fora de owners', () => {
  const e = engine({ externa: { mode: 'manual' } });
  assert.equal(politicaDeInicio(e, pr('joao', 'externa')).automatic, false);
  assert.equal(politicaDeInicio(e, pr()).automatic, true);
});

test('autor tem precedência na organização, e a exceção automática vale com a conta só na fila', () => {
  const e = engine({ acme: { mode: 'manual', authors: { joao: 'auto', maria: 'manual' } } });
  assert.equal(politicaDeInicio(e, pr('Joao')).automatic, true);
  assert.equal(politicaDeInicio(e, pr('maria')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('outra')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('maria', 'outra-org')).automatic, true);
  // 12/11/2026: a regra vale nos dois sentidos. Autor Automático revisa sozinho mesmo com a conta só
  // na fila, e quem não tem regra segue a conta.
  e.config.conta.autoReview = false;
  assert.equal(politicaDeInicio(e, pr('joao')).automatic, true);
  assert.equal(politicaDeInicio(e, pr('maria')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('maria', 'outra-org')).automatic, false);
});

// O caso que motivou (12/11/2026): uma conta do gh atende duas organizações, e só uma delas deve revisar
// sozinha. Com a conta em "só põe na fila" e essa organização em Automático, nada iniciava.
const OUTRA = (autor = 'autora') => ({ ...pr(autor, 'outra-org'), key: 'outra-org/api#7', url: 'https://github.com/outra-org/api/pull/7' });
const SO_OUTRA = { 'outra-org': { mode: 'auto' } };

test('conta só na fila com uma organização Automático revisa sozinha só ela', () => {
  const e = engine(SO_OUTRA, false);
  assert.deepEqual(politicaDeInicio(e, OUTRA()), { automatic: true, mode: 'auto', source: 'organizacao', organization: 'outra-org' });
  assert.equal(politicaDeInicio(e, pr()).automatic, false, 'a organização sem regra segue a conta');
  assert.equal(politicaDeInicio(e, pr(), { retry: true }).automatic, true, 'o contrato anterior da retentativa sem regra fica');
  e.config.conta.reviewRules = { 'outra-org': { mode: 'auto', authors: { estagiario: 'manual' } } };
  assert.equal(politicaDeInicio(e, OUTRA('estagiario')).automatic, false, 'autor Manual vence a organização Automático');
});

test('disparo inicial com a conta só na fila lança a organização Automático e mais nada', async () => {
  const e = engine(SO_OUTRA, false);
  e.queue = [pr(), OUTRA()];
  e._registraPulo = () => false;
  let lancados;
  e.launchReview = async urls => { lancados = urls; };
  await e._dispararAutomacoes(e.queue);
  assert.deepEqual(lancados, [OUTRA().url]);
});

test('nova rodada por push com a conta só na fila segue a regra da organização', () => {
  for (const [regras, esperado] of [[SO_OUTRA, 1], [undefined, 0]]) {
    const e = engine(regras, false);
    e.panorama = [OUTRA()];
    e.headQuietoDesde = { [OUTRA().key]: { head: 'novo', at: 1 } };
    e.staleInfo = { [OUTRA().key]: { stale: true, head: 'novo', lastState: 'CHANGES_REQUESTED' } };
    assert.equal(e.reReviewTargets(new Set()).length, esperado);
  }
});

test('reconferência técnica e recuperação da prova seguem a regra, nos dois sentidos', async () => {
  const { launchTechnicalRechecks } = await import('../lib/technical-review/recheck.js');
  const { pausaDaRecuperacao, AUTOMACAO_DESLIGADA } = await import('../lib/engine/recuperacao-prova.js');
  const casos = [
    { regras: manual, conta: true, alvo: pr(), relanca: false },
    { regras: SO_OUTRA, conta: false, alvo: OUTRA(), relanca: true },
    { regras: undefined, conta: false, alvo: pr(), relanca: false },
  ];
  for (const c of casos) {
    const e = engine(c.regras, c.conta);
    const enfileirados = [];
    e.enqueueHeadless = p => { enfileirados.push(p.key); return { ok: true }; };
    e.saveDecisions = () => {};
    const item = { key: c.alvo.key, pr: { ...c.alvo, manual: true }, technicalRecheck: true };
    e.decisions.pending = [item];
    launchTechnicalRechecks(e);
    assert.deepEqual(enfileirados, c.relanca ? [c.alvo.key] : [], JSON.stringify(c));
    const pausa = await pausaDaRecuperacao(e, { key: c.alvo.key, pr: c.alvo, technicalReview: {} });
    assert.equal(pausa === AUTOMACAO_DESLIGADA, !c.relanca, JSON.stringify(c));
  }
});

test('a regra é da conta revisora: a marca de outra conta no item não escapa dela', () => {
  const e = engine(manual);
  assert.equal(politicaDeInicio(e, pr()).automatic, false);
  assert.equal(politicaDeInicio(e, { ...pr(), account: 'outro' }).automatic, false);
});

test('autor desconhecido não atravessa restrição e login de bot é aceito', () => {
  const e = engine({ acme: { authors: { 'robot[bot]': 'manual' } } });
  assert.equal(politicaDeInicio(e, pr('')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('robot[bot]')).automatic, false);
  assert.equal(politicaDeInicio(e, pr('joao')).automatic, true);
});

test('normalização conserva restrições e recusa modo inválido na edição', () => {
  assert.deepEqual(normalizarRegras({ ACME: { mode: 'invalido', authors: { Maria: false } } }), { acme: { mode: 'manual', authors: { maria: 'manual' } } });
  const conta = { user: 'x' };
  for (const op of [{ organization: '../acme', mode: 'auto' }, { organization: 'acme', mode: true }, { organization: 'acme', author: 'a/b', mode: 'manual' }]) {
    assert.equal(editarRegra(conta, op).ok, false);
    assert.deepEqual(conta, { user: 'x' });
  }
});

test('remover uma regra restaura herança e preserva autores e demais organizações', () => {
  const conta = { user: 'x', autoReview: false, reviewRules: { acme: { mode: 'manual', authors: { joao: 'auto', maria: 'manual' } }, outra: { mode: 'manual' } } };
  const r = editarRegra(conta, { organization: 'ACME', mode: 'inherit' });
  assert.equal(r.ok, true);
  assert.equal(r.conta.autoReview, false);
  assert.deepEqual(r.conta.reviewRules.acme.authors, conta.reviewRules.acme.authors);
  assert.equal(r.conta.reviewRules.acme.mode, undefined);
  const s = editarRegra(r.conta, { organization: 'acme', author: '@Joao', mode: 'inherit' });
  assert.deepEqual(s.conta.reviewRules.acme.authors, { maria: 'manual' });
  assert.deepEqual(s.conta.reviewRules.outra, { mode: 'manual', authors: {} });
  assert.equal(conta.reviewRules.acme.mode, 'manual');
});

test('operações pontuais persistem, sobrevivem a outra edição da conta e não mudam políticas atuais', () => {
  const e = engine();
  const antes = JSON.parse(JSON.stringify(e.config.conta));
  assert.notEqual(e.editarConta({ tipo: 'regra-review', user: 'revisor', organization: 'ACME', author: '@Maria', mode: 'manual' }).ok, false);
  e.editarConta({ tipo: 'editar', user: 'revisor', campos: { owners: ['acme', 'outra'] } });
  const conta = e.accountList()[0];
  assert.equal(conta.reviewRules.acme.authors.maria, 'manual');
  for (const campo of ['autoReview', 'onClean', 'onCaveats', 'onReject']) assert.equal(conta[campo], antes[campo]);
  assert.deepEqual(e.snapshot().accounts[0].reviewRules, conta.reviewRules);
  assert.equal(new Engine().accountList()[0].reviewRules.acme.authors.maria, 'manual');
  assert.equal(antes.reviewRules, undefined);
});

test('edição inválida não grava e conta inexistente é recusada', () => {
  const e = engine(manual);
  e.saveConfig();
  const antes = fs.readFileSync(path.join(testHome, 'config.json'), 'utf8');
  assert.equal(e.editarConta({ tipo: 'regra-review', user: 'revisor', organization: 'acme', mode: 'invalido' }).ok, false);
  assert.equal(e.editarConta({ tipo: 'regra-review', user: 'ausente', organization: 'acme', mode: 'auto' }).ok, false);
  assert.equal(fs.readFileSync(path.join(testHome, 'config.json'), 'utf8'), antes);
});

test('entrada central barra automático, distribuição e admin, mas aceita clique explícito', () => {
  const e = engine(manual);
  for (const extras of [{}, { viaDistribuicao: true }, { viaAdmin: true }]) {
    assert.deepEqual(e.enqueueHeadless({ ...pr(), ...extras }), { ok: false, code: 'review_manual' });
  }
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.enqueueHeadless({ ...pr(), manual: true }).ok, true);
  assert.equal(e.headlessQueue.length, 1);
});

test('retry consulta a regra atual, inclusive quando a sessão original foi por clique', () => {
  const e = engine(manual);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true } });
  assert.deepEqual(e.retryTargets(new Set(), new Set()), []);
  e.config.conta.reviewRules = automatico;
  assert.equal(e.retryTargets(new Set(), new Set()).length, 1);
  e.config.conta.reviewRules = manual;
  assert.equal(e.enqueueHeadless({ ...pr(), manual: true, automaticRetry: true }).ok, false);
});

test('repescagem marca a retomada como automática sem perder a origem nem o autor', async () => {
  const e = engine(automatico);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true, requested: true } });
  await e._repescarRetry([], new Set());
  assert.equal(e.headlessQueue.length, 1);
  assert.equal(e.headlessQueue[0].automaticRetry, true);
  assert.equal(e.headlessQueue[0].author, 'joao');
  e.config.conta.reviewRules = manual;
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  await e.runOneHeadless(e.headlessQueue.shift(), 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.queue[0].key, pr().key);
});

test('troca para manual enquanto aguarda vaga devolve o PR à fila e libera o slot', async () => {
  const e = engine(automatico);
  const alvo = pr();
  e.markSeen(alvo.key);
  assert.equal(e.enqueueHeadless(alvo).ok, true);
  e.config.conta.reviewRules = manual;
  e.headlessBusyAccounts.set('revisor', 1);
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  await e.runOneHeadless(e.headlessQueue.shift(), 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.seen.has(alvo.key), false);
  assert.equal(e.queue[0].key, alvo.key);
  assert.equal(e.headlessBusyAccounts.has('revisor'), false);
});

test('clique novo ultrapassa manual e limpa a marca da retentativa anterior', async () => {
  const e = engine(manual);
  e.queue = [{ ...pr(), automaticRetry: true }];
  const r = await e.launchReview([pr().url], 'auto', 'clique');
  assert.equal(r.ok, true);
  assert.equal(e.headlessQueue[0].manual, true);
  assert.equal(e.headlessQueue[0].automaticRetry, false);
});

test('lançamento automático bloqueado pela regra informa espera manual e conserva a fila', async () => {
  const e = engine(manual);
  e.queue = [pr()];
  const r = await e.launchReview([pr().url], 'auto', 'auto');
  assert.equal(r.ok, false);
  assert.match(r.error, /manual/);
  assert.equal(e.queue.length, 1);
  assert.equal(e.headlessQueue.length, 0);
});

test('novas rodadas por push e por pendência respeitam o autor e não queimam âncora', async () => {
  for (const gatilho of ['push', 'pendencia']) {
    const e = engine(manual);
    e.panorama = [pr()];
    e.headQuietoDesde = { [pr().key]: { head: 'novo', at: 1 } };
    if (gatilho === 'push') e.staleInfo = { [pr().key]: { stale: true, head: 'novo', lastState: 'CHANGES_REQUESTED' } };
    else e.decisions.pending = [{ key: pr().key, pr: pr(), blockedKind: 'stale_head', blockedHead: 'novo', createdAt: 1 }];
    assert.deepEqual(e.reReviewTargets(new Set()), []);
    await e.launchReReviews();
    assert.equal(e.headlessQueue.length, 0);
    assert.equal(e.reReviewLaunched[pr().key], undefined);
    e.config.conta.reviewRules = { acme: { mode: 'manual', authors: { joao: 'auto' } } };
    assert.equal(e.reReviewTargets(new Set()).length, 1);
  }
});

test('disparo inicial seleciona apenas organização e autor permitidos', async () => {
  const e = engine({ acme: { mode: 'manual', authors: { joao: 'auto' } }, externa: { mode: 'manual' } });
  e.queue = [pr(), { ...pr('maria'), key: 'acme/app#2', url: 'https://github.com/acme/app/pull/2' }, pr('joao', 'externa')];
  e._registraPulo = () => false;
  let lancados;
  e.launchReview = async urls => { lancados = urls; };
  await e._dispararAutomacoes(e.queue);
  assert.deepEqual(lancados, [pr().url]);
  assert.equal(e.queue.length, 3, 'manual continua visível na fila');
});

test('mudança durante consulta assíncrona também impede a sessão e preserva retomada', async () => {
  const e = engine(automatico);
  let sessoes = 0;
  e.runHeadlessReview = async () => { sessoes++; };
  e.prState = async () => { e.config.conta.reviewRules = manual; return 'OPEN'; };
  await e.runOneHeadless({ ...pr(), manual: true, automaticRetry: true }, 'revisor');
  assert.equal(sessoes, 0);
  assert.equal(e.queue.length, 1);
});

test('troca para manual durante a repescagem não oculta o PR nem marca visto', async () => {
  const e = engine(automatico);
  e.queue = [pr()];
  e.unsee(pr().key);
  e.retryAfterNet.set(pr().key, { tries: 1, pr: { ...pr(), manual: true } });
  e.prState = async () => { e.config.conta.reviewRules = manual; return 'OPEN'; };
  await e._repescarRetry([], new Set());
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.queue.length, 1);
  assert.equal(e.seen.has(pr().key), false);
});

test('troca para manual durante o gate de nova rodada não consome a âncora', async () => {
  const e = engine(automatico);
  e.panorama = [pr()];
  e.staleInfo = { [pr().key]: { stale: true, head: 'novo', lastState: 'CHANGES_REQUESTED' } };
  e.headQuietoDesde = { [pr().key]: { head: 'novo', at: 1 } };
  e.bloqueiaAutomatico = async () => { e.config.conta.reviewRules = manual; return false; };
  await e.launchReReviews();
  assert.equal(e.headlessQueue.length, 0);
  assert.equal(e.reReviewLaunched[pr().key], undefined);
});

test('mudança durante consulta libera apenas a vaga original e preserva a próxima revisão', async () => {
  const e = engine(automatico);
  e.config.parallelReviews = 1;
  e.headlessBusyAccounts.set('revisor', 1);
  const seguinte = { ...pr('outro', 'outra'), manual: true };
  const terceiro = { ...seguinte, key: 'outra/app#2', number: 2, url: 'https://github.com/outra/app/pull/2' };
  e.headlessQueue = [seguinte, terceiro];
  const iniciados = [];
  // A próxima sessão fica ocupando sua vaga; só o efeito externo da sessão é dublado.
  e.runOneHeadless = p => { iniciados.push(p.key); };
  e.processHeadless = () => Engine.prototype.processHeadless.call(e);
  e.prState = async () => { e.config.conta.reviewRules = manual; return 'OPEN'; };
  await Engine.prototype.runOneHeadless.call(e, { ...pr(), manual: true, automaticRetry: true }, 'revisor');
  assert.deepEqual(iniciados, [seguinte.key]);
  assert.equal(e.headlessBusyAccounts.get('revisor'), 1, 'a próxima sessão ainda ocupa a conta');
  assert.equal(e.headlessQueue.length, 1, 'o terceiro PR continua esperando sua vaga');
  assert.equal(e.queue[0].key, pr().key, 'o PR bloqueado continua visível');
});

test('o motor manda para a tela, por PR, se a revisão inicia sozinha', () => {
  const e = engine(SO_OUTRA, false);
  e.queue = [pr(), OUTRA()];
  assert.deepEqual(e.inicioAutomaticoDaFila(), { [pr().key]: false, [OUTRA().key]: true });
});
