// As duas chaves da fronteira hospedada (hostPublico e origensPermitidas) no BOOT: lidas só
// do arquivo, saneadas uma vez, e valor torto no config.json nunca derruba o motor nem
// libera nada. Também: quem não usa as chaves não as ganha no arquivo, e a tela não as muda.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-fronteira-config-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
const { exigeAutenticacao } = await import('../lib/local-auth/modo.js');
const { validarHostEOrigem } = await import('../lib/http-guard.js');

function gravar(config) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, typeof config === 'string' ? config : JSON.stringify(config));
}
function configGravada() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test('sem as chaves no arquivo o motor nasce em loopback puro e não as carimba no config.json', () => {
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, '');
  assert.deepEqual(engine.config.origensPermitidas, []);
  assert.equal(exigeAutenticacao({ config: engine.config }), false);
  engine.updateSettings({ soundEnabled: false });
  const gravado = configGravada();
  assert.equal('hostPublico' in gravado, false);
  assert.equal('origensPermitidas' in gravado, false);
});

test('valores válidos no arquivo entram saneados e ligam a exigência de autenticação', () => {
  gravar({ hostPublico: 'Farol.Exemplo.com', origensPermitidas: ['https://painel.exemplo.com', 'https://painel.exemplo.com/', '*', 'http://localhost:3000'] });
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  assert.deepEqual(engine.config.origensPermitidas, ['https://painel.exemplo.com', 'http://localhost:3000']);
  assert.equal(exigeAutenticacao({ config: engine.config }), true);
  engine.updateSettings({ soundEnabled: false });
  assert.equal(configGravada().hostPublico, 'farol.exemplo.com', 'salvar preferência não apaga o que veio do arquivo');
  assert.deepEqual(configGravada().origensPermitidas, ['https://painel.exemplo.com', 'http://localhost:3000']);
});

const TORTOS = [
  { hostPublico: 'https://farol.exemplo.com', origensPermitidas: 'https://painel.exemplo.com' },
  { hostPublico: 'farol.exemplo.com:443', origensPermitidas: ['*'] },
  { hostPublico: { nome: 'farol.exemplo.com' }, origensPermitidas: { 0: 'https://painel.exemplo.com' } },
  { hostPublico: ['farol.exemplo.com'], origensPermitidas: [['https://painel.exemplo.com']] },
  { hostPublico: 42, origensPermitidas: 42 },
  { hostPublico: null, origensPermitidas: null },
  { hostPublico: true, origensPermitidas: true },
  { hostPublico: '*', origensPermitidas: [null, 7, {}, '', 'null', 'https://*.exemplo.com', 'http://painel.exemplo.com'] },
  { hostPublico: 'farol.exemplo.com\r\nx: 1', origensPermitidas: ['https://painel.exemplo.com\r\nSet-Cookie: a=b'] },
];

for (const torto of TORTOS) {
  test(`valor inválido no arquivo não derruba o boot e vira vazio: ${JSON.stringify(torto)}`, () => {
    gravar(torto);
    const engine = new Engine();
    assert.equal(engine.config.hostPublico, '');
    assert.deepEqual(engine.config.origensPermitidas, []);
    // vazio é loopback puro: o nome e a origem de fora seguem recusados pela allowlist
    const base = { porta: 47170, bind: engine.config.bind, hostPublico: engine.config.hostPublico, origensPermitidas: engine.config.origensPermitidas };
    assert.equal(validarHostEOrigem({ ...base, host: 'farol.exemplo.com' }).ok, false);
    assert.equal(validarHostEOrigem({ ...base, host: '' }).ok, false);
    assert.equal(validarHostEOrigem({ ...base, host: '127.0.0.1:47170', origin: 'https://painel.exemplo.com' }).ok, false);
    assert.equal(validarHostEOrigem({ ...base, host: '127.0.0.1:47170', origin: '*' }).ok, false);
    assert.equal(validarHostEOrigem({ ...base, host: '127.0.0.1:47170' }).ok, true);
  });
}

test('config.json que não é JSON não derruba o boot', () => {
  gravar('{ "hostPublico": "farol.exemplo.com", ');
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, '');
  assert.deepEqual(engine.config.origensPermitidas, []);
});

test('updateSettings e editarConta devolvem as duas chaves sem mudar nada', () => {
  gravar({ hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'], conta: { user: 'revisora', owners: ['biudtech'] } });
  const engine = new Engine();
  const r = engine.updateSettings({ hostPublico: '', origensPermitidas: [], localAuth: '' });
  assert.deepEqual(r.ignoradas.slice().sort(), ['hostPublico', 'localAuth', 'origensPermitidas']);
  engine.updateSettings({ hostPublico: 'atacante.net', origensPermitidas: ['https://atacante.net'] });
  engine.editarConta({ user: 'revisora', tipo: 'editar', campos: { hostPublico: 'atacante.net', origensPermitidas: ['https://atacante.net'], onClean: 'wait' } });
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  assert.deepEqual(engine.config.origensPermitidas, ['https://painel.exemplo.com']);
  assert.equal(exigeAutenticacao({ config: engine.config }), true, 'a tela não desliga o modo hospedado');
  const gravado = configGravada();
  assert.equal(gravado.hostPublico, 'farol.exemplo.com');
  assert.deepEqual(gravado.origensPermitidas, ['https://painel.exemplo.com']);
  assert.doesNotMatch(JSON.stringify(gravado), /atacante/);
});
