// O Farol revisa o código pelo mérito, e decisão de produto não é dele (regras do dono de 20/11/2026).
//
// Caso de origem: a decisão de um PR do dono do produto saiu com quatro motivos que não falavam do
// código: o card não comprovado (o PR não tinha card), o repositório sem declaração técnica, um
// item "para quem decide o merge" dizendo que aceitar o efeito era decisão de produto, e uma
// "pergunta de produto em aberto". As regras: repositório sem declaração e PR sem card não
// diminuem a revisão nem viram ressalva; item marcado como produto não chega ao texto público nem
// aos motivos; e o papel "Dono do produto" chega ao prompt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-merito-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { attentionPoints, prSemCard } = await import('../lib/engine/ressalvas.js');
const { conferirEnvelope } = await import('../lib/engine/envelope-revisao.js');
const { itensParaQuemMergeia } = await import('../lib/engine/para-quem-mergeia.js');
const { ehPontoDeProduto } = await import('../lib/engine/ponto-de-produto.js');
const { technicalSummary } = await import('../lib/technical-review/verdict.js');
const { provasDaDecisao } = await import('../lib/engine/provas-da-decisao.js');
const { personProfileBlock } = await import('../lib/engine/review-prompt.js');
const { parsePeople } = await import('../lib/parse.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const SEM_DECLARACAO = { schema: 1, verdict: 'not-run', error: 'declaração técnica do repositório ainda não cadastrada', semDeclaracao: true };
const SEM_CHAVE = { ok: false, code: 'sem_chave', fromCache: false };
const PERGUNTA = 'Pergunta de produto em aberto: o selo deve aparecer para empresa inativa?';
const EFEITO = 'Aceitar esse efeito é uma decisão de produto e segurança.';
const TECNICO = 'A migração apaga a coluna antiga sem cópia: um rollback perde o dado.';

function envelope(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: null, card: null,
    headSha: head, checksVerifiedHead: head, technicalReview: SEM_DECLARACAO, cardLeitura: SEM_CHAVE,
    reasons: [], diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] }, verificationCheckpoint: { total: 0, conflicts: [] },
    payloads: { approve: { event: 'APPROVE', body: 'O cálculo novo está correto e coberto pelos testes.', comments: [] },
      request_changes: { event: 'REQUEST_CHANGES', body: '', comments: [] }, comment: { event: 'COMMENT', body: '', comments: [] } },
    ...extra };
}
const textos = (r) => attentionPoints(null, r).map((p) => p.text);

test('sem declaração técnica: nem ressalva, nem motivo, nem texto público', () => {
  const r = conferirEnvelope(envelope());
  assert.deepEqual(textos(r), [], 'resultado sem outro ponto é limpo');
  assert.ok(!JSON.stringify(r.reasons).includes('declaração técnica'));
  assert.ok(!r.payloads.approve.body.includes('declaração técnica'));
  // o estado continua legível como diagnóstico interno
  assert.equal(technicalSummary(SEM_DECLARACAO, []).state, 'sem-declaracao');
});

test('PR sem card: card não comprovado não vira ressalva, e o motivo de falta de card cai', () => {
  const r = envelope({ cardMet: false, reasons: ['PR sem card no Jira.', { text: 'O card não foi lido nesta revisão.', kind: 'content' }] });
  assert.equal(prSemCard(r), true);
  assert.deepEqual(textos(r), []);
  // um motivo técnico continua sendo ressalva
  assert.deepEqual(textos({ ...r, reasons: [TECNICO] }), [TECNICO]);
});

test('PR com card: a régua de hoje continua valendo', () => {
  const lido = envelope({ card: 'XX-1', cardMet: null, cardLeitura: { ok: true, code: undefined } });
  assert.equal(prSemCard(lido), false);
  assert.ok(textos(lido).some((t) => /O card não foi totalmente comprovado/.test(t)));
  // card com chave que não deu para ler (credencial, rede) não conta como "sem card"
  const ilegivel = envelope({ cardMet: false, cardLeitura: { ok: false, code: 'sem_credencial' } });
  assert.equal(prSemCard(ilegivel), false);
  assert.ok(textos(ilegivel).some((t) => /O card não foi totalmente comprovado/.test(t)));
  assert.ok(textos({ ...ilegivel, reasons: ['PR sem card no Jira.'] }).includes('PR sem card no Jira.'), 'com card, o motivo fica');
});

test('Jira desligado: sem card no envelope não é ressalva; com card, a régua de hoje', () => {
  const desligado = { ok: false, code: 'desligado' };
  assert.deepEqual(textos(envelope({ cardMet: false, cardLeitura: desligado })), []);
  const comCard = envelope({ card: 'XX-2', cardMet: false, cardLeitura: desligado });
  assert.ok(textos(comCard).some((t) => /O card não foi totalmente comprovado/.test(t)));
  assert.equal(prSemCard(envelope({ cardLeitura: undefined })), false, 'sem a leitura do motor, nada muda');
});

test('item de produto não chega ao texto público, aos motivos nem à ressalva', () => {
  const r = conferirEnvelope(envelope({
    reasons: [PERGUNTA, TECNICO],
    paraQuemMergeia: [EFEITO, 'O PR liga em produção a criação de conta sem passo humano.'],
    payloads: {
      approve: { event: 'APPROVE', body: 'O cálculo novo está correto.', comments: [
        { path: 'a.js', line: 3, side: 'RIGHT', body: 'Isso é uma escolha de produto: a tela deveria esconder o selo?' },
        { path: 'a.js', line: 9, side: 'RIGHT', body: 'Este laço relê o arquivo a cada item.' }] },
      request_changes: { event: 'REQUEST_CHANGES', body: '', comments: [] },
      comment: { event: 'COMMENT', body: '', comments: [{ path: 'a.js', line: 3, side: 'RIGHT', body: 'Decisões de produto pendentes.' }] },
    },
  }));
  assert.deepEqual(r.reasons, [TECNICO]);
  assert.deepEqual(r.paraQuemMergeia, ['O PR liga em produção a criação de conta sem passo humano.']);
  assert.ok(!r.payloads.approve.body.includes(EFEITO), 'o item de produto não é anexado ao APPROVE');
  assert.match(r.payloads.approve.body, /criação de conta sem passo humano/, 'o item de segurança continua anexado');
  assert.deepEqual(r.payloads.approve.comments.map((c) => c.line), [9]);
  assert.deepEqual(r.payloads.comment.comments, []);
  const pontos = textos(r).join(' | ');
  assert.ok(!/produto/.test(pontos), pontos);
  assert.ok(!provasDaDecisao(r).paraQuemMergeia.includes(EFEITO));
});

test('a marca de produto é estreita: ponto técnico sobre funcionalidade de produto segue', () => {
  for (const t of [PERGUNTA, EFEITO, 'Questão de produto: manter o filtro?', 'escolhas de produto em aberto']) assert.ok(ehPontoDeProduto(t), t);
  for (const t of [TECNICO, 'O produto da multiplicação estoura o inteiro de 32 bits.', 'A tela de produto não trata o erro 500.']) assert.ok(!ehPontoDeProduto(t), t);
  assert.deepEqual(itensParaQuemMergeia({ paraQuemMergeia: [EFEITO] }), []);
});

test('o papel "Dono do produto" é aceito no Time e chega ao prompt', () => {
  assert.deepEqual(parsePeople({ FabianoGD: { papel: 'dono_produto' } }), { fabianogd: { papel: 'dono_produto' } });
  const engine = { personProfile: () => ({ papel: 'dono_produto' }), pushbacksFor: () => [] };
  const bloco = personProfileBlock(engine, 'fabianogd');
  assert.match(bloco, /Papel de @fabianogd: \*\*Dono do produto\*\*/);
  assert.match(bloco, /As escolhas de produto dele são a regra do projeto/);
  assert.match(bloco, /Só entra ponto técnico sobre a qualidade do código, com embasamento técnico forte e concreto/);
});

test('o prompt diz que decisão de produto não é da revisão e que falta de card não diminui a revisão', () => {
  const prompt = fs.readFileSync(new URL('../workspace-template/prompts/pr-review-auto.md', import.meta.url), 'utf8');
  assert.match(prompt, /\*\*Decisão de produto não é sua\.\*\*/);
  assert.match(prompt, /PR sem card e repositório sem declaração técnica não diminuem a revisão/);
  assert.ok(!/segurança, produto, escopo além do card/.test(prompt), 'paraQuemMergeia não pede produto');
});
