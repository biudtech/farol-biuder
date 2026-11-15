// D11 do contrato da sincronização: falha de coordenação entre dispositivos nunca
// estaciona e nunca entra no retryAfterNet. A classe 'coordenacao-indisponivel' da
// taxonomia é 'transitorio' (é o que o Diagnóstico precisa ler), e esse kind, no
// runOneHeadless, levaria ao retry com teto e depois ao estacionamento. A garantia
// mora no próprio runOneHeadless, que reconhece a classe antes de decidir retry.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-sync-coord-nao-estaciona-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const MSG_COORDENACAO = 'coordenação entre dispositivos indisponível: fetch failed';

function engineBase() {
  const e = new Engine();
  e.accountForPr = (pr) => pr.account || 'eu';
  e.tokens = { eu: 'tok-eu' };
  e.log = () => { };
  e.prState = async () => 'OPEN';
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, head: '', quem: [], decisivos: [] });
  return e;
}
const prDe = (key) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

test('runOneHeadless: rede comum continua no retry de sempre (a exceção é só da coordenação)', async () => {
  const e = engineBase();
  const pr = prDe('o/r#3');
  e.runHeadlessReview = async () => { throw new Error('fetch failed'); };
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.retryAfterNet.get(pr.key).tries, 1);
});
