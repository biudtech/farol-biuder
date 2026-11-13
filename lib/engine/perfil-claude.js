// Plano e chaves (spec 7.A2), desde o corte 09 só com chave de API: o motor roda com UMA
// credencial de IA, um perfil do Claude Code por chave de API. O que a tela de perfis e o
// motor precisam saber, sem nenhuma escrita que o usuário não tenha pedido.
//
// TRÊS COISAS, e nenhuma decide sessão sozinha:
// 1. `authFromProfile` e `authDaConta`: a regra ÚNICA de "perfil utilizável" e qual perfil
//    atende uma conta do GitHub. Sem perfil utilizável o resultado é null, e a sessão não
//    abre (runProvedor recusa com uma frase que diz por quê).
// 2. `problemasDePerfil`: id de perfil que não existe ou que não resolve. A tela e o
//    Diagnóstico mostram, em vez de a pessoa achar que está num perfil que a sessão ignora.
// 3. `testarPerfil`: o ato explícito de testar, como "Testar leitura" do Jira. Diz de onde
//    veio cada informação (informado, desconhecido) e NUNCA grava a configuração. Para chave
//    de API não roda nada: testar a chave exigiria uma chamada paga ao provedor.
//
// Config antiga com perfil de outro tipo (os formatos que saíram) não derruba o boot:
// lib/parse.js ignora o perfil na leitura.

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
 * senão o aviso diria que está tudo bem com um perfil que a sessão ignora. Só chave de API.
 */
function authFromProfile(p) {
  if (!p || p.kind !== 'apikey' || !p.apiKey) return null;
  return { kind: 'apikey', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
}

/**
 * Qual autenticação atende as sessões desta conta do GitHub, ou null (sem perfil
 * utilizável). Cascata: 1) o perfil próprio da conta (`accounts[].claudeProfileId`), fixo:
 * se não resolve, a conta fica sem perfil em vez de gastar a chave de outra; 2) o perfil
 * padrão (`claudeProfileId`); 3) o primeiro perfil de chave de API utilizável.
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

/** Há ao menos um perfil de chave de API utilizável na configuração? */
function temPerfilUtilizavel(config) {
  return lista(config && config.claudeProfiles).some((p) => authFromProfile(p));
}

// --- teste explícito --------------------------------------------------------------------

function alvoDoTeste(engine, id) {
  const perfis = lista(engine.config.claudeProfiles);
  if (!id) {
    const auth = authDaConta(engine.config, '');
    const p = auth && perfis.find((x) => x && x.id === auth.id);
    if (!p) return { erro: { ok: false, code: CODIGOS.SEM_PERFIL, motivo: 'não há perfil de chave de API utilizável na configuração' } };
    return { perfil: p };
  }
  const p = perfis.find((x) => x && x.id === id);
  if (!p) return { erro: { ok: false, code: CODIGOS.INEXISTENTE, motivo: 'esse perfil não existe mais na configuração' } };
  if (!authFromProfile(p)) return { erro: { ok: false, code: CODIGOS.INVALIDO, motivo: 'esse perfil está incompleto: falta a chave' } };
  return { perfil: p };
}

// O que o teste prova: que o perfil existe e que tem chave preenchida (a forma). Não prova que
// a chave vale: isso exigiria uma chamada paga ao provedor, e o teste nunca gasta.
async function testarPerfil(engine, dados) {
  const alvo = alvoDoTeste(engine, String((dados && dados.profileId) || ''));
  if (alvo.erro) return alvo.erro;
  const p = alvo.perfil;
  const campos = {
    tipoAuth: campo('chave-de-api', 'informado'),
    chave: campo('preenchida', 'informado'),
    login: campo(null, 'desconhecido', 'testar a chave exigiria uma chamada paga ao provedor'),
    email: campo(null, 'desconhecido'),
    plano: campo(null, 'desconhecido', MOTIVO_PLANO),
  };
  return { ok: true, escreveu: false, perfil: { id: p.id, label: String(p.label || ''), kind: 'apikey', campos, aviso: '' } };
}

export default { CODIGOS, authFromProfile, authDaConta, problemasDePerfil, temPerfilUtilizavel, testarPerfil };
export { CODIGOS, authFromProfile, authDaConta, problemasDePerfil, temPerfilUtilizavel, testarPerfil };
