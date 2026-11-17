// decisions.json gravado por versão anterior ao corte (Review Focus 3 do plano da fase 1):
// as decisões traziam campos de recursos que saíram (a coordenação em `sync`, a conversa em
// `chat`, a autoanálise em `selfAnalysis`) e a marca `esperaProva` com o recibo que a rodada
// consultava. O arquivo antigo continua sendo lido: a projeção para a tela não entrega esses
// campos e a entrada no histórico não lança.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-declegadas-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { readJson, writeJsonAtomic } = await import('../lib/io.js');
const { decisoesResolvidas } = await import('../lib/engine/historico-decisoes.js');
const dec = (await import('../lib/engine/decision.js')).default;

function decisaoLegada(n, extra = {}) {
  return {
    id: 'd' + n, key: `acme/app#${n}`, createdAt: 1700000000000 + n, verdict: 'approve', status: 'pending',
    pr: { repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'ajuste', author: 'ana', account: 'rev' },
    headSha: 'a'.repeat(40), reportMarkdown: 'Revisão sem ressalvas.', reasons: [], attention: [],
    sync: { posse: 'l-1', dono: 'dev-antigo', recibo: { estado: 'enviando', etag: 'x' }, publicadoEm: 1700000000500 },
    chat: { sessionId: 's-1', mensagens: [{ de: 'eu', texto: 'pode aprovar?' }] },
    selfAnalysis: { parecer: 'aprovavel', escondida: false, relatorio: 'texto interno' },
    esperaProva: { desde: 1700000001000, tentativas: 2, proximaEm: 1700000900000, impedimento: 'análise incompleta',
      recibo: { etag: 'y', dono: 'dev-antigo' }, assinatura: 'estado-lido' },
    ...extra,
  };
}

function arquivoLegado() {
  const file = path.join(process.env.FAROL_HOME, 'decisions-legado.json');
  writeJsonAtomic(file, {
    pending: [decisaoLegada(1)],
    resolved: [decisaoLegada(2, { status: 'posted', action: 'approve', resolvedAt: 1700000002000 })],
  });
  return readJson(file, null);
}

function engineFake(decisions) {
  return { decisions, saveDecisions() { }, log() { }, accountForPr: pr => pr.account };
}

test('decisionForUi não entrega à tela os campos de recursos que saíram', () => {
  const lido = arquivoLegado();
  for (const item of [...lido.pending, ...lido.resolved]) {
    const tela = dec.decisionForUi(item);
    for (const campo of ['sync', 'chat', 'selfAnalysis']) {
      assert.equal(campo in tela, false, `${campo} não chega à tela`);
    }
    assert.equal(tela.key, item.key, 'o que a tela usa continua vindo');
    assert.equal(tela.reportMarkdown, 'Revisão sem ressalvas.');
    // a marca da recuperação da análise segue projetada por lista fechada: o recibo e a
    // assinatura que a versão antiga gravava dentro dela ficam no disco
    assert.deepEqual(Object.keys(tela.esperaProva).sort(),
      ['aguardandoCi', 'desde', 'impedimento', 'pedeVoce', 'proximaEm', 'soEnvelope', 'tentativas']);
    assert.equal(JSON.stringify(tela).includes('dev-antigo'), false, 'nada do recibo antigo vaza pelo texto');
  }
});

test('decisionByKey lê a decisão antiga do histórico sem lançar', () => {
  const e = engineFake(arquivoLegado());
  const tela = dec.decisionByKey(e, 'acme/app#2');
  assert.equal(tela.status, 'posted');
  assert.equal('sync' in tela, false);
});

test('resolveIntoHistory aceita a decisão antiga e não lança', () => {
  const lido = arquivoLegado();
  const e = engineFake(lido);
  const [pendente] = lido.pending;
  assert.doesNotThrow(() => dec.resolveIntoHistory(e, { ...pendente, status: 'skipped', action: 'skip' }));
  assert.equal(decisoesResolvidas(e)[0].key, 'acme/app#1');
  assert.equal(typeof decisoesResolvidas(e)[0].resolvedAt, 'number');
  // com memória de rodada apontada (roundId de uma rodada que este disco não tem), idem
  assert.doesNotThrow(() => dec.resolveIntoHistory(e, { ...pendente, roundId: 'r-que-nao-existe', status: 'posted', action: 'approve' }));
  assert.equal(decisoesResolvidas(e).length, 3);
});
