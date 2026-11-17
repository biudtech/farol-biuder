// A trava da instância hospedada: com FAROL_INSTANCIA_HOSPEDADA=1 (o padrão da imagem do
// container), o motor só sobe com um config.json legível que exige autenticação e define
// hostPublico ou origensPermitidas.
//
// O que ela fecha: volume de dados que não montou é indistinguível de instalação nova. Sem a
// trava o motor subia com os padrões (loopback puro, sem autenticação, conta que age sozinha)
// e ainda gravava um config.json novo por cima do lugar onde o de verdade deveria estar.
//
// Em toda recusa nada é criado nem alterado no HOME do Farol. O processo de verdade é coberto
// em test/instancia-hospedada-boot.test.js; aqui é a Engine, em processo.
// FAROL_HOME temporário ANTES do import do engine, e HOME junto (o boot escreve ~/.claude.json).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-instancia-hospedada-'));
process.env.FAROL_HOME = HOME;
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { CONFIG_FILE, STATE_DIR, LOG_FILE } = await import('../lib/paths.js');
const { exigeAutenticacao } = await import('../lib/local-auth/modo.js');
const { validarHostEOrigem } = await import('../lib/http-guard.js');
const { VARIAVEL, modoHospedado, recusasDaHospedagem, avisosDaHospedagem } = await import('../lib/instancia-hospedada.js');

const CONTA_EM_ESPERA = { autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };
const HOSPEDADO = { bind: '0.0.0.0', hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'], localAuth: 'exigir', conta: CONTA_EM_ESPERA };

function gravar(config) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, typeof config === 'string' ? config : JSON.stringify(config));
}

function ligar(valor = '1') { process.env[VARIAVEL] = valor; }

// O que existe no HOME do Farol, para provar que a recusa não criou nem mudou nada.
function retrato() {
  if (!fs.existsSync(HOME)) return null;
  return fs.readdirSync(HOME, { recursive: true }).sort().map((nome) => {
    const alvo = path.join(HOME, String(nome));
    return fs.statSync(alvo).isDirectory() ? `${nome}/` : `${nome}:${fs.readFileSync(alvo, 'hex')}`;
  });
}

// A Engine tem que lançar a recusa da instância hospedada, sem tocar em nada.
function recusa(codigo = 'INSTANCIA_HOSPEDADA') {
  const antes = retrato();
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.ok(erro, 'a Engine tem que lançar');
  assert.equal(erro.code, codigo, erro.message);
  assert.match(erro.message, /o motor não sobe/);
  assert.doesNotMatch(erro.message, /\u2014/, 'sem travessão');
  assert.deepEqual(retrato(), antes, 'nada foi criado nem alterado no HOME do Farol');
  return erro.message;
}

// O aviso da config que sobe e não atende é gravado no turno seguinte do laço
// (avisarDepoisDoBoot, lib/fronteira-hospedada.js): cada teste começa com os do anterior já escritos.
const proximoTurno = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  await proximoTurno();
  fs.rmSync(HOME, { recursive: true, force: true });
  delete process.env[VARIAVEL];
});
after(() => {
  delete process.env[VARIAVEL];
  fs.rmSync(HOME, { recursive: true, force: true });
});

/* ---------- a variável ---------- */

test('a variável segue o padrão FAROL_* e só "1" liga; só ausente e "0" desligam', () => {
  assert.equal(VARIAVEL, 'FAROL_INSTANCIA_HOSPEDADA');
  assert.deepEqual(modoHospedado('1'), { ligada: true, invalido: false });
  for (const valor of [undefined, '0']) assert.deepEqual(modoHospedado(valor), { ligada: false, invalido: false }, String(valor));
});

test('valor que não é "1" nem "0" não vira desligado calado: é inválido, inclusive o vazio', () => {
  for (const valor of ['', ' ', 'true', 'sim', 'TRUE', 'on', ' 1', '1 ', '2', 'false']) {
    assert.deepEqual(modoHospedado(valor), { ligada: false, invalido: true }, JSON.stringify(valor));
  }
});

// Um manifesto com `value: ""` na variável não pode desligar a trava em silêncio.
test('variável vazia impede o boot, com ou sem config.json, e a mensagem mostra o vazio', () => {
  ligar('');
  let mensagem = recusa();
  assert.match(mensagem, /FAROL_INSTANCIA_HOSPEDADA inválida, o motor não sobe: o valor "" não é aceito/);
  assert.equal(fs.existsSync(HOME), false, 'nem o HOME do Farol foi criado');
  gravar(HOSPEDADO);
  ligar('');
  mensagem = recusa();
  assert.match(mensagem, /o valor "" não é aceito/);
});

test('valor inválido na variável impede o boot, com ou sem config.json, e não cria nada', () => {
  ligar('true');
  let mensagem = recusa();
  assert.match(mensagem, /FAROL_INSTANCIA_HOSPEDADA/);
  assert.match(mensagem, /"true"/);
  assert.equal(fs.existsSync(HOME), false, 'nem o HOME do Farol foi criado');
  gravar(HOSPEDADO);
  ligar('sim');
  mensagem = recusa();
  assert.match(mensagem, /"sim"/);
});

test('o valor inválido da variável não forja linha nem cor no terminal', () => {
  ligar('x\r\n[farol] tudo certo\u009b31m');
  const mensagem = recusa();
  assert.equal(mensagem.includes('\n'), false, 'uma linha só');
  assert.doesNotMatch(mensagem, /[\u0080-\u009f]/);
});

/* ---------- sem config.json ---------- */

test('hospedada e sem config.json: o motor não sobe e não cria o arquivo nem a pasta', () => {
  ligar();
  const mensagem = recusa();
  assert.match(mensagem, /instância hospedada \(FAROL_INSTANCIA_HOSPEDADA=1\), o motor não sobe: não há config\.json/);
  assert.ok(mensagem.includes(CONFIG_FILE), 'a mensagem diz o caminho esperado');
  assert.match(mensagem, /volume/, 'aponta a causa provável');
  assert.equal(fs.existsSync(HOME), false, 'nem o HOME do Farol foi criado');
});

test('hospedada, com a pasta de dados presente e vazia: também não sobe, e a pasta continua vazia', () => {
  fs.mkdirSync(HOME, { recursive: true });
  ligar();
  recusa();
  assert.deepEqual(fs.readdirSync(HOME), []);
});

test('controle: sem a variável, a instalação nova continua subindo sem config.json', () => {
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, '');
  assert.equal(fs.existsSync(CONFIG_FILE), true, 'fora do modo hospedado o boot grava o config.json, como sempre');
});

test('controle: com a variável em "0", a instalação nova também sobe', () => {
  ligar('0');
  assert.equal(new Engine().config.hostPublico, '');
});

/* ---------- config.json ilegível ---------- */

test('hospedada e com config.json ilegível: vale a recusa de sempre, e o arquivo fica como estava', () => {
  for (const conteudo of ['', '{ "hostPublico": ', '[]']) {
    gravar(conteudo);
    ligar();
    assert.match(recusa('CONFIG_ILEGIVEL'), /config\.json ilegível, o motor não sobe/);
  }
});

/* ---------- autenticação não exigida ---------- */

const SEM_AUTENTICACAO = [
  {},
  { port: 47190 },
  { bind: '127.0.0.1' },
  { conta: CONTA_EM_ESPERA },
  { localAuth: '', hostPublico: '', origensPermitidas: [] },
  { localAuth: null, hostPublico: null, origensPermitidas: null, bind: 'localhost' },
];

for (const config of SEM_AUTENTICACAO) {
  test(`hospedada com config que não exige autenticação não sobe: ${JSON.stringify(config)}`, () => {
    gravar(config);
    ligar();
    const mensagem = recusa();
    assert.match(mensagem, /não exige autenticação/);
    assert.ok(mensagem.includes(CONFIG_FILE));
  });
}

/* ---------- sem hostPublico nem origensPermitidas ---------- */

const SEM_FRONTEIRA = [
  { localAuth: 'exigir' },
  { bind: '0.0.0.0' },
  { localAuth: 'exigir', bind: '0.0.0.0', conta: CONTA_EM_ESPERA },
  { localAuth: 'exigir', hostPublico: '', origensPermitidas: [] },
];

for (const config of SEM_FRONTEIRA) {
  test(`hospedada sem hostPublico nem origensPermitidas não sobe, mesmo exigindo autenticação: ${JSON.stringify(config)}`, () => {
    gravar(config);
    ligar();
    const mensagem = recusa();
    assert.match(mensagem, /não define "hostPublico" nem "origensPermitidas"/);
    assert.doesNotMatch(mensagem, /não exige autenticação/, 'a autenticação já estava exigida: só a fronteira falta');
  });
}

test('a config que não exige autenticação recebe as duas linhas, uma por motivo', () => {
  gravar({});
  ligar();
  const linhas = recusa().split('\n');
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /não exige autenticação/);
  assert.match(linhas[1], /não define "hostPublico" nem "origensPermitidas"/);
});

/* ---------- a recusa de valor vem antes ---------- */

test('valor inválido na fronteira continua sendo a recusa de valor, não a da instância hospedada', () => {
  gravar({ hostPublico: 'https://farol.exemplo.com' });
  ligar();
  assert.match(recusa('FRONTEIRA_INVALIDA'), /"hostPublico" tem valor recusado/);
  gravar({ hostpublico: 'farol.exemplo.com' });
  assert.match(recusa('FRONTEIRA_INVALIDA'), /a grafia certa é "hostPublico"/);
});

/* ---------- o que sobe ---------- */

const SOBEM = [
  HOSPEDADO,
  { hostPublico: 'farol.exemplo.com' },
  { origensPermitidas: ['https://painel.exemplo.com'] },
  { bind: '0.0.0.0', origensPermitidas: ['http://localhost:3000'] },
];

for (const config of SOBEM) {
  test(`controle: hospedada com a fronteira definida sobe exigindo autenticação: ${JSON.stringify(config)}`, () => {
    gravar(config);
    ligar();
    const engine = new Engine();
    assert.equal(exigeAutenticacao({ config: engine.config, bindForaDoLoopback: engine.config.bind !== '127.0.0.1' }), true);
  });
}

/* ---------- o config.json de exemplo do guia ---------- */

test('o config.json de exemplo de docs/exemplos sobe na instância hospedada, sem agir e sem segredo', () => {
  const exemplo = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'exemplos', 'config.hospedagem.exemplo.json'), 'utf8');
  assert.doesNotMatch(exemplo, /apiKey|token|senha|password|secret/i, 'o exemplo não leva segredo nem campo de segredo');
  gravar(exemplo);
  ligar();
  const engine = new Engine();
  assert.equal(engine.config.bind, '0.0.0.0');
  assert.equal(engine.config.port, 47170);
  // nomes reservados que nunca resolvem: o exemplo subido sem trocar não aponta para ninguém
  assert.equal(engine.config.hostPublico, 'farol.exemplo.invalid');
  assert.deepEqual(engine.config.origensPermitidas, ['https://painel.exemplo.invalid']);
  assert.equal(engine.config.localAuth, 'exigir');
  assert.deepEqual(avisosDaHospedagem(engine.config, { ligada: true }), [], 'o exemplo não acende aviso');
  // a primeira subida recomendada: monitora, põe na fila e não posta nada sozinha
  const { autoReview, onClean, onCaveats, onReject } = engine.config.conta;
  assert.deepEqual({ autoReview, onClean, onCaveats, onReject }, { autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' });
});

/* ---------- config que sobe e não atende: aviso, não recusa ---------- */

const linhasDoLog = () => (fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean) : []);

test('avisosDaHospedagem: nada fora do modo hospedado, e nada com bind fora do loopback e hostPublico', () => {
  assert.deepEqual(avisosDaHospedagem({ bind: '127.0.0.1', hostPublico: 'farol.exemplo.com' }, { ligada: false }), []);
  assert.deepEqual(avisosDaHospedagem({ bind: '0.0.0.0', hostPublico: 'farol.exemplo.com', origensPermitidas: ['https://painel.exemplo.com'] }, { ligada: true }), []);
  assert.deepEqual(avisosDaHospedagem({ bind: '0.0.0.0', hostPublico: 'farol.exemplo.com' }, { ligada: true }), []);
});

test('avisosDaHospedagem: bind em loopback ou ausente avisa que o motor só escuta dentro do container', () => {
  for (const bind of [undefined, '', '127.0.0.1', 'localhost', '[::1]']) {
    const avisos = avisosDaHospedagem({ bind, hostPublico: 'farol.exemplo.com' }, { ligada: true });
    assert.equal(avisos.length, 1, String(bind));
    assert.match(avisos[0], /escuta só dentro do container/);
    assert.match(avisos[0], /"bind": "0\.0\.0\.0"/);
    assert.doesNotMatch(avisos[0], /\n|—/);
  }
});

test('avisosDaHospedagem: origensPermitidas sem hostPublico, com bind fora do loopback, avisa que o Host do proxy será recusado', () => {
  const avisos = avisosDaHospedagem({ bind: '0.0.0.0', port: 47170, hostPublico: '', origensPermitidas: ['https://painel.exemplo.com'] }, { ligada: true });
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /sem "hostPublico"/);
  assert.match(avisos[0], /403/);
  // a frase tem de ser verdade: sem hostPublico a allowlist recusa o nome público e aceita o loopback
  const base = { porta: 47170, bind: '0.0.0.0', hostPublico: '', origensPermitidas: ['https://painel.exemplo.com'] };
  assert.equal(validarHostEOrigem({ ...base, host: 'farol.exemplo.com' }).ok, false);
  assert.equal(validarHostEOrigem({ ...base, host: '127.0.0.1:47170' }).ok, true);
  assert.equal(validarHostEOrigem({ ...base, host: '0.0.0.0:47170' }).ok, true);
  for (const host of ['127.0.0.1:47170', 'localhost:47170', '0.0.0.0:47170']) assert.ok(avisos[0].includes(host), host);
});

test('a instância que sobe com bind em loopback grava UMA linha WARN no farol.log e não recusa', async () => {
  gravar({ hostPublico: 'farol.exemplo.com', conta: CONTA_EM_ESPERA });
  ligar();
  const engine = new Engine();
  assert.equal(engine.config.hostPublico, 'farol.exemplo.com');
  await proximoTurno();
  const avisos = linhasDoLog().filter((l) => l.includes('instância hospedada'));
  assert.equal(avisos.length, 1, linhasDoLog().join('\n'));
  assert.match(avisos[0], /\[WARN\] .*escuta só dentro do container/);
});

test('a instância com origensPermitidas, sem hostPublico e com bind aberto grava o aviso do Host', async () => {
  gravar({ bind: '0.0.0.0', origensPermitidas: ['https://painel.exemplo.com'], conta: CONTA_EM_ESPERA });
  ligar();
  new Engine();
  await proximoTurno();
  const avisos = linhasDoLog().filter((l) => l.includes('instância hospedada'));
  assert.equal(avisos.length, 1, linhasDoLog().join('\n'));
  assert.match(avisos[0], /\[WARN\] .*sem "hostPublico"/);
});

test('controle: a config completa e a instância fora do modo hospedado não gravam aviso', async () => {
  gravar(HOSPEDADO);
  ligar();
  new Engine();
  await proximoTurno();
  assert.deepEqual(linhasDoLog().filter((l) => l.includes('instância hospedada')), []);
  fs.rmSync(HOME, { recursive: true, force: true });
  delete process.env[VARIAVEL];
  gravar({ hostPublico: 'farol.exemplo.com' });
  new Engine();
  await proximoTurno();
  assert.deepEqual(linhasDoLog().filter((l) => l.includes('instância hospedada')), []);
});

/* ---------- a recusa e o farol.log ---------- */

// O config.json nunca é tocado. A linha da recusa vai ao farol.log quando a pasta de estado já
// existe (o volume de uma instância que já rodou); sem a pasta, nada é criado.
test('com a pasta de estado no volume, a recusa de config grava a linha no farol.log e não toca o config.json', () => {
  gravar({ bind: '0.0.0.0', localAuth: 'exigir' });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const antes = fs.readFileSync(CONFIG_FILE);
  ligar();
  let erro = null;
  try { new Engine(); } catch (e) { erro = e; }
  assert.equal(erro && erro.code, 'INSTANCIA_HOSPEDADA');
  assert.deepEqual(fs.readFileSync(CONFIG_FILE), antes);
  const linhas = linhasDoLog();
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /\[ERROR\] .*não define "hostPublico" nem "origensPermitidas"/);
});

/* ---------- a regra, pura ---------- */

test('recusasDaHospedagem: lista vazia fora do modo hospedado, qualquer que seja a config', () => {
  assert.deepEqual(recusasDaHospedagem({}, { ligada: false }), []);
  assert.deepEqual(recusasDaHospedagem(null, { ligada: false }), []);
});

test('recusasDaHospedagem: a exigência de autenticação é a de lib/local-auth, não uma cópia', () => {
  // hostPublico e origensPermitidas ligam a exigência sozinhos (lib/local-auth/modo.js): com um
  // deles não há linha nenhuma, mesmo sem localAuth
  assert.deepEqual(recusasDaHospedagem({ hostPublico: 'farol.exemplo.com' }, { ligada: true }), []);
  assert.deepEqual(recusasDaHospedagem({ origensPermitidas: ['https://painel.exemplo.com'] }, { ligada: true }), []);
  assert.equal(recusasDaHospedagem({ bind: '127.0.0.1' }, { ligada: true }).length, 2);
  assert.equal(recusasDaHospedagem({ bind: '0.0.0.0' }, { ligada: true }).length, 1);
  assert.equal(recusasDaHospedagem({ localAuth: 'exigir' }, { ligada: true }).length, 1);
});
