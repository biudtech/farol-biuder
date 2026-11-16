// Onda 8: widgets de operacao (showOp/updateOp/closeOp) e estado da UI.
//
// O ciclo de vida de uma operacao virou maquina de estados PURA (ui/pure.js):
// running -> done|error|cancelled, e cada estado terminal tem prazo de auto-dismiss.
// O DOM (ui/app.js) so consome. O que nao da pra testar sem DOM fica travado por
// invariante estatica no texto do app.js, no idioma do ui-semantics.test.js.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../ui/pure.js';
import { fonteDosPuros, fonteDasTelas } from './helpers/fontes-ui.js';
const APPJS = fonteDasTelas();
const HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'app.css'), 'utf8');

/* ---------- maquina de estados das operacoes (M22) ---------- */

test('opTransition: running anda pra qualquer terminal', () => {
  assert.equal(P.opTransition('running', 'done'), 'done');
  assert.equal(P.opTransition('running', 'error'), 'error');
  assert.equal(P.opTransition('running', 'cancelled'), 'cancelled');
});

test('opTransition: estado terminal nao vira outro terminal nem volta a running', () => {
  assert.equal(P.opTransition('done', 'error'), 'done');
  assert.equal(P.opTransition('error', 'done'), 'error');
  assert.equal(P.opTransition('cancelled', 'running'), 'cancelled');
});

test('opTransition: destino desconhecido nao anda', () => {
  assert.equal(P.opTransition('running', 'sumiu'), 'running');
});

test('opDismissDelay: running nao some sozinho, todo terminal SEMPRE some', () => {
  // pill de erro imortal era o M22: acumulava uma por tentativa
  assert.equal(P.opDismissDelay('running'), null);
  assert.equal(P.opDismissDelay('done'), 3000);
  assert.equal(P.opDismissDelay('error'), 6000);
  assert.equal(P.opDismissDelay('cancelled'), 6000);
});

test('closeOp agenda o dismiss pela maquina, nao so no done (M22)', () => {
  const fn = APPJS.match(/function closeOp\([\s\S]*?\n\}/);
  assert.ok(fn, 'closeOp existe');
  assert.match(fn[0], /opDismissDelay\(/, 'o prazo de sumir vem da funcao pura');
  assert.match(fn[0], /opTransition\(/, 'a transicao de status passa pela maquina');
  assert.doesNotMatch(fn[0], /result === 'done'\) \{\s*setTimeout/,
    'error e cancelled tambem expiram, nao so done');
});

test('showOp remove a pill anterior antes de recriar com o mesmo id (M22)', () => {
  const fn = APPJS.match(/function showOp\([\s\S]*?\n\}/);
  assert.ok(fn, 'showOp existe');
  assert.match(fn[0], /const prev = ACTIVE_OPS\.get\(opId\)/, 'consulta a operacao anterior');
  assert.match(fn[0], /prev\.element\.remove\(\)/, 'a pill velha sai do DOM antes da nova entrar');
});

/* ---------- widget sys-polling (B11) ---------- */

test('sys-polling ancora em elemento que existe, nao em id fantasma (B11)', () => {
  assert.match(HTML, /id="metaCheck"/, 'a ancora real existe no index.html');
  assert.doesNotMatch(APPJS, /\$\('#metaLine'\)/, 'nao existe id metaLine no index.html');
  assert.doesNotMatch(APPJS, /\$\('#topbar'\)/, 'topbar e classe, nao id: $() devolvia null');
  const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
  assert.ok(fn, 'renderStatus existe');
  assert.match(fn[0], /#metaCheck/, 'a pill de polling vive ao lado do #metaCheck');
});

test('erro de checagem nao trava o widget sys-polling pra sempre (B11)', () => {
  const fn = APPJS.match(/function renderStatus\([\s\S]*?\n\}/);
  assert.match(fn[0], /status !== 'running'/,
    'op terminal e purgada no comeco do ciclo seguinte, senao o has() barra o novo widget');
});

/* ---------- estagio da sessao ativa (B13) ---------- */

test('o cabecalho da sessao mostra a etapa REAL, nao a idade da sessao', () => {
  const t0 = 1000;
  const flow = P.stageFlowFrom([{ t: t0 + 400, s: 'leitura' }], t0, t0 + 900);
  assert.equal(P.etapaAtiva(flow), 'leitura');
  // sessao recem-nascida ainda nao tem etapa, e o cartao nasce com "(iniciando…)"
  assert.equal(P.etapaAtiva(P.stageFlowFrom([], t0, t0 + 10)), '');
});

/* B13 tem duas metades: a marcacao precisa carregar o data-started, e o ticker precisa
   voltar nele de segundo em segundo. A marcacao virou sessionCardHtml no ui/pure.js na
   onda 5 e o guarda dela foi junto (ui-pure.test.js, "cartao de sessao"). Aqui fica a
   outra metade, que so existe no app.js: quem envelhece o rotulo. */
test('o rotulo de estagio tem ticker proprio e nao congela no primeiro paint (B13)', () => {
  const fn = APPJS.match(/function tickElapsed\([\s\S]*?\n\}/);
  assert.ok(fn, 'tickElapsed existe');
  assert.match(fn[0], /session-stage/, 'o ticker de 1s envelhece o estagio, como ja faz com o elapsed');
  assert.match(fn[0], /etapaAtiva\(/, 'o texto vem da funcao pura, com a etapa estampada pelo engine');
});

/* ---------- escopo persistido orfao (B15) ---------- */

/* ---------- visibilidade da barra de contas (B14) ---------- */

/* ---------- estado de carregamento das listas (a lista vinha assumindo vazio) ---------- */

test('listViewState: nunca assume vazio antes do primeiro ciclo terminar', () => {
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'starting', length: 0 }), 'loading');
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'checking', length: 0 }), 'loading');
});

test('listViewState: primeiro ciclo falhou sem nunca ter confirmado nada vira erro, nao vazio', () => {
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'error', length: 0 }), 'error');
});

test('listViewState: so' + ' chama de vazio depois de um ciclo confirmado', () => {
  assert.equal(P.listViewState({ lastCheckAt: 12345, status: 'idle', length: 0 }), 'empty');
});

test('listViewState: lista com item sempre mostra a lista, mesmo se o ciclo mais recente falhou', () => {
  // preserva o ultimo dado bom (o motor ja faz isso); a UI so decide entre
  // loading/error/empty quando a lista em si esta vazia
  assert.equal(P.listViewState({ lastCheckAt: 12345, status: 'error', length: 3 }), 'list');
  assert.equal(P.listViewState({ lastCheckAt: null, status: 'checking', length: 1 }), 'list');
});

test('renderQueue decide o empty state pelo listViewState, nao so pelo tamanho', () => {
  for (const nome of ['renderQueue']) {
    const fn = APPJS.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}`));
    assert.ok(fn, `${nome} existe`);
    assert.match(fn[0], /listViewState\(/,
      `${nome} precisa consultar listViewState antes de decidir o empty state, senao assume vazio sem resposta definitiva`);
  }
});

/* ---------- Diagnostico: resumo agrupado antes do despejo cru ----------
   O que da pra testar sem DOM ja mora no ui/pure.js (ui-pure.test.js). Aqui ficam as
   invariantes do CONSUMO: o app tem que ler a rota agrupada, montar resumo antes do
   detalhe e nao voltar a despejar o log inteiro. */

/* O texto do diagnóstico deixou de ser montado na tela na A3 (16/09/2026): quem monta é o
   engine, e a tela só lê GET /api/diagnostics e mostra inerte. Os dois testes que ficavam
   aqui (de onde vinha o dado e o teto de 40 linhas do despejo) sumiram com a função; o que
   eles protegiam está em test/diagnostico-falhas-tela.test.js e em
   test/diagnostico-unificado.test.js, que olham a saída do engine. */

test('a aba Sistema mostra o resumo agrupado do log, e o botao de zerar saiu', () => {
  const fn = APPJS.match(/async function loadLog\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'loadLog existe');
  assert.match(fn[0], /get\('\/api\/log\/triage'\)/);
  assert.match(fn[0], /logSummaryShort\(grupos \|\| \[\], 3\)/, 'os 3 maiores grupos');
  assert.match(HTML, /<p class="sys-note" id="logResumo" hidden><\/p>/,
    'o resumo mora em paragrafo proprio: a .section-head e flex e quebra cedo');
  assert.doesNotMatch(HTML, /id="btnLogClear"/, 'o botao de zerar saiu com a rota /api/log/clear (corte do lote 7)');
  assert.match(HTML, /id="logBox"/, 'o despejo cru continua disponivel embaixo');
});

/* ---------- menções navegáveis: estrutura que a foto/link exigem ----------
   As funções puras estão travadas em ui-pure.test.js; aqui ficam as invariantes
   que só existem no app.js/index.html: o título que trunca sem comer o autor e
   o handler ÚNICO de navegação interna. */

// Corpos de todos os `@media (max-width: N px)` concatenados (chaves equilibradas).
function corposDaMedia(largura) {
  const marca = `@media (max-width: ${largura}px)`;
  const corpos = [];
  for (let abre = CSS.indexOf(marca); abre >= 0; abre = CSS.indexOf(marca, abre + 1)) {
    const i = CSS.indexOf('{', abre);
    let prof = 0;
    for (let j = i; j < CSS.length; j += 1) {
      if (CSS[j] === '{') prof += 1;
      if (CSS[j] === '}') { prof -= 1; if (!prof) { corpos.push(CSS.slice(i + 1, j)); break; } }
    }
  }
  return corpos.join('\n');
}

test('topbar em 768 px: Verificar agora vira só o ícone até 900 px', () => {
  assert.match(corposDaMedia(900), /#btnCheck span\s*\{\s*display:\s*none/,
    'o rótulo some até 900 px, senão a aba Sistema é cortada em 768 px');
});

test('navegação interna tem UM handler só, delegado, e entende os 2 tipos', () => {
  const fn = APPJS.match(/function goTo\(spec\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'goTo existe');
  assert.match(fn[0], /const \{ tipo, alvo, seletor \} = parseGoto\(spec\);/,
    'o parse do spec mora no ui/pure.js, onde tem teste');
  assert.match(fn[0], /if \(tipo === 'aba'\) return gotoAba\(alvo, seletor \|\| null\);/,
    'aba: repassa o seletor (destino de ferramenta precisa dele)');
  assert.match(fn[0], /switchTab\('sistema'\);\s*\n\s*return sysGoTo\(alvo, seletor \|\| null\);/,
    'sys: troca a aba ANTES do sysGoTo (elemento em aba escondida não rola)');
  // o tipo 'deliv' (Entregas) saiu no lote 7 do corte
  assert.doesNotMatch(fn[0], /deliv/);
  // mesma ordem do sysGoTo, pelo mesmo motivo, e sem piscar painel escondido
  assert.match(APPJS, /function gotoAba\(nome, at\) \{\s*\n\s*switchTab\(nome\);/,
    'gotoAba troca a aba ANTES de procurar o alvo');
  assert.match(APPJS, /if \(!el \|\| el\.hidden\) return;/,
    'painel de ferramenta sem resultado ainda é hidden: não pisca o que ninguém vê');
  assert.match(APPJS, /document\.addEventListener\('click', \(e\) => \{\s*\n\s*const el = e\.target\.closest\('\[data-goto\]'\);/,
    'um listener delegado no document, não um por tela');
  assert.match(APPJS, /document\.addEventListener\('keydown'/, 'mesma navegação pelo teclado');
});

test('toda menção com data-goto é anunciada como botão (role + tabindex)', () => {
  // O pure.js entra na varredura desde a onda 5: os emissores de data-goto foram
  // saindo do app.js junto com as funções puras (hoje são mais lá do que aqui), e
  // um contrato de acessibilidade que só olha o arquivo de origem vira cego assim
  // que o código muda de casa. Foi o que aconteceu ao mover o bloco de Consumo: o
  // piso caiu de 6 pra 5 e o teste reprovou sem que nenhuma menção tivesse perdido
  // role ou tabindex.
  const PUREJS = fonteDosPuros();
  const fontes = [APPJS, HTML, PUREJS];
  const alvos = fontes.reduce((n, src) => n + [...src.matchAll(/data-goto="[^"]*"/g)].length, 0);
  assert.ok(alvos >= 6, `esperava várias menções navegáveis, achei ${alvos}`);
  // cada emissão de data-goto em elemento não interativo tem role/tabindex junto
  for (const src of fontes) {
    const semRole = [...src.matchAll(/<span[^>]*data-goto="[^"]*"[^>]*>/g)]
      .filter(m => !/role="button"/.test(m[0]) || !/tabindex="0"/.test(m[0]));
    assert.deepEqual(semRole.map(m => m[0].slice(0, 90)), [],
      'span com data-goto precisa de role="button" e tabindex="0"');
  }
});

/* ---------- progresso: regua unica, sem percentual chutado ---------- */

test('progresso literal no app.js so existe no paint inicial (<= 10)', () => {
  // o bug de origem (16/08/2026): barra de uma sessao fixa em "progress: 25"
  // ate concluir do nada. A regra agora e central: percentual de meio de fluxo
  // vem SEMPRE de sessionProgress (ui/pure.js); literal so pro primeiro paint,
  // e primeiro paint honesto e baixo (ninguem mediu nada ainda).
  const chutes = [...APPJS.matchAll(/progress:\s*(\d+)/g)].filter(m => Number(m[1]) > 10);
  assert.deepEqual(chutes.map(m => m[0]), [],
    'percentual literal acima de 10 no app.js: use sessionProgress (ui/pure.js), a regua unica de progresso');
});

/* ---------- o vazio da fila nomeia a org CERTA ----------
   Bug de 12/09/2026: a frase "o Farol monitora X" saía de `config.owners`, o campo legado
   que o `accountList()` do server só usa quando não há conta cadastrada. Com contas, o
   motor ignorava aquele campo e a tela continuava exibindo ele, e o escopo do seletor não
   entrava na conta. Não dá pra testar o render sem DOM, então a trava é estática: a fonte
   daquele parâmetro tem que ser a régua de `ui/pure.js`, nunca o campo legado. */

// o trecho da chamada, do `(` até o `});` que a fecha. Recortar por índice e não por
// regex de chaves de propósito: comentário dentro do objeto já quebrou a versão com
// quantificador, e o teste tem que reprovar a FONTE errada, nunca o comentário novo.
function chamadaDoVazio() {
  const i = APPJS.indexOf('queueEmptyOkHtml({');
  if (i < 0) return '';
  const fim = APPJS.indexOf('});', i);
  return fim < 0 ? '' : APPJS.slice(i, fim);
}

test('o vazio da fila recebe as orgs da régua, não o campo legado config.owners', () => {
  const chamada = chamadaDoVazio();
  assert.ok(chamada, 'a chamada de queueEmptyOkHtml sumiu do app.js');
  assert.match(chamada, /owners:\s*orgsMonitoradas\(/,
    'owners tem que vir de orgsMonitoradas (ui/pure.js), a régua do que é de fato buscado');
  assert.doesNotMatch(chamada, /owners:\s*estado\(\)\.config/,
    'config.owners é o campo legado que o engine descarta quando há contas cadastradas');
});

test('a régua do vazio sai das contas do estado (o que é de fato buscado), nunca do config', () => {
  const chamada = APPJS.match(/owners:\s*orgsMonitoradas\((?:[^()]|\([^()]*\))*\)/);
  assert.ok(chamada, 'orgsMonitoradas não é chamada no app.js');
  assert.match(chamada[0], /estado\(\)\.accounts/);
});

/* ---------- anatomia do card da fila (Claude Design, B2-design/comum.css) ---------- */

// Filhos diretos de um elemento, contados por profundidade de tag. O card é HTML gerado
// por nós, sem tag autofechada fora de <img>, então a contagem é exata sem DOM. Comentário
// HTML (`<!--`) não casa com o padrão, que exige letra depois do `<`.
function filhosDiretos(html) {
  const corpo = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</div>'));
  const filhos = [];
  let nivel = 0;
  for (const m of corpo.matchAll(/<(\/?)([a-z]+)([^>]*)>/g)) {
    if (m[2] === 'img') continue;
    if (m[1]) { nivel -= 1; continue; }
    const classe = (m[3].match(/class="([^"]*)"/) || [, ''])[1].split(' ')[0];
    if (nivel === 0) filhos.push(classe ? `${m[2]}.${classe}` : m[2]);
    nivel += 1;
  }
  return filhos;
}

// 25/09/2026: na visão Todas com duas contas ou mais, o ponto da conta entrava como
// quarto filho de uma grade de três colunas. O avatar caía na coluna elástica, o texto ia
// para a direita e as ações quebravam para baixo. No desenho, o card tem avatar, conteúdo
// e ações; a conta mora na linha do PR, junto da etiqueta.
test('card da fila: a linha do PR abre no link, sem marcador de conta, e a grade tem só avatar, conteúdo e ações', () => {
  const pr = { key: 'acme/api#7', url: 'https://github.com/acme/api/pull/7', title: 'Corrige o gate', author: 'alice', updatedAt: '2026-09-03T16:00:00Z' };
  const html = P.queueCardHtml(pr, { people: {} }).trim();
  const filhos = filhosDiretos(html).filter((f) => f !== 'div.pr-menu');
  assert.deepEqual(filhos, ['span.avatar', 'div.info', 'div.pr-actions']);
  const colunasLargas = CSS.match(/@media \(min-width: 820px\) \{\s*\.pr-card \{ grid-template-columns: ([^;]+);/)[1].trim().split(/\s+(?![^(]*\))/);
  assert.equal(colunasLargas.length, filhos.length, 'cada filho do card precisa da própria coluna na janela larga');
  assert.match(html, /<div class="pr-ref"><a /, 'o link abre a linha do PR');
  assert.doesNotMatch(html, /acct-dot|acct-chip/, 'uma instância, uma conta: sem marcador de conta no card');
});

test('Visão geral abre pelos checks de saúde e o aplicar só realça com diferença selecionada', () => {
  const pos = (id) => HTML.indexOf(`id="${id}"`);
  assert.ok(pos('doctor') > 0 && pos('doctor') < pos('setupManager'), 'doctor antes do setupManager');
});

test('atalhos A/M/C passam pela confirmação', () => {
  const raiz = path.join(import.meta.dirname, '..');
  const atalhos = fs.readFileSync(path.join(raiz, 'ui/telas/atalhos.js'), 'utf8');
  assert.match(atalhos, /sempre: true/);
  assert.match(atalhos, /decideComConfirmacao/);
  assert.deepEqual(atalhos.match(/.*\.click\(\).*/g), ["  if (btn.dataset.action === 'skip') { btn.click(); return; }"], 'só o pular clica no botão');
});
