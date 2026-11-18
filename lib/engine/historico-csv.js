// O recorte do Histórico em CSV (17/11/2026): o botão "Exportar CSV" da tela baixa as revisões que
// passam na busca e nos filtros abertos, sem página (GET /api/decisions?formato=csv, até as 3.000
// do histórico). PURO: recebe as decisões já filtradas (o recorte leve) e devolve o texto.
//
// Duas regras de segurança, porque o arquivo abre numa planilha e o texto vem de fora (título e
// autor do PR, card):
//   - escape de CSV: campo com vírgula, aspas ou quebra de linha vai entre aspas, com as aspas de
//     dentro dobradas;
//   - injeção de fórmula: campo que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de carro
//     ganha um apóstrofo na frente, para a planilha o ler como texto e nunca como fórmula.
// O arquivo começa com a marca de ordem de bytes do UTF-8, para a planilha não trocar os acentos, e
// as linhas terminam em LF.
import { FUSO_DO_DIA } from '../constants.js';
import { prDe, cardDe, desfechoDe } from './busca-do-historico.js';

const PERIGOSO = /^[=+\-@\t\r]/;
const PRECISA_DE_ASPAS = /[",\r\n]/;
const BOM = '﻿';

const ROTULOS = Object.freeze({ approve: 'aprovado', request_changes: 'mudanças pedidas', comment: 'comentado', skip: 'não publicado' });

const HORA = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO_DO_DIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// PURA: um campo pronto para a linha.
function campoCsv(valor) {
  let t = valor === null || valor === undefined ? '' : String(valor);
  if (PERIGOSO.test(t)) t = `'${t}`;
  return PRECISA_DE_ASPAS.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

function quando(ms) { return Number.isSafeInteger(ms) ? HORA.format(ms) : ''; }
function textoDe(v) { return typeof v === 'string' ? v : ''; }

const COLUNAS = ['Resolvida em', 'Repositório', 'PR', 'Título', 'Autor', 'Card', 'Publicado', 'Parecer', 'Situação', 'Head', 'Endereço'];

function linhaDa(d) {
  const pr = prDe(d);
  const numero = Number.isSafeInteger(pr.number) ? pr.number : '';
  const parecer = textoDe(d.verdict);
  return [quando(d.resolvedAt), textoDe(pr.repo).trim(), numero, textoDe(pr.title), textoDe(pr.author), cardDe(d),
    ROTULOS[desfechoDe(d)], ROTULOS[parecer] || parecer, textoDe(d.status), textoDe(d.headSha).slice(0, 7), textoDe(pr.url)];
}

function historicoEmCsv(decisoes) {
  const linhas = [COLUNAS, ...(Array.isArray(decisoes) ? decisoes : []).filter((d) => d && typeof d === 'object').map(linhaDa)];
  return BOM + linhas.map((l) => l.map(campoCsv).join(',')).join('\n') + '\n';
}

// O nome do arquivo, com o dia de hoje no fuso do motor.
function nomeDoArquivo(agora = Date.now()) {
  return `farol-historico-${HORA.format(agora).slice(0, 10)}.csv`;
}

export default { campoCsv, historicoEmCsv, nomeDoArquivo, COLUNAS };
export { campoCsv, historicoEmCsv, nomeDoArquivo, COLUNAS };
