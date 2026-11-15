// Busca do Sistema (índice e filtro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SYS_INDEX, buscarNoSistema } from '../ui/pure/sistema-busca.js';

const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

test('a busca por "orçamento" acha Plano e chaves', () => {
  const hits = buscarNoSistema(SYS_INDEX, 'orçamento', () => '');
  assert.ok(hits.map((h) => h.sec).includes('plans'));
});

test('consulta vazia não devolve nada', () => {
  assert.deepEqual(buscarNoSistema(SYS_INDEX, '  ', () => ''), []);
});

test('todo alvo "#id" do índice existe no index.html', () => {
  for (const e of SYS_INDEX) {
    if (!e.at.startsWith('#')) continue;
    assert.ok(html.includes(`id="${e.at.slice(1)}"`), `alvo ${e.at} sem id no index.html`);
  }
});
