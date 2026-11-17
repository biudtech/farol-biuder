// Diário de tentativas de sessão de IA (spec 7.A1, item 9). O acumulador de consumo da
// sessão mora em memória (lib/engine/session.js), então app fechado no meio (bandeja,
// queda, kill) perdia o gasto inteiro. Aqui cada tentativa é aberta ANTES do provedor,
// ganha o consumo parcial durante a sessão e sai no fechamento normal, DEPOIS de o
// consumo ser registrado. O que sobra no boot virou, por construção, uma sessão cortada:
// reconciliarInterrompidas a transforma em linha `interrompida`, com os tokens vistos
// ou com custo desconhecido, e nunca a apaga sem registrar. As tentativas moram na tabela
// `tentativas` do telemetria.db (16/11/2026); quando o banco não abre, no usage-tentativas.json.
//
// O id da tentativa é próprio (uma sessão pode ter duas tentativas: retomada recusada
// cai numa sessão nova com o mesmo id do Farol) e viaja para a linha do Consumo como
// `attemptId`, que é o que impede o boot de duplicar uma tentativa já registrada.
//
// LIMITE DECLARADO: no POSIX o provedor roda em grupo de processo próprio (detached) e
// pode continuar consumindo depois que o engine morreu. Esse gasto não é observado; a
// linha diz isso em `provedorPodeTerContinuado`.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { TEMPOS } from '../constants.js';
import usageMod from './usage.js';
import { diario } from './usage-diario.js';
import * as tentativasDb from '../telemetria/tentativas.js';
import { gravarComFila, pendentes } from './telemetria-pendentes.js';

const ARQUIVO = path.join(STATE_DIR, 'usage-tentativas.json');
const CAMPOS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
// hora da última gravação de parcial por tentativa: memória do processo, de propósito
// (reinício zera, e a primeira gravação depois dele sai na hora)
const ultimaGravacao = new Map();

function arquivoDeTentativas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

function ler(engine) {
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  return objeto(bruto) && objeto(bruto.tentativas) ? bruto : { tentativas: {} };
}

function gravar(engine, dados) {
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, dados);
    return true;
  } catch (err) {
    avisar(engine, `gravar usage-tentativas.json: ${err.message}`);
    return false;
  }
}

// Com o banco da telemetria (engine.telemetria, 16/11/2026) cada operação mexe só na linha da
// tentativa; sem ele, o arquivo inteiro é lido e regravado, como era. Leitura que falha no banco
// não lança: avisa e devolve vazio.
function noBanco(engine, oQue, fn, padrao) {
  try { return fn(engine.telemetria); } catch (err) {
    if (!engine.telemetriaLeituraFalhando) avisar(engine, `telemetria: ${oQue} no telemetria.db falhou (${err.message})`);
    engine.telemetriaLeituraFalhando = true;
    return padrao;
  }
}

// Escrita que o banco recusa fica na fila de pendentes (lib/engine/telemetria-pendentes.js), em
// ordem, e as leituras a aplicam por cima do que o banco tem.
const ASSUNTO = 'tentativas';
function filaDoBanco(engine, item) {
  return gravarComFila(engine, ASSUNTO, item, (i) => {
    if (i.op === 'gravar') tentativasDb.gravarTentativa(engine.telemetria, i.chave, i.tentativa);
    else tentativasDb.apagarTentativa(engine.telemetria, i.chave);
  });
}

function aplicarPendentes(engine, mapa) {
  for (const i of pendentes(engine, ASSUNTO)) {
    if (i.op === 'gravar') mapa[i.chave] = i.tentativa;
    else delete mapa[i.chave];
  }
  return mapa;
}

function obter(engine, attemptId) {
  if (!engine?.telemetria) return ler(engine).tentativas[attemptId];
  const pendente = pendentes(engine, ASSUNTO).findLast((i) => i.chave === attemptId);
  if (pendente) return pendente.op === 'gravar' ? structuredClone(pendente.tentativa) : undefined;
  return noBanco(engine, 'ler tentativa', (h) => tentativasDb.obterTentativa(h, attemptId), undefined);
}

function salvar(engine, attemptId, tentativa) {
  if (engine?.telemetria) return filaDoBanco(engine, { op: 'gravar', chave: attemptId, tentativa: structuredClone(tentativa) });
  const dados = ler(engine);
  dados.tentativas[attemptId] = tentativa;
  return gravar(engine, dados);
}

function remover(engine, attemptId) {
  if (engine?.telemetria) {
    if (!obter(engine, attemptId)) return false;
    return filaDoBanco(engine, { op: 'apagar', chave: attemptId });
  }
  const dados = ler(engine);
  if (!dados.tentativas[attemptId]) return false;
  delete dados.tentativas[attemptId];
  return gravar(engine, dados);
}

function todas(engine) {
  if (!engine?.telemetria) return ler(engine).tentativas;
  return aplicarPendentes(engine, noBanco(engine, 'ler tentativas', (h) => tentativasDb.todasAsTentativas(h), {}));
}

function usoSaneado(u) {
  const out = {};
  for (const c of CAMPOS) out[c] = Math.max(0, Number(u && u[c]) || 0);
  return out;
}

function abrirTentativa(engine, meta) {
  const m = objeto(meta) ? meta : {};
  const attemptId = randomUUID();
  salvar(engine, attemptId, {
    attemptId, sessionId: texto(m.sessionId), kind: usageMod.kindFromId(m.sessionId),
    account: texto(m.account), profileId: texto(m.profileId), model: texto(m.model),
    providerSessionId: texto(m.providerSessionId),
    ref: texto(m.ref), provedor: texto(m.provedor) || 'claude',
    abertaEm: Date.now(), parcial: usoSaneado(null), parcialEm: 0,
  });
  return attemptId;
}

// O identificador do provedor não é o id da operação do Farol. Precisa sobreviver
// ao processo para o boot invalidar o cursor cumulativo da conversa interrompida.
function registrarSessao(engine, attemptId, providerSessionId) {
  const sid = texto(providerSessionId);
  if (!attemptId || !sid || sid.length > 200) return false;
  const tentativa = obter(engine, attemptId);
  if (!objeto(tentativa)) return false;
  if (tentativa.providerSessionId === sid) return true;
  tentativa.providerSessionId = sid;
  return salvar(engine, attemptId, tentativa);
}

// `parcial.usage` é o acumulado da sessão até aqui (substitui, não soma).
function registrarParcial(engine, attemptId, parcial) {
  if (!attemptId || !objeto(parcial)) return false;
  const agora = Date.now();
  const ultima = ultimaGravacao.get(attemptId) || 0;
  if (parcial.fimDeTurno !== true && ultima && agora - ultima < TEMPOS.TENTATIVA_PARCIAL_MS) return false;
  const tentativa = obter(engine, attemptId);
  if (!objeto(tentativa)) return false;
  tentativa.parcial = usoSaneado(parcial.usage);
  if (texto(parcial.model)) tentativa.model = texto(parcial.model);
  tentativa.parcialEm = agora;
  ultimaGravacao.set(attemptId, agora);
  return salvar(engine, attemptId, tentativa);
}

// Chamado DEPOIS do registro de consumo do fechamento normal. Se o processo morrer entre
// os dois, o boot acha a linha pelo attemptId e só remove.
function fecharTentativa(engine, attemptId) {
  ultimaGravacao.delete(attemptId);
  if (!attemptId) return false;
  return remover(engine, attemptId);
}

// O fechamento normal leva só o attemptId; o início mora no diário, que ainda está
// aberto nessa hora (fecharTentativa roda DEPOIS do registro). Sem isso a coluna
// Duração do Consumo só conhecia as linhas interrompidas. Nunca lança.
function comInicioDaTentativa(engine, ev) {
  if (!objeto(ev) || !texto(ev.farol_attempt) || Number(ev.farol_iniciada_em) > 0) return ev;
  const inicio = Number(obter(engine, ev.farol_attempt)?.abertaEm) || 0;
  return inicio > 0 ? { ...ev, farol_iniciada_em: inicio } : ev;
}

function eventoInterrompido(tentativa) {
  const usage = usoSaneado(tentativa.parcial);
  const temToken = CAMPOS.some((c) => usage[c] > 0);
  return {
    session_id: texto(tentativa.providerSessionId), farol_provider: texto(tentativa.provedor),
    usage, farol_interrompida: true, farol_parcial: temToken, farol_custo_desconhecido: !temToken,
    farol_attempt: tentativa.attemptId, farol_iniciada_em: Number(tentativa.abertaEm) || 0,
    farol_provedor_destacado: true,
  };
}

// recordUsage avisa a tela (pushState) e a outbox. No boot a tela ainda não existe e o
// snapshot leria campos que o construtor preenche depois; a outbox recupera pelo cursor.
function registroDeBoot(engine) {
  if (!engine.usage) engine.usage = usageMod.defaultUsage();
  if (!engine.telemetria && !engine.usageSessions) engine.usageSessions = usageMod.defaultSessions();
  return {
    usage: engine.usage, usageSessions: engine.usageSessions, telemetria: engine.telemetria,
    log: (nivel, msg) => avisar(engine, msg),
    pushState() { /* boot: a tela ainda não existe */ },
  };
}

function reconciliarInterrompidas(engine) {
  const abertas = todas(engine);
  const ids = Object.keys(abertas);
  if (!ids.length) return 0;
  const alvo = registroDeBoot(engine);
  const jaRegistrada = (id) => diario(alvo).temTentativa(id);
  let criadas = 0;
  const sobras = engine.telemetria ? null : ler(engine);
  for (const id of ids) {
    const tentativa = abertas[id];
    if (objeto(tentativa) && !jaRegistrada(id)) {
      usageMod.recordUsage(alvo, tentativa.sessionId, tentativa.account, eventoInterrompido(tentativa), tentativa.model, tentativa.profileId, tentativa.ref);
      criadas++;
    }
    // só sai do diário o que tem linha (ou era lixo ilegível): nunca some sem registro
    if (!objeto(tentativa) || jaRegistrada(id)) {
      if (sobras) delete sobras.tentativas[id];
      else remover(engine, id);
    }
  }
  if (sobras) gravar(engine, sobras);
  return criadas;
}

const tentativasMod = { arquivoDeTentativas, abrirTentativa, registrarSessao, registrarParcial, fecharTentativa, reconciliarInterrompidas, comInicioDaTentativa };
export default tentativasMod;
export { arquivoDeTentativas, abrirTentativa, registrarSessao, registrarParcial, fecharTentativa, reconciliarInterrompidas, comInicioDaTentativa };
