// Histórico paginado: a consulta por trás de GET /api/decisions (fase 2b, a tela de
// Histórico do front novo). O snapshot leva só as 30 decisões resolvidas mais recentes,
// porque ele trafega a cada empurrão do SSE; o motor guarda até 3.000 (HIST_LIMIT, em
// decision.js), e é por aqui que a tela alcança o resto, uma página por vez, com busca e
// filtro feitos no motor (a definição do dado é dele: a tela só fatia e formata).
//
// Quatro regras que este arquivo segura:
//  - só leitura: lê o histórico (historico-decisoes.js: no banco da telemetria, filtrado e
//    paginado no SQL, ou no decisions.json quando o banco não abriu) e não altera, não grava
//    e não loga nada, nem na resposta 200 nem na recusa 400;
//  - o item sai SEMPRE por decisionForUi, a mesma allowlist do snapshot: payloads,
//    memória e relatório bruto não saem por esta rota;
//  - parâmetro inválido vira recusa com o nome do campo (400 na rota), nunca exceção nem
//    valor consertado em silêncio. A exceção é a página além do fim, que é uma consulta
//    válida sem resultado: 200 com `items` vazio e o total verdadeiro;
//  - dado torto no histórico (campo que não é texto nem número) conta como vazio, nunca
//    vira exceção: o histórico vem do disco e pode trazer registro antigo.
//
// A definição da busca e dos filtros mora em busca-do-historico.js, que o banco também usa.
import { decisionForUi } from './public-review.js';
import { PUBLICADOS, NAO_POSTADO, paginaDoHistorico } from './busca-do-historico.js';
import { historico } from './historico-decisoes.js';

const PAGINA_PADRAO = 30;
const TETO_DA_PAGINA = 100;
// teto do texto de busca e do filtro de repositório, em caracteres
const TETO_DA_BUSCA = 200;
const VEREDITOS = Object.freeze([...PUBLICADOS, NAO_POSTADO]);
// a ordem em que os campos são conferidos: com dois inválidos, a recusa cita o primeiro
const CAMPOS = Object.freeze(['page', 'pageSize', 'q', 'veredito', 'repo']);
// inteiro escrito só com dígitos, até nove: sem sinal, espaço, ponto nem expoente
const INTEIRO = /^\d{1,9}$/;

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

// O que a rota responde: `{ status, body }`. Só as resolvidas; as pendentes continuam só
// no snapshot.
function historicoPaginado(engine, searchParams) {
  const lido = lerParametros(searchParams);
  if (!lido.ok) return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: lido.campo } };
  const { total, pages, items, repos } = historico(engine).pagina(lido);
  return { status: 200, body: { ok: true, page: lido.page, pageSize: lido.pageSize, total, pages, items: items.map(decisionForUi), repos } };
}

export default { historicoPaginado, lerParametros, paginaDoHistorico, VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
export { historicoPaginado, lerParametros, paginaDoHistorico, VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
