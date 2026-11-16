// O que o motor lê e roda na pasta de um perfil de assinatura do Claude (15/11/2026, a
// assinatura voltou ao motor por decisão do dono). Veio do lib/engine/perfil-claude.js de
// antes do corte 09, sem o login padrão da máquina: aqui toda pasta é a de um perfil.
//
// Três coisas, e nenhuma grava na pasta da assinatura:
//   - `ambienteDoPerfil`: o ambiente de um comando do CLI que roda naquela pasta (status,
//     uso do plano, login), sem credencial herdada do motor;
//   - `rodarNaCopia`: um comando do CLI que não chama modelo, contra uma CÓPIA efêmera da
//     configuração do perfil;
//   - `temCredencial` e `infoDaPasta`: há login gravado na pasta? Só a existência do arquivo
//     da credencial, que o motor nunca abre;
//   - `recusaSemLogin`: a recusa da sessão cujo perfil de assinatura está sem login.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import io from '../io.js';
import { TEMPOS } from '../constants.js';
import { semAsVariaveis } from '../env.js';
import { applyClaudeAuthEnv } from '../parse.js';

// Ambiente limpo: sem o token do GitHub (esses comandos não mexem no gh) e sem nenhuma
// credencial do Claude herdada. Com ANTHROPIC_API_KEY no ambiente do motor, a precedência
// do Claude Code põe a chave acima do login, e o comando rodaria na conta errada, calado.
function ambienteDoPerfil(dir) {
  const env = { ...semAsVariaveis(['GH_TOKEN', 'GITHUB_TOKEN']), GH_PAGER: 'cat', PAGER: 'cat' };
  applyClaudeAuthEnv(env, { kind: 'dir', dir });
  return env;
}

// O que o CLI lê da pasta de configuração, além da credencial: a conta (e-mail) e os
// settings (que podem mudar o método de autenticação). A credencial NUNCA é copiada.
const ARQUIVOS_DA_PASTA = Object.freeze(['.claude.json', 'settings.json', '.config.json']);

// Cópia efêmera e privada da configuração do perfil. Medido com o Claude Code 2.1.268:
// `claude auth status` REESCREVE o `.claude.json` da pasta de configuração e cria `backups/`
// nela, mesmo numa pasta vazia. Sem a cópia, "testar" alterava a pasta real da assinatura.
// Cópia esquecida por um processo que morreu no meio carrega uma CÓPIA do .claude.json do
// perfil (conta e projetos) e ninguém a apaga. Antes de criar a próxima, varre as antigas:
// as recentes podem ser de outra execução em andamento e ficam.
const PREFIXO_COPIA = 'farol-perfil-claude-';

function varrerCopiasVelhas(agora = Date.now()) {
  const raiz = os.tmpdir();
  let nomes = [];
  try { nomes = fs.readdirSync(raiz).filter((n) => n.startsWith(PREFIXO_COPIA)); } catch { return; }
  for (const nome of nomes) {
    const alvo = path.join(raiz, nome);
    try {
      if (agora - fs.statSync(alvo).mtimeMs < TEMPOS.HORA_MS) continue;
      fs.rmSync(alvo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch { /* cópia de outro usuário ou em uso: não é nossa para apagar */ }
  }
}

function copiaEfemera(dir) {
  varrerCopiasVelhas();
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), PREFIXO_COPIA));
  fs.chmodSync(copia, 0o700);
  try {
    for (const nome of ARQUIVOS_DA_PASTA) {
      const origem = path.join(dir, nome);
      if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(copia, nome));
    }
  } catch (err) {
    fs.rmSync(copia, { recursive: true, force: true });
    throw err;
  }
  return copia;
}

// Um comando do CLI que não chama modelo, contra a cópia efêmera: a pasta da assinatura não
// é escrita. A configuração é a cópia, e CLAUDE_SECURESTORAGE_CONFIG_DIR aponta para a pasta
// ORIGINAL, que é de onde o CLI lê a credencial (o `.credentials.json`, no Linux). `opts` vai
// ao `runShell` (o prazo, por exemplo).
async function rodarNaCopia(dir, comando, opts = {}) {
  const copia = copiaEfemera(dir);
  try {
    const env = ambienteDoPerfil(dir);
    env.CLAUDE_CONFIG_DIR = copia;
    env.CLAUDE_SECURESTORAGE_CONFIG_DIR = dir;
    return await io.runShell(comando, { ...opts, env, cwd: copia });
  } finally {
    try {
      fs.rmSync(copia, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // a resposta do CLI vale mais que a faxina: lançar aqui trocaria um resultado bom por
      // um erro de arquivo preso. A varredura das cópias velhas recolhe a sobra.
    }
  }
}

// Só o que o Farol usa da resposta do CLI; o resto (inclusive o tipo de assinatura) fica fora.
function lerStatus(r) {
  const j = io.parseJson(String((r && r.stdout) || '').trim(), null);
  if (!j || typeof j !== 'object' || typeof j.loggedIn !== 'boolean') return null;
  const email = [j.email, j.emailAddress, j.account && j.account.email].find((v) => typeof v === 'string' && v) || '';
  return { loggedIn: j.loggedIn, authMethod: typeof j.authMethod === 'string' ? j.authMethod : '', email };
}

// `claude auth status` não chama modelo. Sai com código 1 quando não há login, e isso é
// resposta: o que decide é o JSON.
async function statusDoClaude(dir) {
  return lerStatus(await rodarNaCopia(dir, 'claude auth status --json'));
}

function emailDoArquivo(dir) {
  const j = io.readJson(path.join(dir, '.claude.json'), {});
  const conta = j && j.oauthAccount;
  return (conta && typeof conta.emailAddress === 'string') ? conta.emailAddress : '';
}

// Há login gravado na pasta? Só a EXISTÊNCIA do arquivo da credencial (no Linux o Claude Code
// a guarda em `.credentials.json` na pasta de configuração); o motor nunca abre o arquivo. A
// conta no `.claude.json` não conta: ela fica lá depois de um logout. Quem prova que o login
// VALE é o teste do perfil ou a própria sessão.
function temCredencial(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, '.credentials.json')); }
  catch { return false; }
}

// O que o doctor mostra no selo do perfil.
function infoDaPasta(dir) {
  return { ready: temCredencial(dir) };
}

// A sessão com perfil de assinatura sem login é recusada ANTES de abrir o processo: sem isso
// cada PR da fila abria uma sessão que morria por falta de login. A frase cai na classe
// `sem-perfil-de-chave` (lib/log-taxonomy.js), permanente: a revisão estaciona com o motivo
// dito e não relança a cada ciclo. `rotulo` é o nome do perfil na configuração.
function recusaSemLogin(auth, rotulo = '') {
  // sem pasta não é perfil de assinatura resolvido (authFromProfile nunca devolve um assim)
  if (!auth || auth.kind !== 'dir' || !auth.dir || temCredencial(auth.dir)) return null;
  const nome = rotulo ? ` "${rotulo}"` : '';
  return new Error(`sem perfil do Claude utilizável: o perfil de assinatura${nome} está sem login; faça o login da assinatura pela API do motor (docs/CONFIGURATION.md, Login da assinatura pela API)`);
}

export { ambienteDoPerfil, rodarNaCopia, statusDoClaude, emailDoArquivo, infoDaPasta, temCredencial, recusaSemLogin };
