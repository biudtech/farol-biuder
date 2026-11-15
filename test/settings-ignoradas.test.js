// C0, defeito 2: o texto que a tela mostra quando o servidor recusa uma preferência, e a
// garantia de que os QUATRO salvamentos da tela usam o mesmo texto. Antes cada handler
// só olhava a própria chave, e a rota nem devolvia a lista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsIgnoradasTexto } from '../ui/pure.js';
import { fonteDasTelas } from './helpers/fontes-ui.js';

test('settingsIgnoradasTexto: vazio quando tudo entrou ou quando a resposta não diz nada', () => {
  assert.equal(settingsIgnoradasTexto({ ok: true, ignoradas: [] }), '');
  assert.equal(settingsIgnoradasTexto({ ok: true }), '');
  assert.equal(settingsIgnoradasTexto(null), '');
  assert.equal(settingsIgnoradasTexto({ ignoradas: 'tema' }), '', 'formato errado não inventa recusa');
});

test('settingsIgnoradasTexto: uma chave', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['tema'] }), '"tema" não foi salva: o servidor não reconhece essa preferência.');
});

test('settingsIgnoradasTexto: várias chaves, e item que não é texto fica de fora', () => {
  assert.equal(settingsIgnoradasTexto({ ignoradas: ['a', 7, 'b'] }), '"a", "b" não foram salvas: o servidor não reconhece essas preferências.');
});

test('os dois salvamentos da tela usam o texto das ignoradas, e nenhum filtra pela própria chave', () => {
  // desde a Fase 1b os handlers moram em ui/telas/ (acoes e sistema-jira); a leitura cobre o
  // bootstrap e todas as telas, então a contagem continua sendo da tela inteira
  const app = fonteDasTelas();
  // o quinto era a lista de repos bloqueados pra merge, que saiu com Meus PRs (corte da Fase 1, lote 11);
  // outros dois eram de telas da coordenação entre instalações, que saíram no lote 13b
  assert.equal((app.match(/settingsIgnoradasTexto\(r\)/g) || []).length, 2, 'saveJiraSites e o laço do settingsMap');
  assert.equal(/r\.ignoradas\.includes\(/.test(app), false, 'filtrar pela própria chave escondia a recusa das outras');
});
