// O sync por herança sem nenhum arquivo a ler (24/11/2026, desenho docs/superpowers/specs/
// 2026-11-24-sync-por-heranca-design.md, seção 4): quando todo arquivo do diff é herdado (idêntico
// à ponta da origem, sem mudança própria da base, sem dependência do que o sync mudou e sem
// bloqueio aberto; sync-por-heranca.js), não há o que a sessão revise. O motor aprova sem sessão,
// no mesmo ponto e pela mesma boca de postagem do diff vazio de linhagem (`aprovarSemSessao`).
//
// Valem as mesmas condições daquele caminho: a política da conta que aprova sozinha,
// `reviewRoundsMode` diferente de `enforce`, a origem do dono, o PR da própria conta, a decisão de
// gente no head e a label de outra conta (encerram sem postar), o head que andou (`stale_head`), o
// dedup por head e todos os portões de `postReview`. A avaliação técnica roda antes, e qualquer
// achado dela fora dos herdados, ou a falha dela, abre a sessão. A publicação técnica aceita o
// APPROVE só pela prova que este módulo grava na memória (`syncPorHeranca`, com a marca de origem
// do motor, sem relatório e no mesmo commit do payload).
import diffVazio, { aprovarSemSessao } from './diff-vazio-de-linhagem.js';
import { ORIGEM_SYNC_POR_HERANCA } from '../technical-review/publication.js';
import { technicalRuntime } from '../technical-review/runtime.js';
import { ehDeOrganizacao, pendentesQueBloqueiam } from '../technical-review/verdict.js';
import { origemDoDono } from './desfecho-automatico.js';
import { ehMeu } from './pr-proprio.js';
import semMesa from './desfecho-sem-mesa.js';
import { conferirCancelamento } from './cancelamento-revisao.js';
import { impedimentoSemSessao, resultadoSemSessao } from './aprovacao-sem-sessao.js';
import { CAMINHO_SYNC_SEM_SESSAO } from './registro-do-sync.js';

const curto = (sha) => String(sha || '').slice(0, 7);

function textoDaAprovacao(sync, n) {
  const ponta = `à ponta da \`${sync.origem}\` (commit \`${curto(sync.foto)}\`)`;
  const arquivos = n === 1 ? `o único arquivo do diff é idêntico ${ponta}` : `os ${n} arquivos do diff são idênticos ${ponta}`;
  return `Este PR só leva para a base o que já foi revisado na origem: ${arquivos}, e a base não tinha mudança própria neles. Aprovo.`;
}

// PURA. A herança cobre o diff inteiro?
function candidato(heranca, arquivos) {
  if (!heranca?.ativa || !heranca.sync || !Array.isArray(heranca.changed) || heranca.changed.length) return false;
  if (!Array.isArray(arquivos) || !arquivos.length) return false;
  const herdado = new Set(heranca.sync.herdados);
  return arquivos.every((f) => f?.path && herdado.has(f.path));
}

// PURA. A avaliação técnica preparada não acha nada fora dos herdados? Sem declaração técnica não
// há o que avaliar; falha ou resultado ausente não deixa saber, e a sessão abre. Nunca mais frouxa
// que o caminho normal (technicalGap): regra reprovada sem achado associado e regra de julgamento
// pendente que bloquearia (a régua de pendentesQueBloqueiam), veredito que não é o aprovado e
// regras vazias também abrem a sessão.
function tecnicaSoNosHerdados(contexto, herdados) {
  if (contexto?.semDeclaracao === true) return true;
  const inicial = contexto?.initial;
  const achados = inicial?.findings;
  if (!contexto || contexto.error || inicial?.error || !Array.isArray(achados)) return false;
  const herdado = new Set(herdados);
  if (!achados.every((f) => typeof f?.file === 'string' && herdado.has(f.file))) return false;
  const regras = Array.isArray(inicial.rules) ? inicial.rules : [];
  // só o veredito aprovado, com regra que rodou: regras vazias são a aplicabilidade não comprovada
  if (inicial.verdict !== 'pass' || !regras.length) return false;
  if (pendentesQueBloqueiam({ rules: regras }).length) return false;
  return regras.filter((r) => r?.verdict === 'fail' && !ehDeOrganizacao(r.rule)).every((r) => achados.some((f) => f.rule === r.rule));
}

async function avaliacaoTecnicaLimpa(engine, pr, head, fontes, id, herdados) {
  let contexto;
  try {
    contexto = await technicalRuntime.prepareTechnicalReview(engine, pr, head, { sources: fontes, sessionId: id });
    return tecnicaSoNosHerdados(contexto, herdados);
  } catch {
    return false; // sem a avaliação, a sessão abre
  } finally {
    try { await technicalRuntime.cleanup(contexto); } catch { /* a revisão normal libera o que sobrar */ }
  }
}

function desfecho(sync, inventario, n) {
  const { headSha, baseSha } = inventario;
  return {
    headSha, baseSha, corpo: textoDaAprovacao(sync, n),
    inventarioDiff: { status: inventario.status, reason: inventario.reason || '', headSha, baseSha, changedFiles: inventario.changedFiles,
      additions: inventario.additions ?? null, deletions: inventario.deletions ?? null, files: inventario.files },
    extra: { caminho: CAMINHO_SYNC_SEM_SESSAO, herancaSync: { origem: sync.origem, foto: sync.foto, herdados: n, lidos: 0 } },
    relatorio: `Sync da ${sync.origem} (foto ${curto(sync.foto)}): ${n} arquivo(s) idênticos à origem, nenhum a ler; aprovado sem sessão.`,
    prova: { syncPorHeranca: { head: headSha, origem: ORIGEM_SYNC_POR_HERANCA } },
    toast: '',
  };
}

// Devolve true quando decidiu (a sessão do modelo não abre), false quando a revisão segue.
async function decidirSyncSemSessao(engine, { pr, id, headShaAtual, inventario, heranca, fontes }) {
  const arquivos = inventario?.status === 'complete' && inventario.headSha === headShaAtual ? inventario.files : null;
  if (!headShaAtual || !candidato(heranca, arquivos)) return false;
  if (engine.config?.reviewRoundsMode === 'enforce' || !origemDoDono(pr)) return false;
  // a política da conta para o parecer limpo é o destino desta regra; hoje ela só aprova
  if (engine.approvePolicyFor(engine.accountForPr(pr), true) !== 'approve') return false;
  if (!await avaliacaoTecnicaLimpa(engine, pr, headShaAtual, fontes, id, heranca.sync.herdados)) return false;
  conferirCancelamento(engine, id);
  const { sync } = heranca;
  const d = { ...desfecho(sync, inventario, arquivos.length), toast: `✅ ${pr.key} aprovado: só leva para a base o que já foi revisado na ${sync.origem}.` };
  if (ehMeu(engine, pr)) {
    const result = resultadoSemSessao(d, 'approve', {}, '');
    result.reasons = [{ text: 'o PR é da própria conta que revisa: não há o que decidir, nada foi publicado', kind: 'gate' }];
    engine.recordDecision(pr, result, { status: semMesa.STATUS_SEM_POSTAR, action: 'skip', ...d.extra });
    return true;
  }
  if (await impedimentoSemSessao(engine, pr, d)) return true;
  const item = await aprovarSemSessao(engine, pr, d, id);
  engine.log('INFO', `${pr.key}: sync da ${sync.origem} (foto ${curto(sync.foto)}): ${arquivos.length} arquivo(s) herdados, nenhum a ler; `
    + `desfecho ${item.status} sem sessão (caminho ${CAMINHO_SYNC_SEM_SESSAO}).`);
  return true;
}

// Os dois caminhos sem sessão, na ordem: o diff vazio de linhagem e o sync sem nada a ler.
async function decidirSemSessao(engine, ctx) {
  if (await diffVazio.decidirSemSessao(engine, ctx)) return true;
  return decidirSyncSemSessao(engine, ctx);
}

export { textoDaAprovacao, candidato, tecnicaSoNosHerdados, decidirSyncSemSessao, decidirSemSessao };
