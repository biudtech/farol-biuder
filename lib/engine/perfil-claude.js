// Plano e chaves (spec 7.A2): o motor roda com um perfil do Claude Code, de ASSINATURA (uma
// pasta de configuração por perfil, com o login do plano) ou de CHAVE DE API. O corte 09
// tinha deixado só a chave; a assinatura voltou em 15/11/2026 por decisão do dono. O que a
// tela de perfis e o motor precisam saber, sem nenhuma escrita que o usuário não tenha pedido.
//
// TRÊS COISAS, e nenhuma decide sessão sozinha:
// 1. `authFromProfile` e `authDaConta`: a regra ÚNICA de "perfil utilizável" e qual perfil
//    atende uma conta do GitHub. Sem perfil utilizável o resultado é null, e a sessão não
//    abre (runProvedor recusa com uma frase que diz por quê).
// 2. `problemasDePerfil`: id de perfil que não existe ou que não resolve. A tela e o
//    Diagnóstico mostram, em vez de a pessoa achar que está num perfil que a sessão ignora.
// 3. `testarPerfil`: o ato explícito de testar, como "Testar leitura" do Jira. Diz de onde
//    veio cada informação (informado, validado, inferido, desconhecido) e NUNCA grava a
//    configuração. Assinatura: `claude auth status --json` contra uma CÓPIA efêmera da pasta
//    (lib/engine/perfil-assinatura.js). Chave de API: não roda nada, porque testar a chave
//    exigiria uma chamada paga ao provedor.
//
// Config antiga com perfil de outro tipo (os formatos que saíram) não derruba o boot:
// lib/parse.js ignora o perfil na leitura.
import { pastaDoPerfil } from './pasta-do-perfil.js';
import { statusDoClaude, emailDoArquivo, infoDaPasta, temCredencial, recusaSemLogin } from './perfil-assinatura.js';
import { agendarLeitura, usoParaTela } from './uso-do-plano.js';

const CODIGOS = Object.freeze({
  INEXISTENTE: 'perfil-inexistente',
  INVALIDO: 'perfil-invalido',
  SEM_PERFIL: 'sem-perfil',
});
const MOTIVO_PLANO = 'o nome comercial do plano não é detectável com confiança pelo que o Claude Code informa';

function lista(v) {
  return Array.isArray(v) ? v : [];
}

function campo(valor, origem, motivo) {
  return motivo ? { valor, origem, motivo } : { valor, origem };
}

/**
 * O shape de autenticação de um perfil já escolhido, ou null quando ele não resolve. É a
 * regra única de "perfil utilizável": a resolução real e o aviso de problema leem daqui,
 * senão o aviso diria que está tudo bem com um perfil que a sessão ignora. Dois tipos:
 * assinatura (`kind: 'dir'`, com a pasta dentro do HOME do Farol) e chave de API.
 */
function authFromProfile(p) {
  if (!p) return null;
  if (p.kind === 'apikey' && p.apiKey) return { kind: 'apikey', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
  const dir = pastaDoPerfil(p);
  return dir ? { kind: 'dir', id: p.id, dir } : null;
}

/**
 * Qual autenticação atende as sessões desta conta do GitHub, ou null (sem perfil
 * utilizável). Cascata: 1) o perfil próprio da conta (`accounts[].claudeProfileId`), fixo:
 * se não resolve, a conta fica sem perfil em vez de gastar o plano ou a chave de outra;
 * 2) o perfil padrão (`claudeProfileId`); 3) o primeiro perfil utilizável, na ordem da lista.
 * Não há troca automática de perfil: limite do plano espera o reset no mesmo perfil.
 */
function authDaConta(config, user) {
  const cfg = config || {};
  const perfis = lista(cfg.claudeProfiles);
  const acc = lista(cfg.accounts).find(a => a?.user === user);
  if (acc?.claudeProfileId) return authFromProfile(perfis.find(p => p?.id === acc.claudeProfileId));
  const padrao = authFromProfile(perfis.find(p => p?.id === cfg.claudeProfileId));
  if (padrao) return padrao;
  for (const p of perfis) {
    const auth = authFromProfile(p);
    if (auth) return auth;
  }
  return null;
}

function problemaDoId(perfis, id) {
  if (!id) return '';
  const p = perfis.find((x) => x && x.id === id);
  if (!p) return CODIGOS.INEXISTENTE;
  return authFromProfile(p) ? '' : CODIGOS.INVALIDO;
}

/** Cada id de perfil apontado pela configuração que a resolução não consegue usar. */
function problemasDePerfil(config) {
  const cfg = config || {};
  const perfis = lista(cfg.claudeProfiles);
  const out = [];
  const padrao = problemaDoId(perfis, cfg.claudeProfileId);
  if (padrao) out.push({ escopo: 'padrao', user: '', profileId: cfg.claudeProfileId, code: padrao });
  for (const conta of lista(cfg.accounts)) {
    const code = problemaDoId(perfis, conta && conta.claudeProfileId);
    if (code) out.push({ escopo: 'conta', user: conta.user, profileId: conta.claudeProfileId, code });
  }
  return out;
}

// O perfil que as sessões desta conta vão USAR está pronto? Perfil que resolve não basta: o
// de assinatura só conta com a credencial gravada na pasta (login feito). `tipo` e `falta`
// dizem à tela o que está pronto ou o que falta ('perfil' ou 'login').
function prontidaoDoPerfil(config, user) {
  const auth = authDaConta(config, user);
  if (!auth) return { pronto: false, tipo: '', falta: 'perfil' };
  if (auth.kind === 'apikey') return { pronto: true, tipo: 'chave', falta: '' };
  const pronto = temCredencial(auth.dir);
  return { pronto, tipo: 'assinatura', falta: pronto ? '' : 'login' };
}

// Os três campos do doctor que o check "Claude Code" lê (ui/pure/sistema.js).
function prontidaoParaDoctor(config, user) {
  const p = prontidaoDoPerfil(config, user);
  return { claudePerfilPronto: p.pronto, claudePerfilTipo: p.tipo, claudePerfilFalta: p.falta };
}

// A recusa da sessão cujo perfil de assinatura está sem login, ou null (lib/engine/session.js).
function recusaDaSessao(config, auth) {
  const p = lista(config && config.claudeProfiles).find((x) => x && x.id === auth.id);
  return recusaSemLogin(auth, String((p && p.label) || ''));
}

// O estado de cada perfil salvo, para o doctor mostrar quem está pronto. Não abre o CLI nem
// toca a rede: chave de API está pronta quando preenchida; assinatura, quando a pasta do
// perfil tem login gravado (quem prova que o login VALE é o teste do perfil ou a sessão).
// Orçamento não viaja aqui: a fonte única dele é usageSummary().budgets.
function infoDosPerfis(config) {
  return lista(config && config.claudeProfiles).map((p) => {
    if (p.kind === 'apikey') return { id: p.id, label: p.label, ready: !!p.apiKey, apiKeyMode: true };
    return { id: p.id, label: p.label, ready: infoDaPasta(pastaDoPerfil(p)).ready, assinaturaMode: true };
  });
}

// O que o snapshot leva dos perfis: os problemas e, por perfil de assinatura, o uso do plano
// e a validade do login (lib/engine/uso-do-plano.js). Não espera: uso velho agenda a leitura,
// e a resposta chega no próximo snapshot. Nunca pasta, conta nem credencial.
function perfisParaTela(engine, agora = Date.now()) {
  const uso = {};
  for (const p of lista(engine.config && engine.config.claudeProfiles)) {
    agendarLeitura(engine, p, agora);
    const lido = usoParaTela(engine, p, agora);
    if (lido) uso[p.id] = lido;
  }
  return { problemas: problemasDePerfil(engine.config), uso };
}

// --- teste explícito --------------------------------------------------------------------

function alvoDoTeste(engine, id) {
  const perfis = lista(engine.config.claudeProfiles);
  if (!id) {
    const auth = authDaConta(engine.config, '');
    const p = auth && perfis.find((x) => x && x.id === auth.id);
    if (!p) return { erro: { ok: false, code: CODIGOS.SEM_PERFIL, motivo: 'não há perfil do Claude utilizável na configuração' } };
    return { perfil: p };
  }
  const p = perfis.find((x) => x && x.id === id);
  if (!p) return { erro: { ok: false, code: CODIGOS.INEXISTENTE, motivo: 'esse perfil não existe mais na configuração' } };
  if (!authFromProfile(p)) return { erro: { ok: false, code: CODIGOS.INVALIDO, motivo: 'esse perfil está incompleto: falta a chave, ou a pasta fica fora do HOME do Farol' } };
  return { perfil: p };
}

// Chave de API: o teste prova que o perfil existe e que tem chave preenchida (a forma). Não
// prova que a chave vale: isso exigiria uma chamada paga ao provedor, e o teste nunca gasta.
function camposDeChave() {
  return {
    tipoAuth: campo('chave-de-api', 'informado'),
    chave: campo('preenchida', 'informado'),
    login: campo(null, 'desconhecido', 'testar a chave exigiria uma chamada paga ao provedor'),
    email: campo(null, 'desconhecido'),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
}

function emailDe(status, arquivo) {
  if (status && status.email) return campo(status.email, 'validado');
  if (arquivo) return campo(arquivo, 'detectado');
  return campo(null, 'desconhecido');
}

// Assinatura: o CLI diz se há login e de quem, sem chamar modelo. Sem resposta do CLI, o que
// aparece é o que os arquivos da pasta dizem, marcado como inferido e com aviso.
async function camposDeAssinatura(dir) {
  const status = await statusDoClaude(dir);
  const campos = { email: emailDe(status, emailDoArquivo(dir)), plano: campo(null, 'desconhecido', MOTIVO_PLANO) };
  if (status) {
    campos.login = campo(status.loggedIn, 'validado');
    campos.tipoAuth = campo(status.authMethod || null, status.authMethod ? 'validado' : 'desconhecido');
    return { campos, aviso: '' };
  }
  campos.login = campo(infoDaPasta(dir).ready, 'inferido', 'pelos arquivos da pasta');
  campos.tipoAuth = campo(null, 'desconhecido');
  return { campos, aviso: 'o Claude Code não respondeu à verificação; o que aparece aqui foi lido dos arquivos da pasta' };
}

async function testarPerfil(engine, dados) {
  const alvo = alvoDoTeste(engine, String((dados && dados.profileId) || ''));
  if (alvo.erro) return alvo.erro;
  const p = alvo.perfil;
  const base = { id: p.id, label: String(p.label || ''), kind: p.kind };
  if (p.kind === 'apikey') return { ok: true, escreveu: false, perfil: { ...base, campos: camposDeChave(), aviso: '' } };
  const { campos, aviso } = await camposDeAssinatura(pastaDoPerfil(p));
  return { ok: true, escreveu: false, perfil: { ...base, campos, aviso } };
}

export default { CODIGOS, authFromProfile, authDaConta, problemasDePerfil, prontidaoDoPerfil, prontidaoParaDoctor, recusaDaSessao, infoDosPerfis, perfisParaTela, testarPerfil };
export { CODIGOS, authFromProfile, authDaConta, problemasDePerfil, prontidaoDoPerfil, prontidaoParaDoctor, recusaDaSessao, infoDosPerfis, perfisParaTela, testarPerfil };
