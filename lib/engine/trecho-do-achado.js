// O trecho do diff de cada achado com arquivo e linha (17/11/2026), para o detalhe da revisão
// mostrar a linha de que o achado fala.
//
// Gravado no desfecho da revisão (desfecho-da-revisao.js), daqui em diante: é o último momento em
// que o motor tem o patch de cada arquivo do PR à mão, no escopo materializado da sessão
// (pr-scope.js). As decisões gravadas antes não têm trecho, e o detalhe mostra só arquivo e linha.
//
// O que entra:
//   - só o lado do head: as linhas adicionadas e as de contexto em volta da linha do achado (uma
//     antes e uma depois), e só quando a própria linha está no diff. Achado que aponta para linha
//     fora do diff fica sem trecho, porque o motor não tem o arquivo inteiro;
//   - nunca de caminho protegido (arquivo de ambiente e credencial, caminho-protegido.js), nem do
//     nome que o escopo dá à projeção dele (a pasta redigida), nem de caminho que sai da raiz;
//   - a máscara de segredo e a retirada de credencial rodam no patch INTEIRO, antes de quebrar em
//     linhas e de cortar cada linha: um segredo de várias linhas (o corpo de uma chave PEM) ou um
//     token que o corte partiria na borda nunca chega a uma linha sem máscara. A máscara troca cada
//     pedaço de linha do segredo pela marca e mantém as quebras e o marcador do diff, para a
//     contagem das linhas do head continuar certa. A mesma regra vale na leitura do que foi gravado;
//   - tetos pequenos, porque o histórico guarda até 3.000 decisões: até 10 achados, 3 linhas por
//     achado e 160 caracteres por linha.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeFindings } from './review-findings-contract.js';
import { PASTA_REDIGIDA, caminhoProtegido, caminhoDoPr } from '../review-source/caminho-protegido.js';
import { maskSecrets, secretRanges } from '../sensitive-text.js';
import { retirarCredenciais } from './credencial-no-texto.js';

const TETO_DE_ACHADOS = 10;
const TETO_DO_TEXTO = 160;
const TETO_DO_PATCH = 2 * 1024 * 1024;
const RAIO = 1;
const CABECALHO = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const MARCA = '[segredo mascarado]';
const MARCADOR_DO_DIFF = /^[+ -]/;

// PURA: o texto com cada segredo trocado pela marca, linha a linha dentro do segredo, sem mudar o
// número de linhas. No começo de uma linha de dentro do segredo, o marcador do diff fica. A
// detecção é a de secretRanges (a mesma de maskSecrets, que pega a chave PEM de várias linhas);
// se ela recusar o texto (valor sensível com aspas abertas), devolve null e não há trecho. Depois,
// maskSecrets e retirarCredenciais em cada linha, como segunda passada.
function mascararPreservandoLinhas(texto) {
  let faixas;
  try { faixas = secretRanges(texto); } catch { return null; }
  let saida = '';
  let pos = 0;
  for (const { start, end } of faixas) {
    saida += texto.slice(pos, start);
    saida += texto.slice(start, end).split('\n').map((pedaco, i) => {
      if (i > 0 && MARCADOR_DO_DIFF.test(pedaco)) return pedaco[0] + (pedaco.length > 1 ? MARCA : '');
      return pedaco ? MARCA : '';
    }).join('\n');
    pos = end;
  }
  saida += texto.slice(pos);
  return saida.split('\n').map((l) => retirarCredenciais(maskSecrets(l))).join('\n');
}

// PURA: as linhas do lado do head a até RAIO da `linha`, num patch unificado (o `patch` da API do
// GitHub, sem cabeçalho de arquivo). Vazio quando a própria linha não está no diff.
function linhasDoPatch(patch, linha) {
  const saida = [];
  let novo = null;
  const limpo = mascararPreservandoLinhas(String(patch || ''));
  if (limpo === null) return [];
  for (const l of limpo.split('\n')) {
    const h = CABECALHO.exec(l);
    if (h) { novo = Number(h[1]); continue; }
    if (novo === null || !(l.startsWith('+') || l.startsWith(' '))) continue;
    if (Math.abs(novo - linha) <= RAIO) saida.push({ linha: novo, tipo: l.startsWith('+') ? 'adicionada' : 'contexto', texto: l.slice(1, 1 + TETO_DO_TEXTO) });
    novo++;
  }
  return saida.some((x) => x.linha === linha) ? saida : [];
}

function dentroDaRaiz(raiz, arquivo) {
  const rel = path.relative(raiz, arquivo);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// O caminho que o achado declara, conferido: nada na pasta redigida (a projeção do protegido tem
// outro nome no escopo), e o caminho do PR que ele representa também não pode ser protegido.
function caminhoAceito(caminho) {
  if (caminho.split('/')[0] === PASTA_REDIGIDA) return false;
  const doPr = caminhoDoPr(caminho);
  return !!doPr && !caminhoProtegido(caminho) && !caminhoProtegido(doPr);
}

function patchDoArquivo(raiz, caminho) {
  if (!caminhoAceito(caminho)) return '';
  const arquivo = path.resolve(raiz, ...caminho.split('/'));
  if (!dentroDaRaiz(path.resolve(raiz), arquivo)) return '';
  try {
    if (fs.statSync(arquivo).size > TETO_DO_PATCH) return '';
    return fs.readFileSync(arquivo, 'utf8');
  } catch { return ''; }
}

// Os trechos dos achados do envelope, lidos do escopo `raiz`: [{ arquivo, linha, linhas }].
function trechosDosAchados(raiz, findings) {
  if (typeof raiz !== 'string' || !raiz) return [];
  const { findings: achados } = normalizeFindings(findings, { causaObrigatoria: false });
  const vistos = new Set();
  const saida = [];
  for (const f of achados) {
    if (saida.length >= TETO_DE_ACHADOS) break;
    if (typeof f.file !== 'string' || !f.file || !Number.isInteger(f.line)) continue;
    const chave = `${f.file}:${f.line}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const linhas = linhasDoPatch(patchDoArquivo(raiz, f.file), f.line);
    if (linhas.length) saida.push({ arquivo: f.file, linha: f.line, linhas });
  }
  return saida;
}

// As linhas gravadas de um trecho, conferidas de novo: a máscara roda no trecho inteiro (as linhas
// juntas) e só depois cada linha é cortada. Detecção recusada tira o trecho.
function linhasGravadas(linhas) {
  const validas = linhas.filter((l) => l && Number.isInteger(l.linha) && typeof l.texto === 'string').slice(0, (RAIO * 2) + 1);
  const limpo = mascararPreservandoLinhas(validas.map((l) => l.texto).join('\n'));
  if (limpo === null) return [];
  const textos = limpo.split('\n');
  return validas.map((l, i) => ({ linha: l.linha, tipo: l.tipo === 'adicionada' ? 'adicionada' : 'contexto', texto: (textos[i] || '').slice(0, TETO_DO_TEXTO) }));
}

// O registro das provas, conferido de novo na leitura: o histórico vem do disco.
function trechosGravados(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.filter((t) => t && typeof t.arquivo === 'string' && Number.isInteger(t.linha) && Array.isArray(t.linhas))
    .slice(0, TETO_DE_ACHADOS)
    .map((t) => ({ arquivo: t.arquivo.slice(0, 300), linha: t.linha, linhas: linhasGravadas(t.linhas) }))
    .filter((t) => t.linhas.length);
}

export default { linhasDoPatch, trechosDosAchados, trechosGravados, mascararPreservandoLinhas };
export { linhasDoPatch, trechosDosAchados, trechosGravados, mascararPreservandoLinhas };
