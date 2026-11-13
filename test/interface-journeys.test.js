import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueGroups, groupedQueue } from '../ui/pure/queue-groups.js';
import { setupSteps } from '../ui/pure/setup.js';
import { roundSummaryHtml } from '../ui/pure/round-summary.js';
import { resolvedRow } from '../ui/pure/review.js';
test('grupos preservam todos os itens, ordem interna, escape e recolhimento', () => {
  const rows = [{ account: 'a', repo: '<repo>', html: '<b>1</b>' }, { account: 'b', repo: 'outro', html: '<b>2</b>' }, { account: 'a', repo: '<repo>', html: '<b>3</b>' }];
  assert.deepEqual(queueGroups(rows, 'account').map(g => g.rows.length), [2, 1]);
  const html = groupedQueue(rows, 'repo', new Set(['repo:<repo>']));
  assert.match(html, /&lt;repo&gt;/); assert.doesNotMatch(html, /<repo>/); assert.match(html, /data-queue-group="repo:&lt;repo&gt;">/);
  for (const n of [1, 2, 3]) assert.equal(html.split(`<b>${n}</b>`).length, 2);
  assert.equal(groupedQueue(rows, 'none'), '<b>1</b><b>2</b><b>3</b>');
});
test('roteiro não confunde configuração com autenticação e não aceita política sozinho', () => {
  assert.deepEqual(setupSteps({ config: { claudeProfiles: [{ id: 'p' }] } }).map(s => s.checked), [false, false, false]);
  const steps = setupSteps({ accounts: [{ tokenOk: true, owners: ['org'] }], doctor: { claudeAuth: [{ ready: true }] } });
  assert.deepEqual(steps.map(s => s.checked), [true, true, false]);
  assert.equal(setupSteps({ accounts: [{ tokenOk: true, muted: true, owners: ['org'] }] })[0].checked, false);
});
test('resumo da rodada distingue dado ausente e informação interna neutralizada', () => {
  assert.equal(roundSummaryHtml({ schema: 2 }), '');
  const html = roundSummaryHtml({ schema: 1, ordinal: 2, id: '<img>', unverified: true, droppedCount: 3 });
  assert.match(html, /Rodada 2/); assert.match(html, /Memória não verificada/); assert.match(html, /não informado pendência/);
  assert.doesNotMatch(html, /<img>/); assert.match(html, /sem resposta: 3/);
  const row = resolvedRow({ key: 'org/repo#1', status: 'posted', rounds: { schema: 1, ordinal: 2, unresolvedCount: 2 } });
  assert.match(row, /<details class="round-summary(?:\s|")/); assert.match(row, /2 pendência\(s\) rastreada\(s\)/);
  assert.doesNotMatch(row, /&lt;details/);
});
