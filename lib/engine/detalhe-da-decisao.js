// O detalhe de uma revisão (GET /api/decision, 17/11/2026): a mesma projeção do snapshot
// (decisionForUi) e, só nesta rota, três coisas que a tela de detalhe pede e que não cabem no
// snapshot nem na página do histórico:
//   - `checks`: os checks obrigatórios do head como o motor os leu no fim da revisão, gravados nas
//     provas da decisão (provas-da-decisao.js). Decisão gravada antes de 17/11/2026 não os tem, e
//     a chave fica ausente;
//   - `criteriosDoCard`: os critérios do card um a um, como a sessão os declarou e as provas da
//     decisão os gravaram (criterios-do-card.js), conferidos de novo aqui porque o histórico vem
//     do disco. Ausente
//     quando a sessão não declarou (card sem critérios lidos, ou decisão anterior a 17/11/2026);
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
// Mais três, de 17/11/2026:
//   - `achados`: os achados da sessão com arquivo e linha, da memória de rodadas que o motor já
//     grava por análise (review-round-store.js, pelo `roundId` da decisão), com o trecho do diff
//     de cada um quando as provas o gravaram (trecho-do-achado.js, só daqui em diante). Ausente
//     sem rodada gravada (análise incompleta, decisão sem `roundId`) ou sem achado;
//   - `rodadasDoPr`: as decisões do mesmo PR, da mais antiga para a mais nova (as pendentes e o
//     histórico), cada uma com a rodada, a hora, o head curto, o parecer e o que foi publicado.
//     A rodada é a posição entre as guardadas: com o histórico no teto, o PR cuja decisão mais
//     antiga é a mais antiga guardada pode ter tido rodadas descartadas, e a lista sai marcada
//     `inicioIncerto`. Com o histórico indisponível a chave não sai;
//   - `tamanhoDoPr`: arquivos, adições e remoções do PR, do inventário do diff gravado na decisão.
//     Adições e remoções só desde 17/11/2026; arquivos, sempre que o inventário os contou.
//
// A decisão é a mais recente da chave, como sempre foi, ou a do `id` pedido (a rodada antiga, ou a
// resolvida quando o PR tem uma pendente). Só lê: não altera a decisão nem o diário.
import { decisionForUi } from './public-review.js';
import { decisaoCruaPorChave } from './decision.js';
import { diario } from './usage-diario.js';
import { historico, historicoIndisponivel, HIST_LIMIT } from './historico-decisoes.js';
import { ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';
import { criteriosDoCard } from './criterios-do-card.js';
import { readRound, scopeFor } from './review-round-store.js';
import { trechosGravados } from './trecho-do-achado.js';
import { PUBLICADOS } from './historico-paginado.js';
import { maskSecrets } from '../sensitive-text.js';

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

const TETO_DE_ACHADOS = 30;
const TETO_DE_RODADAS = 20;
const SEVERIDADES = ['blocking', 'suggestion', 'question', 'nitpick'];
const texto = (v, teto) => (typeof v === 'string' && v.trim() ? maskSecrets(v.trim().slice(0, teto)) : null);

function achadoParaTela(f, trechos) {
  const a = { severidade: f.severity, titulo: texto(f.title, 300) || '' };
  const resumo = texto(f.summary, 2000);
  if (resumo) a.resumo = resumo;
  const arquivo = texto(f.file, 300);
  if (arquivo) a.arquivo = arquivo;
  if (arquivo && Number.isSafeInteger(f.line) && f.line > 0) a.linha = f.line;
  if (['persiste', 'resolvido', 'retirado'].includes(f.status)) a.situacao = f.status;
  const trecho = a.linha ? trechos.find((t) => t.arquivo === f.file && t.linha === f.line) : null;
  if (trecho) a.trecho = trecho.linhas;
  return a;
}

// PURA sobre a rodada gravada e as provas da decisão.
function achadosDaRodada(rodada, provas) {
  if (!objeto(rodada) || !Array.isArray(rodada.findings)) return null;
  const trechos = trechosGravados(objeto(provas) ? provas.trechos : null);
  const achados = rodada.findings.filter((f) => objeto(f) && SEVERIDADES.includes(f.severity) && typeof f.title === 'string')
    .slice(0, TETO_DE_ACHADOS).map((f) => achadoParaTela(f, trechos));
  return achados.length ? achados : null;
}

function contaDaDecisao(engine, d) {
  if (objeto(d.pr) && typeof d.pr.account === 'string' && d.pr.account) return d.pr.account;
  return typeof engine.accountForPr === 'function' ? engine.accountForPr({ ...d.pr, key: d.key }) : '';
}

function achadosDaDecisao(engine, d) {
  if (typeof d.roundId !== 'string' || !d.roundId) return null;
  return achadosDaRodada(readRound(scopeFor(d.key, contaDaDecisao(engine, d)), d.roundId), d.provas);
}

const curto = (sha) => (typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null);

function rodadaParaTela(x, i, pendentes) {
  const r = { id: String(x.id || ''), rodada: i + 1, em: Number.isSafeInteger(x.resolvedAt) ? x.resolvedAt : x.createdAt };
  const head = curto(x.headSha);
  if (head) r.head = head;
  if (typeof x.verdict === 'string' && x.verdict) r.parecer = x.verdict.slice(0, 40);
  const pendente = pendentes.has(x);
  r.publicado = !pendente && PUBLICADOS.includes(x.action) ? x.action : null;
  if (pendente) r.pendente = true;
  return r;
}

// PURA: as decisões do PR de `item` entre as pendentes e o histórico (da mais nova para a mais
// antiga), em ordem de criação. `noTeto`: o histórico está no teto e pode ter descartado as primeiras.
function rodadasEntre(item, pendentes, leves, noTeto) {
  if (!objeto(item) || typeof item.key !== 'string' || !item.key) return null;
  const doPr = (x) => objeto(x) && x.key === item.key && Number.isSafeInteger(x.createdAt);
  const daPendencia = new Set(pendentes.filter(doPr));
  const todas = [...daPendencia, ...leves.filter(doPr)].sort((a, b) => a.createdAt - b.createdAt);
  if (!todas.length) return null;
  const itens = todas.map((x, i) => rodadaParaTela(x, i, daPendencia)).slice(-TETO_DE_RODADAS);
  const guardadas = leves.map(criacao).filter((em) => em !== null);
  const inicioIncerto = noTeto && guardadas.length > 0 && todas[0].createdAt <= Math.min(...guardadas);
  return inicioIncerto ? { itens, inicioIncerto: true } : { itens };
}

function rodadasDoPr(engine, d) {
  if (historicoIndisponivel(engine)) return null;
  const leves = historico(engine).leves();
  return rodadasEntre(d, (engine.decisions && engine.decisions.pending) || [], leves, leves.length >= HIST_LIMIT);
}

const contagem = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

// PURA: o tamanho do PR pelo inventário do diff gravado na decisão.
function tamanhoDoPr(inventario) {
  if (!objeto(inventario)) return null;
  const arquivos = contagem(inventario.changedFiles);
  if (arquivos === null) return null;
  const tamanho = { arquivos };
  const adicoes = contagem(inventario.additions);
  const remocoes = contagem(inventario.deletions);
  if (adicoes !== null && remocoes !== null) Object.assign(tamanho, { adicoes, remocoes });
  return tamanho;
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
  const criterios = criteriosDoCard(objeto(d.provas) && objeto(d.provas.card) ? d.provas.card.criterios : null);
  if (criterios) decision.criteriosDoCard = criterios;
  const execucao = execucaoDaDecisao(engine, d);
  if (execucao) decision.execucao = execucao;
  const achados = achadosDaDecisao(engine, d);
  if (achados) decision.achados = achados;
  const rodadas = rodadasDoPr(engine, d);
  if (rodadas) decision.rodadasDoPr = rodadas;
  const tamanho = tamanhoDoPr(d.inventarioDiff);
  if (tamanho) decision.tamanhoDoPr = tamanho;
  return { status: 200, body: { found: true, decision } };
}

export default { detalheDaDecisao, execucaoDasLinhas, checksParaTela, janelaDaDecisao, achadosDaRodada, rodadasEntre, tamanhoDoPr };
export { detalheDaDecisao, execucaoDasLinhas, checksParaTela, janelaDaDecisao, achadosDaRodada, rodadasEntre, tamanhoDoPr };
