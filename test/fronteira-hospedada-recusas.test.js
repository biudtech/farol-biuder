// As recusas de boot que fecham os caminhos de "quis hospedar e subiu sem autenticação":
//
// - nome de chave errado (`hostpublico`, `host_publico`, `origensPermitida`, `LocalAuth`): a
//   carga descarta chave desconhecida calada, e o motor subia aberto;
// - config.json que é link simbólico para nada: contava como ausente, o motor subia com os
//   padrões e trocava o link por um arquivo;
// - `localAuth` e `bind` com valor que não serve: viravam "não exige" e loopback, calados;
// - tipo errado tratado como vazio (`hostPublico: []`, `origensPermitidas: ""`).
//
// E o que NÃO é recusa: BOM UTF-8 no início do arquivo, e todas as chaves válidas da tabela.
// Em toda recusa o config.json fica como estava. O processo de verdade é coberto em
// test/fronteira-hospedada-boot.test.js; aqui é a Engine, em processo.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-fronteira-recusas-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { CONFIG_FILE, STATE_DIR } = await import('../lib/paths.js');
const { exigeAutenticacao } = await import('../lib/local-auth/modo.js');
const { SETTINGS, defaults } = await import('../lib/settings.js');
const { recusasDaFronteira } = await import('../lib/fronteira-hospedada.js');
const { sanearBind, sanearHostPublico, sanearOrigensPermitidas } = await import('../lib/parse.js');
const { loopback } = await import('../lib/http-guard.js');

const PARSERS = { sanearBind, sanearHostPublico, sanearOrigensPermitidas };

function gravar(config) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, typeof config === 'string' ? config : JSON.stringify(config));
}

// A Engine tem que lançar a recusa, sem tocar no arquivo e sem deixar nada ao lado dele.
function recusa(codigo = 'FRONTEIRA_INVALIDA') {
  const antes = fs.readFileSync(CONFIG_FILE);
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.ok(erro, 'a Engine tem que lançar');
  assert.equal(erro.code, codigo, erro.message);
  assert.match(erro.message, /o motor não sobe/);
  assert.ok(erro.message.includes(CONFIG_FILE), 'a mensagem diz o caminho do arquivo');
  assert.doesNotMatch(erro.message, /\u2014/, 'sem travessão');
  assert.deepEqual(fs.readFileSync(CONFIG_FILE), antes, 'o config.json fica byte a byte como estava');
  assert.deepEqual(fs.readdirSync(HOME), ['config.json'], 'nada ao lado do config.json');
  return erro.message;
}

beforeEach(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

/* ---------- 1. nome de chave errado ---------- */

const GRAFIAS_ERRADAS = [
  ['hostpublico', 'hostPublico'], ['HostPublico', 'hostPublico'], ['host_publico', 'hostPublico'],
  ['HOSTPUBLICO', 'hostPublico'], ['host-publico', 'hostPublico'], ['hostPublic', 'hostPublico'],
  ['host', 'hostPublico'], ['hostPublico ', 'hostPublico'],
  ['origens_permitidas', 'origensPermitidas'], ['origensPermitida', 'origensPermitidas'],
  ['origenspermitidas', 'origensPermitidas'], ['OrigensPermitidas', 'origensPermitidas'],
  ['origemPermitida', 'origensPermitidas'], ['origins', 'origensPermitidas'], ['origin', 'origensPermitidas'],
  ['localauth', 'localAuth'], ['LocalAuth', 'localAuth'], ['local_auth', 'localAuth'], ['localAuthMode', 'localAuth'],
  ['Bind', 'bind'], ['BIND', 'bind'], ['bind_', 'bind'],
];

for (const [escrita, certa] of GRAFIAS_ERRADAS) {
  test(`nome de chave errado: "${escrita}" impede o boot e a mensagem diz a grafia certa "${certa}"`, () => {
    gravar({ reviewFast: true, [escrita]: certa === 'origensPermitidas' ? ['https://painel.exemplo.com'] : 'farol.exemplo.com' });
    const mensagem = recusa();
    assert.ok(mensagem.includes(JSON.stringify(escrita)), `cita a chave como foi escrita\n${mensagem}`);
    assert.ok(mensagem.includes(`"${certa}"`), `diz a grafia certa\n${mensagem}`);
  });
}

test('nome errado recusa mesmo com a chave certa ao lado, e mesmo com valor vazio', () => {
  gravar({ hostPublico: 'farol.exemplo.com', hostpublico: '' });
  assert.match(recusa(), /"hostpublico"/);
  gravar({ origens_permitidas: [] });
  assert.match(recusa(), /"origens_permitidas"/);
});

test('o nome da chave errada não forja linha nem cor no terminal', () => {
  gravar({ 'host\r\n[farol] tudo certo\u009b31m\u2028': 'x' });
  const mensagem = recusa();
  assert.equal(mensagem.includes('\n'), false, 'uma linha só');
  assert.doesNotMatch(mensagem, /[\u0080-\u009f\u2028\u2029]/);
});

// Nenhuma chave que o motor lê pode cair na regra de nomes: nem as da tabela, nem as só de
// arquivo, nem as do formato antigo que a carga ainda converte.
const CHAVES_LEGITIMAS_FORA_DA_TABELA = ['instanciaIsoladaPosta', 'aguardarMergeavelParaRevisar', 'seniority', 'accounts', 'ghUser', 'owners', 'esquemaConfig', 'autoReview', 'autoApproveAll', 'autoOpenReview', 'sync', 'cadeiaPerfis'];

test('controle: um config.json com TODAS as chaves válidas da tabela não é recusado', () => {
  const tudo = { ...defaults(47170), hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'], localAuth: 'exigir', bind: '0.0.0.0' };
  assert.deepEqual(Object.keys(tudo).sort(), SETTINGS.map((s) => s.key).sort(), 'o objeto cobre a tabela inteira');
  assert.deepEqual(recusasDaFronteira(tudo, PARSERS), []);
  assert.deepEqual(recusasDaFronteira(defaults(47170), PARSERS), [], 'e a tabela nos padrões também passa');
  const comAsDeFora = Object.fromEntries(CHAVES_LEGITIMAS_FORA_DA_TABELA.map((c) => [c, null]));
  assert.deepEqual(recusasDaFronteira({ ...tudo, ...comAsDeFora }, PARSERS), []);
  // chave desconhecida que não lembra a fronteira segue descartada sem erro, como sempre
  assert.deepEqual(recusasDaFronteira({ qualquerCoisa: 1, shost: 'x', allowed_origins_x: [], rebind: 'x' }, PARSERS), []);
  gravar({ ...tudo, conta: { user: 'revisora', owners: ['biudtech'], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' } });
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  assert.equal(engine.config.bind, '0.0.0.0');
  assert.equal(exigeAutenticacao({ config: engine.config }), true);
});

/* ---------- 2. link simbólico quebrado ---------- */

test('config.json que é link simbólico para nada impede o boot, e o link fica como estava', () => {
  fs.mkdirSync(HOME, { recursive: true });
  const alvo = path.join(HOME, 'nao-existe', 'config.json');
  fs.symlinkSync(alvo, CONFIG_FILE);
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.ok(erro, 'a Engine tem que lançar');
  assert.equal(erro.code, 'CONFIG_ILEGIVEL');
  assert.match(erro.message, /config\.json ilegível, o motor não sobe: /);
  assert.match(erro.message, /link simbólico/);
  assert.ok(erro.message.includes(CONFIG_FILE));
  assert.equal(fs.lstatSync(CONFIG_FILE).isSymbolicLink(), true, 'o link não virou arquivo');
  assert.equal(fs.readlinkSync(CONFIG_FILE), alvo);
  assert.deepEqual(fs.readdirSync(HOME), ['config.json'], 'nada criado ao lado, nem o alvo do link');
});

test('controle: link simbólico para um config.json que existe é lido normalmente', () => {
  fs.mkdirSync(path.join(HOME, 'cofre'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'cofre', 'config.json'), JSON.stringify({ hostPublico: 'farol.exemplo.com' }));
  fs.symlinkSync(path.join(HOME, 'cofre', 'config.json'), CONFIG_FILE);
  assert.equal(new Engine().config.hostPublico, 'farol.exemplo.com');
});

/* ---------- 3. localAuth ---------- */

for (const valor of ['Exigir', 'EXIGIR', 'exigir ', true, 'sim', 1, 'on', 'desligar', false, 0, [], {}, ['exigir']]) {
  test(`localAuth inválido impede o boot: ${JSON.stringify(valor)}`, () => {
    gravar({ localAuth: valor });
    const mensagem = recusa();
    assert.match(mensagem, /"localAuth" tem valor recusado/);
    assert.match(mensagem, /Formato aceito: .*"exigir"/);
  });
}

test('controle: localAuth "exigir" sobe exigindo, e ausente, null e "" sobem sem exigir', () => {
  gravar({ localAuth: 'exigir' });
  assert.equal(exigeAutenticacao({ config: new Engine().config }), true);
  for (const config of [{}, { localAuth: null }, { localAuth: '' }]) {
    gravar(config);
    assert.equal(exigeAutenticacao({ config: new Engine().config }), false, JSON.stringify(config));
  }
});

/* ---------- 4. bind ---------- */

for (const valor of ['0.0.0.0:47170', 'http://0.0.0.0', '0.0.0.0/0', '300.1.1.1', 'farol interno', '*', '::', 0, true, false, ['0.0.0.0'], {}]) {
  test(`bind inválido impede o boot em vez de voltar para o loopback: ${JSON.stringify(valor)}`, () => {
    gravar({ bind: valor });
    const mensagem = recusa();
    assert.match(mensagem, /"bind" tem valor recusado/);
    assert.match(mensagem, /Formato aceito/);
  });
}

test('controle: bind válido sobe (caixa alta é acertada), e ausente, null e "" ficam no loopback', () => {
  for (const [valor, esperado] of [['0.0.0.0', '0.0.0.0'], ['Farol.Interno', 'farol.interno'], ['[::1]', '[::1]'], ['127.0.0.1', '127.0.0.1']]) {
    gravar({ bind: valor });
    assert.equal(new Engine().config.bind, esperado);
  }
  for (const config of [{}, { bind: null }, { bind: '' }]) {
    gravar(config);
    assert.equal(loopback(new Engine().config.bind), true, JSON.stringify(config));
  }
});

/* ---------- 5. tipo errado não é vazio ---------- */

const VALORES_QUE_NAO_SAO_VAZIO = [' ', [''], [null], {}, 0, false, true];

for (const chave of ['hostPublico', 'origensPermitidas']) {
  const naoVazios = [...VALORES_QUE_NAO_SAO_VAZIO, chave === 'hostPublico' ? [] : ''];
  for (const valor of naoVazios) {
    test(`${chave} com ${JSON.stringify(valor)} impede o boot: não é vazio legítimo`, () => {
      gravar({ [chave]: valor });
      assert.match(recusa(), new RegExp(`"${chave}" tem valor recusado`));
    });
  }
}

test('controle: vazio legítimo é só chave ausente, null, "" para o texto e [] para a lista', () => {
  for (const config of [{}, { hostPublico: null }, { hostPublico: '' }, { origensPermitidas: null }, { origensPermitidas: [] }]) {
    gravar(config);
    const engine = new Engine();
    assert.equal(engine.config.hostPublico, '');
    assert.deepEqual(engine.config.origensPermitidas, []);
    assert.equal(exigeAutenticacao({ config: engine.config }), false, JSON.stringify(config));
  }
});

/* ---------- 6. BOM UTF-8 ---------- */

test('config.json com BOM UTF-8 no início sobe, com as chaves lidas, e o arquivo não muda', () => {
  gravar(`\ufeff${JSON.stringify({ hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'] }, null, 2)}`);
  const antes = fs.readFileSync(CONFIG_FILE);
  assert.deepEqual([...antes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'o arquivo do teste começa com o BOM');
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  assert.deepEqual(engine.config.origensPermitidas, ['https://painel.exemplo.com']);
  assert.equal(exigeAutenticacao({ config: engine.config }), true);
  assert.deepEqual(fs.readFileSync(CONFIG_FILE), antes, 'o boot não regrava o arquivo');
});

test('BOM não salva arquivo ilegível: só o BOM é vazio, e BOM com lixo não é JSON', () => {
  gravar('\ufeff');
  assert.match(recusa('CONFIG_ILEGIVEL'), /o arquivo está vazio/);
  gravar('\ufeff{ "hostPublico": ');
  assert.match(recusa('CONFIG_ILEGIVEL'), /não é JSON válido/);
  gravar('\ufeff{ "hostpublico": "farol.exemplo.com" }');
  assert.match(recusa(), /"hostpublico"/);
});

/* ---------- 9. o valor recusado na mensagem ---------- */

test('o valor recusado sai com os controles de terminal escapados (C1, NEL, separadores de linha)', () => {
  gravar({ hostPublico: 'farol\u009b31m.exemplo\u0085.com\u2028x\u2029y\u007f' });
  const mensagem = recusa();
  assert.doesNotMatch(mensagem, /[\u007f-\u009f\u2028\u2029]/, 'nenhum dos caracteres crus');
  for (const escapado of ['\\u009b', '\\u0085', '\\u2028', '\\u2029', '\\u007f']) assert.ok(mensagem.includes(escapado), `${escapado}\n${mensagem}`);
  gravar({ origensPermitidas: ['https://painel.exemplo.com\u009b2J'] });
  assert.ok(recusa().includes('\\u009b2J'));
});

/* ---------- o registro no farol.log ---------- */

test('a recusa cria o farol.log quando a pasta state/ existe, e não cria pasta nenhuma quando não existe', () => {
  gravar({ hostpublico: 'farol.exemplo.com' });
  recusa();
  assert.equal(fs.existsSync(STATE_DIR), false, 'sem a pasta, a recusa não cria nada');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.equal(erro && erro.code, 'FRONTEIRA_INVALIDA');
  assert.deepEqual(fs.readdirSync(STATE_DIR), ['farol.log']);
  const log = fs.readFileSync(path.join(STATE_DIR, 'farol.log'), 'utf8');
  assert.match(log, /\[ERROR\].*o motor não sobe.*"hostpublico"/);
  assert.equal(log.trim().split('\n').length, 1, 'uma linha só');
});
