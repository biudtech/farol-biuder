// Instalação explícita do runtime privado, sem dependências no engine ou nos PRs.
//
//   node lib/technical-review/setup.js [--source <caminho ou URL>]
//
// Clona a origem, faz checkout do commit do pino (tool.json), constrói e só então troca a pasta
// em ~/.farol/toolchains. Tudo acontece numa pasta de preparo ao lado (`.install-*`), que some no
// fim, com sucesso ou com falha: a instalação válida que já existe nunca é tocada por uma
// tentativa que não terminou.
//
// Uma instalação por vez: a trava (`.instalacao.trava`, criada com `wx`, com o pid e a hora) fica
// em toolchains do começo ao fim. A segunda instalação que a acha sai sem tocar em nada; só quem
// detém a trava limpa as pastas de preparo que sobraram, e logo antes de trocar a pasta a
// instalação confere de novo se a do lugar já vale (outra via pode tê-la posto ali).
//
// A origem HTTPS do GitHub é clonada com o git isolado do motor mais a credencial do `gh`
// (lib/git-isolado.js), a mesma da busca das fontes de revisão: o repositório da ferramenta é
// privado, e o token nunca vai em argumento, em URL nem no log. Caminho local e outras origens
// seguem com o git comum, sem credencial.
//
// Cada falha tem a própria mensagem (setup-falhas.js): quem opera precisa saber se falta o
// login do `gh`, o gerenciador de pacotes, a rede ou o commit do pino.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import io from '../io.js';
import { TOOL_HOME, requireTool } from './runtime.js';
import { raizDoPacote } from './toolchain.js';
import { TOOL } from './verdict.js';
import { executadoDireto } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { envGitIsolado, FLAGS_GIT_ISOLADO, FLAGS_CREDENCIAL_DO_GH, flagsDeRedeDaMaquina } from '../git-isolado.js';
import { randomUUID } from 'node:crypto';
import { privateChild, removePrivateDirectory } from './cleanup.js';
import { FalhaDoPasso, origemDoGitHub, origemComCredencial, origemComConsulta, origemMostrada, falhaDoClone,
  falhaDoPino, falhaDoCheckout, falhaDaConstrucao, ORIGEM_COM_CREDENCIAL, ORIGEM_COM_CONSULTA } from './setup-falhas.js';

// O fim da saída de cada passo, guardado só para classificar a falha. A saída inteira já foi
// para o terminal de quem roda.
const TETO_DA_SAIDA = 16 * 1024;
// A trava da instalação, em toolchains. Não começa com `.install-`, então a limpeza não a alcança.
const TRAVA = '.instalacao.trava';
// A classificação das falhas lê a saída em inglês (setup-falhas.js): todo passo roda com o
// idioma fixo, o clone, o cat-file, o checkout e a construção.
const IDIOMA_FIXO = Object.freeze({ LC_ALL: 'C', LANGUAGE: 'C' });

// Um passo da instalação. A saída vai ao terminal enquanto roda, e o fim dela fica na falha.
// O filho é líder de grupo: o prazo e o cancelamento matam a árvore (o pnpm abre filhos).
function step(binary, args, cwd, { env = envSemRepositorioHerdado(), signal } = {}) {
  return new Promise((resolve, reject) => {
    let saida = '', encerrado = false, motivo = '';
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const matar = (porque) => {
      motivo = motivo || porque;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* o grupo já saiu */ }
    };
    const prazo = setTimeout(() => matar('prazo'), TEMPOS.CONSTRUCAO_FERRAMENTA_MS);
    const cancelar = () => matar('cancelado');
    if (signal?.aborted) cancelar(); else signal?.addEventListener('abort', cancelar, { once: true });
    const guardar = (destino) => (pedaco) => {
      destino.write(pedaco);
      saida = (saida + pedaco).slice(-TETO_DA_SAIDA);
    };
    child.stdout.on('data', guardar(process.stdout));
    child.stderr.on('data', guardar(process.stderr));
    const fim = (falha) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(prazo);
      signal?.removeEventListener('abort', cancelar);
      if (falha) reject(new FalhaDoPasso(binary, args, { ...falha, saida })); else resolve();
    };
    child.on('error', (error) => fim({ tipo: error.code === 'ENOENT' ? 'ausente' : 'erro' }));
    child.on('close', (code, sinal) => {
      if (motivo) return fim({ tipo: motivo });
      if (sinal) return fim({ tipo: 'sinal', sinal });
      return fim(code === 0 ? null : { tipo: 'saiu', codigo: code });
    });
  });
}

// As pastas de preparo que uma instalação morta deixou (SIGKILL, queda da máquina). Só quem
// detém a trava chama: com ela, nenhuma outra instalação está em curso, e toda `.install-*` é sobra.
function removerSobras(parent) {
  for (const nome of fs.readdirSync(parent)) {
    if (!nome.startsWith('.install-') || nome === '.install-') continue;
    removePrivateDirectory(path.join(parent, nome), parent, '.install-');
  }
}

// A trava: criada com `wx`, falha se já existe. Quem a acha sai com o pid e a hora de quem a pôs.
function travar(parent) {
  const arquivo = path.join(parent, TRAVA);
  try {
    fs.writeFileSync(arquivo, io.safeStringify({ pid: process.pid, hora: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
    return arquivo;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let dono = {};
    try { dono = io.parseJson(fs.readFileSync(arquivo, 'utf8')) || {}; } catch { /* trava ilegível: sem pid nem hora */ }
    const desde = typeof dono.hora === 'string' ? dono.hora : 'hora desconhecida';
    const pid = Number.isInteger(dono.pid) ? ` (pid ${dono.pid})` : '';
    throw new Error(`outra instalação da ferramenta técnica em curso desde ${desde}${pid}; se ela morreu, apague ${arquivo} e rode a instalação de novo. Nada foi tocado.`);
  }
}

// O clone. Para a origem HTTPS do GitHub: git isolado (sem config da máquina, só https) mais a
// credencial do `gh`, com as mensagens em inglês porque a saída é lida para dar nome à falha.
async function clonar(run, source, staging, parent, { env: envComum, signal }) {
  if (!origemDoGitHub(source)) {
    // Sem shell para caminhos fornecidos por quem opera a instalação.
    return run('git', ['clone', '--no-hardlinks', '--', source, staging], parent, { env: envComum, signal });
  }
  const env = { ...envGitIsolado(), ...IDIOMA_FIXO };
  const args = [...FLAGS_GIT_ISOLADO, ...await flagsDeRedeDaMaquina(signal), ...FLAGS_CREDENCIAL_DO_GH, 'clone', '--', source, staging];
  return run('git', args, parent, { env, signal });
}

// Falha de um passo vira a mensagem dela; erro que não é de passo (o dublê de um teste, o disco)
// sobe como veio.
async function passo(executar, mensagem) {
  try { return await executar(); }
  catch (error) { throw error instanceof FalhaDoPasso ? new Error(mensagem(error), { cause: error }) : error; }
}

async function setup(argv = process.argv.slice(2), { home = TOOL_HOME, run = step, verify = requireTool, signal } = {}) {
  let valid = false;
  if (fs.existsSync(home)) {
    try { await verify(home); valid = true; } catch { valid = false; }
  }
  if (valid) return home;
  const parent = path.dirname(home);
  const index = argv.indexOf('--source');
  const source = index >= 0 ? argv[index + 1] : TOOL.origem;
  if (!source) throw new Error('origem da ferramenta ausente');
  if (origemComCredencial(source)) throw new Error(ORIGEM_COM_CREDENCIAL);
  if (origemComConsulta(source)) throw new Error(ORIGEM_COM_CONSULTA);
  fs.mkdirSync(parent, { recursive: true });
  const trava = travar(parent);
  let staging = null;
  try {
    removerSobras(parent);
    staging = fs.mkdtempSync(path.join(parent, '.install-'));
    return await instalar({ home, parent, staging, source, run, verify, signal });
  } finally {
    if (staging) removePrivateDirectory(staging, parent, '.install-');
    fs.rmSync(trava, { force: true });
  }
}

async function instalar({ home, parent, staging, source, run, verify, signal }) {
  const origem = origemMostrada(source);
  const opcoes = { env: { ...envSemRepositorioHerdado(), ...IDIOMA_FIXO }, signal };
  await passo(() => clonar(run, source, staging, parent, opcoes), (falha) => falhaDoClone(falha, origem));
  await passo(() => run('git', ['cat-file', '-e', `${TOOL.commit}^{commit}`], staging, opcoes), (falha) => falhaDoPino(falha, origem));
  await passo(() => run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', TOOL.commit], staging, opcoes), falhaDoCheckout);
  // A construção roda na pasta do pacote; o clone inteiro fica, porque é nele que o git confere
  // o commit e a árvore limpa (toolchain.js).
  const pacote = raizDoPacote(staging);
  for (const [binary, ...args] of TOOL.construcao) {
    await passo(() => run(binary, args, pacote, opcoes), falhaDaConstrucao);
  }
  fs.writeFileSync(path.join(pacote, TOOL.buildStamp), TOOL.commit + '\n');
  await verify(staging);
  // Outra via pode ter posto a ferramenta no lugar enquanto esta construía: a que já vale fica.
  if (fs.existsSync(home)) {
    try { return await verify(home); } catch { /* não vale: segue a troca */ }
    const previous = privateChild(home, parent, 'eng-behaviour@');
    const backup = privateChild(`${home}.incomplete-${randomUUID()}`, parent, 'eng-behaviour@');
    fs.renameSync(previous, backup); // Preserva uma instalação anterior que não validou.
  }
  fs.renameSync(privateChild(staging, parent, '.install-'), privateChild(home, parent, 'eng-behaviour@'));
  return verify(home);
}

// Rodado direto: SIGINT e SIGTERM cancelam o passo em curso, e a pasta de preparo é removida
// antes de sair.
function principal() {
  const cancelamento = new AbortController();
  for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => cancelamento.abort());
  return setup(process.argv.slice(2), { signal: cancelamento.signal })
    .then((home) => process.stdout.write(`Ferramenta técnica instalada em ${home}\n`))
    .catch((error) => {
      process.stderr.write(error.message + '\n');
      process.exitCode = 2;
    });
}

if (executadoDireto(import.meta.url)) principal();

export { setup, step, removerSobras, TRAVA };
