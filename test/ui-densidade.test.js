// A Compacta é a densidade padrão do Radar (07/11/2026): Pra mim e Meus PRs viram uma linha
// por PR, e o card cheio só abre pela seta. Este teste carrega o app de verdade no DOM de
// mentira com um estado plausível e confere o que cada lista desenhou. A Expandida (os cards
// de sempre) é o que as travas antigas da fila e das decisões leem, com a preferência gravada
// antes de carregar o app. A faixa de prontidão e o Panorama saíram no corte da fase 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';

const { doc, emitir, listeners } = instalarDom();
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

test('a Compacta é a padrão e marca o corpo da página', () => {
  receber(snapshot());
  assert.equal(doc.body.dataset.densidade, 'compacta');
});

test('Pra mim na Compacta: a fila vira linha com a frase e o Revisar', () => {
  receber(snapshot());
  const html = $('#queue').innerHTML;
  assert.match(html, /class="pr-linha fila-linha/);
  assert.match(html, /1º na fila/);
  assert.match(html, /class="btn primary sm act-review"/);
  assert.match(html, /data-linha="acme\/app#1"/, 'a seta abre o card cheio só deste PR');
  assert.doesNotMatch(html, /class="card pr-card/);
  assert.doesNotMatch(html, /pron-trio|pron-mini/, 'a forma curta da prontidão saiu');
});

test('Pra mim: o resumo do topo leva às seções, e Revisões recentes vira uma linha', () => {
  receber(snapshot());
  assert.match($('#praMimResumo').innerHTML, /1 na fila/);
  assert.match($('#praMimResumo').innerHTML, /1 resolvida hoje/);
  assert.equal($('#praMimResumo').hidden, false);
  assert.match($('#resolved').innerHTML, /data-recentes-alternar/);
  assert.match($('#resolved').innerHTML, /1 resolvida hoje · mostrar/);
});

test('o PR que saiu da fila e espera vaga vira linha na fila de execução, só se foi pedido à conta', () => {
  const snap = snapshot();
  const esperando = { key: 'acme/app#5', repo: 'acme/app', number: 5, url: 'https://github.com/acme/app/pull/5', account: 'alice', title: 'Na espera', author: 'autora', updatedAt: new Date().toISOString() };
  snap.headlessWaiting = ['acme/app#5'];
  snap.headlessWaitingContas = { 'acme/app#5': 'alice' };
  snap.headlessWaitingPrs = [esperando];
  receber(snap);
  const html = $('#queue').innerHTML;
  assert.match(html, /data-key="acme\/app#5"/);
  assert.match(html, /Na fila de execução/);
});

test('Meus PRs na Compacta: linha sem a faixa de prontidão e o Merge só pela regra atual', () => {
  receber(snapshot(), 'meus');
  const html = $('#myPRs').innerHTML;
  assert.match(html, /class="pr-linha mypr-linha/);
  assert.doesNotMatch(html, /pron-b-|pron-trio/, 'sem a prontidão, a barra só vem do selo da autoanálise');
  assert.doesNotMatch(html, /act-self-merge/, 'sem autoanálise elegível o Merge não aparece');
});

test('o Radar não tem mais o Panorama nem a faixa de prontidão', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.doesNotMatch(index, /rsub-pano|rpane-pano|id="panorama"|id="silenced"|myPRsResumo|reviewLabels/);
  assert.equal(snapshot().panorama, undefined);
});

test('o seletor de densidade fica ao lado das sub-abas, e a preferência é local e protegida', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.match(index, /<div class="radar-topo">\s*<div class="radar-subs" id="radarSubs"/);
  assert.match(index, /id="densidade" role="group" aria-label="Densidade da lista"/);
  assert.match(index, /data-densidade="compacta" aria-pressed="true"/);
  assert.match(index, /data-densidade="expandida" aria-pressed="false"/);
  const tela = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', 'densidade.js'), 'utf8');
  assert.match(tela, /try \{ DENSIDADE = densidadeValida\(localStorage\.getItem\(CHAVE\)\); \} catch/);
  assert.match(tela, /try \{ localStorage\.setItem\(CHAVE, DENSIDADE\); \} catch/);
});
