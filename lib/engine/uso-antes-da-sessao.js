// O uso do plano conferido ANTES da sessão automática abrir (pedido do dono de 21/11/2026).
//
// O registro do limite (limite-plano.js) só conhecia o limite depois que uma sessão batia nele:
// o primeiro PR depois que a cota acabava abria sessão, punha a label <conta>:revisando no PR e
// morria segundos depois. Aqui o motor lê o `/usage` da assinatura que a sessão vai usar
// (uso-do-plano.js, sem custo, cerca de dois segundos) e, com uma janela que barra o modelo da
// revisão em 100%, registra o limite até o reset dessa janela pelo mesmo registrarLimite. Daí em
// diante tudo segue o caminho de hoje: a troca de perfil (escolherPerfil), a espera da fila e o
// PR que volta sem sessão, sem label e sem gastar tentativa.
//
// QUAL JANELA TRAVA. O `/usage` mostra a janela da sessão (as cinco horas), a da semana com
// todos os modelos e, às vezes, a da semana de um modelo só ("Current week (Fable)"). As duas
// primeiras valem para qualquer modelo: em 100%, nenhuma sessão abre. A de um modelo só barra
// aquele modelo: com ela cheia, outro modelo ainda responde. Por isso ela só trava quando TODO
// modelo que a revisão pode usar é dessa família (modelosDaRevisao: o fixo da configuração, ou
// os do modo Auto, que hoje é sempre o Opus). Modelo que o motor não sabe a família (o padrão
// da assinatura, o "best") nunca é travado por janela de um modelo só.
//
// O QUE NUNCA TRAVA. Leitura que falha, que passou do prazo, sem janela, de login vencido, a
// leitura antiga mantida na tela como desatualizada, ou janela cheia sem hora de reset legível:
// a revisão segue como antes. A leitura existe para poupar a sessão que morreria, e nunca pode
// virar motivo de parar a revisão. O clique manual nem chega aqui (review.js).
//
// CUSTO NA HOSPEDAGEM. Cada leitura abre um processo do Claude CLI. A leitura guardada vale por
// CLAUDE_USO_ANTES_MS (dois minutos) e é a mesma que a tela usa; lerUso faz uma leitura de cada
// vez na máquina inteira e devolve a que já está em curso. A fila espera a leitura nova no máximo
// CLAUDE_USO_ANTES_PRAZO_MS e segue sem ela (a leitura termina sozinha e fica guardada).
import { TEMPOS } from '../constants.js';
import { autoNaFaixa, familiaDe, SELECOES_CLAUDE, AUTO_POR_FAIXA } from '../modelos.js';
import { isAutoModel } from './model-router.js';
import { lerUso, leituraGuardada } from './uso-do-plano.js';
import { chaveDaAssinatura, horaCurta, limiteAte, registrarLimite, registroDaAssinatura } from './limite-plano.js';

// --- PURO ---------------------------------------------------------------------------------

/** Os modelos que a revisão pode usar com esta configuração, antes de medir o PR. */
function modelosDaRevisao(config = {}) {
  if (!isAutoModel(config.reviewModel)) return [String(config.reviewModel || '').trim().toLowerCase()];
  const faixas = [...Object.keys(AUTO_POR_FAIXA), 'contexto'];
  return [...new Set(faixas.map((f) => autoNaFaixa(f, config)?.model ?? ''))];
}

// A família de que fala uma janela de um modelo só ("semana:fable"), ou '' quando o escopo não é
// de família conhecida.
function familiaDaJanela(janela) {
  const escopo = String(janela?.id || '').split(':')[1] || '';
  if (!escopo) return '';
  const s = SELECOES_CLAUDE.find((x) => x.familia && x.familia.test(escopo));
  return s ? s.nome : '';
}

/** A janela vale para a revisão? A geral sempre; a de um modelo só, quando todo modelo possível é dele. */
function janelaSeAplica(janela, modelos) {
  const id = String(janela?.id || '');
  if (id === 'sessao' || id === 'semana') return true;
  const familia = familiaDaJanela(janela);
  const lista = Array.isArray(modelos) ? modelos : [];
  return !!familia && lista.length > 0 && lista.every((m) => familiaDe(m)?.nome === familia);
}

/**
 * A janela que trava a revisão nesta leitura, ou null. Só leitura nova e completa trava; das
 * janelas cheias que se aplicam, vale a de reset mais tarde (antes dele a sessão ainda morre).
 */
function janelaQueTrava(leitura, modelos, agora = Date.now()) {
  if (!leitura || !leitura.ok || leitura.desatualizado) return null;
  let trava = null;
  for (const j of leitura.janelas || []) {
    if (!(Number(j?.usado) >= 1) || !(Number(j.reset) > agora) || !janelaSeAplica(j, modelos)) continue;
    if (!trava || j.reset > trava.reset) trava = j;
  }
  return trava;
}

// --- IO ------------------------------------------------------------------------------------

// A leitura guardada, se nova o bastante; senão a leitura de agora, esperada até o prazo. null
// quando não veio a tempo. A tentativa que falhou também fica guardada com a hora dela (a falha
// não trava, janelaQueTrava): com o CLI quebrado, a fila não abre um processo por PR.
async function leituraPronta(engine, perfil, { rodar, prazoMs = TEMPOS.CLAUDE_USO_ANTES_PRAZO_MS } = {}) {
  const guardada = leituraGuardada(engine, perfil);
  if (guardada && Date.now() - guardada.em < TEMPOS.CLAUDE_USO_ANTES_MS) return guardada;
  let timer = null;
  const prazo = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), prazoMs);
    timer.unref?.();
  });
  const opcoes = rodar ? { forcar: true, rodar } : { forcar: true };
  try {
    return await Promise.race([lerUso(engine, perfil, opcoes).catch(() => null), prazo]);
  } finally {
    clearTimeout(timer);
  }
}

function nomeDoPerfil(perfil) {
  return String(perfil?.label || perfil?.id || 'perfil');
}

// Uma linha por mudança de estado do perfil, nunca uma por PR (invariante 3). A volta ao normal
// não escreve: é a rotina.
function anotar(engine, perfil, estado, linha) {
  if (!(engine.estadoDoUsoAntes instanceof Map)) engine.estadoDoUsoAntes = new Map();
  if (engine.estadoDoUsoAntes.get(perfil.id) === estado) return;
  engine.estadoDoUsoAntes.set(perfil.id, estado);
  if (linha) engine.log?.(linha.nivel, linha.texto);
}

function anotarLeitura(engine, perfil, leitura, trava) {
  const nome = nomeDoPerfil(perfil);
  if (trava) {
    anotar(engine, perfil, `trava:${trava.id}:${trava.reset}`, { nivel: 'WARN',
      texto: `uso do plano do perfil "${nome}" em 100% na janela ${trava.nome}; fila automática parada até ${horaCurta(trava.reset)} sem abrir sessão` });
    return;
  }
  let motivo = '';
  if (!leitura) motivo = 'a leitura do uso não respondeu a tempo';
  else if (leitura.desatualizado || !leitura.ok) motivo = leitura.erro || 'o uso não foi lido';
  if (!motivo) { anotar(engine, perfil, 'ok', null); return; }
  anotar(engine, perfil, `falha:${motivo}`, { nivel: 'INFO',
    texto: `uso do plano do perfil "${nome}" não conferido antes da sessão (${motivo}); a revisão segue sem a conferência` });
}

/**
 * Até quando a assinatura desta conta está no limite (0 = livre), conferindo antes o uso lido.
 * Com a assinatura já registrada no limite, não lê nada. Com a janela cheia, registra o limite e
 * confere o perfil para o qual a conta passa a resolver (a troca de perfil de escolherPerfil).
 * Só lê no engine ligado no boot (`usoDoPlanoLigado`, como a tela): o de teste não abre o CLI.
 */
async function limiteAntesDaSessao(engine, conta, opcoes = {}) {
  const ja = limiteAte(engine, conta);
  if (ja || engine?.usoDoPlanoLigado !== true || typeof engine.resolveClaudeAuth !== 'function') return ja;
  const perfis = Array.isArray(engine.config?.claudeProfiles) ? engine.config.claudeProfiles : [];
  const modelos = modelosDaRevisao(engine.config || {});
  const vistos = new Set();
  for (let i = 0; i <= perfis.length; i += 1) {
    const auth = engine.resolveClaudeAuth(conta);
    if (!auth || auth.kind !== 'dir') break;
    const chave = chaveDaAssinatura(auth);
    // todos no limite: escolherPerfil devolve de novo o de reset mais cedo, já registrado
    if (vistos.has(chave) || registroDaAssinatura(engine, auth)) break;
    vistos.add(chave);
    const perfil = perfis.find((p) => p?.id === auth.id);
    if (!perfil) break;
    const leitura = await leituraPronta(engine, perfil, opcoes);
    const trava = janelaQueTrava(leitura, modelos, Date.now());
    anotarLeitura(engine, perfil, leitura, trava);
    if (!trava) break;
    registrarLimite(engine, conta, trava.reset, Date.now(), { auth: { kind: auth.kind, id: auth.id || '' }, origem: 'uso', janela: trava.nome });
  }
  return limiteAte(engine, conta);
}

export default { modelosDaRevisao, janelaSeAplica, janelaQueTrava, limiteAntesDaSessao };
export { modelosDaRevisao, janelaSeAplica, janelaQueTrava, limiteAntesDaSessao };
