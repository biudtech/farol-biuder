// O diário de consumo no banco: a tabela `sessoes`, uma linha por sessão registrada, na ordem
// em que entrou (`seq`). As funções devolvem o registro como o usage-sessions.json guardava, e
// cada consulta reproduz o que a função equivalente do diário em memória fazia sobre o array
// (lib/engine/usage-diario.js). Filtro e contagem no SQL; a soma de custo pela soma em ordem
// (lib/telemetria/banco.js), que dá o mesmo número do `+=` de antes até o último bit.
import { paraLinha, deLinha, sqlDeInsercao } from './mapa.js';
import { safeStringify } from '../io.js';

// [campo do registro, coluna, tipo]: os campos que recordUsage grava hoje. O que só registro
// antigo tem (corrigidoEm, por exemplo) e o que nenhum escritor conhece ficam em `extra`.
const CAMPOS = [
  ['id', 'id', 'texto'], ['at', 'at', 'inteiro'], ['day', 'day', 'texto'], ['kind', 'kind', 'texto'],
  ['ref', 'ref', 'texto'], ['account', 'account', 'texto'], ['model', 'model', 'texto'], ['profileId', 'profile_id', 'texto'],
  ['inputTokens', 'input_tokens', 'inteiro'], ['outputTokens', 'output_tokens', 'inteiro'], ['thinkingTokens', 'thinking_tokens', 'inteiro'],
  ['cacheReadTokens', 'cache_read_tokens', 'inteiro'], ['cacheCreationTokens', 'cache_creation_tokens', 'inteiro'],
  ['costUsd', 'cost_usd', 'real'], ['farol', 'farol', 'texto'], ['costSource', 'cost_source', 'texto'],
  ['provider', 'provider', 'texto'], ['billingKind', 'billing_kind', 'texto'], ['status', 'status', 'texto'],
  ['attemptId', 'attempt_id', 'texto'], ['iniciadaEm', 'iniciada_em', 'inteiro'], ['resumeOutcome', 'resume_outcome', 'texto'],
  ['accounting', 'accounting', 'json'], ['modelUsage', 'model_usage', 'json'],
];
// as colunas que o relatório de GET /api/usage lê: todas menos o accounting
const COLUNAS_DA_ATIVIDADE = ['seq', ...CAMPOS.map((c) => c[1]).filter((c) => c !== 'accounting'), 'extra'].join(', ');
const INSERIR = sqlDeInsercao('sessoes', CAMPOS, ['cursor_sessao']);
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'];

function preparada(h, sql) {
  if (!h.preparadas) h.preparadas = new Map();
  let st = h.preparadas.get(sql);
  if (!st) { st = h.db.prepare(sql); h.preparadas.set(sql, st); }
  return st;
}

function cursorDe(registro) {
  const a = registro.accounting;
  return a && typeof a === 'object' && typeof a.sessionId === 'string' && a.sessionId.isWellFormed() ? a.sessionId : null;
}

// Devolve o `seq` da linha nova.
function inserirSessao(h, registro) {
  const { colunas, extra } = paraLinha(CAMPOS, registro);
  return Number(preparada(h, INSERIR).run({ ...colunas, cursor_sessao: cursorDe(registro), extra }).lastInsertRowid);
}

// A identidade de uma linha do diário, para a importação de um JSON não trazer de novo o que o
// banco já tem. Medido no diário real (16/11/2026, 5.567 linhas): `at` sozinho já não se repete,
// e o attemptId, quando existe, também não; a chave junta os dois com o id, o tipo e a conta. Os
// campos que mudam depois de gravada (o status, por marcarDesfecho) ficam de fora.
function chaveDaSessao(r) { return safeStringify([r.at, r.id, r.attemptId, r.kind, r.account]); }

function chavesDasSessoes(h) { return new Set(todasAsSessoes(h).map(chaveDaSessao)); }

// A linha recém-gravada, como a leitura da atividade e a do diário a devolvem: o cache cresce com
// ela sem reler o diário.
function sessaoPorSeq(h, seq) { return linhas(h, 'SELECT * FROM sessoes WHERE seq = :seq', { seq })[0] || null; }
function sessaoDaAtividadePorSeq(h, seq) { return linhas(h, `SELECT ${COLUNAS_DA_ATIVIDADE} FROM sessoes WHERE seq = :seq`, { seq })[0] || null; }

function linhas(h, sql, params = {}) { return preparada(h, sql).all(params).map((l) => deLinha(CAMPOS, l)); }

function todasAsSessoes(h) { return linhas(h, 'SELECT * FROM sessoes ORDER BY seq'); }

// O diário inteiro para o relatório de `GET /api/usage` (lib/usage/), sem o `accounting` da
// coluna, que é a maior parte de cada linha e que o relatório não lê: o resto volta igual.
function sessoesDaAtividade(h) { return linhas(h, `SELECT ${COLUNAS_DA_ATIVIDADE} FROM sessoes ORDER BY seq`); }

function sessoesRecentes(h, limite) { return linhas(h, 'SELECT * FROM sessoes ORDER BY seq DESC LIMIT :limite', { limite }); }

function primeiraSessao(h) { return linhas(h, 'SELECT * FROM sessoes ORDER BY seq LIMIT 1')[0] || null; }

function contarSessoes(h) { return preparada(h, 'SELECT COUNT(*) AS n FROM sessoes').get().n; }

function temTentativa(h, attemptId) {
  return !!preparada(h, 'SELECT 1 AS um FROM sessoes WHERE attempt_id = :attemptId LIMIT 1').get({ attemptId });
}

// A linha da retomada anterior da mesma sessão do provedor, para a mesma conta e perfil: o
// findLast do usage-accounting.js. O SQL corta pelo índice; o perfil se confere em JavaScript,
// com a regra de lá (`profileId || ''`).
function anteriorDoCursor(h, identidade, sid) {
  if (typeof sid !== 'string' || typeof identidade.account !== 'string') return undefined;
  const candidatas = linhas(h, 'SELECT * FROM sessoes WHERE cursor_sessao = :sid AND account = :account ORDER BY seq DESC',
    { sid, account: identidade.account });
  return candidatas.find((r) => (r.profileId || '') === identidade.profileId);
}

// As linhas de uma sessão do provedor (o `session_id` do Claude, que a decisão guarda em
// `sessionId`), pela coluna indexada do cursor: a sessão e as retomadas dela, na ordem.
function sessoesDoCursor(h, sid) {
  if (typeof sid !== 'string' || !sid) return [];
  return linhas(h, 'SELECT * FROM sessoes WHERE cursor_sessao = :sid ORDER BY seq', { sid });
}

// As sessões concluídas do modelo que podem dar taxa de custo. A regra fina (custo e token de
// saída maiores que zero, o tipo) continua em taxaObservada (lib/engine/usage.js), sobre isto;
// a coluna nula entra para o valor de tipo trocado ser julgado lá, como antes.
function amostraDaTaxa(h, model) {
  if (typeof model !== 'string') return [];
  return linhas(h, `SELECT * FROM sessoes WHERE model = :model AND status = 'ok'
    AND (cost_usd > 0 OR cost_usd IS NULL) AND (output_tokens > 0 OR output_tokens IS NULL) ORDER BY seq`, { model });
}

function marcarStatusDaSessao(h, id, status) {
  const r = preparada(h, `UPDATE sessoes SET status = :status,
      extra = CASE WHEN extra IS NULL THEN NULL ELSE json_remove(extra, '$.status') END
    WHERE seq = (SELECT MAX(seq) FROM sessoes WHERE id = :id)`).run({ status, id });
  return r.changes > 0;
}

// A auditoria de auditoriaDeConsumo (lib/engine/usage-desfechos.js) numa passada: contagem por
// balde e custo pela soma em ordem. `perdidos` e `desconhecidas` vêm do vocabulário do motor.
function auditoriaDasSessoes(h, { perdidos, desconhecidas }) {
  const custo = "COALESCE(cost_usd, json_extract(extra, '$.costUsd'))";
  // COALESCE: com a coluna nula (campo ausente ou de outro tipo) o IN daria NULL, e o NOT também
  const perdido = "COALESCE(status, '') IN (SELECT value FROM json_each(:perdidos))";
  const desconhecido = "COALESCE(cost_source, '') IN (SELECT value FROM json_each(:desconhecidas))";
  const estimado = `NOT (${desconhecido}) AND cost_source = 'estimado'`;
  const balde = (cond, nome) => `COUNT(*) FILTER (WHERE ${cond}) AS ${nome}_n, soma_em_ordem(${custo} ORDER BY seq) FILTER (WHERE ${cond}) AS ${nome}_c`;
  const r = preparada(h, `SELECT COUNT(*) AS total_n, soma_em_ordem(${custo} ORDER BY seq) AS total_c,
      ${balde(perdido, 'perdido')}, ${balde(`NOT (${perdido})`, 'util')},
      ${balde(desconhecido, 'desconhecido')}, ${balde(estimado, 'estimado')},
      ${balde(`NOT (${desconhecido}) AND cost_source IS NOT 'estimado'`, 'medido')}
    FROM sessoes`).get({ perdidos: safeStringify(perdidos), desconhecidas: safeStringify(desconhecidas) });
  const b = (nome) => ({ sessions: r[`${nome}_n`], costUsd: r[`${nome}_c`] ?? 0 });
  return { total: b('total'), util: b('util'), perdido: b('perdido'), medido: b('medido'), estimado: b('estimado'), desconhecido: b('desconhecido') };
}

// Contagem e somas da conferência da migração: sessões, os quatro tokens e o custo, contando só
// o valor numérico (o mesmo que somasDoDiario conta no array).
function somasDasSessoes(h) {
  const r = preparada(h, `SELECT COUNT(*) AS sessoes,
      soma_em_ordem(input_tokens ORDER BY seq) AS inputTokens, soma_em_ordem(output_tokens ORDER BY seq) AS outputTokens,
      soma_em_ordem(cache_read_tokens ORDER BY seq) AS cacheReadTokens, soma_em_ordem(cache_creation_tokens ORDER BY seq) AS cacheCreationTokens,
      soma_em_ordem(cost_usd ORDER BY seq) AS costUsd FROM sessoes`).get();
  return { sessoes: r.sessoes, inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0,
    cacheReadTokens: r.cacheReadTokens ?? 0, cacheCreationTokens: r.cacheCreationTokens ?? 0, costUsd: r.costUsd ?? 0 };
}

function somasDoDiario(registros) {
  const r = { sessoes: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const s of registros) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    r.sessoes++;
    for (const k of [...TOKENS, 'costUsd']) r[k] += num(s[k]);
  }
  return r;
}

export {
  inserirSessao, chaveDaSessao, chavesDasSessoes, sessaoPorSeq, sessaoDaAtividadePorSeq, todasAsSessoes, sessoesDaAtividade, sessoesRecentes, primeiraSessao, contarSessoes, temTentativa, anteriorDoCursor,
  sessoesDoCursor,
  amostraDaTaxa, marcarStatusDaSessao, auditoriaDasSessoes, somasDasSessoes, somasDoDiario,
};
