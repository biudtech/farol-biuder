// Inventário das rotas /api (A4, spec 7.A4): toda rota que o servidor roteia tem classe.
// Rota nova sem classe reprova aqui. A lista do servidor é DERIVADA do fonte, com o mesmo
// extrator do test/ui-contract.test.js, para não virar tabela curada que envelhece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas } from '../lib/local-auth/inventario.js';

const SERVERJS = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'http-server.js'), 'utf8');
function rotasServidas() {
  return new Set([...SERVERJS.matchAll(/p === '(\/api\/[^']+)'/g)].map(m => m[1]));
}

test('o extrator de rotas não está cego', () => {
  const servidas = rotasServidas();
  assert.ok(servidas.has('/api/decide'));
  assert.ok(servidas.size >= 30, `esperava pelo menos 30 rotas, achei ${servidas.size}`);
});

test('toda rota servida tem classe no inventário', () => {
  const semClasse = [...rotasServidas()].filter(r => !classeDaRota(r));
  assert.deepEqual(semClasse, [], `rota sem classe (classifique em lib/local-auth/inventario.js conforme a spec 7.A4): ${semClasse.join(', ')}`);
});

test('nenhuma rota aparece em duas classes', () => {
  const todas = todasAsRotas();
  assert.equal(new Set(todas).size, todas.length);
});

// O número é tripwire de rota nova entrando sem classe. Ele muda quando o conjunto de
// rotas muda de propósito. Chegou a 91 antes do corte da Fase 1.
// O corte da Fase 1 (lote 2) tirou auditoria de revisão, transferência de preferências, chat (4 rotas), candidatos a reviewer e pedido de reviewers (91 virou 83).
// O corte da Fase 1 (lote 3) tirou /api/update, o auto-update (83 virou 82).
// O corte da Fase 1 (lote 7) tirou /api/highlights, /api/deliveries, /api/tool, /api/tool/clear e /api/log/clear (82 virou 77).
// O corte da Fase 1 (lote 8) tirou /api/specialists e /api/capacity (77 virou 75).
// O corte da Fase 1 (lote 11) tirou a autoanálise e Meus PRs: /api/self-review, /restricted, /merge, /visibility, /cancel, /agent/request, /agent/read, /agent/list, /api/pr/hide e /api/pr/unhide (69 virou 59).
// O corte da Fase 1 (lote 9, só Claude) tirou /api/claude-login, /api/claude/login-web/start, /code e /cancel, /api/claude/profile-adopt e /api/self-review/restricted/codex (75 virou 69).
// O corte da Fase 1 (lote 12) tirou a sessão de terminal: /api/review/post e /api/session-exit (59 virou 57).
// O corte da Fase 1 (lote 13b) tirou as 31 rotas da coordenação entre instalações, e com elas a
// classe de leitura de baixo risco, que só tinha uma delas: as não públicas foram de 56 a 25. O
// título contava 57 e eram 58 com as duas públicas; agora são 27.
// Em 15/11/2026 a assinatura do Claude voltou (decisão do dono) e com ela o login pela tela:
// /api/claude/login-web/start, /code e /cancel. As não públicas foram de 25 a 28, e o total de 27 a 30.
test('as classes da spec cobrem os 30 caminhos, e as públicas são só as duas de autenticação', () => {
  const naoPublicas = Object.entries(CLASSES).filter(([c]) => c !== 'autenticacao-publica').flatMap(([, rotas]) => rotas);
  assert.equal(naoPublicas.length, 28);
  assert.deepEqual(CLASSES['autenticacao-publica'].slice().sort(), ['/api/auth/pair', '/api/auth/status']);
  assert.deepEqual(Object.keys(CLASSES).sort(), ['autenticacao-publica', 'demais', 'destrutiva', 'escreve-github', 'evento', 'leitura-sensivel', 'recebe-segredo', 'sessao-paga']);
});

test('toda rota inventariada existe no servidor (sem classe morta)', () => {
  const servidas = rotasServidas();
  const mortas = todasAsRotas().filter(r => !servidas.has(r));
  assert.deepEqual(mortas, [], `rota inventariada que o servidor não roteia: ${mortas.join(', ')}`);
});

test('a exceção pública depende do método', () => {
  assert.deepEqual({ ...PUBLICAS }, { '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/pair'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/status'), true);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/auth/pair'), false);
  assert.equal(rotaPublicaDeAutenticacao('POST', '/api/auth/status'), false);
  assert.equal(rotaPublicaDeAutenticacao('GET', '/api/state'), false);
});
