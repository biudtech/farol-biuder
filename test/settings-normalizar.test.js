// config.json antigo com chaves do que saiu (Review Focus 1 do plano da fase 1): várias contas,
// conta silenciada, o modo simples `ghUser` + `owners`, perfis de tipos que não existem mais,
// `sync`, `cadeiaPerfis`. O boot não lança: a primeira conta não silenciada vira `conta`, e a
// chave que ninguém lê é descartada.
//
// Diferença para o texto do plano, de propósito: o perfil do Claude por ASSINATURA
// (`kind: 'dir'`) voltou ao motor depois de o plano ser escrito, então ele FICA. Saem os tipos
// que não existem (codex, agy, openrouter, maquina e o formato sem `kind`).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const settings = await import('../lib/settings.js');
const { normalizarConfig } = settings;

test('lista de contas antiga: a primeira não silenciada vira a conta, e o que saiu é descartado', () => {
  const saida = normalizarConfig({
    accounts: [{ user: 'a', muted: true }, { user: 'b', owners: ['biudtech'], onClean: 'approve' }],
    cadeiaPerfis: [],
    sync: {},
    claudeProfiles: [
      { id: 'x', kind: 'dir' },
      { id: 'y', kind: 'apikey', apiKey: 'k' },
      { id: 'c', kind: 'codex' },
      { id: 'g', kind: 'agy' },
      { id: 'o', kind: 'openrouter', apiKey: 'k' },
      { id: 'm', kind: 'maquina' },
      { id: 's', dir: '/home/alguem/.claude' },
    ],
  });
  assert.equal(saida.conta.user, 'b');
  assert.equal(saida.conta.onClean, 'approve');
  assert.deepEqual(saida.conta.owners, ['biudtech']);
  assert.equal('accounts' in saida, false);
  assert.equal('cadeiaPerfis' in saida, false);
  assert.equal('sync' in saida, false);
  assert.deepEqual(saida.claudeProfiles.map((p) => p.id), ['x', 'y'], 'assinatura e chave de API ficam; os outros tipos saem');
});

test('os campos de várias contas não sobrevivem na conta', () => {
  const saida = normalizarConfig({
    accounts: [{ user: 'b', owners: ['biudtech'], label: 'Trabalho', color: '#fff', kind: 'trabalho', muted: false, claudeProfileId: 'y', budgetWeight: 2, autoReview: false, onCaveats: 'wait', onReject: 'wait', padroesRevisao: 'sem any' }],
  });
  assert.deepEqual(Object.keys(saida.conta).sort(), ['autoReview', 'onCaveats', 'onClean', 'onReject', 'owners', 'padroesRevisao', 'user']);
  assert.equal(saida.conta.autoReview, false);
  assert.equal(saida.conta.padroesRevisao, 'sem any');
});

test('todas as contas silenciadas: nenhuma vira a conta, e a que nascer da detecção não age', () => {
  const saida = normalizarConfig({ accounts: [{ user: 'a', muted: true }, { user: 'b', muted: true }] });
  assert.deepEqual(saida.conta, { user: '', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }, 'silenciada não agia: fica guardado, sem login, que a conta não age');
});

test('modo simples antigo: ghUser e owners viram a conta', () => {
  const saida = normalizarConfig({ ghUser: ' eu ', owners: ['biudtech', ' acme '] });
  // sem o marcador de esquema é config de antes da primeira migração: ressalvas e reprovação esperam você
  assert.deepEqual(saida.conta, { user: 'eu', owners: ['biudtech', 'acme'], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });
  assert.equal('ghUser' in saida, false);
  assert.equal('owners' in saida, false);
});

test('a conta já no formato novo vence a lista antiga', () => {
  const saida = normalizarConfig({
    conta: { user: 'nova', owners: ['biudtech'], onReject: 'wait' },
    accounts: [{ user: 'velha', owners: ['acme'] }],
    ghUser: 'mais-velha',
  });
  assert.equal(saida.conta.user, 'nova');
  assert.equal(saida.conta.onReject, 'wait');
  assert.equal('accounts' in saida, false);
});

test('conta com valor torto: só o que é do domínio entra', () => {
  const saida = normalizarConfig({ conta: { user: 'eu', owners: 'biudtech, acme', autoReview: 'sim', onClean: 'aprova', onCaveats: 'wait', padroesRevisao: 7 } });
  assert.deepEqual(saida.conta, { user: 'eu', owners: ['biudtech', 'acme'], onCaveats: 'wait' });
});

test('as chaves gerais antigas de política valem para a conta que não escolheu', () => {
  const comConta = normalizarConfig({ ghUser: 'eu', autoReview: false, autoApproveAll: false });
  assert.equal(comConta.conta.autoReview, false);
  assert.equal(comConta.conta.onCaveats, 'wait');
  assert.equal(comConta.conta.onReject, 'wait', 'reprovar sozinha nunca veio de chave geral');
  assert.equal('autoReview' in comConta, false);
  assert.equal('autoApproveAll' in comConta, false);
  // a instância de teste do guia ({"port": 47180, "autoReview": false}): ainda sem login, a
  // escolha fica guardada na conta e vale quando o gh for detectado
  const semLogin = normalizarConfig({ port: 47180, autoReview: false });
  assert.equal(semLogin.port, 47180);
  assert.deepEqual(semLogin.conta, { user: '', owners: [], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' });
});

test('conta gravada ainda sem login guarda a política até o gh ser detectado; sem política, não é conta', () => {
  const guardada = { user: '', owners: [], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
  assert.deepEqual(normalizarConfig({ port: 47180, conta: guardada }).conta, guardada, 'o segundo boot antes do login não perde a escolha');
  assert.equal('conta' in normalizarConfig({ conta: { user: '', owners: [] } }), false);
  const comLogin = normalizarConfig({ conta: guardada, ghUser: 'eu' }).conta;
  assert.equal(comLogin.user, 'eu', 'o login do modo simples vence a conta sem login');
  assert.equal(comLogin.autoReview, false, 'e a política guardada continua valendo para ele');
});

test('a escolha da própria conta vence a chave geral antiga', () => {
  const saida = normalizarConfig({ accounts: [{ user: 'eu', autoReview: true }], autoReview: false });
  assert.equal(saida.conta.autoReview, true);
});

test('preferências conhecidas atravessam como vieram', () => {
  const saida = normalizarConfig({ intervalSeconds: 600, port: 47180, reviewFast: true, instanciaIsoladaPosta: true, aguardarMergeavelParaRevisar: false });
  assert.deepEqual(saida, { intervalSeconds: 600, port: 47180, reviewFast: true, instanciaIsoladaPosta: true, aguardarMergeavelParaRevisar: false });
});

test('config vazia: objeto sem conta, e não lança', () => {
  const saida = normalizarConfig({});
  assert.deepEqual(saida, {});
  assert.equal('conta' in saida, false);
});

test('lixo no lugar da config devolve objeto vazio', () => {
  for (const lixo of ['lixo', null, undefined, 42, true, [], [{ ghUser: 'eu' }]]) {
    assert.deepEqual(normalizarConfig(lixo), {});
  }
});

test('lixo dentro da config não lança', () => {
  const saida = normalizarConfig({ accounts: 'a:b', claudeProfiles: 'x', conta: 'eu', owners: 9, ghUser: { a: 1 } });
  assert.equal('conta' in saida, false);
  assert.deepEqual(saida.claudeProfiles, []);
  assert.deepEqual(normalizarConfig({ esquemaConfig: 2, accounts: [null, 'x', { user: '  ' }, { user: 'ok' }] }).conta, { user: 'ok', owners: [] });
});

test('a tabela de preferências não conhece mais a lista de contas nem o modo simples', () => {
  const chaves = settings.SETTINGS.map((s) => s.key);
  for (const antiga of ['accounts', 'ghUser', 'owners', 'esquemaConfig']) assert.equal(chaves.includes(antiga), false, antiga);
  assert.equal(chaves.includes('conta'), true);
  assert.equal(settings.EDITAVEIS.has('conta'), false, 'a conta muda por operação (POST /api/accounts/edit), nunca pelo POST /api/settings');
});
