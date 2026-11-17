// Allowlist de Host e Origin da API (C1a da operação multidispositivo, e a fronteira do
// motor hospedado da fase 2a).
// Função PURA: nenhum IO, nenhum estado, nenhuma leitura de config. Quem chama passa
// a porta EFETIVA do servidor (server.address().port), nunca a da config: com a
// config em 0 (porta efêmera, usada pelos testes) as duas divergem, e a regra tem que
// valer para a porta em que o socket de fato escuta.
//
// Host permitido não é autenticação: qualquer processo local fala com 127.0.0.1. O que
// isto fecha é o DNS rebinding (o navegador manda o Host do domínio do atacante) e a
// página de outra origem (o navegador manda o Origin dela). Autenticação é a A4.

const HOSTS_LOCAIS = ['127.0.0.1', 'localhost'];
const BINDS_LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const PORTA_MAXIMA = 65535;
const RECUSA_HOST = Object.freeze({ ok: false, motivo: 'host' });
const RECUSA_ORIGIN = Object.freeze({ ok: false, motivo: 'origin' });

function portaValida(porta) {
  return Number.isInteger(porta) && porta >= 1 && porta <= PORTA_MAXIMA;
}

// O bind (config.bind, já saneado) está no loopback? Ausente ou vazio conta como loopback:
// é o padrão, e bind que ninguém configurou nunca pode ligar a exigência de autenticação.
function loopback(bind) {
  if (bind === undefined || bind === null || bind === '') return true;
  return BINDS_LOOPBACK.includes(bind);
}

// Os dois nomes com a porta, comparados por igualdade exata: sem curinga, sem sufixo e
// sem variação de caixa. É o que o navegador da própria máquina (http://127.0.0.1:<porta>)
// e o curl das sessões mandam. Com o bind fora do
// loopback (implantação web), ou no [::1] (o socket só escuta ali), o nome dele entra também;
// os dois nomes locais continuam valendo.
function hostsLocais(porta, bind) {
  const nomes = bind && !HOSTS_LOCAIS.includes(bind) ? [...HOSTS_LOCAIS, bind] : HOSTS_LOCAIS;
  return nomes.map(nome => `${nome}:${porta}`);
}

// O host público (config.hostPublico, já saneado) vale SEM porta, por igualdade exata: atrás
// do proxy com TLS o Host chega como `farol.exemplo.com`. Com porta é recusado, inclusive
// `:443`: navegador, curl e o http do Node tiram a porta padrão do esquema antes de montar o
// Host, então ela não chega de cliente comum, e aceitar uma segunda forma só alargaria a
// lista. Vazio não é host público: sem isto, `hostPublico: ''` casaria com o Host vazio.
function ehHostPublico(host, hostPublico) {
  return typeof hostPublico === 'string' && hostPublico !== '' && host === hostPublico;
}

// As origens da própria máquina, que não levam CORS: a página e a API são a mesma origem.
// O proxy com TLS fica na 443, então a origem https do bind vem sem porta. O host público
// NÃO entra aqui: ele não vira origem sozinho, e quem quiser a origem dele a escreve em
// origensPermitidas.
function origensLocais(locais, bind) {
  const origens = locais.map(h => `http://${h}`);
  if (!loopback(bind)) origens.push(`https://${bind}`);
  return origens;
}

// A origem de outro site que a config permite (config.origensPermitidas, já saneada). A
// comparação é igualdade exata de texto contra cada item, e o que volta é o ITEM DA LISTA,
// não o cabeçalho recebido: é esse valor que a resposta reflete em Allow-Origin.
function origemConfigurada(origin, lista) {
  if (!Array.isArray(lista)) return '';
  return lista.find(item => typeof item === 'string' && item !== '' && item === origin) || '';
}

// Aceite devolve `{ ok: true }`, e `{ ok: true, cors: <origem> }` quando a origem é uma das
// configuradas: só essa resposta leva cabeçalho CORS (lib/http-cors.js).
//
// `socket`: o servidor escuta num socket Unix (config.socket, lib/escuta-em-socket.js), sem
// porta. Aí não há nome local com porta para aceitar: o único Host válido é o hostPublico, que o
// proxy repassa (e que o boot exige junto do socket). Nenhum nome de loopback vale pelo socket,
// porque quem conecta nele é o proxy, e o Host que ele entrega é o do navegador.
function validarHostEOrigem({ host, origin, porta, bind, hostPublico, origensPermitidas, socket = false } = {}) {
  if (!socket && !portaValida(porta)) return RECUSA_HOST;
  const locais = socket ? [] : hostsLocais(porta, bind);
  if (typeof host !== 'string' || !(locais.includes(host) || ehHostPublico(host, hostPublico))) return RECUSA_HOST;
  // Origin AUSENTE é aceito: navegação direta, GET da própria página e curl local não
  // mandam. Presente e vazio não é ausente: o cabeçalho veio, e veio fora da lista.
  if (origin === undefined) return { ok: true };
  if (typeof origin !== 'string') return RECUSA_ORIGIN;
  const cors = origemConfigurada(origin, origensPermitidas);
  if (cors) return { ok: true, cors };
  return origensLocais(locais, bind).includes(origin) ? { ok: true } : RECUSA_ORIGIN;
}

// O Host do pedido, só quando veio UM cabeçalho Host. O Node guarda o primeiro e descarta os
// outros em silêncio; com dois, quem está na frente (o proxy) e o motor poderiam ler nomes
// diferentes do mesmo pedido. Dois ou mais devolve undefined, que a allowlist recusa como host.
function hostDoPedido(req) {
  const todos = req && req.headersDistinct && req.headersDistinct.host;
  if (Array.isArray(todos) && todos.length !== 1) return undefined;
  return req && req.headers ? req.headers.host : undefined;
}

export default { validarHostEOrigem, loopback, hostDoPedido };
export { validarHostEOrigem, loopback, hostDoPedido };
