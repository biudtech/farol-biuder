// O diário de consumo (uma linha por sessão registrada) atrás de uma interface só, com dois
// lugares onde ele pode morar:
//   - o banco da telemetria (lib/telemetria/), desde 16/11/2026: registrar é um INSERT, e as
//     leituras filtram e contam no SQL;
//   - o array em memória gravado inteiro no usage-sessions.json, como era até então. Continua
//     valendo quando o banco não abriu ou a migração falhou nesta subida (o motor não perde dado
//     nem para), e para o engine de teste montado à mão, sem `telemetria`.
// Quem decide é `engine.telemetria`: presente, o banco; ausente, o JSON. Cada função devolve o
// mesmo nos dois lugares (test/telemetria-consumo.test.js e test/telemetria-paridade.test.js).
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { writeJsonAtomic } from '../io.js';
import { invalidateUsage } from './usage-projection-cache.js';
import { auditoriaDeConsumo, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';
import * as consumo from '../telemetria/consumo.js';

const SESSIONS_FILE = path.join(STATE_DIR, 'usage-sessions.json');
const VOCABULARIO = { perdidos: [...DESFECHOS_PERDIDOS], desconhecidas: [...ORIGENS_DESCONHECIDAS] };

function defaultSessions() { return { sessions: [] }; }

function avisar(engine, msg) { if (engine && typeof engine.log === 'function') engine.log('WARN', msg); }

function saveSessions(engine) {
  invalidateUsage(engine);
  try { writeJsonAtomic(SESSIONS_FILE, engine.usageSessions); }
  catch (err) { avisar(engine, `salvar usage-sessions.json: ${err.message}`); }
}

function diarioJson(engine) {
  const lista = () => (engine.usageSessions && engine.usageSessions.sessions) || [];
  return {
    todas: lista,
    // as linhas que o relatório de GET /api/usage lê; no banco, sem o accounting, que ele não usa
    paraAtividade: lista,
    recentes: (n) => lista().slice(-n).reverse(),
    primeira: () => lista()[0] ?? null,
    temTentativa: (attemptId) => lista().some((r) => r && r.attemptId === attemptId),
    // o usage-accounting.js procura a retomada anterior no próprio array
    baseDoCursor: lista,
    amostraDaTaxa: lista,
    auditoria: () => auditoriaDeConsumo(lista()),
    inserir(registro) {
      if (!engine.usageSessions) engine.usageSessions = defaultSessions();
      engine.usageSessions.sessions.push(registro);
      saveSessions(engine);
    },
    marcarStatus(id, status) {
      const alvo = [...lista()].reverse().find((s) => s && s.id === id);
      if (!alvo) return false;
      alvo.status = status;
      saveSessions(engine);
      return true;
    },
  };
}

// Escrita que falha não derruba quem registra: avisa no log, como a gravação do JSON fazia.
function escrever(engine, oQue, fn) {
  invalidateUsage(engine);
  try { return fn(); } catch (err) { avisar(engine, `gravar ${oQue} no telemetria.db: ${err.message}`); return false; }
}

function diarioBanco(engine) {
  const h = engine.telemetria;
  return {
    todas: () => consumo.todasAsSessoes(h),
    paraAtividade: () => consumo.sessoesDaAtividade(h),
    recentes: (n) => consumo.sessoesRecentes(h, n),
    primeira: () => consumo.primeiraSessao(h),
    temTentativa: (attemptId) => consumo.temTentativa(h, attemptId),
    baseDoCursor: () => (identidade, sid) => consumo.anteriorDoCursor(h, identidade, sid),
    amostraDaTaxa: (model) => consumo.amostraDaTaxa(h, model),
    auditoria: () => consumo.auditoriaDasSessoes(h, VOCABULARIO),
    inserir: (registro) => { escrever(engine, 'a sessão', () => consumo.inserirSessao(h, registro)); },
    marcarStatus: (id, status) => escrever(engine, 'o desfecho', () => consumo.marcarStatusDaSessao(h, id, status)),
  };
}

function diario(engine) { return engine && engine.telemetria ? diarioBanco(engine) : diarioJson(engine || {}); }

export { SESSIONS_FILE, defaultSessions, diario };
