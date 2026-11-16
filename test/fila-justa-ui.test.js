// Painel de Justiça de fila (spec 2026-09-10-justica-de-fila-entre-orgs). O painel
// existe porque uma automação que CEDE A VEZ, vista de fora, é idêntica a uma automação
// QUEBRADA: nos dois casos o PR fica parado e nada na tela explica. Mesma lição do
// estacionamento visível (v2.57.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { filaJustaHtml, fjQuando, ordemDoEscalonador } = await import('../ui/pure.js');

test('fjQuando: nunca atendida, agora, e intervalo humano', () => {
  assert.equal(fjQuando(null), 'nunca');
  assert.equal(fjQuando(undefined), 'nunca');
  assert.equal(fjQuando(0), 'agora');
  assert.equal(fjQuando(720000), 'há 12m');
});

test('painel vazio não desenha card nenhum', () => {
  assert.equal(filaJustaHtml(null), '');
  // snapshot de motor antigo ainda traz a cota por perfil: o painel não a desenha mais
  const cota = { id: 'p1', label: 'Principal', tetoDoDia: 100, contas: [
    { user: 'a', peso: 1, esperando: true, cota: 50, gasto: 60, cedendo: true, cedendoPara: ['b'] },
    { user: 'b', peso: 1, esperando: true, cota: 50, gasto: 5, cedendo: false, cedendoPara: [] }] };
  assert.equal(filaJustaHtml({ porOrg: [], porPerfil: [cota], emCurso: 0, tetoGlobal: 0 }), '');
  assert.equal(filaJustaHtml({ porOrg: [], emCurso: 0, tetoGlobal: 0 }), '');
});

test('org: mostra fila, mais antigo e quando foi atendida pela última vez', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: 'biudtech', esperando: 3, esperaMaisAntigaMs: 3600000, ultimaVezMs: 120000 }],
    emCurso: 0, tetoGlobal: 0,
  });
  assert.match(html, /biudtech/);
  assert.match(html, /3 esperando/);
  assert.match(html, /mais antigo há 1h/);
  assert.match(html, /há 2m/);
});

test('org nunca atendida aparece como "nunca", que é o motivo de ela furar a fila', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: 'pessoal', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }],
    emCurso: 0, tetoGlobal: 0,
  });
  assert.match(html, /nunca/);
});

test('teto global só aparece quando está ligado', () => {
  const base = { porOrg: [{ org: 'x', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }] };
  assert.doesNotMatch(filaJustaHtml({ ...base, emCurso: 1, tetoGlobal: 0 }), /Teto global/);
  assert.match(filaJustaHtml({ ...base, emCurso: 1, tetoGlobal: 4 }), /1 de 4 revisões simultâneas/);
});

test('nome de org e login são escapados: eles vêm do GitHub, não do app', () => {
  const html = filaJustaHtml({
    porOrg: [{ org: '<img src=x onerror=alert(1)>', esperando: 1, esperaMaisAntigaMs: 0, ultimaVezMs: null }],
    emCurso: 0, tetoGlobal: 0,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

// Achado real de 10/09/2026, durante esta feature: um script de edição gravou um
// BACKSPACE (0x08) de verdade onde devia ir a sequência "\b" de uma regex. O fonte
// parecia certo em todo editor e em `grep`, o teste falhava sem explicação, e a regex
// silenciosamente deixou de casar. Caractere de controle em fonte é sempre engano.
test('INVARIANTE: nenhum fonte carrega caractere de controle invisível', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const raiz = path.join(import.meta.dirname, '..');
  const alvos = ['ui/pure.js', 'ui/app.js', 'server.js', 'lib/engine/review.js', 'lib/engine/usage.js', 'lib/parse.js'];
  const sujos = [];
  for (const rel of alvos) {
    const src = fs.readFileSync(path.join(raiz, rel), 'utf8');
    // tudo abaixo de 0x20 menos \t e \n (e \r, que o .gitattributes já persegue)
    const m = src.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
    if (m) sujos.push(`${rel}: ${m.length} ocorrência(s), primeira 0x${m[0].charCodeAt(0).toString(16)}`);
  }
  assert.deepEqual(sujos, [], 'caractere de controle no fonte: quase sempre uma sequência de escape que virou o byte de verdade');
});

// 30/09/2026: a tabela ordenava por quem espera há mais tempo, e o escalonador escolhe a org
// ATENDIDA há mais tempo. Com o cabeçalho prometendo "quem é atendido primeiro", a ordem
// da tabela tem de ser a de proximoHeadless.
test('Por org: a tabela segue a ordem do escalonador, não a da espera', () => {
  const porOrg = [
    { org: 'espera-muito', esperando: 1, esperaMaisAntigaMs: 9e6, ultimaVezMs: 60000 },
    { org: 'vazia', esperando: 0, esperaMaisAntigaMs: 0, ultimaVezMs: null },
    { org: 'nunca', esperando: 1, esperaMaisAntigaMs: 1000, ultimaVezMs: null },
    { org: 'faz-tempo', esperando: 2, esperaMaisAntigaMs: 5000, ultimaVezMs: 3600000 },
  ];
  assert.deepEqual(ordemDoEscalonador(porOrg).map(o => o.org), ['nunca', 'faz-tempo', 'espera-muito', 'vazia']);
  const html = filaJustaHtml({ porOrg, emCurso: 1, tetoGlobal: 0 });
  const pos = (o) => html.indexOf(`>${o}<`);
  assert.ok(pos('nunca') < pos('faz-tempo') && pos('faz-tempo') < pos('espera-muito') && pos('espera-muito') < pos('vazia'));
});
