// A Expandida do Radar (07/11/2026): os cards de sempre. A preferência é gravada antes de
// carregar o app, como a tela faz ao reabrir; a Compacta tem a trava própria em
// test/ui-densidade.test.js. A faixa de três pílulas (prontidão) saiu no corte da fase 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';

const { doc, emitir, listeners } = instalarDom();
globalThis.localStorage.setItem('farol-densidade', 'expandida');
const quadros = controlarQuadros();
await import('../ui/app.js');
for (let i = 0; i < 50 && !listeners.has('state'); i++) await new Promise(resolve => setTimeout(resolve, 1));
const $ = selector => doc.querySelector(selector);
const { switchRadarSub } = await import('../ui/telas/radar.js');

const pedido = { key: 'acme/app#1', repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', account: 'alice', title: 'Corrige o filtro', author: 'autora', mine: true, updatedAt: new Date().toISOString() };
const meu = { key: 'acme/app#2', repo: 'acme/app', number: 2, url: 'https://github.com/acme/app/pull/2', account: 'alice', title: 'Meu PR', author: 'alice', updatedAt: new Date().toISOString() };

function snapshot() {
  return { app: { platform: 'win32', version: 'fixture' }, status: 'idle', account: { user: 'alice', tokenOk: true },
    accounts: [{ user: 'alice', owners: ['acme'], tokenOk: true }],
    config: { accounts: [], intervalSeconds: 300, parallelReviews: 1, people: {}, claudeProfiles: [], theme: 'dark' },
    lastCheckAt: Date.now(), queue: [pedido], myPRs: [meu], hiddenPRs: [],
    decisions: { pending: [], resolved: [{ key: 'acme/app#9', resolvedAt: Date.now(), status: 'auto_approved', action: 'approve', verdict: 'approve', pr: { title: 'x' } }] },
    activeSessions: [], activity: {}, selfAnalyses: {}, headlessWaiting: [], usage: {},
    paths: { home: '/fixture', workspace: '/fixture/workspace' } };
}
function receber(snap, sub = 'mim') { switchRadarSub(sub); emitir('state', snap); quadros.pintar(); }

test('a preferência gravada vale ao reabrir: Expandida', () => {
  receber(snapshot());
  assert.equal(doc.body.dataset.densidade, 'expandida');
});

test('Pra mim na Expandida: o card da fila de sempre, sem a faixa de pílulas e sem a seta', () => {
  receber(snapshot());
  const html = $('#queue').innerHTML;
  assert.match(html, /class="card pr-card/);
  assert.doesNotMatch(html, /pron-pill|pron-faixa/, 'a faixa de prontidão saiu');
  assert.doesNotMatch(html, /pron-seta/, 'na Expandida não há linha para recolher');
  assert.match($('#resolved').innerHTML, /acme\/app#9/, 'Revisões recentes aberta');
});

test('Meus PRs na Expandida: o card de hoje, sem a faixa de prontidão', () => {
  receber(snapshot(), 'meus');
  const html = $('#myPRs').innerHTML;
  assert.match(html, /class="card mypr-card/);
  assert.doesNotMatch(html, /pron-b-|data-pron-pilula/);
});
