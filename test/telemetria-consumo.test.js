// As tabelas do consumo (lib/telemetria/consumo.js): cada linha do diário volta do banco igual
// à que entrou, campo a campo, inclusive o que só alguns registros têm, o nulo, o campo de tipo
// inesperado e o campo que o motor não conhece. As consultas devolvem o mesmo que as funções do
// diário em memória devolviam sobre o mesmo registro.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-consumo-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const banco = await import('../lib/telemetria/banco.js');
const consumo = await import('../lib/telemetria/consumo.js');
const { auditoriaDeConsumo, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS } = await import('../lib/engine/usage-desfechos.js');
const usage = await import('../lib/engine/usage.js');

after(() => { banco.fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

let n = 0;
function abrir() { return banco.abrirBanco(path.join(FAROL_HOME, `c-${++n}.db`)); }

// O retrato do JSON de hoje: o que o arquivo guarda é o que o JSON.stringify deixa.
const comoNoArquivo = (v) => JSON.parse(JSON.stringify(v));

// Linhas com a variedade que o usage-sessions.json real tem (medido em 16/11/2026): campos que só
// parte das linhas tem, o nulo do ref e do id, objetos aninhados, e o que nenhum escritor de hoje
// produz (tipo trocado, campo desconhecido, texto com surrogate solto).
function linhasVariadas() {
  return [
    { at: 1786454890096, day: '2026-08-01', kind: 'review', ref: 'o/r#1', account: 'dev', model: 'Opus 4.8', profileId: '',
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.1, status: 'ok' },
    { id: 'a-00000000-0000-4000-8000-000000000001', at: 1786454890097, day: '2026-08-01', kind: 'review', ref: null, account: 'dev',
      model: 'Opus 5.5', profileId: 'p1', inputTokens: 1, outputTokens: 2, thinkingTokens: 9, cacheReadTokens: 0, cacheCreationTokens: 0,
      costUsd: 0.30000000000000004, farol: '2.70.0', costSource: 'estimado', provider: 'claude', billingKind: 'apikey',
      accounting: { version: 1, sessionId: 'prov-1', source: 'result.modelUsage', scope: 'tree', snapshot: { models: { m: { inputTokens: 1 } }, costUsd: 0.3 } },
      modelUsage: { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: 0, costUSD: null } },
      status: 'descartada', attemptId: 't-1', iniciadaEm: 1786454890000, provedorPodeTerContinuado: true, resumeOutcome: 'nova', corrigidoEm: 1786454899999 },
    { id: null, at: 1786454890098, day: '2026-08-02', kind: 'self', ref: 'x\ud800', account: 'dev', model: 'desconhecido', profileId: 'p1',
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, costSource: 'desconhecido', status: 'interrompida',
      campoQueNinguemConhece: { lista: [1, 'dois', null] } },
    { id: 'pb-1', at: 1786454890099, day: '2026-08-02', kind: 'pushback', ref: 7, account: 'dev', model: 'Sonnet 5', profileId: 0,
      inputTokens: '12', outputTokens: 1.5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: '0.5', status: 'erro', costSource: 'sem-base',
      motivoCortado: 'abc\ud83d' },
  ];
}

test('cada linha volta do banco igual à que o arquivo guardava, na mesma ordem', () => {
  const h = abrir();
  try {
    const linhas = linhasVariadas();
    banco.transacao(h, () => { for (const l of linhas) consumo.inserirSessao(h, l); });
    assert.deepEqual(consumo.todasAsSessoes(h), comoNoArquivo(linhas));
    assert.equal(consumo.contarSessoes(h), 4);
    assert.deepEqual(consumo.primeiraSessao(h), comoNoArquivo(linhas[0]));
    // a leitura do relatório de GET /api/usage: a mesma linha, sem o accounting (que ele não lê)
    const semAccounting = comoNoArquivo(linhas).map(({ accounting, ...resto }) => resto);
    assert.deepEqual(consumo.sessoesDaAtividade(h), semAccounting);
  } finally { banco.fecharBanco(h); }
});

test('inteiro acima do MAX_SAFE_INTEGER vai para extra: a leitura não lança e o valor volta igual', () => {
  const h = abrir();
  try {
    const linha = { id: 'a-grande', at: 2 ** 53, inputTokens: 2 ** 53, outputTokens: Number.MAX_SAFE_INTEGER, costUsd: 2 ** 53, status: 'ok' };
    consumo.inserirSessao(h, linha);
    assert.deepEqual(consumo.todasAsSessoes(h), [linha]);
    assert.deepEqual(consumo.sessoesDaAtividade(h), [linha]);
    assert.equal(consumo.somasDasSessoes(h).sessoes, 1);
  } finally { banco.fecharBanco(h); }
});

test('a chave de uma linha do diário é estável e separa as linhas do diário real', () => {
  const linhas = linhasVariadas();
  const chaves = linhas.map(consumo.chaveDaSessao);
  assert.equal(new Set(chaves).size, linhas.length);
  assert.equal(consumo.chaveDaSessao({ ...linhas[1], status: 'erro' }), chaves[1], 'o desfecho marcado depois não muda a chave');
  const h = abrir();
  try {
    for (const l of linhas) consumo.inserirSessao(h, l);
    assert.deepEqual([...consumo.chavesDasSessoes(h)].sort(), [...chaves].sort());
  } finally { banco.fecharBanco(h); }
});

test('campo com valor undefined não vira nulo: some, como no arquivo', () => {
  const h = abrir();
  try {
    consumo.inserirSessao(h, { id: 'a-u', at: 5, thinkingTokens: undefined, accounting: undefined, modelUsage: undefined, status: 'ok' });
    const [linha] = consumo.todasAsSessoes(h);
    assert.deepEqual(Object.keys(linha).sort(), ['at', 'id', 'status']);
  } finally { banco.fecharBanco(h); }
});

test('recentes: as N mais novas, a mais nova primeiro, como o slice(-N).reverse() do diário', () => {
  const h = abrir();
  try {
    const linhas = Array.from({ length: 30 }, (_, i) => ({ id: `a-${i}`, at: 1000 + i, status: 'ok', costUsd: i / 10 }));
    banco.transacao(h, () => { for (const l of linhas) consumo.inserirSessao(h, l); });
    assert.deepEqual(consumo.sessoesRecentes(h, 7), linhas.slice(-7).reverse());
    assert.deepEqual(consumo.sessoesRecentes(h, 100), linhas.slice(-100).reverse());
  } finally { banco.fecharBanco(h); }
});

test('marcar o desfecho corrige só a linha mais recente com aquele id', () => {
  const h = abrir();
  try {
    for (const at of [1, 2]) consumo.inserirSessao(h, { id: 'a-dup', at, status: 'ok' });
    consumo.inserirSessao(h, { id: 'a-outra', at: 3, status: 'ok' });
    assert.equal(consumo.marcarStatusDaSessao(h, 'a-dup', 'descartada'), true);
    assert.deepEqual(consumo.todasAsSessoes(h).map((s) => s.status), ['ok', 'descartada', 'ok']);
    assert.equal(consumo.marcarStatusDaSessao(h, 'a-nenhuma', 'erro'), false);
  } finally { banco.fecharBanco(h); }
});

test('tentativa já registrada é achada pelo attemptId', () => {
  const h = abrir();
  try {
    consumo.inserirSessao(h, { id: 'a-1', at: 1, attemptId: 't-9' });
    assert.equal(consumo.temTentativa(h, 't-9'), true);
    assert.equal(consumo.temTentativa(h, 't-8'), false);
  } finally { banco.fecharBanco(h); }
});

test('o cursor da retomada acha a mesma linha que o findLast do diário em memória', () => {
  const h = abrir();
  try {
    const linhas = [
      { id: 'a-1', at: 1, account: 'dev', profileId: 'p1', accounting: { sessionId: 's-1', snapshot: { n: 1 } } },
      { id: 'a-2', at: 2, account: 'dev', profileId: 'p1', accounting: { sessionId: 's-1', snapshot: { n: 2 } } },
      { id: 'a-3', at: 3, account: 'dev', profileId: 'p2', accounting: { sessionId: 's-1', snapshot: { n: 3 } } },
      { id: 'a-4', at: 4, account: 'outra', profileId: 'p1', accounting: { sessionId: 's-1' } },
      { id: 'a-5', at: 5, account: 'dev', accounting: { sessionId: 's-2' } },
      { id: 'a-6', at: 6, account: 'dev', profileId: '', accounting: 'texto' },
    ];
    for (const l of linhas) consumo.inserirSessao(h, l);
    const casos = [[{ account: 'dev', profileId: 'p1' }, 's-1'], [{ account: 'dev', profileId: 'p2' }, 's-1'],
      [{ account: 'dev', profileId: '' }, 's-2'], [{ account: 'dev', profileId: 'p1' }, 's-3'], [{ account: 'outra', profileId: 'p1' }, 's-1']];
    for (const [identidade, sid] of casos) {
      const esperado = linhas.findLast((r) => r.account === identidade.account && (r.profileId || '') === identidade.profileId && r.accounting?.sessionId === sid);
      assert.deepEqual(consumo.anteriorDoCursor(h, identidade, sid), esperado, `${identidade.account}/${identidade.profileId}/${sid}`);
    }
  } finally { banco.fecharBanco(h); }
});

test('a amostra da taxa dá a mesma taxa observada que o diário inteiro dava', () => {
  const h = abrir();
  try {
    const linhas = [];
    for (let i = 0; i < 40; i++) {
      linhas.push({ id: `a-${i}`, at: i, kind: i % 3 ? 'review' : 'pushback', model: i % 2 ? 'Opus 5.5' : 'Sonnet 5',
        status: i % 5 ? 'ok' : 'erro', costUsd: i % 7 ? i * 0.013 : 0, outputTokens: i % 11 ? i * 17 : 0 });
    }
    linhas.push({ id: 'a-tipo', at: 99, kind: 'review', model: 'Opus 5.5', status: 'ok', costUsd: '0.9', outputTokens: '30' });
    for (const l of linhas) consumo.inserirSessao(h, l);
    for (const model of ['Opus 5.5', 'Sonnet 5', 'Haiku']) {
      for (const kind of ['review', 'pushback']) {
        assert.equal(usage.taxaObservada(consumo.amostraDaTaxa(h, model), kind, model), usage.taxaObservada(linhas, kind, model), `${model}/${kind}`);
      }
    }
  } finally { banco.fecharBanco(h); }
});

test('a auditoria do banco é a mesma da auditoria em memória, até o último bit do custo', () => {
  const h = abrir();
  try {
    const linhas = [...linhasVariadas()];
    const status = ['ok', 'erro', 'cancelada', 'parcial', 'descartada', 'interrompida', 'outro'];
    const origens = [undefined, 'medido', 'estimado', 'desconhecido', 'sem-base'];
    for (let i = 0; i < 2000; i++) {
      linhas.push({ id: `a-${i}`, at: i, status: status[i % status.length], costSource: origens[i % origens.length],
        costUsd: ((i * 7919) % 1000) / 37 + 0.1 });
    }
    banco.transacao(h, () => { for (const l of linhas) consumo.inserirSessao(h, l); });
    const vocabulario = { perdidos: [...DESFECHOS_PERDIDOS], desconhecidas: [...ORIGENS_DESCONHECIDAS] };
    assert.deepEqual(consumo.auditoriaDasSessoes(h, vocabulario), auditoriaDeConsumo(comoNoArquivo(linhas)));
  } finally { banco.fecharBanco(h); }
});

test('as somas da conferência da migração batem com as do diário em memória', () => {
  const h = abrir();
  try {
    const linhas = linhasVariadas();
    for (const l of linhas) consumo.inserirSessao(h, l);
    assert.deepEqual(consumo.somasDasSessoes(h), consumo.somasDoDiario(comoNoArquivo(linhas)));
  } finally { banco.fecharBanco(h); }
});
