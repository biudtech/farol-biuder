import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { listar, refsForaDeTodo } from '../tools/quality/higiene.js';

test('TODO(BT-123) e legitimo; BT-123 solto conta', () => {
  assert.equal(refsForaDeTodo('// TODO(BT-123): migrar'), 0);
  assert.equal(refsForaDeTodo('// veio do card BT-123'), 1);
  assert.equal(refsForaDeTodo('// BT-1 e BUGS-22 juntos'), 2);
});

// O front (`web/`) tem gate próprio: a higiene do motor não lê os arquivos dele (o
// package-lock de lá, sozinho, tem milhares de linhas). Só a `web` da raiz sai.
test('a higiene nao lista o front da raiz, e lista uma pasta web que nao e a da raiz', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'farol-higiene-web-'));
  try {
    for (const dir of ['lib', 'lib/web', 'web', 'web/src']) {
      mkdirSync(join(raiz, ...dir.split('/')), { recursive: true });
      writeFileSync(join(raiz, ...dir.split('/'), 'a.js'), '// nada\n', 'utf8');
    }
    const achados = listar(raiz).map((p) => p.slice(raiz.length + 1).split(sep).join('/')).sort();
    assert.deepEqual(achados, ['lib/a.js', 'lib/web/a.js']);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
