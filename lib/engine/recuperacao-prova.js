// Agenda durável da recuperação: duas rodadas rápidas, depois recuo até seis horas.
// O teto limita a frequência, nunca dispensa prova nem transfere uma decisão impossível.
import { MAX_TENTATIVAS } from './busca-da-prova.js';
import { classify } from '../log-taxonomy.js';
import { profileFor } from '../technical-review/profiles.js';
import { VERSAO_DA_CONFERENCIA } from '../technical-review/declaracao.js';
import { technicalRuntime } from '../technical-review/runtime.js';
import { politicaDeInicio } from './review-scope.js';

const MINUTO = 60_000;
const MAX_INTERVALO = 6 * 60 * MINUTO;
const VERSAO_DA_RECUPERACAO = 2;

function intervaloDaProva(tentativas, interrupcoes = 0) {
  const recuos = Math.max(0, tentativas - MAX_TENTATIVAS, interrupcoes);
  return recuos ? Math.min(MAX_INTERVALO, 15 * MINUTO * 2 ** Math.min(recuos - 1, 5)) : 0;
}

const AUTOMACAO_DESLIGADA = 'Revisão automática desativada para este PR (na conta, na organização ou no autor). Retomo quando ela for ativada.';

// Nenhuma pausa pede pessoa desde 17/11/2026 (o revisor nunca espera decisão de gente). Antes, a
// pausa que só uma pessoa desfazia era "precisa de você" (06/11/2026). Agora: a automação desligada
// para o PR, o cancelamento e a label retirada encerram a pendência sem postar; as outras pausas
// (login, ferramenta, declaração) seguem sozinhas quando o ambiente volta e, depois de
// TETO_DA_PAUSA_MS, vão ao desfecho sem mesa (espera-prova.js). A pausa pelo CI também saiu.
function pedePessoa() {
  return false;
}
const TETO_DA_PAUSA_MS = 24 * 60 * MINUTO;
const CANCELADA = 'Revisão cancelada por você. A recuperação só continua se você iniciar outra revisão.';
const LABEL_RETIRADA = 'A label de revisão foi retirada do PR. A recuperação só continua com commit novo, novo pedido ou clique.';
// As pausas que encerram a pendência sem postar: ninguém mais vai mover esta recuperação.
const PAUSAS_QUE_ENCERRAM = new Set([AUTOMACAO_DESLIGADA, CANCELADA, LABEL_RETIRADA]);

async function pausaDaRecuperacao(engine, item) {
  const pr = { ...item.pr, key: item.key };
  const conta = engine.accountForPr(pr);
  // a mesma decisão do início (conta, organização e autor): Manual segura, Automático relança
  if (!politicaDeInicio(engine, pr).automatic) return AUTOMACAO_DESLIGADA;
  if (!engine.tokenFor(conta)) return 'Login do GitHub indisponível. Retomo após restabelecer o login.';
  if (item.technicalReview?.failure === 'profile' && !profileFor(item.pr?.repo || item.key.split('#')[0])) {
    return 'Configuração dos critérios técnicos do repositório ausente ou ilegível. Retomo após corrigir essa configuração; aprovar manualmente não resolve.';
  }
  // Declaração que cita pasta inexistente: refazer a busca daria o mesmo erro. Retoma quando a
  // declaração do repositório mudar (impressão diferente da que falhou).
  // só pausa pela falha da conferência atual; falha gravada por versão anterior volta a ser conferida
  if (item.technicalReview?.failure === 'declaration' && item.technicalReview.declarationProfile
    && item.technicalReview.declarationCheck === VERSAO_DA_CONFERENCIA
    && profileFor(item.pr?.repo || item.key.split('#')[0])?.fingerprint === item.technicalReview.declarationProfile) {
    return 'A declaração técnica do repositório cita pasta que não existe mais no código. Retomo quando ela for corrigida nesta máquina; aprovar manualmente não resolve.';
  }
  if (item.technicalReview?.failure === 'tool') {
    try { await technicalRuntime.requireTool(); }
    catch { return 'Ferramenta de verificação técnica indisponível. Retomo após restabelecer a ferramenta nesta máquina; aprovar manualmente não resolve.'; }
  }
  if (!engine.autoReviewParked?.has(item.key)) return '';
  const parada = engine.parkedMotivos?.[item.key];
  if (parada?.tipo === 'cancelado') return CANCELADA;
  // quem tirou a label pediu para parar: o mesmo head sem sinal novo não relança (desenho A2)
  if (parada?.tipo === 'label-retirada') return LABEL_RETIRADA;
  const classe = classify(parada?.motivo || '');
  if (classe.kind === 'permanente') return `${classe.label}. ${classe.acao}`;
  return '';
}

function rodadaEmCurso(engine, key) {
  return (engine.headlessQueue || []).some(p => p.key === key)
    || [...(engine.activeReviews || new Map()).values()].some(s => (s.keys || []).includes(key))
    || engine.retryAfterNet?.has(key);
}

// A marca carrega `pedeVoce` (sempre falso desde 17/11/2026) para a tela e a projeção lerem o
// mesmo fato, e `pausadaDesde`, que conta o teto da pausa.
function marcarPausa(marca, impedimento) {
  if ((marca.impedimento || '') !== (impedimento || '')) marca.pausadaDesde = impedimento ? Date.now() : undefined;
  if (!impedimento) delete marca.pausadaDesde;
  marca.impedimento = impedimento;
  marca.pedeVoce = pedePessoa(impedimento);
  delete marca.avisada;
}

// Nada a avisar: nenhuma pausa pede alguém (17/11/2026). Fica pela assinatura de quem chama.
function avisarPausa() { }

// A pausa já está anotada quando o texto E o `pedeVoce` batem. Só o texto não basta: a marca
// gravada antes de 17/11/2026 pode trazer `pedeVoce: true`, que precisa cair para falso.
function pausaAnotada(marca, impedimento) {
  return (marca.impedimento || '') === (impedimento || '') && (marca.pedeVoce === true) === pedePessoa(impedimento);
}

function registrarPausa(engine, item, impedimento) {
  if (pausaAnotada(item.esperaProva, impedimento)) return;
  marcarPausa(item.esperaProva, impedimento);
  engine.saveDecisions();
}

function prepararRecuperacaoDaPublicacao(result, autoDec, post) {
  result.technicalRecheck = post.needsReview === true;
  if (post.blocked === 'technical_review') {
    autoDec.motivo = 'prova_tecnica_incompleta';
    result.approvalEvidence = [...(result.approvalEvidence || []), post.error];
  }
  return post.blocked !== 'technical_review';
}

function reagendarInterrupcao(engine, item) {
  const marca = item.esperaProva;
  marca.interrupcoes = (Number(marca.interrupcoes) || 0) + 1;
  marca.proximaEm = Date.now() + intervaloDaProva(Number(marca.tentativas) || 0, marca.interrupcoes);
  delete item.blockedKind;
  delete item.blockedHead;
  item.reasons = [{ text: 'A execução anterior não concluiu. O Farol retomará a análise automaticamente após o intervalo de recuperação; nada foi publicado.', kind: 'gate', espera: true },
    ...(item.reasons || []).filter(r => !r?.espera)];
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: recuperação da prova reagendada após execução interrompida.`);
  return 1;
}

export { TETO_DA_PAUSA_MS, PAUSAS_QUE_ENCERRAM, AUTOMACAO_DESLIGADA, VERSAO_DA_RECUPERACAO, intervaloDaProva, pausaDaRecuperacao, rodadaEmCurso, pedePessoa, pausaAnotada, marcarPausa, avisarPausa, registrarPausa, reagendarInterrupcao, prepararRecuperacaoDaPublicacao };
