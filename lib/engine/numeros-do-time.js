// Os números de 30 dias de cada autor (17/11/2026), para o dossiê do Time, calculados do
// histórico das decisões resolvidas (historico-decisoes.js: no banco da telemetria, ou no
// decisions.json quando o banco não abriu), pelo recorte leve que as regras do motor já leem.
//
// A definição, num lugar só:
//   - conta só a revisão PUBLICADA no PR (`action` approve, request_changes ou comment). A que não
//     saiu (pulada, substituída por rodada nova, PR já fechado) não foi rodada nenhuma para o autor;
//   - entram os PRs cuja PRIMEIRA revisão publicada (a de menor `createdAt` no histórico inteiro)
//     caiu nos últimos 30 dias. PR que já vinha de antes fica de fora: sem isso a "primeira
//     rodada" dele seria a primeira que coube na janela, e não a primeira de verdade;
//   - `prs`: quantos PRs; `aprovadosDePrimeira`: quantos tiveram a primeira revisão publicada como
//     aprovação; `rodadas`: quantas revisões publicadas esses PRs somam (até agora). A taxa e a
//     média a tela calcula sobre estes números, que são os que o motor sustenta.
// O autor é o `pr.author` da decisão, sem caixa (o GitHub não diferencia). Histórico
// indisponível devolve null: a tela não mostra número nenhum.
import { historico, historicoIndisponivel } from './historico-decisoes.js';
import { PUBLICADOS } from './historico-paginado.js';
import { TEMPOS } from '../constants.js';

const JANELA_DIAS = 30;

function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// PURA: os números por autor (login em minúsculas) sobre a lista de decisões resolvidas.
function numerosPorAutor(resolvidas, agora = Date.now()) {
  const desde = agora - (JANELA_DIAS * TEMPOS.DIA_MS);
  const porPr = new Map();
  for (const d of Array.isArray(resolvidas) ? resolvidas : []) {
    if (!objeto(d) || !PUBLICADOS.includes(d.action) || typeof d.key !== 'string' || !d.key) continue;
    if (!Number.isSafeInteger(d.createdAt)) continue;
    const autor = objeto(d.pr) && typeof d.pr.author === 'string' ? d.pr.author.trim().toLowerCase() : '';
    if (!autor) continue;
    const pr = porPr.get(d.key) || { autor, primeira: null, rodadas: 0 };
    pr.rodadas += 1;
    if (!pr.primeira || d.createdAt < pr.primeira.createdAt) pr.primeira = d;
    porPr.set(d.key, pr);
  }
  const porAutor = {};
  for (const pr of porPr.values()) {
    if (pr.primeira.createdAt < desde || pr.primeira.createdAt > agora) continue;
    const n = porAutor[pr.autor] || (porAutor[pr.autor] = { janelaDias: JANELA_DIAS, prs: 0, aprovadosDePrimeira: 0, rodadas: 0 });
    n.prs += 1;
    n.rodadas += pr.rodadas;
    if (pr.primeira.action === 'approve') n.aprovadosDePrimeira += 1;
  }
  return porAutor;
}

function numerosDoTime(engine, agora = Date.now()) {
  if (historicoIndisponivel(engine)) return null;
  return numerosPorAutor(historico(engine).leves(), agora);
}

// A lista de GET /api/team com os números de cada autor, quando o histórico os tem. Autor sem PR
// na janela fica sem a chave (não é zero sustentado: pode só não ter revisão publicada).
function timeComNumeros(lista, numeros) {
  if (!numeros) return lista;
  return lista.map((autor) => {
    const n = numeros[String(autor.login || '').toLowerCase()];
    return n ? { ...autor, numeros: n } : autor;
  });
}

export default { numerosPorAutor, numerosDoTime, timeComNumeros, JANELA_DIAS };
export { numerosPorAutor, numerosDoTime, timeComNumeros, JANELA_DIAS };
