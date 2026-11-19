// Limite do plano do Claude vale para a ASSINATURA, não para o PR (relato de 21/09/2026).
//
// O retry já fazia cada PR esperar o reset depois de bater no limite (retryAfterNet com
// notBefore). Mas o limite é da cota da conta do Claude, e a espera ficava guardada por PR:
// com 12 PRs na fila, o primeiro descobria o limite e os outros onze batiam nele um por um,
// cada um abrindo sessão, pondo a label <conta>:revisando no PR e tirando segundos depois.
// E a espera era memória: reiniciar o Farol a apagava e a fila inteira saía de novo.
//
// Aqui fica, por assinatura, até quando ela está no limite, em disco. A chave é a mesma
// identidade que a sessão usa (resolveClaudeAuth): duas contas do GitHub apontando para o
// mesmo perfil do Claude dividem a mesma cota, e portanto o mesmo limite. Com chave de API o
// "limite do plano" é o limite de taxa ou de crédito da chave, e a espera é a mesma.
//
// Desde 18/11/2026 o registro também escolhe o perfil (escolherPerfil): com o padrão no
// limite e outro perfil livre, a conta resolve para o livre, e a fila só espera quando todos
// estão no limite, até o reset mais cedo.
import { readJson, writeJsonAtomic } from '../io.js';
import { LIMITE_PLANO_FILE } from '../paths.js';
import { limiteDaMensagem } from './provedores.js';
import { TEMPOS } from '../constants.js';
import { assinaturaDaSessao } from './sessao-continuacao.js';

// A chave é o perfil: tipo e id. Vale igual para assinatura (cada perfil tem a própria pasta e,
// portanto, o próprio plano) e para chave de API.
function chaveDaAssinatura(auth) {
  const a = auth || {};
  return `${a.kind || 'desconhecido'}:${a.id || ''}`;
}

function chaveDaConta(engine, conta) {
  return chaveDaAssinatura(engine.resolveClaudeAuth(conta));
}

// Engine sem o registro (ou sem como saber a assinatura) não tem limite conhecido.
function temRegistro(engine) {
  return !!engine && engine.limitesDePlano instanceof Map && typeof engine.resolveClaudeAuth === 'function';
}

function salvar(engine) {
  try { writeJsonAtomic(LIMITE_PLANO_FILE, Object.fromEntries(engine.limitesDePlano)); }
  catch (err) { engine.log('ERROR', `salvar limite-plano.json: ${err.message}`); }
}

// Boot: o que já venceu é descartado na leitura, então um Farol que reabre depois do reset
// não carrega trava velha, e um que reabre ANTES dele não dispara a fila inteira de novo.
function carregarLimites(engine, agora = Date.now()) {
  const bruto = readJson(LIMITE_PLANO_FILE, {});
  const vivos = Object.entries(bruto && typeof bruto === 'object' ? bruto : {})
    .filter(([, v]) => v && Number(v.ate) > agora)
    .map(([k, v]) => [k, { ate: Number(v.ate), em: Number(v.em) || 0, estimado: v.estimado === true }]);
  engine.limitesDePlano = new Map(vivos);
}

// Com hora de reset citada, trava até ela. Sem hora, quem chama passa um prazo ESTIMADO
// (`opcoes.estimado`, TEMPOS.LIMITE_PLANO_SEM_HORA_MS): sem ele, cada PR descobria o limite
// sozinho a cada ciclo. O prazo estimado aparece como estimado na tela, e uma sessão que dá
// certo o libera. `opcoes.auth` é a assinatura que a sessão USOU: a conta pode já resolver
// para outro perfil quando a falha chega (a configuração mudou), e registrar pela conta
// travaria o perfil errado.
function registrarLimite(engine, conta, ate, agora = Date.now(), opcoes = {}) {
  if (!temRegistro(engine) || !(Number(ate) > agora)) return;
  const chave = opcoes.auth ? chaveDaAssinatura(opcoes.auth) : chaveDaConta(engine, conta);
  const atual = engine.limitesDePlano.get(chave);
  // reset citado pelo provedor substitui o prazo estimado mesmo sendo mais cedo: a hora
  // estimada é palpite, e manter o palpite seguraria o perfil além do reset real
  const confirmaEstimado = atual?.estimado && opcoes.estimado !== true;
  if (atual && atual.ate >= ate && !confirmaEstimado) return;
  engine.limitesDePlano.set(chave, { ate: Number(ate), em: agora, estimado: opcoes.estimado === true });
  salvar(engine);
}

// O registro de UMA assinatura, sem passar pela conta. Vencido sai na hora. null = livre.
function registroDaAssinatura(engine, auth, agora = Date.now()) {
  if (!engine || !(engine.limitesDePlano instanceof Map)) return null;
  const chave = chaveDaAssinatura(auth);
  const v = engine.limitesDePlano.get(chave);
  if (!v) return null;
  if (v.ate > agora) return { ate: v.ate, estimado: v.estimado === true };
  engine.limitesDePlano.delete(chave);
  salvar(engine);
  return null;
}

// Qual perfil a sessão usa (pedido do dono de 18/11/2026: "faz o motor trocar de perfil
// sozinho no limite"). `candidatos` vem na ordem de preferência (o padrão primeiro, depois os
// demais na ordem da lista; candidatosDaConta, lib/engine/perfil-claude.js). Usa o primeiro
// que não está no limite do plano; com todos no limite, o de reset mais cedo, para o
// limiteAte da conta devolver esse reset e a fila esperar só até ele. Sem candidato, null.
// A escolha é refeita a cada chamada: vencido o limite do padrão, ele volta sozinho. Só o
// registro de limite faz trocar; `pronto` filtra as alternativas (o login da assinatura), e o
// padrão não passa por ele, como antes.
function escolherPerfil(engine, candidatos, pronto = () => true, agora = Date.now()) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  const padrao = lista[0] || null;
  if (!padrao || !(engine?.limitesDePlano instanceof Map)) return padrao;
  const doPadrao = registroDaAssinatura(engine, padrao, agora);
  if (!doPadrao) { anotarTroca(engine, null); return padrao; }
  let escolhido = padrao;
  let ate = doPadrao.ate;
  for (const auth of lista.slice(1)) {
    if (!pronto(auth)) continue;
    const reg = registroDaAssinatura(engine, auth, agora);
    if (!reg) { escolhido = auth; break; }
    if (reg.ate < ate) { escolhido = auth; ate = reg.ate; }
  }
  anotarTroca(engine, escolhido === padrao ? null : { padrao, escolhido, ate: doPadrao.ate });
  return escolhido;
}

// Uma linha WARN por mudança de perfil por limite, nunca uma por chamada (invariante 3): a
// escolha roda a cada ciclo e a cada sessão. A volta ao padrão não escreve: é a rotina.
function anotarTroca(engine, troca) {
  const marca = troca ? `${chaveDaAssinatura(troca.padrao)}>${chaveDaAssinatura(troca.escolhido)}` : '';
  if ((engine.trocaDePerfilPorLimite || '') === marca) return;
  engine.trocaDePerfilPorLimite = marca;
  if (!troca || typeof engine.log !== 'function') return;
  const nome = (auth) => rotuloDoPerfil(engine, auth.id) || auth.id;
  engine.log('WARN', `perfil "${nome(troca.padrao)}" no limite até ${horaCurta(troca.ate)}; usando o perfil "${nome(troca.escolhido)}"`);
}

// Até quando a assinatura desta conta está no limite (0 = livre). Vencido sai na hora.
function limiteAte(engine, conta, agora = Date.now()) {
  if (!temRegistro(engine)) return 0;
  const r = registroDaAssinatura(engine, engine.resolveClaudeAuth(conta), agora);
  return r ? r.ate : 0;
}

// Uma sessão que funcionou prova que a cota voltou (reset antecipado, uso extra comprado).
// `auth` é a assinatura que ela USOU: pela conta, o perfil resolvido na hora pode ser outro
// (duas sessões no mesmo perfil, uma estoura e a outra conclui).
function liberarLimite(engine, conta, auth = null) {
  if (!(engine?.limitesDePlano instanceof Map)) return;
  const chave = auth ? chaveDaAssinatura(auth) : (temRegistro(engine) && chaveDaConta(engine, conta));
  if (chave && engine.limitesDePlano.delete(chave)) salvar(engine);
}

// "21:00". Hora local da máquina, o mesmo fuso em que resetAtFrom interpreta a mensagem
// (ver a nota de FUSO em lib/log-taxonomy.js).
function horaCurta(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rotuloDoPerfil(engine, id) {
  const p = (engine.config?.claudeProfiles ?? []).find(x => x.id === id);
  return String(p?.label ?? '');
}

// Revisão que morreu por limite: registra o limite na assinatura que a sessão USOU
// (`err.perfilDaSessao`), com o prazo estimado de uma hora quando a mensagem não diz a hora
// do reset (uma hora é o meio-termo entre o ciclo de polling, que pagaria sessão para
// descobrir de novo o mesmo limite, e esperar a janela inteira à toa), e devolve
// { notBefore, aviso, ate, estimado, trocou }. Com outro perfil livre a conta já resolve para
// ele (escolherPerfil): o PR relança no próximo ciclo (`notBefore` null, `trocou`), sem
// esperar o reset do perfil que estourou. Com todos no limite, o PR espera o reset mais cedo
// sem estacionar e sem abrir sessão até lá (o limiteAte da conta segura a boca da sessão e o
// retry).
function aposLimite(engine, pr, err, msg, agora = Date.now()) {
  const conta = engine.accountForPr(pr);
  const usado = err?.perfilDaSessao ?? null;
  const lido = limiteDaMensagem('claude', msg, agora);
  const estimado = !(lido.ate > agora);
  const ate = estimado ? agora + TEMPOS.LIMITE_PLANO_SEM_HORA_MS : lido.ate;
  const chaveUsada = usado || !temRegistro(engine) ? chaveDaAssinatura(usado) : chaveDaConta(engine, conta);
  registrarLimite(engine, conta, ate, agora, { auth: usado, estimado });
  const nome = (usado && rotuloDoPerfil(engine, usado.id)) || 'do Farol';
  const hora = `${horaCurta(ate)}${estimado ? ' (hora estimada: o provedor não informou o reset)' : ''}`;
  const atual = temRegistro(engine) ? engine.resolveClaudeAuth(conta) : null;
  if (atual && chaveDaAssinatura(atual) !== chaveUsada && !registroDaAssinatura(engine, atual, agora)) {
    const novo = rotuloDoPerfil(engine, atual.id) || atual.id;
    return { notBefore: null, ate, estimado, trocou: true,
      aviso: `Limite atingido no perfil "${nome}" até as ${hora}. Troquei para o perfil "${novo}" e retomo ${pr.key} sozinho no próximo ciclo; ele está na sua fila.` };
  }
  // todos no limite: a conta resolve para o de reset mais cedo, e é até ele que o PR espera
  const espera = limiteAte(engine, conta, agora) || ate;
  const quando = espera === ate ? hora : horaCurta(espera);
  return { notBefore: espera, ate, estimado, trocou: false, aviso: `Limite atingido no perfil "${nome}". Retomo ${pr.key} sozinho depois das ${quando}; ele está na sua fila.` };
}

// A sessão amarra o desfecho à assinatura que USOU (sem a chave, só o que identifica o
// limite): a falha leva a assinatura para o limite travar o perfil que bateu nele, e o
// sucesso libera exatamente esse perfil. Chamada por runSelectedProvider (lib/engine/session.js).
function comPerfilDaSessao(engine, promessa, auth) {
  const sessionBinding = assinaturaDaSessao(engine, auth);
  const usado = { kind: auth.kind, id: auth.id || '' };
  return promessa.then((res) => {
    liberarLimite(engine, '', usado);
    if (res && typeof res === 'object') Object.assign(res, { sessionBinding });
    return res;
  }, (err) => {
    if (err && typeof err === 'object' && !err.perfilDaSessao) err.perfilDaSessao = usado;
    throw err;
  });
}

export { chaveDaAssinatura, carregarLimites, registrarLimite, registroDaAssinatura, escolherPerfil, limiteAte, liberarLimite, horaCurta, aposLimite, comPerfilDaSessao };
