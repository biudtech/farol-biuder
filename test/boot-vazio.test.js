// Boot do motor numa máquina vazia (fechamento da fase 1, Review Focus 5): `node server.js`
// sobe como processo filho de verdade, com o HOME numa pasta temporária vazia e sem `gh` logado,
// responde `GET /api/state`, não escreve fora do HOME e sai com 0 no SIGTERM.
//
// A rede não é cortada: o teste não depende dela, mas o motor tenta, por exemplo, ler a última
// versão do Claude Code no registro (lib/engine/versao-claude.js). O que se prova é que essa
// busca pode falhar (ou dar certo) sem derrubar o boot, não que o motor não toque a rede.
//
// O filho NÃO herda o ambiente do teste, de propósito: com NODE_TEST_CONTEXT o lib/paths.js
// desvia os dados para uma pasta provisória, e com FAROL_HOME a instância conta como isolada.
// Aqui o motor resolve o `~/.farol` como em produção, a partir do HOME.
//
// Três pastas irmãs, e só uma pode receber escrita: `casa` (HOME), `tmp` (TMPDIR) e `cwd`
// (diretório de trabalho). O que o motor gravar em `tmp` ou `cwd` é vazamento. A pasta
// temporária de verdade da máquina não é comparada porque os outros arquivos da suíte gravam
// nela ao mesmo tempo; o TMPDIR próprio é o que deixa a medição determinística.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const REPO = path.join(import.meta.dirname, '..');
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-boot-vazio-'));
const CASA = path.join(RAIZ, 'casa');
const TMP = path.join(RAIZ, 'tmp');
const CWD = path.join(RAIZ, 'cwd');
const BIN = path.join(RAIZ, 'bin');
for (const pasta of [CASA, TMP, CWD, BIN]) fs.mkdirSync(pasta);

let filho = null;
after(() => {
  if (filho && filho.exitCode === null && filho.signalCode === null) filho.kill('SIGKILL');
  fs.rmSync(RAIZ, { recursive: true, force: true });
});

// `gh` de mentira que responde como o de verdade sem login: saída 1 e nada no stdout. Entra na
// frente do PATH para a máquina de quem roda o teste (com `gh` logado) não mudar o resultado.
// O `claude` de mentira é o FAROL_HEADLESS_CMD; nenhuma sessão chega a abrir, porque a fila
// nasce vazia.
function escreverExecutavel(nome, corpo) {
  const arq = path.join(BIN, nome);
  fs.writeFileSync(arq, `#!/bin/sh\n${corpo}\n`, { mode: 0o755 });
  return arq;
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Lista recursiva de caminhos relativos, pastas com barra no fim.
function listar(dir, fora = new Set(), base = dir, achados = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (fora.has(item.name)) continue;
    const abs = path.join(dir, item.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (item.isDirectory()) { achados.push(`${rel}/`); listar(abs, fora, base, achados); } else achados.push(rel);
  }
  return achados.sort();
}

function esperar(condicao, limiteMs, oQue) {
  const fim = Date.now() + limiteMs;
  return new Promise((resolve, reject) => {
    const tentar = async () => {
      let valor = null;
      try { valor = await condicao(); } catch { /* ainda não: tenta de novo até o limite */ }
      if (valor) return resolve(valor);
      if (Date.now() > fim) return reject(new Error(`tempo esgotado esperando ${oQue}`));
      setTimeout(tentar, 100);
    };
    tentar();
  });
}

// Uma tentativa de subir o motor numa porta. A única coisa posta no HOME antes do boot é a
// porta, para o teste não disputar a 47170.
async function tentarSubir(env) {
  const porta = await portaLivre();
  fs.mkdirSync(path.join(CASA, '.farol'), { recursive: true });
  fs.writeFileSync(path.join(CASA, '.farol', 'config.json'), JSON.stringify({ port: porta }));
  const t = { porta, saida: '', erros: '' };
  filho = spawn(process.execPath, [path.join(REPO, 'server.js')], { cwd: CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const processo = filho;
  processo.stdout.on('data', (d) => { t.saida += d; });
  processo.stderr.on('data', (d) => { t.erros += d; });
  t.fimDoFilho = new Promise((resolve) => processo.on('exit', (code, signal) => resolve({ code, signal })));
  await esperar(() => t.saida.includes('[farol] monitorando') || processo.exitCode !== null, 30000, 'o motor escutar')
    .catch((err) => { throw new Error(`${err.message}\nstdout: ${t.saida}\nstderr: ${t.erros}`); });
  t.subiu = processo.exitCode === null;
  return t;
}

// A porta é escolhida e solta antes de o filho escutar, e outro arquivo da suíte pode pegá-la
// nesse intervalo. Só ESSA falha (o motor dizendo que a porta está em uso) ganha outra tentativa,
// com outra porta; qualquer outra saída antes de escutar é falha de boot e reprova na hora.
async function subir(env) {
  for (let tentativa = 1; ; tentativa++) {
    const t = await tentarSubir(env);
    if (t.subiu) return t;
    const portaOcupada = /EADDRINUSE/.test(t.erros);
    assert.ok(portaOcupada && tentativa < 3, `o motor saiu antes de escutar\nstdout: ${t.saida}\nstderr: ${t.erros}`);
  }
}

test('motor sobe com o HOME vazio, responde /api/state, não escreve fora do HOME e sai com 0 no SIGTERM', async () => {
  escreverExecutavel('gh', 'echo "You are not logged into any GitHub hosts." >&2\nexit 1');
  const claudeFalso = escreverExecutavel('claude-falso', 'echo \'{"result":"{}"}\'');

  const repoAntes = listar(REPO, new Set(['.git', 'node_modules']));
  const env = {
    HOME: CASA,
    TMPDIR: TMP,
    PATH: [BIN, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    FAROL_HEADLESS_CMD: claudeFalso,
  };
  const { porta, fimDoFilho } = await subir(env);

  const url = `http://127.0.0.1:${porta}/api/state`;
  const resposta = await fetch(url);
  assert.equal(resposta.status, 200);
  const estado = await resposta.json();
  assert.deepEqual(estado.queue, [], 'instância nova nasce com a fila vazia');

  // Espera a primeira checagem terminar. Sem conta no gh ela acaba em erro dito na tela
  // (`status: 'error'`), nunca em processo morto. O que vazasse para fora do HOME vazaria
  // até aqui: é a checagem que grava o resto do estado.
  const depois = await esperar(async () => {
    const e = await (await fetch(url)).json();
    return ['idle', 'error'].includes(e.status) ? e : null;
  }, 30000, 'a primeira checagem terminar');
  assert.deepEqual(depois.queue, [], 'sem conta no gh, a primeira checagem não põe nada na fila');
  // a saúde inteira (gh, claude, perfis) também responde sem gh nem claude instalados
  const saude = await fetch(`http://127.0.0.1:${porta}/api/doctor`);
  assert.equal(saude.status, 200);
  assert.equal(filho.exitCode, null, 'o motor segue de pé depois da primeira checagem');

  filho.kill('SIGTERM');
  const fim = await fimDoFilho;
  assert.equal(fim.signal, null, 'saiu pelo handler, não morto pelo sinal');
  assert.equal(fim.code, 0);

  assert.ok(fs.existsSync(path.join(CASA, '.farol', 'workspace', 'state')), 'o estado mora em ~/.farol');
  assert.deepEqual(listar(TMP), [], 'o motor escreveu na pasta temporária, fora do HOME');
  assert.deepEqual(listar(CWD), [], 'o motor escreveu no diretório de trabalho, fora do HOME');
  assert.deepEqual(fs.readdirSync(RAIZ).sort(), ['bin', 'casa', 'cwd', 'tmp'], 'o motor criou algo ao lado do HOME');
  assert.deepEqual(listar(REPO, new Set(['.git', 'node_modules'])), repoAntes, 'o motor escreveu na pasta do código');
  // o que nasce no HOME além do ~/.farol é só a confiança do workspace no ~/.claude.json
  const naCasa = fs.readdirSync(CASA).sort();
  for (const nome of naCasa) assert.ok(['.farol', '.claude.json'].includes(nome), `o motor criou ${nome} no HOME, fora do ~/.farol`);
});
