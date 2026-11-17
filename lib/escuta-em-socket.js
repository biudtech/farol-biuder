// A escuta num SOCKET UNIX (config.socket, só de arquivo), no lugar da porta TCP.
//
// Por que existe. Numa hospedagem compartilhada (vários clientes na mesma máquina, sem
// container), a porta em 127.0.0.1 é alcançável por qualquer usuário da máquina: o loopback
// não separa ninguém ali. O socket Unix com permissão 600 só aceita conexão do próprio usuário
// (e do root), e é nele que o proxy da hospedagem entrega os pedidos. Com `socket` o motor
// escuta SÓ no socket: a porta TCP não abre (nunca os dois).
//
// A trava de instância única continua sendo o listen. Na porta, o segundo motor recebe
// EADDRINUSE. No socket o arquivo sobra no disco quando o processo morre sem a saída ordenada
// (SIGKILL, queda da máquina), e o listen num caminho que existe também dá EADDRINUSE, mesmo
// sem ninguém escutando. Por isso, antes do listen, o motor conecta no caminho: conexão aceita
// é outro motor vivo, e a subida é recusada como a porta ocupada; ECONNREFUSED é arquivo
// órfão, que é removido, e o motor sobe. O que existe no caminho e não é socket (arquivo,
// pasta, link simbólico) nunca é apagado: a subida é recusada.
//
// Resta uma janela: dois motores subindo no mesmo instante sobre um socket órfão podem os dois
// ver ECONNREFUSED. Ela dura o intervalo entre a sonda de um e o listen do outro, e só existe
// com o órfão no disco; quem sobe o motor (o supervisor da hospedagem) sobe um processo só.
//
// A permissão 600 vale desde o bind: a máscara do processo fica em 177 durante o listen (o
// bind é síncrono dentro do listen), e o chmod depois confere. A pasta do socket já foi
// conferida no boot (não gravável pelo grupo nem pelos outros, lib/fronteira-hospedada.js):
// ninguém troca o arquivo entre o bind e o chmod.
//
// Na saída ordenada (lib/engine/saida-ordenada.js) o socket é removido, só se ainda for o
// mesmo arquivo que este processo criou (dispositivo, inode e ctime em nanossegundos).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { TEMPOS } from './constants.js';
import { motivoDoFormatoDoSocket } from './parse.js';

const MASCARA_DO_BIND = 0o177;
const PERMISSAO = 0o600;
// gravável pelo grupo ou pelos outros
const GRAVAVEL_POR_OUTROS = 0o022;

/* A pasta do socket: tem de existir, ser pasta e não ser gravável pelo grupo nem pelos outros
   (quem grava na pasta troca o socket por outro e recebe os pedidos do proxy). */
function motivoDaPasta(valor) {
  const pasta = path.dirname(valor);
  let st;
  try { st = fs.statSync(pasta); } catch (erro) {
    return erro.code === 'ENOENT' ? `a pasta ${pasta} não existe` : `a pasta ${pasta} não pode ser lida (${erro.code || erro.message})`;
  }
  if (!st.isDirectory()) return `${pasta} não é uma pasta`;
  if (st.mode & GRAVAVEL_POR_OUTROS) return `a pasta ${pasta} é gravável pelo grupo ou pelos outros (modo ${(st.mode & 0o7777).toString(8)}); use uma pasta só do usuário do motor, como 700`;
  return '';
}

/** O valor preenchido serve? '' quando sim; senão o motivo, para a mensagem da recusa. */
function motivoDoSocket(valor) {
  return motivoDoFormatoDoSocket(valor) || motivoDaPasta(valor);
}

// Alguém aceita conexão no caminho? true: vivo; false: órfão (ECONNREFUSED) ou sumiu (ENOENT).
// Outro erro (sem permissão, por exemplo) e a sonda que não responde no prazo contam como vivo:
// na dúvida, não se apaga o socket de ninguém.
function sondar(caminho) {
  return new Promise((resolve) => {
    const s = net.connect({ path: caminho });
    const fim = (vivo) => { clearTimeout(prazo); s.destroy(); resolve(vivo); };
    const prazo = setTimeout(() => fim(true), TEMPOS.SOCKET_SONDA_MS);
    s.once('connect', () => fim(true));
    s.once('error', (erro) => fim(!['ECONNREFUSED', 'ENOENT'].includes(erro.code)));
  });
}

function erroDeSubida(mensagem, code) {
  return Object.assign(new Error(mensagem), { code });
}

/* Deixa o caminho livre para o listen, ou lança a recusa. Ausente: nada a fazer. Socket vivo:
   EADDRINUSE, como a porta ocupada. Socket órfão: removido. Outra coisa no caminho: recusa. */
async function liberarCaminho(caminho) {
  let st;
  try { st = fs.lstatSync(caminho); } catch (erro) {
    if (erro.code === 'ENOENT') return;
    throw erro;
  }
  if (!st.isSocket()) throw erroDeSubida(`${caminho} existe e não é um socket; o motor não o apaga. Remova o arquivo ou troque "socket" no config.json`, 'SOCKET_OCUPADO_POR_ARQUIVO');
  if (await sondar(caminho)) throw erroDeSubida(`o socket ${caminho} já está em uso por outro processo (outro motor neste caminho?)`, 'EADDRINUSE');
  fs.unlinkSync(caminho);
}

/* O listen no socket: libera o caminho, escuta com a máscara 177 e confere a permissão.
   `pronto(erro)` é chamado uma vez; sem erro, o motor guarda a identidade do arquivo para a
   saída ordenada. */
function escutarNoSocket(server, caminho, pronto) {
  liberarCaminho(caminho).then(() => escutarComMascara(server, caminho, () => conferirPermissao(server, caminho, pronto)), (erro) => pronto(erro));
}

// O bind acontece dentro do listen, de forma síncrona: a máscara 177 vale só ali.
function escutarComMascara(server, caminho, aoEscutar) {
  const anterior = process.umask(MASCARA_DO_BIND);
  try { server.listen(caminho, aoEscutar); } finally { process.umask(anterior); }
}

function conferirPermissao(server, caminho, pronto) {
  try {
    fs.chmodSync(caminho, PERMISSAO);
    pronto(null, identidade(caminho));
  } catch (erro) { server.close(); pronto(erro); }
}

// A identidade do arquivo: dispositivo, inode e a hora da última mudança de metadado em
// nanossegundos (o chmod do listen). O inode sozinho não basta: o sistema reaproveita o número
// de um socket apagado no socket seguinte, e a saída ordenada apagaria o de outro processo.
function identidade(caminho) {
  const st = fs.lstatSync(caminho, { bigint: true });
  return { caminho, dev: String(st.dev), ino: String(st.ino), ctimeNs: String(st.ctimeNs) };
}

/** Remove o socket que este processo criou, e só ele (mesma identidade). Nunca lança. */
function removerSocketProprio(escutado) {
  if (!escutado || !escutado.caminho) return false;
  try {
    if (!fs.lstatSync(escutado.caminho).isSocket()) return false;
    const agora = identidade(escutado.caminho);
    if (['dev', 'ino', 'ctimeNs'].some((k) => agora[k] !== escutado[k])) return false;
    fs.unlinkSync(escutado.caminho);
    return true;
  } catch { return false; }
}

export default { motivoDoSocket, escutarNoSocket, removerSocketProprio, sondar };
export { motivoDoSocket, escutarNoSocket, removerSocketProprio, sondar };
