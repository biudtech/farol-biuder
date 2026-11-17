// A definição da busca e dos filtros do histórico (GET /api/decisions), sem estado e sem I/O:
// o que conta como repositório, card, texto de busca e desfecho de um item resolvido, e a página
// calculada sobre uma lista. Mora aqui, e não em historico-paginado.js, porque dois lados a usam:
// a rota (historico-paginado.js) e o histórico no banco (historico-decisoes.js), que grava as
// colunas da busca com estas mesmas funções para o SQL filtrar exatamente como a lista filtrava.
import { normalizeUnicode } from './public-review-text.js';
import { FUSO_DO_DIA, TEMPOS } from '../constants.js';
// Os valores do filtro `veredito` moram na rota (historico-paginado.js), que o front também lê.
// O import é circular (a rota lê o histórico, que usa esta busca), e por isso este arquivo só usa
// PUBLICADOS e NAO_POSTADO dentro de função, nunca na carga do módulo.
import { PUBLICADOS, NAO_POSTADO } from './historico-paginado.js';
// termo de busca precisa de ao menos uma letra ou um dígito
const TEM_LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

// Só texto e número finito viram texto. Objeto, lista, booleano e símbolo contam como
// vazio: `String(objeto)` daria "[object Object]" na busca, e lança quando o objeto não
// tem `toString` chamável.
function textoDe(valor) {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

function prDe(item) { return item.pr && typeof item.pr === 'object' ? item.pr : {}; }

function repoDe(item) {
  const repo = prDe(item).repo;
  return typeof repo === 'string' ? repo.trim() : '';
}

// A chave do card chega como texto (é o que a revisão grava) ou, em registro antigo,
// como objeto com `key`.
function cardDe(item) {
  if (item.card && typeof item.card === 'object') return textoDe(item.card.key);
  return textoDe(item.card);
}

// A normalização da busca, igual dos dois lados: sem caixa e sem acento, com os hifens
// tipográficos trocados pelo comum e os caracteres invisíveis fora. Hífen e sublinhado
// FICAM: `proj-9` é um termo só, e não as palavras "proj" e "9" soltas.
function dobrar(texto) {
  return normalizeUnicode(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Onde a busca procura: repo e número juntos (`dono/nome#12`, do jeito que a tela
// escreve), título, autor do PR e chave do card. Relatório e motivos ficam de fora.
function textoDeBusca(item) {
  const pr = prDe(item);
  return dobrar([`${repoDe(item)}#${textoDe(pr.number)}`, textoDe(pr.title), textoDe(pr.author), cardDe(item)].join('\n'));
}

// Os termos são separados por espaço, e todos têm de aparecer, em qualquer campo. O que
// não tem letra nem dígito (`-`, `_`, `#`) não é termo: busca que fica sem termo nenhum
// vale como sem busca.
function termosDe(q) {
  return dobrar(q).split(/\s+/).filter(t => TEM_LETRA_OU_DIGITO.test(t));
}

// O período do histórico (`desde` e `ate`, os dois inclusivos) é o dia de calendário no fuso do
// motor, o mesmo do dia do consumo (FUSO_DO_DIA). Conta a hora em que a decisão foi resolvida
// (`resolvedAt`), que é a hora com que o histórico ordena e a tela agrupa.
const DIA = /^\d{4}-\d{2}-\d{2}$/;
function diaValido(texto) {
  if (typeof texto !== 'string' || !DIA.test(texto)) return false;
  const ms = Date.parse(`${texto}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === texto;
}

const DESLOCAMENTO = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_DO_DIA, timeZoneName: 'longOffset' });
const SINAL = { '+': 1, '-': -1 };
// quanto o fuso está à frente do UTC (negativo atrás), em ms, no instante `ms`. O nome vem como
// "GMT-03:00", ou só "GMT" no UTC.
function deslocamentoMs(ms) {
  const nome = (DESLOCAMENTO.formatToParts(ms).find((p) => p.type === 'timeZoneName') || {}).value || '';
  const m = nome.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return SINAL[m[1]] * ((Number(m[2]) * 60) + Number(m[3])) * 60000;
}

// A meia-noite do dia no fuso do motor, em ms. O deslocamento é lido duas vezes para acertar o dia
// em que o fuso muda (hoje o de São Paulo não muda, mas a conta não depende disso).
function inicioDoDia(dia) {
  const utc = Date.parse(`${dia}T00:00:00Z`);
  return utc - deslocamentoMs(utc - deslocamentoMs(utc));
}

// Os limites do período em ms: `desdeMs` inclusivo e `ateMs` exclusivo (a meia-noite do dia
// seguinte ao `ate`). null no lado que não foi pedido.
function diaSeguinte(dia) { return new Date(Date.parse(`${dia}T00:00:00Z`) + TEMPOS.DIA_MS).toISOString().slice(0, 10); }
function limitesDoPeriodo({ desde = '', ate = '' } = {}) {
  const limites = { desdeMs: null, ateMs: null };
  if (desde) limites.desdeMs = inicioDoDia(desde);
  if (ate) limites.ateMs = inicioDoDia(diaSeguinte(ate));
  return limites;
}

// A hora de resolução que entra no período: só inteiro (o banco grava a coluna só assim).
function noPeriodo(item, { desdeMs, ateMs }) {
  if (desdeMs === null && ateMs === null) return true;
  const em = item.resolvedAt;
  if (!Number.isSafeInteger(em)) return false;
  return (desdeMs === null || em >= desdeMs) && (ateMs === null || em < ateMs);
}

function desfechoDe(item) { return PUBLICADOS.includes(item.action) ? item.action : NAO_POSTADO; }

function filtroDe({ q, veredito, repo, desde, ate }) {
  const termos = termosDe(q);
  const repoPedido = repo.toLowerCase();
  const periodo = limitesDoPeriodo({ desde, ate });
  return (item) => {
    if (veredito && desfechoDe(item) !== veredito) return false;
    if (!noPeriodo(item, periodo)) return false;
    if (repoPedido && repoDe(item).toLowerCase() !== repoPedido) return false;
    if (!termos.length) return true;
    const texto = textoDeBusca(item);
    return termos.every(t => texto.includes(t));
  };
}

function porChave([a], [b]) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Os repositórios de TODO o histórico, e não só do que passou no filtro: é a lista com
// que a tela monta o seletor, e ela não pode encolher quando um filtro entra. Uma entrada
// por repositório, sem diferenciar caixa (o GitHub não diferencia), com a grafia do item
// mais recente: a lista vem da mais nova para a mais antiga, então vale a primeira vista.
// Recebe as grafias já aparadas (repoDe), na ordem.
function reposDasGrafias(grafias) {
  const porNome = new Map();
  for (const repo of grafias.filter(Boolean)) {
    const chave = repo.toLowerCase();
    if (!porNome.has(chave)) porNome.set(chave, repo);
  }
  return [...porNome].sort(porChave).map(([, repo]) => repo);
}

function valida(d) { return !!d && typeof d === 'object' && !Array.isArray(d); }

// A página, ainda com os itens crus: quem projeta é historicoPaginado. `resolvidas` vem
// da mais nova para a mais antiga e a ordem é mantida.
function paginaDoHistorico(resolvidas, filtros) {
  const validas = (Array.isArray(resolvidas) ? resolvidas : []).filter(valida);
  const filtradas = validas.filter(filtroDe(filtros));
  const inicio = (filtros.page - 1) * filtros.pageSize;
  return {
    total: filtradas.length,
    pages: Math.ceil(filtradas.length / filtros.pageSize),
    items: filtradas.slice(inicio, inicio + filtros.pageSize),
    repos: reposDasGrafias(validas.map(repoDe)),
  };
}

// Texto que o SQL do SQLite compara como o JavaScript compara: bem formado (sem surrogate solto,
// que o SQLite trocaria por U+FFFD) e sem o caractere nulo (as funções de texto do SQLite param
// nele). O que não é seguro faz a consulta sair pela lista, em JavaScript.
function seguroNoSql(texto) { return typeof texto === 'string' && texto.isWellFormed() && !texto.includes('\0'); }

// As colunas que o histórico no banco grava para a busca, calculadas pelas mesmas funções do
// filtro: o repositório aparado, ele sem caixa e o texto de busca dobrado. `null` quando o texto
// não é seguro para o SQL (a linha fica marcada e a consulta sai pela lista).
function colunasDaBusca(item) {
  const repo = repoDe(item);
  const colunas = { repo, repoDobrado: repo.toLowerCase(), busca: textoDeBusca(item) };
  return Object.values(colunas).every(seguroNoSql) ? colunas : null;
}

export {
  textoDe, prDe, repoDe, cardDe, dobrar, textoDeBusca, termosDe, desfechoDe, filtroDe, diaValido, inicioDoDia, limitesDoPeriodo,
  reposDasGrafias, valida, paginaDoHistorico, seguroNoSql, colunasDaBusca,
};
