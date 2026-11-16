// A conta revisora detectada pelo gh no primeiro boot, e a instância de teste do guia.
//
// O guia manda subir a instância isolada com `{"port": 47180, "autoReview": false}` no
// config.json, justamente para ela NÃO revisar sozinha com a conta real de quem a abriu. A
// chave geral `autoReview` saiu em 30/09/2026 e virou campo da conta; aqui a escolha gravada
// antes de existir login tem de sobreviver até o gh ser detectado, inclusive a um reinício no
// meio (medido em 20/10/2026 no desenho antigo: a conta nascia revisando e aprovando sozinha).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-conta-detectada-'));
process.env.FAROL_HOME = FAROL_HOME;
const CONFIG = path.join(FAROL_HOME, 'config.json');

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let login = '';
const pedidos = [];
io.run = async (cmd, args) => {
  pedidos.push(args.join(' '));
  if (args.join(' ') === 'api user --jq .login') return { ok: !!login, code: login ? 0 : 1, stdout: `${login}\n`, stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const gravada = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
function motor() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.avisos = [];
  e.on('toast', (t) => e.avisos.push(t));
  return e;
}

test('instância de teste: a escolha gravada antes do login vale quando o gh é detectado, mesmo com um reinício no meio', async () => {
  fs.writeFileSync(CONFIG, JSON.stringify({ port: 47180, autoReview: false }));
  login = '';
  const primeiro = motor();
  await primeiro.resolveAccount();
  assert.equal(primeiro.primaryUser(), '', 'sem gh logado não há conta');
  assert.equal(primeiro.autoReviewFor(''), false);
  assert.equal(gravada().conta.autoReview, false, 'a escolha foi para o disco, na conta ainda sem login');
  assert.equal('autoReview' in gravada(), false, 'a chave geral antiga não volta para o arquivo');

  // reinício antes do login: a escolha não pode se perder na segunda carga
  const segundo = motor();
  assert.equal(segundo.config.conta.autoReview, false);
  login = 'detectada';
  await segundo.resolveAccount();
  assert.equal(segundo.primaryUser(), 'detectada');
  assert.equal(segundo.autoReviewFor('detectada'), false, 'a conta real não nasce revisando sozinha');
  assert.deepEqual(gravada().conta, { user: 'detectada', owners: ['biudtech'], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.equal(segundo.avisos.length, 1);
  assert.match(segundo.avisos[0].text, /Conta do GitHub detectada: @detectada/);
});

test('com a conta configurada, o gh não é consultado para detectar outra', async () => {
  login = 'intrusa';
  const e = motor();
  pedidos.length = 0;
  await e.resolveAccount();
  assert.equal(e.primaryUser(), 'detectada');
  assert.deepEqual(pedidos, []);
});

test('instalação nova: a conta detectada nasce com as orgs padrão e a política por extenso', async () => {
  fs.rmSync(CONFIG, { force: true });
  login = 'nova';
  const e = motor();
  assert.equal(fs.existsSync(CONFIG), true, 'o primeiro boot grava a config');
  assert.equal('conta' in gravada(), false, 'sem login ainda não há conta no arquivo');
  await e.resolveAccount();
  assert.deepEqual(gravada().conta, { user: 'nova', owners: ['biudtech'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.deepEqual(e.accountList(), [{ user: 'nova', owners: ['biudtech'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }]);
});

test('os padrões de Automação da instalação nova: retomada ligada, CI obrigatório antes da aprovação desligado', () => {
  const e = motor();
  assert.equal(e.config.reReviewResume, true);
  assert.equal(e.config.aguardarCiParaAprovar, false);
  assert.equal('esquemaConfig' in gravada(), false, 'o marcador das migrações antigas saiu com elas');
});
