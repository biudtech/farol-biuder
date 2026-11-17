// A porcentagem da revisão em andamento: marcos por etapa, leitura de arquivos só na etapa de
// código, tempo restante só com histórico, nunca regride e 100 só quando o desfecho terminou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularProgresso, progressoDaSessao, marcarEtapa, ETAPAS, CONCLUIDA } from '../lib/engine/progresso-revisao.js';
import { projectSessions } from '../lib/engine/sessao-projecao.js';
import { pushActivity } from '../lib/engine/session.js';
import { marcarFase } from '../lib/engine/etapas-revisao.js';
import { anotarEstimativa } from '../lib/engine/estimativa-sessao.js';
import { concluirRevisao } from '../lib/engine/desfecho-da-revisao.js';

const MIN = 60000;

function engineCom(rec, extra = {}) {
  let empurros = 0;
  const eventos = [];
  const engine = {
    activeReviews: new Map([['a1', rec]]),
    activity: new Map([['a1', []]]),
    pushState: () => { empurros++; },
    emit: (nome, dados) => eventos.push({ nome, dados }),
    ...extra,
  };
  return { engine, empurros: () => empurros, eventos };
}

test('marcos: cada etapa fica no marco de entrada, sem interpolar onde não há sinal', () => {
  assert.deepEqual(ETAPAS.map(e => e.ate), [10, 20, 65, 90, 100]);
  assert.deepEqual(calcularProgresso({ etapa: 'fontes' }), { percentual: 0, etapa: 1, totalEtapas: 5, rotuloDaEtapa: 'fontes' });
  assert.equal(calcularProgresso({ etapa: 'card' }).percentual, 10);
  assert.equal(calcularProgresso({ etapa: 'codigo' }).percentual, 20);
  assert.equal(calcularProgresso({ etapa: 'conferencia' }).percentual, 65);
  assert.equal(calcularProgresso({ etapa: 'conferencia' }).rotuloDaEtapa, 'conferência dos achados');
  assert.equal(calcularProgresso({ etapa: 'postagem' }).percentual, 90);
  assert.equal(calcularProgresso({ etapa: 'postagem' }).etapa, 5);
});

test('100 só com o desfecho concluído, e sem tempo restante', () => {
  for (const etapa of ['fontes', 'card', 'codigo', 'conferencia', 'postagem']) {
    assert.ok(calcularProgresso({ etapa, lidos: 99, arquivos: 1 }).percentual < 100, etapa);
  }
  const fim = calcularProgresso({ etapa: CONCLUIDA, tipicoMs: 10 * MIN, decorridoMs: MIN });
  assert.deepEqual(fim, { percentual: 100, etapa: 5, totalEtapas: 5, rotuloDaEtapa: 'postagem' });
});

test('código: arquivos lidos sobre os arquivos da rodada, entre 20 e 65', () => {
  const p = calcularProgresso({ etapa: 'codigo', lidos: 9, arquivos: 20 });
  assert.equal(p.percentual, 20 + Math.floor((45 * 9) / 20));
  assert.equal(p.arquivosLidos, 9);
  assert.equal(p.arquivosTotais, 20);
  // leitura além do total (releitura) não passa do marco da etapa
  const alem = calcularProgresso({ etapa: 'codigo', lidos: 30, arquivos: 20 });
  assert.equal(alem.percentual, 65);
  assert.equal(alem.arquivosLidos, 20);
  // fora do código, a contagem de arquivos não vai
  assert.equal(calcularProgresso({ etapa: 'conferencia', lidos: 3, arquivos: 20 }).arquivosTotais, undefined);
  // sem o total medido, o código fica no marco e sem contagem
  const semTotal = calcularProgresso({ etapa: 'codigo', lidos: 4 });
  assert.equal(semTotal.percentual, 20);
  assert.equal(semTotal.arquivosLidos, undefined);
});

test('tempo restante: só com a mediana real do histórico, nunca chutado', () => {
  assert.equal(calcularProgresso({ etapa: 'codigo', decorridoMs: MIN }).restanteEstimadoMs, undefined);
  assert.equal(calcularProgresso({ etapa: 'codigo', tipicoMs: 6 * MIN, decorridoMs: 2 * MIN }).restanteEstimadoMs, 4 * MIN);
  // já além da mediana: o motor não sabe quanto falta, e o campo sai
  assert.equal(calcularProgresso({ etapa: 'conferencia', tipicoMs: 6 * MIN, decorridoMs: 7 * MIN }).restanteEstimadoMs, undefined);
});

test('sessão sem etapa (chat, ferramentas) não ganha progresso', () => {
  assert.equal(calcularProgresso({}), null);
  assert.equal(calcularProgresso({ etapa: 'outra' }), null);
  assert.equal(progressoDaSessao({ startedAt: 1 }), null);
  const [s] = projectSessions([{ id: 'c1', startedAt: 1 }]);
  assert.equal('progresso' in s, false);
});

test('monotônico: a sequência real de sinais de uma revisão nunca faz o número voltar', () => {
  const rec = { id: 'a1', etapa: 'fontes', startedAt: 0 };
  const { engine } = engineCom(rec);
  const visto = [];
  const olhar = () => visto.push(progressoDaSessao(rec, 1000).percentual);
  olhar();
  anotarEstimativa({ ...engine, decisions: { resolved: [] } }, 'a1', { changedFiles: 4, files: ['a', 'b', 'c', 'd'].map(path => ({ path, lines: 1 })) });
  olhar();
  marcarEtapa(engine, 'a1', 'card'); olhar();
  marcarEtapa(engine, 'a1', 'codigo'); olhar();
  rec.filesRead = new Set();
  for (const f of ['a', 'fora-da-rodada', 'b', 'a', 'c', 'd']) { rec.filesRead.add(f); olhar(); }
  // marca atrasada fora de ordem é ignorada
  marcarEtapa(engine, 'a1', 'card'); olhar();
  marcarFase(engine, 'a1', 'fechando'); olhar();
  marcarEtapa(engine, 'a1', 'codigo'); olhar();
  marcarEtapa(engine, 'a1', 'postagem'); olhar();
  marcarEtapa(engine, 'a1', CONCLUIDA); olhar();
  for (let i = 1; i < visto.length; i++) assert.ok(visto[i] >= visto[i - 1], `regrediu em ${i}: ${visto.join(',')}`);
  assert.equal(visto.at(-1), 100);
  assert.equal(visto.filter(v => v === 100).length, 1);
  assert.ok(visto.includes(65));
});

test('marcarEtapa: só avança, empurra o estado quando muda e ignora sessão sem etapa', () => {
  const rec = { etapa: 'codigo' };
  const { engine, empurros } = engineCom(rec);
  marcarEtapa(engine, 'a1', 'card');
  marcarEtapa(engine, 'a1', 'codigo');
  marcarEtapa(engine, 'a1', 'invalida');
  assert.equal(rec.etapa, 'codigo');
  assert.equal(empurros(), 0);
  marcarEtapa(engine, 'a1', 'conferencia');
  assert.equal(rec.etapa, 'conferencia');
  assert.equal(empurros(), 1);
  const semEtapa = {};
  marcarEtapa(engineCom(semEtapa).engine, 'a1', 'card');
  assert.equal(semEtapa.etapa, undefined);
});

test('projeção: o progresso vai no estado e o Set da rodada não', () => {
  const rec = { id: 'a1', etapa: 'codigo', startedAt: 0, estimativa: { tipicoMs: 10 * MIN },
    arquivosALer: new Set(['x', 'y']), filesRead: new Set(['x']) };
  const [s] = projectSessions([rec], 4 * MIN);
  assert.equal('arquivosALer' in s, false);
  assert.deepEqual(s.progresso, { percentual: 42, etapa: 3, totalEtapas: 5, rotuloDaEtapa: 'código',
    arquivosLidos: 1, arquivosTotais: 2, restanteEstimadoMs: 6 * MIN });
  assert.equal(s.lidos, 1);
});

test('SSE: a linha nova do feed leva o progresso, e a de verificação abre a conferência', () => {
  const rec = { id: 'a1', etapa: 'codigo', startedAt: Date.now() };
  const { engine, eventos } = engineCom(rec);
  pushActivity(engine, 'a1', 'tool', 'Read a.js', undefined, 'leitura');
  assert.equal(eventos[0].dados.progresso.percentual, 20);
  pushActivity(engine, 'a1', 'text', 'FAROL_CHECKPOINT', undefined, 'verificacao');
  assert.equal(rec.etapa, 'conferencia');
  assert.equal(eventos.at(-1).dados.progresso.percentual, 65);
  // sessão sem etapa: o evento sai como antes, sem o campo
  const chat = engineCom({ id: 'a1' });
  pushActivity(chat.engine, 'a1', 'text', 'oi');
  assert.equal('progresso' in chat.eventos[0].dados, false);
});

test('desfecho: entra na postagem ao começar e conclui só quando termina sem lançar', async () => {
  const etapas = [];
  const rec = { etapa: 'conferencia' };
  const { engine } = engineCom(rec, { pushState: () => etapas.push(rec.etapa) });
  // o desfecho mínimo que lança logo no começo: a sessão fica na postagem, nunca em 100
  engine.attentionPoints = () => { throw new Error('falhou'); };
  await assert.rejects(concluirRevisao(engine, { id: 'a1', pr: { key: 'o/r#1' }, result: {} }), /falhou/);
  assert.deepEqual(etapas, ['postagem']);
  assert.notEqual(progressoDaSessao(rec).percentual, 100);
});
