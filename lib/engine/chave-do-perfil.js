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

function recusaDoEndereco() { return null; }

export { configParaFora, comChaveGuardada, patchDaTela, recusaDoEndereco };
