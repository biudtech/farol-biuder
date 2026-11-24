// Registro local e durável de falha por sessão de IA (spec 7.A1, item 6). Mora na tabela
// `falhas` do telemetria.db (desde 16/11/2026; antes, e quando o banco não abre, em
// state/falhas-sessao.json), FORA do farol.log: o log é a fonte do Diagnóstico e o
// "Limpar log" o apaga inteiro, e até aqui ele era a única cópia do motivo de uma
// revisão que estacionou. Aqui o motivo fica inteiro (sem o corte de 300 caracteres
// da mensagem de erro), com teto próprio e máscara de segredo, ligado à linha do
// Consumo (sessionId e attemptId) e ao card estacionado (sessionId).
//
// `sessionId` é o id OPACO do Farol (lib/engine/sessao-id.js); o id da sessão do CLI,
// quando existe, vai em `cliSessionId`. Nunca lança: registrar falha não pode virar falha.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, ensureDir } from '../io.js';
import { classify, CLASSES, DESCONHECIDO } from '../log-taxonomy.js';
import { maskSecrets as mascararSegredos } from '../sensitive-text.js';
import * as falhasDb from '../telemetria/falhas.js';
import { gravarComFila } from './telemetria-pendentes.js';
import { registrarOcorrencia } from './ocorrencias-da-revisao.js';

const ARQUIVO = path.join(STATE_DIR, 'falhas-sessao.json');
// stderr de CLI e pilha cabem folgados; um dump de megabytes não
const MOTIVO_MAX = 8000;
const FALHAS_MAX = 500;
const LIMITE_PADRAO = 50;
const RESUMO_MOTIVO_MAX = 200;
// o corte que a MENSAGEM de erro sempre teve: taxonomia, toast e retry leem ela
const CORTE_MENSAGEM = 300;
// desfechos de retomada que a A5 produz
const RESUME_OUTCOMES = ['retomada', 'recusada', 'nova', 'nenhuma'];

function arquivoDeFalhas() { return ARQUIVO; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function texto(v) { return typeof v === 'string' ? v : ''; }

function avisar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

// Cópia em memória presa ao engine: o snapshot lê a cada push, e reler o disco a cada
// push seria IO sem motivo. Engine de teste sem o campo lê do disco uma vez.
// Com o banco da telemetria (engine.telemetria, 16/11/2026) a cópia nasce da tabela e cada
// registro é uma linha nova nela (lib/telemetria/falhas.js); sem ele, o arquivo como era.
function lista(engine) {
  if (engine && Array.isArray(engine.falhasSessao)) return engine.falhasSessao;
  const falhas = engine?.telemetria ? lerDoBanco(engine) : lerDoArquivo(engine);
  if (engine && typeof engine === 'object') engine.falhasSessao = falhas;
  return falhas;
}

function lerDoArquivo(engine) {
  const bruto = readJson(ARQUIVO, null, (m) => avisar(engine, m));
  return objeto(bruto) && Array.isArray(bruto.falhas) ? bruto.falhas.filter(objeto) : [];
}

function lerDoBanco(engine) {
  try { return falhasDb.todasAsFalhas(engine.telemetria); } catch (err) { avisar(engine, `telemetria: ler as falhas no telemetria.db falhou (${err.message})`); return []; }
}

// No banco, a falha que não entra fica na fila de pendentes (lib/engine/telemetria-pendentes.js)
// e entra na próxima gravação; a lista em memória já a mostra.
function gravar(engine, falhas, registro, substitui) {
  if (engine?.telemetria) {
    return gravarComFila(engine, 'falhas', { registro, substitui },
      (i) => falhasDb.gravarFalha(engine.telemetria, i.registro, FALHAS_MAX, i.substitui));
  }
  try {
    ensureDir(STATE_DIR);
    writeJsonAtomic(ARQUIVO, { falhas });
    return true;
  } catch (err) {
    avisar(engine, `gravar falhas-sessao.json: ${err.message}`);
    return false;
  }
}

function etapaValida(s) {
  return { id: texto(s.id), label: texto(s.label), ms: Number(s.ms) || 0 };
}

function etapasValidas(etapas) {
  if (!objeto(etapas) || !Array.isArray(etapas.stages)) return null;
  return { totalMs: Number(etapas.totalMs) || 0, stages: etapas.stages.filter(objeto).map(etapaValida) };
}

// Erro de sessão com a mensagem de sempre (cortada) e o texto inteiro em
// `detalheCompleto`, que só o registro durável lê.
function erroDeSessao(prefixo, detalhe) {
  const bruto = String(detalhe === undefined || detalhe === null ? '' : detalhe);
  const err = new Error(`${prefixo}${bruto.slice(0, CORTE_MENSAGEM)}`);
  err.detalheCompleto = `${prefixo}${bruto}`;
  return err;
}

function detalheDaFalha(err) {
  if (!err) return '';
  return String(err.detalheCompleto || err.message || '');
}

// Quem conhece a sessão (runHeadlessReview) anota antes do finally
// apagar o feed; quem registra (runOneHeadless) está fora dela.
function anotarFalhaDaSessao(err, sessionId, etapas) {
  if (!err || typeof err !== 'object') return err;
  if (!err.sessaoFarol && sessionId) err.sessaoFarol = sessionId;
  if (!err.etapas && etapas) err.etapas = etapas;
  return err;
}

// PURA: os ids das sessões de uma série de tentativas da revisão (as guardadas na entrada do
// retry e a nova), sem repetir nem vazio, até 20.
function sessoesDaSerie(entrada, nova) {
  const antes = entrada && Array.isArray(entrada.sessoes) ? entrada.sessoes : [];
  return [...new Set([...antes, nova].filter((id) => typeof id === 'string' && id))].slice(-20);
}

// A revisão que terminou sem resultado: toda linha `ok` das sessões dela vira `erro`.
function marcarSemResultado(engine, ids) {
  for (const id of ids || []) marcarErroNoConsumo(engine, id, 'ok');
}

// Registro durável da falha de uma sessão headless da revisão (A1, item 6), montado do erro que
// subiu da sessão. Mora aqui para o catch do runOneHeadless (lib/engine/review.js) não somar
// profundidade nem tamanho.
// A queda passageira (a que vai ao retry, até o teto de tentativas) também vira ocorrência da
// revisão (ocorrencias-da-revisao.js, 24/11/2026). A permanente não: quem a registra é o
// estacionamento, uma vez, com a classe.
// `vaiTentar`: a queda passageira vai mesmo ao retry (o runOneHeadless decide pelo teto de
// tentativas). Só então ela vira ocorrência `interrompida`; a que esgota as tentativas fica com o
// `sem_resultado` do estacionamento, sem uma linha dizendo que vai tentar de novo.
function registrarFalhaDaRevisao(engine, pr, err, kind, vaiTentar = false) {
  const classe = classify(err.message || '');
  if (vaiTentar && kind === 'review' && (classe.kind === 'transitorio' || classe.kind === 'espera-reset')) {
    const etapas = err.etapas?.stages;
    registrarOcorrencia(engine, { pr, sessao: err.sessaoFarol || '', tipo: 'interrompida', motivo: 'sessao_caiu',
      etapa: Array.isArray(etapas) && etapas.length ? etapas.at(-1).id : '', detalhe: { classe: classe.id, retentativa: true, erro: detalheDaFalha(err) } });
  }
  return registrarFalha(engine, {
    sessionId: err.sessaoFarol || '', attemptId: err.attemptId || '', cliSessionId: err.sessionId || '',
    kind, account: engine.accountForPr(pr) || '', ref: pr.key,
    motivo: detalheDaFalha(err), classe: classify(err.message || '').id,
    etapas: err.etapas || null, resumeOutcome: err.resumeOutcome,
  });
}

// `seEra`: só troca a linha que está nesse desfecho (null troca qualquer uma).
function marcarErroNoConsumo(engine, id, seEra = null) {
  if (!id || !engine || typeof engine.marcarDesfecho !== 'function') return false;
  return seEra ? engine.marcarDesfecho(id, 'erro', seEra) : engine.marcarDesfecho(id, 'erro');
}

function montarRegistro(d) {
  const bruto = String(d.motivo || '');
  const mascarado = mascararSegredos(bruto);
  const registro = {
    id: randomUUID(), at: Date.now(),
    sessionId: texto(d.sessionId), attemptId: texto(d.attemptId), cliSessionId: texto(d.cliSessionId),
    kind: texto(d.kind) || 'outro', account: texto(d.account).toLowerCase(), ref: texto(d.ref),
    motivo: mascarado.slice(0, MOTIVO_MAX),
    motivoTruncado: mascarado.length > MOTIVO_MAX,
    classe: texto(d.classe) || classify(bruto).id,
    etapas: etapasValidas(d.etapas),
  };
  if (RESUME_OUTCOMES.includes(d.resumeOutcome)) registro.resumeOutcome = d.resumeOutcome;
  return registro;
}

/* Falha que se resolve sozinha volta a cada ciclo enquanto a condição durar, e até aqui
   cada tentativa virava um registro novo: em 17/09/2026 o mesmo limite semanal do plano
   escreveu um cartão por minuto no mesmo PR, todos com a mesma mensagem. Repetição
   IDÊNTICA não é informação nova, é contagem: ela atualiza o registro que já existe (mesma
   espécie, mesma conta, mesma referência, mesmo motivo), que sobe para o fim da lista com a
   data da última vez e guarda desde quando repete. Vale só para o que repete por
   construção; falha permanente e operacional continuam uma linha por acontecimento, porque
   cada uma tem sessão própria para investigar e o card estacionado aponta pra ela. */
const KINDS_QUE_REPETEM = ['espera-reset', 'transitorio'];

function repetitiva(classeId) {
  const c = [...CLASSES, DESCONHECIDO].find((x) => x.id === classeId);
  return !!c && KINDS_QUE_REPETEM.includes(c.kind);
}

function mesmaFalha(a, b) {
  return a.kind === b.kind && a.classe === b.classe && a.ref === b.ref
    && a.account === b.account && a.motivo === b.motivo;
}

// Funde a repetição no registro anterior: mantém o id (o cartão da tela e o botão de
// copiar não trocam de identidade no meio de uma espera) e a data da PRIMEIRA vez.
function fundirRepeticao(falhas, registro) {
  if (!repetitiva(registro.classe)) return registro;
  const i = falhas.findIndex((f) => mesmaFalha(f, registro));
  if (i < 0) return registro;
  const anterior = falhas.splice(i, 1)[0];
  registro.id = String(anterior.id || registro.id);
  registro.primeiraAt = Number(anterior.primeiraAt) || Number(anterior.at) || registro.at;
  registro.ocorrencias = (Number(anterior.ocorrencias) || 1) + 1;
  return registro;
}

function registrarFalha(engine, dados) {
  try {
    const registro = montarRegistro(objeto(dados) ? dados : {});
    const falhas = lista(engine);
    const idNovo = registro.id;
    falhas.push(fundirRepeticao(falhas, registro));
    if (falhas.length > FALHAS_MAX) falhas.splice(0, falhas.length - FALHAS_MAX);
    gravar(engine, falhas, registro, registro.id !== idNovo);
    return registro;
  } catch (err) {
    avisar(engine, `registrar falha de sessão: ${err && err.message}`);
    return null;
  }
}

/* A fusao de repeticao acontecia so na ESCRITA (fundirRepeticao), entao registro anterior
   a ela continuava uma linha por acontecimento para sempre: em 23/09/2026 o Diagnostico
   desta máquina mostrava 19 cartoes, 15 deles o MESMO limite de plano no MESMO PR, um por
   tentativa entre 17:12 e 18:02. Quem LE funde pela mesma regra (mesmaFalha e repetitiva,
   uma fonte so para "isto e repeticao"), e o historico antigo colapsa sem tocar no disco.
   Guarda a data da PRIMEIRA e fala da ULTIMA, igual ao lado da escrita. */
function fundirParaLeitura(registros) {
  const saida = [];
  for (const f of registros) {
    const i = repetitiva(f.classe) ? saida.findIndex((x) => mesmaFalha(x, f)) : -1;
    if (i < 0) { saida.push({ ...f }); continue; }
    const anterior = saida.splice(i, 1)[0];
    saida.push({
      ...f,
      id: String(anterior.id || f.id),
      primeiraAt: Number(anterior.primeiraAt) || Number(anterior.at) || Number(f.at) || 0,
      ocorrencias: (Number(anterior.ocorrencias) || 1) + (Number(f.ocorrencias) || 1),
    });
  }
  return saida;
}

// O limite conta LINHAS da tela, e nao registros crus: pedir 20 e receber 20 copias da
// mesma noticia era o mesmo defeito por outro caminho.
function falhasRecentes(engine, opcoes) {
  const pedido = Number(opcoes && opcoes.limite);
  const limite = pedido > 0 ? Math.min(pedido, FALHAS_MAX) : LIMITE_PADRAO;
  return fundirParaLeitura(lista(engine)).slice(-limite).reverse();
}

function falhaDaSessao(engine, sessionId) {
  const id = texto(sessionId);
  if (!id) return null;
  return [...lista(engine)].reverse().find((f) => f.sessionId === id) || null;
}

// Resumo curto para o snapshot da aba Consumo: só das sessões que a tela mostra.
function falhasPorSessao(engine, ids) {
  const alvo = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
  const out = {};
  if (!alvo.size) return out;
  for (const f of lista(engine)) {
    if (alvo.has(f.sessionId)) out[f.sessionId] = { at: f.at, classe: f.classe, motivo: String(f.motivo || '').slice(0, RESUMO_MOTIVO_MAX) };
  }
  return out;
}

const falhasMod = {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, marcarSemResultado, sessoesDaSerie, registrarFalha, registrarFalhaDaRevisao, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
export default falhasMod;
export {
  arquivoDeFalhas, mascararSegredos, erroDeSessao, detalheDaFalha, anotarFalhaDaSessao,
  marcarErroNoConsumo, marcarSemResultado, sessoesDaSerie, registrarFalha, registrarFalhaDaRevisao, falhasRecentes, falhaDaSessao, falhasPorSessao,
};
