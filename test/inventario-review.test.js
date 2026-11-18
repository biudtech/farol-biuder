import { criteriaFixture } from './helpers/criteria-fixture.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-inventario-review-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const realInventory = Engine.prototype.fetchPrInventory;
const io = (await import('../lib/io.js')).default;
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
const restoreTool = isolateTechnicalTool();
const realRun = io.run;
after(() => { restoreTool(); io.run = realRun; fs.rmSync(home, { recursive: true, force: true }); });

const HEAD = 'a'.repeat(40);
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true, author: 'dev' };
const FILES = Array.from({ length: 132 }, (_, i) => ({ path: `src/f${i}.ts`, sha: `blob${i}`, status: 'modified', lines: 10 }));

function motor(verdict, { partial = false, moved = false, fail = false, coverage = true, extra = {}, changedFiles = 132 } = {}) {
  let snapshots = 0;
  const queries = [];
  io.run = async (_cmd, args) => {
    queries.push(args.join(' '));
    if (args[1] === 'repos/o/r/pulls/1') {
      snapshots++;
      return { ok: !fail, stdout: JSON.stringify({ headSha: moved && snapshots > 1 ? 'c'.repeat(40) : HEAD, baseSha: 'b'.repeat(40), changedFiles }) };
    }
    if (args[1] === 'repos/o/r/pulls/1/files') return { ok: true, stdout: JSON.stringify(partial ? FILES.slice(0, 100) : FILES) };
    return { ok: true, stdout: '[]' };
  };
  const e = new Engine();
  e.fetchPrInventory = realInventory;
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'fixture';
  e.ghEnv = () => ({});
  e.headSha = async () => HEAD;
  e.myReviewStates = async () => [];
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta';
  e.postados = [];
  e.postReview = async (_pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async prompt => {
    e.promptMedido = prompt;
    return { text: JSON.stringify({ protocolo: { prReviewer: 'rodou' }, ...criteriaFixture(verdict), analysisStatus: 'complete', verdict,
      decision: verdict === 'approve' ? 'auto_approve' : 'request_changes', cardMet: true, reasons: [], reportMarkdown: 'Analisado.',
      ...(coverage ? { coverage: { total: 132, reviewed: FILES.map(f => f.path), missing: [] } } : {}),
      alcance: FILES.map(f => ({ alterado: f.path, chamadores: [], semChamador: 'entrypoint sintético' })),
      // O modelo não pode forjar o resultado da medição feita pelo engine.
      inventarioDiff: { status: 'complete' }, diffMedido: [], ...extra,
      payloads: { [verdict]: { event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', body: 'Comportamento verificado.' } },
    }), sessionId: 'fixture' };
  };
  return { e, queries };
}

test('revisão real: os 132 arquivos paginados chegam aos lotes, à cobertura e à decisão', async () => {
  const { e, queries } = motor('approve');
  await e.runHeadlessReview({ ...PR });
  assert.match(e.promptMedido, /src\/f131\.ts/);
  assert.match(e.promptMedido, /cobrindo 132 arquivos/);
  const d = [...e.decisions.pending, ...decisoesResolvidas(e)][0];
  assert.equal(d.inventarioDiff.status, 'complete');
  assert.equal(d.inventarioDiff.headSha, HEAD);
  assert.equal(d.inventarioDiff.changedFiles, 132);
  assert.deepEqual(d.inventarioDiff.files, FILES, 'a decisão preserva os arquivos medidos pelo engine');
  assert.equal(queries.filter(q => q.includes('--paginate') && !q.includes('/timeline')).length, 1);
  assert.equal(queries.some(q => q.includes('additions,deletions,changedFiles,files')), false);
  assert.equal(e.postados.length, 1);
  assert.doesNotMatch(e.postados[0].body, /inventário|coverage|132/);
});

for (const verdict of ['approve', 'request_changes']) {
  for (const failure of ['partial', 'moved', 'fail']) {
    test(`${verdict}: ${failure} permite análise mas impede postagem automática`, async () => {
      const { e } = motor(verdict, { [failure]: true });
      await e.runHeadlessReview({ ...PR });
      assert.ok(e.promptMedido, 'a análise continua');
      assert.doesNotMatch(e.promptMedido, /Lotes deste PR/);
      assert.equal(e.postados.length, 0);
      const d = e.decisions.pending[0];
      assert.ok(d, 'decisão fica para intervenção');
      assert.notEqual(d.inventarioDiff.status, 'complete');
      assert.match(d.reasons.map(r => r.text || r).join(' '), /inventário do diff não verificado/);
    });
  }
}

// Desde 06/11/2026 (decidir na 1ª rodada) a cobertura não declarada é lacuna que não é dura: vira
// ressalva da própria rodada. Desde 17/11/2026 a conta não espera mais nas ressalvas (o `wait`
// saiu): o APPROVE sai com a ressalva no card. O inventário incompleto segue impedindo.
test('inventário completo sem declaração de cobertura: ressalva da rodada, e o APPROVE sai', async () => {
  const { e } = motor('approve', { coverage: false });
  await e.runHeadlessReview({ ...PR });
  assert.deepEqual(e.postados.map(p => p.event), ['APPROVE'], 'a ressalva não segura a aprovação');
  const d = decisoesResolvidas(e)[0];
  assert.equal(d.status, 'auto_approved');
  assert.equal(d.esperaProva, undefined, 'sem recuperação no mesmo commit');
  assert.match(d.attention.map(r => r.text || r).join(' '), /segue como ressalva: a cobertura da leitura tem .*não declarou a cobertura/);
});

for (const own of [false, true]) {
  test(`inventário parcial impede caminhos alternativos de postagem, PR próprio: ${own}`, async () => {
    const { e } = motor('approve', { partial: true, extra: { cardParteDestePr: false } });
    await e.runHeadlessReview({ ...PR, author: own ? 'eu' : 'dev' });
    assert.equal(e.postados.length, 0);
    // o PR próprio encerra sem postar (resolvida, `not_posted`); o de outro autor fica pendente
    const d = own ? decisoesResolvidas(e)[0] : e.decisions.pending[0];
    if (own) assert.equal(d.status, 'not_posted');
    assert.equal(d.inventarioDiff.status, 'incomplete');
  });
}

test('tentativas esgotadas não liberam aprovação com inventário desconhecido', () => {
  const { e } = motor('approve');
  const result = { ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', provaEsgotada: true,
    inventarioDiff: { status: 'unavailable', reason: 'sem rede' }, payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
  assert.equal(e.shouldAutoApprove(PR, result).ok, false);
});

// Segunda revisão independente de 06/11/2026: acima do limite de arquivos que o GitHub lista o
// inventário nunca fecha. Até 17/11/2026 a revisão ia à mesa com o motivo; sem mesa, o motivo é
// definitivo (outra rodada não muda nada) e sai na hora o COMMENT neutro do motor, sem recuperação,
// e a prova gravada não pede revisão nova (que daria o mesmo resultado, uma sessão por rodada).
test('PR acima do limite de arquivos do GitHub: COMMENT neutro na hora, sem recuperação e sem lacuna que relance', async () => {
  const { e } = motor('approve', { changedFiles: 3500 });
  // antes do COMMENT neutro o motor relê o PR (desfecho-sem-mesa.js): aqui ele está aberto
  e.prEstadoELabels = async () => ({ estado: 'OPEN', labels: [] });
  await e.runHeadlessReview({ ...PR });
  assert.deepEqual(e.postados.map(p => p.event), ['COMMENT'], 'o APPROVE automático continua impedido');
  assert.match(e.postados[0].body, /mais arquivos alterados do que o GitHub lista/);
  assert.equal(e.decisions.pending.some(x => x.key === PR.key), false, 'nada fica pendente');
  const d = decisoesResolvidas(e)[0];
  assert.equal(d.status, 'commented_inconclusive');
  assert.equal(d.action, 'comment');
  assert.equal(d.esperaProva, undefined, 'sem recuperação');
  assert.match(d.reasons.map(r => r.text || r).join(' | '), /3500 arquivos.*comentário neutro/);
  assert.equal(d.approvalEvidence.includes('diff não medido independentemente'), false);
});
