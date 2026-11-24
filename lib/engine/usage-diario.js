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
import { auditoriaDeConsumo } from './usage-desfechos.js';
// o lado do banco, com o cache, a fila de pendentes e a leitura que não lança
import { diarioBanco } from './usage-diario-banco.js';

const SESSIONS_FILE = path.join(STATE_DIR, 'usage-sessions.json');

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
    // com `seEra`, todas as linhas do id nesse desfecho; sem ele, a mais recente
    marcarStatus(id, status, seEra = null) {
      const alvos = seEra ? lista().filter((s) => s && s.id === id && s.status === seEra) : [[...lista()].reverse().find((s) => s && s.id === id)].filter(Boolean);
      if (!alvos.length) return false;
      for (const alvo of alvos) alvo.status = status;
      saveSessions(engine);
      return true;
    },
  };
}

function diario(engine) { return engine && engine.telemetria ? diarioBanco(engine) : diarioJson(engine || {}); }

export { SESSIONS_FILE, defaultSessions, diario };
