// Instalação explícita do runtime privado, sem dependências no engine ou nos PRs.
//
//   node lib/technical-review/setup.js [--source <caminho ou URL>]
//
// Clona a origem, faz checkout do commit do pino (tool.json), constrói e só então troca a pasta
// em ~/.farol/toolchains. Tudo acontece numa pasta de preparo ao lado (`.install-*`), que some no
// fim, com sucesso ou com falha: a instalação válida que já existe nunca é tocada por uma
// tentativa que não terminou.
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
import { TOOL_HOME, requireTool } from './runtime.js';
import { TOOL } from './verdict.js';
import { executadoDireto } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { envGitIsolado, FLAGS_GIT_ISOLADO, FLAGS_CREDENCIAL_DO_GH, flagsDeRedeDaMaquina } from '../git-isolado.js';
import { randomUUID } from 'node:crypto';
import { privateChild, removePrivateDirectory } from './cleanup.js';
import { FalhaDoPasso, origemDoGitHub, origemComCredencial, origemMostrada, falhaDoClone, falhaDoPino,
  falhaDaConstrucao, ORIGEM_COM_CREDENCIAL } from './setup-falhas.js';

// O fim da saída de cada passo, guardado só para classificar a falha. A saída inteira já foi
// para o terminal de quem roda.
const TETO_DA_SAIDA = 16 * 1024;
// Pasta de preparo mais velha do que isto é sobra de uma instalação morta sem chance de limpar
// (SIGKILL, queda da máquina): nenhum passo dura mais do que o prazo da construção.
const SOBRA_APOS_MS = 2 * TEMPOS.CONSTRUCAO_FERRAMENTA_MS;

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

// As pastas de preparo que uma instalação morta deixou. Só as velhas: uma recente pode ser de
// outra instalação em andamento.
function removerSobras(parent, agora = Date.now()) {
  for (const nome of fs.readdirSync(parent)) {
    if (!nome.startsWith('.install-') || nome === '.install-') continue;
    const alvo = path.join(parent, nome);
    let idade;
    try { idade = agora - fs.lstatSync(alvo).mtimeMs; } catch { continue; }
    if (idade > SOBRA_APOS_MS) removePrivateDirectory(alvo, parent, '.install-');
  }
}

// O clone. Para a origem HTTPS do GitHub: git isolado (sem config da máquina, só https) mais a
// credencial do `gh`, com as mensagens em inglês porque a saída é lida para dar nome à falha.
async function clonar(run, source, staging, parent, signal) {
  if (!origemDoGitHub(source)) {
    // Sem shell para caminhos fornecidos por quem opera a instalação.
    return run('git', ['clone', '--no-hardlinks', '--', source, staging], parent, { signal });
  }
  const env = { ...envGitIsolado(), LC_ALL: 'C', LANGUAGE: 'C' };
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
  fs.mkdirSync(parent, { recursive: true });
  removerSobras(parent);
  const staging = fs.mkdtempSync(path.join(parent, '.install-'));
  const origem = origemMostrada(source);
  try {
    await passo(() => clonar(run, source, staging, parent, signal), (falha) => falhaDoClone(falha, origem));
    await passo(() => run('git', ['cat-file', '-e', `${TOOL.commit}^{commit}`], staging, { signal }), (falha) => falhaDoPino(falha, origem));
    await passo(() => run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', TOOL.commit], staging, { signal }), (falha) => falhaDoPino(falha, origem));
    for (const [binary, ...args] of TOOL.construcao) {
      await passo(() => run(binary, args, staging, { signal }), falhaDaConstrucao);
    }
    fs.writeFileSync(path.join(staging, TOOL.buildStamp), TOOL.commit + '\n');
    await verify(staging);
    if (fs.existsSync(home)) {
      const previous = privateChild(home, parent, 'eng-behaviour@');
      const backup = privateChild(`${home}.incomplete-${randomUUID()}`, parent, 'eng-behaviour@');
      fs.renameSync(previous, backup); // Preserva uma instalação anterior que não validou.
    }
    fs.renameSync(privateChild(staging, parent, '.install-'), privateChild(home, parent, 'eng-behaviour@'));
    return await verify(home);
  } finally { removePrivateDirectory(staging, parent, '.install-'); }
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

export { setup, step, removerSobras, SOBRA_APOS_MS };
