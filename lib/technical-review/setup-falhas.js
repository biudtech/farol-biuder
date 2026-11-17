// As falhas da instalação da ferramenta da avaliação técnica (setup.js), cada uma com o nome
// dela. PURO: recebe o que o passo devolveu e a origem já sem credencial, devolve o texto.
//
// Por que existe. A instalação dizia só "não terminou", e quem opera um container não tem como
// adivinhar se falta o login do `gh`, o gerenciador de pacotes, a rede ou o commit do pino. As
// quatro causas pedem ações diferentes.
//
// A classificação lê o fim da saída do `git` e do gerenciador de pacotes, em inglês fixo: todo
// passo do setup (clone, cat-file, checkout, pnpm install e pnpm build) roda com LC_ALL=C. É
// lista fechada de trechos; saída que não casa com nenhuma vira a mensagem genérica do passo,
// com o código de saída, nunca um palpite. Do pnpm vale o ÚLTIMO código ERR_PNPM_* da saída: um
// aviso de rede com nova tentativa antes de um erro de outra natureza não faz o erro virar rede.
import { TOOL } from './verdict.js';

const PINO = 'lib/technical-review/tool.json';

class FalhaDoPasso extends Error {
  // tipo: 'ausente' (o binário não existe), 'saiu' (código diferente de zero), 'sinal' (morto
  // por um sinal que não veio da instalação, como um kill de fora), 'prazo', 'cancelado' ou
  // 'erro' (o processo não pôde ser criado)
  constructor(binary, args, { tipo, codigo = null, sinal = '', saida = '' }) {
    super(`o passo "${binary}" da instalação da ferramenta técnica não terminou`);
    this.binary = binary; this.args = args; this.tipo = tipo; this.codigo = codigo; this.sinal = sinal; this.saida = String(saida || '');
  }
}

// Só o endereço HTTPS de um repositório do GitHub, sem usuário, senha, porta nem consulta.
const GITHUB_HTTPS = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
function origemDoGitHub(source) {
  const m = GITHUB_HTTPS.exec(String(source || ''));
  return m ? `${m[1]}/${m[2]}` : '';
}

// `https://usuario:token@host/...`: o token ficaria na linha de comando, na lista de processos e
// no config do clone. A instalação recusa antes de rodar qualquer coisa.
function origemComCredencial(source) {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(String(source || ''));
}
const ORIGEM_COM_CREDENCIAL = 'a origem da ferramenta técnica traz credencial na URL, e a instalação não aceita: o token ficaria na linha de comando e no clone. Use a URL sem usuário nem token e faça o login do gh ("gh auth login"); o clone usa a credencial do gh.';

// `?access_token=...` ou `#...`: o mesmo risco por outra porta (argv, lista de processos,
// mensagem). Recusada antes de qualquer comando, e a mensagem não repete a origem.
function origemComConsulta(source) {
  return /[?#]/.test(String(source || ''));
}
const ORIGEM_COM_CONSULTA = 'a origem da ferramenta técnica traz consulta ou fragmento ("?" ou "#"), e a instalação não aceita: um token ali ficaria na linha de comando e na mensagem. Use a URL ou o caminho sem "?" nem "#"; o clone do GitHub usa a credencial do gh.';

// A origem como vai para a mensagem: sem a parte de usuário e senha, se houver.
function origemMostrada(source) {
  return String(source || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
}

const SEM_ACESSO = /Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Repository not found|returned error: 40[134]|Invalid username or (?:password|token)|Permission to \S+ denied/i;
const SEM_REDE = /Could not resolve host|Failed to connect|Connection (?:timed out|refused|reset)|Operation timed out|unable to access [^\n]*(?:timed out|resolve)|Network is unreachable|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ERR_SOCKET_TIMEOUT|request to \S+ failed/i;
// O `gh` que o helper de credencial chama não existe: o git segue sem credencial e diz que não leu
// o usuário, o que pareceria falta de acesso.
const SEM_GH = /\bgh: (?:command )?not found/i;
// Os códigos do pnpm: o de rede (META_FETCH_FAIL e FETCH_ que não é resposta 4xx do registro) e o
// de acesso recusado pelo registro (401 e 403).
const PNPM_REDE = /^ERR_PNPM_(?:META_FETCH_FAIL|FETCH_(?!4\d\d)\w+)$/;
const PNPM_RECUSA = /^ERR_PNPM_FETCH_40[13]$/;
const ultimoErroDoPnpm = (saida) => [...String(saida || '').matchAll(/ERR_PNPM_[A-Z0-9_]+/g)].at(-1)?.[0] || '';

const REFAZER = 'Rode a instalação de novo depois de corrigir: nada foi instalado, e a instalação anterior, se havia, ficou como estava.';

function interrompida(falha) {
  if (falha.tipo === 'prazo') return `o passo "${falha.binary}" passou do prazo da instalação e foi encerrado. ${REFAZER}`;
  if (falha.tipo === 'cancelado') return `a instalação da ferramenta técnica foi interrompida no passo "${falha.binary}". ${REFAZER}`;
  if (falha.tipo === 'sinal') return `o passo "${falha.binary}" foi encerrado pelo sinal ${falha.sinal || 'desconhecido'} antes de terminar. ${REFAZER}`;
  return '';
}

function semGit() {
  return `o "git" não está instalado ou não está no PATH do usuário que roda a instalação. ${REFAZER}`;
}

function falhaDoClone(falha, origem) {
  if (falha.tipo === 'ausente') return semGit();
  const parou = interrompida(falha);
  if (parou) return parou;
  const repo = origemDoGitHub(origem);
  if (SEM_GH.test(falha.saida)) return `o "gh" não está instalado ou não está no PATH do usuário que roda a instalação: o clone do repositório privado usa o login dele. ${REFAZER}`;
  if (SEM_ACESSO.test(falha.saida)) {
    const comoConferir = repo ? ` Confira com "gh auth status" e "gh repo view ${repo}", como o usuário do motor.` : '';
    return `sem acesso ao repositório da ferramenta técnica (${origem}): o gh não está logado, ou a conta logada não enxerga esse repositório.${comoConferir} ${REFAZER}`;
  }
  if (SEM_REDE.test(falha.saida)) return `falha de rede no clone da ferramenta técnica: ${origem} não respondeu. Confira a saída de rede para o endereço. ${REFAZER}`;
  return `o clone da ferramenta técnica (${origem}) não terminou: o git saiu com código ${falha.codigo}. A saída do git está acima. ${REFAZER}`;
}

function falhaDoPino(falha, origem) {
  if (falha.tipo === 'ausente') return semGit();
  return interrompida(falha)
    || `o commit do pino (${TOOL.commit}, em ${PINO}) não existe em ${origem}: a origem não é o repositório da ferramenta, ou o commit não está em nenhuma branch nem tag dela. ${REFAZER}`;
}

// O cat-file acabou de provar que o commit existe: falha aqui é do checkout (disco, permissão).
function falhaDoCheckout(falha) {
  if (falha.tipo === 'ausente') return semGit();
  return interrompida(falha)
    || `o checkout do commit do pino (${TOOL.commit}) não terminou: o git saiu com código ${falha.codigo}. A saída do git está acima. ${REFAZER}`;
}

function falhaDaConstrucao(falha) {
  const comando = [falha.binary, ...falha.args].join(' ');
  if (falha.tipo === 'ausente') {
    return `o gerenciador de pacotes "${falha.binary}" não está instalado ou não está no PATH: a construção da ferramenta técnica roda "${comando}". A imagem do container já o traz; fora dela, instale a versão que o Dockerfile fixa. ${REFAZER}`;
  }
  const parou = interrompida(falha);
  if (parou) return parou;
  const erro = ultimoErroDoPnpm(falha.saida);
  if (PNPM_RECUSA.test(erro)) return `o registro de pacotes recusou o acesso em "${comando}" (${erro}): confira o registro e a credencial configurados para o usuário que roda a instalação. ${REFAZER}`;
  if (erro ? PNPM_REDE.test(erro) : SEM_REDE.test(falha.saida)) return `falha de rede em "${comando}": o registro de pacotes não respondeu ao baixar as dependências da ferramenta técnica. Confira a saída de rede para registry.npmjs.org. ${REFAZER}`;
  return `"${comando}" não terminou: saiu com código ${falha.codigo}${erro ? ` (${erro})` : ''}. A saída do comando está acima. ${REFAZER}`;
}

export { FalhaDoPasso, origemDoGitHub, origemComCredencial, origemComConsulta, origemMostrada, falhaDoClone, falhaDoPino, falhaDoCheckout,
  falhaDaConstrucao, ORIGEM_COM_CREDENCIAL, ORIGEM_COM_CONSULTA };
