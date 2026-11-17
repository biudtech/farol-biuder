// A imagem do container do motor, conferida sem Docker: o que o Dockerfile promete tem de
// continuar verdade quando o repositório muda. O build de verdade, com o container de pé, é o
// job `imagem` do CI (.github/workflows/ci.yml).
//
// - o Node da imagem é o do contrato (.nvmrc), fixado por digest;
// - gh e Claude Code com versão exata, nunca "latest"; o git é o do Debian da base, e a versão
//   que entrou fica escrita num arquivo da imagem;
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
  for (const arquivo of ['Dockerfile', '.dockerignore', 'docs/exemplos/config.hospedagem.exemplo.json', 'docs/exemplos/repositories.exemplo.json', 'tools/provar-imagem.sh']) {
    assert.equal(ler(arquivo).includes('\r'), false, `${arquivo} tem CR`);
  }
});

test('a base é o Node do contrato, fixada por digest', () => {
  assert.equal(ARGS.NODE_VERSION, ler('.nvmrc').trim());
  assert.match(ARGS.NODE_DIGEST, /^sha256:[0-9a-f]{64}$/);
  const bases = [...DOCKERFILE.matchAll(/^FROM (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(bases, ['node:${NODE_VERSION}-bookworm-slim@${NODE_DIGEST}'], 'uma base só, com a versão e o digest dos ARG');
});

test('gh e Claude Code têm versão exata e o chaveiro do gh é conferido por hash', () => {
  assert.match(ARGS.GH_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(ARGS.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(ARGS.GH_KEYRING_SHA256, /^[0-9a-f]{64}$/);
  assert.ok(DOCKERFILE.includes('"gh=${GH_VERSION}"'));
  assert.ok(DOCKERFILE.includes('"@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"'));
  assert.ok(DOCKERFILE.includes('echo "${GH_KEYRING_SHA256}  /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c -'));
  assert.doesNotMatch(DOCKERFILE, /@latest|:latest/);
});

// O pnpm constrói a ferramenta da avaliação técnica no volume (lib/technical-review/setup.js). A
// versão é travada aqui: o lock da ferramenta no pino é lockfileVersion 9.0, o formato da linha
// 10 do pnpm, e o --frozen-lockfile recusa o lock de outro formato. Trocar a versão é trocar
// este teste junto, conferindo o lock do pino novo.
test('o pnpm tem a versão fixada, entra pelo npm e não pelo corepack, e a prova da imagem a confere', () => {
  assert.equal(ARGS.PNPM_VERSION, '10.34.9');
  assert.ok(DOCKERFILE.includes('"pnpm@${PNPM_VERSION}"'));
  assert.ok(DOCKERFILE.includes('test "$(pnpm --version)" = "${PNPM_VERSION}"'), 'o build falha se a versão instalada for outra');
  assert.doesNotMatch(DOCKERFILE, /^\s*(?:RUN|.*;)\s*corepack\b/m);
  const construcao = JSON.parse(ler('lib/technical-review/tool.json')).construcao;
  assert.ok(construcao.every(([binario]) => binario === 'pnpm'), 'a construção da ferramenta só chama o pnpm');
  // a loja, o cache e o estado do pnpm no volume, com a raiz somente leitura
  for (const [nome, valor] of [['XDG_DATA_HOME', '/home/farol/.local/share'], ['XDG_CACHE_HOME', '/home/farol/.cache'], ['XDG_STATE_HOME', '/home/farol/.local/state']]) {
    assert.match(DOCKERFILE, new RegExp(`^\\s+${nome}=${valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\\\$`, 'm'), nome);
  }
  const prova = ler('tools/provar-imagem.sh');
  assert.ok(prova.includes('PNPM_VERSION'), 'a prova lê a versão do Dockerfile');
  assert.ok(prova.includes('lib/technical-review/setup.js'), 'a prova roda a instalação sem acesso à origem');
});

// O patch do Debian fixado (git=1:2.39.5-0+deb12u3) quebrava o job obrigatório no dia em que o
// Debian trocasse o pacote. O git é o do Debian da base no dia do build, e a versão que entrou
// fica escrita num arquivo da imagem, que a prova imprime.
test('o git não tem o patch do Debian fixado, e as versões instaladas ficam escritas na imagem', () => {
  assert.equal('GIT_VERSION' in ARGS, false);
  assert.doesNotMatch(DOCKERFILE, /git=/);
  assert.match(DOCKERFILE, /apt-get install -y --no-install-recommends ca-certificates git procps tini tzdata;/);
  assert.match(DOCKERFILE, /\{ echo "node \$\(node --version\)"; git --version; gh --version \| head -n 1; echo "claude \$\(claude --version\)"; echo "pnpm \$\(pnpm --version\)"; \} > \/etc\/farol-versoes;/);
  assert.ok(ler('tools/provar-imagem.sh').includes('/etc/farol-versoes'), 'a prova imprime o arquivo');
});

test('o processo não é root, o HOME é o volume e a trava da instância hospedada nasce ligada', () => {
  assert.match(ARGS.FAROL_UID, /^[1-9]\d*$/);
  assert.match(ARGS.FAROL_GID, /^[1-9]\d*$/);
  assert.match(DOCKERFILE, /^USER \$\{FAROL_UID\}:\$\{FAROL_GID\}$/m);
  assert.equal((DOCKERFILE.match(/^USER /gm) || []).length, 1, 'um USER só, e ele é o do motor');
  assert.match(DOCKERFILE, /^ENV HOME=\/home\/farol \\$/m);
  // FAROL_HOME tem de ser o ~/.farol do HOME acima: outro valor liga a instância isolada (lib/paths.js)
  assert.match(DOCKERFILE, /^\s+FAROL_HOME=\/home\/farol\/\.farol \\$/m);
  assert.match(DOCKERFILE, /^\s+FAROL_INSTANCIA_HOSPEDADA=1 \\$/m);
  // o motor não lê NODE_ENV, e "production" faz o pnpm da ferramenta técnica pular dependências
  assert.doesNotMatch(DOCKERFILE, /^(?:ENV|\s+)\s*NODE_ENV=/m);
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

// Todo arquivo .js que a imagem leva (o grafo de imports a partir do que é copiado).
function fontesDaImagem() {
  return [...grafo(copiados().filter((o) => o.endsWith('.js')))].filter((rel) => rel.endsWith('.js'));
}

// DERIVADO do código: todo `path.join(APP_ROOT, 'a', 'b')` com termos literais é um arquivo ou
// pasta que o motor acha pela raiz do app, sem import.
function lidosPelaRaizDoApp() {
  const achados = new Set();
  for (const rel of fontesDaImagem()) {
    for (const m of ler(rel).matchAll(/path\.join\(APP_ROOT,\s*((?:'[^']+'(?:,\s*)?)+)\)/g)) {
      achados.add(path.posix.join(...[...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1])));
    }
  }
  return [...achados].sort();
}

test('o que o motor acha pela raiz do app (path.join(APP_ROOT, ...)) existe e está na imagem', () => {
  const lidos = lidosPelaRaizDoApp();
  // o piso é o de hoje: package.json, workspace-template, lib/review-context/query.js e tools/jira-mcp.js
  assert.ok(lidos.length >= 4, `a derivação achou ${lidos.join(', ')}`);
  for (const rel of lidos) {
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), `${rel} é lido pela raiz do app e não existe`);
    assert.ok(dentroDoCopiado(rel) || copiados().includes(`${rel}/`), `${rel} é lido pela raiz do app e o Dockerfile não o copia`);
  }
});

test('o que o motor lê por caminho montado em partes também está na imagem', () => {
  // MANTIDA À MÃO: estes caminhos são montados com variável (TEMPLATE_DIR mais o nome do arquivo,
  // em server.js e lib/engine/guardas-da-sessao.js; a raiz do parser mais ARQUIVOS, em
  // lib/parser-runtime.js), e a derivação acima não os enxerga. Leitura nova desse tipo entra aqui.
  for (const rel of ['workspace-template/CLAUDE.md', 'workspace-template/prompts/pr-review-auto.md', 'workspace-template/.claude/guardas.json', 'workspace-template/.claude/settings.json', 'assets/third-party/babel-parser/manifest.json', 'assets/third-party/babel-parser/dist/parser.cjs', 'assets/third-party/babel-parser/LICENSE']) {
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), rel);
    assert.ok(dentroDoCopiado(rel), rel);
  }
});

// O .dockerignore libera por lista e, no fim, volta a excluir alguns nomes em qualquer pasta
// (config.json, *.log, .env*, node_modules). Um arquivo de verdade com um desses nomes, dentro
// de uma pasta copiada, sumiria da imagem sem erro no build. Hoje nenhum casa; o teste trava o
// futuro. A varredura é da árvore de trabalho, que no CI é só o que está rastreado.
function exclusoesGlobais() {
  return IGNORE.split('\n').filter((l) => l.startsWith('**/')).map((l) => l.slice(3));
}

function casaExclusao(nome, padrao) {
  const regex = new RegExp(`^${padrao.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return regex.test(nome);
}

function arquivosSob(rel, achados = []) {
  const abs = path.join(RAIZ, rel);
  if (!fs.statSync(abs).isDirectory()) { achados.push(rel); return achados; }
  for (const nome of fs.readdirSync(abs)) arquivosSob(path.posix.join(rel, nome), achados);
  return achados;
}

test('nenhum arquivo sob o que a imagem copia casa com uma exclusão do .dockerignore', () => {
  const padroes = exclusoesGlobais();
  assert.deepEqual(padroes, ['node_modules', 'config.json', '*.log', '.env*'], 'o teste conhece as exclusões; mudou a lista, confira o teste');
  assert.equal(casaExclusao('config.json', 'config.json') && casaExclusao('a.log', '*.log') && casaExclusao('.env.local', '.env*'), true);
  assert.equal(casaExclusao('env.js', '.env*') || casaExclusao('config.json.js', 'config.json'), false);
  const arquivos = copiados().flatMap((origem) => arquivosSob(origem.replace(/\/$/, '')));
  assert.ok(arquivos.length > 200, `a varredura andou (${arquivos.length} arquivos)`);
  for (const rel of arquivos) {
    const casou = rel.split('/').flatMap((parte) => padroes.filter((p) => casaExclusao(parte, p)));
    assert.deepEqual(casou, [], `${rel} é copiado pelo Dockerfile e excluído pelo .dockerignore (${casou.join(', ')})`);
  }
});
