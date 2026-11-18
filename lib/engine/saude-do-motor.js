// A saúde do próprio motor, que a linha Saúde do Sistema mostra (17/11/2026). Vai no `doctor`
// (a chave do snapshot e GET /api/doctor), medida a cada diagnóstico:
//   - `noArDesde`: o início do processo (process.uptime), em ms. A tela escreve "no ar há";
//   - `commit`: o commit do código em execução, lido uma vez da pasta `.git` do código, sem rodar
//     o `git` (HEAD direto, ou a ref solta, ou o packed-refs; a worktree pelo `gitdir` e o
//     `commondir`). Na imagem do container a pasta `.git` não entra (.dockerignore) e o
//     package.json não guarda commit: lá a chave vai null, e a tela fica com a versão;
//   - `disco`: o espaço livre e o total do sistema de arquivos da pasta de dados (`fs.statfs` de
//     HOME, ~/.farol ou FAROL_HOME), para o usuário comum (`bavail`);
//   - `telemetria`: se o consumo e o histórico estão gravando no banco (telemetria-do-motor.js,
//     historico-na-subida.js) e a última escrita, pela hora de modificação do arquivo do banco e
//     do `-wal` ao lado. Com WAL, todo COMMIT escreve no `-wal`; leitura não muda nenhum dos dois.
// Só lê: nunca lança, e o que não deu para medir vai null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, TELEMETRIA_DB } from '../paths.js';

const INICIO_DO_PROCESSO = Math.round(Date.now() - (process.uptime() * 1000));
const RAIZ_DO_CODIGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = /^[0-9a-f]{40}$/;
// a ref que o HEAD aponta: só caminho dentro de refs/, sem subir de pasta
const REF = /^ref:\s*(refs\/[A-Za-z0-9._/-]+)$/;

function lerTexto(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch { return ''; }
}

function pastaDoGit(raiz) {
  const ponto = path.join(raiz, '.git');
  let st;
  try { st = fs.statSync(ponto); } catch { return null; }
  if (st.isDirectory()) return ponto;
  const m = /^gitdir:\s*(.+)$/m.exec(lerTexto(ponto));
  return m ? path.resolve(raiz, m[1].trim()) : null;
}

function shaDaRef(pasta, ref) {
  const solto = lerTexto(path.join(pasta, ...ref.split('/'))).trim();
  if (SHA.test(solto)) return solto;
  const linha = lerTexto(path.join(pasta, 'packed-refs')).split('\n').find((l) => l.trim().endsWith(` ${ref}`));
  const sha = linha ? linha.slice(0, 40) : '';
  return SHA.test(sha) ? sha : null;
}

// O commit do HEAD do repositório em `raiz`, pelos arquivos do git. null sem repositório.
function commitDoRepositorio(raiz) {
  const pasta = pastaDoGit(raiz);
  if (!pasta) return null;
  const head = lerTexto(path.join(pasta, 'HEAD')).trim();
  if (SHA.test(head)) return head;
  const ref = REF.exec(head);
  if (!ref || ref[1].includes('..')) return null;
  const comum = lerTexto(path.join(pasta, 'commondir')).trim();
  const pastas = comum ? [pasta, path.resolve(pasta, comum)] : [pasta];
  for (const p of pastas) {
    const sha = shaDaRef(p, ref[1]);
    if (sha) return sha;
  }
  return null;
}

let commitLido;
// lido uma vez por processo: o código em execução não muda de commit sem reiniciar
function commitDoMotor() {
  if (commitLido === undefined) commitLido = commitDoRepositorio(RAIZ_DO_CODIGO);
  return commitLido;
}

function discoDaPasta(pasta) {
  try {
    const s = fs.statfsSync(pasta);
    const bloco = Number(s.bsize);
    const livreBytes = Number(s.bavail) * bloco;
    const totalBytes = Number(s.blocks) * bloco;
    return Number.isFinite(livreBytes) && totalBytes > 0 ? { livreBytes, totalBytes } : null;
  } catch { return null; }
}

function modificadoEm(arquivo) {
  try { return Math.round(fs.statSync(arquivo).mtimeMs); } catch { return null; }
}

function aberto(h) { return !!(h && h.db && h.db.isOpen); }

function telemetriaDoMotor(engine, banco = TELEMETRIA_DB) {
  const e = engine || {};
  const escritas = [modificadoEm(banco), modificadoEm(`${banco}-wal`)].filter((n) => n !== null);
  const telemetria = { consumoNoBanco: aberto(e.telemetria), historicoNoBanco: aberto(e.historicoH) && e.historicoNoBanco === true };
  if (escritas.length) telemetria.ultimaEscritaEm = Math.max(...escritas);
  return telemetria;
}

function saudeDoMotor(engine, { agora = Date.now(), pasta = HOME, banco = TELEMETRIA_DB } = {}) {
  return { medidoEm: agora, noArDesde: INICIO_DO_PROCESSO, commit: commitDoMotor(), disco: discoDaPasta(pasta), telemetria: telemetriaDoMotor(engine, banco) };
}

export default { saudeDoMotor, commitDoRepositorio, discoDaPasta, telemetriaDoMotor };
export { saudeDoMotor, commitDoRepositorio, discoDaPasta, telemetriaDoMotor };
