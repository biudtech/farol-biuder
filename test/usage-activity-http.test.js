import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-usage-http-'));
process.env.FAROL_HOME = FAROL_HOME;

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { emitirSessao } = await import('../lib/local-auth/sessoes.js');
const { diario } = await import('../lib/engine/usage-diario.js');
const { sessoesDoDiario } = await import('../lib/engine/telemetria-do-motor.js');
const { fecharTodos } = await import('../lib/telemetria/banco.js');

after(() => { fecharTodos(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

test('rota real do consumo exige sessão e origem local e não altera o diário', async () => {
  const engine = new Engine();
  engine.config.port = 0;
  engine.config.localAuth = 'exigir';
  diario(engine).inserir({ id: 'a-00000000-0000-4000-8000-000000000001', kind: 'review', status: 'ok', at: Date.now(), ref: 'org/repo#1', account: 'dev', inputTokens: 3, outputTokens: 2 });
  const before = structuredClone(sessoesDoDiario(engine));
  const server = startServer(engine);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/usage`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { Authorization: `Bearer ${emitirSessao('teste consumo')}` };
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://externo.invalid' } })).status, 403);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.completed.reviews, 1);
    assert.equal(report.totals.inputTokens + report.totals.outputTokens, 5);
    assert.deepEqual(sessoesDoDiario(engine), before);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('modalidade e provedor são registrados na execução e não seguem mudanças do perfil', () => {
  const engine = new Engine();
  engine.config.claudeProfiles = [{ id: 'api-history', kind: 'apikey', label: 'Teste' }];
  engine.recordUsage('a-record', 'dev', { usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: .1, farol_provider: 'claude', farol_billing_kind: 'apikey' }, 'Sonnet 5', 'api-history', 'org/repo#1');
  engine.config.claudeProfiles[0].kind = 'assinatura';
  const linha = sessoesDoDiario(engine).find((s) => s.id === 'a-record');
  assert.equal(linha.billingKind, 'apikey');
  assert.equal(linha.provider, 'claude');
});
