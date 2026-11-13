import test from 'node:test';
import assert from 'node:assert/strict';
import { roundMemoryBlock } from '../lib/engine/review-findings.js';

test('memória tem uma evidência por id e referências estáveis para todos blockers', () => {
  const finding = { id: 'round:f1', severity: 'blocking', causa: 'defeito_codigo', title: 'contrato', summary: 'restrição', evidence: 'src/a.js:1' };
  const block = roundMemoryBlock({ status: 'ready', parents: [{ id: 'round', headSha: 'a', baseSha: 'b', findings: [finding], unresolved: [finding] }] });
  const data = JSON.parse(block.trim().split('\n').at(-1));
  assert.deepEqual(data.blockerRefs, ['round:f1']);
  assert.deepEqual(data.previousFindings, [finding]);
});
