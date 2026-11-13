// A Compacta do Radar (07/11/2026): a linha de cada PR, a densidade, as frases de Pra mim, o
// rodapé de Revisões recentes e o resumo do topo. Antes moravam junto da faixa de prontidão,
// que saiu no corte da fase 1; a Compacta ficou.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linhaCompactaHtml, setaDaLinhaHtml, chaveCurta, classeDoTom, densidadeValida, fraseDaDecisao, acaoDaDecisaoHtml,
  fraseDaFila, rodapeDasRecentes, resolvidasHoje, resumoPraMimHtml, fraseDaEspera,
} from '../ui/pure.js';

test('linha compacta: repo#N, título cortado, seta e o que a seção pede', () => {
  const html = linhaCompactaHtml({ key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', titulo: 'feat: <x>', attrs: 'data-id="d1"', classe: 'decision', refClasse: 'dec-ref', estado: { texto: 'Aprovar', tom: 'wait' } });
  assert.match(html, />app#7</);
  assert.match(html, /feat: &lt;x&gt;/);
  assert.match(html, /data-id="d1"/);
  assert.match(html, /class="pl-ref dec-ref"/);
  assert.match(html, /data-linha="acme\/app#7"/);
  assert.match(setaDaLinhaHtml('k', true), /Recolher/);
  assert.equal(chaveCurta('a/b#1'), 'b#1');
  assert.equal(classeDoTom('xyz'), 't-none');
  assert.equal(classeDoTom('fail'), 't-fail');
});

test('densidade: Compacta é a padrão e valor estranho volta para ela', () => {
  assert.equal(densidadeValida('expandida'), 'expandida');
  assert.equal(densidadeValida('<script>'), 'compacta');
  assert.equal(densidadeValida(undefined), 'compacta');
});

test('Pra mim na Compacta: frase e ação principal de cada card', () => {
  assert.deepEqual(fraseDaDecisao({ verdict: 'approve' }, { reasons: ['a', 'b'] }), { texto: 'Aprovar com 2 ressalvas', tom: 'wait' });
  assert.deepEqual(fraseDaDecisao({ verdict: 'request_changes' }, { reasons: ['a'] }), { texto: 'Pedir mudanças · 1 motivo', tom: 'fail' });
  assert.equal(fraseDaDecisao({}, { stale: true }).texto, 'Commit novo depois da revisão');
  assert.match(acaoDaDecisaoHtml({ verdict: 'approve' }, {}), /data-action="approve"/);
  assert.match(acaoDaDecisaoHtml({ verdict: 'approve' }, { approveDisabled: true }, true), /disabled/);
  assert.match(acaoDaDecisaoHtml({ verdict: 'x' }, {}), /data-action="request_changes"/);
  assert.match(acaoDaDecisaoHtml({ pr: { url: 'u' } }, { stale: true, reviewBtn: 'primary' }), /act-review/);
  assert.equal(acaoDaDecisaoHtml({}, { stale: true, reviewBtn: 'none' }), '');
  assert.equal(fraseDaFila({}, { posicao: 1 }).texto, '1º na fila');
  assert.equal(fraseDaFila({}, { parado: true }).tom, 'fail');
  assert.equal(fraseDaFila({}, { manual: true, posicao: 2 }).texto, 'Revisão automática desligada');
  assert.equal(fraseDaFila({ reRequested: true }, { posicao: 3 }).texto, 'Pedida de novo');
  assert.equal(fraseDaEspera(true).tom, 'run');
});

test('Revisões recentes na Compacta vira uma linha "N resolvidas hoje · mostrar"', () => {
  const agora = Date.parse('2026-11-07T15:00:00');
  const resolved = [{ resolvedAt: agora - 1000 }, { resolvedAt: agora - 1000 }, { resolvedAt: agora - 3 * 86400000 }];
  assert.equal(resolvidasHoje(resolved, agora), 2);
  assert.equal(rodapeDasRecentes(2, 3, false), '2 resolvidas hoje · mostrar');
  assert.equal(rodapeDasRecentes(0, 3, false), '3 revisões recentes · mostrar');
  assert.equal(rodapeDasRecentes(2, 3, true), 'Esconder revisões recentes');
});

test('resumo de Pra mim: cada item leva à sua seção, e some quando não há nada', () => {
  const html = resumoPraMimHtml({ analisando: 1, precisam: 2, sozinhos: 1, fila: 2, resolvidas: 2 });
  assert.match(html, /1 analisando/);
  assert.match(html, /2 precisam de você/);
  assert.match(html, /1 se resolve sozinho/);
  assert.match(html, /data-goto="aba:radar:#decisionsWrap"/);
  assert.equal(resumoPraMimHtml({}), '');
});
