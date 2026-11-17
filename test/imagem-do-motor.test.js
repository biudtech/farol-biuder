// A imagem do container do motor, conferida sem Docker: o que o Dockerfile promete tem de
// continuar verdade quando o repositório muda. O build de verdade, com o container de pé, é o
// job `imagem` do CI (.github/workflows/ci.yml).
//
// - o Node da imagem é o do contrato (.nvmrc), fixado por digest;
// - git, gh e Claude Code com versão exata, nunca "latest";
// - usuário que não é root, HOME no volume, FAROL_HOME no padrão (~/.farol) e a trava da
//   instância hospedada ligada;
// - só entra o que o motor lê em execução: o que o `server.js` e as ferramentas copiadas
//   importam está dentro do que o Dockerfile copia, e `web/`, `test/` e `docs/` ficam fora;
// - LF em tudo: um CRLF no Dockerfile quebra o build em Linux.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT } from '../lib/constants.js';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const DOCKERFILE = ler('Dockerfile');
const IGNORE = ler('.dockerignore');

// ARG com valor padrão: o nome e o valor.
const ARGS = Object.fromEntries([...DOCKERFILE.matchAll(/^ARG ([A-Z0-9_]+)=(.+)$/gm)].map((m) => [m[1], m[2]]));

// As origens de cada COPY (o último termo é o destino), relativas à raiz do repositório.
function copiados() {
  return [...DOCKERFILE.matchAll(/^COPY (?:--\S+ )*(.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/).slice(0, -1));
}

function dentroDoCopiado(rel) {
  return copiados().some((origem) => (origem.endsWith('/') ? rel.startsWith(origem) : rel === origem));
}

test('Dockerfile, .dockerignore e o config de exemplo estão em LF', () => {
  for (const arquivo of ['Dockerfile', '.dockerignore', 'docs/exemplos/config.hospedagem.exemplo.json']) {
    assert.equal(ler(arquivo).includes('\r'), false, `${arquivo} tem CR`);
  }
});

test('a base é o Node do contrato, fixada por digest', () => {
  assert.equal(ARGS.NODE_VERSION, ler('.nvmrc').trim());
  assert.match(ARGS.NODE_DIGEST, /^sha256:[0-9a-f]{64}$/);
  const bases = [...DOCKERFILE.matchAll(/^FROM (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(bases, ['node:${NODE_VERSION}-bookworm-slim@${NODE_DIGEST}'], 'uma base só, com a versão e o digest dos ARG');
});

test('git, gh e Claude Code têm versão exata e o chaveiro do gh é conferido por hash', () => {
  assert.match(ARGS.GIT_VERSION, /^\d+:\d+\.\d+\.\d+-\S+$/);
  assert.match(ARGS.GH_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(ARGS.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(ARGS.GH_KEYRING_SHA256, /^[0-9a-f]{64}$/);
  assert.ok(DOCKERFILE.includes('"git=${GIT_VERSION}"'));
  assert.ok(DOCKERFILE.includes('"gh=${GH_VERSION}"'));
  assert.ok(DOCKERFILE.includes('"@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"'));
  assert.ok(DOCKERFILE.includes('echo "${GH_KEYRING_SHA256}  /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c -'));
  assert.doesNotMatch(DOCKERFILE, /@latest|:latest/);
});

test('o processo não é root, o HOME é o volume e a trava da instância hospedada nasce ligada', () => {
  assert.match(ARGS.FAROL_UID, /^[1-9]\d*$/);
  assert.match(ARGS.FAROL_GID, /^[1-9]\d*$/);
  assert.match(DOCKERFILE, /^USER \$\{FAROL_UID\}:\$\{FAROL_GID\}$/m);
  assert.equal((DOCKERFILE.match(/^USER /gm) || []).length, 1, 'um USER só, e ele é o do motor');
  assert.match(DOCKERFILE, /^\s+HOME=\/home\/farol \\$/m);
  // FAROL_HOME tem de ser o ~/.farol do HOME acima: outro valor liga a instância isolada (lib/paths.js)
  assert.match(DOCKERFILE, /^\s+FAROL_HOME=\/home\/farol\/\.farol \\$/m);
  assert.match(DOCKERFILE, /^\s+FAROL_INSTANCIA_HOSPEDADA=1 \\$/m);
  assert.match(DOCKERFILE, /^ENV NODE_ENV=production \\$/m);
  assert.match(DOCKERFILE, /^VOLUME \["\/home\/farol"\]$/m);
  assert.match(DOCKERFILE, /^STOPSIGNAL SIGTERM$/m);
  assert.match(DOCKERFILE, /^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m);
  assert.match(DOCKERFILE, /^CMD \["node", "server\.js"\]$/m);
});

test('a sonda de saúde bate em GET /api/health na porta padrão, sem curl', () => {
  assert.match(DOCKERFILE, /^HEALTHCHECK /m);
  assert.ok(DOCKERFILE.includes(`fetch('http://127.0.0.1:${DEFAULT_PORT}/api/health'`));
  assert.match(DOCKERFILE, new RegExp(`^EXPOSE ${DEFAULT_PORT}$`, 'm'));
  assert.doesNotMatch(DOCKERFILE, /\bcurl -/);
});

test('os rótulos OCI de fonte, revisão e versão vêm de ARG', () => {
  for (const [rotulo, arg] of [['source', 'FAROL_FONTE'], ['revision', 'FAROL_REVISAO'], ['version', 'FAROL_VERSAO'], ['created', 'FAROL_CRIADA_EM']]) {
    assert.ok(DOCKERFILE.includes(`org.opencontainers.image.${rotulo}="\${${arg}}"`), rotulo);
    assert.ok(arg in ARGS, `${arg} tem valor padrão`);
  }
});

test('nenhum segredo em ARG ou ENV', () => {
  const nomes = [...DOCKERFILE.matchAll(/^(?:ARG|ENV|\s+)([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  for (const nome of nomes) assert.doesNotMatch(nome, /TOKEN|SECRET|PASSWORD|SENHA|API_KEY|CREDENTIAL/, nome);
});

test('toda origem de COPY existe, e web/, test/, docs/, .git e .github ficam de fora', () => {
  const origens = copiados();
  assert.ok(origens.length >= 8, 'o teste leu os COPY');
  for (const origem of origens) {
    assert.ok(fs.existsSync(path.join(RAIZ, origem)), `o Dockerfile copia ${origem}, que não existe`);
    assert.doesNotMatch(origem, /^(web|test|docs|\.git|\.github)(\/|$)/, origem);
    assert.notEqual(origem, '.', 'nada de copiar a raiz inteira');
  }
  assert.equal(IGNORE.split('\n').filter((l) => l && !l.startsWith('#'))[0], '*', 'o .dockerignore nega tudo e libera por lista');
});

// Import relativo, estático ou dinâmico, e o `with { type: 'json' }`.
const REFERENCIA = /(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function grafo(entradas) {
  const vistos = new Set();
  const fila = [...entradas];
  while (fila.length) {
    const rel = fila.pop();
    if (vistos.has(rel)) continue;
    vistos.add(rel);
    if (!rel.endsWith('.js')) continue;
    for (const m of ler(rel).matchAll(REFERENCIA)) {
      fila.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
  }
  return vistos;
}

test('tudo o que o motor e as ferramentas copiadas importam está dentro do que a imagem copia', () => {
  const entradas = copiados().filter((o) => o.endsWith('.js'));
  assert.ok(entradas.includes('server.js') && entradas.includes('tools/farol-parear.js') && entradas.includes('tools/jira-mcp.js'));
  const alcancados = grafo(entradas);
  assert.ok(alcancados.size > 100, `o grafo andou (${alcancados.size} arquivos)`);
  for (const rel of alcancados) {
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), `${rel} é importado e não existe`);
    assert.ok(dentroDoCopiado(rel), `${rel} é importado em execução e o Dockerfile não o copia`);
  }
});

test('o que o motor acha pela raiz do app também está na imagem', () => {
  // TEMPLATE_DIR (lib/paths.js), o parser (lib/parser-runtime.js), o MCP do Jira (lib/engine/jira.js) e a versão (package.json)
  for (const rel of ['workspace-template/CLAUDE.md', 'workspace-template/.claude/guardas.json', 'assets/third-party/babel-parser/manifest.json', 'assets/third-party/babel-parser/dist/parser.cjs', 'tools/jira-mcp.js', 'package.json']) {
    assert.ok(dentroDoCopiado(rel), rel);
  }
});
