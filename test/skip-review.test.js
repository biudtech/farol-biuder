// UM Farol por PR (v2.51.0). O que dá pra provar sem rede é o que importa aqui:
// a leitura dos sinais é PURA (a label), o gate é síncrono e sem IO (mesmo contrato do
// reReviewTargets: quem decide gastar sessão Claude tem que ser testável), a saída de cena é
// DURÁVEL (era o defeito da v2.49.0: adiava cinco minutos e revisava depois) e ela CADUCA
// quando a sessão do colega morre sem deixar review. A co-assinatura e as refs de transição
// saíram no corte da fase 1. Desde 28/08/2026 (incidente do biud-frontend#845) a saída de
// cena é SILENCIOSA no GitHub: nada de comentário público (era template
// detectável), a âncora nasce da decisão e o aviso é um toast no app.
import os from 'node:os';
import path from 'node:path';
// ISOLAMENTO OBRIGATÓRIO, e ele estava faltando: saiDeCena/podarSkipComentado
// GRAVAM em STATE_DIR, que o paths.js resolve na hora do import. Sem fixar o
// FAROL_HOME antes, a suíte escrevia `skip-comentado.json` na instalação REAL
// (achado em 20/08/2026, com lixo de teste no ~/.farol de verdade). É a mesma
// lição do spawnlog.test.js documentada no docs/MACOS.md, com outra roupa: lá o
// problema era o import hasteado, aqui era não ter env nenhuma.
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-skip-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skip = await import('../lib/engine/skip-review.js');
const io = (await import('../lib/io.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const { revisandoPorOutros, textoDoPulo, outrosRevisando, standDownCaducou } = skip;

const TTL = TEMPOS.SINAL_REVISAO_TTL_MS;

/* ---------- leitura das labels (PURA) ---------- */

// Os `await` de topo vêm ANTES do primeiro caso: com `--test-force-exit`, o processo
// encerra quando os casos já registrados terminam, e um `await` que só volta depois
// disso deixa os casos seguintes CANCELADOS, numa rodada que ainda diz "0 falhas".

test('revisandoPorOutros: acha a label de outra pessoa', () => {
  assert.deepEqual(revisandoPorOutros(['thiagocarvalho-dev:revisando'], 'wandersonbiuder'), ['thiagocarvalho-dev']);
});

test('revisandoPorOutros: a MINHA própria label não me barra, mesmo com outra caixa', () => {
  assert.deepEqual(revisandoPorOutros(['wandersonbiuder:revisando'], 'wandersonbiuder'), []);
  assert.deepEqual(revisandoPorOutros(['WandersonBiuder:revisando'], 'wandersonbiuder'), []);
});

// regra explícita do Wanderson: review de ferramenta não substitui olho humano
test('revisandoPorOutros: acrity NUNCA entra na conta', () => {
  assert.deepEqual(revisandoPorOutros(['acrity:revisando'], 'eu'), []);
  assert.deepEqual(revisandoPorOutros(['acrity:revisando', 'ana:revisando'], 'eu'), ['ana']);
});

/* ehFerramenta: as DUAS grafias da mesma ferramenta têm que se encontrar. O
   prefixo da label é `acrity`; o login na API de reviews é
   `acrity-advesarial-code-review[bot]`. Confundir os dois custou a revisão
   automática de um PR inteiro do time (biudtech/engine-ai#108, 29/08/2026). */
test('ehFerramenta: reconhece a ferramenta pelas três provas', () => {
  const { ehFerramenta } = skip;
  assert.equal(ehFerramenta('acrity'), true, 'o nome cru da lista');
  assert.equal(ehFerramenta('acrity-advesarial-code-review[bot]'), true, 'o login REAL da API');
  assert.equal(ehFerramenta('acrity-advesarial-code-review'), true, 'o mesmo login sem o sufixo');
  assert.equal(ehFerramenta('ACRITY-Advesarial-Code-Review[BOT]'), true, 'caixa não importa');
  assert.equal(ehFerramenta('coderabbitai[bot]'), true, 'qualquer bot, sem estar em lista');
  assert.equal(ehFerramenta('alguem', 'Bot'), true, 'o type da API basta sozinho');
});

test('ehFerramenta: gente continua sendo gente', () => {
  const { ehFerramenta } = skip;
  assert.equal(ehFerramenta('Alexpraxedes'), false);
  assert.equal(ehFerramenta('wandersonbiuder', 'User'), false);
  assert.equal(ehFerramenta('acrityana'), false, 'prefixo sem hífen não é a ferramenta');
  assert.equal(ehFerramenta(''), false);
  assert.equal(ehFerramenta(null), false);
});

/* LABEL ÓRFÃ (bug de campo relatado em 29/08/2026: "o Farol tem pulado review
   sem nunca ninguém estar analisando o PR"). A label `<conta>:revisando` é
   aplicada no início da sessão e removida no finally, mas o finally não roda
   quando o app morre no meio (o farol.log desta máquina tem 3 quedas de
   renderer em 3 dias, além dos reinícios do auto-update), e a remoção também
   pode falhar por rede (WARN `label ... não saiu de ...` observado em
   biud-esg#260). Label presa não tem relógio nenhum: as REFS da v2.53.9 já
   caducavam em 1h (sinalVivo), a label não caducava NUNCA, então um Farol morto
   calava a frota inteira naquele PR pra sempre. O relógio é local e honesto: há
   quanto tempo ESTE Farol vê a mesma label. Falta de carimbo = label nova = vale,
   então o gate nunca fica mais permissivo do que era na primeira observação. */
test('revisandoPorOutros: label vista há mais que o TTL é órfã e não segura mais', () => {
  const agora = 1_000_000_000;
  const vistas = { ana: agora - TTL - 1 };
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', vistas, agora, TTL), []);
});

test('revisandoPorOutros: label vista há POUCO continua segurando', () => {
  const agora = 1_000_000_000;
  const vistas = { ana: agora - 60_000 };
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', vistas, agora, TTL), ['ana']);
});

test('revisandoPorOutros: sem carimbo a label vale (falta de dado nunca libera sozinha)', () => {
  const agora = 1_000_000_000;
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', {}, agora, TTL), ['ana']);
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu'), ['ana'], 'chamada antiga, sem relógio, segue igual');
});

test('marcarLabelsVistas: carimba na primeira vez e PRESERVA o carimbo depois', () => {
  const e = { labelVistaDesde: {}, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  const pano = [{ key: 'o/r#1', labels: ['ana:revisando'] }];
  skip.marcarLabelsVistas(e, pano, 1000);
  assert.deepEqual(e.labelVistaDesde['o/r#1'], { ana: 1000 });
  skip.marcarLabelsVistas(e, pano, 9000);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, 1000, 'é isso que faz o tempo passar');
});

test('marcarLabelsVistas: label que saiu do PR perde o carimbo (sessão nova recomeça o relógio)', () => {
  const e = { labelVistaDesde: { 'o/r#1': { ana: 1000 } }, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  skip.marcarLabelsVistas(e, [{ key: 'o/r#1', labels: [] }], 9000);
  assert.equal(e.labelVistaDesde['o/r#1'], undefined);
});

test('marcarLabelsVistas: PR que saiu do panorama perde o carimbo', () => {
  const e = { labelVistaDesde: { 'o/r#9': { ana: 1000 } }, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  skip.marcarLabelsVistas(e, [{ key: 'o/r#1', labels: ['ana:revisando'] }], 9000);
  assert.equal(e.labelVistaDesde['o/r#9'], undefined);
});

test('revisandoPorOutros: label que não é de revisando é ignorada', () => {
  assert.deepEqual(revisandoPorOutros(['bug', 'acrity:approved', 'review:in-progress'], 'eu'), []);
});

test('revisandoPorOutros: várias pessoas saem sem repetição e em ordem estável', () => {
  assert.deepEqual(revisandoPorOutros(['zoe:revisando', 'ana:revisando', 'zoe:revisando'], 'eu'), ['ana', 'zoe']);
});

test('revisandoPorOutros: entrada torta nunca lança', () => {
  assert.deepEqual(revisandoPorOutros(null, 'eu'), []);
  assert.deepEqual(revisandoPorOutros('nao-e-array', 'eu'), []);
  assert.deepEqual(revisandoPorOutros([null, '', ':revisando'], 'eu'), []);
});

/* ---------- o gate: síncrono, sem IO ---------- */

test('outrosRevisando: lê só o que os ciclos já trouxeram, nunca chama gh', () => {
  const engine = {
    accountForPr: () => 'eu',
    ghEnv: () => { throw new Error('o gate não podia tocar o gh'); },
    tokenFor: () => { throw new Error('o gate não podia perguntar token'); },
  };
  assert.deepEqual(outrosRevisando(engine, { labels: ['ana:revisando'] }), ['ana']);
  // PR de uma busca antiga (sem o campo labels) degrada pra "ninguém revisando",
  // que é o comportamento de antes desta feature: falta de dado nunca pula revisão
  assert.deepEqual(outrosRevisando(engine, {}), []);
});

/* ---------- texto do toast (era o comentário público até 28/08/2026) ---------- */

test('textoDoPulo: sem citar automação, sem pronome de gênero e sem travessão', () => {
  const t = textoDoPulo(['ana']);
  assert.match(t, /@ana já está revisando/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|revisão automática/i);
  assert.doesNotMatch(t, /\bele\b|\bela\b/i);
  assert.doesNotMatch(t, /—/);
});

test('textoDoPulo: plural e lista com "e" no fim', () => {
  assert.match(textoDoPulo(['ana', 'zoe']), /@ana e @zoe já estão revisando/);
  assert.match(textoDoPulo(['ana', 'bia', 'zoe']), /@ana, @bia e @zoe/);
  assert.equal(textoDoPulo([]), '');
});

/* ---------- caducidade (PURA) ---------- */

// a rede de segurança: sem isso, um crash na máquina do colega deixaria o PR órfão
test('standDownCaducou: caduca quando quem pegou sumiu sem deixar review', () => {
  const reg = { quem: ['ana'] };
  assert.equal(standDownCaducou(reg, [], []), true);
});

test('standDownCaducou: NÃO caduca enquanto a pessoa ainda está com a label', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, ['ana'], []), false);
});

test('standDownCaducou: NÃO caduca quando ela deixou review no head', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'APPROVED' }]), false);
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]), false);
});

// sem prova (rede fora) fico de fora: é o lado seguro de "um Farol por PR"
test('standDownCaducou: sem a lista de reviews NUNCA caduca', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], null), false);
});

test('standDownCaducou: com duas pessoas, basta uma seguir viva pra não caducar', () => {
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, ['zoe'], []), false);
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, [], []), true);
});

/* ---------- saída de cena ---------- */

function engineFalso(extra = {}) {
  return {
    skipComentado: {},
    config: {},
    logs: [], toasts: [], rodou: [], postados: [],
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    ghEnv: () => ({}),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    myReviewStates: async () => [],
    postReview: async (pr, payload) => { extra.postados && extra.postados.push(payload); return { ok: true }; },
    ...extra,
  };
}

// substitui io.run pelo espião e devolve a função de restaurar
function espiaGh(engine, ok = true) {
  const original = io.run;
  io.run = (cmd, args) => { engine.rodou.push(args); return Promise.resolve({ ok, stdout: '[]', stderr: 'falhou' }); };
  return () => { io.run = original; };
}

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

// desde 28/08/2026 a saída de cena é silenciosa no GitHub: a âncora nasce da
// DECISÃO (não mais de um comentário que saiu) e o aviso é o toast no app
test('saiDeCena: grava a âncora POR HEAD e avisa por toast, sem gh nenhum', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine));
  const ok = await skip.saiDeCena(engine, PR, ['ana'], 'sha1');
  assert.equal(ok, true);
  assert.equal(engine.rodou.length, 0, 'NENHUM gh roda (nem pr comment, nem nada): zero rastro público');
  assert.equal(engine.skipComentado['o/r#1'].head, 'sha1');
  assert.deepEqual(engine.skipComentado['o/r#1'].quem, ['ana']);
  const toast = engine.toasts.find(x => x.ev === 'toast');
  assert.ok(toast, 'o aviso existe, só que no app');
  assert.match(toast.payload.text, /@ana já está revisando/);
  assert.match(toast.payload.text, /o\/r#1/);
  assert.match(toast.payload.text, /sem postar nada público/i, 'o toast diz que nada foi postado');
});

// o contrato antigo "a âncora só nasce de comentário que saiu" morreu junto com
// o comentário; a exigência que fica é a lista de quem está revisando
test('saiDeCena: sem ninguém revisando não registra saída nenhuma', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine));
  assert.equal(await skip.saiDeCena(engine, PR, [], 'sha1'), false);
  assert.equal(engine.skipComentado['o/r#1'], undefined);
  assert.equal(engine.rodou.length, 0);
});

/* ---------- o ciclo: seguir fora ou caducar ---------- */

// espião que devolve uma lista de reviews de outros pelo caminho do gh api
function espiaReviews(engine, lista) {
  const original = io.run;
  io.run = (cmd, args) => {
    engine.rodou.push(args);
    if (args[0] === 'api') return Promise.resolve({ ok: true, stdout: JSON.stringify(lista), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  return () => { io.run = original; };
}

test('seguirForaDeCena: sessão do colega morreu sem review, a saída caduca', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, []));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, false, 'volta a revisar');
  assert.equal(engine.skipComentado['o/r#1'], undefined, 'âncora some');
});

test('seguirForaDeCena: aprovação do colega não vira aprovação minha, e o PR segue fora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, true, 'segue fora de cena');
  assert.equal(postados.length, 0, 'nada foi postado');
});

// pedido de mudanças do colega NÃO é aprovação: nada é postado, e o PR
// continua fora de cena (um Farol por PR), esperando o autor corrigir
test('seguirForaDeCena: colega pediu mudanças, nada é postado e segue fora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1'), true);
  assert.equal(postados.length, 0);
});

// review de head ANTIGO não conta: o autor empurrou código novo desde então
test('reviewsDeOutros: filtra pelo head pedido', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, [
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha-velho' },
    { quem: 'zoe', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const lista = await skip.reviewsDeOutros(engine, PR, 'sha1');
  assert.deepEqual(lista.map(r => r.quem), ['zoe']);
});

test('podarSkipComentado: âncora some junto com o PR que saiu do panorama', () => {
  const engine = engineFalso();
  engine.skipComentado = { 'o/r#1': { at: 1 }, 'o/r#2': { at: 2 } };
  skip.podarSkipComentado(engine, new Set(['o/r#1']));
  assert.deepEqual(Object.keys(engine.skipComentado), ['o/r#1']);
});

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
