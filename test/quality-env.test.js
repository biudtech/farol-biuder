import { test } from 'node:test';
import assert from 'node:assert/strict';
import env from '../lib/env.js';

test('env e preguicoso: stub setado DEPOIS do require e enxergado', () => {
  const antes = process.env.FAROL_HEADLESS_CMD;
  try {
    delete process.env.FAROL_HEADLESS_CMD;
    assert.equal(env.headlessCmdStub(), undefined);
    process.env.FAROL_HEADLESS_CMD = 'node fake.js';
    assert.equal(env.headlessCmdStub(), 'node fake.js');
  } finally {
    if (antes === undefined) delete process.env.FAROL_HEADLESS_CMD;
    else process.env.FAROL_HEADLESS_CMD = antes;
  }
});

test('debugSpawns liga e desliga pelo setter', () => {
  env.setDebugSpawns(true);
  assert.equal(env.debugSpawns(), true);
  env.setDebugSpawns(false);
  assert.equal(env.debugSpawns(), false);
});
