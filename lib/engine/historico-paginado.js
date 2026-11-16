// Histórico paginado: a consulta por trás de GET /api/decisions (fase 2b, a tela de
// Histórico do front novo). O snapshot leva só as 30 decisões resolvidas mais recentes,
// porque ele trafega a cada empurrão do SSE; o motor guarda até 3.000 (HIST_LIMIT, em
// decision.js), e é por aqui que a tela alcança o resto, uma página por vez, com busca e
// filtro feitos no motor (a definição do dado é dele: a tela só fatia e formata).
//
// Três regras que este arquivo segura:
//  - só leitura: lê engine.decisions.resolved e não altera, não grava e não loga nada;
//  - o item sai SEMPRE por decisionForUi, a mesma allowlist do snapshot: payloads,
//    memória e relatório bruto não saem por esta rota;
//  - parâmetro inválido vira recusa com o nome do campo (400 na rota), nunca exceção nem
//    valor consertado em silêncio. A exceção é a página além do fim, que é uma consulta
//    válida sem resultado: 200 com `items` vazio e o total verdadeiro.
import { fold } from './public-review-text.js';
import { decisionForUi } from './public-review.js';

const PAGINA_PADRAO = 30;
const TETO_DA_PAGINA = 100;
// teto do texto de busca e do filtro de repositório, em caracteres
const TETO_DA_BUSCA = 200;
// Os vereditos que o motor grava no item (os mesmos de review-output.js). Item sem
// veredito (o que foi substituído por rodada nova, por exemplo) não casa com filtro nenhum.
const VEREDITOS = Object.freeze(['approve', 'request_changes', 'comment']);
// a ordem em que os campos são conferidos: com dois inválidos, a recusa cita o primeiro
const CAMPOS = Object.freeze(['page', 'pageSize', 'q', 'veredito', 'repo']);
// inteiro escrito só com dígitos, até nove: sem sinal, espaço, ponto nem expoente
const INTEIRO = /^\d{1,9}$/;

function inteiroEntre(texto, minimo, maximo) {
  if (!INTEIRO.test(texto)) return null;
  const n = Number(texto);
  return n >= minimo && n <= maximo ? n : null;
}

// Cada campo recebe o texto cru (nunca vazio) e devolve o valor aceito, ou null.
const LEITORES = Object.freeze({
  page: (texto) => inteiroEntre(texto, 1, Number.MAX_SAFE_INTEGER),
  pageSize: (texto) => inteiroEntre(texto, 1, TETO_DA_PAGINA),
  q: (texto) => (texto.length <= TETO_DA_BUSCA ? texto : null),
  veredito: (texto) => (VEREDITOS.includes(texto) ? texto : null),
  repo: (texto) => (texto.length <= TETO_DA_BUSCA ? texto : null),
});

// Lê a consulta da URL (URLSearchParams). Ausente ou vazio é o padrão; repetido é
// inválido, porque não há como saber qual dos dois valores o chamador quis. Parâmetro que
// a rota não conhece é ignorado.
function lerParametros(searchParams) {
  const lido = { ok: true, page: 1, pageSize: PAGINA_PADRAO, q: '', veredito: '', repo: '' };
  for (const campo of CAMPOS) {
    const valores = searchParams.getAll(campo);
    if (valores.length > 1) return { ok: false, campo };
    const texto = valores[0] || '';
    if (!texto) continue;
    const valor = LEITORES[campo](texto);
    if (valor === null) return { ok: false, campo };
    lido[campo] = valor;
  }
  return lido;
}

function repoDe(item) {
  const repo = item.pr && typeof item.pr === 'object' ? item.pr.repo : '';
  return typeof repo === 'string' ? repo : '';
}

// A chave do card chega como texto (é o que a revisão grava) ou, em registro antigo,
// como objeto com `key`.
function cardDe(item) {
  if (item.card && typeof item.card === 'object') return String(item.card.key || '');
  return String(item.card || '');
}

// Onde a busca procura: repo e número juntos (`dono/nome#12`, do jeito que a tela
// escreve), título, autor do PR e chave do card. Relatório e motivos ficam de fora.
function textoDeBusca(item) {
  const pr = item.pr && typeof item.pr === 'object' ? item.pr : {};
  return fold([`${repoDe(item)}#${pr.number ?? ''}`, pr.title, pr.author, cardDe(item)].map(v => String(v ?? '')).join('\n'));
}

// Sem caixa e sem acento dos dois lados (fold também troca hífen e sublinhado por
// espaço). Várias palavras: todas têm de aparecer, em qualquer campo.
function filtroDe({ q, veredito, repo }) {
  const termos = fold(q).split(/\s+/).filter(Boolean);
  const repoPedido = repo.toLowerCase();
  return (item) => {
    if (veredito && item.verdict !== veredito) return false;
    if (repoPedido && repoDe(item).toLowerCase() !== repoPedido) return false;
    if (!termos.length) return true;
    const texto = textoDeBusca(item);
    return termos.every(t => texto.includes(t));
  };
}

function porNome(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Os repositórios distintos de TODO o histórico, e não só do que passou no filtro: é a
// lista com que a tela monta o seletor, e ela não pode encolher quando um filtro entra.
function reposDe(resolvidas) {
  return [...new Set(resolvidas.map(repoDe).filter(Boolean))].sort(porNome);
}

// A página, ainda com os itens crus: quem projeta é historicoPaginado. `resolvidas` vem
// da mais nova para a mais antiga e a ordem é mantida.
function paginaDoHistorico(resolvidas, filtros) {
  const validas = (Array.isArray(resolvidas) ? resolvidas : []).filter(d => d && typeof d === 'object' && !Array.isArray(d));
  const filtradas = validas.filter(filtroDe(filtros));
  const inicio = (filtros.page - 1) * filtros.pageSize;
  return {
    total: filtradas.length,
    pages: Math.ceil(filtradas.length / filtros.pageSize),
    items: filtradas.slice(inicio, inicio + filtros.pageSize),
    repos: reposDe(validas),
  };
}

// O que a rota responde: `{ status, body }`. Só as resolvidas; as pendentes continuam só
// no snapshot.
function historicoPaginado(engine, searchParams) {
  const lido = lerParametros(searchParams);
  if (!lido.ok) return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: lido.campo } };
  const { total, pages, items, repos } = paginaDoHistorico(engine?.decisions?.resolved, lido);
  return { status: 200, body: { ok: true, page: lido.page, pageSize: lido.pageSize, total, pages, items: items.map(decisionForUi), repos } };
}

export default { historicoPaginado, lerParametros, paginaDoHistorico, VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
export { historicoPaginado, lerParametros, paginaDoHistorico, VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
