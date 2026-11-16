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
  // caixa alta e item repetido não são erro: o saneador os acerta sem descartar nada
  gravar({ hostPublico: 'Farol.Exemplo.com', origensPermitidas: ['https://Painel.exemplo.com', 'https://painel.exemplo.com', 'http://localhost:3000'] });
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  assert.deepEqual(engine.config.origensPermitidas, ['https://painel.exemplo.com', 'http://localhost:3000']);
  assert.equal(exigeAutenticacao({ config: engine.config }), true);
  engine.updateSettings({ soundEnabled: false });
  assert.equal(configGravada().hostPublico, 'farol.exemplo.com', 'salvar preferência não apaga o que veio do arquivo');
  assert.deepEqual(configGravada().origensPermitidas, ['https://painel.exemplo.com', 'http://localhost:3000']);
});

// Valor inválido numa das duas chaves NÃO vira vazio em silêncio: com o motor em loopback atrás
// de um proxy que reescreve o Host, "vazio" é a API inteira sem autenticação. O motor não sobe,
// e o config.json fica como estava (a evidência do erro). O processo de verdade é coberto em
// test/fronteira-hospedada-boot.test.js; aqui é a Engine, que lança antes de gravar qualquer coisa.
const TORTOS = [
  [{ hostPublico: 'https://farol.exemplo.com' }, ['hostPublico']],
  [{ hostPublico: 'farol.exemplo.com:443' }, ['hostPublico']],
  [{ hostPublico: 'farol.exemplo.com.' }, ['hostPublico']],
  [{ hostPublico: { nome: 'farol.exemplo.com' } }, ['hostPublico']],
  [{ hostPublico: ['farol.exemplo.com'] }, ['hostPublico']],
  [{ hostPublico: 42 }, ['hostPublico']],
  [{ hostPublico: true }, ['hostPublico']],
  [{ hostPublico: 0 }, ['hostPublico']],
  [{ hostPublico: false }, ['hostPublico']],
  [{ hostPublico: '*' }, ['hostPublico']],
  [{ hostPublico: 'farol.exemplo.com\r\nx: 1' }, ['hostPublico']],
  [{ origensPermitidas: 'https://painel.exemplo.com' }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com/'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com/app'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com:443'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['*'] }, ['origensPermitidas']],
  [{ origensPermitidas: { 0: 'https://painel.exemplo.com' } }, ['origensPermitidas']],
  [{ origensPermitidas: [['https://painel.exemplo.com']] }, ['origensPermitidas']],
  [{ origensPermitidas: 42 }, ['origensPermitidas']],
  [{ origensPermitidas: true }, ['origensPermitidas']],
  [{ origensPermitidas: ['http://painel.exemplo.com'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com\r\nSet-Cookie: a=b'] }, ['origensPermitidas']],
  // UM item inválido no meio dos válidos também recusa: a lista não encolhe calada
  [{ origensPermitidas: ['https://painel.exemplo.com', 'https://outro.exemplo.com/', 'http://localhost:3000'] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com', ''] }, ['origensPermitidas']],
  [{ origensPermitidas: ['https://painel.exemplo.com', null] }, ['origensPermitidas']],
  // a outra chave estar certa não salva
  [{ hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com/'] }, ['origensPermitidas']],
  [{ hostPublico: 'farol.exemplo.com:443', origensPermitidas: ['https://painel.exemplo.com'] }, ['hostPublico']],
  [{ hostPublico: 'https://farol.exemplo.com', origensPermitidas: 'https://painel.exemplo.com' }, ['hostPublico', 'origensPermitidas']],
];

for (const [torto, chaves] of TORTOS) {
  test(`valor inválido no arquivo: a Engine não nasce, diz a chave e não toca no config.json: ${JSON.stringify(torto)}`, () => {
    gravar({ theme: 'light', ...torto });
    const antes = fs.readFileSync(CONFIG_FILE);
    let erro = null;
    try { new Engine(); } catch (e) { erro = e; }
    assert.ok(erro, 'a Engine tem que lançar');
    assert.equal(erro.code, 'FRONTEIRA_INVALIDA');
    for (const chave of chaves) assert.match(erro.message, new RegExp(`"${chave}"`), `a mensagem cita ${chave}`);
    for (const outra of ['hostPublico', 'origensPermitidas'].filter(c => !chaves.includes(c))) {
      assert.doesNotMatch(erro.message, new RegExp(`"${outra}" tem valor`), `${outra} não tem erro para citar`);
    }
    assert.match(erro.message, /Formato aceito/);
    assert.match(erro.message, /config\.json/);
    assert.doesNotMatch(erro.message, /[\r\n]x: 1|[\r\n]Set-Cookie/, 'o valor recusado não quebra a linha da mensagem');
    assert.deepEqual(fs.readFileSync(CONFIG_FILE), antes, 'o config.json fica byte a byte como estava');
  });
}

const VAZIOS = [
  {}, { hostPublico: '', origensPermitidas: [] }, { hostPublico: null, origensPermitidas: null },
  { hostPublico: '' }, { origensPermitidas: [] }, { hostPublico: [] },
];

for (const vazio of VAZIOS) {
  test(`chave ausente ou vazia é "não hospedado", sem erro: ${JSON.stringify(vazio)}`, () => {
    gravar(vazio);
    const engine = new Engine();
    assert.equal(engine.config.hostPublico, '');
    assert.deepEqual(engine.config.origensPermitidas, []);
    assert.equal(exigeAutenticacao({ config: engine.config }), false);
    const base = { porta: 47170, bind: engine.config.bind, hostPublico: engine.config.hostPublico, origensPermitidas: engine.config.origensPermitidas };
    assert.equal(validarHostEOrigem({ ...base, host: 'farol.exemplo.com' }).ok, false);
    assert.equal(validarHostEOrigem({ ...base, host: '127.0.0.1:47170' }).ok, true);
  });
}

test('a recusa cita o valor recusado e, numa lista, só os itens recusados', () => {
  gravar({ hostPublico: 'farol.exemplo.com:443', origensPermitidas: ['https://painel.exemplo.com', 'https://outro.exemplo.com/'] });
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.ok(erro);
  assert.match(erro.message, /"farol\.exemplo\.com:443"/);
  assert.match(erro.message, /"https:\/\/outro\.exemplo\.com\/"/);
  assert.doesNotMatch(erro.message, /"https:\/\/painel\.exemplo\.com"[,\]]/, 'o item válido não aparece como recusado');
});

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
