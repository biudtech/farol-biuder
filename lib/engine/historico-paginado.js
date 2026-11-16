// Histórico paginado: a consulta por trás de GET /api/decisions (fase 2b, a tela de
// Histórico do front novo). O snapshot leva só as 30 decisões resolvidas mais recentes,
// porque ele trafega a cada empurrão do SSE; o motor guarda até 3.000 (HIST_LIMIT, em
// decision.js), e é por aqui que a tela alcança o resto, uma página por vez, com busca e
// filtro feitos no motor (a definição do dado é dele: a tela só fatia e formata).
//
// Quatro regras que este arquivo segura:
//  - só leitura: lê engine.decisions.resolved e não altera, não grava e não loga nada,
//    nem na resposta 200 nem na recusa 400;
//  - o item sai SEMPRE por decisionForUi, a mesma allowlist do snapshot: payloads,
//    memória e relatório bruto não saem por esta rota;
//  - parâmetro inválido vira recusa com o nome do campo (400 na rota), nunca exceção nem
//    valor consertado em silêncio. A exceção é a página além do fim, que é uma consulta
//    válida sem resultado: 200 com `items` vazio e o total verdadeiro;
//  - dado torto no histórico (campo que não é texto nem número) conta como vazio, nunca
//    vira exceção: o decisions.json é lido do disco e pode trazer registro antigo.
import { normalizeUnicode } from './public-review-text.js';
import { decisionForUi } from './public-review.js';

const PAGINA_PADRAO = 30;
const TETO_DA_PAGINA = 100;
// teto do texto de busca e do filtro de repositório, em caracteres
const TETO_DA_BUSCA = 200;
// O filtro `veredito` olha o que foi PUBLICADO no PR (`action`), não o parecer da sessão
// (`verdict`): parecer de aprovar pode ter saído como pedido de mudanças, ou nem ter sido
// postado. Os três primeiros são os eventos de review; `skip` é o que não foi postado
// (pulado na mesa, substituído por rodada nova, PR já mergeado ou fechado, aprovação que
// não era mais necessária). São os quatro valores de `action` que o motor grava num item
// resolvido; registro sem `action`, ou com outro valor, entra em `skip`, para nenhum item
// ficar fora do alcance dos filtros.
const PUBLICADOS = Object.freeze(['approve', 'request_changes', 'comment']);
const NAO_POSTADO = 'skip';
const VEREDITOS = Object.freeze([...PUBLICADOS, NAO_POSTADO]);
// a ordem em que os campos são conferidos: com dois inválidos, a recusa cita o primeiro
const CAMPOS = Object.freeze(['page', 'pageSize', 'q', 'veredito', 'repo']);
// inteiro escrito só com dígitos, até nove: sem sinal, espaço, ponto nem expoente
const INTEIRO = /^\d{1,9}$/;
// termo de busca precisa de ao menos uma letra ou um dígito
const TEM_LETRA_OU_DIGITO = /[\p{L}\p{N}]/u;

function inteiroEntre(texto, minimo, maximo) {
  if (!INTEIRO.test(texto)) return null;
  const n = Number(texto);
  return n >= minimo && n <= maximo ? n : null;
}

function textoAte(texto, teto) { return texto.length <= teto ? texto : null; }
function vereditoAceito(texto) { return VEREDITOS.includes(texto) ? texto : null; }

// Cada campo recebe o texto cru (nunca vazio) e devolve o valor aceito, ou null. O
// repositório é aparado antes do teto: só espaço vira vazio, que é o mesmo que ausente.
const LEITORES = Object.freeze({
  page: (texto) => inteiroEntre(texto, 1, Number.MAX_SAFE_INTEGER),
  pageSize: (texto) => inteiroEntre(texto, 1, TETO_DA_PAGINA),
  q: (texto) => textoAte(texto, TETO_DA_BUSCA),
  veredito: vereditoAceito,
  repo: (texto) => textoAte(texto.trim(), TETO_DA_BUSCA),
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

function desfechoDe(item) { return PUBLICADOS.includes(item.action) ? item.action : NAO_POSTADO; }

function filtroDe({ q, veredito, repo }) {
  const termos = termosDe(q);
  const repoPedido = repo.toLowerCase();
  return (item) => {
    if (veredito && desfechoDe(item) !== veredito) return false;
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
function reposDe(resolvidas) {
  const porNome = new Map();
  for (const repo of resolvidas.map(repoDe).filter(Boolean)) {
    const chave = repo.toLowerCase();
    if (!porNome.has(chave)) porNome.set(chave, repo);
  }
  return [...porNome].sort(porChave).map(([, repo]) => repo);
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
