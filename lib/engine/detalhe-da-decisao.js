// O detalhe de uma revisão por chave (GET /api/decision, 17/11/2026): a mesma projeção do
// snapshot (decisionForUi) e, só nesta rota, duas coisas que a tela de detalhe pede e que não
// cabem no snapshot nem na página do histórico:
//   - `checks`: os checks obrigatórios do head como o motor os leu no fim da revisão, gravados nas
//     provas da decisão (provas-da-decisao.js). Decisão gravada antes de 17/11/2026 não os tem, e
//     a chave fica ausente;
//   - `execucao`: o que o diário de consumo registrou da sessão da revisão, achada pelo
//     `sessionId` da decisão (o `session_id` do Claude, que o diário guarda em
//     `accounting.sessionId`): quantas linhas, os modelos, a duração e o custo. Sem `sessionId`,
//     ou sem linha no diário, a chave fica ausente; duração ou custo que o diário não sabe de
//     alguma linha ficam ausentes, em vez de virar uma soma parcial apresentada como total.
// Só lê: não altera a decisão nem o diário.
import { decisionForUi } from './public-review.js';
import { decisaoCruaPorChave } from './decision.js';
import { diario } from './usage-diario.js';
import { ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';

const TETO_DOS_CHECKS = 20;
const TETO_DOS_MODELOS = 10;

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

// PURA sobre as linhas do diário de uma sessão.
function execucaoDasLinhas(linhas) {
  const validas = (Array.isArray(linhas) ? linhas : []).filter(objeto);
  if (!validas.length) return null;
  const modelos = [...new Set(validas.map((r) => (typeof r.model === 'string' ? r.model : '')).filter((m) => m && m !== 'desconhecido'))].slice(0, TETO_DOS_MODELOS);
  const execucao = { sessoes: validas.length, modelos };
  const duracoes = validas.map(duracaoDaLinha);
  if (duracoes.every((d) => d !== null)) execucao.duracaoMs = duracoes.reduce((a, b) => a + b, 0);
  const custos = validas.map((r) => (ORIGENS_DESCONHECIDAS.has(r.costSource) ? null : numero(r.costUsd)));
  if (custos.every((c) => c !== null)) {
    execucao.custoUsd = custos.reduce((a, b) => a + b, 0);
    execucao.custoEstimado = validas.some((r) => r.costSource === 'estimado');
  }
  return execucao;
}

function execucaoDaDecisao(engine, item) {
  const sid = objeto(item) && typeof item.sessionId === 'string' ? item.sessionId : '';
  if (!sid) return null;
  return execucaoDasLinhas(diario(engine).daSessaoDoProvedor(sid));
}

// O envelope da rota: `{ found, decision }`, como sempre foi.
function detalheDaDecisao(engine, key) {
  const d = decisaoCruaPorChave(engine, key);
  const decision = decisionForUi(d);
  if (!decision) return { found: false, decision: null };
  const checks = checksParaTela(objeto(d.provas) ? d.provas.checks : null);
  if (checks) decision.checks = checks;
  const execucao = execucaoDaDecisao(engine, d);
  if (execucao) decision.execucao = execucao;
  return { found: true, decision };
}

export default { detalheDaDecisao, execucaoDasLinhas, checksParaTela };
export { detalheDaDecisao, execucaoDasLinhas, checksParaTela };
