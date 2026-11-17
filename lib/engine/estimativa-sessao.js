// Quanto uma revisão costuma durar, pelo histórico da própria máquina (09/10/2026).
//
// A barra do cartão "Analisando agora" já foi duas coisas erradas: contagem de linhas do
// feed numa curva que parava em 90% e pulava para 100%, e depois uma barra indeterminada
// que só dizia "algo está rodando". O app SABE quanto uma revisão costuma levar: toda
// decisão grava `stages.totalMs` (etapas-revisao.js), e medido em 09/10/2026 eram 980
// revisões com mediana de 5,7 min (p10 2 min, p90 12 min). Este módulo transforma esse
// histórico num tempo típico, que vai na sessão do snapshot para o front comparar com o tempo
// decorrido.
//
// PURO na parte que decide (tempoTipico, etapasComTamanho recebe tudo pronto). O tamanho
// do PR entra nas etapas da decisão para que as próximas estimativas comparem PR de
// tamanho parecido; decisão gravada antes disto não tem tamanho e só conta na mediana geral.
import { stageSummaryFrom } from './etapas-revisao.js';
import { historico } from './historico-decisoes.js';

// faixas de arquivos alterados (limite superior inclusivo). Poucas e largas de propósito:
// faixa estreita demais nunca junta amostra suficiente e a estimativa cai sempre na geral.
const FAIXAS = [3, 10, 30, Infinity];
// abaixo disto a mediana é ruído, e a tela não promete prazo
const MIN_AMOSTRAS = 5;
// só as revisões mais recentes: modelo, protocolo e máquina mudam com o tempo
const JANELA = 300;
// sessão de stub, cancelada no começo ou retomada de checkpoint não representa revisão
const MIN_TOTAL_MS = 30000;

function faixaDe(arquivos) {
  const n = Number(arquivos);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return FAIXAS.findIndex(lim => n <= lim);
}

function mediana(xs) {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

// A mediana do tamanho quando há amostra suficiente da faixa; senão, a geral; senão, null.
function medianaDaFaixa(medidas, arquivos) {
  const faixa = faixaDe(arquivos);
  const doTamanho = faixa < 0 ? [] : medidas.filter(m => faixaDe(m.arquivos) === faixa);
  if (doTamanho.length >= MIN_AMOSTRAS) return { ms: mediana(doTamanho.map(m => m.ms)), amostras: doTamanho.length, base: 'tamanho' };
  if (medidas.length >= MIN_AMOSTRAS) return { ms: mediana(medidas.map(m => m.ms)), amostras: medidas.length, base: 'geral' };
  return null;
}

// Do início da sessão até a decisão gravada (createdAt), que no desfecho vem depois do gate e da
// postagem: é a duração da revisão inteira. Só a decisão que tem o início gravado nas etapas
// (stages.inicioEm, desde 17/11/2026) a mede; a anterior fica só na mediana até o modelo.
function duracaoAteOFim(d, st) {
  const ms = Number(d.createdAt) - Number(st.inicioEm);
  return Number.isFinite(ms) && ms >= st.totalMs ? ms : 0;
}

// PURA. `resolved` é o histórico de decisões (mais recente primeiro, como o engine guarda).
// Devolve { tipicoMs, amostras, base: 'tamanho' | 'geral' } ou null sem amostra suficiente;
// com amostra suficiente da revisão inteira, também `ateOFimMs` (mesma regra de faixa).
function tempoTipico(resolved, arquivos) {
  const medidas = [];
  const ateOFim = [];
  for (const d of resolved || []) {
    const st = d && d.stages;
    if (!st || !(st.totalMs >= MIN_TOTAL_MS)) continue;
    medidas.push({ ms: st.totalMs, arquivos: st.arquivos });
    const inteira = duracaoAteOFim(d, st);
    if (inteira) ateOFim.push({ ms: inteira, arquivos: st.arquivos });
    if (medidas.length >= JANELA) break;
  }
  const ateOModelo = medianaDaFaixa(medidas, arquivos);
  if (!ateOModelo) return null;
  const tipico = { tipicoMs: ateOModelo.ms, amostras: ateOModelo.amostras, base: ateOModelo.base };
  const inteira = medianaDaFaixa(ateOFim, arquivos);
  if (inteira) tipico.ateOFimMs = inteira.ms;
  return tipico;
}

// a estimativa da revisão que está começando, gravada no registro da sessão ativa (que a
// projeção leva à tela). Falha de medição do tamanho cai na mediana geral, nunca em erro.
function anotarEstimativa(engine, id, metrics) {
  const rec = engine.activeReviews && engine.activeReviews.get(id);
  if (!rec) return;
  const arquivos = metrics && metrics.changedFiles;
  rec.estimativa = tempoTipico(historico(engine).leves(), arquivos);
  if (arquivos) rec.arquivosPr = arquivos;
  // os caminhos que esta rodada tem a ler (na incremental, só os alterados): o denominador da
  // etapa de código na porcentagem do cartão (progresso-revisao.js). Sem a lista medida, a
  // etapa fica no marco, sem contagem de arquivos.
  const caminhos = (Array.isArray(metrics && metrics.files) ? metrics.files : []).map(f => f && f.path).filter(Boolean);
  if (caminhos.length) rec.arquivosALer = new Set(caminhos);
}

// as etapas da sessão que terminou, com o tamanho do PR junto: é o que a próxima
// estimativa usa para comparar PR de tamanho parecido
function etapasComTamanho(engine, id, metrics) {
  const inicio = (engine.activeReviews.get(id) || {}).startedAt;
  const st = stageSummaryFrom(engine.activity.get(id), inicio, Date.now());
  // o início da sessão vai junto: com o createdAt da decisão, mede a revisão até o fim do
  // desfecho (duracaoAteOFim), que o totalMs, calculado quando o modelo devolve, não mede
  if (st) st.inicioEm = inicio;
  if (st && metrics && metrics.changedFiles) {
    st.arquivos = metrics.changedFiles;
    st.linhas = metrics.lines || 0;
  }
  return st;
}

const estimativaMod = { FAIXAS, MIN_AMOSTRAS, faixaDe, tempoTipico, anotarEstimativa, etapasComTamanho };
export default estimativaMod;
export { FAIXAS, MIN_AMOSTRAS, faixaDe, tempoTipico, anotarEstimativa, etapasComTamanho };
