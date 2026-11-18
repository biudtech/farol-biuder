// As configurações da conta precisam ser respeitadas (25/09/2026).
//
// Pedido do dono, ao ver quatro PRs aprováveis sem ressalva esperando clique numa conta
// que estava em "aprova sozinho": "Essas configurações precisam serem respeitadas". A
// investigação achou a classe do defeito: a tela salvava a conta INTEIRA a cada edição, com o
// que ela tinha na memória, e o servidor gravava como veio. Qualquer campo que a tela não
// soubesse, ou soubesse velho, era apagado ou ressuscitado por uma edição qualquer.
//
// E a janela em que a política virou "aguardar" não deixou rastro nenhum, então ninguém
// conseguiu dizer quem a mudou. Estes casos travam as duas coisas, agora com UMA conta
// revisora por instância (corte do lote 14): saíram os casos de várias contas, de adicionar e
// remover conta, do peso na cota e do perfil próprio por conta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-contas-'));
// config.json do formato antigo, de propósito: a carga tem de virar uma conta sem lançar
fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({
  port: 47198, autoReview: false, autoApproveAll: true,
  accounts: [
    { user: 'calada', owners: ['org0'], muted: true },
    { user: 'trabalho', owners: ['org1'], onReject: 'request_changes', budgetWeight: 2, label: 'Trabalho', color: '#fff', kind: 'Trabalho', claudeProfileId: 'p1' },
    { user: 'pessoal', owners: ['org2'], onClean: 'approve', onCaveats: 'approve' },
  ],
  claudeProfiles: [{ id: 'p1', label: 'Um', kind: 'dir' }],
}));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const C = (await import('../lib/engine/contas-config.js')).default;
const { Engine } = await import('../server.js');
const { POLITICA_HISTORICO_FILE } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const BASE = { user: 'trabalho', owners: ['org1'], onReject: 'request_changes', padroesRevisao: 'sem any' };
const configGravada = () => JSON.parse(fs.readFileSync(path.join(process.env.FAROL_HOME, 'config.json'), 'utf8'));

/* ---------- a carga da config antiga ---------- */

test('config antiga com várias contas sobe com UMA conta: a primeira não silenciada, só com os campos de hoje', () => {
  const e = new Engine();
  assert.deepEqual(e.accountList().map((a) => a.user), ['trabalho']);
  const salva = configGravada();
  assert.equal('accounts' in salva, false, 'a lista antiga não volta para o disco');
  assert.equal('autoReview' in salva, false, 'a chave geral antiga virou campo da conta');
  assert.equal('autoApproveAll' in salva, false);
  // o que a conta praticava ficou por extenso: revisão automática desligada pela chave geral
  // antiga, com ressalvas aprovando pela chave geral antiga, reprovação pela escolha própria
  assert.deepEqual(salva.conta, { user: 'trabalho', owners: ['org1'], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.deepEqual(Object.keys(e.snapshot().accounts[0]).sort(), ['autoReview', 'limiteGhAte', 'limitePlanoAte', 'onCaveats', 'onClean', 'onReject', 'owners', 'padroesRevisao', 'tokenOk', 'user']);
  assert.equal('contasGh' in e.snapshot(), false);
});

/* ---------- o que a tela de Contas mostra é o que o engine faz ---------- */

// Cada linha é uma combinação gravada na conta e o que o Farol faz com ela. Desde 30/09/2026 a
// conta é o ÚNICO endereço (as chaves gerais de Automação não mudam nada), e desde 17/11/2026 o
// revisor nunca espera decisão de gente: o `wait` gravado antes vale o padrão autônomo.
const MATRIZ = [
  // conta,                                      limpo, com ressalvas
  [{}, 'approve', 'approve'],   // conta sem campo vale o padrão (01/10/2026)
  [{ onClean: 'approve', onCaveats: 'approve' }, 'approve', 'approve'],
  [{ onClean: 'approve', onCaveats: 'wait' }, 'approve', 'approve'],
  [{ onClean: 'wait' }, 'approve', 'approve'],
  [{ onClean: 'wait', onCaveats: 'wait' }, 'approve', 'approve'],
  [{ onClean: 'wait', onCaveats: 'approve' }, 'approve', 'approve'],
];

test('a política de aprovação vem só da conta, e o wait gravado antes vale o padrão autônomo', () => {
  for (const [conta, limpo, ressalva] of MATRIZ) {
    for (const geral of [true, false, undefined]) {
      const e = { config: { autoApproveAll: geral, autoReview: geral }, accountList: () => [{ user: 'x', owners: [], ...conta }] };
      const rotulo = `${JSON.stringify(conta)} com a chave geral antiga em ${geral}`;
      assert.equal(C.acaoAoAprovar(e, 'X', true), limpo, `${rotulo}, sem ressalvas`);
      assert.equal(C.acaoAoAprovar(e, 'X', false), ressalva, `${rotulo}, com ressalvas`);
    }
  }
});

test('revisar sozinho e reprovar sozinho vêm só da conta, e nenhuma chave geral os alcança', () => {
  const e = (conta, autoReview) => ({ config: { autoReview }, accountList: () => [{ user: 'x', owners: [], ...conta }] });
  assert.equal(C.revisaSozinho(e({ autoReview: true }, false), 'x'), true, 'a chave geral antiga em false não desliga a conta');
  assert.equal(C.revisaSozinho(e({ autoReview: false }, true), 'x'), false, 'nem em true a liga');
  assert.equal(C.revisaSozinho(e({}, false), 'x'), true, 'campo ausente vale o padrão, não a chave geral');
  assert.equal(C.acaoAoReprovar(e({ onReject: 'request_changes' }, true), 'x'), 'request_changes');
  assert.equal(C.acaoAoReprovar(e({ onReject: 'wait' }, true), 'x'), 'request_changes', 'o wait gravado antes vale o padrão autônomo');
  assert.equal(C.acaoAoReprovar(e({}, true), 'x'), 'request_changes', 'campo ausente vale o padrão');
});

test('a política por extenso: o padrão aprova e reprova sozinho, e o wait gravado à mão vale o padrão', () => {
  assert.deepEqual(C.politicaExplicita({}), { autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  assert.deepEqual(C.politicaExplicita({ onClean: 'wait', onCaveats: 'approve' }), C.PADRAO);
  assert.deepEqual(C.politicaExplicita({ autoReview: 'sim', onReject: 'merge' }), C.PADRAO, 'valor torto não vira escolha');
  assert.deepEqual(C.politicaExplicita(null), C.PADRAO);
});

/* ---------- editar é por campo, e o servidor mescla ---------- */

test('editar um campo muda só aquele campo', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'trabalho', campos: { owners: ['org1', 'org9'] } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conta.owners, ['org1', 'org9']);
  assert.equal(r.conta.onReject, 'request_changes', 'a política que a tela não mandou continua gravada');
  assert.equal(r.conta.padroesRevisao, 'sem any');
  assert.deepEqual(BASE.owners, ['org1'], 'a conta recebida não é tocada');
});

test('valor vazio remove o campo; nos da política, a gravação o reescreve com o padrão', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'trabalho', campos: { onReject: '', padroesRevisao: null } });
  assert.equal('onReject' in r.conta, false);
  assert.equal('padroesRevisao' in r.conta, false);
  assert.equal(C.contaParaGravar(r.conta).onReject, 'request_changes');
});

test('campo fora da lista é recusado e devolvido, nunca gravado calado', () => {
  const campos = { user: 'outro', token: 'x', muted: true, color: '#000', label: 'L', kind: 'K', claudeProfileId: 'p', budgetWeight: 2, owners: ['org1'] };
  const r = C.aplicarEdicao(BASE, { tipo: 'editar', user: 'trabalho', campos });
  assert.deepEqual(r.ignorados.sort(), ['budgetWeight', 'claudeProfileId', 'color', 'kind', 'label', 'muted', 'token', 'user']);
  assert.equal(r.conta.user, 'trabalho');
  for (const campo of ['token', 'muted', 'color', 'label', 'kind', 'claudeProfileId', 'budgetWeight']) assert.equal(campo in r.conta, false, campo);
});

test('só edição de campo e regra de review: adicionar, remover e operação desconhecida são recusados', () => {
  for (const tipo of ['adicionar', 'remover', 'desconhecido', undefined]) {
    const r = C.aplicarEdicao(BASE, { tipo, user: 'trabalho', owners: ['x'] });
    assert.equal(r.ok, false, String(tipo));
    assert.equal(r.erro, 'operação de conta desconhecida');
  }
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'editar', user: 'ninguem', campos: { owners: [] } }).ok, false, 'login que não é o da conta');
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'editar', campos: { owners: [] } }).ok, false, 'sem login');
  assert.equal(C.aplicarEdicao(undefined, { tipo: 'editar', user: 'trabalho', campos: {} }).ok, false, 'sem conta configurada');
});

test('a regra de review por organização é editada pela mesma rota, sem tocar o resto da conta', () => {
  const r = C.aplicarEdicao(BASE, { tipo: 'regra-review', user: 'TRABALHO', organization: 'org1', mode: 'manual' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conta.reviewRules, { org1: { authors: {}, mode: 'manual' } });
  assert.equal(r.conta.onReject, 'request_changes');
  assert.equal(C.aplicarEdicao(BASE, { tipo: 'regra-review', user: 'trabalho', organization: 'org1', mode: 'qualquer' }).ok, false);
});

test('pedir um desfecho em espera volta em ignorados: o wait saiu do domínio', () => {
  const r = C.aplicarEdicao({ ...BASE, onClean: 'approve', onCaveats: 'approve' }, { tipo: 'editar', user: 'trabalho', campos: { onClean: 'wait' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ignorados, ['onClean']);
  assert.equal(r.conta.onClean, 'approve');
});

/* ---------- o rastro: toda mudança de política tem data e origem ---------- */

test('a diferença de política considera a conta, e ignora o que não é política', () => {
  const antes = C.retratoDaPolitica({ aguardarCiParaRevisar: false, conta: BASE });
  const depois = C.retratoDaPolitica({ aguardarCiParaRevisar: true, conta: { ...BASE, owners: ['outra'], autoReview: false } });
  // as chaves de espera do CI saíram em 17/11/2026: não são mais política
  assert.deepEqual(C.mudancasDePolitica(antes, depois), [
    { conta: 'trabalho', campo: 'autoReview', de: null, para: false },
  ]);
  // as chaves gerais que saíram em 30/09/2026 não são mais política geral
  const semChave = C.mudancasDePolitica(C.retratoDaPolitica({ autoReview: true, autoApproveAll: true }), C.retratoDaPolitica({ autoReview: false, autoApproveAll: false }));
  assert.deepEqual(semChave, []);
});

test('a origem da mudança é o navegador, e sem User-Agent fica desconhecida', () => {
  // a janela do app saiu com o Electron: o User-Agent dela não tem mais nome próprio
  assert.equal(C.origemDaRequisicao('Mozilla/5.0 Chrome/140 Electron/38.0.0 Safari/537'), 'navegador');
  assert.equal(C.origemDaRequisicao('Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile'), 'navegador');
  assert.equal(C.origemDaRequisicao(''), 'desconhecida');
});

test('editar pelo engine grava a config e registra o rastro', () => {
  const e = new Engine();
  let estados = 0;
  e.pushState = () => { estados++; };
  const novo = e.config.conta.autoReview === false;
  const r = e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { autoReview: novo, padroesRevisao: '  sem any  ' } }, 'navegador');
  assert.equal(r.ok, true);
  assert.equal(estados, 1, 'a tela recebe o estado novo');
  const conta = configGravada().conta;
  assert.equal(conta.autoReview, novo);
  assert.equal(conta.padroesRevisao, 'sem any');
  assert.deepEqual(conta.owners, ['org1'], 'a edição não apagou o que não foi mandado');
  const hist = JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8'));
  const ultima = hist.filter((h) => h.campo === 'autoReview').pop();
  assert.deepEqual([ultima.conta, ultima.para, ultima.origem], ['trabalho', novo, 'navegador']);
  assert.ok(Number(ultima.at) > 0);
  assert.equal(hist.filter((h) => h.campo === 'padroesRevisao').length, 0, 'padrões do time não são política de postagem');
  assert.equal('motivoDaPolitica' in C, false, 'o motivo "a política manda aguardar" saiu com o wait');
});

test('o servidor é quem decide o que é valor válido: escolha fica, valor torto não entra', () => {
  const e = new Engine();
  e.pushState = () => { };
  e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { autoReview: false, onReject: 'wait' } }, 'navegador');
  assert.equal(e.config.conta.autoReview, false, 'false é escolha, não ausência');
  const r = e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { onReject: 'merge' } }, 'navegador');
  assert.deepEqual(r.ignorados, ['onReject']);
  assert.equal(e.config.conta.onReject, 'request_changes', 'nem o wait nem o torto entram');
  assert.equal(configGravada().conta.onReject, 'request_changes');
});

test('operação recusada não grava nada nem muda a conta em memória', () => {
  const e = new Engine();
  e.pushState = () => { throw new Error('recusa não empurra estado'); };
  const antes = JSON.stringify(e.config.conta);
  const disco = JSON.stringify(configGravada());
  for (const op of [{ tipo: 'remover', user: 'trabalho' }, { tipo: 'adicionar', user: 'nova', owners: [] }, { tipo: 'editar', user: 'pessoal', campos: { onClean: 'wait' } }]) {
    assert.equal(e.editarConta(op, 'navegador').ok, false);
  }
  assert.equal(JSON.stringify(e.config.conta), antes);
  assert.equal(JSON.stringify(configGravada()), disco);
});

test('trocar as organizações confere o GitHub na hora; mudar só a política não', () => {
  const e = new Engine();
  e.pushState = () => { };
  let checagens = 0;
  e.checkNow = () => { checagens++; };
  e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { onReject: 'request_changes' } }, 'navegador');
  assert.equal(checagens, 0);
  e.editarConta({ tipo: 'editar', user: 'trabalho', campos: { owners: ['org1', 'org7'] } }, 'navegador');
  assert.equal(checagens, 1);
  assert.deepEqual(e.accountList()[0].owners, ['org1', 'org7']);
});

test('a conta não é editável pelo POST /api/settings: a chave volta como ignorada', () => {
  const e = new Engine();
  e.pushState = () => { };
  const antes = JSON.stringify(e.config.conta);
  const r = e.updateSettings({ conta: { user: 'intrusa', owners: ['acme'] }, accounts: [{ user: 'intrusa' }], ghUser: 'intrusa', owners: ['acme'], autoReview: true }, 'navegador');
  assert.deepEqual(r.ignoradas.sort(), ['accounts', 'autoReview', 'conta', 'ghUser', 'owners']);
  assert.equal(JSON.stringify(e.config.conta), antes);
});

test('chave de espera do CI no salvar volta em ignoradas e não entra no rastro', () => {
  const e = new Engine();
  e.pushState = () => { };
  const antes = fs.existsSync(POLITICA_HISTORICO_FILE) ? JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8')).length : 0;
  const r = e.updateSettings({ aguardarCiParaRevisar: true }, 'navegador');
  assert.deepEqual(r.ignoradas, ['aguardarCiParaRevisar']);
  const depois = fs.existsSync(POLITICA_HISTORICO_FILE) ? JSON.parse(fs.readFileSync(POLITICA_HISTORICO_FILE, 'utf8')).length : 0;
  assert.equal(depois, antes);
});

test('o Diagnóstico mostra as mudanças recentes de política', () => {
  const e = new Engine();
  assert.match(e.diagnosticoMarkdown(), /Mudanças na política de automação/);
  assert.match(e.diagnosticoMarkdown(), /onClean/);
});

test('o rastro tem teto e não cresce para sempre', () => {
  const lista = Array.from({ length: C.TETO_DO_HISTORICO + 30 }, (_, i) => ({ at: i, conta: null, campo: 'autoReview', de: true, para: false }));
  assert.equal(C.aparar(lista).length, C.TETO_DO_HISTORICO);
  assert.equal(C.aparar(lista)[0].at, 30, 'sai o mais antigo');
});
