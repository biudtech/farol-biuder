// A tabela de preferências (lib/settings.js) é a FONTE ÚNICA.
//
// Queixa que originou tudo (18/08/2026): "Sistema > Automação não está salvando as
// minhas preferências, toda vez que ocorre um update perco tudo". A persistência em si
// estava certa (escrita atômica, snapshot completo, allowlist cobrindo os toggles). O
// problema era a FORMA: uma preferência morava em cinco lugares, e esquecer um deles não
// quebrava nada visível.
//
// Este arquivo também cruzava o `settingsMap` da tela antiga com a tabela. A tela saiu em
// 16/11/2026: o front novo manda só a chave editada e mostra as `ignoradas` que
// POST /api/settings devolve (test/http.test.js prova a resposta), e as chaves que ele edita
// são conferidas contra o motor no pacote dele (web/src/sistema/automacao.ts). Aqui ficam os
// padrões e o saneamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, EDITAVEIS, defaults, sanear, contaLimpa } from '../lib/settings.js';

test('defaults cobre toda a tabela e a porta entra por injeção', () => {
  const d = defaults(12345);
  for (const s of SETTINGS) assert.ok(s.key in d, `${s.key} faltando no defaults`);
  assert.equal(d.port, 12345, 'a porta vem de fora: lib/settings.js não importa constants');
});

test('port existe no config mas NÃO é editável pela tela', () => {
  // trocar porta em runtime derrubaria o servidor que respondeu o pedido
  assert.ok('port' in defaults(1), 'port existe no config');
  assert.equal(EDITAVEIS.has('port'), false, 'e não pode vir da tela');
});

test('saneamento: os defaults que ligados só desligam com valor explícito', () => {
  // reReviewResume é o caso: chave ausente não pode virar "desligado"
  assert.equal(sanear('reReviewResume', undefined, {}, {}), true);
  assert.equal(sanear('reReviewResume', false, {}, {}), false);
  // e os opt-in são o contrário: só ligam com valor verdadeiro
  assert.equal(sanear('reviewFast', undefined, {}, {}), false);
  assert.equal(sanear('reviewFast', true, {}, {}), true);
});

test('saneamento: valor inválido mantém o anterior, não derruba pro padrão', () => {
  // semântica de sempre: a tela mostra o que o engine aceitou no próximo estado
  const fns = {
    sanitizeClaudeModel: () => null, sanitizeClaudeEffort: () => null,
    sanitizeParallelReviews: () => null,
  };
  assert.equal(sanear('reviewModel', 'lixo', { reviewModel: 'opus' }, fns), 'opus');
  assert.equal(sanear('reviewEffort', 'lixo', { reviewEffort: 'high' }, fns), 'high');
  assert.equal(sanear('parallelReviews', 99, { parallelReviews: 3 }, fns), 3);
});

test('saneamento: intervalo fica no intervalo permitido', () => {
  assert.equal(sanear('intervalSeconds', 5, {}, {}), 180, 'piso');
  assert.equal(sanear('intervalSeconds', 99999, {}, {}), 3600, 'teto');
  assert.equal(sanear('intervalSeconds', 'nada', {}, {}), 300, 'lixo cai no padrão');
});

test('saneamento: as orgs da conta aceitam texto separado ou array', () => {
  assert.deepEqual(contaLimpa({ user: 'x', owners: 'a, b;c' }).owners, ['a', 'b', 'c']);
  assert.deepEqual(contaLimpa({ user: 'x', owners: [' a ', '', 'b'] }).owners, ['a', 'b']);
});
