// A chave de API do perfil do Claude no que SAI do motor e no que ENTRA pela tela (15/11/2026).
//
// O motor fica exposto na internet, então a chave da Anthropic entra nele e nunca mais sai por
// resposta nenhuma: nem no snapshot (GET /api/state e o SSE), nem na resposta de
// POST /api/settings. O molde é o da credencial do Jira (`maskJiraSites`, só `hasCredential`):
// para fora, o perfil de chave leva só `temChave`, um booleano. Nunca o valor, nem um pedaço.
//
// Como a tela manda a lista inteira de perfis ao salvar e não tem mais a chave para devolver, a
// entrada preserva a guardada, no molde da pasta do perfil (`semPastaDaTela`). Tudo aqui é PURO.
import { semPastaDaTela } from './pasta-do-perfil.js';
import { sanitizeClaudeDir } from '../parse.js';

const ehDeChave = (p) => !!p && typeof p === 'object' && p.kind === 'apikey';
const chaveInformada = (p) => (typeof p.apiKey === 'string' ? p.apiKey.trim() : '');

// O perfil como sai do motor: o de chave sem `apiKey` e com `temChave`; os outros, iguais.
function perfilParaFora(perfil) {
  if (!ehDeChave(perfil)) return perfil;
  const semChave = Object.fromEntries(Object.entries(perfil).filter(([campo]) => campo !== 'apiKey'));
  return { ...semChave, temChave: !!perfil.apiKey };
}

/** A config como sai do motor. Devolve uma cópia; não muta a que recebeu. */
function configParaFora(config) {
  if (!config || typeof config !== 'object') return config;
  if (!Array.isArray(config.claudeProfiles)) return { ...config };
  return { ...config, claudeProfiles: config.claudeProfiles.map(perfilParaFora) };
}

// Perfil de chave que já existe (mesmo id) e chega sem chave, ou com chave vazia, mantém a
// guardada; com chave não vazia, troca. Perfil novo sem chave segue sem chave, e o saneamento
// (`normalizeClaudeProfiles`) o descarta como incompleto. Para apagar a chave, remove-se o
// perfil. `temChave` que venha no corpo não é lido aqui e o saneamento não o grava.
function comChaveGuardada(patch, config) {
  if (!patch || !Array.isArray(patch.claudeProfiles)) return patch;
  const atuais = Array.isArray(config && config.claudeProfiles) ? config.claudeProfiles : [];
  const guardada = (id) => { const p = atuais.find((x) => ehDeChave(x) && x.id === id); return (p && p.apiKey) || ''; };
  const claudeProfiles = patch.claudeProfiles.map((p) => {
    if (!ehDeChave(p) || chaveInformada(p)) return p;
    const chave = guardada(String(p.id || '').trim());
    return chave ? { ...p, apiKey: chave } : p;
  });
  return { ...patch, claudeProfiles };
}

// O corpo de POST /api/settings como o motor o aceita: sem a pasta que a tela não escolhe e
// com a chave que a tela não tem.
function patchDaTela(patch, config) { return comChaveGuardada(semPastaDaTela(patch, config), config); }

// O endereço (URL base) decide PARA ONDE a chave guardada é enviada. Mudar o endereço de um
// perfil de chave que já existe, sem redigitar a chave no mesmo salvar, seria um jeito de tirar a
// chave do motor com uma sessão válida: a próxima revisão a mandaria para o endereço novo.
// A comparação usa o mesmo saneamento da gravação (`sanitizeClaudeDir`), sem a barra final, nos
// dois lados: espaço, aspas em volta e barra final não são mudança nem servem de desvio.
const MOTIVO_DO_ENDERECO = 'Para mudar o endereço deste perfil, digite a chave de novo.';
const enderecoDe = (p) => (typeof p.baseUrl === 'string' ? sanitizeClaudeDir(p.baseUrl) : '').replace(//+$/, '');

/** null quando o salvar pode seguir; senão a recusa, com os ids dos perfis que pedem a chave. */
function recusaDoEndereco(patch, config) {
  if (!patch || !Array.isArray(patch.claudeProfiles)) return null;
  const atuais = Array.isArray(config && config.claudeProfiles) ? config.claudeProfiles : [];
  const perfis = new Set();
  for (const p of patch.claudeProfiles) {
    if (!ehDeChave(p) || chaveInformada(p)) continue;
    const id = String(p.id || '').trim();
    const guardado = atuais.find((x) => ehDeChave(x) && x.id === id && x.apiKey);
    if (guardado && enderecoDe(p) !== enderecoDe(guardado)) perfis.add(id);
  }
  return perfis.size ? { ok: false, code: 'chave_exigida', perfis: [...perfis], erro: MOTIVO_DO_ENDERECO } : null;
}

export { configParaFora, comChaveGuardada, patchDaTela, recusaDoEndereco };
