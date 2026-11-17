// A trava da INSTÂNCIA HOSPEDADA: com a variável de ambiente FAROL_INSTANCIA_HOSPEDADA=1, que a
// imagem do container liga por padrão, o motor só sobe com um config.json legível que exige
// autenticação na API e define hostPublico ou origensPermitidas.
//
// Por que existe. Para o motor, config.json ausente é instalação nova: ele sobe com os padrões
// (loopback, sem autenticação, conta detectada pelo `gh` que revisa e posta sozinha) e grava um
// config.json novo. Num container, o volume de dados que não montou é exatamente isso: a pasta
// vazia. Sem esta trava, o erro de montagem virava uma instância aberta, e o arquivo novo ainda
// ocupava o lugar do de verdade. Quem hospeda diz que hospeda pela variável, e a variável mora
// na imagem, fora do volume: é o único sinal que sobrevive ao volume faltando.
//
// As três recusas (ausente, sem autenticação, sem fronteira) saem pelo mesmo caminho das outras
// recusas de boot (lib/fronteira-hospedada.js, que chama este módulo): mensagem no stderr,
// código de saída 1, e o config.json não é criado nem tocado. A linha também vai ao farol.log
// quando a pasta de estado já existe no volume; sem a pasta, nada é criado.
//
// E dois AVISOS, que não recusam: a config passa pela trava e mesmo assim não atende ninguém
// (bind em loopback dentro do container; origensPermitidas sem hostPublico atrás de um proxy).
//
// A regra de "exige autenticação" não é copiada aqui: é a do porteiro (lib/local-auth/acesso.js).
// Como hostPublico e origensPermitidas ligam a exigência sozinhos, sem chave que desligue, a
// instância hospedada que passa pela terceira recusa sempre exige autenticação; a segunda existe
// para a mensagem dizer as duas coisas a quem subiu um config.json de máquina local.
import env from './env.js';
import { CONFIG_FILE } from './paths.js';
import { exigida } from './local-auth/acesso.js';
import { loopback } from './http-guard.js';

const VARIAVEL = 'FAROL_INSTANCIA_HOSPEDADA';
const CODIGO = 'INSTANCIA_HOSPEDADA';
const GUIA = 'docs/HOSPEDAGEM.md';
const ABRE = `[farol] instância hospedada (${VARIAVEL}=1), o motor não sobe:`;

/* Só "1" liga. Só ausente e "0" desligam ("0" existe para quem roda a imagem numa máquina de
   desenvolvimento). Qualquer outro valor é INVÁLIDO, e não desligado: "true" ou "sim" virando
   desligado em silêncio devolveria o motor aberto que a variável existe para impedir. A variável
   VAZIA também é inválida: um manifesto com `value: ""` por cima do padrão da imagem desligaria
   a trava sem ninguém ter escrito "desligar". */
function modoHospedado(valor = env.instanciaHospedada()) {
  if (valor === undefined || valor === '0') return { ligada: false, invalido: false };
  return { ligada: valor === '1', invalido: valor !== '1' };
}

function linhaDoValorInvalido(mostrado) {
  return `[farol] ${VARIAVEL} inválida, o motor não sobe: o valor ${mostrado} não é aceito. Use "1" para a instância hospedada (o padrão da imagem do container) ou "0" para desligar a trava; vazia não desliga. O config.json não foi tocado.`;
}

function linhaDoAusente(arquivo = CONFIG_FILE) {
  return `${ABRE} não há config.json em ${arquivo}. Sem ele o motor subiria com os padrões, sem autenticação e com a conta agindo sozinha. Confira se o volume de dados está montado e grave o config.json da instância (${GUIA}). O config.json não foi criado.`;
}

function temFronteira(config) {
  const origens = config && config.origensPermitidas;
  return !!(config && config.hostPublico) || (Array.isArray(origens) && origens.length > 0);
}

/* As linhas da recusa para a config JÁ SANEADA (bind, hostPublico e origensPermitidas como o
   listen e o porteiro vão ler). Lista vazia: a instância pode subir, ou a trava está desligada. */
function recusasDaHospedagem(config, modo = modoHospedado(), arquivo = CONFIG_FILE) {
  if (!modo || !modo.ligada) return [];
  const fim = `Corrija ${arquivo} (o arquivo não foi alterado; ${GUIA}).`;
  const linhas = [];
  if (!exigida(config || {})) linhas.push(`${ABRE} o config.json não exige autenticação na API. Grave "hostPublico" ou "origensPermitidas" (qualquer um dos dois liga a exigência, sem chave que desligue) e "localAuth": "exigir". ${fim}`);
  if (!temFronteira(config)) linhas.push(`${ABRE} o config.json não define "hostPublico" nem "origensPermitidas". Grave o nome com que o proxy chega ao motor em "hostPublico" e a origem do front em "origensPermitidas". ${fim}`);
  return linhas;
}

/* Os avisos para a config JÁ SANEADA que passou pela trava e não atende. Não recusam o boot: a
   API não fica aberta em nenhum dos dois casos, só inalcançável.
   - bind em loopback (ou ausente, que é 127.0.0.1): dentro do container o motor escuta só para
     o próprio container, e o proxy, que chega pela rede, não conecta;
   - origensPermitidas sem hostPublico, com bind fora do loopback: a allowlist de Host
     (lib/http-guard.js) aceita só 127.0.0.1, localhost e o próprio bind, com a porta. O nome
     público que o proxy entrega no Host é recusado com 403, a menos que o proxy o reescreva. */
function avisosDaHospedagem(config, modo = modoHospedado()) {
  if (!modo || !modo.ligada) return [];
  const c = config || {};
  const abre = `[farol] instância hospedada (${VARIAVEL}=1):`;
  if (loopback(c.bind)) return [`${abre} "bind" está em loopback (ou ausente), então o motor escuta só dentro do container e o proxy não o alcança. Grave "bind": "0.0.0.0" em ${CONFIG_FILE} e reinicie (${GUIA}).`];
  if (c.hostPublico) return [];
  const aceitos = ['127.0.0.1', 'localhost', c.bind].map((h) => `${h}:${c.port}`).join(', ');
  return [`${abre} há "origensPermitidas" sem "hostPublico", então o motor só aceita o Host ${aceitos}. O pedido que o proxy entregar com o nome público no Host recebe 403, a menos que o proxy reescreva o Host. Grave em "hostPublico" o nome com que o proxy chega ao motor, em ${CONFIG_FILE}, e reinicie (${GUIA}).`];
}

export default { VARIAVEL, CODIGO, modoHospedado, recusasDaHospedagem, avisosDaHospedagem, linhaDoAusente, linhaDoValorInvalido };
export { VARIAVEL, CODIGO, modoHospedado, recusasDaHospedagem, avisosDaHospedagem, linhaDoAusente, linhaDoValorInvalido };
