// A migração do consumo para o banco (decisão de 16/11/2026), pelo boot de verdade da Engine (o
// construtor e depois iniciarConsumo, que o start() chama quando o listen dá certo): todo JSON
// antigo presente é importado numa transação, só com as linhas que o banco ainda não tem,
// conferido, e só então renomeado para <nome>.migrado-<dia>. Repetir não duplica. O banco que não
// abre não derruba o motor: ele segue nos JSON, com uma linha só no log, e o que foi gravado neles
// entra no banco quando ele voltar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-telemetria-migracao-'));
process.env.FAROL_HOME = FAROL_HOME;
process.env.TZ = 'America/Sao_Paulo';

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { Engine } = await import('../server.js');
const { STATE_DIR, TELEMETRIA_DB, LOG_FILE } = await import('../lib/paths.js');
const banco = await import('../lib/telemetria/banco.js');
const migracao = await import('../lib/telemetria/migracao.js');
const { todasAsTentativas } = await import('../lib/telemetria/tentativas.js');
const usage = await import('../lib/engine/usage.js');
const { sessoesDoDiario, fecharTelemetria, iniciarConsumo } = await import('../lib/engine/telemetria-do-motor.js');
const { classify } = await import('../lib/log-taxonomy.js');

const engines = [];
// a subida inteira: o construtor só lê; o banco abre e migra quando o listen deu certo
function motor() { const e = new Engine(); iniciarConsumo(e); engines.push(e); return e; }
function fecharMotores() { while (engines.length) fecharTelemetria(engines.pop()); banco.fecharTodos(); }

after(() => { fecharMotores(); fs.rmSync(FAROL_HOME, { recursive: true, force: true }); });

const ARQ = {
  sessoes: path.join(STATE_DIR, 'usage-sessions.json'),
  agregado: path.join(STATE_DIR, 'usage.json'),
  tentativas: path.join(STATE_DIR, 'usage-tentativas.json'),
  falhas: path.join(STATE_DIR, 'falhas-sessao.json'),
};

const SESSOES = [
  { at: 1786454890096, day: '2026-08-01', kind: 'review', ref: 'o/r#1', account: 'dev', model: 'Opus 4.8', profileId: '',
    inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.1, status: 'ok' },
  { id: 'a-00000000-0000-4000-8000-000000000001', at: 1786454990097, day: '2026-08-02', kind: 'review', ref: null, account: 'dev',
    model: 'Opus 5.5', profileId: 'p1', inputTokens: 1, outputTokens: 2, thinkingTokens: 9, cacheReadTokens: 0, cacheCreationTokens: 0,
    costUsd: 0.2, farol: '2.70.0', costSource: 'medido', provider: 'claude', billingKind: 'apikey', status: 'ok', attemptId: 't-1',
    accounting: { version: 1, sessionId: 'prov-1', snapshot: { models: {}, costUsd: 0.2 } }, corrigidoEm: 1786454999999 },
];
const TENTATIVA = { attemptId: 't-aberta', sessionId: 'a-00000000-0000-4000-8000-000000000002', kind: 'review', account: 'dev',
  profileId: 'p1', model: 'claude-opus-5-5', providerSessionId: 'prov-2', ref: 'o/r#2', provedor: 'claude', abertaEm: 1786455000000,
  parcial: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, parcialEm: 1786455000100 };
const FALHAS = [
  { id: 'f-1', at: 1786454890100, sessionId: 'a-x', attemptId: 't-x', cliSessionId: '', kind: 'review', account: 'dev', ref: 'o/r#1',
    motivo: 'sessão retornou erro: x', motivoTruncado: false, classe: 'desconhecido', etapas: null },
  { id: 'f-2', at: 1786454890200, sessionId: 'a-y', attemptId: '', cliSessionId: 'c', kind: 'review', account: 'dev', ref: 'o/r#3',
    motivo: 'hit your limit', motivoTruncado: false, classe: 'limite-plano', etapas: { totalMs: 3, stages: [] }, primeiraAt: 1, ocorrencias: 4 },
];

const gravar = (arquivo, v) => fs.writeFileSync(arquivo, JSON.stringify(v, null, 2));
function gravarJsonAntigos({ sessoes = SESSOES, tentativas = { [TENTATIVA.attemptId]: TENTATIVA }, falhas = FALHAS } = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  gravar(ARQ.sessoes, { sessions: sessoes });
  gravar(ARQ.agregado, usage.defaultUsage());
  gravar(ARQ.tentativas, { tentativas });
  gravar(ARQ.falhas, { falhas });
}

function limparEstado() {
  fecharMotores();
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function linhasDeTelemetria() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter((l) => /\] telemetria: /.test(l));
}
const classe = (linha) => classify(linha.replace(/^.*?\] telemetria/, 'telemetria')).id;
const migrados = () => fs.readdirSync(STATE_DIR).filter((n) => n.includes('.migrado-')).sort();
const ativos = () => ['usage-sessions.json', 'usage-tentativas.json', 'falhas-sessao.json'].filter((n) => fs.existsSync(path.join(STATE_DIR, n)));
const uso = (n) => ({ usage: { input_tokens: n, output_tokens: n }, total_cost_usd: n / 100 });

beforeEach(limparEstado);

test('boot sem JSON antigo nem banco: cria o banco, nada a migrar e nenhuma linha de log', () => {
  const e = motor();
  assert.ok(e.telemetria, 'o motor grava no banco');
  assert.ok(fs.existsSync(TELEMETRIA_DB));
  assert.deepEqual(linhasDeTelemetria(), []);
  assert.deepEqual(migrados(), []);
});

test('o construtor sozinho não abre o banco nem escreve nele: quem abre é a subida depois do listen', () => {
  gravarJsonAntigos();
  const e = new Engine();
  assert.equal(e.telemetria, null);
  assert.equal(fs.existsSync(TELEMETRIA_DB), false);
  assert.deepEqual(ativos(), ['usage-sessions.json', 'usage-tentativas.json', 'falhas-sessao.json'], 'nada renomeado nem reconciliado');
  assert.deepEqual(JSON.parse(fs.readFileSync(ARQ.tentativas, 'utf8')).tentativas, { [TENTATIVA.attemptId]: TENTATIVA });
});

test('boot com os JSON antigos: importa tudo, confere, renomeia e registra uma linha INFO', () => {
  gravarJsonAntigos();
  const bytes = fs.readFileSync(ARQ.sessoes, 'utf8');
  const e = motor();
  assert.ok(e.telemetria);
  const dia = usage.localDay();
  assert.deepEqual(migrados(), [`falhas-sessao.json.migrado-${dia}`, `usage-sessions.json.migrado-${dia}`, `usage-tentativas.json.migrado-${dia}`]);
  assert.deepEqual(ativos(), []);
  assert.equal(fs.readFileSync(path.join(STATE_DIR, `usage-sessions.json.migrado-${dia}`), 'utf8'), bytes, 'renomeado, não reescrito');
  assert.ok(fs.existsSync(ARQ.agregado), 'o agregado continua JSON');
  const linhas = sessoesDoDiario(e);
  assert.deepEqual(linhas.slice(0, 2), SESSOES);
  assert.equal(linhas.length, 3, 'a tentativa aberta virou linha interrompida no boot');
  assert.equal(linhas[2].status, 'interrompida');
  assert.equal(linhas[2].attemptId, 't-aberta');
  assert.deepEqual(todasAsTentativas(e.telemetria), {}, 'a tentativa reconciliada saiu do banco');
  assert.deepEqual(e.falhasRecentes({ limite: 10 }).map((f) => f.id), ['f-2', 'f-1']);
  const log = linhasDeTelemetria();
  assert.equal(log.length, 1, log.join('\n'));
  assert.match(log[0], /\[INFO\] telemetria: consumo migrado para telemetria\.db: 2 sessões, 1 tentativa aberta e 2 falhas/);
});

test('linha do diário que não é objeto é descartada, contada e dita na linha INFO', () => {
  gravarJsonAntigos({ sessoes: [SESSOES[0], null, 'lixo', SESSOES[1]] });
  const e = motor();
  assert.deepEqual(sessoesDoDiario(e).slice(0, 2), SESSOES);
  const [linha] = linhasDeTelemetria();
  assert.match(linha, /2 sessões.*; 2 linhas ilegíveis descartadas/);
});

test('boot de novo depois da migração: não duplica nada e não escreve log', () => {
  gravarJsonAntigos();
  motor();
  assert.equal(sessoesDoDiario(motor()).length, 3);
  fecharMotores();
  assert.equal(sessoesDoDiario(motor()).length, 3);
  assert.equal(linhasDeTelemetria().length, 1, 'só a linha da migração, da primeira subida');
});

test('JSON que reaparece com o banco já preenchido: entra só o que falta, e o arquivo é renomeado', () => {
  gravarJsonAntigos();
  motor();
  fecharMotores();
  const nova = { ...SESSOES[0], at: SESSOES[0].at + 5, ref: 'o/r#nova' };
  const falhaNova = { ...FALHAS[0], id: 'f-3', at: FALHAS[0].at + 7 };
  const tentativaNova = { ...TENTATIVA, attemptId: 't-nova', sessionId: 'a-00000000-0000-4000-8000-000000000003' };
  gravarJsonAntigos({ sessoes: [...SESSOES, { ...SESSOES[1], status: 'descartada' }, nova],
    tentativas: { 't-nova': tentativaNova }, falhas: [...FALHAS, falhaNova] });
  const e = motor();
  const linhas = sessoesDoDiario(e);
  assert.equal(linhas.length, 5, 'as 3 de antes, a nova e a interrompida da tentativa nova');
  assert.deepEqual(linhas[3], nova);
  assert.equal(linhas[1].status, 'ok', 'a linha que o banco já tinha não é trocada pela cópia do arquivo');
  assert.equal(linhas[4].attemptId, 't-nova');
  assert.deepEqual(e.falhasRecentes({ limite: 10 }).map((f) => f.id), ['f-3', 'f-2', 'f-1']);
  assert.deepEqual(ativos(), [], 'nenhum JSON fica com o nome ativo com o banco aberto');
  const log = linhasDeTelemetria().at(-1);
  assert.match(log, /\[INFO\] telemetria: consumo migrado para telemetria\.db: 1 sessão, 1 tentativa aberta e 1 falha; 5 linhas do arquivo já estavam no banco/);
});

test('subida 1 migra, subida 2 o banco não abre (versão mais nova), subida 3 importa o que foi gravado no JSON', () => {
  gravarJsonAntigos();
  motor();
  fecharMotores();
  const db = new DatabaseSync(TELEMETRIA_DB);
  db.exec(`PRAGMA user_version = ${banco.VERSAO_DO_ESQUEMA + 1}`);
  db.close();
  const e2 = motor();
  assert.equal(e2.telemetria, null);
  assert.deepEqual(sessoesDoDiario(e2), [], 'o diário desta subida começa vazio');
  e2.recordUsage('a-00000000-0000-4000-8000-000000000009', 'dev', uso(3), 'claude-opus-5-5', 'p1', 'o/r#9');
  e2.registrarFalha({ sessionId: 'a-f2', kind: 'review', motivo: 'na subida sem banco' });
  const aviso = linhasDeTelemetria().at(-1);
  assert.match(aviso, /\[WARN\] telemetria: o banco .*telemetria\.db existe e não abriu \(banco na versão 2 do esquema/);
  assert.match(aviso, /as sessões desta subida vão para os arquivos JSON e entram no banco quando ele voltar a abrir/);
  assert.equal(classe(aviso), 'telemetria-anormal');
  fecharMotores();
  const db2 = new DatabaseSync(TELEMETRIA_DB);
  db2.exec(`PRAGMA user_version = ${banco.VERSAO_DO_ESQUEMA}`);
  db2.close();
  const e3 = motor();
  assert.ok(e3.telemetria);
  const linhas = sessoesDoDiario(e3);
  assert.equal(linhas.length, 4, 'as 3 da subida 1 e a da subida 2');
  assert.equal(linhas[3].id, 'a-00000000-0000-4000-8000-000000000009');
  assert.equal(e3.falhaDaSessao('a-f2').motivo, 'na subida sem banco');
  assert.deepEqual(ativos(), []);
});

test('banco ausente que não pode ser criado: o aviso diz isso, e não que o banco existe', () => {
  gravarJsonAntigos();
  // link para um caminho que não existe: o arquivo não existe e não dá para criá-lo
  fs.symlinkSync(path.join(FAROL_HOME, 'nao-existe', 'x.db'), TELEMETRIA_DB);
  const e = motor();
  assert.equal(e.telemetria, null);
  const aviso = linhasDeTelemetria().at(-1) || '';
  assert.match(aviso, /\[WARN\] telemetria: não consegui criar o banco/);
  assert.doesNotMatch(aviso, /existe e não abriu/);
  assert.equal(classe(aviso), 'telemetria-anormal');
});

test('banco que é uma pasta: o motor sobe nos JSON, grava neles, uma linha WARN, e migra na subida seguinte', () => {
  gravarJsonAntigos();
  fs.mkdirSync(TELEMETRIA_DB);
  const e = motor();
  assert.equal(e.telemetria, null);
  e.recordUsage('a-00000000-0000-4000-8000-000000000009', 'dev', uso(1), 'claude-opus-5-5', 'p1', 'o/r#9');
  const noArquivo = JSON.parse(fs.readFileSync(ARQ.sessoes, 'utf8')).sessions;
  assert.equal(noArquivo.length, 4, 'as duas antigas, a interrompida do boot e a nova');
  assert.deepEqual(migrados(), []);
  const avisos = linhasDeTelemetria();
  assert.equal(avisos.length, 1, avisos.join('\n'));
  assert.match(avisos[0], /\[WARN\] telemetria: o banco .* existe e não abriu/);
  assert.equal(classe(avisos[0]), 'telemetria-anormal');
  fecharMotores();
  fs.rmdirSync(TELEMETRIA_DB);
  const depois = motor();
  assert.ok(depois.telemetria);
  assert.deepEqual(sessoesDoDiario(depois), noArquivo);
});

test('JSON de sessões com formato errado: nada é importado nem renomeado, e o motor segue como hoje', () => {
  gravarJsonAntigos();
  gravar(ARQ.sessoes, { sessions: { nao: 'é lista' } });
  const e = motor();
  assert.equal(e.telemetria, null);
  assert.deepEqual(migrados(), []);
  assert.ok(fs.existsSync(ARQ.tentativas) && fs.existsSync(ARQ.falhas));
  const avisos = linhasDeTelemetria();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /\[WARN\] telemetria: .*usage-sessions\.json/);
});

test('conferência que não fecha desfaz a transação inteira e não renomeia nada', () => {
  gravarJsonAntigos();
  const h = banco.abrirBanco(path.join(FAROL_HOME, 'conferencia.db'));
  try {
    const fontes = migracao.lerFontes({ sessoes: ARQ.sessoes, tentativas: ARQ.tentativas, falhas: ARQ.falhas });
    let pulou = false;
    const r = migracao.importarConsumo(h, fontes, { inserirSessao: (hh, linha) => {
      if (!pulou) { pulou = true; return; }
      migracao.inserirSessaoPadrao(hh, linha);
    } });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /conferência/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM falhas').get().n, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM tentativas').get().n, 0);
    assert.deepEqual(migrados(), []);
  } finally { banco.fecharBanco(h); }
});

test('no modo banco o registro de uma sessão é uma linha nova, sem regravar arquivo de sessões', () => {
  const e = motor();
  e.recordUsage('a-00000000-0000-4000-8000-00000000000a', 'dev', uso(4), 'claude-opus-5-5', 'p1', 'o/r#1');
  assert.equal(fs.existsSync(ARQ.sessoes), false);
  assert.ok(fs.existsSync(ARQ.agregado), 'o agregado continua sendo gravado');
  assert.equal(sessoesDoDiario(e).length, 1);
  assert.equal(e.marcarDesfecho('a-00000000-0000-4000-8000-00000000000a', 'descartada'), true);
  assert.equal(sessoesDoDiario(motor())[0].status, 'descartada', 'o desfecho marcado depois persiste');
  e.registrarFalha({ sessionId: 'a-f', kind: 'review', motivo: 'quebrou' });
  assert.equal(fs.existsSync(ARQ.falhas), false);
  assert.equal(motor().falhaDaSessao('a-f').motivo, 'quebrou');
  assert.equal(fs.existsSync(ARQ.tentativas), false);
});
