// "CI obrigatório antes da aprovação" voltou a ser escolha, desligada por padrão (06/11/2026).
//
// Pedido do dono: "CI obrigatório antes da aprovação: isso aqui tem que ter como desativar no
// Farol, acredito que isso é a maior falha, e deve vir por default como desabilitado". As vias da
// decisão e da postagem têm casos próprios (gate-espera-revisao, decisao-sem-mesa,
// retirada-de-pedido, technical-review, sem-declaracao-tecnica, busca-da-prova); aqui ficam o
// prompt da sessão e o que os guias prometem: com a chave desligada, nada pode prometer espera do CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ciForaDaDecisaoBlock } from '../lib/engine/review-prompt.js';

const ler = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// a seção v2.78.42 do CHANGELOG, a deste PR
function secaoDoChangelog() {
  const texto = ler('CHANGELOG.md');
  const inicio = texto.indexOf('## v2.78.42');
  return inicio < 0 ? '' : texto.slice(inicio, texto.indexOf('## v2.78.41', inicio));
}

test('prompt: desligada, a sessão é avisada de que o CI não decide; ligada, nada muda', () => {
  for (const config of [{}, { aguardarCiParaAprovar: false }, { aguardarCiParaAprovar: 'true' }]) {
    const bloco = ciForaDaDecisaoBlock(config);
    assert.match(bloco, /CI obrigatório fora da decisão/);
    assert.match(bloco, /Não conclua `request_changes` nem declare bloqueio com causa `ci`/);
    assert.match(bloco, /defeito do código \(causa `defeito_codigo`\)/, 'o diff que quebra o check, com prova, continua defeito');
    assert.match(bloco, /não rebaixe `decision` para `needs_decision` nem escreva item em\s+`reasons` só pelo estado do CI/,
      'o CI não vira ressalva pela sessão (com a conta esperando você nas ressalvas, isso mandaria o PR limpo para a mesa)');
    assert.match(bloco, /vale por cima das regras de CI deste prompt/);
  }
  assert.equal(ciForaDaDecisaoBlock({ aguardarCiParaAprovar: true }), '');
  assert.match(ler('lib/engine/review-prompt.js'), /thirdPartyReviewBlock\(\) \+ ciForaDaDecisaoBlock\(engine\.config\)/, 'o bloco entra no prompt da revisão');
});

test('espera armada e desligada: as notas não prometem que a decisão sempre sai pela política da conta', () => {
  // decisao-sem-mesa.test.js, "desligada depois de armada": a aprovação sai pela política, mas
  // a espera de um pedido de mudanças só pelo CI vai para você. Quem descreve a liberação diz os dois.
  const fontes = {
    'CHANGELOG.md': secaoDoChangelog(),
  };
  assert.ok(fontes['CHANGELOG.md'], 'a seção v2.78.42 deste PR');
  assert.match(fontes['CHANGELOG.md'], /o pedido de mudanças sustentado só pelo CI vem para você/);
  for (const [arquivo, texto] of Object.entries(fontes)) {
    assert.doesNotMatch(texto, /sai pela política da conta, sem olhar o CI/, arquivo);
    assert.doesNotMatch(texto, /Aprovação que já estava esperando o CI sai no ciclo seguinte/, arquivo);
  }
});

test('desligar só é seguro com check obrigatório no ruleset: os docs, as notas e a tabela das preferências avisam', () => {
  assert.match(ler('docs/CONFIGURATION.md'), /Só é seguro desligar onde o check é obrigatório no ruleset\*\*: sem isso, o Farol pode aprovar com o CI vermelho/);
  assert.match(ler('docs/REVIEW-GATES.md'), /desligar só é seguro nesse caso: num repositório sem check obrigatório, desligar permite APPROVE com o CI vermelho/);
  assert.doesNotMatch(ler('docs/REVIEW-GATES.md'), /e é por isso que desligar é seguro/);
  assert.match(secaoDoChangelog(), /Só desligue onde o check é obrigatório no ruleset/);
  assert.match(ler('lib/settings.js'), /Só é seguro onde o check é obrigatório no ruleset/);
});

test('lacunas da rodada: o CI só entra na prova exigida com a chave ligada; o approvalGaps segue apontando a pipe', async () => {
  const { lacunasDaRodada } = await import('../lib/engine/busca-da-prova.js');
  const { approvalGaps } = await import('../lib/technical-review/evidence.js');
  const head = 'a'.repeat(40);
  const base = () => ({ analysisStatus: 'complete', headSha: head, checksVerifiedHead: null,
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] });
  const ci = ['checks não conferidos no commit revisado', 'ci_vermelho'];
  for (const g of ci) assert.ok(approvalGaps(base()).includes(g), g);
  const ligada = lacunasDaRodada({ config: { aguardarCiParaAprovar: true } }, null, base());
  for (const g of ci) assert.ok(ligada.includes(g), `ligada exige ${g}`);
  for (const config of [{}, { aguardarCiParaAprovar: false }]) {
    const desligada = lacunasDaRodada({ config }, null, base());
    for (const g of ci) assert.equal(desligada.includes(g), false, `desligada não exige ${g}`);
  }
});

test('reprovacaoSoPeloCi: só o CI vermelho sustentando o pedido, inclusive com achados ilegíveis', async () => {
  const { reprovacaoSoPeloCi } = await import('../lib/engine/review-consistency.js');
  const head = 'b'.repeat(40);
  const base = { verdict: 'request_changes', headSha: head, checksVerifiedHead: head, checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] };
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [] }), true);
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: 'ilegível' }), true, 'contagem não confiável: segura o pedido automático');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [{ severity: 'blocking', title: 'x', summary: 'y', causa: 'defeito_codigo' }] }), false, 'com bloqueio, não é só o CI');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [], checksObrigatorios: [] }), false, 'sem CI vermelho, não');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [], checksVerifiedHead: 'c'.repeat(40) }), false, 'CI lido em outro commit não sustenta');
  assert.equal(reprovacaoSoPeloCi({ ...base, verdict: 'approve' }), false);
});

test('sem check obrigatório no ruleset: a leitura marca, e o aviso da aprovação diz que o GitHub não barra o merge', async () => {
  const checks = await import('../lib/engine/checks-exigidos.js');
  const { avisoDaAprovacao } = await import('../lib/engine/gate-espera.js');
  const io = (await import('../lib/io.js')).default;
  assert.equal(checks.semCheckObrigatorio([]), true);
  assert.equal(checks.semCheckObrigatorio(['acrity/review']), true, 'veredito de review de ferramenta não é check de CI');
  assert.equal(checks.semCheckObrigatorio(['audit']), false);
  assert.equal(checks.semCheckObrigatorio(null), false, 'exigência desconhecida não vira aviso');
  const rodada = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-11-06T12:00:00Z' });

  // a leitura real do bloqueadoPorChecks, com o gh falso: ruleset vazio e um check vermelho
  const runReal = io.run;
  io.run = async (_cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('rules/branches/main')) return { ok: true, stdout: '[]' };
    return { ok: true, stdout: JSON.stringify({ baseRefName: 'main', headRefOid: 'f'.repeat(40),
      statusCheckRollup: [rodada('lint', 'FAILURE'), rodada('build', 'SUCCESS'), rodada('e2e', null, 'IN_PROGRESS')] }) };
  };
  try {
    const engine = { accountForPr: () => 'eu', primaryUser: () => 'eu', tokenFor: () => 'tk', ghEnv: () => ({}) };
    const lido = await checks.bloqueadoPorChecks(engine, { url: 'https://github.com/o/r/pull/1', repo: 'o/r' });
    assert.deepEqual([lido.bloqueado, lido.semExigencia], [false, true]);
    assert.deepEqual(lido.naoVerdes, [{ nome: 'lint', estado: 'vermelho' }, { nome: 'e2e', estado: 'rodando' }]);
    const result = {};
    await checks.anexarChecksObrigatorios({ bloqueadoPorChecks: async () => lido }, {}, result);
    assert.equal(result.semCheckObrigatorio, true);
    const [aviso] = avisoDaAprovacao(result);
    assert.equal(aviso.text, 'aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge, e o CI não está verde no head (lint vermelho, e2e sem resultado)');
  } finally {
    io.run = runReal;
  }

  assert.deepEqual(avisoDaAprovacao({ semCheckObrigatorio: true, checksForaDoRuleset: [] }).map((a) => a.text),
    ['aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge'], 'sem CI nenhum também avisa');
  const muitos = Array.from({ length: 13 }, (_, i) => ({ nome: 'c' + i, estado: 'vermelho' }));
  assert.match(avisoDaAprovacao({ semCheckObrigatorio: true, checksForaDoRuleset: muitos })[0].text, /c9 vermelho, mais 3\)$/, 'teto de dez nomes no card');
  assert.deepEqual(avisoDaAprovacao({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] }).map((a) => a.text),
    ['aprovado com check obrigatório vermelho no head (audit): o ruleset segura o merge até ele passar, salvo bypass']);
  assert.deepEqual(avisoDaAprovacao({ checksObrigatorios: [] }), [], 'CI obrigatório verde: sem aviso');
});
