// O histórico das decisões resolvidas no banco: a tabela `resolvidas`, uma linha por decisão,
// na ordem em que entrou (`seq`; a mais nova é a de maior `seq`). As funções devolvem a decisão
// como o decisions.json guardava (o campo `item`, em JSON), e cada consulta reproduz o que a
// leitura equivalente fazia sobre o array `resolved`, que vinha da mais nova para a mais antiga
// (lib/engine/historico-decisoes.js). O SQL mora só aqui, sempre com parâmetro.
//
// As colunas da busca (`repo`, `repo_dobrado`, `busca`) não são calculadas aqui: quem grava as
// passa (`colunasDaBusca`, lib/engine/busca-do-historico.js), para a definição da busca ficar
// num lugar só. `null` nelas marca a linha como torta, e a consulta paginada sai pela lista.
import { parseJson, safeStringify } from '../io.js';

// Os campos que as regras do motor leem do histórico INTEIRO (o caminho quente: a última ação
// de cada PR, o dedup das rodadas publicadas, a retirada do pedido de mudanças, a estimativa, a
// retomada, a manutenção do material e os vistos). O resto da decisão (relatório, inventário,
// avaliação técnica, payloads) só sai pela leitura do item inteiro. Campo novo que uma dessas
// regras passe a ler entra aqui (test/telemetria-historico-paridade.test.js confere cada uma).
const CAMPOS_LEVES = Object.freeze(['id', 'key', 'createdAt', 'resolvedAt', 'status', 'action', 'verdict', 'headSha', 'sessionId',
  'roundId', 'card', 'cardMet', 'attention', 'reasons', 'stages', 'postRetry', 'retiradaPendente', 'pedidoRetirado', 'pr']);
const LEVES = new Set(CAMPOS_LEVES);

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' && v.isWellFormed() ? v : null; }
function inteiro(v) { return typeof v === 'number' && Number.isSafeInteger(v) ? v : null; }

// A identidade de uma decisão resolvida: nada disso muda depois de resolvida (a retirada do
// pedido de mudanças muda só a marca dela). Medido no histórico real (17/11/2026, 2.596
// decisões): o id sozinho já não se repete; a chave junta os campos que o resolveIntoHistory
// carimba para dois registros diferentes nunca colidirem.
function chaveDaDecisao(item) { return safeStringify([item.id, item.createdAt, item.resolvedAt, item.key, item.status]); }

// A pendência que já está no histórico (a queda entre o COMMIT no banco e a regravação do
// decisions.json): o resolveIntoHistory copia a pendência, então id, criação e PR são os mesmos.
function chaveDaPendencia(item) { return safeStringify([item.id, item.createdAt, item.key]); }

function leveDe(item) {
  const leve = {};
  for (const [campo, v] of Object.entries(item)) if (LEVES.has(campo) && v !== undefined) leve[campo] = v;
  return leve;
}

function preparada(h, sql) {
  if (!h.preparadas) h.preparadas = new Map();
  let st = h.preparadas.get(sql);
  if (!st) { st = h.db.prepare(sql); h.preparadas.set(sql, st); }
  return st;
}

// A decisão como o arquivo a guardaria: passada por JSON (campo undefined some, Date vira texto).
// Lança se ela não vira objeto (referência circular, por exemplo): quem grava trata como falha.
function comoNoArquivo(item) {
  const json = safeStringify(item);
  const volta = parseJson(json, null);
  if (!objeto(volta)) throw new Error('decisão que não se grava em JSON');
  return { json, volta };
}

const SEM_BUSCA = { repo: null, repoDobrado: null, busca: null };

function colunasDe(volta, json, colunasDaBusca) {
  const pr = objeto(volta.pr) ? volta.pr : {};
  const card = objeto(volta.card) ? volta.card.key : volta.card;
  const busca = colunasDaBusca(volta) || SEM_BUSCA;
  return {
    id: texto(volta.id), key: texto(volta.key), number: inteiro(pr.number), author: texto(pr.author), title: texto(pr.title),
    card: texto(card), action: texto(volta.action), verdict: texto(volta.verdict),
    status: texto(volta.status), created_at: inteiro(volta.createdAt), resolved_at: inteiro(volta.resolvedAt), head_sha: texto(volta.headSha),
    repo: busca.repo, repo_dobrado: busca.repoDobrado, busca: busca.busca,
    torta: Number(busca === SEM_BUSCA), leve: safeStringify(leveDe(volta)), item: json,
  };
}

const COLUNAS = ['id', 'key', 'number', 'author', 'title', 'card', 'action', 'verdict', 'status', 'created_at', 'resolved_at',
  'head_sha', 'repo', 'repo_dobrado', 'busca', 'torta', 'leve', 'item'];
const INSERIR = `INSERT INTO resolvidas (chave, ${COLUNAS.join(', ')}) VALUES (:chave, ${COLUNAS.map((c) => `:${c}`).join(', ')})
  ON CONFLICT (chave) DO NOTHING`;
const ATUALIZAR = `UPDATE resolvidas SET ${COLUNAS.map((c) => `${c} = :${c}`).join(', ')} WHERE seq = :seq`;

// Grava uma decisão. Devolve { seq, item, leve } com o item como o arquivo o guardaria, ou
// seq null quando a mesma decisão (mesma chave) já estava no banco.
function inserirDecisao(h, item, colunasDaBusca) {
  const { json, volta } = comoNoArquivo(item);
  const colunas = colunasDe(volta, json, colunasDaBusca);
  const r = preparada(h, INSERIR).run({ chave: chaveDaDecisao(volta), ...colunas });
  return { seq: r.changes ? Number(r.lastInsertRowid) : null, item: volta, leve: parseJson(colunas.leve, {}) };
}

// A decisão mudou depois de resolvida (a marca da retirada do pedido de mudanças): reescreve
// a linha inteira, menos a chave. Devolve { item, leve } como gravados, ou null sem a linha.
function atualizarDecisao(h, seq, item, colunasDaBusca) {
  const { json, volta } = comoNoArquivo(item);
  const colunas = colunasDe(volta, json, colunasDaBusca);
  const r = preparada(h, ATUALIZAR).run({ seq, ...colunas });
  return r.changes ? { item: volta, leve: parseJson(colunas.leve, {}) } : null;
}

// O teto do histórico (HIST_LIMIT, decision.js): ficam as `teto` mais novas. Devolve quantas saíram.
function podarDecisoes(h, teto) {
  return Number(preparada(h, `DELETE FROM resolvidas WHERE seq <= (SELECT seq FROM resolvidas ORDER BY seq DESC LIMIT 1 OFFSET :teto)`)
    .run({ teto }).changes);
}

const comItem = (l) => ({ seq: l.seq, item: parseJson(l.item, null) });

// [{ seq, leve }] da mais nova para a mais antiga.
function levesDasDecisoes(h) {
  return preparada(h, 'SELECT seq, leve FROM resolvidas ORDER BY seq DESC').all().map((l) => ({ seq: l.seq, leve: parseJson(l.leve, {}) }));
}

function decisoesRecentes(h, limite) { return preparada(h, 'SELECT seq, item FROM resolvidas ORDER BY seq DESC LIMIT :limite').all({ limite }).map(comItem); }
function todasAsDecisoes(h) { return preparada(h, 'SELECT seq, item FROM resolvidas ORDER BY seq DESC').all().map(comItem); }

function decisaoPorSeq(h, seq) {
  const l = preparada(h, 'SELECT item FROM resolvidas WHERE seq = :seq').get({ seq });
  return l ? parseJson(l.item, null) : null;
}

function ultimaDecisaoDaChave(h, key) {
  const l = preparada(h, 'SELECT item FROM resolvidas WHERE key = :key ORDER BY seq DESC LIMIT 1').get({ key });
  return l ? parseJson(l.item, null) : null;
}

// A decisão de um id naquele PR (o id sozinho já não se repete; a chave confere que é do PR pedido).
function decisaoDaChaveComId(h, key, id) {
  const l = preparada(h, 'SELECT item FROM resolvidas WHERE id = :id AND key = :key ORDER BY seq DESC LIMIT 1').get({ id, key });
  return l ? parseJson(l.item, null) : null;
}

function contarDecisoes(h) { return preparada(h, 'SELECT COUNT(*) AS n FROM resolvidas').get().n; }
function maiorSeq(h) { return preparada(h, 'SELECT COALESCE(MAX(seq), 0) AS s FROM resolvidas').get().s; }
function chavesDasDecisoes(h) { return new Set(preparada(h, 'SELECT chave FROM resolvidas').all().map((l) => l.chave)); }
function temTorta(h) { return !!preparada(h, 'SELECT 1 AS um FROM resolvidas WHERE torta = 1 LIMIT 1').get(); }

// As linhas gravadas depois de `seq`, na ordem em que entraram, uma por vez (a conferência da
// importação não carrega o histórico inteiro de uma vez).
function* decisoesDepoisDe(h, seq) {
  for (const l of h.db.prepare('SELECT seq, chave, leve, item FROM resolvidas WHERE seq > :seq ORDER BY seq').iterate({ seq })) {
    yield { seq: l.seq, chave: l.chave, leve: parseJson(l.leve, null), item: parseJson(l.item, null) };
  }
}

// O WHERE da página: o desfecho publicado (`action`; fora dos três eventos é `skip`), o
// repositório sem caixa e cada termo da busca dobrada. Os valores vão por parâmetro.
function filtroSql({ termos, veredito, repoDobrado, publicados, desdeMs = null, ateMs = null }) {
  const partes = [];
  const params = {};
  if (veredito && publicados.includes(veredito)) { partes.push('action = :veredito'); params.veredito = veredito; }
  else if (veredito) {
    partes.push('(action IS NULL OR action NOT IN (SELECT value FROM json_each(:publicados)))');
    params.publicados = safeStringify(publicados);
  }
  if (repoDobrado) { partes.push('repo_dobrado = :repo'); params.repo = repoDobrado; }
  // o período pela hora de resolução: a linha sem ela (coluna nula) fica fora, como na lista
  if (desdeMs !== null) { partes.push('resolved_at >= :desde'); params.desde = desdeMs; }
  if (ateMs !== null) { partes.push('resolved_at < :ate'); params.ate = ateMs; }
  termos.forEach((t, i) => { partes.push(`instr(busca, :t${i}) > 0`); params[`t${i}`] = t; });
  return { where: partes.length ? `WHERE ${partes.join(' AND ')}` : '', params };
}

// Uma página do histórico filtrada no SQL: { total, itens }, da mais nova para a mais antiga. Os
// itens saem sem o `inventarioDiff` (o inventário do diff, a maior parte de cada decisão: 165 dos
// 191 MB do histórico real em 17/11/2026), porque a página só vai à tela pela projeção
// decisionForUi, que não o lê (test/telemetria-historico-paridade.test.js compara a resposta).
function paginaDeDecisoes(h, filtros, { limite, offset }) {
  const { where, params } = filtroSql(filtros);
  const total = h.db.prepare(`SELECT COUNT(*) AS n FROM resolvidas ${where}`).get(params).n;
  const itens = h.db.prepare(`SELECT json_remove(item, '$.inventarioDiff') AS item FROM resolvidas ${where} ORDER BY seq DESC LIMIT :limite OFFSET :offset`)
    .all({ ...params, limite, offset }).map((l) => parseJson(l.item, null));
  return { total, itens };
}

// A grafia mais recente de cada repositório (sem caixa): no SQLite, a coluna solta ao lado do
// MAX vem da linha do máximo.
function grafiasDosRepos(h) {
  return preparada(h, "SELECT repo, MAX(seq) AS s FROM resolvidas WHERE repo <> '' GROUP BY repo_dobrado").all().map((l) => l.repo);
}

export {
  CAMPOS_LEVES, chaveDaDecisao, chaveDaPendencia, leveDe, inserirDecisao, atualizarDecisao, podarDecisoes, levesDasDecisoes,
  decisoesRecentes, todasAsDecisoes, decisaoPorSeq, ultimaDecisaoDaChave, decisaoDaChaveComId, contarDecisoes, maiorSeq, chavesDasDecisoes, temTorta,
  decisoesDepoisDe, paginaDeDecisoes, grafiasDosRepos,
};
