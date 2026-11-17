// A instalação da ferramenta da avaliação técnica (lib/technical-review/setup.js) e o estado
// dela para quem opera (lib/technical-review/estado.js, o diagnóstico e a linha do boot).
//
// - o clone da origem HTTPS do GitHub usa o git isolado do motor mais a credencial do `gh`, a
//   mesma lista da busca das fontes de revisão, e nenhum token entra em argumento ou mensagem;
// - cada falha tem a mensagem dela: sem acesso, gerenciador de pacotes ausente, rede e pino;
// - a instalação é atômica: a que falha não deixa pasta de preparo nem pasta no lugar da válida;
// - o diagnóstico diz o estado da ferramenta e do cadastro em uma verificação, sem caminho.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-avaliacao-instalacao-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { setup, step, removerSobras, SOBRA_APOS_MS } = await import('../lib/technical-review/setup.js');
const { FalhaDoPasso, origemDoGitHub, origemComCredencial, origemMostrada, falhaDoClone, falhaDaConstrucao } = await import('../lib/technical-review/setup-falhas.js');
const { TOOL, technicalGap, technicalSummary, ehLacunaDura } = await import('../lib/technical-review/verdict.js');
const { FLAGS_GIT_ISOLADO, FLAGS_CREDENCIAL_DO_GH } = await import('../lib/git-isolado.js');
const { resumoDoCadastro } = await import('../lib/technical-review/profiles.js');
const estadoMod = await import('../lib/technical-review/estado.js');
const { ambienteDoDoctor, avaliacaoTecnicaDoDoctor, registrarAvaliacaoNoBoot } = await import('../lib/engine/diagnostico.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const RAIZ = path.join(import.meta.dirname, '..');
const TRAVESSAO = /[–—]/;
let serie = 0;
const novoHome = () => path.join(root, `caso-${++serie}`, 'toolchains', `eng-behaviour@${TOOL.version}`);
const verify = async (directory) => {
  assert.equal(fs.readFileSync(path.join(directory, TOOL.buildStamp), 'utf8').trim(), TOOL.commit);
  return directory;
};
// O dublê do passo: registra a chamada e simula a construção.
function gravador(falhar = () => null) {
  const chamadas = [];
  const run = (binary, args, cwd, options = {}) => {
    chamadas.push({ binary, args, cwd, env: options.env });
    const falha = falhar(binary, args);
    if (falha) throw new FalhaDoPasso(binary, args, falha);
    if (args.includes('build')) fs.mkdirSync(path.join(cwd, 'dist'), { recursive: true });
  };
  return { chamadas, run };
}
const entradas = (home) => fs.readdirSync(path.dirname(home));

test('a origem do GitHub é clonada com o git isolado e a credencial do gh, sem token em argumento', async () => {
  const home = novoHome();
  const { chamadas, run } = gravador();
  assert.equal(await setup([], { home, run, verify }), home);
  const clone = chamadas[0];
  assert.equal(clone.binary, 'git');
  const antesDoClone = clone.args.slice(0, clone.args.indexOf('clone'));
  assert.deepEqual(antesDoClone.slice(0, FLAGS_GIT_ISOLADO.length), [...FLAGS_GIT_ISOLADO], 'o git isolado vem primeiro e zera os helpers');
  assert.deepEqual(antesDoClone.slice(-FLAGS_CREDENCIAL_DO_GH.length), [...FLAGS_CREDENCIAL_DO_GH], 'o helper do gh é o último, logo o único');
  assert.deepEqual(clone.args.slice(clone.args.indexOf('clone')), ['clone', '--', TOOL.origem, clone.args.at(-1)]);
  assert.equal(clone.env.GIT_CONFIG_GLOBAL, '/dev/null', 'sem o config da máquina');
  assert.equal(clone.env.GIT_TERMINAL_PROMPT, '0', 'sem pedir senha no terminal');
  assert.equal(clone.env.LC_ALL, 'C', 'a saída do git é lida em inglês');
  for (const chamada of chamadas) assert.doesNotMatch(chamada.args.join(' '), /gh[pousr]_|github_pat_|x-access-token|@github\.com/);
  // os passos seguintes: o commit do pino e a construção do tool.json, na ordem
  assert.deepEqual(chamadas.slice(1).map((c) => [c.binary, c.args.at(-1)]),
    [['git', `${TOOL.commit}^{commit}`], ['git', TOOL.commit], ...TOOL.construcao.map((c) => [c[0], c.at(-1)])]);
  assert.equal(chamadas[1].env, undefined, 'só o clone leva o ambiente isolado');
});

test('a credencial do gh para o git tem uma fonte só', () => {
  assert.deepEqual([...FLAGS_CREDENCIAL_DO_GH], ['-c', 'credential.helper=!gh auth git-credential']);
  for (const rel of ['lib/review-source/git.js', 'lib/technical-review/setup.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    assert.ok(fonte.includes('...FLAGS_CREDENCIAL_DO_GH'), `${rel} usa a lista comum`);
    assert.equal(fonte.includes('gh auth git-credential'), false, `${rel} não escreve o helper de novo`);
  }
});

test('caminho local e origem fora do GitHub seguem com o git comum, sem credencial', async () => {
  for (const source of ['/mnt/copia', 'file:///tmp/copia.git', 'https://git.exemplo.invalid/org/eng-behaviour.git', 'https://github.com.exemplo.invalid/org/repo.git']) {
    const { chamadas, run } = gravador();
    await setup(['--source', source], { home: novoHome(), run, verify });
    assert.deepEqual(chamadas[0].args.slice(0, 4), ['clone', '--no-hardlinks', '--', source], source);
    assert.equal(chamadas[0].env, undefined, source);
  }
  assert.equal(origemDoGitHub('https://github.com/biudtech/eng-behaviour.git'), 'biudtech/eng-behaviour');
  assert.equal(origemDoGitHub('https://github.com/biudtech/eng-behaviour'), 'biudtech/eng-behaviour');
  assert.equal(origemDoGitHub('http://github.com/biudtech/eng-behaviour.git'), '', 'só https');
  assert.equal(origemDoGitHub('git@github.com:biudtech/eng-behaviour.git'), '');
});

test('origem com credencial na URL é recusada antes de qualquer comando, e o token não vai à mensagem', async () => {
  const home = novoHome();
  const { chamadas, run } = gravador();
  const source = 'https://x-access-token:segredo-do-teste@github.com/biudtech/eng-behaviour.git';
  assert.equal(origemComCredencial(source), true);
  assert.equal(origemComCredencial(TOOL.origem), false);
  assert.equal(origemMostrada(source), 'https://github.com/biudtech/eng-behaviour.git');
  await assert.rejects(setup(['--source', source], { home, run, verify }), (error) => {
    assert.match(error.message, /traz credencial na URL/);
    assert.doesNotMatch(error.message, /segredo-do-teste/);
    return true;
  });
  assert.equal(chamadas.length, 0);
  assert.equal(fs.existsSync(path.dirname(home)), false, 'nem a pasta de toolchains nasce');
});

// Cada causa com a saída real do comando que a produz (git 2.39 e pnpm 10, com LC_ALL=C).
const CAUSAS = [
  { nome: 'sem login do gh', quando: (b, a) => a.includes('clone'), falha: { tipo: 'saiu', codigo: 128, saida: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n" }, espera: /^sem acesso ao repositório da ferramenta técnica \(https:\/\/github\.com\/biudtech\/eng-behaviour\.git\): o gh não está logado, ou a conta logada não enxerga esse repositório\. Confira com "gh auth status" e "gh repo view biudtech\/eng-behaviour"/ },
  { nome: 'conta sem acesso', quando: (b, a) => a.includes('clone'), falha: { tipo: 'saiu', codigo: 128, saida: "remote: Repository not found.\nfatal: repository 'https://github.com/biudtech/eng-behaviour.git/' not found\n" }, espera: /^sem acesso ao repositório da ferramenta técnica/ },
  { nome: 'rede no clone', quando: (b, a) => a.includes('clone'), falha: { tipo: 'saiu', codigo: 128, saida: "fatal: unable to access 'https://github.com/biudtech/eng-behaviour.git/': Could not resolve host: github.com\n" }, espera: /^falha de rede no clone da ferramenta técnica/ },
  { nome: 'git ausente', quando: (b, a) => a.includes('clone'), falha: { tipo: 'ausente' }, espera: /^o "git" não está instalado/ },
  { nome: 'commit do pino fora da origem', quando: (b, a) => a.includes('cat-file'), falha: { tipo: 'saiu', codigo: 128, saida: 'fatal: Not a valid object name\n' }, espera: new RegExp(`^o commit do pino \\(${TOOL.commit}, em lib/technical-review/tool\\.json\\) não existe em https://github\\.com/biudtech/eng-behaviour\\.git`) },
  { nome: 'gerenciador de pacotes ausente', quando: (b) => b === 'pnpm', falha: { tipo: 'ausente' }, espera: /^o gerenciador de pacotes "pnpm" não está instalado ou não está no PATH: a construção da ferramenta técnica roda "pnpm install --frozen-lockfile"/ },
  { nome: 'rede no install', quando: (b) => b === 'pnpm', falha: { tipo: 'saiu', codigo: 1, saida: ' ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/yaml: request to https://registry.npmjs.org/yaml failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org\n' }, espera: /^falha de rede em "pnpm install --frozen-lockfile": o registro de pacotes não respondeu/ },
  { nome: 'build que falha', quando: (b, a) => b === 'pnpm' && a.includes('build'), falha: { tipo: 'saiu', codigo: 2, saida: 'src/a.ts(1,1): error TS1005\n' }, espera: /^"pnpm build" não terminou: saiu com código 2/ },
  { nome: 'prazo', quando: (b) => b === 'pnpm', falha: { tipo: 'prazo' }, espera: /^o passo "pnpm" passou do prazo da instalação/ },
  { nome: 'interrompida', quando: (b) => b === 'pnpm', falha: { tipo: 'cancelado' }, espera: /^a instalação da ferramenta técnica foi interrompida no passo "pnpm"/ },
  { nome: 'morta por sinal de fora', quando: (b) => b === 'pnpm', falha: { tipo: 'sinal', sinal: 'SIGKILL' }, espera: /^o passo "pnpm" foi encerrado pelo sinal SIGKILL antes de terminar/ },
];

test('cada falha da instalação tem a mensagem dela, e nenhuma deixa pasta em toolchains', async () => {
  const mensagens = new Set();
  for (const causa of CAUSAS) {
    const home = novoHome();
    const { run } = gravador((b, a) => (causa.quando(b, a) ? causa.falha : null));
    await assert.rejects(setup([], { home, run, verify }), (error) => {
      assert.match(error.message, causa.espera, causa.nome);
      assert.match(error.message, /nada foi instalado/, causa.nome);
      assert.doesNotMatch(error.message, TRAVESSAO, causa.nome);
      mensagens.add(error.message.slice(0, 40));
      return true;
    });
    assert.deepEqual(entradas(home), [], `${causa.nome}: toolchains fica vazia`);
  }
  assert.ok(mensagens.size >= 8, 'as causas não caem todas na mesma mensagem');
});

test('saída que não casa com nenhuma causa conhecida vira a mensagem do passo, com o código', () => {
  const clone = new FalhaDoPasso('git', ['clone'], { tipo: 'saiu', codigo: 128, saida: 'fatal: algo que ninguém previu\n' });
  assert.match(falhaDoClone(clone, 'https://github.com/a/b.git'), /^o clone da ferramenta técnica \(https:\/\/github\.com\/a\/b\.git\) não terminou: o git saiu com código 128/);
  const install = new FalhaDoPasso('pnpm', ['install', '--frozen-lockfile'], { tipo: 'saiu', codigo: 1, saida: 'ERR_PNPM_OUTDATED_LOCKFILE\n' });
  assert.match(falhaDaConstrucao(install), /^"pnpm install --frozen-lockfile" não terminou: saiu com código 1/);
});

test('a instalação que falha no meio não toca a válida, e a válida não é refeita', async () => {
  const home = novoHome();
  const boa = gravador();
  await setup(['--source', '/copia'], { home, run: boa.run, verify });
  fs.writeFileSync(path.join(home, 'marca.txt'), 'a válida');
  // válida: nenhum comando roda, nem com a origem fora do ar
  const parada = gravador(() => ({ tipo: 'saiu', codigo: 1, saida: '' }));
  assert.equal(await setup([], { home, run: parada.run, verify }), home);
  assert.equal(parada.chamadas.length, 0, 'a instalação válida não é refeita');
  // a válida deixa de validar (o pino mudou) e a nova tentativa morre no install
  const pinoNovo = async (directory) => { if (directory === home) throw new Error('identidade da ferramenta técnica não comprovada'); return verify(directory); };
  const quebra = gravador((b) => (b === 'pnpm' ? { tipo: 'cancelado' } : null));
  await assert.rejects(setup(['--source', '/copia'], { home, run: quebra.run, verify: pinoNovo }), /interrompida/);
  assert.equal(fs.readFileSync(path.join(home, 'marca.txt'), 'utf8'), 'a válida', 'a pasta anterior ficou inteira no lugar');
  assert.deepEqual(entradas(home), [path.basename(home)], 'sem pasta de preparo e sem cópia de reserva');
});

test('sobra de instalação morta sai quando é velha; a recente fica', () => {
  const parent = path.dirname(novoHome());
  fs.mkdirSync(path.join(parent, '.install-velha', 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(parent, '.install-recente'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'eng-behaviour@0.0.1'), { recursive: true });
  const velho = new Date(Date.now() - SOBRA_APOS_MS - 60_000);
  fs.utimesSync(path.join(parent, '.install-velha'), velho, velho);
  fs.utimesSync(path.join(parent, 'eng-behaviour@0.0.1'), velho, velho);
  removerSobras(parent);
  assert.deepEqual(fs.readdirSync(parent).sort(), ['.install-recente', 'eng-behaviour@0.0.1']);
});

test('o passo de verdade: binário ausente, código de saída com o fim da saída, e cancelamento', async () => {
  await assert.rejects(step('farol-binario-que-nao-existe', ['x'], root), (error) => error instanceof FalhaDoPasso && error.tipo === 'ausente');
  const quieto = { stdout: process.stdout.write, stderr: process.stderr.write };
  process.stdout.write = () => true; process.stderr.write = () => true;
  try {
    await assert.rejects(step(process.execPath, ['-e', 'console.log("saida do passo"); console.error("erro do passo"); process.exit(3)'], root),
      (error) => error.tipo === 'saiu' && error.codigo === 3 && error.saida.includes('saida do passo') && error.saida.includes('erro do passo'));
    await step(process.execPath, ['-e', 'process.exit(0)'], root);
    // o kill de fora (o operador, o OOM) não vira "saiu com código null"
    await assert.rejects(step(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'], root),
      (error) => error.tipo === 'sinal' && error.sinal === 'SIGKILL');
    const cancelamento = new AbortController();
    const preso = step(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], root, { signal: cancelamento.signal });
    setTimeout(() => cancelamento.abort(), 200);
    await assert.rejects(preso, (error) => error.tipo === 'cancelado');
  } finally { process.stdout.write = quieto.stdout; process.stderr.write = quieto.stderr; }
});

// ---------- o estado para quem opera ----------

const integra = async () => 'ok';
const ausente = async () => { throw new Error('ferramenta técnica fixada não instalada'); };
const naoComprovada = async () => { throw new Error('identidade da ferramenta técnica não comprovada'); };
const cadastro = (estado, repositorios = 0) => () => ({ estado, repositorios });

test('o cadastro é ausente, ilegível ou legível com a contagem dos repositórios declarados', () => {
  const file = path.join(root, 'repositories.json');
  assert.deepEqual(resumoDoCadastro(file), { estado: 'ausente', repositorios: 0 });
  fs.writeFileSync(file, '{ "repositories": ');
  assert.deepEqual(resumoDoCadastro(file), { estado: 'ilegivel', repositorios: 0 });
  fs.writeFileSync(file, JSON.stringify({ repositories: { 'acme/api': { declaration: { scopes: ['backend'] } }, 'acme/web': { declaration: {} }, 'acme/sem': {}, 'acme/nulo': null } }));
  assert.deepEqual(resumoDoCadastro(file), { estado: 'legivel', repositorios: 2 }, 'conta só quem tem declaração, como o profileFor');
  fs.writeFileSync(file, '{}');
  assert.deepEqual(resumoDoCadastro(file), { estado: 'legivel', repositorios: 0 });
  // o exemplo do guia é um cadastro válido com um repositório
  assert.deepEqual(resumoDoCadastro(path.join(RAIZ, 'docs/exemplos/repositories.exemplo.json')), { estado: 'legivel', repositorios: 1 });
});

test('o estado junta a ferramenta e o cadastro, com o pino e sem caminho de arquivo', async () => {
  const pronto = await estadoMod.estadoDaAvaliacaoTecnica({ verify: integra, cadastro: cadastro('legivel', 3) });
  assert.deepEqual(pronto, { ferramenta: 'integra', versao: TOOL.version, commit: TOOL.commit, cadastro: 'legivel', repositorios: 3 });
  assert.equal(estadoMod.avaliacaoPronta(pronto), true);
  assert.equal(estadoMod.textoDoEstado(pronto), `ferramenta instalada e íntegra (eng-behaviour ${TOOL.version}, commit ${TOOL.commit.slice(0, 12)}); 3 repositórios declarados`);

  const semFerramenta = await estadoMod.estadoDaAvaliacaoTecnica({ verify: ausente, cadastro: cadastro('legivel', 1) });
  assert.equal(semFerramenta.ferramenta, 'ausente');
  assert.equal(estadoMod.avaliacaoPronta(semFerramenta), false);
  assert.match(estadoMod.textoDoEstado(semFerramenta), /^ferramenta ausente \(eng-behaviour \S+, commit [0-9a-f]{12} não instalada\); 1 repositório declarado: a avaliação técnica dos repositórios declarados falha/);

  const torta = await estadoMod.estadoDaAvaliacaoTecnica({ verify: naoComprovada, cadastro: cadastro('ausente') });
  assert.equal(torta.ferramenta, 'nao-comprovada');
  assert.match(estadoMod.textoDoEstado(torta), /^ferramenta com identidade não comprovada \(esperada: eng-behaviour .*\); cadastro de repositórios ausente \(nenhum repositório declarado\): nenhum repositório é avaliado/);

  const ilegivel = await estadoMod.estadoDaAvaliacaoTecnica({ verify: integra, cadastro: cadastro('ilegivel') });
  assert.match(estadoMod.textoDoEstado(ilegivel), /cadastro de repositórios ilegível: a avaliação técnica falha para todo repositório/);
  assert.equal(estadoMod.avaliacaoPronta(ilegivel), false);
  for (const estado of [pronto, semFerramenta, torta, ilegivel]) {
    const texto = estadoMod.textoDoEstado(estado);
    assert.doesNotMatch(texto, /[\\/]|toolchains|repositories\.json/, 'sem caminho de arquivo');
    assert.doesNotMatch(texto, TRAVESSAO);
  }
});

test('o diagnóstico mostra a avaliação técnica em uma verificação própria', async () => {
  const doDoctor = await avaliacaoTecnicaDoDoctor({ verify: integra, cadastro: cadastro('legivel', 2) });
  assert.equal(doDoctor.pronta, true);
  assert.equal(doDoctor.detalhe, estadoMod.textoDoEstado(doDoctor));
  const linha = (info) => ambienteDoDoctor(info).find((l) => l.label === 'Avaliação técnica');
  assert.deepEqual(linha({ avaliacaoTecnica: doDoctor }), { label: 'Avaliação técnica', ok: true, detalhe: doDoctor.detalhe });
  const falta = await avaliacaoTecnicaDoDoctor({ verify: ausente, cadastro: cadastro('legivel', 2) });
  assert.equal(linha({ avaliacaoTecnica: falta }).ok, false);
  assert.match(linha({ avaliacaoTecnica: falta }).detalhe, /^ferramenta ausente/);
  assert.deepEqual(linha({}), { label: 'Avaliação técnica', ok: false, detalhe: 'não verificada' });
});

test('a linha do boot é INFO, e WARN quando há repositório declarado sem a ferramenta íntegra', async () => {
  const hospedada = { ligada: true }, local = { ligada: false };
  const caso = async (verificar, cad, modo) => estadoMod.linhaDoBoot(await estadoMod.estadoDaAvaliacaoTecnica({ verify: verificar, cadastro: cad }), modo);
  assert.equal((await caso(integra, cadastro('legivel', 2), hospedada)).nivel, 'INFO');
  assert.equal((await caso(ausente, cadastro('ausente'), hospedada)).nivel, 'INFO', 'sem cadastro não há o que avaliar: é estado, não falha');
  assert.equal((await caso(integra, cadastro('legivel', 0), hospedada)).nivel, 'INFO');
  const semFerramenta = await caso(ausente, cadastro('legivel', 2), hospedada);
  assert.equal(semFerramenta.nivel, 'WARN');
  assert.match(semFerramenta.texto, /^avaliação técnica: ferramenta ausente .*2 repositórios declarados: a avaliação técnica dos repositórios declarados falha: nenhuma regra é avaliada, a sessão de revisão é orientada a não aprovar e nenhuma aprovação deles sai como limpa, até a ferramenta íntegra ser instalada\. Instale no volume, dentro do container e como o usuário do motor: node lib\/technical-review\/setup\.js \(docs\/HOSPEDAGEM\.md\)\.$/);
  assert.match((await caso(naoComprovada, cadastro('legivel', 1), local)).texto, /Instale com: node lib\/technical-review\/setup\.js \(docs\/CONFIGURATION\.md\)\.$/);
  const ilegivel = await caso(integra, cadastro('ilegivel'), hospedada);
  assert.equal(ilegivel.nivel, 'WARN');
  assert.doesNotMatch(ilegivel.texto, /Instale/);

  const linhas = [];
  const engine = { log: (nivel, texto) => linhas.push([nivel, texto]), doctorInfo: { avaliacaoTecnica: await estadoMod.estadoDaAvaliacaoTecnica({ verify: integra, cadastro: cadastro('legivel', 1) }) } };
  registrarAvaliacaoNoBoot(engine);
  assert.deepEqual(linhas.map((l) => l[0]), ['INFO'], 'uma linha por boot');
  assert.match(linhas[0][1], /^avaliação técnica: ferramenta instalada e íntegra/);
  registrarAvaliacaoNoBoot({ log: () => assert.fail('sem diagnóstico não há linha'), doctorInfo: null });
});

// O que o WARN e o guia afirmam sobre o repositório declarado sem a ferramenta: a falha de
// execução não é lacuna dura, e na rodada que decide ela é ressalva. A aprovação não sai limpa.
test('ferramenta ausente em repositório declarado: falha de execução, que a rodada trata como ressalva', () => {
  const report = { schema: 1, verdict: 'not-run', error: 'ferramenta técnica fixada não instalada', failure: 'tool', version: TOOL.version, toolCommit: TOOL.commit, profile: 'impressao' };
  const lacuna = technicalGap(report, { repo: 'acme/api', profile: 'impressao' });
  assert.equal(lacuna, 'execução da avaliação técnica não concluída');
  assert.equal(ehLacunaDura(lacuna), false);
  assert.equal(technicalSummary(report, undefined, { provaEsgotada: true, evidenceVersion: 2 }).state, 'ressalva');
  assert.equal(technicalSummary(report, undefined, {}).state, 'pending', 'sem a marca da rodada, segue pendente');
});
