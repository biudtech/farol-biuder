// Histórico paginado (fase 2b): a lógica pura por trás de GET /api/decisions. Prova a
// validação dos parâmetros (inválido vira recusa com o campo, nunca exceção), os filtros, a
// paginação nas bordas (0, 1, 30, 31 e 3.000 itens), que o item sai sempre pela projeção
// segura (decisionForUi) e que a consulta não altera o histórico do engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionForUi } from '../lib/engine/public-review.js';
import {
  lerParametros, paginaDoHistorico, historicoPaginado,
  VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA,
} from '../lib/engine/historico-paginado.js';

// O item no formato que resolveIntoHistory guarda (lib/engine/decision.js): mais nova primeiro.
function item(i, extra = {}) {
  const { pr, ...resto } = extra;
  return {
    id: `d${i}`, createdAt: 1000 + i, resolvedAt: 2000 + i, key: `acme/app#${i}`,
    pr: { repo: 'acme/app', number: i, url: `https://github.com/acme/app/pull/${i}`, title: `Ajuste ${i}`, author: 'ana', account: 'revisora', ...pr },
    card: null, verdict: 'approve', status: 'auto_approved', action: 'approve',
    reasons: [], reviewMarkdown: `Revisão ${i}`, reportMarkdown: `relatório ${i}`,
    ...resto,
  };
}

function historico(n) { return Array.from({ length: n }, (_, i) => item(n - i)); }
function engineCom(resolved, pending = []) { return { decisions: { pending, resolved } }; }
function consulta(texto) { return new URLSearchParams(texto); }
function pedir(resolved, texto = '') { return historicoPaginado(engineCom(resolved), consulta(texto)); }
function ids(resposta) { return resposta.body.items.map(d => d.id); }

/* ---------- parâmetros ---------- */

test('sem parâmetro nenhum valem os padrões: página 1 de 30, sem filtro', () => {
  assert.equal(PAGINA_PADRAO, 30);
  assert.equal(TETO_DA_PAGINA, 100);
  assert.equal(TETO_DA_BUSCA, 200);
  assert.deepEqual(lerParametros(consulta('')), { ok: true, page: 1, pageSize: 30, q: '', veredito: '', repo: '' });
});

test('parâmetro presente e vazio conta como ausente', () => {
  assert.deepEqual(lerParametros(consulta('page=&pageSize=&q=&veredito=&repo=')), { ok: true, page: 1, pageSize: 30, q: '', veredito: '', repo: '' });
});

test('parâmetros válidos são lidos, e o que a rota não conhece é ignorado', () => {
  const lido = lerParametros(consulta('page=3&pageSize=100&q=Login&veredito=request_changes&repo=Acme/App&outro=1'));
  assert.deepEqual(lido, { ok: true, page: 3, pageSize: 100, q: 'Login', veredito: 'request_changes', repo: 'Acme/App' });
});

test('os vereditos aceitos são os três que o motor grava', () => {
  assert.deepEqual([...VEREDITOS], ['approve', 'request_changes', 'comment']);
  for (const v of VEREDITOS) assert.equal(lerParametros(consulta(`veredito=${v}`)).veredito, v);
});

const INVALIDOS = [
  ['page=0', 'page'], ['page=-1', 'page'], ['page=abc', 'page'], ['page=1.5', 'page'], ['page=1e3', 'page'],
  ['page=%201', 'page'], ['page=+1', 'page'], ['page=9999999999', 'page'], ['page=1&page=2', 'page'], ['page=1&page=1', 'page'],
  ['pageSize=0', 'pageSize'], ['pageSize=-5', 'pageSize'], ['pageSize=101', 'pageSize'], ['pageSize=muitos', 'pageSize'],
  ['pageSize=10&pageSize=20', 'pageSize'],
  [`q=${'a'.repeat(201)}`, 'q'], ['q=a&q=b', 'q'],
  ['veredito=aprovado', 'veredito'], ['veredito=APPROVE', 'veredito'], ['veredito=approve&veredito=comment', 'veredito'],
  ['veredito=__proto__', 'veredito'], ['veredito=constructor', 'veredito'],
  [`repo=${'a'.repeat(201)}`, 'repo'], ['repo=acme/app&repo=acme/api', 'repo'],
];

for (const [texto, campo] of INVALIDOS) {
  const rotulo = texto.length > 40 ? `${texto.slice(0, 40)}...` : texto;
  test(`parâmetro inválido (${rotulo}) vira 400 com o campo, sem lançar`, () => {
    assert.deepEqual(lerParametros(consulta(texto)), { ok: false, campo });
    const r = pedir(historico(5), texto);
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { ok: false, code: 'parametro_invalido', campo });
  });
}

test('q com exatamente 200 caracteres é aceito', () => {
  assert.equal(lerParametros(consulta(`q=${'a'.repeat(200)}`)).ok, true);
});

test('com dois parâmetros inválidos a recusa cita o primeiro na ordem do contrato', () => {
  assert.deepEqual(lerParametros(consulta('veredito=x&page=0')), { ok: false, campo: 'page' });
});

/* ---------- paginação ---------- */

test('histórico vazio: 200, nenhuma página e nenhum repositório', () => {
  const r = pedir([]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, page: 1, pageSize: 30, total: 0, pages: 0, items: [], repos: [] });
});

test('engine sem histórico carregado responde vazio em vez de lançar', () => {
  for (const engine of [{}, { decisions: null }, { decisions: {} }, { decisions: { resolved: null } }]) {
    const r = historicoPaginado(engine, consulta(''));
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
  }
});

test('um item: uma página com ele', () => {
  const r = pedir(historico(1));
  assert.deepEqual([r.body.total, r.body.pages, r.body.items.length], [1, 1, 1]);
});

test('30 itens cabem numa página; a segunda vem vazia', () => {
  const r = pedir(historico(30));
  assert.deepEqual([r.body.total, r.body.pages, r.body.items.length], [30, 1, 30]);
  const alem = pedir(historico(30), 'page=2');
  assert.equal(alem.status, 200);
  assert.deepEqual([alem.body.page, alem.body.total, alem.body.pages, alem.body.items.length], [2, 30, 1, 0]);
});

test('31 itens: a segunda página é parcial, com o item mais antigo', () => {
  const primeira = pedir(historico(31));
  assert.deepEqual([primeira.body.total, primeira.body.pages, primeira.body.items.length], [31, 2, 30]);
  assert.equal(ids(primeira)[0], 'd31', 'a mais nova vem primeiro');
  const segunda = pedir(historico(31), 'page=2');
  assert.deepEqual(ids(segunda), ['d1']);
});

test('3.000 itens: 100 páginas de 30, sem repetir nem pular item', () => {
  const todos = historico(3000);
  const vistos = [];
  for (let page = 1; page <= 100; page++) {
    const r = pedir(todos, `page=${page}`);
    assert.deepEqual([r.body.total, r.body.pages, r.body.items.length], [3000, 100, 30]);
    vistos.push(...ids(r));
  }
  assert.deepEqual(vistos, todos.map(d => d.id));
  assert.deepEqual(pedir(todos, 'page=101').body.items, []);
});

test('pageSize muda o tamanho e a conta de páginas; a última sai parcial', () => {
  const todos = historico(3000);
  const cheia = pedir(todos, 'pageSize=100&page=30');
  assert.deepEqual([cheia.body.pageSize, cheia.body.pages, cheia.body.items.length], [100, 30, 100]);
  assert.equal(ids(cheia).at(-1), 'd1');
  const parcial = pedir(historico(95), 'pageSize=40&page=3');
  assert.deepEqual([parcial.body.pages, parcial.body.items.length], [3, 15]);
  const unitaria = pedir(historico(3), 'pageSize=1&page=2');
  assert.deepEqual([unitaria.body.pages, ids(unitaria)], [3, ['d2']]);
});

test('página muito além do fim responde 200 vazio, com o total verdadeiro', () => {
  const r = pedir(historico(31), 'page=999999999');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.page, r.body.total, r.body.pages, r.body.items], [999999999, 31, 2, []]);
});

/* ---------- filtros ---------- */

const MISTO = [
  item(6, { verdict: 'comment', action: 'comment', card: 'BT-3100', pr: { repo: 'Acme/Api', title: 'Migração do módulo de cobrança', author: 'joao-silva' } }),
  item(5, { verdict: 'request_changes', action: 'request_changes', card: 'BT-2546', pr: { repo: 'acme/app', title: 'Autenticação por código', author: 'Márcia' } }),
  item(4, { verdict: 'approve', card: 'BD2-72', pr: { repo: 'outra/app', title: 'Filtro de edições', author: 'ana' } }),
  item(3, { verdict: 'approve', card: null, pr: { repo: 'acme/app', title: 'Correção de typo', author: 'ana' } }),
  item(2, { verdict: undefined, status: 'superseded', action: 'skip', pr: { repo: 'acme/api', title: 'Sem veredito', author: 'bia' } }),
  item(1, { verdict: 'request_changes', card: { key: 'BT-9' }, pr: { repo: 'acme/app', number: 412, title: 'Login quebrado', author: 'bia' } }),
];

test('filtro por veredito, um de cada vez', () => {
  assert.deepEqual(ids(pedir(MISTO, 'veredito=approve')), ['d4', 'd3']);
  assert.deepEqual(ids(pedir(MISTO, 'veredito=request_changes')), ['d5', 'd1']);
  assert.deepEqual(ids(pedir(MISTO, 'veredito=comment')), ['d6']);
  assert.equal(pedir(MISTO, 'veredito=comment').body.total, 1);
});

test('filtro por repo é igualdade exata, sem caixa', () => {
  assert.deepEqual(ids(pedir(MISTO, 'repo=acme/app')), ['d5', 'd3', 'd1']);
  assert.deepEqual(ids(pedir(MISTO, 'repo=ACME/API')), ['d6', 'd2']);
  assert.deepEqual(ids(pedir(MISTO, 'repo=acme/ap')), [], 'prefixo não casa');
  assert.deepEqual(ids(pedir(MISTO, 'repo=app')), [], 'só o nome não casa');
});

test('q busca em repo, número, título, autor e chave do card', () => {
  assert.deepEqual(ids(pedir(MISTO, 'q=outra')), ['d4'], 'repo');
  assert.deepEqual(ids(pedir(MISTO, 'q=412')), ['d1'], 'número');
  assert.deepEqual(ids(pedir(MISTO, 'q=acme/app%23412')), ['d1'], 'repo e número juntos');
  assert.deepEqual(ids(pedir(MISTO, 'q=typo')), ['d3'], 'título');
  assert.deepEqual(ids(pedir(MISTO, 'q=bia')), ['d2', 'd1'], 'autor');
  assert.deepEqual(ids(pedir(MISTO, 'q=BT-2546')), ['d5'], 'card em texto');
  assert.deepEqual(ids(pedir(MISTO, 'q=bt-9')), ['d1'], 'card em objeto');
  assert.deepEqual(ids(pedir(MISTO, 'q=nada-disso-existe')), []);
});

test('q ignora caixa e acento, dos dois lados', () => {
  assert.deepEqual(ids(pedir(MISTO, 'q=migracao')), ['d6']);
  assert.deepEqual(ids(pedir(MISTO, 'q=MIGRAÇÃO')), ['d6']);
  assert.deepEqual(ids(pedir(MISTO, 'q=autenticacao')), ['d5']);
  assert.deepEqual(ids(pedir(MISTO, 'q=marcia')), ['d5']);
  assert.deepEqual(ids(pedir(MISTO, 'q=EDIÇÕES')), ['d4']);
  assert.deepEqual(ids(pedir(MISTO, 'q=edicoes')), ['d4']);
});

test('q com várias palavras exige todas, em qualquer campo', () => {
  assert.deepEqual(ids(pedir(MISTO, 'q=bia+login')), ['d1']);
  assert.deepEqual(ids(pedir(MISTO, 'q=login+ana')), []);
  assert.deepEqual(ids(pedir(MISTO, 'q=%20%20')), ['d6', 'd5', 'd4', 'd3', 'd2', 'd1'], 'só espaço não filtra');
});

test('q não procura no relatório nem nos motivos', () => {
  const lista = [item(1, { reportMarkdown: 'achado xyzzy', reviewMarkdown: 'texto xyzzy', reasons: [{ text: 'motivo xyzzy', kind: 'gate' }] })];
  assert.equal(pedir(lista, 'q=xyzzy').body.total, 0);
});

test('filtros combinados se somam, e o total é o de depois dos filtros', () => {
  assert.deepEqual(ids(pedir(MISTO, 'repo=acme/app&veredito=request_changes')), ['d5', 'd1']);
  assert.deepEqual(ids(pedir(MISTO, 'repo=acme/app&veredito=request_changes&q=bia')), ['d1']);
  assert.deepEqual(ids(pedir(MISTO, 'repo=acme/api&veredito=approve')), []);
  const paginado = pedir(MISTO, 'repo=acme/app&pageSize=2&page=2');
  assert.deepEqual([paginado.body.total, paginado.body.pages, ids(paginado)], [3, 2, ['d1']]);
});

test('repos lista os repositórios distintos de todo o histórico, em ordem, com ou sem filtro', () => {
  const esperado = ['Acme/Api', 'acme/api', 'acme/app', 'outra/app'];
  assert.deepEqual(pedir(MISTO).body.repos, esperado);
  assert.deepEqual(pedir(MISTO, 'veredito=comment&q=cobranca').body.repos, esperado);
  assert.deepEqual(pedir(MISTO, 'page=50').body.repos, esperado);
  const sujo = [item(2, { pr: { repo: '' } }), { id: 'sem-pr', key: 'x/y#1' }, null, item(1)];
  assert.deepEqual(pedir(sujo).body.repos, ['acme/app']);
});

test('item torto no histórico não derruba a consulta', () => {
  const sujo = [null, 'texto', 7, { id: 'sem-pr' }, { id: 'pr-nulo', pr: null }, item(1)];
  const r = pedir(sujo, 'q=ajuste');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), ['d1']);
  assert.equal(pedir(sujo).body.total, 3, 'o que não é objeto fica fora da conta');
});

test('pendentes não entram: a rota lê só as resolvidas', () => {
  const r = historicoPaginado(engineCom([item(1)], [item(99, { status: 'pending' })]), consulta(''));
  assert.deepEqual(ids(r), ['d1']);
  assert.equal(r.body.total, 1);
});

/* ---------- projeção segura ---------- */

test('cada item sai por decisionForUi, e nenhum campo bruto vai junto', () => {
  const cru = item(1, {
    sessionId: 'SESSAO-INTERNA-1',
    reportMarkdown: 'RELATORIO-BRUTO com diagnóstico interno',
    reportRaw: 'RELATORIO-RAW',
    payloads: { approve: { event: 'APPROVE', body: 'CORPO-DO-PAYLOAD', comments: [{ path: 'a.js', line: 1, body: 'COMENTARIO-DO-PAYLOAD' }] } },
    memory: { author: 'ana', notes: 'MEMORIA-DO-TIME' },
    criteriaEvidence: { bruto: 'EVIDENCIA-BRUTA' },
    inventarioDiff: { arquivos: ['INVENTARIO-BRUTO'] },
    provas: { resumo: 'PROVAS-BRUTAS' },
    postRetry: { attempts: 2, exhausted: false, lastError: 'STDERR-DO-GH', payload: { body: 'PAYLOAD-DO-REENVIO' } },
    campoFuturo: 'CAMPO-QUE-AINDA-NAO-EXISTE',
  });
  const r = pedir([cru]);
  assert.deepEqual(r.body.items, [decisionForUi(cru)]);
  const texto = JSON.stringify(r.body);
  for (const marca of ['SESSAO-INTERNA-1', 'RELATORIO-BRUTO', 'RELATORIO-RAW', 'CORPO-DO-PAYLOAD', 'COMENTARIO-DO-PAYLOAD',
    'MEMORIA-DO-TIME', 'EVIDENCIA-BRUTA', 'INVENTARIO-BRUTO', 'PROVAS-BRUTAS', 'STDERR-DO-GH', 'PAYLOAD-DO-REENVIO', 'CAMPO-QUE-AINDA-NAO-EXISTE']) {
    assert.ok(!texto.includes(marca), `${marca} saiu na resposta`);
  }
  const saida = r.body.items[0];
  for (const chave of ['payloads', 'memory', 'reportRaw', 'reviewMarkdown', 'sessionId', 'criteriaEvidence', 'inventarioDiff', 'provas', 'campoFuturo']) {
    assert.ok(!Object.hasOwn(saida, chave), `a chave ${chave} saiu na resposta`);
  }
  assert.deepEqual(saida.postRetry, { attempts: 2, exhausted: false });
  assert.equal(saida.reportMarkdown, 'Revisão 1', 'o relatório que sai é o texto público da revisão');
});

test('a recusa de parâmetro não carrega item nem repositório', () => {
  const r = pedir(MISTO, 'page=0');
  assert.deepEqual(Object.keys(r.body).sort(), ['campo', 'code', 'ok']);
});

/* ---------- só leitura ---------- */

test('a consulta não altera o histórico nem as pendentes do engine', () => {
  const engine = engineCom(structuredClone(MISTO), [item(50, { status: 'pending' })]);
  const antes = structuredClone(engine.decisions);
  const resolvidas = engine.decisions.resolved;
  const primeiro = resolvidas[0];
  for (const texto of ['', 'page=2&pageSize=2', 'q=bia', 'veredito=approve&repo=acme/app', 'page=0', 'page=999']) {
    historicoPaginado(engine, consulta(texto));
  }
  assert.deepEqual(engine.decisions, antes);
  assert.equal(engine.decisions.resolved, resolvidas, 'a lista é a mesma, não uma cópia trocada');
  assert.equal(engine.decisions.resolved[0], primeiro);
});

test('histórico congelado é lido sem erro, então nada é escrito nele', () => {
  const congelar = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(congelar); Object.freeze(v); } return v; };
  const engine = congelar(engineCom(structuredClone(MISTO)));
  const r = historicoPaginado(engine, consulta('q=bia&veredito=request_changes'));
  assert.deepEqual(ids(r), ['d1']);
});

test('paginaDoHistorico devolve os itens crus da página, para a rota projetar', () => {
  const todos = historico(5);
  const pagina = paginaDoHistorico(todos, { page: 2, pageSize: 2, q: '', veredito: '', repo: '' });
  assert.deepEqual([pagina.total, pagina.pages], [5, 3]);
  assert.equal(pagina.items[0], todos[2], 'o mesmo objeto, sem cópia');
});
