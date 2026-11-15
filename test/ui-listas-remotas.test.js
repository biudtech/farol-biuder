// As listas de outros aparelhos na tela de verdade: o ui/app.js carregado contra
// o DOM de mentira (test/helpers/dom-stub.js), no padrão de test/ui-radar-compartilhado.
//
// Prova que o bootstrap entrega `sync-lists` à tela, que a tela busca a projeção ao abrir,
// e que a falha da leitura do andamento é dita.
// Não prova visual, CSS nem clique real: isso é a jornada no app.
process.env.TZ = 'America/Sao_Paulo';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { instalarDom } from './helpers/dom-stub.js';
import { controlarQuadros } from './helpers/quadros-ui.js';

const { emitir: receber } = instalarDom();
const quadros = controlarQuadros();
function emitir(...args) { const n = receber(...args); quadros.pintar(); return n; }

const PEDIDOS = [];
let RESPOSTAS = {};
globalThis.fetch = async (url, init = {}) => {
  const corpo = init.body ? JSON.parse(init.body) : null;
  PEDIDOS.push({ url: String(url), corpo });
  const r = RESPOSTAS[String(url)];
  const valor = typeof r === 'function' ? r(corpo) : r;
  return { ok: true, status: 200, json: async () => (valor === undefined ? {} : valor), text: async () => '' };
};

await import('../ui/app.js');
const Est = await import('../ui/telas/estado.js');
const { switchRadarSub } = await import('../ui/telas/radar.js');
const $ = (s) => document.querySelector(s);
const esperar = () => new Promise((r) => setTimeout(r, 0)).then(() => quadros.pintar());

const CONTAS = [{ user: 'alice', owners: ['acme'] }, { user: 'bob', owners: ['beta'] }];

function estado({ sync = {} } = {}) {
  return {
    app: { name: 'Farol', version: '2.59.7', platform: 'win32' },
    status: 'ocioso', account: { user: 'alice', tokenOk: true },
    accounts: CONTAS,
    config: { ghUser: 'alice', owners: ['acme'], accounts: CONTAS, intervalSeconds: 300, sync: {}, people: {}, claudeProfiles: [] },
    lastCheckAt: Date.now(), nextCheckAt: Date.now() + 60000,
    queue: [], decisions: { pending: [], resolved: [] },
    activeSessions: [], headlessWaiting: [], reviewActions: {},
    usage: {}, usageSessions: [], pushbacks: {}, team: [], update: { state: 'idle' },
    paths: { home: '/tmp/.farol', workspace: '/tmp/.farol/workspace' },
    // Task 9 (28/09/2026): as seções da frota (o andamento remoto, aqui) só pintam pro
    // admin. Este arquivo testa a FORMATAÇÃO do andamento, não o controle de acesso (que é
    // de ui-radar-compartilhado.test.js), então o padrão nasce admin de si mesmo.
    sync: { enabled: true, shared: true, bloqueioCompartilhamento: '', deviceId: 'dB', devices: [{ deviceId: 'dA', name: 'Notebook' }], paineis: { aparelhos: [{ deviceId: 'dA', abriu: true, aceitarAdmin: true, contas: [] }] }, distribuicao: { modo: '', esperando: [] }, comandosEmitidos: [], tomadasSofridas: [], admin: { deviceId: 'dB', generation: 1, souEu: true, fresca: true }, ...sync },
  };
}

function linha(key, account, extra = {}) {
  return { key, url: '', title: `Título ${key}`, author: 'ana', repo: key.split('#')[0], number: Number(key.split('#')[1]), isDraft: false, u: Date.now() - 1000, account, somenteLeitura: false, ...extra };
}

function escopo(tipo, account, linhas, extra = {}) {
  return { tipo, account, dev: 'dA', aparelho: 'Notebook', estado: 'ok', lidoEm: Date.now(), falhaEm: 0, confirmadoAte: Date.now() + 600000, naoAbriram: 0, linhas, ...extra };
}

function projecao(escopos, extra = {}) {
  return { ok: true, estado: 'ligada', limiteMs: 180000, escopos, ...extra };
}

const PROJ = projecao([
  escopo('panorama', 'alice', [linha('acme/app#1', 'alice'), linha('acme/app#2', 'alice')]),
  escopo('panorama', 'bob', [linha('beta/api#5', 'bob')]),
]);

beforeEach(() => {
  switchRadarSub('apar');
  PEDIDOS.length = 0;
  RESPOSTAS = {};
  Est.definirEscopo('all');
});

test('ao abrir com a visão valendo, a tela busca a projeção das listas uma vez', async () => {
  RESPOSTAS['/api/sync/lists'] = PROJ;
  emitir('state', estado());
  emitir('state', estado());
  await esperar();
  const pedidos = PEDIDOS.filter((p) => p.url === '/api/sync/lists');
  assert.equal(pedidos.length, 1, 'uma busca só, não uma por snapshot');
  assert.deepEqual(pedidos[0].corpo, {});
});

test('sync-live com falha diz que a leitura falhou e mantém o andamento', () => {
  emitir('state', estado());
  const op = { opId: 'op1', dev: 'dA', aparelho: 'Notebook', etapa: 'leitura', msPorEtapa: {}, subagentes: [], tipo: 'review', prTag: 'a'.repeat(32) };
  emitir('sync-live', { operacoes: [op] });
  switchRadarSub('apar'); // o painel oculto só pinta ao ser aberto
  assert.doesNotMatch($('#aparPagina').innerHTML, /falhou/);
  emitir('sync-live', { operacoes: [op], falhaEm: Date.now() });
  switchRadarSub('apar'); // o painel oculto só pinta ao ser aberto
  assert.match($('#aparPagina').innerHTML, /A última leitura falhou/);
  switchRadarSub('apar'); // o painel oculto só pinta ao ser aberto
  assert.match($('#aparPagina').innerHTML, /fila-item/, 'o andamento anterior continua');
  emitir('sync-live', { operacoes: [op] });
  switchRadarSub('apar'); // o painel oculto só pinta ao ser aberto
  assert.doesNotMatch($('#aparPagina').innerHTML, /A última leitura falhou/, 'leitura boa limpa o aviso');
});

test('lista de revisões que falhou no banco aparece como falha, com o motivo', async () => {
  RESPOSTAS['/api/sync/reviews'] = { ok: false, code: 'indisponivel', motivo: 'não deu para ler as revisões dos aparelhos agora' };
  const Tela = await import('../ui/telas/radar-compartilhado.js');
  emitir('state', estado());
  await Tela.buscarRevisoes();
  assert.match($('#mdRevisoes').innerHTML, /A busca das revisões falhou/);
  assert.doesNotMatch($('#mdRevisoes').innerHTML, /Nenhuma revisão compartilhada/);
});

test('o bootstrap só repassa: connect() entrega sync-lists à tela', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
  const ini = fonte.indexOf('function connect()');
  const fim = fonte.indexOf('\n}\n', ini);
  const corpo = fonte.slice(ini, fim);
  assert.match(corpo, /addEventListener\('sync-lists', \(e\) => \{\s*const d = safeJsonParse\(e\.data\); if \(!d\) return;\s*aoListasRemotas\(d\);\s*\}\)/);
});

function comRelogio(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test('com a projeção já na tela, passar do piso não repete a busca', () => {
  emitir('sync-lists', PROJ);
  PEDIDOS.length = 0;
  comRelogio(Date.now() + 10 * 60000, () => emitir('state', estado()));
  assert.equal(PEDIDOS.filter((p) => p.url === '/api/sync/lists').length, 0, 'quem já tem a projeção acompanha pelo evento');
});

test('a falha do andamento mostra a hora da última leitura BOA, não a da falha', () => {
  const T0 = Date.UTC(2026, 8, 16, 13, 0, 0);
  const op = { opId: 'op9', dev: 'dA', aparelho: 'Notebook', etapa: 'leitura', msPorEtapa: {}, subagentes: [], tipo: 'review', prTag: 'a'.repeat(32) };
  comRelogio(T0, () => { emitir('state', estado()); emitir('sync-live', { operacoes: [op] }); });
  comRelogio(T0 + 5 * 60000, () => emitir('sync-live', { operacoes: [op], falhaEm: T0 + 5 * 60000 }));
  switchRadarSub('apar'); // o painel oculto só pinta ao ser aberto
  const html = $('#aparPagina').innerHTML;
  assert.match(html, /falhou às 10:05/);
  assert.match(html, /Mostrando o andamento de 10:00/);
});

test('sync-lists chega pelo bootstrap', () => {
  assert.equal(emitir('sync-lists', PROJ), 1, 'o bootstrap escuta sync-lists');
});

test('os contêineres remotos de Meus PRs e do Panorama saíram do HTML', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.equal(html.includes('id="rpane-meus"'), false);
  assert.equal(html.includes('Remoto"'), false, 'nenhum contêiner de lista remota sobrou');
  assert.equal(html.includes('id="panoramaRemoto"'), false);
});
