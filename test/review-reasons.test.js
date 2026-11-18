import { criteriaFixture } from './helpers/criteria-fixture.js';
// Reasons do runHeadlessReview: o bloco de transparência só pode atribuir à POLÍTICA
// da conta o que veio de fato da política. Antes ele disparava sempre que o gate
// recusava um PR aprovável e pedido a mim, então contestação e cobertura apareciam
// pra você como "a política da conta manda aguardar", que era mentira (M7).
// Desde a v2.48.0 cada reason é { text, kind }: 'gate' (regra do app), 'content'
// (a revisão apontou) ou 'infra' (a postagem em si falhou). Os testes aqui checam
// os dois lados, texto E etiqueta, porque é a etiqueta que faz a tela distinguir
// "a IA achou algo" de "a rede caiu" (era o print do biud-frontend#774).
// Harness: engine real com FAROL_HOME temporário, sessão Claude stubada e a medição
// de fan-out neutralizada (prMetrics null = passe único). Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-review-reasons-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();

const fanout = (await import('../lib/engine/fanout.js')).default;

// runHeadlessReview chama fanoutMod.prMetrics por acesso de propriedade em tempo de
// chamada, então trocar a propriedade exportada vale pro require de dentro do review.js.
const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { }
});

const PR = {
  key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1',
  requested: true, title: 't', author: 'alice'
};

const texto = r => (r && typeof r === 'object') ? r.text : r;
const textos = rs => (rs || []).map(texto);

function envelope(extra) {
  return {
    protocolo: { prReviewer: 'rodou' }, ...criteriaFixture('approve'), analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    reportMarkdown: 'relatório', payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

// engine com a sessão stubada devolvendo o envelope dado; nada toca rede nem posta.
// postReview LANÇA de propósito: se algum gate deixar postar, o teste explode.
function engineComEnvelope(data) {
  const e = new Engine();
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.scopeLabel = () => 'Conta Trabalho';
  e.myReviewStates = async () => null;
  e.headSha = async () => 'a'.repeat(40);
  e.bloqueadoPorChecks = async () => ({ faltando: [] });
  e.postReview = async () => { throw new Error('não era pra postar neste teste'); };
  e.runClaudeStream = async () => ({ text: JSON.stringify({ result: JSON.stringify(data) }), sessionId: 's1' });
  return e;
}


// Até 17/11/2026 a política da conta podia mandar esperar (`wait`), e estes testes conferiam a
// recusa da política no card. O `wait` saiu (regra do dono: o revisor nunca espera decisão de
// gente): com ou sem ressalvas o APPROVE sai, e o que se confere agora é a ressalva no card da
// aprovação, uma vez, com rótulo e prova. Os dois testes que provavam só o texto da política em
// espera (limpo e com ressalvas) saíram junto com ela.
function engineQueAprova(data) {
  const e = engineComEnvelope(data);
  const postados = [];
  e.myReviewStates = async () => [];
  e.postReview = async (_pr, payload) => { postados.push(payload); return { ok: true }; };
  e.writeMemory = () => { };
  return { e, postados };
}

test('contestação com a ressalva: o APPROVE sai e a discordância aparece no card uma vez', async () => {
  const { e, postados } = engineQueAprova(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }));
  await e.runHeadlessReview(PR);
  assert.equal(postados.length, 1);
  const item = decisoesResolvidas(e)[0];
  assert.equal(item.status, 'auto_approved');
  const discordancia = item.attention.filter(r => /Discordância de outro review \(falso positivo\)/.test(texto(r)));
  assert.equal(discordancia.length, 1, 'a ressalva aparece uma vez, com rótulo e prova');
  assert.equal(discordancia[0].kind, 'gate');
});

test('contestação com a conta aprovando com ressalvas: o APPROVE sai e a discordância fica só no app', async () => {
  const e = engineComEnvelope(envelope({
    contested: [{ source: 'Acrity', claim: 'ref não é setado', label: 'falso_positivo', evidence: 'Arquivo.tsx:172 seta o ref' }]
  }));
  const postados = [];
  e.myReviewStates = async () => [];
  e.postReview = async (_pr, payload) => { postados.push(payload); return { ok: true }; };
  e.writeMemory = () => { };
  await e.runHeadlessReview(PR);
  // a rodada nova do mesmo PR substitui a pendência que um teste anterior deixou no disco
  assert.equal(e.decisions.pending.some((d) => d.key === PR.key), false, 'nada na mesa para este PR');
  assert.equal(postados.length, 1);
  assert.doesNotMatch(JSON.stringify(postados[0]), /Acrity|Discordância|falso positivo/i, 'a discordância não entra no texto do PR');
  const item = decisoesResolvidas(e)[0];
  assert.equal(item.status, 'auto_approved');
  assert.equal(item.attention.length, 1);
  assert.match(texto(item.attention[0]), /Discordância de outro review \(falso positivo\): ref não é setado/);
});

test('lacuna de cobertura entra UMA vez nas ressalvas da aprovação, com a amostra dos arquivos (B5)', async () => {
  const { e, postados } = engineQueAprova(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }));
  await e.runHeadlessReview(PR);
  // desde 06/11/2026 a cobertura vira ressalva na própria rodada (decidir na 1ª rodada)
  assert.equal(postados.length, 1, 'ressalva não segura o APPROVE');
  const item = decisoesResolvidas(e)[0];
  assert.equal(item.status, 'auto_approved');
  assert.equal(item.esperaProva, undefined, 'sem recuperação no mesmo commit para lacuna que não é dura');
  const deCobertura = textos(item.attention).filter(r => /cobertura da leitura/.test(r));
  assert.equal(deCobertura.length, 1, `cobertura virou ${deCobertura.length} motivo(s): ${deCobertura.join(' | ')}`);
  assert.match(deCobertura[0], /b\.ts/, 'a redação que fica é a que mostra a amostra');
  assert.doesNotMatch(deCobertura[0], /não posto sozinho/, 'ressalva não promete recusa');
});

// A lacuna continua explicando a recusa onde o resultado NÃO chega à política: revisão de
// origem desconhecida (desde 18/10/2026 o clique do dono chega à política) e pedido de mudanças.
test('fora da política (origem desconhecida), a lacuna de cobertura segue explicando por que nada saiu sozinho', async () => {
  const e = engineComEnvelope(envelope({
    coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] }
  }));
  await e.runHeadlessReview({ ...PR, requested: false });
  const item = e.decisions.pending[0];
  const deCobertura = textos(item.reasons).filter(r => /cobertura da leitura/.test(r));
  assert.equal(deCobertura.length, 1);
  assert.match(deCobertura[0], /cobertura da leitura/);
  assert.ok(textos(item.reasons).some(r => /revisão de origem desconhecida/.test(r)));
});

// A classe escondida: zero ponto de atenção com `decision` diferente de auto_approve caía em
// "com ressalvas" sem mostrar nada no card. Agora o rebaixamento tem ressalva própria.
test('sessão que não decidiu auto_approve e não escreveu motivo: o card mostra a ressalva que rebaixou', async () => {
  const { e } = engineQueAprova(envelope({ decision: 'needs_decision', cardMet: null }));
  await e.runHeadlessReview(PR);
  const item = decisoesResolvidas(e)[0];
  assert.equal(item.status, 'auto_approved');
  assert.equal(item.attention.length, 1, 'só a ressalva que explica a classe');
  assert.match(texto(item.attention[0]), /não marcou o PR como aprovável sem ressalvas nem escreveu o motivo/);
});

test('card não comprovado: o card mostra a ressalva do card', async () => {
  const { e } = engineQueAprova(envelope({ decision: 'needs_decision', cardMet: false }));
  await e.runHeadlessReview(PR);
  const item = decisoesResolvidas(e)[0];
  // de 16 a 17/10/2026 (PR #244) o card não comprovado era lacuna obrigatória; voltou a ser ressalva
  assert.equal(item.status, 'auto_approved');
  assert.ok(textos(item.attention).some(r => /card não foi totalmente comprovado/.test(r)), JSON.stringify(item.attention));
});

/* ---------- falha de postagem: infra, não julgamento (biud-frontend#774) ----------
   O incidente: a revisão decidiu approve, o gate LIBEROU e a postagem em si morreu
   num 503 durante um outage do GitHub. A falha entrava na mesma lista plana das
   ressalvas de conteúdo, então a tela dizia "7 motivos de ter vindo pra você" sem
   distinguir "a IA achou algo" de "a rede caiu", e nada tentava de novo: a pendência
   ficava presa esperando clique humano pra sempre. */

// engine cujo postReview FALHA com a mensagem dada (o resto igual ao harness acima)
function engineComPostQuebrado(erro, data = envelope()) {
  const e = engineComEnvelope(data);
  e.postReview = async () => ({ ok: false, attempted: true, error: erro });
  return e;
}

const ERRO_503 = 'gh: No server is currently available to service your request. Sorry about that. (HTTP 503)';

test('falha transitória ao postar vira reason de INFRA e marca o retry automático', async () => {
  const e = engineComPostQuebrado(ERRO_503);
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item, 'a pendência é criada, o review não sumiu');
  const infra = item.reasons.filter(r => r.kind === 'infra');
  assert.equal(infra.length, 1, 'a falha de postagem é UM motivo, e é de infra');
  assert.match(infra[0].text, /falha ao postar o APPROVE/);
  assert.ok(item.postRetry, 'ficou marcado pra tentar de novo sozinho');
  assert.equal(item.postRetry.event, 'approve');
  assert.equal(item.postRetry.attempts, 0);
});

test('falha PERMANENTE ao postar não marca retry (tentar de novo não resolveria)', async () => {
  // credencial recusada não passa sozinha: reenviar em loop só gasta chamada e
  // esconde de você o único problema que exige ação humana de verdade.
  const e = engineComPostQuebrado('sessão retornou erro: Invalid API key · Fix external API key');
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  assert.ok(item);
  assert.equal(item.reasons.filter(r => r.kind === 'infra').length, 1, 'continua sendo falha de infra pra tela');
  assert.equal(item.postRetry, null, 'mas NÃO entra no sweep de retry');
});

test('reason vinda da sessão (achado da IA) fica como content, não vira gate nem infra', async () => {
  const e = engineComPostQuebrado(ERRO_503, envelope({
    reasons: ['a validação de CPF aceita string vazia'],
  }));
  await e.runHeadlessReview(PR);
  const item = e.decisions.pending[0];
  const content = item.reasons.filter(r => r.kind === 'content');
  assert.equal(content.length, 1, 'o achado da revisão continua um motivo só');
  assert.match(content[0].text, /validação de CPF/);
  // é ESTA separação que o print do #774 não tinha: os dois eixos convivem no
  // mesmo PR e a tela precisa saber qual é qual
  assert.equal(item.reasons.filter(r => r.kind === 'infra').length, 1);
});
