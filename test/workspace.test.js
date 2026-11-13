// lib/workspace.js: leitura dos dossiês por autor que o Farol grava no workspace. Era servida
// direto em /api/team, ou seja, tudo que a aba Time mostra passa por aqui.
//
// São parsers de markdown escrito por um modelo, então a forma real varia. O que estes
// testes travam é o contrato: nunca lançar (arquivo ausente, vazio, malformado devolvem
// lista vazia em vez de derrubar a rota) e extrair os campos do formato esperado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-workspace-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { STATE_DIR } = await import('../lib/paths.js');
const { parseTeam } = await import('../lib/workspace.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HIGHLIGHTS = path.join(STATE_DIR, 'highlights.md');
const AUTHORS = path.join(STATE_DIR, 'authors');

beforeEach(() => {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
});

/* ---------- parseTeam ---------- */

test('parseTeam: sem diretório devolve lista vazia, não lança', () => {
  assert.deepEqual(parseTeam(), []);
});

test('parseTeam: lê o dossiê, o nome do título e os blocos de review', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'alice.md'),
    '# alice (Alice Souza)\n\n' +
    '## 2026-07-28 · acme/app#10 · aprovado\n' +
    '- separou bem o caso de borda\n' +
    '- cobertura boa\n\n' +
    '## 2026-07-20 · acme/app#4 · pediu mudanças\n' +
    '- faltou tratar erro de rede\n');
  const [p] = parseTeam();
  assert.equal(p.login, 'alice');
  assert.equal(p.name, 'Alice Souza');
  assert.equal(p.entries.length, 2);
  assert.equal(p.entries[0].date, '2026-07-28');
  assert.equal(p.entries[0].ref, 'acme/app#10');
  assert.equal(p.entries[0].verdict, 'aprovado');
  assert.deepEqual(p.entries[0].bullets, ['separou bem o caso de borda', 'cobertura boa']);
});

test('parseTeam: sem nome no título, cai no login', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'bob.md'), '# bob\n\n## 2026-07-01 · a#1 · aprovado\n- ok\n');
  assert.equal(parseTeam()[0].name, 'bob');
});

test('parseTeam: ordena por review mais recente', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'antigo.md'), '# antigo\n\n## 2026-01-01 · a#1 · ok\n- x\n');
  fs.writeFileSync(path.join(AUTHORS, 'recente.md'), '# recente\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  assert.deepEqual(parseTeam().map(p => p.login), ['recente', 'antigo']);
});

test('parseTeam: dossiê sem nenhum bloco não quebra a ordenação', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'vazio.md'), '# vazio\n');
  fs.writeFileSync(path.join(AUTHORS, 'cheio.md'), '# cheio\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  const team = parseTeam();
  assert.equal(team.length, 2);
  assert.equal(team[0].login, 'cheio', 'quem tem review vem antes de quem não tem');
  assert.deepEqual(team.find(p => p.login === 'vazio').entries, []);
});

test('parseTeam: ignora arquivo que não é .md', () => {
  fs.mkdirSync(AUTHORS, { recursive: true });
  fs.writeFileSync(path.join(AUTHORS, 'alice.md'), '# alice\n\n## 2026-07-30 · b#2 · ok\n- y\n');
  fs.writeFileSync(path.join(AUTHORS, 'notas.txt'), 'nada a ver');
  assert.deepEqual(parseTeam().map(p => p.login), ['alice']);
});
