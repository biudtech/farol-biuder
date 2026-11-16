// A carga do config.json no boot e as duas RECUSAS DE BOOT: arquivo presente e ilegível, e valor
// inválido nas duas chaves da fronteira (hostPublico e origensPermitidas). Também saneia, uma
// vez, as chaves só de arquivo que chegam ao listen, à allowlist e ao porteiro.
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
import fs from 'node:fs';
import { sanear } from './settings.js';
import { safeStringify, lerJsonTeimoso } from './io.js';
import { CONFIG_FILE } from './paths.js';

const SO_DE_ARQUIVO = ['bind', 'hostPublico', 'origensPermitidas'];
const CODIGO = 'FRONTEIRA_INVALIDA';
const CODIGO_ILEGIVEL = 'CONFIG_ILEGIVEL';
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

/* ---------- config.json presente e ilegível ----------
   Até a fase 2a o arquivo que não era JSON virava os padrões, com um aviso no log e uma cópia
   `.bad` ao lado. Os padrões são loopback puro, sem autenticação, e a conta padrão age sozinha:
   quem hospedou com hostPublico e a política em espera e corrompeu o arquivo (edição pela metade,
   vírgula sobrando) ganhava uma instância aberta que aprova sozinha. Agora o motor não sobe.
   Ilegível é: não dá para ler, está vazio (zero bytes ou só espaço), não é JSON, ou é JSON que
   não é objeto. Arquivo AUSENTE é outra coisa, a instalação nova, e sobe.

   Zero bytes entra em "ilegível" de propósito: o motor só grava o config.json por escrita
   atômica (temporário e renomear), que nunca deixa o arquivo vazio; vazio é sinal de edição ou
   cópia interrompida, não de instalação nova. Instalação nova é não ter o arquivo.

   A leitura é uma só e não cria nada: sem cópia `.bad`, sem renomear, sem regravar. */

// O que há de errado no JSON, SEM o trecho do arquivo que a mensagem do parser cita: a chave de
// API do perfil do Claude mora neste arquivo, e o trecho pode cair em cima dela. Do erro do
// parser fica só a posição.
function ondeQuebra(mensagemDoParser) {
  const m = /\(line (\d+) column (\d+)\)/.exec(String(mensagemDoParser || ''));
  return m ? ` (linha ${m[1]}, coluna ${m[2]})` : '';
}

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'uma lista';
  return { string: 'um texto', number: 'um número', boolean: 'um booleano' }[typeof valor] || 'outra coisa';
}

// '' quando o arquivo serve (ou não existe); senão, o motivo da recusa.
function motivoDoIlegivel(lido, cru) {
  if (!lido.ok && lido.motivo === 'ausente') return '';
  if (!lido.ok && cru === null) return `não deu para ler (${lido.motivo})`;
  if (!lido.ok) return cru.trim() === '' ? 'o arquivo está vazio' : `não é JSON válido${ondeQuebra(lido.motivo)}`;
  const objeto = !!lido.data && typeof lido.data === 'object' && !Array.isArray(lido.data);
  return objeto ? '' : `é JSON válido, mas não é um objeto (é ${tipoDe(lido.data)})`;
}

/* O config.json como veio do disco: o objeto, ou {} quando o arquivo não existe. Presente e
   ilegível, registra no farol.log (se ele já existir) e lança. `log` recebe a linha. */
function lerConfigOuRecusar(log, arquivo = CONFIG_FILE) {
  let cru = null;
  const lido = lerJsonTeimoso(arquivo, { tentativas: 1, ler: (f) => (cru = fs.readFileSync(f, 'utf8')) });
  const motivo = motivoDoIlegivel(lido, cru);
  if (!motivo) return lido.ok ? lido.data : {};
  const linha = `[farol] config.json ilegível, o motor não sobe: ${motivo}. Arquivo: ${arquivo}. Corrija o arquivo: ele não foi alterado nem renomeado, e o motor não sobe com os padrões no lugar dele.`;
  if (log) log(linha);
  throw Object.assign(new Error(linha), { code: CODIGO_ILEGIVEL });
}

/* Roda a subida do motor (`node server.js`). As duas recusas de boot saem limpas: a mensagem no
   stderr, sem pilha, e código de saída 1. Qualquer outro erro segue como antes. */
function subirOuRecusar(subir) {
  try { return subir(); } catch (erro) {
    if (!erro || ![CODIGO, CODIGO_ILEGIVEL].includes(erro.code)) throw erro;
    console.error(erro.message);
    process.exit(1);
  }
}

export default { sanearSoDeArquivo, recusasDaFronteira, lerConfigOuRecusar, subirOuRecusar };
export { sanearSoDeArquivo, recusasDaFronteira, lerConfigOuRecusar, subirOuRecusar };
