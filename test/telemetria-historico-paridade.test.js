// Os leitores do histórico de decisões devolvem o MESMO lendo o array do decisions.json (como
// antes do banco) e lendo o telemetria.db depois da importação (lote 2, 17/11/2026): o snapshot
// (as 30 recentes e a última ação de cada PR), GET /api/decisions (páginas, busca, veredito,
// repositório), GET /api/decision por chave, e as regras do motor que leem o histórico inteiro
// (a última ação usada pela re-revisão e pela contestação, as rodadas publicadas, a retirada do
// pedido de mudanças, a estimativa, a retomada, a manutenção do material, o destrave, a sessão
// anterior e os vistos). As regras recebem no banco só o recorte leve de cada decisão
// (CAMPOS_LEVES): o terceiro modo, o array só com esse recorte, prova que ele basta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-historico-paridade-'));
process.env.FAROL_HOME = FAROL_HOME;
process.env.TZ = 'America/Sao_Paulo';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { TELEMETRIA_DB } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const tabela = await import('../lib/telemetria/historico.js');
const { importarHistorico } = await import('../lib/telemetria/migracao.js');
const { colunasDaBusca } = await import('../lib/engine/busca-do-historico.js');
const { historico, HIST_LIMIT } = await import('../lib/engine/historico-decisoes.js');
const { historicoPaginado } = await import('../lib/engine/historico-paginado.js');
const { snapshotDecisions, snapshotReviewActions } = await import('../lib/engine/snapshot-decisions.js');
const decisionMod = (await import('../lib/engine/decision.js')).default;
const { tempoTipico, anotarEstimativa } = await import('../lib/engine/estimativa-sessao.js');
const { concluidaDepois } = await import('../lib/engine/retomada-duravel.js');
const { publishedCriteriaParents } = await import('../lib/engine/review-criteria-history.js');
const { materialReferenceState } = await import('../lib/technical-review/material-session-proof.js');
const { temPedidoAutomatico } = await import('../lib/engine/retirada-de-pedido.js');
const { candidatosDestrave } = await import('../lib/engine/destrava.js');
const { lastReviewSessionId } = await import('../lib/engine/review.js');
const { ordenado } = await import('../tools/comparar-consumo-sqlite.js');
const { safeStringify } = await import('../lib/io.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const SHA = (n) => String(n % 16).repeat(40).slice(0, 39) + (n % 10);
const REPOS = ['acme/app', 'Acme/App', 'acme/Ção-api', ' acme/espacos ', 'outra/lib'];
const STATUS = ['auto_approved', 'auto_rejected', 'posted', 'already_reviewed', 'commented_own_pr', 'skipped', 'superseded', 'approval_not_needed', 'already_merged'];
const ACOES = ['approve', 'request_changes', 'comment', 'skip', undefined, 'outro'];
const TITULOS = ['Correção de ação', 'Ajuste — hífen', 'PROJ-9 entrega', 42, { x: 1 }, 'Ｔítulo largo', 'emoji 🚀 sim'];

// Um histórico de 320 decisões com a variedade do real e com o torto do registro antigo.
function historicoSintetico() {
  const lista = [];
  let semente = 11;
  const rnd = (n) => { semente = (semente * 48271) % 2147483647; return semente % n; };
  for (let i = 0; i < 320; i++) {
    const repo = REPOS[rnd(REPOS.length)];
    const number = rnd(25);
    const status = STATUS[rnd(STATUS.length)];
    const d = {
      id: `d${1786454890000 + i}${rnd(1000)}`, createdAt: 1786454890000 + i * 1000, resolvedAt: 1786454890500 + i * 1000,
      pr: { repo, number, url: `https://github.com/${repo}/pull/${number}`, title: TITULOS[rnd(TITULOS.length)], author: rnd(3) ? 'ana-dev' : 'João', account: rnd(4) ? 'revisora' : 'Outra', isDraft: false },
      key: `${repo.trim()}#${number}`, headSha: rnd(6) ? SHA(i) : '', card: [null, `PROJ-${i}`, { key: `CARD-${i}` }, `BT_${i}`][rnd(4)],
      cardMet: [true, false, undefined][rnd(3)], sessionId: rnd(3) ? `s-${i}` : null, verdict: ['approve', 'request_changes', 'comment'][rnd(3)],
      reasons: rnd(3) ? [] : [{ text: 'motivo', kind: 'gate' }], attention: rnd(4) ? [] : ['ponto'], reportMarkdown: `relatório ${i}`,
      reviewMarkdown: `revisão ${i}`, inventarioDiff: { arquivos: Array.from({ length: rnd(5) }, (_, k) => `a${k}.js`) },
      roundId: rnd(2) ? `r-${i}` : null, postRetry: rnd(8) ? null : { event: 'approve', attempts: 1 },
      stages: rnd(5) ? { totalMs: 30000 + rnd(400000), arquivos: rnd(60) } : null, status, action: ACOES[rnd(ACOES.length)],
    };
    if (!rnd(15)) d.retiradaPendente = { tipo: 'rodada', head: d.headSha, tentativas: 0 };
    if (!rnd(40)) delete d.action;
    lista.unshift(d);
  }
  // registro antigo: título com surrogate solto (o SQL não compara igual) entra só no fim do teste
  return JSON.parse(JSON.stringify(lista));
}

const RESOLVIDAS = historicoSintetico();
const PENDENTES = [{ id: 'p1', createdAt: 1786460000000, key: 'acme/app#3', status: 'pending', pr: { repo: 'acme/app', number: 3 }, headSha: SHA(3) }];

function base(resolved) {
  return {
    decisions: { pending: structuredClone(PENDENTES), resolved }, panorama: [{ key: 'outra/lib#4', updatedAt: '2099-01-01T00:00:00Z' }, { key: 'acme/app#7', updatedAt: '2099-01-01T00:00:00Z' }],
    queue: [{ key: 'acme/Ção-api#2' }], activeReviews: new Map([['x', {}]]), headlessQueue: [], retomadas: new Map(), autoReviewParked: new Set(),
    retryAfterNet: new Set(), mineKeys: new Set(REPOS.flatMap((r) => Array.from({ length: 25 }, (_, n) => `${r.trim()}#${n}`))), destravados: {},
    accountForPr: () => 'revisora', log: () => {},
  };
}
base.seen = (e) => { e.seen = new Set(e.mineKeys); return e; };

let contador = 0;
function noBanco(resolved) {
  const caminho = path.join(FAROL_HOME, `paridade-${contador++}.db`);
  const h = banco.abrirBanco(caminho);
  const r = importarHistorico(h, resolved, { colunasDaBusca, teto: HIST_LIMIT });
  assert.equal(r.ok, true, r.motivo);
  // leitura que falhou no banco cai no vazio com um WARN: o aviso guardado reprova a paridade
  const avisos = [];
  return base.seen(Object.assign(base([]), { telemetria: h, historicoNoBanco: true, avisos, log: (nivel, msg) => avisos.push(`${nivel} ${msg}`) }));
}
const modos = (resolved = RESOLVIDAS) => ({
  json: base.seen(base(structuredClone(resolved))),
  leve: base.seen(base(structuredClone(resolved).map(tabela.leveDe))),
  banco: noBanco(resolved),
});

const igual = (a, b, msg) => assert.equal(safeStringify(ordenado(a)), safeStringify(ordenado(b)), msg);

function conferirLeitores(m) {
  const keys = [...new Set(RESOLVIDAS.map((d) => d.key))].slice(0, 12).concat(['nao/existe#1', '']);
  const leitores = {
    reviewActions: (e) => decisionMod.reviewActions(e),
    snapshotReviewActions: (e) => snapshotReviewActions(e),
    estimativa: (e) => [5, 30, 0, undefined].map((n) => tempoTipico(historico(e).leves(), n)),
    anotarEstimativa: (e) => { anotarEstimativa(e, 'x', { changedFiles: 12 }); return e.activeReviews.get('x'); },
    retomada: (e) => keys.map((key) => concluidaDepois(e, { key, knownHead: SHA(3), atualizadoEm: '2026-08-01T00:00:00Z' })),
    rodadasPublicadas: (e) => publishedCriteriaParents(RESOLVIDAS.map((d) => ({ id: d.roundId, parents: [] })).filter((r) => r.id), { resolved: historico(e).leves() }).map((r) => r.id),
    material: (e) => RESOLVIDAS.slice(0, 40).map((d) => materialReferenceState(e, { owner: {}, createdAt: 0, context: { prKey: d.key, repo: d.pr.repo, account: d.pr.account, head: d.headSha } })),
    retirada: (e) => keys.flatMap((key) => [temPedidoAutomatico(e, { key }, ''), temPedidoAutomatico(e, { key }, SHA(3), { mesmoCommit: true })]),
    destrave: (e) => candidatosDestrave(e, new Set()),
    sessaoAnterior: (e) => keys.map((key) => lastReviewSessionId(e, key)),
    vistos: (e) => historico(e).leves().map((d) => d.key),
    retiradasPendentes: (e) => historico(e).comRetiradaPendente().map((d) => d.id),
  };
  for (const [nome, ler] of Object.entries(leitores)) {
    const esperado = ler(m.json);
    igual(ler(m.leve), esperado, `${nome}: o recorte leve basta`);
    igual(ler(m.banco), esperado, `${nome}: banco igual ao arquivo`);
  }
  assert.deepEqual(m.banco.avisos, []);
}

function conferirRotas(m) {
  const keys = [...new Set(RESOLVIDAS.map((d) => d.key))].concat(['nao/existe#1', '', ' acme/app#3']);
  for (const key of keys) igual(decisionMod.decisionByKey(m.banco, key), decisionMod.decisionByKey(m.json, key), `GET /api/decision ${key}`);
  igual(snapshotDecisions(m.banco), snapshotDecisions(m.json), 'snapshot decisions');
  const consultas = [''];
  for (const page of ['1', '2', '3', '11', '99']) for (const pageSize of ['', '7', '100']) consultas.push(new URLSearchParams({ page, ...(pageSize && { pageSize }) }).toString());
  for (const q of ['acao', 'AÇÃO', 'proj-9', 'PROJ-9 entrega', 'card-1', 'bt_3', 'joao', 'acme/app#3', '#3', '-', '🚀', 'ｔitulo', 'ana dev', 'nada-disso', 'ção-api'])
    for (const veredito of ['', 'approve', 'request_changes', 'comment', 'skip']) consultas.push(new URLSearchParams({ q, ...(veredito && { veredito }) }).toString());
  for (const repo of ['acme/app', 'ACME/APP', 'acme/espacos', '  outra/lib ', 'acme/ção-api', 'nao/existe'])
    for (const veredito of ['', 'skip', 'approve']) consultas.push(new URLSearchParams({ repo, ...(veredito && { veredito }), page: '2', pageSize: '5' }).toString());
  consultas.push('q=acme&repo=acme/app&veredito=approve&page=2&pageSize=3', 'page=0', 'veredito=nao', 'q=a&q=b');
  for (const c of consultas) {
    const p = new URLSearchParams(c);
    igual(historicoPaginado(m.banco, p), historicoPaginado(m.json, p), `GET /api/decisions?${c}`);
  }
  assert.deepEqual(m.banco.avisos, []);
  return consultas.length;
}

test('o recorte leve é estável: a importação grava o leve de cada decisão e a volta é a decisão inteira', () => {
  const m = modos();
  assert.deepEqual(historico(m.banco).todas(), RESOLVIDAS);
  assert.deepEqual(historico(m.banco).leves(), RESOLVIDAS.map(tabela.leveDe));
  assert.deepEqual(historico(m.banco).recentes(30), RESOLVIDAS.slice(0, 30));
  assert.deepEqual(historico(m.banco).recentes(45), RESOLVIDAS.slice(0, 45));
});

test('as regras do motor que leem o histórico devolvem o mesmo no arquivo, no recorte leve e no banco', () => {
  conferirLeitores(modos());
});

test('GET /api/decision, a chave decisions do snapshot e GET /api/decisions devolvem o mesmo JSON no arquivo e no banco', () => {
  const n = conferirRotas(modos());
  assert.ok(n > 100);
});

test('com a fila do decisions.json por cima do banco (escrita recusada), as leituras continuam iguais às do arquivo', () => {
  const [novas, velhas] = [RESOLVIDAS.slice(0, 6), RESOLVIDAS.slice(6)];
  const m = modos(velhas);
  m.banco.decisions.resolved = structuredClone(novas);
  m.json = base.seen(base(structuredClone(RESOLVIDAS)));
  m.leve = base.seen(base(structuredClone(RESOLVIDAS).map(tabela.leveDe)));
  conferirLeitores(m);
  conferirRotas(m);
});

test('linha torta (texto que o SQL não compara igual) faz a página sair pela lista, com o mesmo resultado', () => {
  const tortas = structuredClone(RESOLVIDAS);
  tortas[3].pr.title = 'título \ud800 solto';
  tortas[8].pr.repo = 'acme/\u0000nulo';
  const m = modos(tortas);
  for (const c of ['q=solto', 'q=titulo', 'repo=acme/app', 'veredito=skip&page=2', 'q=nulo']) {
    const p = new URLSearchParams(c);
    igual(historicoPaginado(m.banco, p), historicoPaginado(m.json, p), c);
  }
  igual(historicoPaginado(m.banco, new URLSearchParams('q=%00a')), historicoPaginado(m.json, new URLSearchParams('q=%00a')), 'termo com nulo');
});

test('a consulta paginada no banco usa as colunas: o SQL sozinho dá o mesmo total da lista', () => {
  const m = modos();
  const h = m.banco.telemetria;
  const { total } = tabela.paginaDeDecisoes(h, { termos: ['acme'], veredito: 'skip', repoDobrado: 'acme/app', publicados: ['approve', 'request_changes', 'comment'] }, { limite: 5, offset: 0 });
  const r = historicoPaginado(m.json, new URLSearchParams('q=acme&veredito=skip&repo=acme/app'));
  assert.equal(total, r.body.total);
  assert.equal(tabela.temTorta(h), false);
  assert.equal(fs.existsSync(TELEMETRIA_DB), false, 'nenhum teste daqui toca o banco do FAROL_HOME');
});
