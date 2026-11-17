// Servidor próprio, OPCIONAL, do front em produção: sobe o Next (`next({ dev: false })`, o
// mesmo handler do `next start`) e escuta num socket Unix dado por FAROL_WEB_SOCKET, no lugar
// de uma porta TCP. É o caminho da hospedagem compartilhada (docs/HOSPEDAGEM.md): ali a porta em
// 127.0.0.1 é alcançável por qualquer usuário da máquina, e o socket com permissão 600 só pelo
// próprio usuário. Um proxy da hospedagem entrega os pedidos no socket.
//
// O caminho padrão continua sendo `npm start` (`next start`). Este arquivo só roda por
// `npm run start:socket`, depois de `npm run build`.
//
// A CSP por nonce de src/proxy.ts continua saindo: o proxy (o middleware do Next) roda dentro do
// handler, e o handler é o mesmo do `next start`.
//
// O socket, como no motor (lib/escuta-em-socket.js, na raiz do repositório):
// - FAROL_WEB_SOCKET ausente, vazia ou inválida: recusa com a mensagem e código 1;
// - caminho absoluto, sem nulo nem caractere de controle, até 107 bytes (o sun_path do Linux),
//   numa pasta que existe e não é gravável pelo grupo nem pelos outros;
// - socket vivo no caminho (alguém aceita a conexão): recusa, como a porta ocupada;
// - socket órfão (ECONNREFUSED): removido, e o servidor sobe;
// - outra coisa no caminho (arquivo, pasta, link): recusa, sem apagar;
// - permissão 600 desde o bind (máscara 177 durante o listen) e conferida por chmod;
// - SIGTERM e SIGINT: fecha o servidor e remove o socket, só se ainda for o que ele criou.
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VARIAVEL = 'FAROL_WEB_SOCKET';
const SOCKET_MAX_BYTES = 107;
const SONDA_MS = 2000;
const MASCARA_DO_BIND = 0o177;
const PERMISSAO = 0o600;
const GRAVAVEL_POR_OUTROS = 0o022;
const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** '' quando o caminho serve; senão o motivo. */
export function motivoDoCaminho(caminho) {
  if (typeof caminho !== 'string' || caminho === '') return `${VARIAVEL} não está definida`;
  if (caminho.includes('\0')) return `${VARIAVEL} tem o caractere nulo`;
  if (!caminho.startsWith('/')) return `${VARIAVEL} não é um caminho absoluto`;
  if (caminho.endsWith('/')) return `${VARIAVEL} termina em barra, é uma pasta`;
  if (/[\u0001-\u001f\u007f]/.test(caminho)) return `${VARIAVEL} tem caractere de controle`;
  const bytes = Buffer.byteLength(caminho, 'utf8');
  if (bytes > SOCKET_MAX_BYTES) return `${VARIAVEL} tem ${bytes} bytes, e o limite de socket Unix no Linux é ${SOCKET_MAX_BYTES}`;
  const pasta = path.dirname(caminho);
  let st;
  try { st = fs.statSync(pasta); } catch (erro) {
    return erro.code === 'ENOENT' ? `a pasta ${pasta} não existe` : `a pasta ${pasta} não pode ser lida (${erro.code || erro.message})`;
  }
  if (!st.isDirectory()) return `${pasta} não é uma pasta`;
  if (st.mode & GRAVAVEL_POR_OUTROS) return `a pasta ${pasta} é gravável pelo grupo ou pelos outros (modo ${(st.mode & 0o7777).toString(8)}); use uma pasta só deste usuário, como 700`;
  return '';
}

// Alguém aceita conexão no caminho? Sem resposta no prazo, ou erro que não é ECONNREFUSED nem
// ENOENT, conta como vivo: na dúvida, não se apaga o socket de ninguém.
function sondar(caminho) {
  return new Promise((resolve) => {
    const s = net.connect({ path: caminho });
    const fim = (vivo) => { clearTimeout(prazo); s.destroy(); resolve(vivo); };
    const prazo = setTimeout(() => fim(true), SONDA_MS);
    s.once('connect', () => fim(true));
    s.once('error', (erro) => fim(!['ECONNREFUSED', 'ENOENT'].includes(erro.code)));
  });
}

/** Deixa o caminho livre para o listen, ou lança a recusa. */
export async function liberarCaminho(caminho) {
  let st;
  try { st = fs.lstatSync(caminho); } catch (erro) {
    if (erro.code === 'ENOENT') return;
    throw erro;
  }
  if (!st.isSocket()) throw new Error(`${caminho} existe e não é um socket; o servidor não o apaga`);
  if (await sondar(caminho)) throw Object.assign(new Error(`o socket ${caminho} já está em uso por outro processo`), { code: 'EADDRINUSE' });
  fs.unlinkSync(caminho);
}

/** Escuta no socket com permissão 600. Resolve com a identidade do arquivo criado. */
export async function escutarNoSocket(server, caminho) {
  await liberarCaminho(caminho);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    const anterior = process.umask(MASCARA_DO_BIND);
    try { server.listen(caminho, resolve); } finally { process.umask(anterior); }
  });
  fs.chmodSync(caminho, PERMISSAO);
  return identidade(caminho);
}

// Dispositivo, inode e ctime em nanossegundos (o do chmod): o inode sozinho não basta, porque o
// sistema reaproveita o número de um socket apagado no seguinte.
function identidade(caminho) {
  const st = fs.lstatSync(caminho, { bigint: true });
  return { caminho, dev: String(st.dev), ino: String(st.ino), ctimeNs: String(st.ctimeNs) };
}

/** Remove o socket que este processo criou, e só ele. Nunca lança. */
export function removerSocketProprio(escutado) {
  if (!escutado) return false;
  try {
    if (!fs.lstatSync(escutado.caminho).isSocket()) return false;
    const agora = identidade(escutado.caminho);
    if (['dev', 'ino', 'ctimeNs'].some((k) => agora[k] !== escutado[k])) return false;
    fs.unlinkSync(escutado.caminho);
    return true;
  } catch { return false; }
}

function recusar(motivo) {
  console.error(`[farol-web] o servidor não sobe: ${motivo}. Para a porta TCP, use "npm start". Para o socket: ${VARIAVEL}=/caminho/absoluto/web.sock npm run start:socket, depois de npm run build.`);
  process.exit(1);
}

async function principal() {
  const caminho = process.env[VARIAVEL];
  const motivo = motivoDoCaminho(caminho);
  if (motivo) return recusar(motivo);
  const { default: next } = await import('next');
  const app = next({ dev: false, dir: AQUI });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = http.createServer((req, res) => handler(req, res));
  let escutado;
  try { escutado = await escutarNoSocket(server, caminho); } catch (erro) { return recusar(erro.message); }
  let saindo = false;
  const sair = () => {
    if (saindo) return;
    saindo = true;
    removerSocketProprio(escutado);
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SONDA_MS).unref();
  };
  for (const sinal of ['SIGTERM', 'SIGINT']) process.once(sinal, sair);
  console.log(`[farol-web] escutando em unix:${caminho}`);
}

// Executado direto (`node servidor.mjs`), não importado pelo teste.
const direto = process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (direto) principal().catch((erro) => recusar(erro && erro.message ? erro.message : String(erro)));
