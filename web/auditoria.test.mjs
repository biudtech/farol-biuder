import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advisoriesDoRelatorio, avaliar } from './auditoria.mjs';

const via = (id, pacote = 'picomatch') => ({
  name: pacote, title: 'ReDoS', severity: 'high', url: `https://github.com/advisories/${id}`,
});
const relatorio = (...vias) => ({
  vulnerabilities: {
    picomatch: { via: vias },
    tinyglobby: { via: ['picomatch'] },
  },
});
const excecao = (advisory, ate = '2026-12-31') => ({ advisory, motivo: 'sem versão corrigida, só desenvolvimento', ate });

test('advisory sob exceção vigente passa, e a cadeia de dependentes não conta à parte', () => {
  const r = avaliar(relatorio(via('GHSA-fc5q-39xc-vjpf')), [excecao('GHSA-fc5q-39xc-vjpf')], '2026-11-17');
  assert.equal(r.ok, true);
  assert.deepEqual(r.toleradas.map((a) => a.id), ['GHSA-FC5Q-39XC-VJPF']);
});

test('a exceção vale até o fim do dia do prazo e vence no dia seguinte', () => {
  const rel = relatorio(via('GHSA-fc5q-39xc-vjpf'));
  assert.equal(avaliar(rel, [excecao('GHSA-fc5q-39xc-vjpf')], '2026-12-31').ok, true);
  const vencida = avaliar(rel, [excecao('GHSA-fc5q-39xc-vjpf')], '2027-01-01');
  assert.equal(vencida.ok, false);
  assert.equal(vencida.reprovadas[0].vencida, true);
});

test('advisory nova reprova mesmo com a do picomatch sob exceção', () => {
  const r = avaliar(relatorio(via('GHSA-fc5q-39xc-vjpf'), via('GHSA-aaaa-bbbb-cccc', 'outro')), [excecao('GHSA-fc5q-39xc-vjpf')], '2026-11-17');
  assert.equal(r.ok, false);
  assert.deepEqual(r.reprovadas.map((a) => a.id), ['GHSA-AAAA-BBBB-CCCC']);
});

test('exceção sem motivo ou sem prazo válido não vale', () => {
  const rel = relatorio(via('GHSA-fc5q-39xc-vjpf'));
  assert.equal(avaliar(rel, [{ advisory: 'GHSA-fc5q-39xc-vjpf', ate: '2026-12-31' }], '2026-11-17').ok, false);
  assert.equal(avaliar(rel, [{ advisory: 'GHSA-fc5q-39xc-vjpf', motivo: 'x', ate: '31/12/2026' }], '2026-11-17').ok, false);
});

test('vulnerabilidade sem id de advisory reprova sempre', () => {
  const r = avaliar({ vulnerabilities: { x: { via: [{ name: 'x', title: 'algo', severity: 'high', url: '' }] } } }, [], '2026-11-17');
  assert.equal(r.ok, false);
});

test('relatório limpo passa e aponta a exceção que ficou sem uso', () => {
  const r = avaliar({ vulnerabilities: {} }, [excecao('GHSA-fc5q-39xc-vjpf')], '2026-11-17');
  assert.equal(r.ok, true);
  assert.deepEqual(r.semUso, ['GHSA-FC5Q-39XC-VJPF']);
});

test('cada advisory aparece uma vez, mesmo citada por vários pacotes', () => {
  const rel = { vulnerabilities: { a: { via: [via('GHSA-fc5q-39xc-vjpf')] }, b: { via: [via('GHSA-fc5q-39xc-vjpf')] } } };
  assert.equal(advisoriesDoRelatorio(rel).length, 1);
});

test('o arquivo de exceções versionado tem motivo e prazo em cada entrada', () => {
  const excecoes = JSON.parse(readFileSync(new URL('./auditoria-excecoes.json', import.meta.url), 'utf8'));
  for (const e of excecoes) {
    assert.match(e.advisory, /^GHSA-/);
    assert.ok(e.motivo.length > 20);
    assert.match(e.ate, /^\d{4}-\d{2}-\d{2}$/);
  }
});
