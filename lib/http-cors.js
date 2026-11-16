// CORS do motor hospedado (fase 2a, spec 6.2). O front novo mora em outra origem e chama a
// API direto do navegador, com Authorization: Bearer. Aqui ficam só os cabeçalhos e a
// resposta do preflight; QUEM pode é decisão de lib/http-guard.js, que devolve a origem
// configurada que casou (`cors`), ou nada.
//
// Sem estado e sem leitura de config. Três regras que não mudam:
// - Allow-Origin leva a origem EXATA que casou com a lista saneada, nunca `*` e nunca o
//   cabeçalho que chegou;
// - não existe Allow-Credentials: a API não usa cookie, o token vai no Authorization;
// - métodos e cabeçalhos anunciados são listas fixas. O que o preflight pede
//   (Access-Control-Request-Method e -Headers) não é lido, então nada do pedido volta.

// x-farol está aqui porque todo POST o exige (lib/http-server.js); sem anunciá-lo, o
// navegador não deixaria o front mandá-lo.
const CABECALHOS_PERMITIDOS = 'Authorization, Content-Type, x-farol';
const METODOS_PERMITIDOS = 'GET, POST';
// Por quanto tempo o navegador guarda o preflight, em segundos. Sem isto o padrão é 5 s, e
// como Authorization tira toda chamada da categoria "simples", quase todo pedido do front
// viraria dois. Dez minutos cortam essa dobra; não afrouxam nada, porque o pedido de verdade
// passa pela allowlist de novo a cada vez, e ficam abaixo do teto de todo navegador (o menor
// é o do Chromium, 2 h).
const PREFLIGHT_VALE_S = 600;

// Marca a resposta ANTES de qualquer rota escrever: res.setHeader fica guardado e sai junto
// do writeHead de quem responder, então 200, 401, 403 do x-farol, 404, 500 e o SSE levam os
// mesmos cabeçalhos sem cada um precisar lembrar. Sem origem configurada não faz nada.
function aplicarCors(res, origem) {
  if (!origem) return;
  res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', CABECALHOS_PERMITIDOS);
  res.setHeader('Access-Control-Allow-Methods', METODOS_PERMITIDOS);
}

// O preflight não carrega credencial (o navegador não manda Authorization num OPTIONS), por
// isso responde antes do porteiro; e não executa rota nenhuma. Quem chama já passou pela
// allowlist de Host e Origin e já aplicou os cabeçalhos acima.
function responderPreflight(res, origem) {
  if (origem) res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_VALE_S));
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export default { aplicarCors, responderPreflight, CABECALHOS_PERMITIDOS, METODOS_PERMITIDOS, PREFLIGHT_VALE_S };
export { aplicarCors, responderPreflight, CABECALHOS_PERMITIDOS, METODOS_PERMITIDOS, PREFLIGHT_VALE_S };
