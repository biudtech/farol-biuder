// Fronteira HTTP do motor hospedado (fase 2a, spec 6.2), só as partes PURAS: os dois
// saneadores (lib/parse.js), a allowlist de Host e Origin com o host público e as origens
// permitidas (lib/http-guard.js) e a exigência de autenticação (lib/local-auth/modo.js).
// Nenhum destes módulos alcança lib/paths.js, então o import é estático. O servidor real é
// coberto em test/fronteira-hospedada-http.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanearHostPublico, sanearOrigensPermitidas } from '../lib/parse.js';
import { validarHostEOrigem } from '../lib/http-guard.js';
import { exigeAutenticacao } from '../lib/local-auth/modo.js';
import { SETTINGS, EDITAVEIS, defaults, paraGravar, sanear, normalizarConfig } from '../lib/settings.js';

const PORTA = 51234;
const HOST = 'farol.exemplo.com';
const ORIGEM = 'https://painel.exemplo.com';
const RECUSA_HOST = { ok: false, motivo: 'host' };
const RECUSA_ORIGIN = { ok: false, motivo: 'origin' };
const LOCAL = `127.0.0.1:${PORTA}`;

/* ---------- saneador do host público ---------- */

test('sanearHostPublico aceita um nome de host ou IPv4, em caixa baixa', () => {
  for (const v of ['farol.exemplo.com', 'farol', 'farol-1.interno', 'x1.y-2.z', '10.0.0.7']) assert.equal(sanearHostPublico(v), v, v);
  assert.equal(sanearHostPublico('Farol.Exemplo.COM'), 'farol.exemplo.com', 'o Host chega em caixa baixa, e a comparação é exata');
});

test('sanearHostPublico devolve vazio para tudo o que não é um nome de host, sem lançar', () => {
  const invalidos = [
    'https://farol.exemplo.com', 'http://farol.exemplo.com', 'farol.exemplo.com/', 'farol.exemplo.com/api',
    'farol.exemplo.com:443', 'farol.exemplo.com:8443', ' farol.exemplo.com', 'farol.exemplo.com ', 'farol exemplo.com',
    'farol.exemplo.com.', '.farol.exemplo.com', 'farol..exemplo.com', '-farol.com', 'farol-.com', '*.exemplo.com', '*',
    'user@farol.exemplo.com', 'farol.exemplo.com?x=1', 'farol.exemplo.com#x', 'farol.exemplo.com\r\nx: 1', 'farol_x.com',
    '[::1]', '[2001:db8::1]', '999.1.1.1', '1.2.3', '1.2.3.4.5', '', 'a'.repeat(64) + '.com', ('a'.repeat(60) + '.').repeat(5) + 'com',
    undefined, null, 0, 1, true, {}, [], ['farol.exemplo.com'], { toString() { return 'farol.exemplo.com'; } },
  ];
  for (const v of invalidos) assert.equal(sanearHostPublico(v), '', JSON.stringify(v));
});

/* ---------- saneador das origens permitidas ---------- */

test('sanearOrigensPermitidas mantém só a origem exata https://host[:porta]', () => {
  assert.deepEqual(sanearOrigensPermitidas(['https://painel.exemplo.com', 'https://painel.exemplo.com:8443', 'https://10.0.0.7']),
    ['https://painel.exemplo.com', 'https://painel.exemplo.com:8443', 'https://10.0.0.7']);
  assert.deepEqual(sanearOrigensPermitidas(['HTTPS://Painel.Exemplo.com']), ['https://painel.exemplo.com'], 'o navegador manda a origem em caixa baixa');
  assert.deepEqual(sanearOrigensPermitidas(['https://a.com', 'https://a.com', 'https://b.com']), ['https://a.com', 'https://b.com'], 'repetida conta uma vez');
});

test('sanearOrigensPermitidas descarta o item inválido e mantém os outros', () => {
  const invalidos = [
    'https://painel.exemplo.com/', 'https://painel.exemplo.com/app', 'https://painel.exemplo.com?x=1', 'https://painel.exemplo.com#x',
    'https://*.exemplo.com', 'https://*', '*', 'null', '', 'painel.exemplo.com', '//painel.exemplo.com', 'ftp://painel.exemplo.com',
    'https://user@painel.exemplo.com', 'https://user:senha@painel.exemplo.com', 'https://painel.exemplo.com.', 'https://.exemplo.com',
    'https://painel.exemplo.com:', 'https://painel.exemplo.com:0', 'https://painel.exemplo.com:65536', 'https://painel.exemplo.com:08443',
    'https://painel.exemplo.com:abc', 'https://painel.exemplo.com:443', ' https://painel.exemplo.com', 'https://painel.exemplo.com ',
    'https://painel.exemplo.com, https://b.com', 'https://painel.exemplo.com\r\nSet-Cookie: a=b', 'https://painel.exemplo.com\nx',
    'https://[::1]', 'https://[::1]:3000', 'https:painel.exemplo.com', 'https:/painel.exemplo.com', 'https://',
    undefined, null, 0, true, {}, ['https://painel.exemplo.com'],
  ];
  for (const item of invalidos) assert.deepEqual(sanearOrigensPermitidas([item]), [], JSON.stringify(item));
  assert.deepEqual(sanearOrigensPermitidas(['https://a.com/', 'https://b.com', '*', 7]), ['https://b.com']);
});

// Decisão: http:// só entra para localhost e 127.0.0.1 (o front em desenvolvimento, que roda
// sem TLS na máquina de quem desenvolve). Para qualquer outro host, http é descartado.
test('http:// só é aceito para localhost e 127.0.0.1, com a porta escrita se não for a 80', () => {
  assert.deepEqual(sanearOrigensPermitidas(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost']),
    ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost']);
  for (const item of ['http://painel.exemplo.com', 'http://painel.exemplo.com:3000', 'http://10.0.0.7:3000', 'http://localhost.exemplo.com:3000',
    'http://xlocalhost:3000', 'http://127.0.0.2:3000', 'http://0.0.0.0:3000', 'http://[::1]:3000', 'http://localhost:80', 'http://localhost:3000/']) {
    assert.deepEqual(sanearOrigensPermitidas([item]), [], item);
  }
});

test('sanearOrigensPermitidas devolve lista vazia para o que não é lista, sem lançar', () => {
  for (const v of [undefined, null, '', 'https://painel.exemplo.com', 0, 1, true, {}, { 0: 'https://a.com', length: 1 }]) {
    assert.deepEqual(sanearOrigensPermitidas(v), [], JSON.stringify(v));
  }
});

/* ---------- as duas chaves na tabela de preferências ---------- */

test('hostPublico e origensPermitidas existem na tabela, vazios por padrão e só de arquivo', () => {
  assert.equal(defaults(1).hostPublico, '');
  assert.deepEqual(defaults(1).origensPermitidas, []);
  for (const chave of ['hostPublico', 'origensPermitidas']) {
    assert.equal(EDITAVEIS.has(chave), false, `${chave} não vem da tela nem do POST /api/settings`);
    assert.equal(SETTINGS.find(s => s.key === chave).ui, false);
  }
});

test('a tabela saneia as duas chaves com os saneadores de lib/parse.js', () => {
  const fns = { sanearHostPublico, sanearOrigensPermitidas };
  assert.equal(sanear('hostPublico', 'https://farol.exemplo.com', {}, fns), '');
  assert.equal(sanear('hostPublico', 'Farol.Exemplo.com', {}, fns), 'farol.exemplo.com');
  assert.deepEqual(sanear('origensPermitidas', ['https://a.com/', 'https://b.com'], {}, fns), ['https://b.com']);
  assert.deepEqual(sanear('origensPermitidas', 'https://b.com', {}, fns), []);
});

test('no padrão as duas chaves não são gravadas no config.json; preenchidas, são', () => {
  const gravado = paraGravar({ hostPublico: '', origensPermitidas: [], theme: 'dark' });
  assert.deepEqual(gravado, { theme: 'dark' });
  assert.deepEqual(paraGravar({ hostPublico: HOST, origensPermitidas: [ORIGEM] }), { hostPublico: HOST, origensPermitidas: [ORIGEM] });
});

test('normalizarConfig deixa as duas chaves passarem do arquivo', () => {
  assert.deepEqual(normalizarConfig({ hostPublico: HOST, origensPermitidas: [ORIGEM] }), { hostPublico: HOST, origensPermitidas: [ORIGEM] });
});

/* ---------- allowlist de Host com o host público ---------- */

test('host público é aceito sem porta, ao lado do loopback', () => {
  assert.deepEqual(validarHostEOrigem({ host: HOST, porta: PORTA, hostPublico: HOST }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ host: LOCAL, porta: PORTA, hostPublico: HOST }), { ok: true }, 'o loopback continua valendo');
  assert.deepEqual(validarHostEOrigem({ host: `localhost:${PORTA}`, porta: PORTA, hostPublico: HOST }), { ok: true });
});

// Decisão: só o nome exato, sem porta. Navegador (WHATWG URL), curl e o http do Node tiram
// a porta padrão do esquema antes de montar o Host, então `:443` nunca chega de cliente comum.
test('host público com qualquer porta é recusado, inclusive a 443 e a do socket', () => {
  for (const host of [`${HOST}:443`, `${HOST}:80`, `${HOST}:${PORTA}`, `${HOST}:8443`, `${HOST}:`]) {
    assert.deepEqual(validarHostEOrigem({ host, porta: PORTA, hostPublico: HOST }), RECUSA_HOST, host);
  }
});

test('host parecido com o público é recusado: sufixo, prefixo, caixa, ponto final, userinfo', () => {
  const parecidos = [
    `${HOST}.atacante.net`, `x${HOST}`, `sub.${HOST}`, 'exemplo.com', 'FAROL.EXEMPLO.COM', 'Farol.exemplo.com', `${HOST}.`,
    ` ${HOST}`, `${HOST} `, `user@${HOST}`, `${HOST}@atacante.net`, `atacante.net@${HOST}`, `${HOST}/`, `${HOST}#`, `${HOST}?`,
    `https://${HOST}`, `${HOST},atacante.net`, `${HOST}, ${HOST}`, 'atacante.net',
  ];
  for (const host of parecidos) assert.deepEqual(validarHostEOrigem({ host, porta: PORTA, hostPublico: HOST }), RECUSA_HOST, JSON.stringify(host));
});

test('sem hostPublico o nome de fora continua recusado, e hostPublico vazio não libera o Host vazio', () => {
  assert.deepEqual(validarHostEOrigem({ host: HOST, porta: PORTA }), RECUSA_HOST);
  for (const hostPublico of ['', undefined, null, 0, false, [], {}]) {
    assert.deepEqual(validarHostEOrigem({ host: HOST, porta: PORTA, hostPublico }), RECUSA_HOST, JSON.stringify(hostPublico));
    assert.deepEqual(validarHostEOrigem({ host: '', porta: PORTA, hostPublico }), RECUSA_HOST, JSON.stringify(hostPublico));
    assert.deepEqual(validarHostEOrigem({ porta: PORTA, hostPublico }), RECUSA_HOST, JSON.stringify(hostPublico));
  }
  assert.deepEqual(validarHostEOrigem({ host: [HOST], porta: PORTA, hostPublico: [HOST] }), RECUSA_HOST, 'só texto contra texto');
});

test('o modo hospedado não enfraquece a proteção contra DNS rebinding no loopback', () => {
  const hospedado = { porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] };
  for (const host of [`rebinding.evil.example:${PORTA}`, `evil.example:${PORTA}`, '127.0.0.1', 'localhost', `127.0.0.1:${PORTA + 1}`, `0.0.0.0:${PORTA}`, `[::1]:${PORTA}`]) {
    assert.deepEqual(validarHostEOrigem({ ...hospedado, host }), RECUSA_HOST, host);
  }
  // porta sem prova (socket fechado) recusa até o host público
  assert.deepEqual(validarHostEOrigem({ host: HOST, porta: undefined, hostPublico: HOST }), RECUSA_HOST);
});

test('o host público não vira origem sozinho: nem http nem https', () => {
  for (const origin of [`http://${HOST}`, `https://${HOST}`, `http://${HOST}:${PORTA}`]) {
    assert.deepEqual(validarHostEOrigem({ host: HOST, origin, porta: PORTA, hostPublico: HOST }), RECUSA_ORIGIN, origin);
  }
  assert.deepEqual(validarHostEOrigem({ host: HOST, origin: `https://${HOST}`, porta: PORTA, hostPublico: HOST, origensPermitidas: [`https://${HOST}`] }),
    { ok: true, cors: `https://${HOST}` }, 'quem quer a tela pelo host público lista a origem');
});

/* ---------- origens permitidas ---------- */

test('origem permitida é aceita por igualdade exata e volta em `cors`, pelo valor da lista', () => {
  for (const host of [HOST, LOCAL]) {
    assert.deepEqual(validarHostEOrigem({ host, origin: ORIGEM, porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] }), { ok: true, cors: ORIGEM });
  }
  const lista = ['https://a.com', ORIGEM, 'http://localhost:3000'];
  assert.deepEqual(validarHostEOrigem({ host: LOCAL, origin: 'http://localhost:3000', porta: PORTA, origensPermitidas: lista }), { ok: true, cors: 'http://localhost:3000' });
});

test('variação da origem permitida é recusada', () => {
  const variacoes = [
    'http://painel.exemplo.com', 'https://painel.exemplo.com:443', 'https://painel.exemplo.com:8443', 'https://painel.exemplo.com/',
    'https://sub.painel.exemplo.com', 'https://painel.exemplo.com.atacante.net', 'https://xpainel.exemplo.com', 'https://exemplo.com',
    'https://PAINEL.exemplo.com', 'HTTPS://painel.exemplo.com', 'https://painel.exemplo.com.', 'null', '', '*',
    ' https://painel.exemplo.com', 'https://painel.exemplo.com ', 'https://painel.exemplo.com, https://painel.exemplo.com',
    'https://painel.exemplo.com,https://atacante.net', 'https://painel.exemplo.com https://atacante.net',
    'https://painel.exemplo.com\r\nSet-Cookie: a=b', 'https://painel.exemplo.com\n', 'https://user@painel.exemplo.com', 'https://atacante.net',
  ];
  for (const origin of variacoes) {
    assert.deepEqual(validarHostEOrigem({ host: HOST, origin, porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] }), RECUSA_ORIGIN, JSON.stringify(origin));
  }
  assert.deepEqual(validarHostEOrigem({ host: HOST, origin: [ORIGEM], porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] }), RECUSA_ORIGIN, 'só texto contra texto');
});

test('lista ausente, vazia ou torta não libera origem nenhuma, nem a vazia', () => {
  for (const origensPermitidas of [undefined, null, [], '', ORIGEM, { 0: ORIGEM, length: 1 }, [''], [null], [undefined], [[ORIGEM]]]) {
    assert.deepEqual(validarHostEOrigem({ host: LOCAL, origin: ORIGEM, porta: PORTA, origensPermitidas }), RECUSA_ORIGIN, JSON.stringify(origensPermitidas));
    assert.deepEqual(validarHostEOrigem({ host: LOCAL, origin: '', porta: PORTA, origensPermitidas }), RECUSA_ORIGIN, JSON.stringify(origensPermitidas));
  }
});

test('origem permitida com Host não permitido: vence o Host', () => {
  assert.deepEqual(validarHostEOrigem({ host: 'atacante.net', origin: ORIGEM, porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] }), RECUSA_HOST);
});

test('sem Origin e com Origin do loopback nada muda, e a resposta não ganha `cors`', () => {
  const hospedado = { porta: PORTA, hostPublico: HOST, origensPermitidas: [ORIGEM] };
  assert.deepEqual(validarHostEOrigem({ ...hospedado, host: HOST }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ ...hospedado, host: LOCAL }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ ...hospedado, host: LOCAL, origin: `http://127.0.0.1:${PORTA}` }), { ok: true });
  assert.deepEqual(validarHostEOrigem({ ...hospedado, host: LOCAL, origin: `http://localhost:${PORTA}` }), { ok: true });
});

/* ---------- autenticação exigida no modo hospedado ---------- */

const CONFIGS_QUE_NAO_DESLIGAM = [{}, { localAuth: '' }, { localAuth: 'desligar' }, { localAuth: false }, { localAuth: 'nunca' }, { localAuth: null }, { localAuth: 0 }];

test('com hostPublico preenchido a autenticação é exigida, e nenhuma config desliga', () => {
  for (const base of CONFIGS_QUE_NAO_DESLIGAM) {
    for (const bindForaDoLoopback of [false, true, undefined]) {
      assert.equal(exigeAutenticacao({ config: { ...base, hostPublico: HOST }, bindForaDoLoopback }), true, JSON.stringify(base));
    }
  }
});

test('com origensPermitidas preenchida a autenticação é exigida, e nenhuma config desliga', () => {
  for (const base of CONFIGS_QUE_NAO_DESLIGAM) {
    for (const bindForaDoLoopback of [false, true, undefined]) {
      assert.equal(exigeAutenticacao({ config: { ...base, origensPermitidas: [ORIGEM] }, bindForaDoLoopback }), true, JSON.stringify(base));
    }
  }
});

test('em loopback puro, com as duas chaves vazias, vale a regra de antes', () => {
  for (const vazio of [{}, { hostPublico: '', origensPermitidas: [] }, { hostPublico: undefined, origensPermitidas: undefined }, { hostPublico: null, origensPermitidas: null }]) {
    assert.equal(exigeAutenticacao({ config: vazio }), false, JSON.stringify(vazio));
    assert.equal(exigeAutenticacao({ config: vazio, bindForaDoLoopback: true }), true);
    assert.equal(exigeAutenticacao({ config: { ...vazio, localAuth: 'exigir' } }), true);
  }
});

// A config chega saneada do boot. Se um valor torto chegar aqui mesmo assim, a dúvida exige.
test('valor preenchido de tipo inesperado nas duas chaves exige (na dúvida, fecha)', () => {
  assert.equal(exigeAutenticacao({ config: { origensPermitidas: ORIGEM } }), true);
  assert.equal(exigeAutenticacao({ config: { origensPermitidas: { 0: ORIGEM } } }), true);
  assert.equal(exigeAutenticacao({ config: { hostPublico: [HOST] } }), true);
});
