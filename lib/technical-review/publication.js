import { profileFor, cadastroIlegivel } from './profiles.js';
import { TOOL, technicalGap, requiredEvidenceGap, legacyEvidenceGap, ehLacunaDura, relatorioComViolacao } from './verdict.js';
import { publicationEvidence } from './registry.js';
import { technicalRuntime } from './runtime.js';
import { requestRecheck } from './recheck.js';
import { objecoesMudaram } from './reviews.js';

// Os checks obrigatórios não fazem parte da publicação: o revisor nunca espera o CI (regra do
// dono de 17/11/2026). O APPROVE não lê nem espera o CI; o merge continua barrado pelo GitHub
// quando o check é obrigatório no ruleset.

// Repositório sem declaração técnica (17/10/2026): não há avaliação a reconfirmar, então a
// recusa por isso saiu. Continua exigindo o commit confirmado e a prova gravada sem lacuna.
async function semDeclaracaoRefusal(engine, pr, proof, payload) {
  let gap = requiredEvidenceGap(proof.evidence);
  if (!gap && !payload.commit_id) gap = 'aprovação sem commit confirmado';
  return gap ? { ok: false, blocked: 'technical_review', attempted: false, error: gap, needsReview: false } : null;
}

const SHA = /^[a-f0-9]{40}$/;
// A marca de origem da prova do diff vazio (lib/engine/diff-vazio-de-linhagem.js): um Symbol não
// sobrevive a JSON, então nem a pendência gravada nem a saída de um modelo a trazem.
const ORIGEM_DIFF_VAZIO = Symbol('diff-vazio-de-linhagem');
const provaDoDiffVazio = (proof, payload) => proof.report === null && proof.diffVazio?.origem === ORIGEM_DIFF_VAZIO
  && SHA.test(payload.commit_id || '') && proof.diffVazio.head === payload.commit_id;
// O sync por herança sem nenhum arquivo a ler (lib/engine/sync-sem-sessao.js, 24/11/2026): a mesma
// régua, com a marca de origem própria.
const ORIGEM_SYNC_POR_HERANCA = Symbol('sync-por-heranca');
const provaDoSyncPorHeranca = (proof, payload) => proof.report === null && proof.syncPorHeranca?.origem === ORIGEM_SYNC_POR_HERANCA
  && SHA.test(payload.commit_id || '') && proof.syncPorHeranca.head === payload.commit_id;

// O que a revisão leu ainda vale? Base e objeções, conferidas pelo que dá para conferir.
// - base: quando o relatório gravou a base (a avaliação chegou a preparar o material), ela tem
//   de ser a base atual do PR no commit aprovado; sem base gravada não há com o que comparar,
//   e a âncora fica sendo o commit (commit_id), como no repositório sem declaração;
// - objeções: com a impressão do histórico gravada no relatório, ela tem de bater com o
//   histórico atual. Sem ela (repositório sem declaração, ou avaliação que falhou antes de ler
//   o histórico) não há com o que comparar, e nada é inventado: desde 18/10/2026 (a decisão
//   sem mesa) o pedido de mudanças de uma pessoa não segura a aprovação que a conta mandou
//   sair, então ele também não serve de substituto da impressão.
async function contextoMudou(engine, pr, report, head) {
  if (SHA.test(report.base || '')) {
    const target = await technicalRuntime.targetFor(engine, pr, head);
    if (target.base !== report.base) return { gap: 'a base mudou depois da avaliação técnica', needsReview: true };
  }
  if (report.humanReviewFingerprint) {
    const objections = await technicalRuntime.reviewSnapshot(engine, pr);
    return objecoesMudaram(report, objections) ? { gap: 'histórico de objeções mudou depois da revisão', needsReview: true } : null;
  }
  return null;
}

// Prova esgotada (17/10/2026, v2.72.6; de novo pela decisão do dono de 18/10/2026, que supera
// o PR #250) e repositório sem declaração técnica: desde 06/11/2026 já na primeira rodada
// do commit, a lacuna técnica que não é dura é ressalva. Vale o mesmo do repositório sem declaração (commit,
// prova sem lacuna exigida e checks verdes neste commit) e, além disso, o contexto que a revisão
// leu não pode ter mudado (contextoMudou). Revisão do PR #248: sem isto a aprovação saía por
// cima de base nova ou objeção nova.
async function provaEsgotadaRefusal(engine, pr, proof, payload) {
  const basica = await semDeclaracaoRefusal(engine, pr, proof, payload);
  if (basica) return basica;
  let mudou;
  try { mudou = await contextoMudou(engine, pr, proof.report || {}, payload.commit_id); }
  catch { mudou = { gap: 'não foi possível reconfirmar a base e as objeções da revisão', needsReview: false }; }
  if (!mudou) return null;
  if (mudou.needsReview) requestRecheck(engine, pr);
  return { ok: false, blocked: 'technical_review', attempted: false, error: mudou.gap, needsReview: mudou.needsReview };
}

// A lacuna que a própria rodada dispensou, e só ela, vira ressalva na publicação (06/11/2026).
// Com `provaEsgotada` em toda rodada, o desvio para provaEsgotadaRefusal valia para qualquer
// lacuna não dura: rodada no head H, o dono troca a declaração técnica ou o Farol atualiza a
// ferramenta, e o APPROVE saía com a avaliação da regra antiga. A prova só vale enquanto o perfil,
// o commit e a versão da ferramenta forem os de agora; o relatório da falha de execução os grava
// desde a segunda revisão independente (runtime.js, identidadeDaFalha), e o gravado antes, sem
// eles, também pede revisão nova (needsReview), nunca ressalva.
const FERRAMENTA_TROCADA = new Set(['avaliação técnica atual ausente', 'identidade da avaliação técnica inválida']);
function dispensadaPelaRodada(gap, report, profile) {
  if (ehLacunaDura(gap) || relatorioComViolacao(report) || FERRAMENTA_TROCADA.has(gap)) return false;
  if (!report || !profile || report.profile !== profile.fingerprint) return false;
  return report.toolCommit === TOOL.commit && report.version === TOOL.version;
}

async function approvalRefusal(engine, pr, payload) {
  if (payload.event !== 'APPROVE') return null;
  const repo = pr.repo || String(pr.key || '').split('#')[0];
  const proof = publicationEvidence(engine, pr);
  // diff vazio que só alinha a história (lib/engine/diff-vazio-de-linhagem.js): não há código a
  // avaliar. Vale só a prova que o motor gravou na memória, com a marca de origem dele, sem relatório
  // de modelo e no mesmo commit do payload.
  if (provaDoDiffVazio(proof, payload) || provaDoSyncPorHeranca(proof, payload)) return null;
  const profile = profileFor(repo);
  // prova gravada por regras anteriores: o engine precisa recalcular, nunca vale como ressalva
  const legado = legacyEvidenceGap(proof);
  if (legado) {
    requestRecheck(engine, pr);
    return { ok: false, blocked: 'technical_review', attempted: false, error: legado, needsReview: true };
  }
  // sem declaração técnica (decisão do dono de 18/10/2026): ressalva, com commit, prova sem
  // lacuna exigida e o contexto da revisão ainda valendo
  if (!profile && !cadastroIlegivel()) return provaEsgotadaRefusal(engine, pr, proof, payload);
  let gap = !profile && 'declaração técnica do repositório ausente';
  if (!gap) gap = technicalGap(proof.report, { repo, head: payload.commit_id, profile: profile.fingerprint });
  if (gap && proof.provaEsgotada === true && dispensadaPelaRodada(gap, proof.report, profile)) return provaEsgotadaRefusal(engine, pr, proof, payload);
  if (!gap) gap = requiredEvidenceGap(proof.evidence);
  if (!gap && !payload.commit_id) gap = 'aprovação sem commit confirmado';
  if (!gap) {
    try {
      await technicalRuntime.requireTool();
      const target = await technicalRuntime.targetFor(engine, pr, proof.report.head);
      if (target.base !== proof.report.base) gap = 'a base mudou depois da avaliação técnica';
      const objections = await technicalRuntime.reviewSnapshot(engine, pr);
      if (!proof.report.humanReviewFingerprint || objecoesMudaram(proof.report, objections)) gap = 'histórico de objeções mudou depois da revisão';
    } catch { gap = 'não foi possível reconfirmar a avaliação técnica'; }
  }
  if (!gap) return null;
  // Falta de prova pede uma nova análise.
  requestRecheck(engine, pr);
  return { ok: false, blocked: 'technical_review', attempted: false, error: gap, needsReview: true };
}

export { approvalRefusal, ORIGEM_DIFF_VAZIO, ORIGEM_SYNC_POR_HERANCA };
export const technicalPublication = { approvalRefusal };
