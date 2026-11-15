// O protocolo do workspace é produto, não código: ele é re-sincronizado da fonte
// a cada boot. Se continuar mandando o modelo buscar o card num site fixo, a
// revisão de uma org de outra empresa vai atrás do Jira errado.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const PROTOCOLO = fs.readFileSync(path.join(RAIZ, 'workspace-template', 'CLAUDE.md'), 'utf8');

test('o protocolo não fixa mais um site do Jira', () => {
  assert.ok(!/[a-z0-9-]+\.atlassian\.net/i.test(PROTOCOLO), 'CLAUDE.md ainda cita um site fixo do Jira');
});

test('a revisão sabe que o card já vem lido pelo Farol', () => {
  assert.ok(/lido pelo Farol/i.test(PROTOCOLO));
});

test('a regra de card não verificável continua no protocolo', () => {
  assert.ok(/n[ãa]o[- ]verific[áa]vel/i.test(PROTOCOLO));
});

test('o protocolo da revisão instrui o caso da seção de card ausente', () => {
  assert.match(PROTOCOLO, /n[ãa]o\s+aparecer/i);
  assert.ok(/getJiraIssue/.test(PROTOCOLO), 'sem a seção, o modelo precisa saber que lê o card ele mesmo');
});

// Os dois testes abaixo travam o que o passo 2 promete nos caminhos NÃO escopados
// (revisão pelo terminal, ou prompt sem a seção de card): lá a ferramenta do Jira
// exige cloudId e alcança um tenant que pode ser de outra empresa.
test('o protocolo exige o cloudId quando a ferramenta não vem escopada', () => {
  assert.ok(/cloudId/.test(PROTOCOLO), 'sem a seção de card, chamar getJiraIssue sem cloudId é recusado no schema');
  assert.ok(/getAccessibleAtlassianResources/.test(PROTOCOLO), 'o modelo precisa saber como descobrir o site');
});

test('card lido fora do caminho escopado só vale se for da organização do PR', () => {
  assert.match(PROTOCOLO, /[Cc]onfirme[^\n]*organiza[çc][ãa]o dona deste PR/,
    'a mesma chave existe em mais de um tenant: sem confirmar a origem, o card é não-verificável');
});

test('o subagente sabe ler do escopo quando ele existe, e só cai no patch quando não existe', () => {
  const AGENTE = fs.readFileSync(path.join(RAIZ, 'workspace-template', '.claude', 'agents', 'pr-reviewer.md'), 'utf8');
  assert.match(AGENTE, /RAIZ DE ESCOPO/, 'o subagente precisa saber que a raiz pode existir');
  assert.match(AGENTE, /um arquivo por vez/i);
  assert.match(AGENTE, /Sem raiz de escopo/i, 'a revisão comum não pode ser afetada');
  assert.match(AGENTE, /n[ãa]o prova nada sobre arquivo nenhum/i);
});
