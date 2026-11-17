import { criteriaFixture } from './helpers/criteria-fixture.js';
// A porcentagem na revisão de verdade: as marcas do runHeadlessReview (fontes na criação da
// sessão, card antes de ler o Jira, código quando a sessão do modelo abre), a conferência quando
// o modelo devolve e o desfecho real (concluirRevisao) terminando com sucesso em 100. Nenhuma
// etapa é marcada à mão: só o gh e a sessão do modelo são dublês.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-progresso-fiacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
const arquivos = ['src/a.js', 'src/b.js'];
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  if (/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files/.test(sub)) {
    const files = arquivos.map(p => ({ path: p, sha: 'blob', status: 'modified', lines: 10 }));
    return Promise.resolve({ ok: true, stdout: JSON.stringify(files), stderr: '' });
  }
  if (/repos\/[^/]+\/[^/]+\/pulls\/\d+ --jq/.test(sub)) {
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), changedFiles: arquivos.length }), stderr: '' });
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor() {
  const e = new Engine();
  e.token = 'token-falso';
  e.config.conta = { user: 'eu', owners: ['acme'] };
  e.headSha = async () => 'a'.repeat(40);
  e.saveDecisions = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.vistos = [];
  // cada estado empurrado: a etapa do registro e o progresso que a tela recebe
  e.pushState = () => {
    const [rec] = [...e.activeReviews.values()];
    if (!rec) return;
    const [sessao] = e.sessoesParaTela();
    e.vistos.push({ etapa: rec.etapa, progresso: sessao && sessao.progresso });
  };
  e.runClaudeStream = async () => {
    e.etapaNaSessao = [...e.activeReviews.values()][0].etapa;
    return { text: JSON.stringify({ ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'comment', decision: 'manual', cardMet: true, reasons: [], payloads: {}, reportMarkdown: '# ok' }), sessionId: 's1' };
  };
  return e;
}

const pr = { key: 'acme/app#7', repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7', title: 'PR', author: 'dev', requested: true };

test('revisão de verdade: as etapas seguem a ordem do fluxo, o número nunca volta e o desfecho que termina chega a 100', async () => {
  const e = motor();
  await e.runHeadlessReview({ ...pr });
  assert.equal(e.etapaNaSessao, 'codigo');
  const etapas = e.vistos.map(v => v.etapa).filter((x, i, xs) => x !== xs[i - 1]);
  assert.deepEqual(etapas, ['fontes', 'card', 'codigo', 'conferencia', 'postagem', 'concluida']);
  const numeros = e.vistos.map(v => v.progresso.percentual);
  for (let i = 1; i < numeros.length; i++) assert.ok(numeros[i] >= numeros[i - 1], numeros.join(','));
  // o total do código veio da medição real do PR (arquivos da rodada), sem leitura no dublê
  const noCodigo = e.vistos.find(v => v.etapa === 'codigo').progresso;
  assert.deepEqual([noCodigo.percentual, noCodigo.arquivosLidos, noCodigo.arquivosTotais], [20, 0, 2]);
  const fim = e.vistos.at(-1).progresso;
  assert.equal(fim.percentual, 100);
  assert.equal(e.vistos.filter(v => v.progresso.percentual === 100).length, 1);
  assert.equal(e.vistos.at(-1).etapa, 'concluida');
  // a decisão gravada leva o início da sessão nas etapas, para a próxima estimativa até o fim
  const [decisao] = e.decisions.pending;
  assert.ok(Number.isFinite(decisao.stages.inicioEm));
  // a sessão terminou: sai da tela
  assert.equal(e.activeReviews.size, 0);
});
