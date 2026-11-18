// Histórico paginado: a consulta por trás de GET /api/decisions (fase 2b, a tela de
// Histórico do front novo). O snapshot leva só as 30 decisões resolvidas mais recentes,
// porque ele trafega a cada empurrão do SSE; o motor guarda até 3.000 (HIST_LIMIT, em
// decision.js), e é por aqui que a tela alcança o resto, uma página por vez, com busca e
// filtro feitos no motor (a definição do dado é dele: a tela só fatia e formata).
//
// Quatro regras que este arquivo segura:
//  - só leitura: lê o histórico (historico-decisoes.js: no banco da telemetria, filtrado e
//    paginado no SQL, ou no decisions.json quando o banco não abriu) e não altera, não grava
//    e não loga nada, nem na resposta 200, nem na recusa 400, nem no 503 de histórico
//    indisponível (o banco que deveria ter o histórico não respondeu);
//  - o item sai SEMPRE por decisionForUi, a mesma allowlist do snapshot: payloads,
//    memória e relatório bruto não saem por esta rota;
//  - parâmetro inválido vira recusa com o nome do campo (400 na rota), nunca exceção nem
//    valor consertado em silêncio. A exceção é a página além do fim, que é uma consulta
//    válida sem resultado: 200 com `items` vazio e o total verdadeiro;
//  - dado torto no histórico (campo que não é texto nem número) conta como vazio, nunca
//    vira exceção: o histórico vem do disco e pode trazer registro antigo.
//
// A definição da busca e dos filtros mora em busca-do-historico.js, que o banco também usa.
//
// Duas coisas de 17/11/2026, para o topo e o botão do Histórico:
//  - `recentes7Dias`: quantas revisões foram resolvidas nos últimos 7 dias, hoje incluído, no fuso
//    do motor. É o total que a mesma rota daria com `desde` no primeiro desses dias e sem outro
//    filtro (o mesmo recorte do período "últimos 7 dias" da tela), contado no banco;
//  - `formato=csv`: as revisões que passam na busca e nos filtros, todas e sem página, em CSV
//    (historico-csv.js). `page` e `pageSize` não valem nesse formato.
import { decisionForUi } from './public-review.js';
import { paginaDoHistorico, diaValido } from './busca-do-historico.js';
import { historico, historicoIndisponivel } from './historico-decisoes.js';
import { historicoEmCsv, nomeDoArquivo } from './historico-csv.js';
import { FUSO_DO_DIA, TEMPOS } from '../constants.js';

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
// ficar fora do alcance dos filtros (busca-do-historico.js aplica a regra).
const PUBLICADOS = Object.freeze(['approve', 'request_changes', 'comment']);
const NAO_POSTADO = 'skip';
const VEREDITOS = Object.freeze([...PUBLICADOS, NAO_POSTADO]);
// a ordem em que os campos são conferidos: com dois inválidos, a recusa cita o primeiro
const CAMPOS = Object.freeze(['page', 'pageSize', 'q', 'veredito', 'repo', 'desde', 'ate', 'formato']);
const FORMATOS = Object.freeze(['csv']);
const DIAS_DO_TOPO = 7;
const DIA_DO_FUSO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_DIA, year: 'numeric', month: '2-digit', day: '2-digit' });
// inteiro escrito só com dígitos, até nove: sem sinal, espaço, ponto nem expoente
const INTEIRO = /^\d{1,9}$/;

function inteiroEntre(texto, minimo, maximo) {
  if (!INTEIRO.test(texto)) return null;
  const n = Number(texto);
  return n >= minimo && n <= maximo ? n : null;
}

function textoAte(texto, teto) { return texto.length <= teto ? texto : null; }
function diaAceito(texto) { return diaValido(texto) ? texto : null; }
function vereditoAceito(texto) { return VEREDITOS.includes(texto) ? texto : null; }

// Cada campo recebe o texto cru (nunca vazio) e devolve o valor aceito, ou null. O
// repositório é aparado antes do teto: só espaço vira vazio, que é o mesmo que ausente.
const LEITORES = Object.freeze({
  page: (texto) => inteiroEntre(texto, 1, Number.MAX_SAFE_INTEGER),
  pageSize: (texto) => inteiroEntre(texto, 1, TETO_DA_PAGINA),
  q: (texto) => textoAte(texto, TETO_DA_BUSCA),
  veredito: vereditoAceito,
  repo: (texto) => textoAte(texto.trim(), TETO_DA_BUSCA),
  // o período: o dia AAAA-MM-DD, de calendário (sem 31/02), no fuso do motor (FUSO_DO_DIA)
  desde: diaAceito,
  ate: diaAceito,
  formato: (texto) => (FORMATOS.includes(texto) ? texto : null),
});

// O primeiro dos últimos `dias` dias, hoje incluído, no fuso do motor (AAAA-MM-DD).
function primeiroDia(dias, agora = Date.now()) {
  const hoje = DIA_DO_FUSO.format(agora);
  return new Date(Date.parse(`${hoje}T00:00:00Z`) - ((dias - 1) * TEMPOS.DIA_MS)).toISOString().slice(0, 10);
}

// Lê a consulta da URL (URLSearchParams). Ausente ou vazio é o padrão; repetido é
// inválido, porque não há como saber qual dos dois valores o chamador quis. Parâmetro que
// a rota não conhece é ignorado.
function lerParametros(searchParams) {
  const lido = { ok: true, page: 1, pageSize: PAGINA_PADRAO, q: '', veredito: '', repo: '', desde: '', ate: '', formato: '' };
  for (const campo of CAMPOS) {
    const valores = searchParams.getAll(campo);
    if (valores.length > 1) return { ok: false, campo };
    const texto = valores[0] || '';
    if (!texto) continue;
    const valor = LEITORES[campo](texto);
    if (valor === null) return { ok: false, campo };
    lido[campo] = valor;
  }
  // período ao contrário (o fim antes do começo) é recusado pelo fim, que é o campo conferido depois
  if (lido.desde && lido.ate && lido.ate < lido.desde) return { ok: false, campo: 'ate' };
  return lido;
}

const INDISPONIVEL = Object.freeze({ status: 503, body: { ok: false, code: 'historico_indisponivel' } });

// Quantas resolvidas nos últimos 7 dias: o total da página com o período e sem outro filtro.
function recentes(engine, agora) {
  const pagina = historico(engine).pagina({ page: 1, pageSize: 1, q: '', veredito: '', repo: '', desde: primeiroDia(DIAS_DO_TOPO, agora), ate: '' });
  return pagina ? pagina.total : null;
}

// O recorte em CSV: `{ status, csv, nome }`, que a rota escreve como texto (http-server.js).
function historicoEmArquivo(engine, lido, agora) {
  const filtradas = historico(engine).filtradas(lido);
  if (!filtradas) return INDISPONIVEL;
  return { status: 200, csv: historicoEmCsv(filtradas), nome: nomeDoArquivo(agora) };
}

// O que a rota responde: `{ status, body }`, ou `{ status, csv, nome }` com `formato=csv`. Só as
// resolvidas; as pendentes continuam só no snapshot.
function historicoPaginado(engine, searchParams, agora = Date.now()) {
  const lido = lerParametros(searchParams);
  if (!lido.ok) return { status: 400, body: { ok: false, code: 'parametro_invalido', campo: lido.campo } };
  if (historicoIndisponivel(engine)) return INDISPONIVEL;
  if (lido.formato === 'csv') return historicoEmArquivo(engine, lido, agora);
  const pagina = historico(engine).pagina(lido);
  if (!pagina) return INDISPONIVEL;
  const { total, pages, items, repos } = pagina;
  const body = { ok: true, page: lido.page, pageSize: lido.pageSize, total, pages, items: items.map(decisionForUi), repos };
  const n = recentes(engine, agora);
  if (n !== null) body.recentes7Dias = n;
  return { status: 200, body };
}

export default { historicoPaginado, lerParametros, paginaDoHistorico, primeiroDia, VEREDITOS, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
export { historicoPaginado, lerParametros, paginaDoHistorico, primeiroDia, VEREDITOS, PUBLICADOS, NAO_POSTADO, PAGINA_PADRAO, TETO_DA_PAGINA, TETO_DA_BUSCA };
