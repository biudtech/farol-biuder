// Inventário das rotas /api do servidor local, por classe da spec 7.A4. A exigência de
// credencial vale igual para todas (spec 7.A4, item 5): a classe diz o que se perde se a
// rota vazar, e é por ela que os testes escolhem o que provar. Rota nova sem classe
// reprova em test/local-auth-inventario.test.js. As duas rotas de baixo risco foram
// confirmadas como protegidas, sem exceção.
const CLASSES = Object.freeze({
  'leitura-sensivel': ['/api/usage', '/api/state', '/api/decision', '/api/team', '/api/log', '/api/log/triage', '/api/diagnostics', '/api/doctor', '/api/sync/consolidated', '/api/sync/reviews', '/api/sync/review-body', '/api/sync/command-status', '/api/sync/diagnostic', '/api/sync/takeover-notice', '/api/auth/sessions', '/api/sync/policy-read', '/api/sync/transfer-targets', '/api/sync/lists'],
  'leitura-baixo-risco': ['/api/sync/cleanup-state'],
  'evento': ['/api/events'],
  'recebe-segredo': ['/api/jira/credential', '/api/sync/login', '/api/sync/unlock', '/api/sync/new-epoch', '/api/sync/admin', '/api/sync/cleanup', '/api/sync/revoke'],
  'escreve-github': ['/api/decide'],
  'sessao-paga': ['/api/review'],
  'destrutiva': ['/api/team/remove', '/api/sync/cleanup-key', '/api/auth/revoke'],
  'demais': ['/api/sync/mirror', '/api/check', '/api/jira/credential/remove', '/api/jira/test', '/api/sync/logout', '/api/sync/test', '/api/sync/redo', '/api/sync/consolidate', '/api/sync/group', '/api/sync/command', '/api/sync/policy', '/api/sync/designation-decline', '/api/sync/link', '/api/sync/device', '/api/sync/seen', '/api/sync/history-measure', '/api/sync/history-send', '/api/claude/profile-test', '/api/ignore', '/api/restore', '/api/settings', '/api/accounts/edit', '/api/pushback', '/api/cancel'],
  'autenticacao-publica': ['/api/auth/pair', '/api/auth/status'],
});

// As duas únicas exceções, com o método: fora dele a rota exige credencial como as outras.
const PUBLICAS = Object.freeze({ '/api/auth/pair': 'POST', '/api/auth/status': 'GET' });

function todasAsRotas() { return Object.values(CLASSES).flat(); }

function classeDaRota(rota) {
  const achada = Object.entries(CLASSES).find(([, rotas]) => rotas.includes(rota));
  return achada ? achada[0] : '';
}

function rotaPublicaDeAutenticacao(metodo, rota) {
  return Object.hasOwn(PUBLICAS, rota) && PUBLICAS[rota] === metodo;
}

export default { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas };
export { CLASSES, PUBLICAS, classeDaRota, rotaPublicaDeAutenticacao, todasAsRotas };
