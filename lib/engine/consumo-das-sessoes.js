// O que GET /api/usage junta às sessões do diário de consumo a partir das decisões (redesenho,
// lote 2, 19/11/2026). O diário não sabe o autor do PR nem o que a revisão produziu; a decisão do
// mesmo PR sabe:
//   - o autor do PR, para o filtro `author` e a coluna da tela: o das decisões pelo `ref` da linha,
//     sem caixa (a pendente e a mais recente primeiro);
//   - por linha da página, a decisão da rodada dela: das decisões do mesmo PR, a primeira criada no
//     registro da linha ou depois. É o caminho inverso da janela do detalhe
//     (detalhe-da-decisao.js): cada linha do diário é gravada no fim da própria sessão, antes de a
//     decisão ser registrada, e a rodada de uma decisão vai da criação da anterior até a dela.
//     Dela saem as etapas (`stages`), o card e os arquivos lidos (das provas, só na decisão inteira).
//     Só a revisão tem decisão; a rodada que ainda não decidiu fica sem os campos;
//   - o recorte em CSV (`formato=csv`), com o escape do CSV do Histórico (historico-csv.js).
// Com o histórico indisponível não há decisão: o consumo sai igual, sem autor e sem esses campos.
// Só lê: não altera o diário nem o histórico, e não escreve no log.
import { historico, historicoIndisponivel } from './historico-decisoes.js';
import { cardDe } from './busca-do-historico.js';
import { campoCsv, quando, BOM } from './historico-csv.js';

const TETO_DE_ETAPAS = 12;

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
const chave = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

// As decisões conhecidas, as pendentes antes e o histórico da mais nova para a mais antiga.
function decisoesConhecidas(engine) {
  if (historicoIndisponivel(engine)) return [];
  const pendentes = (engine.decisions && Array.isArray(engine.decisions.pending)) ? engine.decisions.pending : [];
  return [...pendentes, ...historico(engine).leves()].filter(objeto);
}

// PURA: o autor do PR por chave sem caixa, da primeira decisão que o diz.
function autoresDosPrs(decisoes) {
  const autores = new Map();
  for (const d of decisoes) {
    const autor = objeto(d.pr) && typeof d.pr.author === 'string' ? d.pr.author.trim() : '';
    const k = chave(d.key);
    if (k && autor && !autores.has(k)) autores.set(k, autor);
  }
  return autores;
}

// PURA: as decisões com hora de criação por chave sem caixa, da mais antiga para a mais nova
// (no empate, a ordem da lista). Montado uma vez por pedido, para cada linha não varrer todas.
function indiceDasDecisoes(decisoes) {
  const indice = new Map();
  for (const d of decisoes) {
    const k = objeto(d) ? chave(d.key) : '';
    if (!k || !Number.isSafeInteger(d.createdAt)) continue;
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(d);
  }
  for (const lista of indice.values()) lista.sort((a, b) => a.createdAt - b.createdAt);
  return indice;
}

// PURA: a decisão da rodada de uma linha de revisão, ou null. `decisoes` é a lista ou o índice.
function decisaoDaLinha(linha, decisoes) {
  if (!objeto(linha) || linha.kind !== 'review' || !Number.isFinite(linha.at)) return null;
  const ref = chave(linha.ref);
  if (!ref) return null;
  const indice = decisoes instanceof Map ? decisoes : indiceDasDecisoes(decisoes);
  return (indice.get(ref) || []).find((d) => d.createdAt >= linha.at) || null;
}

function etapasDa(d) {
  const lista = objeto(d.stages) && Array.isArray(d.stages.stages) ? d.stages.stages : [];
  return lista.filter(objeto).slice(0, TETO_DE_ETAPAS)
    .map((s) => ({ id: String(s.id || '').slice(0, 40), label: String(s.label || '').slice(0, 80), ms: Number(s.ms) >= 0 ? Number(s.ms) : 0 }));
}

function arquivosLidosDa(d) {
  const cobertura = objeto(d) && objeto(d.provas) ? d.provas.cobertura : null;
  const lidos = objeto(cobertura) ? cobertura.lidos : null;
  return Number.isSafeInteger(lidos) && lidos >= 0 ? lidos : null;
}

// A decisão inteira (as provas não estão no recorte leve): a pendente, ou a do histórico.
function decisaoInteira(engine, d, pendentes) {
  if (pendentes.has(d)) return d;
  return historico(engine).daChaveComId(d.key, d.id);
}

// As linhas da página com os campos da decisão da rodada de cada uma.
function comDetalheDaDecisao(engine, linhas, decisoes) {
  const indice = indiceDasDecisoes(decisoes);
  const pendentes = new Set(Array.isArray(engine.decisions?.pending) ? engine.decisions.pending : []);
  return linhas.map((linha) => {
    const d = decisaoDaLinha(linha, indice);
    if (!d) return linha;
    const out = { ...linha, decisaoId: String(d.id || '') };
    const etapas = etapasDa(d);
    if (etapas.length) out.etapas = etapas;
    const card = cardDe(d);
    if (card) out.card = card;
    const lidos = arquivosLidosDa(decisaoInteira(engine, d, pendentes));
    if (lidos !== null) out.arquivosLidos = lidos;
    return out;
  });
}

const COLUNAS = ['Quando', 'Tipo', 'Gatilho', 'PR', 'Autor', 'Card', 'Modelo', 'Perfil', 'Conta', 'Situação', 'Tentativas',
  'Duração (s)', 'Custo (USD)', 'Origem do custo', 'Entrada', 'Saída', 'Pensamento', 'Cache lido', 'Cache gravado'];
const CUSTO_DESCONHECIDO = new Set(['desconhecido', 'sem-base']);

const TOKENS = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens'];
const numero = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

// Uma linha por operação, como a tabela da tela; o que é medida soma as tentativas dela no período
// e nos filtros (`noRecorte`, lib/usage/report.js), como `totals`: a de fora do recorte não entra.
// O custo soma só as de custo conhecido, como `totals.costUsd`; sem nenhuma, fica vazio. A duração
// só sai quando todas as tentativas a sabem. A origem do custo lista as origens das tentativas.
// Quando, situação, modelo e decisão são os da operação (a última tentativa), como na tela.
function linhaDoCsv(r, indice) {
  const d = decisaoDaLinha(r, indice);
  const card = d ? cardDe(d) : '';
  const tentativas = (Array.isArray(r.noRecorte) ? r.noRecorte : [r]).filter(objeto);
  const soma = (campo) => tentativas.reduce((n, t) => n + numero(t[campo]), 0);
  const segundos = tentativas.length && tentativas.every((t) => t.durationKnown) ? Math.round(soma('duration') / 1000) : '';
  const conhecidas = tentativas.filter((t) => !CUSTO_DESCONHECIDO.has(t.costSource));
  const custo = conhecidas.length ? Math.round(conhecidas.reduce((n, t) => n + numero(t.costUsd), 0) * 1e6) / 1e6 : '';
  const origem = [...new Set(tentativas.map((t) => t.costSource).filter(Boolean))].sort().join(' e ');
  return [quando(r.at), r.kind, r.gatilho, r.ref, r.author, card, r.model, r.profile, r.account, r.status,
    tentativas.length, segundos, custo, origem, ...TOKENS.map(soma)];
}

// PURA: as operações do recorte (as linhas do histórico do relatório, sem página) em CSV.
// `decisoes` é a lista ou o índice (indiceDasDecisoes).
function consumoEmCsv(linhas, decisoes) {
  const indice = decisoes instanceof Map ? decisoes : indiceDasDecisoes(decisoes);
  const corpo = [COLUNAS, ...(Array.isArray(linhas) ? linhas : []).filter(objeto).map((r) => linhaDoCsv(r, indice))];
  return BOM + corpo.map((l) => l.map(campoCsv).join(',')).join('\n') + '\n';
}

function nomeDoCsv(agora = Date.now()) { return `farol-consumo-${quando(agora).slice(0, 10)}.csv`; }

export default { decisoesConhecidas, autoresDosPrs, indiceDasDecisoes, decisaoDaLinha, comDetalheDaDecisao, consumoEmCsv, nomeDoCsv, COLUNAS };
export { decisoesConhecidas, autoresDosPrs, indiceDasDecisoes, decisaoDaLinha, comDetalheDaDecisao, consumoEmCsv, nomeDoCsv, COLUNAS };
