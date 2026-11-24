// As ocorrências da revisão (pedido do dono, 24/11/2026): toda revisão que terminou sem publicar
// e sem decisão no histórico deixa um registro durável, com o motivo dito em português, para
// ninguém achar que foi falha do Farol e para dar para remontar o cenário depois.
//
// O caso que motivou: biudtech/guia-do-selo#64, 24/11/2026. A sessão morreu por SIGABRT às 16:11
// (transitório, foi ao retry), o retry foi segurado às 16:14 porque uma pessoa aprovou no head,
// o dono clicou "tentar novamente", a revisão parou na etapa das fontes e o PR foi mergeado às
// 16:19. O que encerrou a revisão não deixou linha no farol.log, nada no consumo (a sessão não
// gastou token) e nada no banco: só um toast.
//
// Cada ocorrência vai para a tabela `ocorrencias` do banco da telemetria (lib/telemetria/
// ocorrencias.js), pela fila do que o banco recusou (telemetria-pendentes.js), com teto; sem o
// banco, fica em memória. E escreve UMA linha INFO no farol.log: é o motivo de uma decisão que
// alguém vai perguntar depois (invariante 3). Os desfechos que já viram decisão no histórico
// (already_reviewed, already_merged, approval_not_needed...) não passam aqui.
//
// Nunca lança: registro opcional não derruba revisão.
import * as ocorrenciasDb from '../telemetria/ocorrencias.js';
import { gravarComFila, pendentes } from './telemetria-pendentes.js';
import { maskSecrets } from '../sensitive-text.js';
import { classify } from '../log-taxonomy.js';

const TETO_NO_BANCO = 5000;
const TETO_EM_MEMORIA = 200;
const LIMITE_DA_LEITURA = 200;
const ERRO_MAX = 500;

// O que aconteceu com a revisão, do ponto de vista da sessão do Claude.
const TIPOS = Object.freeze({
  nao_iniciada: 'A revisão não chegou a abrir a sessão do Claude',
  encerrada: 'A sessão do Claude foi encerrada antes do fim',
  interrompida: 'A sessão do Claude caiu e a revisão vai ser tentada de novo',
  sem_resultado: 'A revisão parou sem resultado',
});

// Por quê. Texto curto, que uma pessoa entende sem abrir o código.
const MOTIVOS = Object.freeze({
  pr_mergeado: 'o PR já tinha sido mergeado',
  pr_fechado: 'o PR tinha sido fechado sem merge',
  commit_novo: 'chegou commit novo no PR',
  ja_revisado: 'a revisão deste commit já existia',
  label_retirada: 'a label de revisão foi retirada do PR',
  pedido_retirado: 'o pedido de revisão à conta foi retirado',
  decisao_de_gente: 'uma pessoa já aprovou ou pediu mudanças neste commit',
  cancelada_por_voce: 'você cancelou a revisão',
  sessao_caiu: 'a sessão caiu por um problema passageiro',
  tentativas_esgotadas: 'a sessão caiu várias vezes e as tentativas automáticas acabaram',
  falha_permanente: 'a revisão falhou por um erro que não se resolve sozinho',
});

// De onde veio a revisão. `retentativa` é o relançamento depois de uma queda (review-retry.js),
// `lote` é o Revisar tudo, `clique` é o pedido do dono, `commit_novo` e `rodada_extra` são os
// rounds automáticos (gatilho-da-sessao.js), `fila` é o pedido de revisão à conta.
const ORIGENS = Object.freeze(['retentativa', 'lote', 'clique', 'commit_novo', 'rodada_extra', 'fila']);

function texto(v) { return typeof v === 'string' ? v : ''; }

function origemDe(pr) {
  if (!pr || typeof pr !== 'object') return 'fila';
  if (pr.automaticRetry) return 'retentativa';
  if (pr.lote) return 'lote';
  if (pr.manual) return 'clique';
  if (pr.rodadaAutomatica || pr.gatilho === 'commit_novo') return 'commit_novo';
  if (pr.gatilho === 'rodada_extra') return 'rodada_extra';
  return 'fila';
}

function textoDe(tipo, motivo) { return `${TIPOS[tipo]}: ${MOTIVOS[motivo]}.`; }

// Só os campos conhecidos do detalhe, sem segredo e com o texto do erro cortado.
function detalheSaneado(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  if (texto(d.classe)) out.classe = texto(d.classe).slice(0, 80);
  if (texto(d.erro)) out.erro = maskSecrets(texto(d.erro)).slice(0, ERRO_MAX);
  if (typeof d.retentativa === 'boolean') out.retentativa = d.retentativa;
  return out;
}

function montar({ pr, ref, sessao, tipo, motivo, detalhe, etapa }) {
  const registro = {
    at: Date.now(), ref: texto(ref) || texto(pr?.key), sessao: texto(sessao), tipo, motivo,
    texto: textoDe(tipo, motivo), origem: origemDe(pr),
  };
  const head = texto(pr?.headLido) || texto(pr?.knownHead);
  if (head) registro.head = head;
  const qual = texto(etapa) || texto(detalhe?.etapa);
  if (qual) registro.etapa = qual.slice(0, 40);
  return Object.assign(registro, detalheSaneado(detalhe));
}

function emMemoria(engine) {
  if (!Array.isArray(engine.ocorrenciasEmMemoria)) engine.ocorrenciasEmMemoria = [];
  return engine.ocorrenciasEmMemoria;
}

function linhaDoLog(r) {
  const sessao = r.sessao ? `, sessão ${r.sessao}` : '';
  return `revisão de ${r.ref || '(sem PR)'} terminou sem publicar: ${r.texto} (origem: ${r.origem}${sessao})`;
}

function registrarOcorrencia(engine, dados) {
  try {
    if (!engine || !dados || !TIPOS[dados.tipo] || !MOTIVOS[dados.motivo]) return null;
    const registro = montar(dados);
    if (engine.telemetria) {
      gravarComFila(engine, 'ocorrencias', registro, (r) => ocorrenciasDb.inserirOcorrencia(engine.telemetria, r, TETO_NO_BANCO));
    } else {
      const lista = emMemoria(engine);
      lista.push(registro);
      if (lista.length > TETO_EM_MEMORIA) lista.splice(0, lista.length - TETO_EM_MEMORIA);
    }
    if (typeof engine.log === 'function') engine.log('INFO', linhaDoLog(registro));
    return registro;
  } catch {
    return null; // registro opcional nunca derruba a revisão
  }
}

// O estacionamento (review.js, estacionar) diz por que a revisão parou; aqui vira ocorrência.
// `falha` e `esgotado` levam a classe da falha e o texto do erro (saneado).
const DO_ESTACIONAMENTO = Object.freeze({
  cancelado: ['encerrada', 'cancelada_por_voce'],
  'label-retirada': ['encerrada', 'label_retirada'],
  esgotado: ['sem_resultado', 'tentativas_esgotadas'],
  falha: ['sem_resultado', 'falha_permanente'],
});

function registrarDoEstacionamento(engine, { key, motivo, tipo, sessionId, pr }) {
  const par = DO_ESTACIONAMENTO[tipo];
  if (!par) return null;
  const alvo = pr || engine?.retryAfterNet?.get?.(key)?.pr || null;
  const comErro = tipo === 'falha' || tipo === 'esgotado';
  const detalhe = comErro ? { classe: classify(texto(motivo)).id, erro: texto(motivo) } : null;
  return registrarOcorrencia(engine, { pr: alvo, ref: key, sessao: sessionId, tipo: par[0], motivo: par[1], detalhe });
}

// O que vai para GET /api/usage: só os campos do contrato (docs/CONSUMO-REVIEWS.md).
const CAMPOS_DA_TELA = ['at', 'ref', 'sessao', 'tipo', 'motivo', 'texto', 'origem', 'head', 'etapa', 'classe'];

function paraTela(r) {
  const out = {};
  for (const c of CAMPOS_DA_TELA) {
    const v = r[c];
    if ((typeof v === 'string' && v) || (c === 'at' && Number.isFinite(v))) out[c] = v;
  }
  return out;
}

function doBanco(engine, desde, ate) {
  try { return ocorrenciasDb.ocorrenciasEntre(engine.telemetria, desde, ate, TETO_NO_BANCO); } catch { return []; }
}

// As do período [desde, ate] (epoch em ms), as pendentes da fila junto das do banco (ou as da
// memória, sem banco), filtradas pelo repositório `dono/nome` exato (o filtro do consumo), da
// mais nova para a mais antiga, até 200.
function ocorrenciasDoPeriodo(engine, desde, ate, filtros = {}) {
  const repo = texto(filtros.repo);
  const memoria = Array.isArray(engine?.ocorrenciasEmMemoria) ? engine.ocorrenciasEmMemoria : [];
  const todas = engine?.telemetria ? [...pendentes(engine, 'ocorrencias'), ...doBanco(engine, desde, ate)] : [...memoria];
  return todas
    .filter((r) => r && Number.isFinite(r.at) && r.at >= desde && r.at <= ate)
    .filter((r) => !repo || repo === 'all' || texto(r.ref).split('#')[0] === repo)
    .sort((a, b) => b.at - a.at)
    .slice(0, LIMITE_DA_LEITURA)
    .map(paraTela);
}

const ocorrenciasMod = { TIPOS, MOTIVOS, ORIGENS, origemDe, registrarOcorrencia, registrarDoEstacionamento, ocorrenciasDoPeriodo };
export default ocorrenciasMod;
export { TIPOS, MOTIVOS, ORIGENS, origemDe, registrarOcorrencia, registrarDoEstacionamento, ocorrenciasDoPeriodo };
