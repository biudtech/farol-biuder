// `soundEnabled`, `theme` e `autostart` eram da tela antiga (som, tema e abrir com o sistema).
// A tela saiu em 16/11/2026 e nada no motor lia as três: o front novo guarda o tema no
// navegador. Elas saem da tabela de preferências, com o padrão do projeto para chave morta
// num config.json antigo: o motor sobe, ignora, e a chave some na próxima gravação.
// `aguardarCiParaAprovar` e `aguardarCiParaRevisar` seguem o mesmo padrão desde 17/11/2026: o
// revisor nunca espera o CI, nem para começar nem para aprovar, e as duas chaves não têm leitor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-pref-sem-leitor-'));
process.env.FAROL_HOME = home;
const CONFIG = path.join(home, 'config.json');
const MORTAS = ['soundEnabled', 'theme', 'autostart', 'aguardarCiParaAprovar', 'aguardarCiParaRevisar'];
const CONFIG_ANTIGA = JSON.stringify({
  esquemaConfig: 1,
  conta: { user: 'me', owners: ['acme'], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' },
  intervalSeconds: 600, soundEnabled: false, theme: 'light', autostart: true, aguardarCiParaAprovar: true, aguardarCiParaRevisar: true,
});
fs.writeFileSync(CONFIG, CONFIG_ANTIGA);

const { Engine } = await import('../server.js');
const { SETTINGS, EDITAVEIS, defaults, normalizarConfig } = await import('../lib/settings.js');

after(() => fs.rmSync(home, { recursive: true, force: true }));

function motor() {
  const e = new Engine();
  e.linhas = [];
  e.log = (nivel, msg) => e.linhas.push(`${nivel} ${msg}`);
  e.pushState = () => { };
  return e;
}

test('a tabela de preferências não conhece mais som, tema, abrir com o sistema nem as esperas do CI', () => {
  const chaves = SETTINGS.map((s) => s.key);
  const padroes = defaults(1);
  for (const morta of MORTAS) {
    assert.equal(chaves.includes(morta), false, `${morta} fora da tabela`);
    assert.equal(EDITAVEIS.has(morta), false, `${morta} não é editável`);
    assert.equal(morta in padroes, false, `${morta} sem padrão`);
  }
});

test('a leitura do config.json antigo descarta as cinco e deixa o resto', () => {
  assert.deepEqual(normalizarConfig({ intervalSeconds: 600, soundEnabled: false, theme: 'light', autostart: true, aguardarCiParaAprovar: true, aguardarCiParaRevisar: true }), { intervalSeconds: 600 });
});

test('config antiga com as cinco sobe, elas não chegam ao motor e o arquivo não é regravado na carga', () => {
  const e = motor();
  assert.equal(e.config.intervalSeconds, 600, 'a preferência viva do mesmo arquivo vale');
  assert.equal(e.config.conta.user, 'me');
  for (const morta of MORTAS) assert.equal(morta in e.config, false, `${morta} não chega ao motor`);
  for (const morta of MORTAS) assert.equal(morta in e.snapshot().config, false, `${morta} não sai no snapshot`);
  assert.equal(fs.readFileSync(CONFIG, 'utf8'), CONFIG_ANTIGA, 'a carga não reescreve o config.json');
});

test('a próxima gravação tira as cinco do disco', () => {
  const copia = fs.readFileSync(CONFIG, 'utf8');
  try {
    const e = motor();
    assert.deepEqual(e.updateSettings({ intervalSeconds: 900 }), { ok: true, ignoradas: [] });
    const gravado = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    assert.equal(gravado.intervalSeconds, 900);
    for (const morta of MORTAS) assert.equal(morta in gravado, false, `${morta} não volta ao arquivo`);
  } finally { fs.writeFileSync(CONFIG, copia); }
});

test('POST /api/settings com uma das cinco devolve a chave em ignoradas e não a grava', () => {
  const copia = fs.readFileSync(CONFIG, 'utf8');
  try {
    const e = motor();
    const r = e.updateSettings({ theme: 'dark', soundEnabled: true, autostart: false, aguardarCiParaAprovar: true, aguardarCiParaRevisar: true, reviewFast: true });
    assert.deepEqual(r.ignoradas.slice().sort(), ['aguardarCiParaAprovar', 'aguardarCiParaRevisar', 'autostart', 'soundEnabled', 'theme']);
    assert.equal(e.config.reviewFast, true, 'a chave viva do mesmo salvar entra');
    for (const morta of MORTAS) assert.equal(morta in e.config, false);
    const gravado = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    for (const morta of MORTAS) assert.equal(morta in gravado, false);
    assert.equal(e.linhas.filter((l) => /ignorou chave desconhecida/.test(l)).length, 1, 'e o log diz o que foi ignorado');
  } finally { fs.writeFileSync(CONFIG, copia); }
});
