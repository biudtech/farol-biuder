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
// recusas de boot (lib/fronteira-hospedada.js, que chama este módulo): mensagem no stderr e no
// farol.log, código de saída 1, e nada é criado nem alterado no HOME do Farol.
//
// A regra de "exige autenticação" não é copiada aqui: é a do porteiro (lib/local-auth/acesso.js).
// Como hostPublico e origensPermitidas ligam a exigência sozinhos, sem chave que desligue, a
// instância hospedada que passa pela terceira recusa sempre exige autenticação; a segunda existe
// para a mensagem dizer as duas coisas a quem subiu um config.json de máquina local.
import env from './env.js';
import { CONFIG_FILE } from './paths.js';
import { exigida } from './local-auth/acesso.js';

const VARIAVEL = 'FAROL_INSTANCIA_HOSPEDADA';
const CODIGO = 'INSTANCIA_HOSPEDADA';
const GUIA = 'docs/HOSPEDAGEM.md';
const ABRE = `[farol] instância hospedada (${VARIAVEL}=1), o motor não sobe:`;

/* Só "1" liga. Ausente, vazia e "0" desligam ("0" existe para quem roda a imagem numa máquina
   de desenvolvimento). Qualquer outro valor é INVÁLIDO, e não desligado: "true" ou "sim" virando
   desligado em silêncio devolveria o motor aberto que a variável existe para impedir. */
function modoHospedado(valor = env.instanciaHospedada()) {
  if (valor === undefined || valor === '' || valor === '0') return { ligada: false, invalido: false };
  return { ligada: valor === '1', invalido: valor !== '1' };
}

function linhaDoValorInvalido(mostrado) {
  return `[farol] ${VARIAVEL} inválida, o motor não sobe: o valor ${mostrado} não é aceito. Use "1" para a instância hospedada (o padrão da imagem do container) ou "0" para desligar a trava. Nada foi criado nem alterado.`;
}

function linhaDoAusente(arquivo = CONFIG_FILE) {
  return `${ABRE} não há config.json em ${arquivo}. Sem ele o motor subiria com os padrões, sem autenticação e com a conta agindo sozinha. Confira se o volume de dados está montado e grave o config.json da instância (${GUIA}). Nada foi criado.`;
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

export default { VARIAVEL, CODIGO, modoHospedado, recusasDaHospedagem, linhaDoAusente, linhaDoValorInvalido };
export { VARIAVEL, CODIGO, modoHospedado, recusasDaHospedagem, linhaDoAusente, linhaDoValorInvalido };
