// O caso real do sync por herança, na forma do engine-ai#1489 (24/11/2026): contra a base no momento
// do merge, 55 herdados e 10 a ler antes da regra de dependência; com ela (o grafo inteiro, o esquema
// do Prisma misturado e o barril fora do diff), 45 e 20. Contra a ponta atual da development seriam
// 24 e 41, e é por isso que a régua é o primeiro pai do merge.
import { criteriaFixture } from './helpers/criteria-fixture.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-1489-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const { FOTO, P1, HEAD_DO_SYNC: HEAD, respostaDoSync } = await import('./helpers/github-do-sync.js');
const { casoEngineAi1489 } = await import('./fixtures/sync-engine-ai-1489.js');
const runReal = io.run;
let envios = [];
let caso;
io.run = async (_cmd, args) => {
  const doSync = respostaDoSync(caso.cenario, args);
  if (doSync) return doSync;
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub)) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { sourceRuntime } = await import('../lib/engine/analysis-source.js');
const { separarHerdados } = await import('../lib/engine/sync-por-heranca.js');

const originalSource = { ...sourceRuntime };
after(() => { io.run = runReal; try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
afterEach(() => { Object.assign(sourceRuntime, originalSource); });
beforeEach(() => {
  envios = [];
  // cada teste é a primeira rodada do PR: a prova da rodada anterior no mesmo head faria o
  // relançamento revisar cheio, sem o sync
  fs.rmSync(path.join(FAROL_HOME, 'workspace', 'state', 'file-proof'), { recursive: true, force: true });
  caso = casoEngineAi1489();
  const { arquivos, cenario, BASE_PONTA, mapa } = caso;
  const reader = { tree: async () => ({ complete: true, entries: [{ path: 'package.json', type: 'blob' }] }),
    read: async (p) => (p === 'package.json' ? { status: 'available', text: caso.packageJson } : { status: 'unavailable' }) };
  sourceRuntime.prepareSources = async () => ({ status: 'complete', reader,
    manifest: { H: HEAD, B: BASE_PONTA, M: 'a'.repeat(40), files: arquivos, limitations: [] },
    inventory: { status: 'complete', headSha: HEAD, baseSha: BASE_PONTA, files: arquivos, changedFiles: arquivos.length, additions: 65, deletions: 65 },
    release: async () => {} });
  sourceRuntime.buildMap = async () => ({ complete: true, head: mapa, previous: { files: [], relations: [], unresolved: [] } });
  cenario.chamadas.length = 0;
});

const semRelacoes = (mapa) => ({ ...mapa, relations: [], unresolved: [] });
const PR = { key: 'biudtech/engine-ai#1489', repo: 'biudtech/engine-ai', number: 1489, url: 'https://github.com/biudtech/engine-ai/pull/1489',
  title: 'sync da homologation na development', author: 'dev', requested: true };
const decisao = (e) => [...e.decisions.pending, ...decisoesResolvidas(e)].find((d) => d.key === PR.key);

function motor({ sessao = 'approve', achado } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['biudtech'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.logs = [];
  e.log = (nivel, texto) => e.logs.push(`${nivel} ${texto}`);
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.prEstadoELabels = async () => ({ estado: 'OPEN', labels: [] });
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: HEAD, quem: [], decisivos: [] });
  e.bloqueadoPorChecks = async () => ({ faltando: [], herdados: [], verifiedHead: HEAD });
  e.myReviewStates = async () => [];
  e.prompts = [];
  e.runClaudeStream = async (prompt) => {
    e.prompts.push(prompt);
    const aLer = separarHerdados({ arquivos: caso.arquivos, diferemDaFoto: caso.diferemDaFoto, mexidosNaBase: caso.mexidosNaBase, bloqueados: new Set(), mapa: caso.mapa, pacotes: caso.pacotes }).aLer;
    const alcance = aLer.filter((p) => p.endsWith('.ts')).map((alterado) => ({ alterado, chamadores: [], semChamador: 'sem uso fora do diff nesta fixture' }));
    const findings = achado ? [{ severity: 'blocking', causa: 'defeito_codigo', file: achado, line: 1, title: 'Migração sem índice',
      summary: 'A resolução do conflito tirou o índice da tabela.', evidence: 'prisma/schema.prisma:1',
      criteria: { key: 'indice-do-schema', criterion: 'O índice da tabela continua no schema', source: 'prisma/schema.prisma:1', scope: 'Este diff' } }] : [];
    const reprova = sessao === 'request_changes';
    return { text: JSON.stringify({
      protocolo: { prReviewer: 'rodou' }, ...criteriaFixture(sessao), analysisStatus: 'complete', verdict: sessao,
      decision: reprova ? 'request_changes' : 'needs_decision', cardMet: true, reasons: [], findings,
      coverage: { total: 65, reviewed: aLer, missing: [] }, alcance,
      payloads: { approve: { event: 'APPROVE', body: 'Li os arquivos que o sync mudou; sem bloqueios.' },
        request_changes: { event: 'REQUEST_CHANGES', body: 'A resolução do conflito no schema tirou o índice da tabela; reponha antes do merge.' } },
      reportMarkdown: '# ok' }), sessionId: 's1' };
  };
  return e;
}

async function revisar(opcoes) {
  const e = motor(opcoes);
  await e.runHeadlessReview({ ...PR });
  return e;
}

test('contra a base no momento do merge: 55 herdados e 10 a ler, antes da dependência', () => {
  const { arquivos, diferemDaFoto, mexidosNaBase, mapa } = caso;
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados: new Set(), mapa: semRelacoes(mapa) });
  assert.deepEqual([r.herdados.length, r.aLer.length], [55, 10]);
});

test('contra a ponta atual da development seriam 24 e 41', () => {
  const { arquivos, diferemDaFoto, mexidosDesdeAPonta, mapa } = caso;
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase: mexidosDesdeAPonta, bloqueados: new Set(), mapa: semRelacoes(mapa) });
  assert.deepEqual([r.herdados.length, r.aLer.length], [24, 41]);
});

test('com a regra de dependência por cima: 45 herdados e 20 a ler', () => {
  const { arquivos, diferemDaFoto, mexidosNaBase, mapa, pacotes, GUARDA, PAINEL, REPOSITORIOS_PRISMA, SERVICO_DO_PRISMA, PELO_BARRIL } = caso;
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados: new Set(), mapa, pacotes });
  assert.deepEqual([r.herdados.length, r.aLer.length], [45, 20]);
  for (const p of [GUARDA, PAINEL, ...REPOSITORIOS_PRISMA, SERVICO_DO_PRISMA, PELO_BARRIL]) assert.ok(r.aLer.includes(p), p);
  const semPacotes = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados: new Set(), mapa, pacotes: null });
  assert.equal(semPacotes.herdados.filter((p) => p.endsWith('.ts')).length, 0, 'sem package.json legível, o código com import de pacote volta');
});

test('a revisão inteira: a sessão lê 20, o motor cobre 45, aprovação limpa com o caminho do sync', async () => {
  const e = await revisar();
  assert.equal(e.prompts.length, 1);
  assert.match(e.prompts[0], /ALTERADOS desde a leitura anterior \(20\)/);
  assert.match(e.prompts[0], /Arquivos herdados do sync \(45\)/);
  const d = decisao(e);
  assert.equal(d.status, 'auto_approved', JSON.stringify(d.reasons));
  assert.equal(d.caminho, 'sync_por_heranca');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 45, lidos: 20 });
  assert.equal(d.inventarioDiff.files.length, 65);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.ok(caso.cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${P1}`)));
  assert.ok(!caso.cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${caso.BASE_PONTA}`)), 'nunca a ponta atual da base');
});

test('com defeito num arquivo lido: a reprovação de sempre', async () => {
  const e = await revisar({ sessao: 'request_changes', achado: 'prisma/schema.prisma' });
  assert.equal(decisao(e).status, 'auto_rejected', JSON.stringify(decisao(e).reasons));
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
  assert.match(e.prompts[0], /Arquivos herdados do sync \(45\)/, 'a rodada mediu o sync');
});
