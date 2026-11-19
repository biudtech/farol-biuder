// A execução do detalhe de uma revisão (GET /api/decision) com as tentativas uma a uma e os perfis
// usados (redesenho, lote 2, 19/11/2026): o Histórico mostra cada sessão da rodada, com o modelo, o
// perfil do Claude, a duração, o custo e se retomou a conversa anterior.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { execucaoDasLinhas } = await import('../lib/engine/detalhe-da-decisao.js');

const linha = (at, extra = {}) => ({ id: 'a-1', at, iniciadaEm: at - 60_000, kind: 'review', ref: 'acme/app#7', account: 'revisora',
  model: 'Opus 4.1', profileId: 'assinatura-a', costUsd: 2, costSource: 'medido', status: 'ok', ...extra });

test('as sessões da rodada, da mais antiga para a mais nova, com o que cada uma sabe', () => {
  const e = execucaoDasLinhas([
    linha(2_000_000, { attemptId: 't-2', profileId: 'assinatura-b', model: 'Sonnet 4.5', resumeOutcome: 'retomada', gatilho: 'commit_novo' }),
    linha(1_000_000, { attemptId: 't-1', status: 'erro', costSource: 'desconhecido', iniciadaEm: undefined }),
  ]);
  assert.deepEqual(e.perfis, ['assinatura-a', 'assinatura-b']);
  assert.deepEqual(e.sessoes, [
    { id: 't-1', em: 1_000_000, modelo: 'Opus 4.1', perfil: 'assinatura-a', status: 'erro', gatilho: 'primeira', retomada: null },
    { id: 't-2', em: 2_000_000, modelo: 'Sonnet 4.5', perfil: 'assinatura-b', status: 'ok', gatilho: 'commit_novo', retomada: 'retomada',
      duracaoMs: 60_000, custoUsd: 2 },
  ]);
});

test('sem attemptId vale o id da sessão; perfil vazio e modelo desconhecido saem nulos; o perfil vazio não entra nos perfis', () => {
  const e = execucaoDasLinhas([linha(1_000_000, { profileId: '', model: 'desconhecido', resumeOutcome: 'inventado' })]);
  assert.deepEqual(e.perfis, []);
  assert.deepEqual(e.sessoes, [{ id: 'a-1', em: 1_000_000, modelo: null, perfil: null, status: 'ok', gatilho: 'primeira', retomada: null, duracaoMs: 60_000, custoUsd: 2 }]);
});

test('teto de sessões e de perfis: as mais recentes ficam', () => {
  const muitas = Array.from({ length: 30 }, (_, i) => linha(1_000_000 + i, { attemptId: `t-${i}`, profileId: `p-${i}` }));
  const e = execucaoDasLinhas(muitas);
  assert.equal(e.tentativas, 30, 'a contagem continua sendo de todas');
  assert.equal(e.sessoes.length, 20);
  assert.equal(e.sessoes.at(-1).id, 't-29');
  assert.equal(e.perfis.length, 10);
});
