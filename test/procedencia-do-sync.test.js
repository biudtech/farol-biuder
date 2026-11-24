// A procedência do sync (24/11/2026): quem é a origem e qual é a foto. Head contínuo é o caso de
// hoje; head de trabalho (`sync/*`) é sync quando um merge commit do PR traz a ponta de uma branch
// contínua ou bancada e o primeiro pai está na linhagem da base. Falta de dado nunca vira sync.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { lerProcedenciaDoSync, branchesCitadas, ordemDasCandidatas, avaliarProcedencia } = await import('../lib/engine/procedencia-do-sync.js');
const { FOTO, P1, BASE_PONTA, PONTA_DA_HOMOLOGATION, sha, cenarioDoSync, stubDoSync, commitDaOrigem, mergeDoSync } = await import('./helpers/github-do-sync.js');

const runReal = io.run;
after(() => { io.run = runReal; });
const engine = { accountForPr: () => 'eu', tokenFor: () => 'token', ghEnv: () => ({}) };

async function ler(c, head = c.head) {
  io.run = stubDoSync(c);
  return lerProcedenciaDoSync(engine, { key: `${c.repo}#${c.numero}`, repo: c.repo, number: c.numero }, head);
}

test('head contínuo com commits de PRs mesclados: origem é o head e a foto é a ponta dele', async () => {
  const c = cenarioDoSync({ headRef: 'homologation', commits: [commitDaOrigem(1), commitDaOrigem(2)] });
  assert.deepEqual(await ler(c), { origem: 'homologation', destino: 'development', foto: c.head, baseDaResolucao: c.baseOid, commits: 2, viaMerge: false });
});

test('head sync/* com merge da homologation: a foto é o segundo pai e a régua é o primeiro', async () => {
  const c = cenarioDoSync({ commits: [commitDaOrigem(1), mergeDoSync({ primeiroPai: P1, foto: FOTO, mensagem: "Merge branch 'homologation' into sync/homologation-into-development-20261124" })] });
  assert.deepEqual(await ler(c), { origem: 'homologation', destino: 'development', foto: FOTO, baseDaResolucao: P1, commits: 2, viaMerge: true });
  assert.ok(c.chamadas.some((x) => x.includes(`compare/${P1}...${BASE_PONTA}`)), 'o primeiro pai é conferido na linhagem da base');
});

test('segundo pai que não é ancestral de branch contínua: não é sync', async () => {
  const c = cenarioDoSync();
  c.comparacoes[`${FOTO}...${PONTA_DA_HOMOLOGATION}`] = { behind: 2, mergeBase: sha('ab'), files: [] };
  assert.equal(await ler(c), null);
});

test('primeiro pai fora da linhagem da base: não é sync', async () => {
  const c = cenarioDoSync();
  c.comparacoes[`${P1}...${BASE_PONTA}`] = { behind: 1, mergeBase: sha('ab'), files: [] };
  assert.equal(await ler(c), null);
});

test('commit sem PR mesclado: não é sync', async () => {
  const c = cenarioDoSync({ commits: [commitDaOrigem(1, 'homologation', []), mergeDoSync()] });
  assert.equal(await ler(c), null);
});

test('commit cujo PR mesclado não foi numa branch contínua: não é sync', async () => {
  const c = cenarioDoSync({ commits: [commitDaOrigem(1, 'feat/rascunho'), mergeDoSync()] });
  assert.equal(await ler(c), null);
});

test('sem merge commit no head de trabalho: não é sync', async () => {
  const c = cenarioDoSync({ commits: [commitDaOrigem(1), commitDaOrigem(2)] });
  assert.equal(await ler(c), null);
});

test('mais de um merge commit: vale o mais recente e o anterior segue a regra de hoje', async () => {
  const antigo = { ...mergeDoSync({ primeiroPai: sha('f1'), foto: sha('f2'), oid: sha('f3') }), prs: [{ number: 90, base: 'homologation' }] };
  const c = cenarioDoSync({ commits: [antigo, commitDaOrigem(1), mergeDoSync()] });
  assert.equal((await ler(c)).foto, FOTO);
  const semPr = cenarioDoSync({ commits: [{ ...antigo, prs: [] }, commitDaOrigem(1), mergeDoSync()] });
  assert.equal(await ler(semPr), null, 'o merge anterior sem PR mesclado desfaz o sync');
});

test('mensagem que cita a bancada: ela vence a ordem fixa', async () => {
  const bancada = 'release_hmg_2026.11';
  const pontaDaBancada = sha('be');
  const c = cenarioDoSync({ commits: [commitDaOrigem(1), mergeDoSync({ mensagem: `Merge pull request #12 from biudtech/${bancada}` })] });
  c.refs[bancada] = pontaDaBancada;
  c.comparacoes[`${FOTO}...${pontaDaBancada}`] = { behind: 0, mergeBase: FOTO, files: [] };
  assert.equal((await ler(c)).origem, bancada);
});

test('sem citação: a primeira da ordem fixa que contém a foto, e a bancada só se nenhuma contínua contiver', async () => {
  const c = cenarioDoSync({ commits: [commitDaOrigem(1), mergeDoSync({ mensagem: 'Merge commit' })] });
  assert.equal((await ler(c)).origem, 'homologation');
  assert.equal(c.chamadas.some((x) => x.includes('matching-refs')), false, 'a lista das bancadas não é lida à toa');
  const bancada = 'release_prd_2026.11';
  const soNaBancada = cenarioDoSync({ commits: [commitDaOrigem(1), mergeDoSync({ mensagem: 'Merge commit' })], refs: { [bancada]: sha('bf') } });
  soNaBancada.comparacoes[`${FOTO}...${sha('bf')}`] = { behind: 0, mergeBase: FOTO, files: [] };
  assert.equal((await ler(soNaBancada)).origem, bancada);
});

for (const falha of ['graphql', `compare/${P1}`, 'git/ref/heads/homologation', `compare/${FOTO}`]) {
  test(`leitura que falha (${falha}): null`, async () => {
    assert.equal(await ler(cenarioDoSync({ falhas: [falha] })), null);
  });
}

test('mais de 100 commits: null', async () => {
  const c = cenarioDoSync({ total: 101 });
  assert.equal(await ler(c), null);
});

test('lista de commits que não fecha com a contagem: null', async () => {
  const c = cenarioDoSync({ total: 3 });
  assert.equal(await ler(c), null);
});

test('head lido no GitHub diferente do head da revisão: null', async () => {
  const c = cenarioDoSync();
  assert.equal(await ler(c, sha('99')), null);
});

test('PR de fork: null', async () => {
  const c = cenarioDoSync({ cross: true });
  assert.equal(await ler(c), null);
});

test('base que não é contínua nem bancada: null', async () => {
  const c = cenarioDoSync({ base: 'feat/x' });
  assert.equal(await ler(c), null);
});

test('avaliarProcedencia é pura e recusa dado torto', () => {
  assert.equal(avaliarProcedencia(null, 1, FOTO), null);
  assert.equal(avaliarProcedencia({ number: 2 }, 1, FOTO), null);
});

test('branchesCitadas e ordemDasCandidatas', () => {
  assert.deepEqual(branchesCitadas("Merge branch 'homologation' into sync/x"), ['homologation']);
  assert.deepEqual(branchesCitadas('Merge pull request #12 from biudtech/release_hmg_2026.11'), ['release_hmg_2026.11']);
  assert.deepEqual(branchesCitadas("Merge remote-tracking branch 'origin/production' into development"), ['production', 'development']);
  assert.deepEqual(branchesCitadas(''), []);
  assert.deepEqual(ordemDasCandidatas(['production', 'development'], 'development', ['release_prd_b', 'release_hmg_a']),
    ['production', 'homologation', 'main', 'master', 'release_hmg_a', 'release_prd_b']);
});
