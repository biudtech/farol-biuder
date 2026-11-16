// As chaves só de arquivo que chegam ao listen, à allowlist e ao porteiro (bind, hostPublico e
// origensPermitidas), saneadas uma vez no boot, e a RECUSA DE BOOT das duas da fronteira.
//
// Por que recusar em vez de sanear calado. hostPublico e origensPermitidas são o que liga a
// exigência de autenticação no motor hospedado (lib/local-auth/modo.js). O saneador devolve
// vazio para o que não serve, e vazio quer dizer "não hospedado": com o motor em loopback atrás
// de um proxy que reescreve o Host, um erro de digitação (`https://farol.exemplo.com`, uma barra
// no fim da origem) deixava a API inteira sem autenticação, sem uma linha de log, e a primeira
// gravação do config.json ainda apagava a chave errada. São chaves de quem está hospedando de
// propósito: erro nelas tem de ser barulhento. Então, se a chave veio preenchida no arquivo e o
// saneador descartou o valor inteiro ou QUALQUER item da lista, o motor não sobe.
//
// Vazio de verdade continua sem erro: chave ausente, null, '' e [] são "não hospedado".
// A conferência compara o arquivo como veio com o saneado, e roda antes de qualquer gravação:
// o config.json fica como estava, que é a evidência de quem vai corrigir.
import { sanear } from './settings.js';
import { safeStringify } from './io.js';
import { CONFIG_FILE } from './paths.js';

const SO_DE_ARQUIVO = ['bind', 'hostPublico', 'origensPermitidas'];
const CODIGO = 'FRONTEIRA_INVALIDA';
const VALOR_MAX = 300;
const FORMATO = Object.freeze({
  hostPublico: 'um nome de host ou um IPv4, sem esquema, sem caminho, sem porta e sem espaço, por exemplo "farol.exemplo.com"',
  origensPermitidas: 'uma lista de origens exatas "https://host" ou "https://host:porta", sem caminho, sem barra final e sem a porta padrão, por exemplo ["https://front.exemplo.com"]; "http://" só para localhost e 127.0.0.1',
});

function vazio(valor) {
  return valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0);
}

// O que o saneador descartou desta chave: o valor inteiro, ou os itens da lista que não servem.
// Caixa alta e item repetido não entram: o saneador os acerta, não os descarta.
function descartados(chave, cru, fns) {
  if (vazio(cru)) return [];
  if (chave === 'hostPublico') return sanear(chave, cru, {}, fns) === '' ? [cru] : [];
  if (!Array.isArray(cru)) return [cru];
  return cru.filter((item) => sanear(chave, [item], {}, fns).length === 0);
}

// O valor recusado entra na mensagem: é nome de host ou origem, não é segredo. Vai serializado
// (quebra de linha e aspas saem escapadas, então não forja linha no log) e com teto de tamanho.
function mostrar(valores) {
  const texto = valores.map((v) => safeStringify(v) ?? String(v)).join(', ');
  return texto.length > VALOR_MAX ? `${texto.slice(0, VALOR_MAX)}...` : texto;
}

/** As linhas da recusa, uma por chave com valor inválido. Lista vazia: o arquivo serve. */
function recusasDaFronteira(cru, fns) {
  const arquivo = cru && typeof cru === 'object' ? cru : {};
  return Object.keys(FORMATO)
    .map((chave) => [chave, descartados(chave, arquivo[chave], fns)])
    .filter(([, recusados]) => recusados.length)
    .map(([chave, recusados]) => `[farol] config.json inválido, o motor não sobe: "${chave}" tem valor recusado: ${mostrar(recusados)}. Formato aceito: ${FORMATO[chave]}. Corrija ou apague a chave em ${CONFIG_FILE} (o arquivo não foi alterado).`);
}

/* Saneia as três chaves na config do engine. Antes, confere as duas da fronteira contra o
   arquivo como veio (`engine.configCrua`); com valor inválido registra no farol.log, se ele já
   existir, e lança. Nada é gravado antes disto. */
function sanearSoDeArquivo(engine, fns) {
  const linhas = recusasDaFronteira(engine.configCrua, fns);
  if (linhas.length) {
    for (const linha of linhas) engine.log('ERROR', linha);
    throw Object.assign(new Error(linhas.join('\n')), { code: CODIGO });
  }
  for (const chave of SO_DE_ARQUIVO) engine.config[chave] = sanear(chave, engine.config[chave], engine.config, fns);
}

/* Roda a subida do motor (`node server.js`). A recusa da fronteira sai limpa: a mensagem no
   stderr, sem pilha, e código de saída 1. Qualquer outro erro segue como antes. */
function subirOuRecusar(subir) {
  try { return subir(); } catch (erro) {
    if (!erro || erro.code !== CODIGO) throw erro;
    console.error(erro.message);
    process.exit(1);
  }
}

export default { sanearSoDeArquivo, recusasDaFronteira, subirOuRecusar };
export { sanearSoDeArquivo, recusasDaFronteira, subirOuRecusar };
