// O provedor de IA que roda revisão, num lugar só. PURO.
//
// Desde o corte 09 o motor roda só com o Claude Code, por perfil de assinatura (pasta, de
// volta em 15/11/2026) ou de chave de API. O registro continua existindo (e com a mesma forma)
// para quem pergunta "de qual provedor é este perfil" sem conhecer o resto do engine, mas tem
// uma entrada só:
//
//   1. COMO RODA: quais `kind` de perfil pertencem a ele.
//   2. QUAIS MODELOS ACEITA: o par de campos da config (`campoModelo`, `campoEsforco`) e os
//      saneadores, que moram em lib/parse.js, a ÚNICA porta de valor de config para a linha
//      de comando.
//   3. COMO SINALIZA O LIMITE: `limiteDaMensagem` diz se a falha foi limite e até quando. O
//      padrão lê a tabela única de falhas (lib/log-taxonomy.js, classe de `kind`
//      espera-reset) e a hora do reset (`resetAtFrom`).
import { sanitizeClaudeModel, sanitizeClaudeEffort } from '../parse.js';
import { classify, resetAtFrom } from '../log-taxonomy.js';

// Leitura padrão do limite: a classe da falha decide, a mensagem diz a hora. Sem hora, `ate`
// é null e quem registra aplica o prazo estimado (TEMPOS.LIMITE_PLANO_SEM_HORA_MS).
function limitePelaTaxonomia(msg, agora = Date.now()) {
  const texto = typeof msg === 'string' ? msg : '';
  if (!texto || classify(texto).kind !== 'espera-reset') return { limite: false, ate: null };
  const reset = resetAtFrom(texto, new Date(agora));
  return { limite: true, ate: reset ? reset.getTime() : null };
}

const PROVEDORES = Object.freeze([
  Object.freeze({
    id: 'claude',
    rotulo: 'Claude Code',
    kinds: Object.freeze(['dir', 'apikey']),
    campoModelo: 'reviewModel',
    campoEsforco: 'reviewEffort',
    saneiaModelo: sanitizeClaudeModel,
    saneiaEsforco: sanitizeClaudeEffort,
    limiteDaMensagem: limitePelaTaxonomia,
  }),
]);

function provedorDoKind(kind) {
  const k = kind ? String(kind) : '';
  return PROVEDORES.find(p => p.kinds.includes(k)) || null;
}

function provedorDoPerfil(perfil) {
  return provedorDoKind(perfil?.kind);
}

// O par que a sessão daquele provedor usa, já pelo saneador dele. Valor que o saneador
// recusa vira '' (o CLI decide), nunca o valor cru.
function modeloDoProvedor(config, provedorId) {
  const p = PROVEDORES.find(x => x.id === provedorId);
  if (!p) return { modelo: '', esforco: '' };
  const c = config ?? {};
  return { modelo: p.saneiaModelo(c[p.campoModelo]) || '', esforco: p.saneiaEsforco(c[p.campoEsforco]) || '' };
}

function limiteDaMensagem(provedorId, msg, agora = Date.now()) {
  const p = PROVEDORES.find(x => x.id === provedorId) || PROVEDORES[0];
  return p.limiteDaMensagem(msg, agora);
}

export default { PROVEDORES, provedorDoKind, provedorDoPerfil, modeloDoProvedor, limiteDaMensagem };
export { PROVEDORES, provedorDoKind, provedorDoPerfil, modeloDoProvedor, limiteDaMensagem };
