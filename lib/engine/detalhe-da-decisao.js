// O detalhe de uma revisão (GET /api/decision, 17/11/2026): a mesma projeção do snapshot
// (decisionForUi) e, só nesta rota, duas coisas que a tela de detalhe pede e que não cabem no
// snapshot nem na página do histórico:
//   - `checks`: os checks obrigatórios do head como o motor os leu no fim da revisão, gravados nas
//     provas da decisão (provas-da-decisao.js). Decisão gravada antes de 17/11/2026 não os tem, e
//     a chave fica ausente;
//   - `execucao`: o que o diário de consumo registrou da RODADA desta decisão (abaixo). Duração ou
//     custo que alguma tentativa da rodada não sabe ficam ausentes, em vez de virar uma soma
//     parcial apresentada como total.
//
// A rodada é uma janela, e não o `sessionId`. Com a retomada ligada (reReviewResume, o padrão) a
// rodada seguinte do mesmo PR roda com --resume no MESMO session_id do Claude, então somar pelo
// id juntaria rodadas de decisões diferentes, inclusive as posteriores. E a tentativa que caiu no
// meio e foi refeita numa sessão nova tem outro id, e ficaria de fora. A janela resolve os dois:
// as linhas de revisão (`kind` review) do mesmo PR (`ref`), registradas depois da criação da
// decisão anterior do mesmo PR e até a criação desta. Cada linha do diário é gravada no fim da
// própria sessão, antes de a decisão ser registrada, e o motor não revisa o mesmo PR em duas
// sessões ao mesmo tempo.
//
// Sem decisão anterior do PR e com o histórico no teto (HIST_LIMIT), a anterior pode ter sido
// descartada: a janela começa na decisão mais antiga guardada (as descartadas são todas mais
// antigas que ela) e sai marcada `inicioIncerto`, porque pode faltar tentativa dessa época.
// Com o histórico indisponível não há como achar a anterior, e a execução fica ausente.
//
// A decisão é a mais recente da chave, como sempre foi, ou a do `id` pedido (a rodada antiga, ou a
// resolvida quando o PR tem uma pendente). Só lê: não altera a decisão nem o diário.
import { decisionForUi } from './public-review.js';
import { decisaoCruaPorChave } from './decision.js';
import { diario } from './usage-diario.js';
import { historico, historicoIndisponivel, HIST_LIMIT } from './historico-decisoes.js';
import { ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';

const TETO_DOS_CHECKS = 20;
const TETO_DOS_MODELOS = 10;
// o id que o motor grava (`d<ms><n>`), com folga: letras, dígitos, hífen e sublinhado
const ID_DA_DECISAO = /^[A-Za-z0-9_-]{1,64}$/;

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function checkDaLista(c) { return { nome: c.nome.slice(0, 120), estado: String(c.estado ?? '').slice(0, 20) }; }
function listaDeChecks(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((c) => objeto(c) && typeof c.nome === 'string' && c.nome).slice(0, TETO_DOS_CHECKS).map(checkDaLista);
}

// O registro das provas, conferido de novo: o histórico vem do disco e pode trazer forma torta.
function checksParaTela(c) {
  if (!objeto(c) || typeof c.conferidoNoHead !== 'boolean') return null;
  return { conferidoNoHead: c.conferidoNoHead, semExigencia: c.semExigencia === true, naoVerdes: listaDeChecks(c.naoVerdes), herdados: listaDeChecks(c.herdados) };
}

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// a duração de uma linha: do início da tentativa ao registro, quando o diário sabe o início
function duracaoDaLinha(r) {
  if (!(numero(r.iniciadaEm) > 0) || !(numero(r.at) >= r.iniciadaEm)) return null;
  return r.at - r.iniciadaEm;
}

// PURA sobre as linhas do diário de uma rodada.
function execucaoDasLinhas(linhas) {
  const validas = (Array.isArray(linhas) ? linhas : []).filter(objeto);
  if (!validas.length) return null;
  const modelos = [...new Set(validas.map((r) => (typeof r.model === 'string' ? r.model : '')).filter((m) => m && m !== 'desconhecido'))].slice(0, TETO_DOS_MODELOS);
  const execucao = { tentativas: validas.length, modelos };
  const duracoes = validas.map(duracaoDaLinha);
  if (duracoes.every((d) => d !== null)) execucao.duracaoMs = duracoes.reduce((a, b) => a + b, 0);
  const custos = validas.map((r) => (ORIGENS_DESCONHECIDAS.has(r.costSource) ? null : numero(r.costUsd)));
  if (custos.every((c) => c !== null)) {
    execucao.custoUsd = custos.reduce((a, b) => a + b, 0);
    execucao.custoEstimado = validas.some((r) => r.costSource === 'estimado');
  }
  return execucao;
}

const criacao = (d) => (objeto(d) && Number.isSafeInteger(d.createdAt) ? d.createdAt : null);

// PURA: a janela da rodada de `item` entre as `decisoes` conhecidas (pendentes e o histórico, da
// mais nova para a mais antiga). null quando a decisão não diz o PR ou a hora.
function janelaDaDecisao(item, decisoes, noTeto) {
  const ate = criacao(item);
  if (!objeto(item) || typeof item.key !== 'string' || !item.key || ate === null) return null;
  const ref = item.key.toLowerCase();
  let desde = null;
  for (const d of decisoes) {
    const em = criacao(d);
    if (em === null || d.key !== item.key || d.id === item.id || em >= ate) continue;
    if (desde === null || em > desde) desde = em;
  }
  let inicioIncerto = false;
  if (desde === null && noTeto) {
    const antigas = decisoes.map(criacao).filter((em) => em !== null);
    if (antigas.length) desde = Math.min(...antigas);
    inicioIncerto = true;
  }
  return { ref, desde, ate, inicioIncerto };
}

function naJanela(r, janela) {
  return objeto(r) && r.kind === 'review' && typeof r.ref === 'string' && r.ref.toLowerCase() === janela.ref
    && Number.isFinite(r.at) && r.at <= janela.ate && (janela.desde === null || r.at > janela.desde);
}

function execucaoDaDecisao(engine, item) {
  if (historicoIndisponivel(engine)) return null;
  const leves = historico(engine).leves();
  const decisoes = [...((engine.decisions && engine.decisions.pending) || []), ...leves];
  const janela = janelaDaDecisao(item, decisoes, leves.length >= HIST_LIMIT);
  if (!janela) return null;
  const execucao = execucaoDasLinhas(diario(engine).paraAtividade().filter((r) => naJanela(r, janela)));
  if (execucao && janela.inicioIncerto) execucao.inicioIncerto = true;
  return execucao;
}

// A decisão do `id` naquele PR: a pendente antes da resolvida, como na busca pela chave.
function decisaoCruaPorId(engine, key, id) {
  const k = String(key || '').trim();
  if (!k) return null;
  return ((engine.decisions && engine.decisions.pending) || []).find((x) => x && x.key === k && x.id === id)
    || historico(engine).daChaveComId(k, id) || null;
}

// O que a rota responde: `{ status, body }`. O corpo do 200 é o envelope `{ found, decision }`,
// como sempre foi; `id` fora da forma responde 400 com o campo, como as outras rotas de leitura.
function detalheDaDecisao(engine, searchParams) {
  const key = String(searchParams.get('key') || '');
  const ids = searchParams.getAll('id');
  if (ids.length > 1 || (ids.length === 1 && ids[0] !== '' && !ID_DA_DECISAO.test(ids[0]))) {
    return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: 'id' } };
  }
  const id = ids[0] || '';
  const d = id ? decisaoCruaPorId(engine, key, id) : decisaoCruaPorChave(engine, key);
  const decision = decisionForUi(d);
  if (!decision) return { status: 200, body: { found: false, decision: null } };
  const checks = checksParaTela(objeto(d.provas) ? d.provas.checks : null);
  if (checks) decision.checks = checks;
  const execucao = execucaoDaDecisao(engine, d);
  if (execucao) decision.execucao = execucao;
  return { status: 200, body: { found: true, decision } };
}

export default { detalheDaDecisao, execucaoDasLinhas, checksParaTela, janelaDaDecisao };
export { detalheDaDecisao, execucaoDasLinhas, checksParaTela, janelaDaDecisao };
