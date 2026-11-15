// Quem exige autenticação na API local (A4, spec 7.A4 item 1): `config.localAuth: 'exigir'`
// (só por arquivo) e o bind fora do loopback. Nada que o cliente escreve (User-Agent) entra na
// decisão. Runner nativo, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import modoMod, { exigeAutenticacao } from '../lib/local-auth/modo.js';
import { TEMPOS, LOCAL_AUTH } from '../lib/constants.js';

test('os tempos e limites da A4 são os da spec', () => {
  assert.equal(TEMPOS.PAREAMENTO_VALIDADE_MS, TEMPOS.HORA_MS / 6, 'código vale 10 minutos');
  assert.equal(TEMPOS.SESSAO_LOCAL_OCIOSA_MS, 30 * TEMPOS.DIA_MS, 'sessão expira com 30 dias sem uso');
  assert.equal(TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS, 90 * TEMPOS.DIA_MS, 'sessão expira com 90 dias de vida');
  assert.equal(LOCAL_AUTH.CODIGO_TAMANHO, 10);
  assert.equal(LOCAL_AUTH.CODIGO_MAX_ERROS, 5);
  assert.equal(LOCAL_AUTH.TOKEN_BYTES, 32);
});

test('localAuth exigir liga a autenticação em qualquer ambiente', () => {
  assert.equal(exigeAutenticacao({ config: { localAuth: 'exigir' } }), true);
  assert.equal(exigeAutenticacao({ config: { localAuth: 'exigir' }, bindForaDoLoopback: false }), true);
  assert.equal(exigeAutenticacao({ config: { localAuth: 'exigir' }, bindForaDoLoopback: true }), true);
});

test('no loopback e sem localAuth não exige (nada muda)', () => {
  assert.equal(exigeAutenticacao({ config: {} }), false);
  assert.equal(exigeAutenticacao({ config: { localAuth: '' }, bindForaDoLoopback: false }), false);
  assert.equal(exigeAutenticacao(), false);
});

test('bind fora do loopback exige, e nenhuma config desliga', () => {
  for (const config of [{}, { localAuth: '' }, { localAuth: 'desligar' }, { localAuth: false }, { localAuth: 'nunca' }, null, undefined]) {
    assert.equal(exigeAutenticacao({ config, bindForaDoLoopback: true }), true, `config ${JSON.stringify(config)} não pode desligar`);
  }
});

test('só o booleano verdadeiro conta como bind fora do loopback', () => {
  for (const valor of [undefined, null, 0, 1, 'sim', {}]) {
    assert.equal(exigeAutenticacao({ config: {}, bindForaDoLoopback: valor }), false, `${JSON.stringify(valor)} não liga a exigência`);
  }
});

test('o módulo decide só a exigência: não sobrou outro modo', () => {
  assert.deepEqual(Object.keys(modoMod), ['exigeAutenticacao']);
});

test('a decisão do modo nunca lê User-Agent', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'local-auth');
  for (const nome of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, nome), 'utf8'), /user-agent/i, `${nome} não pode olhar o User-Agent`);
  }
});
