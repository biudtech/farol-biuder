// check() resiliente a falha PARCIAL das buscas: quando só as --review-requested
// falham (ex.: rate limit da API de search), a fila, o "é meu" do panorama e os
// marcadores do último ciclo bom são preservados, como já acontece com reviewedKeys.
// Sem isso, um ciclo ruim zerava a fila, apagava reReviewedKeys
// (ressuscitando PRs ignorados) e re-notificava tudo na recuperação.
// Runner nativo (node --test), ZERO dependências.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-checkres-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { BASELINE_FILE, STATE_DIR } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = {
  key: 'acme/app#1', url: 'https://github.com/acme/app/pull/1', title: 'PR de teste',
  author: 'alice', repo: 'acme/app', number: 1, updatedAt: '2026-08-01T10:00:00Z', account: 'me'
};

// Engine com TODO colaborador de rede/side-effect do check() stubado. O roteiro
// (e.scenario) diz o que cada busca devolve no ciclo corrente; null = busca falhou.
function checkEngine() {
  const e = new Engine();
  // a revisão automática é da conta (30/09/2026): nenhuma conta desta suíte revisa sozinha
  e.config.conta = { user: 'me', owners: ['acme'], autoReview: false };
  e.seen = new Set();
  e.reReviewedKeys = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.queue = [];
  e.resolveAccount = async () => {};
  e.refreshTokens = async () => { e.tokenOk = true; return true; };
  e.refreshStaleStates = async () => {};
  e.refreshReviewSignals = async () => {}; // sinal por ref é rede: fora do ciclo de teste
  e.scanPushbacks = async () => {};
  e.launchReview = () => { throw new Error('launchReview não deveria rodar neste teste'); };
  e.schedule = () => {};
  e.saveSeen = () => {}; // seen em memória basta pro cenário
  // gate de consciência sempre livre (é rede; a suíte dele é
  // test/consciencia-historico.test.js)
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  // idem pro gate de checks obrigatorios: sem o stub, o prototype real iria ao gh
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  const cenarioDaBusca = (primeiro) => {
    if (primeiro === '--owner') return e.scenario.panorama;
    if (primeiro === '--review-requested=@me') return e.scenario.mine;
    return e.scenario.reviewed;
  };
  e.searchPRs = async (extraArgs) => {
    const lista = cenarioDaBusca(extraArgs[0]);
    return lista === null ? null : lista.map(p => ({ ...p })); // check() muta os PRs
  };
  // baseline já existente: a 1ª checagem da vida não pode engolir a fila do teste
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
  e.notices = [];
  e.on('new-prs', ev => e.notices.push(ev));
  return e;
}

test('falha só das --review-requested preserva fila e "é meu", sem re-notificar', async () => {
  const e = checkEngine();
  // ciclo 1: tudo ok, o PR pedido a mim entra na fila e notifica UMA vez
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'notificou o PR novo uma vez');
  // ciclo 2: rate limit derruba só as buscas --review-requested
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1, 'fila preservada do último ciclo bom');
  assert.equal(e.panorama.find(p => p.key === PR.key).mine, true, 'o "é meu" não some do panorama');
  assert.equal(e.notices.length, 1, 'ciclo com falha não notifica');
  assert.equal(e.lastError, null, 'falha parcial não é erro fatal do ciclo');
  // ciclo 3: a busca volta; nada é "novo" de novo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(e.notices.length, 1, 'recuperação não re-notifica o que já estava na fila');
});

test('PR ignorado não ressuscita depois de um ciclo com busca falha', async () => {
  const e = checkEngine();
  // histórico local: já revisei este PR faz tempo (fora de qualquer carência)
  e.decisions.resolved.unshift({ key: PR.key, status: 'auto_approved', action: 'approve', resolvedAt: Date.now() - 60 * 60 * 1000 });
  e.seen.add(PR.key);
  // ciclo 1: re-request real detectado, volta pra fila
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), false, 're-request des-marca o visto');
  assert.ok(e.reReviewedKeys.has(PR.key));
  // usuário ignora (re-marca visto)
  e.seen.add(PR.key);
  // ciclo 2: a falha das buscas --review-requested não pode apagar o marcador
  e.scenario = { panorama: [PR], mine: null, reviewed: [] };
  await e.check('test');
  assert.ok(e.reReviewedKeys.has(PR.key), 'marcador sobrevive à falha da busca');
  // ciclo 3: busca volta e o PR segue pedido; o ignorar fica valendo
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.seen.has(PR.key), true, 'o ignorar do usuário fica valendo');
  assert.equal(e.queue.length, 0, 'não volta pra fila sozinho');
});

test('check(): conta com revisão automática dispara a auto-revisão do PR pedido', async () => {
  const e = checkEngine();
  e.config.conta.autoReview = true;
  e.token = 'tok-me';
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '' }];
  e.config.claudeProfileId = 'p1';
  const launchCalls = [];
  e.launchReview = (urls, mode) => { launchCalls.push({ urls, mode }); };
  e.scenario = { panorama: [PR], mine: [PR], reviewed: [] };
  await e.check('test');
  assert.equal(e.queue.length, 1);
  assert.equal(launchCalls.length, 1, 'o disparo automático roda');
  assert.deepEqual(launchCalls[0].urls, [PR.url], 'o PR elegível é o que entra no launchReview');
});

// Desde a Task 2.3 (G9), o retry pós-rede relança o OBJETO guardado via
// enqueueHeadless (não mais launchReview por URL): preserva requested/knownHead
// do objeto guardado em vez de re-resolver pela URL (que os derrubava).
test('check(): retry pós-transitório relança o objeto guardado', async () => {
  const e = checkEngine();
  e.token = 'tok-me';
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '' }];
  e.config.claudeProfileId = 'p1';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR, requested: true, knownHead: 'c'.repeat(40) } });
  const enqueued = [];
  e.enqueueHeadless = (pr) => { enqueued.push(pr); };
  e.scenario = { panorama: [], mine: [], reviewed: [] };
  await e.check('test');
  assert.equal(enqueued.length, 1, 'o retry relança como sempre relançou');
  assert.equal(enqueued[0].url, PR.url);
  assert.equal(enqueued[0].requested, true, 'G9: relança o objeto guardado, requested sobrevive');
  assert.equal(enqueued[0].knownHead, 'c'.repeat(40), 'G9: knownHead sobrevive ao relançamento');
});

// Achado CRITICAL da revisão da Task 2.3: trocar launchReview por enqueueHeadless
// no retry resolveu requested/knownHead, mas enqueueHeadless sozinho NÃO faz o que
// launchReview fazia (markSeen + sair da queue). A falha transitória original
// (runOneHeadless) tinha feito unsee(pr.key) + queue.push(pr) pra deixar o card
// visível "aguardando você" enquanto esperava o retry; sem desfazer isso no
// relançamento, o PR reaparece na "sua fila" com botão Revisar ativo ENQUANTO a
// revisão relançada já está rodando por trás, mentindo "aguardando você".
test('check(): PR relançado pelo retry sai da fila visível e volta a visto (card não mente "aguardando você") (G9)', async () => {
  const e = checkEngine();
  e.token = 'tok-me';
  e.config.claudeProfiles = [{ id: 'p1', label: 'P1', kind: 'apikey', apiKey: 'sk-1', baseUrl: '' }];
  e.config.claudeProfileId = 'p1';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR, requested: true, knownHead: 'c'.repeat(40) } });
  // estado deixado pela falha transitória original (runOneHeadless): unsee + queue.push,
  // e o gh volta a devolver o PR na busca --review-requested=@me (mesmo PR de sempre)
  e.seen = new Set();
  e.queue = [{ ...PR }];
  const enqueued = [];
  e.enqueueHeadless = (pr) => { enqueued.push(pr); };
  e.scenario = { panorama: [], mine: [{ ...PR }], reviewed: [] };
  await e.check('test');
  assert.equal(enqueued.length, 1, 'relançou o PR');
  assert.equal(e.queue.some(p => p.key === PR.key), false, 'sai da fila visível: o card não pode mostrar Revisar ativo com a revisão já rodando');
  assert.equal(e.seen.has(PR.key), true, 'volta a visto: mesmo efeito que o launchReview produzia no lançamento manual');
});
