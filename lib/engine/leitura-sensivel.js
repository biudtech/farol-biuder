// Detector de leitura de credencial do aparelho: só registra, nunca bloqueia.
//
// A sessão headless roda com a conta do dono e o `Read` dela alcança o home inteiro. Este
// módulo não muda o que a sessão pode fazer nem o resultado da revisão: deixa em
// medicoes-leitura.jsonl que ela abriu um arquivo de credencial, para o dono medir se isso
// acontece antes de decidir trava.
//
// A lista é ANCORADA no home de propósito, e por isso não reaproveita o CAMINHO_SENSIVEL de
// lib/review-source/contract.js: aquele julga caminho relativo do PR e casa código comum
// (`src/credentials.js`, `test/.ssh/config`). Aqui um `.ssh` dentro do escopo materializado
// ou de um clone não é a pasta do aparelho, e não pode gerar aviso.
//
// LIMITES: perfil do Claude com pasta fora do home não é coberto, porque a âncora é o home;
// só o `Read` entra (leitura por Bash não passa aqui).
import os from 'node:os';
import path from 'node:path';
import { prPathFromRead } from './pr-scope.js';
import { registrarMedicao } from './medicoes-leitura.js';

const PASTAS_DE_CREDENCIAL = new Set(['.ssh', '.aws', '.gnupg']);
const PASTA_DE_PERFIL_CLAUDE = /^\.claude(?:$|[-_.])/;
const CREDENCIAL_DO_PERFIL = '.credentials.json';
const CREDENCIAL_DO_GIT = '.git-credentials';
// Teto de caminhos distintos por sessão: sessão em laço não enche o arquivo de medições.
const TETO_DE_CAMINHOS = 50;

// PURA. O caminho como o sistema abriria, ou null quando ele não é absoluto.
function absoluto(caminho) {
  if (typeof caminho !== 'string' || !caminho || caminho.includes('\0')) return null;
  return path.posix.isAbsolute(caminho) ? path.posix.resolve(caminho) : null;
}

function partesDe(caminho) {
  return caminho.split(path.posix.sep).filter(Boolean);
}

const mesmoInicio = (raiz, alvo) => raiz.every((parte, i) => i < alvo.length && parte === alvo[i]);

function segmentosSobOHome(alvo, home) {
  const partes = partesDe(alvo), raiz = partesDe(home);
  return partes.length > raiz.length && mesmoInicio(raiz, partes) ? partes.slice(raiz.length) : null;
}

function ehPastaDePerfil(alvo, perfis) {
  const pasta = partesDe(alvo).slice(0, -1);
  return (Array.isArray(perfis) ? perfis : []).some((perfil) => {
    const dir = absoluto(perfil?.dir), raiz = dir && partesDe(dir);
    return !!raiz && raiz.length === pasta.length && mesmoInicio(raiz, pasta);
  });
}

function credencialDoPerfil(segmentos, alvo, perfis) {
  if (segmentos.at(-1) !== CREDENCIAL_DO_PERFIL) return false;
  return (segmentos.length === 2 && PASTA_DE_PERFIL_CLAUDE.test(segmentos[0])) || ehPastaDePerfil(alvo, perfis);
}

function ehCredencial(segmentos, alvo, perfis) {
  const [primeiro, segundo] = segmentos;
  const dois = segmentos.length === 2;
  if (PASTAS_DE_CREDENCIAL.has(primeiro) || (primeiro === '.config' && segundo === 'gh')) return true;
  if (segmentos.length === 1 && primeiro === CREDENCIAL_DO_GIT) return true;
  if (dois && primeiro === '.codex' && segundo === 'auth.json') return true;
  if (dois && primeiro === '.farol' && /credentials/i.test(segundo)) return true;
  return credencialDoPerfil(segmentos, alvo, perfis);
}

// PURA. O caminho normalizado e a identidade dele sob o home, ou null quando não é credencial.
function identificar(caminho, { home, perfis = [] } = {}) {
  const alvo = absoluto(caminho), raiz = absoluto(home);
  if (!alvo || !raiz) return null;
  const segmentos = segmentosSobOHome(alvo, raiz);
  if (!segmentos || !ehCredencial(segmentos, alvo, perfis)) return null;
  return { caminho: alvo, identidade: segmentos.join('/') };
}

// PURA. Devolve o caminho normalizado quando ele é credencial do aparelho, ou null.
// `perfis` é a lista claudeProfiles da config: a pasta de um perfil pode ter qualquer nome.
function caminhoSensivel(caminho, opcoes) {
  return identificar(caminho, opcoes)?.caminho || null;
}

// Por objeto de opções, que nasce e morre com a sessão: a mesma leitura repetida conta uma vez.
const jaVistas = new WeakMap();

function novaNaSessao(opts, identidade, dados) {
  if (!jaVistas.has(opts)) jaVistas.set(opts, { caminhos: new Set(), tetoAvisado: false });
  const sessao = jaVistas.get(opts);
  if (sessao.caminhos.has(identidade)) return false;
  if (sessao.caminhos.size < TETO_DE_CAMINHOS) {
    sessao.caminhos.add(identidade);
    return true;
  }
  if (!sessao.tetoAvisado) {
    sessao.tetoAvisado = true;
    registrarMedicao('leitura-sensivel-teto', { ...dados, teto: TETO_DE_CAMINHOS });
  }
  return false;
}

// Medição não derruba sessão: qualquer falha aqui fica sem registro e a sessão segue igual.
function avisarLeituraSensivel(engine, opts, block) {
  try {
    const achado = identificar(block.input?.file_path, { home: os.homedir(), perfis: engine.config?.claudeProfiles });
    if (!achado) return;
    const review = engine.activeReviews?.get(opts.id);
    if (prPathFromRead(review?.scopeRoot, achado.caminho)) return;
    const dados = { pr: review?.keys?.[0] || review?.pr?.key || null, sessao: opts.id || null };
    if (novaNaSessao(opts, achado.identidade, dados)) registrarMedicao('leitura-sensivel', { ...dados, caminho: achado.caminho });
  } catch { /* só observa */ }
}

export { caminhoSensivel, avisarLeituraSensivel, TETO_DE_CAMINHOS };
