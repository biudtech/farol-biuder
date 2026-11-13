import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceRef, safeText } from '../lib/review-context/contrato.js';

test('fonte sensível, travessia e dado pessoal são recusados no contrato de contexto', () => {
  for (const p of ['../a', '/tmp/a', '.env.local', '.aws/config', 'key.pem']) assert.throws(() => sourceRef({ path: p, start: 1, end: 1 }));
  assert.equal(sourceRef({ path: 'src/100%#?.ts', start: 1, end: 1 }).path, 'src/100%#?.ts');
  assert.throws(() => safeText('GITHUB_TOKEN=ghp_' + 'a'.repeat(35), 2000, 'Nota'));
  assert.throws(() => safeText('contato: private@example.com', 2000, 'Nota'));
});
