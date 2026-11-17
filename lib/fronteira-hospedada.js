// A carga do config.json no boot e as RECUSAS DE BOOT: arquivo presente e ilegível (inclusive o
// link simbólico que aponta para nada), nome de chave errado nas quatro chaves da fronteira, e
// valor inválido nelas (hostPublico, origensPermitidas, localAuth e bind). Também saneia, uma
// vez, as chaves só de arquivo que chegam ao listen, à allowlist e ao porteiro.
//
// Por que recusar em vez de sanear calado. hostPublico e origensPermitidas são o que liga a
// exigência de autenticação no motor hospedado (lib/local-auth/modo.js), e localAuth e bind são
// as outras duas chaves que a ligam. O saneador devolve vazio (ou o loopback) para o que não
// serve, e vazio quer dizer "não hospedado": com o motor em loopback atrás de um proxy que
// reescreve o Host, um erro de digitação (`https://farol.exemplo.com`, uma barra no fim da
// origem, `"localAuth": "Exigir"`) deixava a API inteira sem autenticação, sem uma linha de log,
// e a primeira gravação do config.json ainda apagava a chave errada. São chaves de quem está
// hospedando de propósito: erro nelas tem de ser barulhento. Então, se a chave veio preenchida
// no arquivo e o valor não serve (inteiro, ou QUALQUER item da lista), o motor não sobe.
//
// O mesmo vale para o NOME da chave. A carga (normalizarConfig) descarta chave desconhecida sem
// log: `hostpublico`, `host_publico` ou `origensPermitida` sumiam, e o motor subia aberto. Chave
// que não é a grafia exata e lembra uma das quatro também impede o boot.
//
// Vazio de verdade continua sem erro: chave ausente, null, '' nas chaves de texto e [] na lista
// são "não hospedado". Tipo trocado ([] no texto, '' na lista) não é vazio, é erro.
// A conferência lê o arquivo como veio e roda antes de qualquer gravação: o config.json fica
// como estava, que é a evidência de quem vai corrigir.
//
// A chave `socket` (o socket Unix em que o motor escuta no lugar da porta, lib/escuta-em-socket.js)
// segue a mesma régua: nome parecido (`sock`, `socketPath`) e valor que não serve (caminho
// relativo, nulo, comprido demais para o sun_path, pasta que não existe ou que o grupo ou os
// outros gravam) impedem o boot. E duas combinações: socket com bind, e socket sem hostPublico.
//
// A instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1, lib/instancia-hospedada.js) acrescenta
// três recusas a este mesmo caminho: config.json ausente, que fora dela é a instalação nova e
// sobe; config que não exige autenticação; e config sem hostPublico nem origensPermitidas.
import fs from 'node:fs';
import { sanear, SETTINGS, CHAVES_SO_DE_ARQUIVO } from './settings.js';
import { safeStringify, lerJsonTeimoso } from './io.js';
import { semControle } from './format.js';
import { CONFIG_FILE } from './paths.js';
import env from './env.js';
import { EXIGIR } from './local-auth/modo.js';
import hospedagem from './instancia-hospedada.js';
import { motivoDoSocket } from './escuta-em-socket.js';

const SO_DE_ARQUIVO = ['bind', 'hostPublico', 'origensPermitidas', 'socket'];
const CODIGO = 'FRONTEIRA_INVALIDA';
const CODIGO_ILEGIVEL = 'CONFIG_ILEGIVEL';
const VALOR_MAX = 300;
const FORMATO = Object.freeze({
  hostPublico: 'um nome de host ou um IPv4, sem esquema, sem caminho, sem porta e sem espaço, por exemplo "farol.exemplo.com"',
  origensPermitidas: 'uma lista de origens exatas "https://host" ou "https://host:porta", sem caminho, sem barra final e sem a porta padrão, por exemplo ["https://front.exemplo.com"]; "http://" só para localhost e 127.0.0.1',
  localAuth: `só o texto "${EXIGIR}", em minúsculas, que liga a exigência de autenticação; para não exigir, apague a chave`,
  bind: 'um IPv4, um IPv6 entre colchetes ou um nome de host, sem esquema, sem porta e sem espaço, por exemplo "0.0.0.0"; a porta vai na chave "port"',
  socket: 'o caminho absoluto de um socket Unix, sem caractere nulo nem de controle, com até 107 bytes, numa pasta que existe e não é gravável pelo grupo nem pelos outros, por exemplo "/home/farol/run/motor.sock"',
});
const FIM = `Corrija ou apague a chave em ${CONFIG_FILE} (o arquivo não foi alterado).`;

// Caractere que um terminal ou um leitor de log trata como comando ou como quebra de linha vira
// \uXXXX: além dos controles que a linha do log já escapa (lib/format.js), o DEL, os C1 (U+0080
// a U+009F, onde moram o CSI U+009B e o NEL U+0085) e os separadores de linha U+2028 e U+2029.
function semControleDeTerminal(texto) {
  return semControle(texto).replace(/[\u007F-\u009F\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// O valor recusado entra na mensagem: é nome de host, origem ou nome de chave, não é segredo. Vai
// serializado (quebra de linha e aspas saem escapadas, então não forja linha no log), filtrado e
// com teto de tamanho.
function mostrar(valores) {
  const texto = semControleDeTerminal(valores.map((v) => safeStringify(v) ?? String(v)).join(', '));
  return texto.length > VALOR_MAX ? `${texto.slice(0, VALOR_MAX)}...` : texto;
}

/* ---------- nome de chave errado ---------- */

// Toda chave que a carga lê pela grafia exata: nenhuma delas cai na regra de nomes.
const CONHECIDAS = new Set([...SETTINGS.map((s) => s.key), ...CHAVES_SO_DE_ARQUIVO]);
// Como uma chave desconhecida começa quando quem escreveu queria uma das da fronteira.
const LEMBRA = Object.freeze([['host', 'hostPublico'], ['origens', 'origensPermitidas'], ['origem', 'origensPermitidas'], ['origin', 'origensPermitidas'], ['localauth', 'localAuth'], ['sock', 'socket'], ['unixsock', 'socket']]);

// A chave sem caixa, sem `_`, sem `-` e sem espaço: é assim que `Host_Publico` casa com hostPublico.
function semForma(chave) {
  return chave.toLowerCase().replace(/[\s_-]/g, '');
}

// A grafia certa da chave que o arquivo escreveu errado, ou '' quando a chave não é problema:
// é conhecida, ou é desconhecida e não lembra a fronteira (essa segue descartada sem erro).
function grafiaCerta(chave) {
  if (CONHECIDAS.has(chave)) return '';
  const forma = semForma(chave);
  const igual = Object.keys(FORMATO).find((certa) => semForma(certa) === forma);
  if (igual) return igual;
  const parecida = LEMBRA.find(([comeco]) => forma.startsWith(comeco));
  return parecida ? parecida[1] : '';
}

function recusasDeNome(arquivo) {
  return Object.keys(arquivo)
    .map((chave) => [chave, grafiaCerta(chave)])
    .filter(([, certa]) => certa)
    .map(([chave, certa]) => `[farol] config.json inválido, o motor não sobe: a chave ${mostrar([chave])} não existe; a grafia certa é "${certa}" (maiúsculas e minúsculas contam, sem "_", "-" nem espaço). ${FIM}`);
}

/* ---------- valor inválido ---------- */

function vazio(chave, valor) {
  if (valor === undefined || valor === null) return true;
  return chave === 'origensPermitidas' ? Array.isArray(valor) && valor.length === 0 : valor === '';
}

// O valor preenchido serve? Caixa alta em host e bind não é erro: o saneador acerta, não descarta.
const SERVE = Object.freeze({
  hostPublico: (cru, fns) => sanear('hostPublico', cru, {}, fns) !== '',
  // o único valor que lib/local-auth/modo.js lê; qualquer outro ("Exigir", true, "sim") era "não exige" calado
  localAuth: (cru) => cru === EXIGIR,
  // o saneador devolve o loopback para o que não serve: só serve o que volta igual ao que entrou
  bind: (cru, fns) => typeof cru === 'string' && sanear('bind', cru, {}, fns) === cru.toLowerCase(),
  // o formato e a pasta (lib/escuta-em-socket.js); o motivo entra na mensagem (MOTIVO, abaixo)
  socket: (cru) => !motivoDoSocket(cru),
});
// O porquê da recusa, quando a chave sabe dizê-lo melhor que o formato aceito.
const MOTIVO = Object.freeze({ socket: (cru) => ` (${motivoDoSocket(cru)})` });

// O que não serve nesta chave: o valor inteiro, ou os itens da lista que o saneador descarta.
// Item repetido não entra: o saneador o acerta.
function descartados(chave, cru, fns) {
  if (vazio(chave, cru)) return [];
  if (chave !== 'origensPermitidas') return SERVE[chave](cru, fns) ? [] : [cru];
  if (!Array.isArray(cru)) return [cru];
  return cru.filter((item) => sanear(chave, [item], {}, fns).length === 0);
}

/** As linhas da recusa: uma por chave de nome errado e uma por chave com valor inválido. Lista vazia: o arquivo serve. */
function recusasDaFronteira(cru, fns) {
  const arquivo = cru && typeof cru === 'object' ? cru : {};
  const deValor = Object.keys(FORMATO)
    .map((chave) => [chave, descartados(chave, arquivo[chave], fns)])
    .filter(([, recusados]) => recusados.length)
    .map(([chave, recusados]) => `[farol] config.json inválido, o motor não sobe: "${chave}" tem valor recusado: ${mostrar(recusados)}${MOTIVO[chave] ? semControleDeTerminal(MOTIVO[chave](recusados[0])) : ''}. Formato aceito: ${FORMATO[chave]}. ${FIM}`);
  return [...recusasDeNome(arquivo), ...deValor, ...recusasDoSocket(arquivo)];
}

/* O socket com o que não combina com ele, conferido no arquivo como veio:
   - com "bind": o motor escuta num lugar só, e com socket a porta TCP não abre. O bind escrito
     diz que quem configurou espera uma porta aberta naquele endereço, e ela não existiria;
   - sem "hostPublico": pelo socket não há porta nem endereço de origem, e a allowlist de Host
     aceita só o hostPublico (lib/http-guard.js). Sem ele todo pedido do proxy receberia 403.
     Com ele, a autenticação é sempre exigida (lib/local-auth/modo.js). */
function recusasDoSocket(arquivo) {
  if (vazio('socket', arquivo.socket)) return [];
  const linhas = [];
  if (!vazio('bind', arquivo.bind)) linhas.push(`[farol] config.json inválido, o motor não sobe: "socket" e "bind" juntos. Com "socket" o motor escuta só no socket Unix e a porta TCP não abre, então o "bind" não teria efeito, e quem o escreveu espera uma porta que não existiria. Apague um dos dois. ${FIM}`);
  if (vazio('hostPublico', arquivo.hostPublico)) linhas.push(`[farol] config.json inválido, o motor não sobe: "socket" sem "hostPublico". Pelo socket não há porta nem endereço de origem, e o motor aceita só o Host público que o proxy repassa; sem ele todo pedido receberia 403. Grave em "hostPublico" o domínio público do proxy. ${FIM}`);
  return linhas;
}

/* Saneia as três chaves na config do engine. Antes, confere os nomes e os valores da fronteira
   contra o arquivo como veio (`engine.configCrua`); com recusa, registra no farol.log (o arquivo
   é criado se a pasta `state/` já existir; sem a pasta, nada é criado) e lança. Nada mais é
   gravado antes disto. */
function sanearSoDeArquivo(engine, fns) {
  const linhas = recusasDaFronteira(engine.configCrua, fns);
  if (linhas.length) {
    for (const linha of linhas) engine.log('ERROR', linha);
    throw Object.assign(new Error(linhas.join('\n')), { code: CODIGO });
  }
  for (const chave of SO_DE_ARQUIVO) engine.config[chave] = sanear(chave, engine.config[chave], engine.config, fns);
  // a instância hospedada confere a config já saneada, que é a que o listen e o porteiro leem
  recusarSeHouver(hospedagem.recusasDaHospedagem(engine.config), (linha) => engine.log('ERROR', linha));
  avisarDepoisDoBoot(engine, hospedagem.avisosDaHospedagem(engine.config));
}

/* A config que passa pela trava e não atende vira WARN, uma linha por aviso, no farol.log e no
   stderr (que é o log do container). No turno seguinte do laço, e não agora: aqui a pasta de
   estado de um volume novo ainda não existe (quem a cria é o prepareHome, logo adiante no
   construtor), e a linha gravada agora se perderia justamente na primeira subida. */
function avisarDepoisDoBoot(engine, avisos) {
  if (!avisos.length) return;
  setImmediate(() => {
    for (const aviso of avisos) {
      engine.log('WARN', aviso);
      console.error(semControleDeTerminal(aviso));
    }
  });
}

// As linhas da trava da instância hospedada viram a recusa de boot: log, e lança. Sem linha, nada.
function recusarSeHouver(linhas, log) {
  if (!linhas.length) return;
  if (log) for (const linha of linhas) log(linha);
  throw Object.assign(new Error(linhas.join('\n')), { code: hospedagem.CODIGO });
}

/* ---------- config.json presente e ilegível ----------
   Até a fase 2a o arquivo que não era JSON virava os padrões, com um aviso no log e uma cópia
   `.bad` ao lado. Os padrões são loopback puro, sem autenticação, e a conta padrão age sozinha:
   quem hospedou com hostPublico e a política em espera e corrompeu o arquivo (edição pela metade,
   vírgula sobrando) ganhava uma instância aberta que aprova sozinha. Agora o motor não sobe.
   Ilegível é: não dá para ler, está vazio (zero bytes ou só espaço), não é JSON, é JSON que não
   é objeto, ou é um link simbólico que aponta para um arquivo que não existe. Arquivo AUSENTE é
   outra coisa, a instalação nova, e sobe.

   Zero bytes entra em "ilegível" de propósito: o motor só grava o config.json por escrita
   atômica (temporário e renomear), que nunca deixa o arquivo vazio; vazio é sinal de edição ou
   cópia interrompida, não de instalação nova. Instalação nova é não ter o arquivo.

   O BOM UTF-8 no início não é erro: editor do Windows o grava, e a leitura o ignora
   (lerJsonTeimoso, lib/io.js).

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

// A leitura respondeu "não existe" (ENOENT). Ou o nome não existe mesmo, e é a instalação nova,
// ou o nome existe e é um link simbólico para nada (volume que não montou, alvo apagado): aí
// subir com os padrões trocaria o link por um arquivo novo, com a instância aberta. O lstat olha
// o próprio nome, sem seguir o link.
function motivoDoAusente(arquivo) {
  try { fs.lstatSync(arquivo); } catch (erro) { return erro.code === 'ENOENT' ? '' : `não deu para ler (${erro.message})`; }
  return 'é um link simbólico que aponta para um arquivo que não existe';
}

// '' quando o arquivo serve (ou não existe); senão, o motivo da recusa.
function motivoDoIlegivel(lido, cru, arquivo) {
  if (!lido.ok && lido.motivo === 'ausente') return motivoDoAusente(arquivo);
  if (!lido.ok && cru === null) return `não deu para ler (${lido.motivo})`;
  if (!lido.ok) return cru.trim() === '' ? 'o arquivo está vazio' : `não é JSON válido${ondeQuebra(lido.motivo)}`;
  const objeto = !!lido.data && typeof lido.data === 'object' && !Array.isArray(lido.data);
  return objeto ? '' : `é JSON válido, mas não é um objeto (é ${tipoDe(lido.data)})`;
}

/* O config.json como veio do disco: o objeto, ou {} quando o arquivo não existe. Presente e
   ilegível, registra no farol.log (criado se a pasta `state/` já existir) e lança. `log` recebe
   a linha. Na instância hospedada, ausente também lança (lib/instancia-hospedada.js). */
function lerConfigOuRecusar(log, arquivo = CONFIG_FILE) {
  // a variável da instância hospedada com valor que não é "1" nem "0" recusa antes de ler o arquivo
  const modo = hospedagem.modoHospedado();
  if (modo.invalido) recusarSeHouver([hospedagem.linhaDoValorInvalido(mostrar([env.instanciaHospedada()]))], log);
  let cru = null;
  const lido = lerJsonTeimoso(arquivo, { tentativas: 1, ler: (f) => (cru = fs.readFileSync(f, 'utf8')) });
  const motivo = motivoDoIlegivel(lido, cru, arquivo);
  // ausente é a instalação nova, menos na instância hospedada: lá é o volume que não montou
  if (!motivo && !lido.ok && modo.ligada) recusarSeHouver([hospedagem.linhaDoAusente(arquivo)], log);
  if (!motivo) return lido.ok ? lido.data : {};
  const linha = `[farol] config.json ilegível, o motor não sobe: ${motivo}. Arquivo: ${arquivo}. Corrija o arquivo: ele não foi alterado nem renomeado, e o motor não sobe com os padrões no lugar dele.`;
  if (log) log(linha);
  throw Object.assign(new Error(linha), { code: CODIGO_ILEGIVEL });
}

/* Roda a subida do motor (`node server.js`). As recusas de boot (as daqui e as da instância
   hospedada) saem limpas: a mensagem no stderr, pelo mesmo filtro de controles do valor
   recusado (que cobre o da linha do log), sem pilha, e código de saída 1. Qualquer outro erro
   segue como antes. */
function subirOuRecusar(subir) {
  try { return subir(); } catch (erro) {
    if (!erro || ![CODIGO, CODIGO_ILEGIVEL, hospedagem.CODIGO].includes(erro.code)) throw erro;
    console.error(semControleDeTerminal(erro.message));
    process.exit(1);
  }
}

export default { sanearSoDeArquivo, recusasDaFronteira, lerConfigOuRecusar, subirOuRecusar };
export { sanearSoDeArquivo, recusasDaFronteira, lerConfigOuRecusar, subirOuRecusar };
