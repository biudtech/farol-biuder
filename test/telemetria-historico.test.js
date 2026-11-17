// O histórico das decisões resolvidas no banco da telemetria (lote 2, 17/11/2026), pelo boot de
// verdade da Engine (o construtor lê o decisions.json; iniciarTelemetria, que o start() chama
// depois do listen, abre o banco e importa): o `resolved` entra no banco numa transação conferida,
// o arquivo original fica como decisions.json.migrado-<dia> e o decisions.json é regravado só
// com as pendências. Repetir não duplica. A gravação de uma decisão vai ao banco antes da
// regravação do decisions.json, e a queda entre as duas não perde nem duplica. Banco que não abre
// e escrita que o banco recusa deixam o histórico no decisions.json, que entra no banco depois.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-historico-'));
process.env.FAROL_HOME = FAROL_HOME;
process.env.TZ = 'America/Sao_Paulo';

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { STATE_DIR, TELEMETRIA_DB, LOG_FILE } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const { iniciarTelemetria, iniciarConsumo, iniciarHistorico, fecharTelemetria, decisoesResolvidas, historico } = await import('../lib/engine/telemetria-do-motor.js');
const { HIST_LIMIT, historicoIndisponivel } = await import('../lib/engine/historico-decisoes.js');
const { reconciliarVistos } = await import('../lib/engine/vistos-reconciliacao.js');
const { historicoPaginado } = await import('../lib/engine/historico-paginado.js');
const { concluidaDepois } = await import('../lib/engine/retomada-duravel.js');
const { DatabaseSync } = await import('node:sqlite');
const { classify } = await import('../lib/log-taxonomy.js');
const { varrerRetiradas } = await import('../lib/engine/retirada-de-pedido.js');

const ARQ = path.join(STATE_DIR, 'decisions.json');
const engines = [];
function motor() { const e = new Engine(); iniciarTelemetria(e); engines.push(e); return e; }
function fecharMotores() { while (engines.length) fecharTelemetria(engines.pop()); banco.fecharTodos(); }
after(() => { fecharMotores(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

beforeEach(() => {
  fecharMotores();
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
});

// a decisão no formato que resolveIntoHistory guarda, com a variedade do real
function decisao(i, extra = {}) {
  return {
    id: `d${1000 + i}`, createdAt: 1786454890000 + i * 10, resolvedAt: 1786454890005 + i * 10, key: `acme/app#${i % 7}`,
    pr: { repo: i % 3 ? 'acme/app' : 'Acme/Outro', number: i % 7, url: `https://github.com/acme/app/pull/${i % 7}`, title: `Ajuste ${i} ção`, author: 'ana', account: 'revisora' },
    headSha: i % 5 ? `${'a'.repeat(39)}${i % 10}` : undefined, card: i % 4 ? `PROJ-${i}` : null, cardMet: i % 2 === 0,
    verdict: 'approve', status: ['auto_approved', 'posted', 'skipped', 'auto_rejected', 'superseded'][i % 5],
    action: ['approve', 'approve', 'skip', 'request_changes', 'skip'][i % 5], reasons: i % 3 ? [] : [{ text: 'motivo', kind: 'gate' }],
    reportMarkdown: `relatório ${i}`, inventarioDiff: { arquivos: [`a${i}.js`], linhas: i }, stages: { totalMs: 60000 + i, arquivos: i },
    sessionId: `s-${i}`, roundId: i % 2 ? `r${i}` : null, postRetry: null, attention: [],
    ...extra,
  };
}
// mais nova primeiro, como o decisions.json guarda
const historicoDe = (n) => JSON.parse(JSON.stringify(Array.from({ length: n }, (_, i) => decisao(n - i))));
const gravar = (v) => fs.writeFileSync(ARQ, JSON.stringify(v, null, 2));
const ler = () => JSON.parse(fs.readFileSync(ARQ, 'utf8'));
const copias = () => fs.readdirSync(STATE_DIR).filter((n) => n.startsWith('decisions.json.migrado-')).sort();
function linhasDeTelemetria() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter((l) => /\] telemetria: /.test(l));
}
const classe = (linha) => classify(linha.replace(/^.*?\] telemetria/, 'telemetria')).id;
const contar = () => banco.abrirBanco(TELEMETRIA_DB).db.prepare('SELECT COUNT(*) AS n FROM resolvidas').get().n;

test('a primeira subida importa o histórico, guarda a cópia do original e regrava o decisions.json só com as pendências', () => {
  const resolved = historicoDe(40);
  const pending = [{ id: 'p1', createdAt: 1, key: 'acme/app#99', status: 'pending', pr: { repo: 'acme/app', number: 99 } }];
  gravar({ pending, resolved });
  const original = fs.readFileSync(ARQ);
  const e = motor();
  assert.equal(e.historicoNoBanco, true);
  assert.deepEqual(decisoesResolvidas(e), resolved, 'mesmos itens, mesma ordem, mesmos campos');
  assert.deepEqual(ler(), { pending, resolved: [], historicoNoBanco: true }, 'só as pendências e a marca de que o histórico mora no banco');
  assert.equal(copias().length, 1);
  assert.ok(copias()[0].startsWith('decisions.json.migrado-'));
  assert.deepEqual(fs.readFileSync(path.join(STATE_DIR, copias()[0])), original, 'a cópia é o arquivo original, byte a byte');
  const info = linhasDeTelemetria().at(-1);
  assert.match(info, /\[INFO\] telemetria: histórico de decisões migrado para telemetria\.db: 40 decisões; o decisions\.json original ficou como decisions\.json\.migrado-/);
  // a subida seguinte não tem o que importar: nada duplica, nenhuma cópia nova, nenhuma linha nova
  fecharMotores();
  const linhas = linhasDeTelemetria().length;
  const e2 = motor();
  assert.deepEqual(decisoesResolvidas(e2), resolved);
  assert.equal(contar(), 40);
  assert.equal(copias().length, 1);
  assert.equal(linhasDeTelemetria().length, linhas);
});

test('importar de novo o mesmo arquivo (queda entre o COMMIT e a regravação) não duplica', () => {
  const resolved = historicoDe(12);
  gravar({ pending: [], resolved });
  motor();
  fecharMotores();
  gravar({ pending: [], resolved }); // o decisions.json de antes da regravação
  const e = motor();
  assert.equal(contar(), 12);
  assert.deepEqual(decisoesResolvidas(e), resolved);
  assert.match(linhasDeTelemetria().at(-1), /0 decisões; 12 já estavam no banco/);
  assert.equal(copias().length, 1, 'a cópia íntegra do mesmo arquivo não é feita de novo');
});

test('resolver grava no banco, mais nova no topo, e o teto de 3000 vale no banco como valia no arquivo', () => {
  gravar({ pending: [], resolved: historicoDe(HIST_LIMIT) });
  const e = motor();
  e.decisions.pending.push(decisao(5000, { status: 'pending', id: 'nova' }));
  const item = e.decisions.pending.shift();
  e.resolveIntoHistory({ ...item, status: 'skipped', action: 'skip' });
  e.saveDecisions();
  const lista = decisoesResolvidas(e);
  assert.equal(lista.length, HIST_LIMIT);
  assert.equal(lista[0].id, 'nova');
  assert.equal(lista.at(-1).id, decisao(2).id, 'a mais antiga saiu');
  assert.equal(contar(), HIST_LIMIT);
  assert.deepEqual(ler().resolved, [], 'o decisions.json não volta a crescer');
  assert.equal(historico(e).recentes(1)[0].id, 'nova');
  assert.equal(historico(e).leves()[0].id, 'nova');
  assert.equal(historico(e).leves().length, HIST_LIMIT);
});

test('queda entre o COMMIT no banco e a regravação do decisions.json: a subida seguinte tira a pendência sem duplicar', () => {
  const pendente = decisao(7, { id: 'alvo', status: 'pending', action: undefined });
  gravar({ pending: [pendente], resolved: historicoDe(3) });
  const e = motor();
  // o caminho do decide(skip) até o resolveIntoHistory; o processo morre antes do saveDecisions
  const idx = e.decisions.pending.findIndex((d) => d.id === 'alvo');
  const item = e.decisions.pending.splice(idx, 1)[0];
  e.resolveIntoHistory({ ...item, status: 'skipped', action: 'skip' });
  assert.equal(ler().pending.length, 1, 'no disco a pendência ainda está lá');
  fecharMotores();
  const e2 = motor();
  assert.deepEqual(e2.decisions.pending, []);
  assert.deepEqual(ler().pending, [], 'o decisions.json foi regravado sem ela');
  const doAlvo = decisoesResolvidas(e2).filter((d) => d.id === 'alvo');
  assert.equal(doAlvo.length, 1, 'uma entrada só no histórico');
  assert.equal(doAlvo[0].status, 'skipped');
  assert.match(linhasDeTelemetria().at(-1), /\[INFO\] telemetria: 1 pendência já estava no histórico do banco/);
  // e a pendência de outro registro com o mesmo PR não sai
  fecharMotores();
  gravar({ pending: [{ ...pendente, id: 'outra' }], resolved: [] });
  assert.equal(motor().decisions.pending.length, 1);
});

test('banco que não abre: o histórico segue no decisions.json e entra no banco, na ordem, quando ele volta', () => {
  const resolved = historicoDe(5);
  gravar({ pending: [], resolved });
  fs.mkdirSync(TELEMETRIA_DB); // o caminho existe e não é arquivo
  const e = motor();
  assert.equal(e.telemetria, null);
  assert.equal(e.historicoNoBanco, undefined);
  e.resolveIntoHistory(decisao(6, { id: 'sem-banco' }));
  e.saveDecisions();
  assert.deepEqual(ler().resolved.map((d) => d.id), ['sem-banco', ...resolved.map((d) => d.id)]);
  assert.equal(copias().length, 0);
  fecharMotores();
  fs.rmSync(TELEMETRIA_DB, { recursive: true });
  const e2 = motor();
  assert.equal(e2.historicoNoBanco, true);
  assert.deepEqual(decisoesResolvidas(e2).map((d) => d.id), ['sem-banco', ...resolved.map((d) => d.id)]);
  assert.deepEqual(ler().resolved, []);
});

test('importação que não confere desfaz tudo, não copia nem regrava o arquivo, e o motor segue no JSON', () => {
  const resolved = historicoDe(4);
  gravar({ pending: [], resolved });
  const antes = fs.readFileSync(ARQ);
  // uma linha que muda depois de gravada: a conferência lê de volta e não fecha
  const h = banco.abrirBanco(TELEMETRIA_DB);
  h.db.exec("CREATE TEMP TRIGGER estraga AFTER INSERT ON resolvidas BEGIN UPDATE resolvidas SET item = '{}' WHERE seq = new.seq; END;");
  const e = motor();
  h.db.exec('DROP TRIGGER estraga');
  assert.equal(e.historicoNoBanco, undefined);
  assert.deepEqual(e.decisions.resolved, resolved);
  assert.deepEqual(fs.readFileSync(ARQ), antes);
  assert.equal(contar(), 0, 'a transação foi desfeita');
  assert.equal(copias().length, 0);
  const aviso = linhasDeTelemetria().at(-1);
  assert.match(aviso, /\[WARN\] telemetria: a importação do histórico de decisões para o banco falhou \(conferência do histórico não fechou/);
  assert.equal(classe(aviso), 'telemetria-anormal');
  banco.fecharBanco(h);
});

test('escrita que o banco recusa: a decisão fica no decisions.json, as leituras a enxergam, e a próxima gravação leva as duas', () => {
  gravar({ pending: [], resolved: historicoDe(2) });
  const e = motor();
  e.historicoH.db.exec("CREATE TEMP TRIGGER cheio BEFORE INSERT ON resolvidas BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
  e.resolveIntoHistory(decisao(10, { id: 'presa' }));
  e.saveDecisions();
  assert.deepEqual(ler().resolved.map((d) => d.id), ['presa'], 'durável no decisions.json');
  assert.equal(decisoesResolvidas(e)[0].id, 'presa');
  assert.equal(historico(e).leves()[0].id, 'presa');
  assert.equal(historico(e).recentes(30)[0].id, 'presa');
  assert.equal(e.decisionByKey('acme/app#3').id, 'presa');
  const aviso = linhasDeTelemetria().at(-1);
  assert.match(aviso, /\[WARN\] telemetria: gravar o histórico de decisões no telemetria\.db falhou \(disco cheio\)/);
  assert.equal(classe(aviso), 'telemetria-anormal');
  e.resolveIntoHistory(decisao(11, { id: 'presa-2' }));
  assert.equal(linhasDeTelemetria().filter((l) => l.includes('gravar o histórico')).length, 1, 'um WARN por mudança de estado');
  e.historicoH.db.exec('DROP TRIGGER cheio');
  e.resolveIntoHistory(decisao(12, { id: 'volta' }));
  e.saveDecisions();
  assert.deepEqual(ler().resolved, []);
  assert.deepEqual(decisoesResolvidas(e).slice(0, 4).map((d) => d.id), ['volta', 'presa-2', 'presa', decisao(2).id]);
  assert.equal(contar(), 5);
  assert.match(linhasDeTelemetria().at(-1), /\[INFO\] telemetria: o banco voltou a gravar o histórico: 2 decisões pendentes gravadas/);
});

test('a marca da retirada que muda numa decisão resolvida é regravada no banco e sobrevive à subida seguinte', async () => {
  const marcada = decisao(3, { id: 'marcada', retiradaPendente: { tipo: 'rodada', head: 'h1', tentativas: 0 }, pr: { repo: 'acme/app', number: 3, account: 'revisora' } });
  gravar({ pending: [], resolved: [marcada, ...historicoDe(2)] });
  const e = motor();
  // o PR andou: a marca sai sem enviar nada ao GitHub
  await varrerRetiradas(e, async () => ({ estado: 'OPEN', head: 'outro' }));
  assert.equal(decisoesResolvidas(e).find((d) => d.id === 'marcada').retiradaPendente, null);
  assert.equal(historico(e).leves().find((d) => d.id === 'marcada').retiradaPendente, null);
  fecharMotores();
  const e2 = motor();
  assert.equal(decisoesResolvidas(e2).find((d) => d.id === 'marcada').retiradaPendente, null);
  assert.deepEqual(historico(e2).comRetiradaPendente(), []);
});

// As regras de postagem com o histórico no banco: o clique, o dedup ("já havia um review seu",
// a pendência resolvida por fora durante o await) e a reconciliação gravam no histórico do banco
// exatamente o que gravavam no array, uma entrada por decisão, e o decisions.json fica só com
// as pendências.
function pendencia(id, key) {
  const [repo, n] = key.split('#');
  return { id, key, pr: { repo, number: Number(n), url: `https://github.com/${repo}/pull/${n}` }, createdAt: 1786454890000,
    payloads: { approve: { event: 'APPROVE', body: 'ok', comments: [] } } };
}
function motorComStubs(pending) {
  gravar({ pending, resolved: historicoDe(3) });
  const e = motor();
  Object.assign(e, { headSha: async () => '', myReviewStates: async () => [], writeMemory: () => {}, pushState: () => {} });
  return e;
}

test('no banco, o clique posta e resolve uma vez; a pendência nova criada no meio sobrevive', async () => {
  const e = motorComStubs([pendencia('alvo', 'acme/repo#2')]);
  e.postReview = async () => { e.decisions.pending.unshift(pendencia('nova', 'acme/outro#9')); return { ok: true }; };
  assert.equal((await e.decide('alvo', 'approve')).ok, true);
  assert.deepEqual(e.decisions.pending.map((d) => d.id), ['nova']);
  assert.deepEqual(decisoesResolvidas(e).filter((d) => d.id === 'alvo').map((d) => d.status), ['posted']);
  assert.deepEqual(ler().pending.map((d) => d.id), ['nova']);
  assert.deepEqual(ler().resolved, []);
});

test('no banco, o dedup do clique ("já havia um review seu") resolvido por fora durante o await não duplica', async () => {
  const alvo = pendencia('alvo', 'acme/repo#2');
  const e = motorComStubs([alvo]);
  e.headSha = async () => 'abc123';
  e.postReview = async () => { throw new Error('não deveria postar: o dedup pega antes'); };
  e.myReviewStates = async () => {
    e.decisions.pending.splice(e.decisions.pending.findIndex((d) => d.id === 'alvo'), 1);
    e.resolveIntoHistory({ ...alvo, status: 'already_reviewed', action: 'approve' });
    return ['APPROVED'];
  };
  assert.equal((await e.decide('alvo', 'approve')).ok, true);
  assert.equal(decisoesResolvidas(e).filter((d) => d.id === 'alvo').length, 1);
  assert.equal(e.decisionByKey('acme/repo#2').status, 'already_reviewed');
});

test('no banco, a reconciliação cancela a pendência de PR mergeado e o skip resolve sem postar', async () => {
  const e = motorComStubs([pendencia('mergeado', 'acme/repo#5'), pendencia('pular', 'acme/repo#6')]);
  e.prState = async (pr) => (pr.key === 'acme/repo#5' ? 'MERGED' : 'OPEN');
  e.myReviewsWithTime = async () => [];
  e.postReview = async () => { throw new Error('não posta'); };
  assert.equal(await e.reconcilePending(['acme/repo#5']), 1);
  assert.equal((await e.decide('pular', 'skip')).ok, true);
  const porId = Object.fromEntries(decisoesResolvidas(e).map((d) => [d.id, d.status]));
  assert.equal(porId.mergeado, 'already_merged');
  assert.equal(porId.pular, 'skipped');
  assert.deepEqual(ler().pending, []);
  assert.equal(e.reviewActions()['acme/repo#6'], undefined, 'pulado não marca ação');
});

// B1 da revisão (17/11/2026): com o histórico já no banco, banco fora não pode virar "nada foi
// decidido". O estado "histórico indisponível" segura as regras que tratariam o vazio assim.
const marcarVersaoFutura = (v) => { const db = new DatabaseSync(TELEMETRIA_DB); db.exec(`PRAGMA user_version = ${v}`); db.close(); };
const avisosDeIndisponivel = () => linhasDeTelemetria().filter((l) => l.includes('histórico de decisões indisponível'));

test('banco que não abre DEPOIS da migração: nenhum PR já decidido volta à fila e nada é marcado como ignorado', () => {
  gravar({ pending: [], resolved: historicoDe(5) });
  motor();
  fecharMotores();
  assert.equal(ler().historicoNoBanco, true, 'o decisions.json diz que o histórico mora no banco');
  marcarVersaoFutura(banco.VERSAO_DO_ESQUEMA + 1);
  const e = motor();
  assert.notEqual(e.historicoNoBanco, true);
  assert.equal(historicoIndisponivel(e), true);
  const aviso = avisosDeIndisponivel();
  assert.equal(aviso.length, 1, 'uma linha só');
  assert.match(aviso[0], /\[WARN\] telemetria: histórico de decisões indisponível/);
  assert.equal(classe(aviso[0]), 'telemetria-anormal');
  // vistos: o PR decidido não volta à fila
  e.ignorados = new Set();
  e.seen.add('acme/app#3');
  assert.equal(reconciliarVistos(e, [{ key: 'acme/app#3' }]), 0);
  assert.equal(e.seen.has('acme/app#3'), true);
  // a migração dos ignorados não roda
  e.ignorados = undefined;
  e.migrarIgnorados();
  assert.equal(e.ignorados, undefined);
  // o re-request não rearma nem esquece o que já tinha voltado à fila
  e.reReviewedKeys = new Set(['acme/app#3']);
  assert.deepEqual([...e.markReRequests(new Set(['acme/app#3']))], ['acme/app#3']);
  assert.deepEqual([...e.reReviewedKeys], ['acme/app#3']);
  // a retomada não continua uma sessão cujo desfecho não dá para ver
  assert.equal(concluidaDepois(e, { key: 'acme/app#3', knownHead: 'x', atualizadoEm: '2026-01-01T00:00:00Z' }), true);
  // a rota responde que o histórico está indisponível, sem escrever no log
  const linhas = fs.readFileSync(LOG_FILE, 'utf8').length;
  assert.equal(historicoPaginado(e, new URLSearchParams('')).status, 503);
  assert.equal(fs.readFileSync(LOG_FILE, 'utf8').length, linhas);
  fecharMotores();
  marcarVersaoFutura(banco.VERSAO_DO_ESQUEMA);
  const e3 = motor();
  assert.equal(historicoIndisponivel(e3), false);
  assert.equal(decisoesResolvidas(e3).length, 5);
});

test('antes da migração, banco que não abre não deixa o histórico indisponível: ele está inteiro no decisions.json', () => {
  gravar({ pending: [], resolved: historicoDe(4) });
  fs.mkdirSync(TELEMETRIA_DB);
  const e = motor();
  assert.equal(historicoIndisponivel(e), false);
  assert.equal(avisosDeIndisponivel().length, 0);
  e.ignorados = new Set();
  e.seen.add('acme/app#4');
  assert.equal(reconciliarVistos(e, [{ key: 'acme/app#4' }]), 0, 'tem decisão no arquivo');
});

test('leitura que falha em tempo de execução segura as mesmas regras, com WARN uma vez e INFO na volta', () => {
  gravar({ pending: [], resolved: historicoDe(5) });
  const e = motor();
  e.ignorados = new Set();
  e.seen.add('acme/app#3');
  e.historicoH.db.exec('ALTER TABLE resolvidas RENAME TO resolvidas_fora');
  e.historicoCache = null; // como depois de cada atualização da retirada
  assert.equal(reconciliarVistos(e, [{ key: 'acme/app#3' }]), 0);
  assert.equal(e.seen.has('acme/app#3'), true);
  assert.equal(historicoIndisponivel(e), true);
  reconciliarVistos(e, [{ key: 'acme/app#3' }]);
  e.reviewActions();
  assert.equal(avisosDeIndisponivel().length, 1);
  const tamanho = fs.readFileSync(LOG_FILE, 'utf8').length;
  assert.equal(historicoPaginado(e, new URLSearchParams('page=2')).status, 503);
  assert.equal(fs.readFileSync(LOG_FILE, 'utf8').length, tamanho, 'a rota não escreve no log');
  e.historicoH.db.exec('ALTER TABLE resolvidas_fora RENAME TO resolvidas');
  assert.equal(Object.keys(e.reviewActions()).length > 0, true);
  assert.equal(historicoIndisponivel(e), false);
  assert.match(linhasDeTelemetria().at(-1), /\[INFO\] telemetria: o histórico de decisões voltou a responder/);
});

test('a importação do consumo que falha não derruba o histórico', () => {
  gravar({ pending: [], resolved: historicoDe(3) });
  fs.writeFileSync(path.join(STATE_DIR, 'usage-sessions.json'), '{ ilegível');
  const e = motor();
  assert.equal(e.telemetria, null, 'o consumo segue no JSON');
  assert.equal(e.historicoNoBanco, true, 'o histórico abre no banco');
  assert.equal(decisoesResolvidas(e).length, 3);
  assert.equal(historicoIndisponivel(e), false);
});

test('sem folga de disco a migração espera: o histórico segue no decisions.json, com o espaço que falta no WARN', () => {
  const resolved = historicoDe(6);
  gravar({ pending: [], resolved });
  const antes = fs.readFileSync(ARQ);
  const e = new Engine();
  engines.push(e);
  iniciarConsumo(e);
  iniciarHistorico(e, undefined, { espacoLivre: () => 10 });
  assert.notEqual(e.historicoNoBanco, true);
  assert.equal(historicoIndisponivel(e), false);
  assert.deepEqual(fs.readFileSync(ARQ), antes);
  assert.equal(copias().length, 0);
  assert.match(linhasDeTelemetria().at(-1), /\[WARN\] telemetria: espaço em disco insuficiente para migrar o histórico de decisões: faltam \d+ bytes/);
});

test('a cópia é feita num nome temporário: sobra de cópia interrompida sai e não vira cópia válida', () => {
  gravar({ pending: [], resolved: historicoDe(3) });
  const original = fs.readFileSync(ARQ);
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  fs.writeFileSync(path.join(STATE_DIR, `decisions.json.migrado-${dia}.parcial`), 'pela metade');
  fs.writeFileSync(path.join(STATE_DIR, `decisions.json.migrado-${dia}`), original.subarray(0, 10)); // cópia velha, de outro tamanho
  motor();
  assert.deepEqual(copias(), [`decisions.json.migrado-${dia}`, `decisions.json.migrado-${dia}-2`]);
  assert.deepEqual(fs.readFileSync(path.join(STATE_DIR, `decisions.json.migrado-${dia}-2`)), original);
  assert.equal(fs.readdirSync(STATE_DIR).some((n) => n.endsWith('.parcial')), false);
});

test('retirada com a atualização recusada: a contagem de tentativas fica em memória e o teto continua valendo', () => {
  const marcada = decisao(3, { id: 'marcada', retiradaPendente: { tipo: 'rodada', head: 'h1', tentativas: 0 } });
  gravar({ pending: [], resolved: [marcada, ...historicoDe(2)] });
  const e = motor();
  const hist = historico(e);
  const [item] = hist.comRetiradaPendente();
  e.historicoH.db.exec("CREATE TEMP TRIGGER recusa BEFORE UPDATE ON resolvidas BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
  item.retiradaPendente.tentativas = 3;
  assert.equal(hist.atualizar(item), false);
  e.historicoCache = null;
  assert.equal(historico(e).comRetiradaPendente()[0].retiradaPendente.tentativas, 3);
  item.retiradaPendente = null;
  assert.equal(hist.atualizar(item), false);
  assert.deepEqual(historico(e).comRetiradaPendente(), [], 'a marca que saiu em memória não volta');
  e.historicoH.db.exec('DROP TRIGGER recusa');
  item.pedidoRetirado = { head: 'h1', at: 1 };
  assert.equal(historico(e).atualizar(item), true);
  fecharMotores();
  assert.equal(decisoesResolvidas(motor()).find((d) => d.id === 'marcada').retiradaPendente, null);
});
