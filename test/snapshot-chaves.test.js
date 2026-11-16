// A lista FECHADA de chaves de topo do snapshot (corte da Fase 1, lote 15). O snapshot é o
// contrato que a tela lê por `GET /api/state` e pelo SSE: chave nova entra aqui de propósito,
// com quem a lê; chave do que saiu do motor não volta por descuido.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-snapshot-chaves-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

// A lista do plano da Fase 1 (Task 15), com duas diferenças medidas no lote:
// - `staleStates` não está: saiu no lote 10, junto do Panorama, que era quem a escrevia e lia.
// - `headlessWaitingPrs` está: é a lista dos PRs pedidos que esperam vaga, com a conta que
//   revisa cada um, e a fila de Pra mim (ui/telas/radar.js) a desenha. A definição é do motor
//   (lib/engine/headless-fila.js); a tela só fatia.
const CHAVES = [
  'app', 'modelos', 'claudePerfis', 'status', 'error', 'baseline', 'account', 'accounts',
  'pushbacks', 'config', 'jiraSites', 'lastCheckAt', 'nextCheckAt', 'buscasPausadas', 'queue',
  'inicioAutomatico', 'esperaConflito', 'parked', 'reRounds', 'activeSessions', 'activity',
  'headlessWaiting', 'headlessWaitingPrs', 'headlessWaitingDetails', 'filaJusta', 'decisions',
  'reviewActions', 'usage', 'doctor', 'paths',
];

test('o snapshot tem exatamente as chaves da lista fechada', () => {
  assert.deepEqual(Object.keys(new Engine().snapshot()).sort(), CHAVES.slice().sort());
});

test('a lista fechada não repete chave nem traz as do que saiu do motor', () => {
  assert.equal(new Set(CHAVES).size, CHAVES.length);
  const sairam = ['myPRs', 'selfAnalyses', 'chats', 'toolRuns', 'sync', 'casca', 'update', 'interventions',
    'panorama', 'prontidao', 'staleStates', 'capacidades', 'headlessWaitingContas'];
  assert.deepEqual(CHAVES.filter(c => sairam.includes(c)), []);
});
