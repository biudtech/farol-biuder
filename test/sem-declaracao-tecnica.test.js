// Repositório sem declaração técnica cadastrada (17/10/2026).
//
// Medido no admin (v2.72.4): só o próprio Farol tem declaração em
// ~/.farol/technical-review/repositories.json, então todo PR de outro repositório saía com
// "avaliação técnica atual ausente" e nunca era aprovado sozinho. Regra do dono: a aprovação
// não depende dele; bloqueiam só violação técnica confirmada e lacuna de leitura (o CI saiu da
// decisão em 17/11/2026: o revisor nunca espera o CI). Sem declaração não há avaliação técnica configurada, e isso não é
// violação: vira ressalva. Com declaração, toda lacuna técnica continua bloqueando.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-declaracao-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { PROFILE_FILE } = await import('../lib/technical-review/profiles.js');
const { prepareTechnicalReview, finishTechnicalReview, technicalPrompt } = await import('../lib/technical-review/runtime.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { technicalSummary } = await import('../lib/technical-review/verdict.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { shouldAutoApprove } = await import('../lib/engine/approval-policy.js');
const { recuperarResultado } = await import('../lib/engine/recuperacao-resultado.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const SEM_DECLARACAO = { schema: 1, verdict: 'not-run', error: 'declaração técnica do repositório ainda não cadastrada', semDeclaracao: true };
function result(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: SEM_DECLARACAO, reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
function engineCom(onCaveats) {
  return { accountForPr: () => 'reviewer', attentionPoints: (r) => attentionPoints(null, r),
    approvePolicyFor: (_conta, limpo) => (limpo ? 'approve' : onCaveats) };
}
const PEDIDO = { requested: true };

test('o runtime marca o repositório sem declaração, e só ele', async () => {
  const ctx = await prepareTechnicalReview({}, { repo: 'org/sem-declaracao' }, head);
  assert.equal(ctx.semDeclaracao, true);
  const fim = await finishTechnicalReview(ctx, [{ semDeclaracao: false }]);
  assert.deepEqual(fim, SEM_DECLARACAO);
  // com declaração, a ferramenta ausente é outra falha e não ganha a marca
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { 'org/declarado': { declaration: { scopes: ['core'] } } } }));
  try {
    const comPerfil = await prepareTechnicalReview({}, { repo: 'org/declarado' }, head);
    assert.ok(comPerfil.error, 'a ferramenta não está instalada neste HOME');
    assert.equal(comPerfil.semDeclaracao, undefined);
    assert.equal((await finishTechnicalReview(comPerfil, [{ semDeclaracao: true }], [])).semDeclaracao, undefined,
      'o que a sessão escreve (avaliações) não vira a marca');
  } finally { fs.rmSync(PROFILE_FILE, { force: true }); }
});

test('sem declaração o prompt não manda segurar a aprovação', () => {
  assert.equal(technicalPrompt({ error: 'x', semDeclaracao: true }), '');
  assert.match(technicalPrompt({ error: 'ferramenta ausente' }), /não conclua pela aprovação/);
});

test('a marca de sem declaração tira a lacuna técnica; com declaração a lacuna fica', () => {
  assert.deepEqual(approvalGaps(result()), []);
  const comDeclaracao = result({ technicalReview: { schema: 1, verdict: 'not-run', error: 'ferramenta ausente' } });
  assert.deepEqual(approvalGaps(comDeclaracao), ['avaliação técnica atual ausente']);
  assert.deepEqual(approvalGaps(result({ technicalReview: { ...SEM_DECLARACAO, semDeclaracao: 'true' } })), ['avaliação técnica atual ausente'],
    'só o booleano verdadeiro vale');
  assert.ok(approvalGaps(result({ coverage: { total: 1, reviewed: [], missing: ['a.md'] } })).some((g) => /cobertura/.test(g)),
    'lacuna de leitura continua bloqueando sem declaração');
});

// até 17/11/2026 a conta em espera segurava esta ressalva (motivo `politica`); o `wait` saiu
test('sem declaração vira ressalva com texto próprio, e não segura o APPROVE', () => {
  const textos = attentionPoints(null, result()).map((p) => p.text);
  assert.ok(textos.some((t) => /não tem declaração técnica cadastrada, então a avaliação técnica automática não rodou/.test(t)), textos.join(' | '));
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, result()), { ok: true, motivo: null });
  assert.deepEqual(shouldAutoApprove(engineCom('wait'), PEDIDO, result()), { ok: true, motivo: null }, 'nem o stub antigo em espera segura');
  const vermelho = result({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] });
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, vermelho), { ok: true, motivo: null }, 'o CI vermelho não segura');
});

test('a tela diz que não há declaração, sem o rótulo de verificação pendente', () => {
  const s = technicalSummary(SEM_DECLARACAO, []);
  assert.equal(s.state, 'sem-declaracao');
  assert.match(s.message, /não tem declaração técnica cadastrada/);
  assert.equal(technicalSummary(SEM_DECLARACAO, ['análise incompleta']).state, 'pending', 'outra lacuna continua pendente');
});

test('o envelope não escreve a marca: o fechamento usa o contexto medido pelo runtime', async () => {
  const claimed = { ...result(), findings: [], productDecisions: [], criteriaVersion: 1 };
  const failed = await recuperarResultado({}, claimed, {}, 'id', {}, {}, {}, head, null,
    { error: 'ferramenta indisponível', failure: 'tool' });
  assert.equal(failed.technicalReview.semDeclaracao, undefined, 'alegação do modelo não dispensa avaliação configurada');
  assert.equal(failed.technicalReview.failure, 'tool');
  const measured = await recuperarResultado({}, { ...claimed, technicalReview: { verdict: 'pass' } }, {}, 'id', {}, {}, {}, head, null,
    { semDeclaracao: true, error: SEM_DECLARACAO.error });
  assert.deepEqual(measured.technicalReview, SEM_DECLARACAO);
});

function motorDaPublicacao(checks) {
  const evidencias = new Map([['org/sem-declaracao#1', { report: SEM_DECLARACAO, evidence: [] }]]);
  return { config: {}, technicalApprovals: evidencias, decisions: { pending: [] }, bloqueadoPorChecks: async () => checks };
}

test('publicação sem declaração: CI rodando, vermelho ou de outro commit não segura', async () => {
  for (const checks of [{ verifiedHead: head, faltando: [{ nome: 'test', estado: 'rodando' }] },
    { verifiedHead: head, faltando: [{ nome: 'test', estado: 'vermelho' }] }, { verifiedHead: 'c'.repeat(40), faltando: [] }, null]) {
    assert.equal(await approvalRefusal(motorDaPublicacao(checks), PR, { event: 'APPROVE', commit_id: head }), null, JSON.stringify(checks));
  }
  const semCommit = await approvalRefusal(motorDaPublicacao(null), PR, { event: 'APPROVE' });
  assert.equal(semCommit.error, 'aprovação sem commit confirmado', 'o commit continua obrigatório');
});
const PR = { key: 'org/sem-declaracao#1', repo: 'org/sem-declaracao' };

test('publicação sem declaração: sai com commit confirmado', async () => {
  const e = motorDaPublicacao({ verifiedHead: head, faltando: [] });
  assert.equal(await approvalRefusal(e, PR, { event: 'APPROVE', commit_id: head }), null);
});

test('publicação sem declaração: commit ausente e prova com lacuna recusam', async () => {
  const semCommit = await approvalRefusal(motorDaPublicacao({ verifiedHead: head, faltando: [] }), PR, { event: 'APPROVE' });
  assert.equal(semCommit.error, 'aprovação sem commit confirmado');
  const comLacuna = motorDaPublicacao({ verifiedHead: head, faltando: [] });
  comLacuna.technicalApprovals.get(PR.key).evidence = ['análise incompleta'];
  assert.equal((await approvalRefusal(comLacuna, PR, { event: 'APPROVE', commit_id: head })).error, 'análise incompleta');
});

test('cadastro que existe e não abre não vira "sem declaração": segue lacuna e recusa', async () => {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, '{');
  try {
    const ctx = await prepareTechnicalReview({}, { repo: 'org/sem-declaracao' }, head);
    assert.match(ctx.error, /ilegível/);
    assert.equal(ctx.semDeclaracao, undefined);
    assert.equal((await finishTechnicalReview(ctx, [])).semDeclaracao, undefined);
    const recusa = await approvalRefusal(motorDaPublicacao({ verifiedHead: head, faltando: [] }), PR, { event: 'APPROVE', commit_id: head });
    assert.equal(recusa.error, 'declaração técnica do repositório ausente');
  } finally { fs.rmSync(PROFILE_FILE, { force: true }); }
});
