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
// O RESET QUE NÃO FECHA (revisão de 21/11/2026). Logo depois do reset o servidor ainda pode
// mostrar 100% com a hora que acabou de passar; sem data no texto ("resets 5:50pm"), a hora
// passada vira a de amanhã, e a trava ficaria gravada por cerca de 24 h. Por isso cada janela
// tem um teto (a da sessão volta em até 5 h, a da semana em até 7 dias), e a janela cheia cujo
// reset virou o dia, já passou ou fica além do teto não trava até ele: vira um recuo curto
// (CLAUDE_USO_RECUO_MS), depois do qual o uso é lido de novo.
//
// A TRAVA QUE SAI ANTES. A trava registrada por esta leitura (origem 'uso') é relida a cada
// CLAUDE_USO_RECONFERIR_MS enquanto dura; se a leitura nova mostra a janela fora de 100%, a trava
// sai. A trava da sessão que bateu no limite de verdade não é relida: segue como antes.
//
// CUSTO NA HOSPEDAGEM. Cada leitura abre um processo do Claude CLI. A leitura guardada vale por
// CLAUDE_USO_ANTES_MS (dois minutos) e é a mesma que a tela usa; lerUso faz uma leitura de cada
// vez na máquina inteira e devolve a que já está em curso. Só o PR que começa a leitura espera
// por ela, no máximo CLAUDE_USO_ANTES_PRAZO_MS; com a leitura em curso ou fora do prazo, vale a
// guardada de até CLAUDE_USO_ANTES_VELHA_MS, e sem ela a revisão segue sem a conferência.
import { TEMPOS } from '../constants.js';
import { autoNaFaixa, familiaDe, SELECOES_CLAUDE, AUTO_POR_FAIXA } from '../modelos.js';
import { isAutoModel } from './model-router.js';
import { lerUso, leituraEmCurso, leituraGuardada } from './uso-do-plano.js';
import { chaveDaAssinatura, horaCurta, liberarLimite, limiteAte, registrarLimite, registroDaAssinatura } from './limite-plano.js';

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

/** O maior intervalo até o reset que a janela admite: 5 h a da sessão, 7 dias a da semana. */
function tetoDaJanela(janela) {
  return janela?.id === 'sessao' ? TEMPOS.CLAUDE_USO_TETO_SESSAO_MS : TEMPOS.CLAUDE_USO_TETO_SEMANA_MS;
}

// O reset fecha com a janela: está no futuro, dentro do teto, e não é a hora passada que virou o dia.
function resetConfiavel(janela, agora) {
  const falta = Number(janela.reset) - agora;
  return janela.virouODia !== true && falta > 0 && falta <= tetoDaJanela(janela);
}

/**
 * O que a leitura decide para a revisão:
 *  - 'nada': leitura ausente, que falhou ou desatualizada (nunca trava);
 *  - 'livre': nenhuma janela que se aplica está em 100%;
 *  - 'trava': a janela cheia de reset confiável (das várias, a de reset mais tarde);
 *  - 'recuo': janela cheia de reset que não fecha (virou o dia, passou ou além do teto);
 *  - 'cheia-sem-hora': janela cheia sem reset legível (não trava, e também não é livre).
 * @returns {{ tipo: string, janela?: object }}
 */
function decisaoDoUso(leitura, modelos, agora = Date.now()) {
  if (!leitura || !leitura.ok || leitura.desatualizado) return { tipo: 'nada' };
  const cheias = (leitura.janelas || []).filter((j) => Number(j?.usado) >= 1 && janelaSeAplica(j, modelos));
  if (!cheias.length) return { tipo: 'livre' };
  const comHora = cheias.filter((j) => Number(j.reset) > 0);
  const confiaveis = comHora.filter((j) => resetConfiavel(j, agora));
  if (confiaveis.length) return { tipo: 'trava', janela: confiaveis.reduce((a, b) => (b.reset > a.reset ? b : a)) };
  if (comHora.length) return { tipo: 'recuo', janela: comHora[0] };
  return { tipo: 'cheia-sem-hora' };
}

/** A janela que trava a revisão nesta leitura até o reset dela, ou null. */
function janelaQueTrava(leitura, modelos, agora = Date.now()) {
  const d = decisaoDoUso(leitura, modelos, agora);
  return d.tipo === 'trava' ? d.janela : null;
}

// --- IO ------------------------------------------------------------------------------------

function esperar(promessa, prazoMs) {
  let timer = null;
  const prazo = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), prazoMs);
    timer.unref?.();
  });
  return Promise.race([promessa.catch(() => null), prazo]).finally(() => clearTimeout(timer));
}

// A leitura que decide. A guardada de até dois minutos vale direto (a tentativa que falhou também
// fica guardada com a hora dela, e a falha não trava: com o CLI quebrado, a fila não abre um
// processo por PR). Senão, com uma leitura já em curso, nenhum PR espera por ela: vale a guardada
// de até dez minutos, ou nenhuma. Só quem começa a leitura espera, até o prazo curto.
async function leituraPronta(engine, perfil, { rodar, prazoMs = TEMPOS.CLAUDE_USO_ANTES_PRAZO_MS } = {}) {
  const guardada = leituraGuardada(engine, perfil);
  const idade = guardada ? Date.now() - guardada.em : Infinity;
  if (idade < TEMPOS.CLAUDE_USO_ANTES_MS) return guardada;
  const reserva = idade < TEMPOS.CLAUDE_USO_ANTES_VELHA_MS ? guardada : null;
  if (leituraEmCurso(engine, perfil)) return reserva;
  const opcoes = rodar ? { forcar: true, rodar } : { forcar: true };
  return (await esperar(lerUso(engine, perfil, opcoes), prazoMs)) || reserva;
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

function motivoSemConferencia(leitura) {
  if (!leitura) return 'a leitura do uso não respondeu a tempo';
  if (leitura.desatualizado || !leitura.ok) return leitura.erro || 'o uso não foi lido';
  return '';
}

function anotarDecisao(engine, perfil, leitura, decisao, ate) {
  const nome = nomeDoPerfil(perfil);
  const j = decisao.janela;
  if (decisao.tipo === 'trava') {
    anotar(engine, perfil, `trava:${j.id}:${j.reset}`, { nivel: 'WARN',
      texto: `uso do plano do perfil "${nome}" em 100% na janela ${j.nome}; fila automática parada até ${horaCurta(ate)} sem abrir sessão` });
    return;
  }
  if (decisao.tipo === 'recuo') {
    anotar(engine, perfil, `recuo:${j.id}`, { nivel: 'INFO',
      texto: `uso do plano do perfil "${nome}" em 100% na janela ${j.nome} com o reset passado, virado ou além do teto; leio de novo às ${horaCurta(ate)}` });
    return;
  }
  const motivo = motivoSemConferencia(leitura);
  if (!motivo) { anotar(engine, perfil, 'ok', null); return; }
  anotar(engine, perfil, `falha:${motivo}`, { nivel: 'INFO',
    texto: `uso do plano do perfil "${nome}" não conferido antes da sessão (${motivo}); a revisão segue sem a conferência` });
}

function perfisDeAssinatura(engine) {
  const perfis = Array.isArray(engine.config?.claudeProfiles) ? engine.config.claudeProfiles : [];
  return perfis.filter((p) => p && p.kind === 'dir');
}

// A trava vinda do uso lido, relida a cada poucos minutos enquanto dura: com a leitura nova (feita
// depois da trava) mostrando a janela fora de 100%, ela sai. Leitura que falha mantém a trava até
// o reset, como antes; a trava da sessão que bateu no limite nem entra aqui.
async function reconferirTravas(engine, modelos, opcoes) {
  if (!(engine.limitesDePlano instanceof Map)) return;
  if (!(engine.reconferenciaDoUso instanceof Map)) engine.reconferenciaDoUso = new Map();
  for (const perfil of perfisDeAssinatura(engine)) {
    const auth = { kind: 'dir', id: perfil.id };
    const chave = chaveDaAssinatura(auth);
    const reg = engine.limitesDePlano.get(chave);
    if (!reg || reg.origem !== 'uso' || !(reg.ate > Date.now())) continue;
    const ultima = Math.max(engine.reconferenciaDoUso.get(chave) || 0, reg.em || 0);
    if (Date.now() - ultima < TEMPOS.CLAUDE_USO_RECONFERIR_MS) continue;
    engine.reconferenciaDoUso.set(chave, Date.now());
    const leitura = await leituraPronta(engine, perfil, opcoes);
    if (!leitura || leitura.em <= (reg.em || 0) || decisaoDoUso(leitura, modelos, Date.now()).tipo !== 'livre') continue;
    liberarLimite(engine, '', auth);
    anotar(engine, perfil, 'ok', { nivel: 'INFO', texto: `uso do plano do perfil "${nomeDoPerfil(perfil)}" saiu de 100%; a trava lida antes da sessão saiu antes do reset` });
  }
}

// Até quando a decisão segura a assinatura: o reset da janela, ou o recuo curto (que nunca vence
// antes de a leitura guardada envelhecer, para a próxima conferência ler de novo).
function ateDaDecisao(decisao, leitura, agora) {
  if (decisao.tipo === 'trava') return decisao.janela.reset;
  return Math.max(agora + TEMPOS.CLAUDE_USO_RECUO_MS, (leitura?.em || 0) + TEMPOS.CLAUDE_USO_ANTES_MS + 1000);
}

/**
 * Até quando a assinatura desta conta está no limite (0 = livre), conferindo antes o uso lido.
 * Com a assinatura já registrada no limite, não lê nada (a não ser para reler a trava vinda do
 * uso). Com a janela cheia, registra o limite e confere o perfil para o qual a conta passa a
 * resolver (a troca de perfil de escolherPerfil). Só lê no engine ligado no boot
 * (`usoDoPlanoLigado`, como a tela): o de teste não abre o CLI.
 */
async function limiteAntesDaSessao(engine, conta, opcoes = {}) {
  if (engine?.usoDoPlanoLigado !== true || typeof engine.resolveClaudeAuth !== 'function') return limiteAte(engine, conta);
  const modelos = modelosDaRevisao(engine.config || {});
  await reconferirTravas(engine, modelos, opcoes);
  const ja = limiteAte(engine, conta);
  if (ja) return ja;
  const perfis = perfisDeAssinatura(engine);
  const vistos = new Set();
  for (let i = 0; i <= perfis.length; i += 1) {
    const auth = engine.resolveClaudeAuth(conta);
    if (!auth || auth.kind !== 'dir') break;
    const chave = chaveDaAssinatura(auth);
    // todos no limite: escolherPerfil devolve de novo o de reset mais cedo, já registrado
    if (vistos.has(chave) || registroDaAssinatura(engine, auth)) break;
    vistos.add(chave);
    const perfil = perfis.find((p) => p.id === auth.id);
    if (!perfil) break;
    const leitura = await leituraPronta(engine, perfil, opcoes);
    const agora = Date.now();
    const decisao = decisaoDoUso(leitura, modelos, agora);
    const segura = decisao.tipo === 'trava' || decisao.tipo === 'recuo';
    const ate = segura ? ateDaDecisao(decisao, leitura, agora) : 0;
    anotarDecisao(engine, perfil, leitura, decisao, ate);
    if (!segura) break;
    registrarLimite(engine, conta, ate, agora, { auth: { kind: auth.kind, id: auth.id || '' }, origem: 'uso', janela: decisao.janela.nome });
  }
  return limiteAte(engine, conta);
}

export default { modelosDaRevisao, janelaSeAplica, tetoDaJanela, decisaoDoUso, janelaQueTrava, limiteAntesDaSessao };
export { modelosDaRevisao, janelaSeAplica, tetoDaJanela, decisaoDoUso, janelaQueTrava, limiteAntesDaSessao };
