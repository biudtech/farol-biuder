// A carga do registro de consumo, a abertura do banco da telemetria com a importação dos JSON, e
// o fechamento na saída (decisão do dono, 16/11/2026; lib/telemetria/).
//
// Duas etapas, por causa da trava de instância única (o listen na porta, server.js):
//   - carregarConsumo, no construtor da Engine: só lê, como o motor lia antes do banco (o agregado
//     e o diário dos JSON). Não abre o banco nem escreve nada: uma segunda instância no mesmo
//     FAROL_HOME, que vai perder a porta, não pode mexer no banco da primeira;
//   - iniciarConsumo, no start(), que só roda depois que o listen deu certo: abre o banco, importa
//     os JSON, troca o diário para o banco e reconcilia as tentativas que a subida anterior deixou
//     abertas (as tentativas vivas de outra instância nunca chegam aqui).
//
// O agregado (usage.json) continua JSON: é pequeno e podado (MAX_DAYS), e não se deriva das
// sessões. Medido na instância real em 16/11/2026: o agregado tem 5.568 sessões e 5,44 bilhões de
// tokens de entrada, e o diário 5.567 linhas e 5,34 bilhões, porque o agregado vem de antes do
// diário e tem dias cortados em UTC e camadas sem detalhamento (_resto). Uma consulta sobre as
// sessões mudaria os números da tela.
//
// Desfechos da abertura, cada um com no máximo uma linha de log:
//   - banco aberto e nada a importar (instalação nova ou já migrada): nenhuma linha;
//   - JSON importado: uma linha INFO, porque é a mudança de estado que alguém vai perguntar depois
//     (para onde foram os JSON), com quantas linhas entraram, quantas já estavam e quantas não eram
//     legíveis;
//   - banco que não abre, JSON ilegível ou conferência que não fecha: uma linha WARN com a causa
//     (classe telemetria-anormal, lib/log-taxonomy.js). O motor segue nos JSON; o que for gravado
//     neles nesta subida entra no banco quando ele voltar a abrir (a importação traz só o que falta).
import fs from 'node:fs';
import path from 'node:path';
import { TELEMETRIA_DB, STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic } from '../io.js';
import { abrirBanco, fecharBanco, compactarWal } from '../telemetria/banco.js';
import { lerFontes, importarConsumo, renomearMigrados, importarHistorico, copiarMigrado } from '../telemetria/migracao.js';
import { chaveDaPendencia } from '../telemetria/historico.js';
import { historico, decisoesResolvidas, HIST_LIMIT } from './historico-decisoes.js';
import { colunasDaBusca } from './busca-do-historico.js';
import usageMod from './usage.js';
import tentativasMod, { arquivoDeTentativas } from './usage-tentativas.js';
import { arquivoDeFalhas } from './falhas.js';
import { diario } from './usage-diario.js';
import { invalidateUsage } from './usage-projection-cache.js';

const NOMES = { sessoes: 'sessão', tentativas: 'tentativa aberta', falhas: 'falha' };
const PLURAIS = { sessoes: 'sessões', tentativas: 'tentativas abertas', falhas: 'falhas' };

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

function resumo(r) {
  const n = (nome) => plural(r.importadas[nome] || 0, NOMES[nome], PLURAIS[nome]);
  const extras = [];
  if (r.jaEstavam) extras.push(`${plural(r.jaEstavam, 'linha do arquivo já estava', 'linhas do arquivo já estavam')} no banco`);
  if (r.ilegiveis) extras.push(`${plural(r.ilegiveis, 'linha ilegível descartada', 'linhas ilegíveis descartadas')}`);
  return `${n('sessoes')}, ${n('tentativas')} e ${n('falhas')}${extras.map((e) => `; ${e}`).join('')}`;
}

const SEGUE_NO_JSON = 'as sessões desta subida vão para os arquivos JSON e entram no banco quando ele voltar a abrir';

function abrir(log) {
  const existia = fs.existsSync(TELEMETRIA_DB);
  try { return abrirBanco(TELEMETRIA_DB); } catch (err) {
    const oQue = existia ? `o banco ${TELEMETRIA_DB} existe e não abriu` : `não consegui criar o banco ${TELEMETRIA_DB}`;
    log('WARN', `telemetria: ${oQue} (${err.message}); ${SEGUE_NO_JSON}`);
    return null;
  }
}

// Abre o banco e importa o que houver. Devolve o handle, ou null quando o motor fica nos JSON.
function abrirEImportar(log, dia) {
  const h = abrir(log);
  if (!h) return null;
  const fontes = lerFontes({ sessoes: usageMod.SESSIONS_FILE, tentativas: arquivoDeTentativas(), falhas: arquivoDeFalhas() });
  const r = importarConsumo(h, fontes);
  if (!r.ok) {
    fecharBanco(h);
    log('WARN', `telemetria: a importação do consumo para o banco falhou (${r.motivo}); nada foi renomeado; ${SEGUE_NO_JSON}`);
    return null;
  }
  const erros = renomearMigrados(fontes, r.presentes, dia);
  if (erros.length) log('WARN', `telemetria: os dados já estão no banco, mas não renomeei ${erros.join('; ')}; a próxima subida importa de novo sem duplicar e tenta outra vez`);
  else if (r.presentes.length) log('INFO', `telemetria: consumo migrado para telemetria.db: ${resumo(r)}; os JSON antigos ficaram como <nome>.migrado-${dia}`);
  return h;
}

function logDo(engine, warn) {
  return (nivel, msg) => (typeof engine.log === 'function' ? engine.log(nivel, msg) : warn(msg));
}

// No construtor da Engine: só lê (o agregado e o diário dos JSON, como antes do banco).
function carregarConsumo(engine, warn) {
  engine.usage = { ...usageMod.defaultUsage(), ...readJson(usageMod.USAGE_FILE, {}, warn) };
  engine.telemetria = null;
  engine.usageSessions = { ...usageMod.defaultSessions(), ...readJson(usageMod.SESSIONS_FILE, {}, warn) };
}

// No start(), depois do listen: abre o banco, importa, troca o diário e reconcilia as tentativas.
// `reconciliar: false` é para a prova de paridade (tools/comparar-consumo-sqlite.js), em que a
// linha da reconciliação, com a hora de agora, mudaria o retrato entre os dois modos.
function iniciarConsumo(engine, warn = () => { /* sem log */ }, { reconciliar = true } = {}) {
  if (engine.telemetria) return;
  const log = logDo(engine, warn);
  const h = abrirEImportar(log, usageMod.localDay());
  if (h) {
    engine.telemetria = h;
    engine.usageSessions = null;
    // a lista de falhas em memória passa a nascer da tabela, com o que foi importado
    engine.falhasSessao = undefined;
    invalidateUsage(engine);
  }
  if (!reconciliar) return;
  try { tentativasMod.reconciliarInterrompidas(engine); }
  catch (err) { log('WARN', `reconciliar tentativas interrompidas: ${err.message}`); }
}

// O histórico das decisões (lote 2, 17/11/2026), logo depois do consumo, com o banco já aberto:
// importa o `resolved` que o construtor leu do decisions.json (só o que o banco ainda não tem),
// confere, guarda uma cópia do arquivo original como decisions.json.migrado-<dia> e só então o
// regrava com `resolved: []`; as pendências ficam nele. A pendência que já está no histórico do
// banco (queda entre o COMMIT do resolveIntoHistory e o saveDecisions) sai das pendências.
// Banco fechado, importação que não confere ou cópia que falha deixam o histórico no
// decisions.json nesta subida, com uma linha WARN; a próxima subida importa o que faltar.
function iniciarHistorico(engine, warn = () => { /* sem log */ }) {
  if (!engine.telemetria || engine.historicoNoBanco || !engine.decisions) return;
  const log = logDo(engine, warn);
  const arquivo = path.join(STATE_DIR, 'decisions.json');
  const resolvidas = Array.isArray(engine.decisions.resolved) ? engine.decisions.resolved : [];
  const r = importarHistorico(engine.telemetria, resolvidas, { colunasDaBusca, teto: HIST_LIMIT });
  if (!r.ok) {
    log('WARN', `telemetria: a importação do histórico de decisões para o banco falhou (${r.motivo}); o decisions.json não foi tocado; ${SEGUE_NO_JSON_HISTORICO}`);
    return;
  }
  if (r.importadas) compactarWal(engine.telemetria);
  let copia = '';
  if (resolvidas.length && fs.existsSync(arquivo)) {
    try { copia = copiarMigrado(arquivo, usageMod.localDay()); } catch (err) {
      log('WARN', `telemetria: o histórico já está no banco, mas não copiei o decisions.json (${err.message}); ${SEGUE_NO_JSON_HISTORICO}; a próxima subida importa de novo sem duplicar`);
      return;
    }
  }
  engine.decisions.resolved = [];
  engine.historicoNoBanco = true;
  engine.historicoCache = null;
  const tiradas = tirarPendenciasJaResolvidas(engine);
  if (resolvidas.length || tiradas) {
    try { writeJsonAtomic(arquivo, engine.decisions); } catch (err) { log('WARN', `telemetria: regravar o decisions.json sem o histórico falhou (${err.message}); a próxima gravação das decisões tenta de novo`); }
  }
  if (resolvidas.length) log('INFO', `telemetria: histórico de decisões migrado para telemetria.db: ${resumoDoHistorico(r)}; o decisions.json original ficou como ${path.basename(copia)}`);
  if (tiradas) log('INFO', `telemetria: ${plural(tiradas, 'pendência já estava', 'pendências já estavam')} no histórico do banco (queda antes de regravar o decisions.json) e ${tiradas === 1 ? 'saiu' : 'saíram'} das pendências`);
}

const SEGUE_NO_JSON_HISTORICO = 'o histórico desta subida segue no decisions.json e entra no banco quando ele voltar a abrir';

function resumoDoHistorico(r) {
  const partes = [plural(r.importadas, 'decisão', 'decisões')];
  if (r.jaEstavam) partes.push(`${plural(r.jaEstavam, 'já estava', 'já estavam')} no banco`);
  if (r.ilegiveis) partes.push(plural(r.ilegiveis, 'item ilegível descartado', 'itens ilegíveis descartados'));
  if (r.podadas) partes.push(`${plural(r.podadas, 'saiu', 'saíram')} pelo teto de ${HIST_LIMIT}`);
  return partes.join('; ');
}

function tirarPendenciasJaResolvidas(engine) {
  const pend = Array.isArray(engine.decisions.pending) ? engine.decisions.pending : [];
  if (!pend.length) return 0;
  const noHistorico = new Set(historico(engine).leves().map(chaveDaPendencia));
  const ficam = pend.filter((d) => !(d && typeof d === 'object' && noHistorico.has(chaveDaPendencia(d))));
  engine.decisions.pending = ficam;
  return pend.length - ficam.length;
}

// O que o start() chama, depois do listen: o consumo e, com o banco aberto, o histórico.
function iniciarTelemetria(engine, warn) {
  iniciarConsumo(engine, warn);
  iniciarHistorico(engine, warn);
}

function fecharTelemetria(engine) {
  if (!engine || !engine.telemetria) return;
  fecharBanco(engine.telemetria);
  engine.telemetria = null;
  engine.historicoNoBanco = false;
  engine.historicoCache = null;
}

// O diário inteiro, na ordem, de onde ele estiver: para teste e ferramenta.
function sessoesDoDiario(engine) { return diario(engine).todas(); }

export { carregarConsumo, iniciarConsumo, iniciarHistorico, iniciarTelemetria, fecharTelemetria, sessoesDoDiario, historico, decisoesResolvidas };
