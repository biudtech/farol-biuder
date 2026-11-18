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
//   - nunca de caminho protegido (arquivo de ambiente e credencial, caminho-protegido.js), nem de
//     caminho que sai da raiz do escopo; o texto passa pela máscara de segredo, e a decisão inteira
//     ainda passa por retirarCredenciais ao ser gravada (decision.js);
//   - tetos pequenos, porque o histórico guarda até 3.000 decisões: até 10 achados, 3 linhas por
//     achado e 160 caracteres por linha.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeFindings } from './review-findings-contract.js';
import { caminhoProtegido } from '../review-source/caminho-protegido.js';
import { maskSecrets } from '../sensitive-text.js';

const TETO_DE_ACHADOS = 10;
const TETO_DO_TEXTO = 160;
const TETO_DO_PATCH = 2 * 1024 * 1024;
const RAIO = 1;
const CABECALHO = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// PURA: as linhas do lado do head a até RAIO da `linha`, num patch unificado (o `patch` da API do
// GitHub, sem cabeçalho de arquivo). Vazio quando a própria linha não está no diff.
function linhasDoPatch(patch, linha) {
  const saida = [];
  let novo = null;
  for (const l of String(patch || '').split('\n')) {
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

function patchDoArquivo(raiz, caminho) {
  if (caminhoProtegido(caminho)) return '';
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
    const linhas = linhasDoPatch(patchDoArquivo(raiz, f.file), f.line).map((l) => ({ ...l, texto: maskSecrets(l.texto) }));
    if (linhas.length) saida.push({ arquivo: f.file, linha: f.line, linhas });
  }
  return saida;
}

// O registro das provas, conferido de novo na leitura: o histórico vem do disco.
function trechosGravados(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.filter((t) => t && typeof t.arquivo === 'string' && Number.isInteger(t.linha) && Array.isArray(t.linhas))
    .slice(0, TETO_DE_ACHADOS)
    .map((t) => ({ arquivo: t.arquivo.slice(0, 300), linha: t.linha, linhas: t.linhas
      .filter((l) => l && Number.isInteger(l.linha) && typeof l.texto === 'string')
      .slice(0, (RAIO * 2) + 1)
      .map((l) => ({ linha: l.linha, tipo: l.tipo === 'adicionada' ? 'adicionada' : 'contexto', texto: maskSecrets(l.texto.slice(0, TETO_DO_TEXTO)) })) }))
    .filter((t) => t.linhas.length);
}

export default { linhasDoPatch, trechosDosAchados, trechosGravados };
export { linhasDoPatch, trechosDosAchados, trechosGravados };
