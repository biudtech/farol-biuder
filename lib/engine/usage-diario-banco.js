// O diário de consumo no banco da telemetria, com o que o array em memória dava de graça e o
// banco não dá sozinho:
//   - cache: as linhas da atividade (GET /api/usage) e a auditoria são carregadas uma vez e
//     crescem com cada sessão nova, sem reler o diário (medido em 16/11/2026: reler custava uns
//     50 ms com 5,5 mil sessões e meio segundo com 50 mil, a cada consulta);
//   - escrita que falha não perde a linha: ela fica na fila de pendentes
//     (lib/engine/telemetria-pendentes.js), as leituras a enxergam e a próxima gravação a grava;
//   - leitura que falha não lança: devolve o vazio da leitura, com um WARN na mudança de estado,
//     para o snapshot sair mesmo sem a parte do consumo.
import * as consumo from '../telemetria/consumo.js';
import { invalidateUsage } from './usage-projection-cache.js';
import { auditoriaVazia, somarNaAuditoria, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';
import { gravarComFila, pendentes } from './telemetria-pendentes.js';

const VOCABULARIO = { perdidos: [...DESFECHOS_PERDIDOS], desconhecidas: [...ORIGENS_DESCONHECIDAS] };
const ASSUNTO = 'sessões';

function log(engine, nivel, msg) { if (typeof engine.log === 'function') engine.log(nivel, msg); }

function cache(engine) {
  const h = engine.telemetria;
  if (!engine.telemetriaCache || engine.telemetriaCache.h !== h) engine.telemetriaCache = { h, atividade: null, auditoria: null };
  return engine.telemetriaCache;
}

function ler(engine, oQue, fn, padrao) {
  try {
    const v = fn(engine.telemetria);
    engine.telemetriaLeituraFalhando = false;
    return v;
  } catch (err) {
    if (!engine.telemetriaLeituraFalhando) {
      engine.telemetriaLeituraFalhando = true;
      log(engine, 'WARN', `telemetria: ler ${oQue} no telemetria.db falhou (${err.message}); o consumo sai sem essa parte até o banco responder`);
    }
    return padrao;
  }
}

// As linhas que ainda não entraram no banco, na ordem.
function pendentesDoDiario(engine) { return pendentes(engine, ASSUNTO).filter((i) => i.tipo === 'linha').map((i) => i.registro); }

function semAccounting({ accounting, ...resto }) { return resto; }

// Depois de uma linha gravada, o cache cresce com ela, lida do banco como a leitura cheia a lê.
// Falha aqui não pode virar falha da gravação (a linha já entrou): o cache só é descartado.
function crescerCache(engine, seq) {
  const c = cache(engine);
  try {
    if (c.atividade) c.atividade.push(consumo.sessaoDaAtividadePorSeq(engine.telemetria, seq));
    if (c.auditoria) somarNaAuditoria(c.auditoria, consumo.sessaoPorSeq(engine.telemetria, seq));
  } catch {
    c.atividade = null;
    c.auditoria = null;
  }
}

// O desfecho corrige a linha no banco e no cache da atividade; a auditoria se refaz na próxima
// leitura (mudar de balde exigiria subtrair custo, e a soma deixaria de ser a mesma).
function aplicarStatus(engine, id, status) {
  if (!consumo.marcarStatusDaSessao(engine.telemetria, id, status)) return false;
  const c = cache(engine);
  const linha = c.atividade && c.atividade.findLast((s) => s.id === id);
  if (linha) linha.status = status;
  c.auditoria = null;
  return true;
}

function gravarItem(engine, item) {
  if (item.tipo === 'status') return aplicarStatus(engine, item.id, item.status);
  crescerCache(engine, consumo.inserirSessao(engine.telemetria, item.registro));
  return true;
}

function atividade(engine) {
  const c = cache(engine);
  if (!c.atividade) c.atividade = ler(engine, 'o diário', consumo.sessoesDaAtividade, null);
  const base = c.atividade || [];
  const p = pendentesDoDiario(engine);
  return p.length ? [...base, ...p.map(semAccounting)] : base;
}

function auditoria(engine) {
  const c = cache(engine);
  if (!c.auditoria) c.auditoria = ler(engine, 'a auditoria', (h) => consumo.auditoriaDasSessoes(h, VOCABULARIO), null);
  const p = pendentesDoDiario(engine);
  if (!p.length) return c.auditoria || auditoriaVazia();
  const r = structuredClone(c.auditoria || auditoriaVazia());
  for (const s of p) somarNaAuditoria(r, s);
  return r;
}

function recentes(engine, n) {
  const doBanco = ler(engine, 'as sessões recentes', (h) => consumo.sessoesRecentes(h, n), []);
  return [...pendentesDoDiario(engine)].reverse().concat(doBanco).slice(0, n);
}

function marcarStatus(engine, id, status) {
  invalidateUsage(engine);
  const pendente = pendentesDoDiario(engine).findLast((s) => s && s.id === id);
  if (pendente) { pendente.status = status; return true; }
  const pedido = { tipo: 'status', id, status };
  let achou = false;
  const gravou = gravarComFila(engine, ASSUNTO, pedido, (item) => {
    const r = gravarItem(engine, item);
    if (item === pedido) achou = r;
  });
  // na fila (o banco recusou), o desfecho vale quando ela esvaziar: conta como marcado
  return gravou ? achou : true;
}

function diarioBanco(engine) {
  const p = () => pendentesDoDiario(engine);
  return {
    todas: () => [...ler(engine, 'o diário', consumo.todasAsSessoes, []), ...p()],
    paraAtividade: () => atividade(engine),
    recentes: (n) => recentes(engine, n),
    primeira: () => ler(engine, 'a primeira sessão', consumo.primeiraSessao, null) ?? p()[0] ?? null,
    temTentativa: (attemptId) => p().some((s) => s && s.attemptId === attemptId)
      || ler(engine, 'as tentativas registradas', (b) => consumo.temTentativa(b, attemptId), false),
    baseDoCursor: () => (identidade, sid) => p().findLast((r) => r.account === identidade.account
      && (r.profileId || '') === identidade.profileId && r.accounting?.sessionId === sid)
      ?? ler(engine, 'o cursor das retomadas', (b) => consumo.anteriorDoCursor(b, identidade, sid), undefined),
    daSessaoDoProvedor: (sid) => (sid ? [...ler(engine, 'as linhas da sessão', (b) => consumo.sessoesDoCursor(b, sid), []),
      ...p().filter((r) => r && r.accounting?.sessionId === sid)] : []),
    amostraDaTaxa: (model) => [...ler(engine, 'a taxa de custo', (b) => consumo.amostraDaTaxa(b, model), []), ...p()],
    auditoria: () => auditoria(engine),
    inserir: (registro) => {
      invalidateUsage(engine);
      gravarComFila(engine, ASSUNTO, { tipo: 'linha', registro }, (item) => gravarItem(engine, item));
    },
    marcarStatus: (id, status) => marcarStatus(engine, id, status),
  };
}

export { diarioBanco };
