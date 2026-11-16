// Inventário das rotas /api do servidor local, por classe da spec 7.A4. A exigência de
// credencial vale igual para todas (spec 7.A4, item 5): a classe diz o que se perde se a
// rota vazar, e é por ela que os testes escolhem o que provar. Rota nova sem classe
// reprova em test/local-auth-inventario.test.js.
const CLASSES = Object.freeze({
  'leitura-sensivel': ['/api/usage', '/api/state', '/api/decision', '/api/team', '/api/log', '/api/log/triage', '/api/diagnostics', '/api/doctor', '/api/auth/sessions'],
  'evento': ['/api/events'],
  'recebe-segredo': ['/api/jira/credential', '/api/claude/login-web/code'],
  'escreve-github': ['/api/decide'],
  'sessao-paga': ['/api/review'],
  'destrutiva': ['/api/team/remove', '/api/auth/revoke'],
  'demais': ['/api/check', '/api/jira/credential/remove', '/api/jira/test', '/api/claude/profile-test', '/api/claude/login-web/start', '/api/claude/login-web/cancel', '/api/ignore', '/api/restore', '/api/settings', '/api/accounts/edit', '/api/pushback', '/api/cancel'],
  'autenticacao-publica': ['/api/auth/pair', '/api/auth/status'],
  // o probe do orquestrador: corpo fixo, nenhum dado do motor (lib/http-server.js)
  'saude-publica': ['/api/health'],
});

// As três únicas exceções, com o método: fora dele a rota exige credencial como as outras.
// A de saúde responde antes do porteiro (e antes da allowlist de Host); está aqui para a
// lista das públicas ser uma só.
const PUBLICAS = Object.freeze({ '/api/auth/pair': 'POST', '/api/auth/status': 'GET', '/api/health': 'GET' });

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
