# Sync por herança: plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans, tarefa por tarefa. Os passos usam checkbox (`- [ ]`). Branch
> `feat/sync-por-heranca`, nesta worktree. Nunca rebase: a base entra por merge commit. Commit sem
> trailer de autoria nem menção de IA. LF em todo arquivo.

**Goal:** o PR de sincronização entre branches contínuas passa a herdar sem leitura os arquivos
idênticos à ponta da origem que a base não mexeu, e a sessão lê e prova só o resto; sem nada a
ler, o motor decide sem sessão.

**Architecture:** uma medição nova antes da sessão (`lib/engine/procedencia-do-sync.js` acha a
origem e a foto; `lib/engine/regua-de-heranca.js`, extraída de `heranca-de-producao.js`, compara
com a foto; `lib/engine/sync-por-heranca.js` separa herdados e a ler) entra como terceira fonte de
herança em `prepareReviewReading`, pelo `juntarHerancas` que já existe. Daí ela flui pelo que a
herança já alimenta (fan-out, bloco de prova, cobertura, prova gravada) e por três marcas do motor:
`session.herancaDoSync` (avaliação técnica), `result.herancaDoSync` (alcance, achado da sessão,
`sincronizacao`, registro) e a prova `technicalApprovals` do caminho sem sessão, que reaproveita o
fluxo do diff vazio extraído para `lib/engine/aprovacao-sem-sessao.js`.

**Tech Stack:** Node 24 puro (`>=24.22.1 <25`), ES modules, `node:test` e `node:assert/strict`,
`gh` pelo `io.run` (stubado nos testes). Sem pacote novo.

**Spec:** `docs/superpowers/specs/2026-11-24-sync-por-heranca-design.md` (ler inteiro, inclusive
"Decisões do dono").

**Comando de teste (WSL):**
`wsl -e bash -lc 'export PATH="$HOME/node24/node-v24.22.1-linux-x64/bin:$PATH"; cd /mnt/c/Users/wanderson/Documents/biud/github/farol-biuder-sync && node --test test/<arquivo>'`.
"Rodar `test/x.test.js`" abaixo quer dizer este comando com o arquivo. A suíte inteira:
o mesmo prefixo com `FAROL_TEST_CONCORRENCIA=4 npm test` (nunca mais de 4). Teste que precisa de
`git` falha por ambiente nesta worktree; o gate completo (`npm run check && npm run lint && npm test`)
roda num clone nativo no Linux antes do PR.

## Global Constraints

- Invariante 1: Node puro, `npm ls --omit=dev` vazio; nada de pacote novo.
- Invariante 3: log novo só a linha INFO por decisão no caminho do sync; falha de medição não loga (volta à revisão de hoje em silêncio).
- Invariante 4: todo APPROVE sem sessão passa por `postReview` e por todos os portões; a sessão nunca marca herança.
- Testes de gate intocados: `test/postagem-*.test.js`, `test/credencial-no-texto.test.js`, `test/public-review-language.test.js`, `test/pr-proprio.test.js`, `test/espera-regras-e-pr-proprio.test.js`, `test/instancia-isolada.test.js` e os demais de espera do CI e dedup por head; `test/diff-vazio-de-linhagem.test.js` e `test/heranca-de-producao.test.js` também não mudam (provam que a extração não mudou comportamento).
- Invariantes 5 e 6: sem ramo de sistema operacional; texto e comentário em português, sem travessão.
- Ratchet (`tools/quality/baseline.json`): `lib/engine/review.js` não ganha linha útil (a troca da Tarefa 9 é linha por linha); `lib/engine/decision.js` não ganha linha útil (a Tarefa 6 compensa o import juntando duas linhas do literal); arquivo novo fica com até 400 linhas úteis e profundidade 3.
- Falta de dado nunca vira herança: leitura que falha, resposta torta, compare com 300 arquivos ou mais, mais de 100 commits, mapa ausente para código: a revisão é a de hoje.
- O teto da comparação é `TETO_DA_COMPARACAO = 300` (o mesmo de `heranca-de-producao.js`); o de commits é `TETO_DE_COMMITS = 100` (o de `pr-de-sincronizacao.js`).
- A régua da base é o primeiro pai do merge commit do sync (decisão 1 do dono), nunca a ponta atual da base, no head de trabalho; no head contínuo é a base do PR (a régua de hoje).
- Os argumentos do `gh` de `heranca-de-producao.js` não mudam de texto (o stub do teste dele casa por eles).

## Review Focus

1. Envelope da sessão que traz `herancaDoSync` ou `sincronizacao` forjados: o motor descarta e só vale a marca que ele montou. Teste `marca de herança do sync escrita pelo modelo é descartada` na Tarefa 5.
2. Sessão que declara um herdado como lido em `coverage.reviewed`: nada muda, o arquivo fica em `coverage.inherited` e não entra no índice entre PRs. Teste `herdado declarado como lido fica em coverage.inherited e fora do índice` na Tarefa 5.
3. Head que anda entre o enfileiramento e a medição (o GraphQL lê outro `headRefOid`): não há herança. Teste `head lido no GitHub diferente do head da revisão: null` na Tarefa 2.
4. Segunda rodada do mesmo PR de sync depois de um push: a prova gravada não carrega a herança do sync como leitura; o arquivo é medido de novo. Teste `prova com origem do sync não herda pela prova do PR` na Tarefa 4.
5. Avaliação técnica que falha ou acha algo fora dos herdados antes da decisão sem sessão: a sessão abre, nada é aprovado sem leitura. Testes `avaliação técnica que falha: a sessão abre` e `achado técnico fora dos herdados: a sessão abre` na Tarefa 9.

---

### Tarefa 1: a régua comum de herança, extraída da production

**Files:**
- Create: `lib/engine/regua-de-heranca.js`
- Modify: `lib/engine/heranca-de-producao.js` (`ler`, `arquivosDe`, `COMPARACAO` e o miolo de `provaDaHeranca` saem para a régua)
- Test: `test/regua-de-heranca.test.js` (novo); `test/heranca-de-producao.test.js` roda sem mudança

**Interfaces:**
- Consumes: `io.run`, `engine.ghEnv(conta)`, `SHA` de `lib/review-source/contract.js`.
- Produces (todos exportados de `regua-de-heranca.js`):
  - `TETO_DA_COMPARACAO = 300`; `NAO_EXISTE: symbol`.
  - `ler(engine, conta, args: string[]) -> Promise<object|null|NAO_EXISTE>` (o de hoje, movido).
  - `comparar(engine, conta, repo, de, para) -> Promise<{ base, mergeBase, behind, files }|null>`: `gh api repos/${repo}/compare/${de}...${para}?per_page=1 --jq <COMPARACAO de hoje>`.
  - `arquivosDe(comparacao) -> string[]|null` (o de hoje: caminho novo e antigo; null no teto ou forma torta).
  - `ehAncestral(comparacao, de) -> boolean`: `behind === 0 && base === de && mergeBase === de`.
  - `compararComAFoto(engine, conta, repo, { foto, head, baseDaResolucao }) -> Promise<{ diferemDaFoto: string[], mexidosNaBase: string[] }|null>`.

- [ ] **Passo 1: escrever o teste que falha** em `test/regua-de-heranca.test.js`, com `io.run` stubado como em `test/heranca-de-producao.test.js` (comparação respondida por `${de}...${para}`):

```js
test('foto ancestral do head e base com mudança própria: as duas listas, rename pelos dois caminhos', async () => {
  gh.comparacoes[`${FOTO}...${HEAD}`] = { base: FOTO, mergeBase: FOTO, behind: 0, files: [{ filename: 'a.ts' }] };
  gh.comparacoes[`${FOTO}...${P1}`] = { base: FOTO, mergeBase: ANC, behind: 3, files: [{ filename: 'b.ts', previous_filename: 'b-antigo.ts' }] };
  assert.deepEqual(await compararComAFoto(engine, 'eu', 'acme/api', { foto: FOTO, head: HEAD, baseDaResolucao: P1 }),
    { diferemDaFoto: ['a.ts'], mexidosNaBase: ['b.ts', 'b-antigo.ts'] });
});
test('head que não contém a foto: null', async () => { /* behind: 1 no lado do head */ assert.equal(await compararComAFoto(...), null); });
test('comparação no teto de 300 arquivos: null', async () => { /* files com 300 entradas */ assert.equal(await compararComAFoto(...), null); });
test('leitura que falha: null', async () => { /* HTTP 502 */ assert.equal(await compararComAFoto(...), null); });
test('ehAncestral exige behind 0 e o merge-base na própria ponta', () => {
  assert.equal(ehAncestral({ base: FOTO, mergeBase: FOTO, behind: 0 }, FOTO), true);
  assert.equal(ehAncestral({ base: FOTO, mergeBase: ANC, behind: 0 }, FOTO), false);
  assert.equal(ehAncestral(null, FOTO), false);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/regua-de-heranca.test.js`. Esperado: FAIL, módulo inexistente.
- [ ] **Passo 3: implementar** `lib/engine/regua-de-heranca.js` com as assinaturas acima. `compararComAFoto`: `doHead = comparar(foto, head)` exige `ehAncestral(doHead, foto)`; `daBase = comparar(foto, baseDaResolucao)` exige `daBase.base === foto` e `SHA.test(daBase.mergeBase)`; as duas `arquivosDe` não nulas. Em `heranca-de-producao.js`, `provaDaHeranca` passa a chamar `compararComAFoto(engine, conta, pr.repo, { foto: producao.sha, head: headSha, baseDaResolucao: base.baseSha })` e devolve `{ arquivos, contextoAlterado }` exatamente como hoje; `ler` e `NAO_EXISTE` vêm da régua.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/regua-de-heranca.test.js` e `test/heranca-de-producao.test.js`. Esperado: PASS nos dois, o segundo sem nenhuma linha alterada.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/regua-de-heranca.js lib/engine/heranca-de-producao.js test/regua-de-heranca.test.js
git commit -m "refactor(heranca): extrai a régua de comparação com a foto da herança da production"
```

---

### Tarefa 2: a procedência do sync (origem e foto)

**Files:**
- Create: `lib/engine/procedencia-do-sync.js`
- Create: `test/helpers/github-do-sync.js` (o GitHub falso do sync, reusado nas Tarefas 4, 6, 9 e 10)
- Modify: `lib/engine/pr-de-sincronizacao.js` (exporta `commitDeOutroPr` e `ORDEM_DAS_CONTINUAS = [...CONTINUAS]`)
- Test: `test/procedencia-do-sync.test.js`

**Interfaces:**
- Consumes: `ler`, `comparar`, `ehAncestral`, `NAO_EXISTE` (Tarefa 1); `ehBranchContinua`, `commitDeOutroPr`, `ORDEM_DAS_CONTINUAS` de `pr-de-sincronizacao.js`.
- Produces:
  - `TETO_DE_CANDIDATAS = 8`.
  - `avaliarProcedencia(dados, numero, head) -> { tipo: 'continuo', origem, destino, foto, baseDaResolucao, commits } | { tipo: 'merge', destino, baseOid, commits, merge: { oid, primeiroPai, foto, citadas: string[] } } | null` (PURA). `dados` é a saída do `--jq`: `{ number, headRefName, baseRefName, headRefOid, baseRefOid, isCrossRepository, total, commits: [{ oid, pais: string[], mensagem, prs: [{ number, base }] }] }`.
  - `branchesCitadas(mensagem: string) -> string[]` (PURA).
  - `ordemDasCandidatas(citadas: string[], destino: string, bancadas: string[]) -> string[]` (PURA).
  - `lerProcedenciaDoSync(engine, pr, head) -> Promise<ProcedenciaDoSync|null>`, com `ProcedenciaDoSync = { origem, destino, foto, baseDaResolucao, commits, viaMerge: boolean }`.
  - Helper de teste: `FOTO = '158c3d8' + '0'.repeat(33)`, `P1 = '9c5f4d1' + '0'.repeat(33)`, `cenarioDoSync(over) -> Cenario`, `stubDoSync(cenario) -> (cmd, args) => Promise<{ ok, code, stdout, stderr }>`, `commitDaOrigem(n, base = 'homologation')`, `mergeDoSync({ primeiroPai, foto, mensagem })`. `Cenario = { repo, numero, head, headRef, base, baseOid, cross, commits, refs: { [nome]: sha }, comparacoes: { ['A...B']: { behind, mergeBase, files } }, falhas: string[], chamadas: string[] }`. O stub responde: GraphQL que contém `parents` com `dados`; `compare/A...B` com `{ base: A, ...comparacoes['A...B'] }` (chave ausente: 404); `git/ref/heads/<nome>` com `{ sha }` ou `gh: Not Found (HTTP 404)`; `git/matching-refs/heads/release_` com a lista das bancadas de `refs`; qualquer argumento que contenha um item de `falhas` devolve `HTTP 502`. Cada chamada vai para `cenario.chamadas`.

- [ ] **Passo 1: escrever o teste que falha** em `test/procedencia-do-sync.test.js`:

```js
test('head contínuo com commits de PRs mesclados: origem é o head e a foto é a ponta dele', async () => {
  const c = cenarioDoSync({ headRef: 'homologation', commits: [commitDaOrigem(1), commitDaOrigem(2)] });
  assert.deepEqual(await ler(c), { origem: 'homologation', destino: 'development', foto: c.head, baseDaResolucao: c.baseOid, commits: 2, viaMerge: false });
});
test('head sync/* com merge da homologation: a foto é o segundo pai e a régua é o primeiro', async () => {
  const c = cenarioDoSync({ headRef: 'sync/homologation-into-development-20261124',
    commits: [commitDaOrigem(1), mergeDoSync({ primeiroPai: P1, foto: FOTO, mensagem: "Merge branch 'homologation' into sync/homologation-into-development-20261124" })] });
  assert.deepEqual(await ler(c), { origem: 'homologation', destino: 'development', foto: FOTO, baseDaResolucao: P1, commits: 2, viaMerge: true });
});
test('segundo pai que não é ancestral de branch contínua: não é sync', async () => { /* compare FOTO...<ponta> com behind 2 em todas */ assert.equal(await ler(c), null); });
test('primeiro pai fora da linhagem da base: não é sync', async () => { /* compare P1...baseOid com behind 1 */ assert.equal(await ler(c), null); });
test('commit sem PR mesclado: não é sync', async () => { /* commitDaOrigem com prs: [] */ assert.equal(await ler(c), null); });
test('mais de um merge commit: vale o mais recente e o anterior segue a regra de hoje', async () => {
  /* merge antigo com prs de PR mesclado na homologation, merge novo com foto FOTO */ assert.equal((await ler(c)).foto, FOTO);
});
test('mensagem que cita a bancada: ela vence a ordem fixa', async () => {
  /* FOTO ancestral da homologation e de release_hmg_2026.11; mensagem "Merge pull request #12 from biudtech/release_hmg_2026.11" */
  assert.equal((await ler(c)).origem, 'release_hmg_2026.11');
});
for (const falha of ['graphql', `compare/${P1}`, 'git/ref/heads/homologation']) {
  test(`leitura que falha (${falha}): null`, async () => { assert.equal(await ler(cenarioDoSync({ ..., falhas: [falha] })), null); });
}
test('mais de 100 commits: null', async () => { /* total: 101 */ assert.equal(await ler(c), null); });
test('head lido no GitHub diferente do head da revisão: null', async () => { /* headRefOid != head passado */ assert.equal(await ler(c), null); });
test('PR de fork: null', async () => { /* isCrossRepository: true */ assert.equal(await ler(c), null); });
test('branchesCitadas e ordemDasCandidatas', () => {
  assert.deepEqual(branchesCitadas("Merge branch 'homologation' into sync/x"), ['homologation']);
  assert.deepEqual(branchesCitadas('Merge pull request #12 from biudtech/release_hmg_2026.11'), ['release_hmg_2026.11']);
  assert.deepEqual(branchesCitadas("Merge remote-tracking branch 'origin/production' into development"), ['production', 'development']);
  assert.deepEqual(ordemDasCandidatas(['production', 'development'], 'development', ['release_prd_b', 'release_hmg_a']),
    ['production', 'homologation', 'main', 'master', 'release_hmg_a', 'release_prd_b']);
});
```

  `ler(c)` é `io.run = stubDoSync(c); return lerProcedenciaDoSync(engine, pr, c.head)` com um `Engine` de `FAROL_HOME` temporário (`accountForPr`, `tokenFor` e `ghEnv` como em `test/pr-de-sincronizacao.test.js`).

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/procedencia-do-sync.test.js`. Esperado: FAIL, módulo inexistente.
- [ ] **Passo 3: implementar** `lib/engine/procedencia-do-sync.js`. Consulta GraphQL própria, com os campos de `pr-de-sincronizacao.js` mais `headRefOid baseRefOid` e, por commit, `message parents(first:3){nodes{oid}}`. `avaliarProcedencia`: confere número, `isCrossRepository === false`, `headRefOid === head`, base contínua ou bancada, `1 <= total <= 100` com a lista fechando e SHAs válidos. Head contínuo diferente da base: todos os commits `commitDeOutroPr`, `foto = headRefOid`, `baseDaResolucao = baseRefOid`. Senão: o último commit da lista com exatamente 2 pais é o merge; todos os outros passam em `commitDeOutroPr`; `citadas = branchesCitadas(mensagem)`. `branchesCitadas`: quebra a mensagem em espaços e aspas; de cada pedaço tenta ele, sem `origin/` e o último segmento depois de `/`; fica o que passa em `ehBranchContinua`, sem repetição, na ordem. `ordemDasCandidatas`: citadas, depois `ORDEM_DAS_CONTINUAS`, depois bancadas em ordem alfabética; sem repetição, sem o destino, no máximo `TETO_DE_CANDIDATAS`. `lerProcedenciaDoSync`, no caminho do merge: `comparar(primeiroPai, baseOid)` tem de dar `ehAncestral(..., primeiroPai)`; percorre as candidatas (as bancadas de `git/matching-refs/heads/release_` só são lidas se citadas e contínuas não acharem a origem), lê a ref (404 pula; outra falha devolve null) e para na primeira com `ehAncestral(comparar(foto, ponta), foto)`; devolve `baseDaResolucao = primeiroPai`. Qualquer exceção: null.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/procedencia-do-sync.test.js` e `test/pr-de-sincronizacao.test.js`. Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/procedencia-do-sync.js lib/engine/pr-de-sincronizacao.js test/helpers/github-do-sync.js test/procedencia-do-sync.test.js
git commit -m "feat(sync): mede a procedência do sync, com a origem e a foto do merge da branch de trabalho"
```

---

### Tarefa 3: herdados e a ler (a separação pura)

**Files:**
- Create: `lib/engine/sync-por-heranca.js` (só a parte pura nesta tarefa)
- Modify: `lib/engine/review-rounds.js` (`arquivosComBloqueioAberto`)
- Test: `test/sync-por-heranca-separacao.test.js`

**Interfaces:**
- Consumes: `arquivoProtegido` (`lib/review-source/caminho-protegido.js`); `readRounds`, `frontier`, `historyIssues`, `scopeFor` (`review-round-store.js`); `previousBlockers` (`review-findings.js`).
- Produces:
  - `arquivosComBloqueioAberto(engine, pr) -> Set<string>|null` em `review-rounds.js`: o conjunto dos caminhos (`file` não vazio) dos bloqueios de `previousBlockers(frontier(rounds))`; memória ilegível (`readRounds` com `ok: false`) ou com `historyIssues` devolve null, e null encerra a herança do sync.
  - `separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados, mapa }) -> { herdados: string[], aLer: string[], contextoAlterado: string[] }` (PURA). `arquivos`: os do inventário (`{ path, sha, status, previousPath? }`); `bloqueados: Set<string>`; `mapa`: o `head` de `buildMap` (`{ files: [{ path, backend, limitations }], relations: [{ from, to }], unresolved: [{ from, specifier }] }`) ou null. `contextoAlterado = mexidosNaBase ∪ aLer`, sem repetição.
  - `voltamPorDependencia(candidatos: string[], alvos: Set<string>, mapa) -> Set<string>` (PURA).

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-por-heranca-separacao.test.js` (puro, menos o último bloco, que grava rodadas com a API de `review-round-store.js` como em `test/review-rounds.test.js`):

```js
const f = (path, extra = {}) => ({ path, sha: 'e'.repeat(40), status: 'modified', ...extra });
const mapaLimpo = (paths, extra = {}) => ({ files: paths.map((path) => ({ path, backend: 'babel', limitations: [] })), relations: [], unresolved: [], ...extra });
const separar = (over) => separarHerdados({ arquivos: [], diferemDaFoto: [], mexidosNaBase: [], bloqueados: new Set(), mapa: null, ...over });

test('idêntico à foto e base intocada: herdado', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa: mapaLimpo(['src/a.ts']) }).herdados, ['src/a.ts']);
});
test('idêntico à foto com a base tendo mexido: a ler (o sobrescrito)', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mexidosNaBase: ['src/a.ts'], mapa: mapaLimpo(['src/a.ts']) }).aLer, ['src/a.ts']);
});
test('diferente da foto: a ler', () => { assert.deepEqual(separar({ arquivos: [f('x.json')], diferemDaFoto: ['x.json'] }).aLer, ['x.json']); });
test('renomeado: conta pelo caminho novo e pelo antigo', () => {
  assert.deepEqual(separar({ arquivos: [f('novo.json', { status: 'renamed', previousPath: 'velho.json' })], mexidosNaBase: ['velho.json'] }).aLer, ['novo.json']);
  assert.deepEqual(separar({ arquivos: [f('novo.json', { status: 'renamed', previousPath: 'velho.json' })] }).herdados, ['novo.json']);
});
test('protegido: a ler mesmo idêntico', () => { assert.deepEqual(separar({ arquivos: [f('.env.example')] }).aLer, ['.env.example']); });
test('removido ou sem blob: a ler', () => {
  assert.deepEqual(separar({ arquivos: [f('velho.json', { status: 'removed', sha: '' })] }).aLer, ['velho.json']);
});
test('importa um misturado: volta à leitura', () => {
  const mapa = mapaLimpo(['src/guard.ts', 'src/mapa.ts'], { relations: [{ from: 'src/guard.ts', to: 'src/mapa.ts' }] });
  const r = separar({ arquivos: [f('src/guard.ts'), f('src/mapa.ts')], diferemDaFoto: ['src/mapa.ts'], mapa });
  assert.deepEqual(r.aLer.sort(), ['src/guard.ts', 'src/mapa.ts']);
});
test('importa arquivo que a base apagou (import relativo sem destino): volta à leitura', () => {
  const mapa = mapaLimpo(['src/painel.ts'], { unresolved: [{ from: 'src/painel.ts', specifier: './quadros-do-turno' }] });
  assert.deepEqual(separar({ arquivos: [f('src/painel.ts')], mexidosNaBase: ['src/quadros-do-turno.ts'], mapa }).aLer, ['src/painel.ts']);
});
test('pacote externo não resolvido não devolve à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts'], { unresolved: [{ from: 'src/a.ts', specifier: 'react' }] });
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa }).herdados, ['src/a.ts']);
});
test('dependência transitiva: importa um herdado que voltou à leitura', () => {
  const mapa = mapaLimpo(['src/a.ts', 'src/b.ts', 'src/m.ts'], { relations: [{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/b.ts', to: 'src/m.ts' }] });
  assert.deepEqual(separar({ arquivos: [f('src/a.ts'), f('src/b.ts'), f('src/m.ts')], diferemDaFoto: ['src/m.ts'], mapa }).herdados, []);
});
test('código sem conferência de dependência volta; dado sem import herda', () => {
  assert.deepEqual(separar({ arquivos: [f('src/a.ts'), f('app/x.py'), f('prisma/schema.prisma'), f('docs/x.md')], mapa: null }).herdados,
    ['prisma/schema.prisma', 'docs/x.md']);
  const textual = { files: [{ path: 'src/a.ts', backend: 'textual', limitations: [] }], relations: [], unresolved: [] };
  assert.deepEqual(separar({ arquivos: [f('src/a.ts')], mapa: textual }).aLer, ['src/a.ts']);
});
test('achado bloqueante aberto de rodada anterior: volta à leitura', () => {
  assert.deepEqual(separar({ arquivos: [f('x.json')], bloqueados: new Set(['x.json']) }).aLer, ['x.json']);
});
test('contextoAlterado junta o que a base mexeu e o que ficou a ler', () => {
  assert.deepEqual(separar({ arquivos: [f('x.json')], diferemDaFoto: ['x.json'], mexidosNaBase: ['y.ts'] }).contextoAlterado.sort(), ['x.json', 'y.ts']);
});
test('arquivosComBloqueioAberto: os arquivos dos bloqueios da fronteira; memória ilegível dá null', () => {
  /* grava uma rodada com unresolved [{ severity: 'blocking', file: 'src/a.ts', ... }] */
  assert.deepEqual([...arquivosComBloqueioAberto(engine, pr)], ['src/a.ts']);
  /* pasta da memória trocada por arquivo: readRounds devolve ok false */
  assert.equal(arquivosComBloqueioAberto(engine, pr), null);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-por-heranca-separacao.test.js`. Esperado: FAIL, exportações inexistentes.
- [ ] **Passo 3: implementar** em `lib/engine/sync-por-heranca.js`. Candidato: tem `path` e `sha`, `status !== 'removed'`, não é `arquivoProtegido`, e nem `path` nem `previousPath` estão em `diferemDaFoto ∪ mexidosNaBase` ou em `bloqueados`. Os candidatos passam por `voltamPorDependencia(candidatos, new Set([...aLer, ...mexidosNaBase]), mapa)`; quem volta entra em `aLer`. O algoritmo de dependência, que nenhum teste sozinho determina:

```js
const CODIGO_DO_MAPA = /\.(?:[cm]?[jt]s|[jt]sx)$/i;       // o que o mapa de review-context lê
const CODIGO_SEM_MAPA = /\.(?:py|go|java|kt|rb|php|cs|rs|vue|svelte)$/i; // código sem grafo de import
const relativo = (s) => s == null || /^[./]/.test(s);
// ponto fixo: o que volta vira alvo, e quem importa o que voltou volta também
function voltamPorDependencia(candidatos, alvos, mapa) {
  const voltam = new Set();
  const conferivel = (p) => !!mapa && mapa.files.some((x) => x.path === p && x.backend !== 'textual' && !x.limitations?.length);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const p of candidatos) {
      if (voltam.has(p)) continue;
      const deCodigo = CODIGO_DO_MAPA.test(p);
      const volta = CODIGO_SEM_MAPA.test(p) || (deCodigo && (!conferivel(p)
        || mapa.relations.some((r) => r.from === p && (alvos.has(r.to) || voltam.has(r.to)))
        || mapa.unresolved.some((u) => u.from === p && relativo(u.specifier))));
      if (volta) { voltam.add(p); mudou = true; }
    }
  }
  return voltam;
}
```

  (o implementador pode achatar em funções para caber na profundidade 3; o comportamento é este). `arquivosComBloqueioAberto` em `review-rounds.js` segue a mesma leitura de `prepareRoundReview`.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-por-heranca-separacao.test.js` e `test/review-rounds.test.js`. Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/sync-por-heranca.js lib/engine/review-rounds.js test/sync-por-heranca-separacao.test.js
git commit -m "feat(sync): separa herdados e a ler, com dependência e bloqueio aberto voltando à leitura"
```

---

### Tarefa 4: a herança do sync na leitura da revisão

**Files:**
- Modify: `lib/engine/sync-por-heranca.js` (`herdarDoSync`, `fecharSync`)
- Modify: `lib/engine/analysis-source.js` (`prepareReviewReading`, `preparedPatchScope`)
- Modify: `lib/engine/file-proof.js` (`splitByProof`)
- Test: `test/sync-por-heranca-leitura.test.js`

**Interfaces:**
- Consumes: `lerProcedenciaDoSync` (Tarefa 2), `compararComAFoto` (Tarefa 1), `separarHerdados` e `arquivosComBloqueioAberto` (Tarefa 3), `juntarHerancas` (`prova-do-repositorio.js`), `sourceRuntime.buildMap`.
- Produces:
  - `HerancaSync = { origem, destino, foto, baseDaResolucao, commits, herdados: string[], aLer: string[], contextoAlterado: string[] }`.
  - `herdarDoSync(engine, pr, head, arquivos, combinada, { prepared, buildMap }) -> Promise<Heranca>`: a `combinada` com os herdados do sync juntados (`origens[p] = { origem, foto }`, sem `alcance`) e o campo `sync: HerancaSync`; qualquer falha ou zero herdados devolve `combinada` intacta.
  - `fecharSync(heranca, arquivos) -> Heranca` (PURA): `sync.herdados` vira a interseção com `heranca.unchanged` final, `sync.aLer` o resto do diff; sem herdado sobrando, o campo `sync` sai.
  - `preparedPatchScope(engine, pr, id, prepared, herdados = [])`: o `.source.json` continua com todos os arquivos; só a materialização (`materializarNaSessao`) fica sem os herdados.
  - `session.herancaDoSync: string[]` (os herdados finais), gravado em `prepareReviewReading` ao lado de `session.fileBlobs`.
  - `splitByProof`: arquivo cuja origem na prova tem `origem` (do sync) não herda pela prova; vai a `changed`.

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-por-heranca-leitura.test.js`, no padrão de `test/analysis-source-flows.test.js` (`sourceRuntime.prepareSources` e `buildMap` stubados, `io.run = stubDoSync(cenario)`, `e.tokenFor = () => 'token'`):

```js
test('sync com herdados: a terceira fonte entra com a origem e a foto', async () => {
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.deepEqual(r.inheritance.unchanged.sort(), ['docs/x.md', 'src/b.ts']);
  assert.deepEqual(r.inheritance.changed, ['src/a.ts']);
  assert.deepEqual(r.inheritance.origens['src/b.ts'], { origem: 'homologation', foto: FOTO });
  assert.deepEqual(r.inheritance.sync.aLer, ['src/a.ts']);
  assert.ok(cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${P1}`)), 'a régua é o primeiro pai');
  assert.ok(!cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${BASE_PONTA}`)), 'nunca a ponta atual da base');
});
test('o escopo materializado só tem os arquivos a ler, e a sessão guarda os herdados', async () => {
  const r = await prepareReviewReading(e, pr, id, HEAD);
  const s = e.activeReviews.get(id);
  assert.equal(s.totalArquivos, 1);
  assert.deepEqual(s.herancaDoSync.sort(), ['docs/x.md', 'src/b.ts']);
  assert.equal(fs.existsSync(path.join(r.scope.root, 'src/b.ts')), false);
});
test('metricsIncrementais conta só os arquivos a ler', async () => {
  const heranca = (await prepareReviewReading(e, pr, id, HEAD)).inheritance;
  const m = metricsIncrementais({ lines: 30, changedFiles: 3, files: [{ path: 'src/a.ts', lines: 10 }, { path: 'src/b.ts', lines: 10 }, { path: 'docs/x.md', lines: 10 }] }, heranca);
  assert.deepEqual([m.changedFiles, m.lines], [1, 10]);
});
test('medição que falha: a herança de hoje, sem sync e sem mapa a mais', async () => {
  cenario.falhas = ['graphql'];
  const r = await prepareReviewReading(e, pr, id, HEAD);
  assert.equal(r.inheritance.sync, undefined);
  assert.equal(chamadasDoMapa, 0);
});
test('relançamento no mesmo head fora da complementar: sem sync', async () => { /* prova do PR com head HEAD */ assert.equal((await prepareReviewReading(...)).inheritance.sync, undefined); });
test('modo assist com mapa incompleto: os herdados voltam e o sync sai', async () => {
  e.config.reviewContextMode = 'assist'; /* buildMap devolve complete: false */
  assert.equal((await prepareReviewReading(e, pr, id, HEAD)).inheritance.sync, undefined);
});
test('prova com origem do sync não herda pela prova do PR', () => {
  const prova = { head: 'f'.repeat(40), files: [arquivo('src/b.ts')], reviewed: ['src/b.ts'], origens: { 'src/b.ts': { origem: 'homologation', foto: FOTO } } };
  assert.deepEqual(splitByProof([arquivo('src/b.ts')], prova).changed, ['src/b.ts']);
});
```

  O cenário: base `development`, head `sync/...`, merge com `P1` e `FOTO`; `src/a.ts` em `compare/${FOTO}...${HEAD}`, nada em `compare/${FOTO}...${P1}`; `buildMap` devolve `head` com `src/a.ts` e `src/b.ts` parseados e sem relação.
- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-por-heranca-leitura.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar.** `herdarDoSync`: com `arquivos` não vazio, `lerProcedenciaDoSync(engine, pr, head)`, `compararComAFoto` com a foto e a `baseDaResolucao` dela, `arquivosComBloqueioAberto` (null encerra), o mapa (`prepared.map?.head`, senão `(await buildMap(prepared.source, { limits: engine.config?.reviewContextLimits })).head` com a fonte completa, senão null; exceção no mapa dá null), `separarHerdados`; junta com `juntarHerancas(combinada, { unchanged: herdados fora de combinada.unchanged, alcance: {}, origens }, arquivos)`. O `buildMap` só roda depois de achar a procedência (o `test/analysis-source.test.js` prova que o modo `off` não chama o parser num PR comum). Em `prepareReviewReading`, a linha da herança vira, na ordem: `combinada` (como hoje), `comSync = mesmoHead && !complementar ? combinada : await herdarDoSync(engine, pr, head, files, combinada, { prepared, buildMap: sourceRuntime.buildMap })`, e `inheritance = fecharSync(revalidarAusenciaHerdada(inheritanceForContext(comSync, prepared), contextoAlcance, files), files)`. `splitByProof`: `herdavel` exige também `!deOutroPr[f.path]?.origem`.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-por-heranca-leitura.test.js`, `test/analysis-source.test.js`, `test/analysis-source-flows.test.js`, `test/file-proof.test.js` e `test/fanout.test.js`. Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/sync-por-heranca.js lib/engine/analysis-source.js lib/engine/file-proof.js test/sync-por-heranca-leitura.test.js
git commit -m "feat(sync): a herança do sync entra na leitura como terceira fonte, antes da sessão"
```

---

### Tarefa 5: o bloco de prova, a cobertura e o alcance

**Files:**
- Modify: `lib/engine/file-proof.js` (`fileProofBlock`, `prepararCoberturaParaOGate`, `registrarHerancaDoSync` novo, `origensDaProva`, `origensGuardadas`)
- Modify: `lib/engine/alcance.js` (`alvosDoAlcance`)
- Test: `test/sync-por-heranca-cobertura.test.js`

**Interfaces:**
- Consumes: `Heranca` com `sync: HerancaSync` (Tarefa 4).
- Produces:
  - `registrarHerancaDoSync(result, heranca) -> void` (exportada), chamada dentro de `prepararCoberturaParaOGate` depois do `diffMedido`: apaga `result.herancaDoSync` que vier do modelo; com `heranca.ativa && heranca.sync` e `result.coverage` objeto (envelope sem cobertura continua lacuna), põe cada herdado em `coverage.reviewed` e em `coverage.inherited` (mesmo o que a sessão declarou lido) e grava `result.herancaDoSync = { origem, destino, foto, commits, herdados: string[], lidos: number, contextoAlterado: string[] }`, com `lidos = diffMedido.length - herdados.length`.
  - `origensDaProva(result)` grava também `{ origem, foto }` dos herdados do sync; `origensGuardadas` aceita `{ pr, head }` ou `{ origem, foto }` (strings não vazias).
  - `alvosDoAlcance(result)` tira os `result.herancaDoSync.herdados`.
  - `fileProofBlock(heranca, headAnterior)`: terceiro grupo para `origens[p].origem`, e os herdados do sync fora da lista "SEM alcance conferido".

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-por-heranca-cobertura.test.js` (puro, com `FAROL_HOME` temporário para a prova gravada):

```js
const sync = { origem: 'homologation', destino: 'development', foto: FOTO, baseDaResolucao: P1, commits: 4, herdados: ['src/b.ts', 'docs/x.md'], aLer: ['src/a.ts'], contextoAlterado: ['src/a.ts'] };
const heranca = { ativa: true, unchanged: ['src/b.ts', 'docs/x.md'], changed: ['src/a.ts'], alcance: {},
  origens: { 'src/b.ts': { origem: 'homologation', foto: FOTO }, 'docs/x.md': { origem: 'homologation', foto: FOTO } }, sync };

test('bloco de prova com a variante do sync e só os a ler como alterados', () => {
  const b = fileProofBlock(heranca, '');
  assert.match(b, /idêntico à ponta da homologation \(commit 158c3d8\), já revisado nos PRs de origem/);
  assert.match(b, /ALTERADOS desde a leitura anterior \(1\):\n- src\/a\.ts/);
  assert.doesNotMatch(b, /SEM alcance conferido[\s\S]*src\/b\.ts/);
});
test('herdado declarado como lido fica em coverage.inherited e fora do índice', () => {
  const result = { coverage: { total: 3, reviewed: ['src/a.ts', 'src/b.ts'], missing: [] }, analysisStatus: 'complete' };
  prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.deepEqual(result.coverage.inherited.sort(), ['docs/x.md', 'src/b.ts']);
  assert.deepEqual(result.herancaDoSync.herdados.sort(), ['docs/x.md', 'src/b.ts']);
  assert.equal(result.herancaDoSync.lidos, 1);
  assert.equal(registrarNoIndiceDoRepositorio(pr, HEAD, arquivos, result, {}), 1, 'só o lido entra no índice');
});
test('marca de herança do sync escrita pelo modelo é descartada', () => {
  const result = { coverage: { total: 1, reviewed: ['src/a.ts'], missing: [] }, herancaDoSync: { herdados: ['src/a.ts'] }, sincronizacao: { origem: 'x' } };
  prepararCoberturaParaOGate(result, [arquivo('src/a.ts')], { ativa: false, unchanged: [], changed: ['src/a.ts'] });
  assert.equal(result.herancaDoSync, undefined);
});
test('cobertura sem lacuna com só os lidos declarados, e alcance só dos a ler', () => {
  const result = { coverage: { total: 3, reviewed: ['src/a.ts'], missing: ['src/b.ts', 'docs/x.md'] },
    alcance: [{ alterado: 'src/a.ts', chamadores: [], semChamador: 'sem uso fora do diff nesta fixture' }] };
  prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.deepEqual(coverageGap(result), []);
});
test('a origem do sync sobrevive na prova gravada', () => {
  salvarProvaDaSessao(pr, HEAD, arquivos, resultComHeranca, null);
  assert.deepEqual(readFileProof(pr.key).origens['src/b.ts'], { origem: 'homologation', foto: FOTO });
});
```

  `arquivos`: `src/a.ts`, `src/b.ts` (código) e `docs/x.md`, com blob e patch completos (`patchStatus: 'available'`).
- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-por-heranca-cobertura.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar** as mudanças das Interfaces. Texto fixo do terceiro grupo de `fileProofBlock` (abertura e cabeçalho da lista):

```
Os arquivos marcados com a origem do sync são idênticos à ponta da <origem> (commit <sha7>), e a base não tinha mudança própria neles: o app já os conta como cobertos. Não precisam ser lidos, não são cobrados e não entram em coverage.reviewed; abra um deles só se precisar para entender um arquivo a ler.
Arquivos herdados do sync (<n>):
- <caminho> (idêntico à ponta da <origem> (commit <sha7>), já revisado nos PRs de origem)
```

- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-por-heranca-cobertura.test.js`, `test/file-proof.test.js`, `test/heranca-de-alcance.test.js` e o teste do índice entre PRs (`grep -l registrarNoIndiceDoRepositorio test/*.test.js`). Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/file-proof.js lib/engine/alcance.js test/sync-por-heranca-cobertura.test.js
git commit -m "feat(sync): herdados do sync cobertos pelo motor no prompt, na cobertura e no alcance"
```

---

### Tarefa 6: a marca de sincronização e o registro da decisão

**Files:**
- Create: `lib/engine/registro-do-sync.js`
- Modify: `lib/engine/estado-desmentido.js` (`checksEEstadoDoPr`)
- Modify: `lib/engine/decision.js` (`recordDecision`, sem linha útil a mais)
- Modify: `lib/engine/public-review.js` (`decisionForUi` projeta `herancaSync`)
- Test: `test/sync-por-heranca-registro.test.js`

**Interfaces:**
- Consumes: `result.herancaDoSync` (Tarefa 5).
- Produces (em `registro-do-sync.js`):
  - `CAMINHO_SYNC = 'sync_por_heranca'`, `CAMINHO_SYNC_SEM_SESSAO = 'sync_por_heranca_sem_sessao'`.
  - `sincronizacaoDoSync(result) -> { origem, destino, commits, heranca: { foto, herdados: number, lidos: number } } | null`.
  - `extraDoSync(engine, pr, result, extra) -> { caminho: CAMINHO_SYNC, herancaSync: { origem, foto, herdados: number, lidos: number } } | {}`: vazio sem `result.herancaDoSync` ou com `extra.caminho` já dado; senão grava uma linha INFO e devolve o extra.

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-por-heranca-registro.test.js` (`Engine` com `FAROL_HOME` temporário e `io.run` stubado como em `test/pr-de-sincronizacao.test.js`):

```js
test('com a herança do sync, a marca sincronizacao vem da medição e a consulta de depois não roda', async () => {
  const result = { verdict: 'approve', findings: [], herancaDoSync: { origem: 'homologation', destino: 'development', foto: FOTO, commits: 4, herdados: ['src/b.ts'], lidos: 1, contextoAlterado: [] } };
  await checksEEstadoDoPr(e, pr, result, gateReason);
  assert.deepEqual(result.sincronizacao, { origem: 'homologation', destino: 'development', commits: 4, heranca: { foto: FOTO, herdados: 1, lidos: 1 } });
  assert.equal(chamadas.filter((c) => c.includes('associatedPullRequests')).length, 0);
  assert.deepEqual(attentionPoints(e, { ...result, decision: 'auto_approve', reasons: [] }), []);
});
test('sem a herança, a consulta de hoje continua decidindo', async () => { /* result sem herancaDoSync */ assert.ok(chamadas.some((c) => c.includes('associatedPullRequests'))); });
test('a decisão leva o caminho e as contagens, projetados para a tela, com uma linha INFO', () => {
  const d = e.recordDecision(pr, { ...resultAprovado, herancaDoSync }, { status: 'auto_approved', action: 'approve' });
  assert.equal(d.caminho, 'sync_por_heranca');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 1, lidos: 1 });
  assert.equal(e.logs.filter((l) => l.startsWith('INFO') && l.includes('caminho sync_por_heranca')).length, 1);
});
test('extra com caminho já dado vence e não loga', () => {
  const d = e.recordDecision(pr, { ...resultAprovado, herancaDoSync }, { status: 'auto_approved', action: 'approve', caminho: 'sync_por_heranca_sem_sessao' });
  assert.equal(d.caminho, 'sync_por_heranca_sem_sessao');
  assert.equal(e.logs.filter((l) => l.includes('caminho sync_por_heranca')).length, 0);
});
```

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-por-heranca-registro.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar.** `checksEEstadoDoPr`: `result.sincronizacao = sincronizacaoDoSync(result) || await lerSincronizacao(engine, pr);`. Em `recordDecision`, a linha `...extra,` vira `...extraDoSync(engine, pr, result, extra), ...extra,`; o import novo é compensado juntando `payloads: result.payloads || {},` e `memory: result.memory || null,` numa linha só. Em `decisionForUi`, `'herancaSync'` entra na linha de `'caminho'`. Linha INFO: `${pr.key}: sync da ${origem} (foto ${sha7}): ${herdados} arquivo(s) herdados sem leitura, ${lidos} lido(s); desfecho ${extra.status} (caminho sync_por_heranca).`
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-por-heranca-registro.test.js`, `test/pr-de-sincronizacao.test.js` e os testes de `decisionForUi` (`grep -l decisionForUi test/*.test.js`); conferir `npm run lint` no WSL (nenhuma contagem sobe). Esperado: PASS e lint verde.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/registro-do-sync.js lib/engine/estado-desmentido.js lib/engine/decision.js lib/engine/public-review.js test/sync-por-heranca-registro.test.js
git commit -m "feat(sync): a marca de sincronização reaproveita a medição e a decisão registra o caminho"
```

---

### Tarefa 7: achado em arquivo herdado (avaliação técnica e sessão)

**Files:**
- Modify: `lib/technical-review/divida-fora-das-linhas.js` (`classificarPorLinhas`, `pontoDaDivida`)
- Modify: `lib/technical-review/runtime.js` (`relatorioTecnico`, `finishTechnicalReview` recebem `herdadosDoSync`)
- Modify: `lib/engine/recuperacao-resultado.js` (passa `engine.activeReviews.get(id)?.herancaDoSync || []`)
- Modify: `lib/engine/heranca-de-producao.js` (`aplicarHerancaDoSync`, chamada no começo de `aplicarHerancaDeProducao`)
- Test: `test/divida-herdada-do-sync.test.js`

**Interfaces:**
- Consumes: `session.herancaDoSync` (Tarefa 4), `result.herancaDoSync` (Tarefa 5), `rebaixarHeranca` de hoje.
- Produces:
  - `classificarPorLinhas(resultado, inventario, head, herdadosDoSync: string[] = [])`: achado com `file` em `herdadosDoSync` ganha `{ foraDasLinhas: true, herdadoDaOrigem: true }`, com linha ou sem, mesmo sem mapa de trechos; a regra com todos os achados marcados ganha `dividaForaDasLinhas`; `resumo` ganha `herdadosDaOrigem: number`. `VERSAO_DAS_LINHAS` continua 2.
  - `relatorioTecnico(context, result, { ..., herdadosDoSync })` e `finishTechnicalReview(context, a, c, { ..., herdadosDoSync })` repassam.
  - `aplicarHerancaDoSync(result, gateReason) -> number`: com `result.herancaDoSync`, rebaixa o achado bloqueante marcado `herdadoDaOrigem === true` ou `herdadoDaProducao === true`, com causa `defeito_codigo` ou `card` e evidência, só se o arquivo estiver em `herdados`, pela `rebaixarHeranca(result, herdados, contextoAlterado)`; `aplicarHerancaDeProducao` usa esse caminho e não lê a production quando há `result.herancaDoSync`. Sem a marca do motor, `herdadoDaOrigem` não rebaixa nada.

- [ ] **Passo 1: escrever o teste que falha** em `test/divida-herdada-do-sync.test.js`, com as fixtures de `test/divida-fora-das-linhas.test.js` (`supressor`, `relatorio`, `inventario`):

```js
test('achado mecânico em arquivo herdado do sync vira dívida, com linha ou sem', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(HERDADO, 10), { rule: SUPRESSAO, file: HERDADO, message: 'sem linha' }] }, INVENTARIO, HEAD, [HERDADO]);
  assert.ok(r.findings.every((f) => f.foraDasLinhas === true && f.herdadoDaOrigem === true));
  assert.equal(r.rules[0].dividaForaDasLinhas, true);
  assert.equal(r.resumo.herdadosDaOrigem, 2);
});
test('achado em arquivo a ler segue bloqueando', () => {
  const r = classificarPorLinhas({ rules: [{ rule: SUPRESSAO, verdict: 'fail' }], findings: [supressor(TELA, 11)] }, INVENTARIO, HEAD, [HERDADO]);
  assert.equal(r.rules[0].dividaForaDasLinhas, undefined);
  assert.equal(technicalGap(relatorioTecnico(ctx, { ...base, rules: r.rules, findings: r.findings }, { inventario: INVENTARIO, herdadosDoSync: [HERDADO] })), LACUNA_DE_VIOLACAO);
});
test('o ponto da dívida diz que veio da origem', () => {
  assert.match(pontoDaDivida({ foraDasLinhas: { achados: 2, herdadosDaOrigem: 2, amostra: [] } }), /herdado\(s\) da origem do sync/);
});
test('achado da sessão herdadoDaOrigem em arquivo da lista do motor vira sugestão', () => {
  const result = { verdict: 'request_changes', findings: [achado(HERDADO, { herdadoDaOrigem: true })], herancaDoSync: { herdados: [HERDADO], contextoAlterado: [TELA] }, payloads: { approve: { event: 'APPROVE', body: 'ok' } } };
  assert.equal(aplicarHerancaDoSync(result, gateReason), 1);
  assert.equal(result.findings[0].severity, 'suggestion');
});
test('fora da lista, sem a marca do motor ou com evidência no contexto alterado: segue bloqueando', () => {
  /* três resultados: arquivo TELA; sem herancaDoSync; evidence citando TELA */
  for (const r of casos) { assert.equal(aplicarHerancaDoSync(r, gateReason), 0); assert.equal(r.findings[0].severity, 'blocking'); }
});
```

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/divida-herdada-do-sync.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar** conforme as Interfaces. Em `classificarPorLinhas` a marcação dos herdados vem antes do retorno antecipado de mapa vazio. `pontoDaDivida` acrescenta `; ${n} achado(s) herdado(s) da origem do sync` ao texto de hoje quando `herdadosDaOrigem > 0`. `conferirResultado` (em `recuperacao-resultado.js`) recebe o parâmetro novo `herdadosDoSync` de `recuperarResultado`, que já tem `engine` e `id`.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/divida-herdada-do-sync.test.js`, `test/divida-fora-das-linhas.test.js`, `test/divida-fora-das-linhas-desfecho.test.js`, `test/divida-da-sessao.test.js` e `test/heranca-de-producao.test.js`. Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add lib/technical-review/divida-fora-das-linhas.js lib/technical-review/runtime.js lib/engine/recuperacao-resultado.js lib/engine/heranca-de-producao.js test/divida-herdada-do-sync.test.js
git commit -m "feat(sync): achado em arquivo herdado da origem vira dívida, conferido pela lista do motor"
```

---

### Tarefa 8: o fluxo de aprovação sem sessão, extraído do diff vazio

**Files:**
- Create: `lib/engine/aprovacao-sem-sessao.js`
- Modify: `lib/engine/diff-vazio-de-linhagem.js` (`impedimento`, `aprovar`, `falhou`, `reenvio`, `resultadoBase` passam a usar o módulo novo)
- Test: `test/aprovacao-sem-sessao.test.js`; `test/diff-vazio-de-linhagem.test.js` roda sem mudança

**Interfaces:**
- Consumes: o que `diff-vazio-de-linhagem.js` importa hoje para aprovar (`semMesa`, `postarComRetentativas`, `anexarChecksObrigatorios`, `avisoDaAprovacao`, `decisaoAutomaticaJaPublicada`, `iniciarPublicacao`, `classify`).
- Produces:
  - `Desfecho = { headSha, baseSha, inventarioDiff, extra: object, corpo: string, relatorio: string, prova: object, toast: string }`; `prova` é espalhada na entrada de `technicalApprovals` (ex.: `{ diffVazio: { head, origem } }`).
  - `resultadoSemSessao(desfecho, verdict, payloads, reportMarkdown) -> result`.
  - `impedimentoSemSessao(engine, pr, desfecho) -> Promise<item|null>`.
  - `aprovarSemSessao(engine, pr, desfecho, id) -> Promise<item>`.
  - `falhouSemSessao(engine, pr, result, desfecho, evento: 'approve'|'comment', post) -> item`.

- [ ] **Passo 1: escrever o teste que falha** em `test/aprovacao-sem-sessao.test.js` (mesmo stub do `gh` de `test/diff-vazio-de-linhagem.test.js`):

```js
test('aprova com o desfecho dado: corpo, extra e a prova na memória', async () => {
  const d = { headSha: HEAD, baseSha: BASE, inventarioDiff: inv, extra: { caminho: 'teste' }, corpo: 'Corpo fixo. Aprovo.', relatorio: 'r', prova: { marca: { head: HEAD } }, toast: 't' };
  const item = await aprovarSemSessao(e, pr, d, 'a1');
  assert.deepEqual(envios.map((p) => [p.event, p.body, p.commit_id]), [['APPROVE', 'Corpo fixo. Aprovo.', HEAD]]);
  assert.equal(item.caminho, 'teste');
  assert.equal(item.status, 'auto_approved');
});
test('falha passageira vai ao reenvio com o aviso da aprovação; permanente larga a prova', async () => { /* gh.postFalha 'HTTP 502' e 'HTTP 422' */ });
```

- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/aprovacao-sem-sessao.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar** movendo o corpo de hoje para o módulo novo, parametrizado por `Desfecho`; `diff-vazio-de-linhagem.js` monta o `Desfecho` dele (`extraDoCaminho(m)`, `textoDaAprovacao(m)`, a prova `diffVazio`, o toast de hoje) e mantém `comentar`, que usa `falhouSemSessao`.
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/aprovacao-sem-sessao.test.js` e `test/diff-vazio-de-linhagem.test.js`. Esperado: PASS, o segundo sem nenhuma linha alterada.
- [ ] **Passo 5: commit**

```bash
git add lib/engine/aprovacao-sem-sessao.js lib/engine/diff-vazio-de-linhagem.js test/aprovacao-sem-sessao.test.js
git commit -m "refactor(diff-vazio): extrai o fluxo de aprovação sem sessão para reuso"
```

---

### Tarefa 9: o sync sem nenhum arquivo a ler, decidido sem sessão

**Files:**
- Create: `lib/engine/sync-sem-sessao.js`
- Modify: `lib/technical-review/publication.js` (`ORIGEM_SYNC_POR_HERANCA` e a prova do motor)
- Modify: `lib/engine/review.js` (import da linha 54 e chamada da linha 780, troca linha por linha)
- Test: `test/sync-sem-sessao.test.js`

**Interfaces:**
- Consumes: `Heranca.sync` (Tarefa 4), `aprovarSemSessao`, `impedimentoSemSessao` (Tarefa 8), `CAMINHO_SYNC_SEM_SESSAO` (Tarefa 6), `technicalRuntime.prepareTechnicalReview` e `technicalRuntime.cleanup`, `origemDoDono`, `ehMeu`, `diffVazio.decidirSemSessao`.
- Produces:
  - `textoDaAprovacao(sync, n) -> string`.
  - `candidato(heranca, arquivos) -> boolean`: `heranca.sync` presente, `heranca.changed` vazio e todo caminho do diff em `sync.herdados`.
  - `tecnicaSoNosHerdados(contexto, herdados) -> boolean`: `contexto.semDeclaracao === true`, ou sem `error` e todo achado de `contexto.initial.findings` com `file` em `herdados`.
  - `decidirSyncSemSessao(engine, ctx) -> Promise<boolean>` e o despachante `decidirSemSessao(engine, ctx) -> Promise<boolean>` (diff vazio primeiro, depois o sync). `ctx = { pr, id, headShaAtual, inventario, heranca, fontes }`.
  - Em `publication.js`: `ORIGEM_SYNC_POR_HERANCA: symbol`; `approvalRefusal` aceita o APPROVE com `proof.report === null`, `proof.syncPorHeranca.origem === ORIGEM_SYNC_POR_HERANCA` e `proof.syncPorHeranca.head === payload.commit_id`, além da prova do diff vazio de hoje.

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-sem-sessao.test.js`, no padrão de `test/diff-vazio-de-linhagem.test.js` (motor com sessão contada em `e.sessoes`), com `io.run` composto de `stubDoSync` e das leituras de postagem, `sourceRuntime` stubado com três arquivos todos idênticos à foto:

```js
test('todos herdados: APPROVE de texto fixo, sem sessão, com a prova do motor', async () => {
  const e = await revisar(1);
  assert.equal(e.sessoes, 0);
  assert.deepEqual(envios.map((p) => p.event), ['APPROVE']);
  assert.equal(envios[0].body, 'Este PR só leva para a base o que já foi revisado na origem: os 3 arquivos do diff são idênticos à ponta da `homologation` (commit `158c3d8`), e a base não tinha mudança própria neles. Aprovo.');
  const d = decisao(e, 1);
  assert.equal(d.caminho, 'sync_por_heranca_sem_sessao');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 3, lidos: 0 });
  assert.ok(e.logs.some((l) => l.startsWith('INFO') && l.includes('caminho sync_por_heranca_sem_sessao')));
});
test('a publicação aceita só a prova com a marca do motor', async () => {
  assert.equal(await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: HEAD }), null);
  e.technicalApprovals.set(pr.key, JSON.parse(JSON.stringify(e.technicalApprovals.get(pr.key))));
  assert.equal((await approvalRefusal(e, pr, { event: 'APPROVE', commit_id: HEAD })).blocked, 'technical_review');
});
test('um arquivo a ler: a sessão abre', async () => { /* um arquivo em compare FOTO...HEAD */ assert.equal((await revisar(2, ajuste)).sessoes, 1); });
// cada caso: a sessão abre (1) e nenhuma decisão sai com o caminho sem sessão
for (const [nome, ajuste, prDoCaso] of [
  ['memória de rodadas em enforce', (e) => { e.config.reviewRoundsMode = 'enforce'; }, PR(10)],
  ['origem desconhecida', null, { ...PR(11), requested: false }],
  ['política que não aprova sozinha', (e) => { e.approvePolicyFor = () => 'request_changes'; }, PR(12)],
  ['avaliação técnica que falha: a sessão abre', () => { technicalRuntime.prepareTechnicalReview = async () => ({ error: 'falhou', failure: 'tool' }); }, PR(13)],
  ['achado técnico fora dos herdados: a sessão abre', () => { technicalRuntime.prepareTechnicalReview = async () => ({ initial: { findings: [{ rule: 'r', file: 'outro.ts' }] } }); }, PR(14)],
]) test(nome, async () => {
  const e = motor(); if (ajuste) ajuste(e);
  await e.runHeadlessReview(prDoCaso);
  assert.equal(e.sessoes, 1);
  assert.notEqual(decisao(e, prDoCaso.number)?.caminho, 'sync_por_heranca_sem_sessao');
});
test('PR da própria conta, gente no head e label de outra conta: encerra sem postar', async () => { /* três casos */ assert.equal(envios.length, 0); });
test('head que andou: pendente com stale_head', async () => { /* conferirAntesDoComentario devolve andou */ assert.equal(decisao(e, 20).blockedKind, 'stale_head'); });
test('já aprovado neste head: already_reviewed, sem postar', async () => { /* myReviewStates ['APPROVED'] */ assert.equal(decisao(e, 21).status, 'already_reviewed'); });
test('falha passageira ao postar: pendente com reenvio', async () => { /* postFalha 'HTTP 502' */ assert.equal(decisao(e, 22).postRetry.event, 'approve'); });
```

  O material técnico preparado no caminho sem sessão é liberado (`technicalRuntime.cleanup` chamado uma vez por revisão; o stub conta). O `technicalRuntime` original é restaurado num `afterEach`.
- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-sem-sessao.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar.** `decidirSyncSemSessao`, na ordem: `candidato`; `reviewRoundsMode !== 'enforce'`, `origemDoDono(pr)` e `approvePolicyFor(conta, true) === 'approve'`, senão false; `prepareTechnicalReview(engine, pr, headShaAtual, { sources: fontes, sessionId: id })` com `cleanup` no `finally`, e `tecnicaSoNosHerdados` falso devolve false; `conferirCancelamento`; `ehMeu` grava `STATUS_SEM_POSTAR` sem postar e devolve true; `impedimentoSemSessao`; `aprovarSemSessao` com o `Desfecho` (`extra: { caminho: CAMINHO_SYNC_SEM_SESSAO, herancaSync: { origem, foto, herdados: n, lidos: 0 } }`, `prova: { syncPorHeranca: { head, origem: ORIGEM_SYNC_POR_HERANCA } }`, `inventarioDiff` do inventário real, `corpo: textoDaAprovacao(sync, n)`); linha INFO `${pr.key}: sync da ${origem} (foto ${sha7}): ${n} arquivo(s) herdados, nenhum a ler; desfecho ${item.status} sem sessão (caminho sync_por_heranca_sem_sessao).` Texto fixo de `textoDaAprovacao`, singular e plural como no diff vazio:

```js
`Este PR só leva para a base o que já foi revisado na origem: os ${n} arquivos do diff são idênticos à ponta da \`${sync.origem}\` (commit \`${sha7}\`), e a base não tinha mudança própria neles. Aprovo.`
// n === 1: "o único arquivo do diff é idêntico"
```

  Em `review.js`: `import diffVazio from './diff-vazio-de-linhagem.js';` vira `import { decidirSemSessao } from './sync-sem-sessao.js';` e a linha 780 vira `if (await decidirSemSessao(engine, { pr, id, headShaAtual, inventario, heranca, fontes: reading.prepared.source })) return;` (o comentário da linha 779 passa a citar os dois caminhos, sem linha nova).
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-sem-sessao.test.js`, `test/diff-vazio-de-linhagem.test.js` e os testes de publicação técnica (`grep -l approvalRefusal test/*.test.js`); conferir `npm run lint` no WSL. Esperado: PASS e lint verde (o `maxLines` de `review.js` continua 412).
- [ ] **Passo 5: commit**

```bash
git add lib/engine/sync-sem-sessao.js lib/technical-review/publication.js lib/engine/review.js test/sync-sem-sessao.test.js
git commit -m "feat(sync): sync sem nenhum arquivo a ler aprovado sem sessão, pelos portões de sempre"
```

---

### Tarefa 10: o caso real, na forma do engine-ai#1489

**Files:**
- Create: `test/fixtures/sync-engine-ai-1489.js`
- Test: `test/sync-engine-ai-1489.test.js`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 9; `stubDoSync`, `FOTO`, `P1` (Tarefa 2).
- Produces: `casoEngineAi1489() -> { arquivos, diferemDaFoto, mexidosNaBase, mexidosDesdeAPonta, mapa, cenario, BASE_PONTA }`:
  - 65 arquivos no diff; 8 em `diferemDaFoto` (`prisma/schema.prisma`, `common/zone-ownership/mapa-de-zonas.ts`, `apps/engine-ai/src/mia-whatsapp/whatsapp-chat.service.ts` e mais cinco sintéticos);
  - `mexidosNaBase` (contra o primeiro pai `P1`): 2 dos 57 idênticos mais `apps/engine-ai/src/turno/quadros-do-turno.ts`, que a development apagou e não está no diff;
  - `mexidosDesdeAPonta`: 33 dos 57 idênticos (contra a ponta atual da development);
  - `mapa`: todo `.ts` do diff parseado limpo, com `apps/engine-ai/src/zonas/zona.guard.ts -> common/zone-ownership/mapa-de-zonas.ts` em `relations` e `./quadros-do-turno` sem destino em `unresolved` a partir de `apps/engine-ai/src/turno/painel-do-turno.ts` (os dois entre os 55 herdados da primeira forma);
  - `cenario`: base `development` (ponta `BASE_PONTA`), head `sync/homologation-into-development-20261124`, commits da homologation com PR mesclado e o merge com `P1` e `FOTO`.

- [ ] **Passo 1: escrever o teste que falha** em `test/sync-engine-ai-1489.test.js`:

```js
test('contra a base no momento do merge: 55 herdados e 10 a ler, antes da dependência', () => {
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados: new Set(), mapa: semRelacoes(mapa) });
  assert.deepEqual([r.herdados.length, r.aLer.length], [55, 10]);
});
test('contra a ponta atual da development seriam 24 e 41', () => {
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase: mexidosDesdeAPonta, bloqueados: new Set(), mapa: semRelacoes(mapa) });
  assert.deepEqual([r.herdados.length, r.aLer.length], [24, 41]);
});
test('com a regra de dependência por cima: 53 herdados e 12 a ler', () => {
  const r = separarHerdados({ arquivos, diferemDaFoto, mexidosNaBase, bloqueados: new Set(), mapa });
  assert.deepEqual([r.herdados.length, r.aLer.length], [53, 12]);
  assert.ok(r.aLer.includes('apps/engine-ai/src/zonas/zona.guard.ts') && r.aLer.includes('apps/engine-ai/src/turno/painel-do-turno.ts'));
});
test('a revisão inteira: a sessão lê 12, o motor cobre 53, aprovação limpa com o caminho do sync', async () => {
  const e = await revisar();
  assert.match(e.prompts[0], /ALTERADOS desde a leitura anterior \(12\)/);
  assert.match(e.prompts[0], /Arquivos herdados do sync \(53\)/);
  const d = decisao(e);
  assert.equal(d.status, 'auto_approved');
  assert.equal(d.caminho, 'sync_por_heranca');
  assert.deepEqual(e.decisionForUi(d).herancaSync, { origem: 'homologation', foto: FOTO, herdados: 53, lidos: 12 });
  assert.equal(d.inventarioDiff.files.length, 65);
  assert.ok(cenario.chamadas.some((c) => c.includes(`compare/${FOTO}...${P1}`)));
});
test('com defeito num arquivo lido: a reprovação de sempre', async () => {
  const e = await revisar({ sessao: 'request_changes', achado: 'prisma/schema.prisma' });
  assert.equal(decisao(e).status, 'auto_rejected');
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES']);
});
```

  A sessão stubada (`e.runClaudeStream`) guarda o prompt em `e.prompts` e devolve envelope com `coverage.reviewed` só dos 12 e `alcance` dos `.ts` entre eles.
- [ ] **Passo 2: rodar e ver falhar.** Rodar `test/sync-engine-ai-1489.test.js`. Esperado: FAIL até a fixture existir; com ela, qualquer falha aqui é defeito das tarefas anteriores, corrigido na tarefa dona e não no teste.
- [ ] **Passo 3: implementar** só a fixture `test/fixtures/sync-engine-ai-1489.js` (nomes sintéticos determinísticos para os arquivos sem nome real, blob e patch completos em todos).
- [ ] **Passo 4: rodar e ver passar.** Rodar `test/sync-engine-ai-1489.test.js`. Esperado: PASS.
- [ ] **Passo 5: commit**

```bash
git add test/fixtures/sync-engine-ai-1489.js test/sync-engine-ai-1489.test.js
git commit -m "test(sync): trava o caso do engine-ai#1489, contra a base do merge e com a dependência"
```

---

### Tarefa 11: documentação e protocolo da sessão

**Files:**
- Modify: `CLAUDE.md` (invariante 4: parágrafo "Sync por herança" depois do "Diff vazio que só alinha a história"; mapa de `lib/engine/`: os módulos novos nas linhas "Gate e postagem" e "Prova e cobertura")
- Modify: `docs/REVIEW-GATES.md` (seção nova `## Sync por herança` logo depois de `## PR de sincronização`, e a linha no índice gerado)
- Modify: `workspace-template/CLAUDE.md` (item 3bis: o sync com herança conferida pelo motor)
- Modify: `workspace-template/prompts/pr-review-auto.md` (regra do sync de linhagem, exceção da `coverage` e a marca `herdadoDaOrigem`)
- Test: `test/guias-navegaveis.test.js` (sem mudança)

**Interfaces:**
- Consumes: os nomes finais das Tarefas 1 a 9.
- Produces: nenhum código.

- [ ] **Passo 1: o teste que trava a documentação já existe.** Escrever primeiro a linha do índice de `docs/REVIEW-GATES.md` (`- [Sync por herança](#sync-por-herança)`) sem a seção, e rodar `test/guias-navegaveis.test.js`. Esperado: FAIL (índice diverge das seções).
- [ ] **Passo 2: escrever o conteúdo.** No `CLAUDE.md` e no guia: o critério da procedência (head contínuo ou head de trabalho com o merge da origem, a foto, a régua no primeiro pai), as quatro condições do herdado, o que a sessão recebe, a decisão sem sessão e as condições que encerram sem postar, a dívida herdada da origem, o registro (`caminho`, `herancaSync`, a linha INFO) e os testes que travam (`test/procedencia-do-sync.test.js`, `test/sync-por-heranca-*.test.js`, `test/sync-sem-sessao.test.js`, `test/sync-engine-ai-1489.test.js`). No protocolo (`workspace-template/CLAUDE.md` 3bis e `prompts/pr-review-auto.md`): quando o prompt traz "Arquivos herdados do sync", o `reviewed` é só o que a sessão leu; os herdados já estão cobertos pelo motor e não se declaram lidos; o alcance é só dos arquivos a ler; aprovar quando os lidos não têm defeito; "não aprove o que não leu" vale para os a ler; achado num herdado que já existia igual na origem leva `"herdadoDaOrigem": true` com a evidência, e o motor só rebaixa se o arquivo estiver na lista dele. A exceção da `coverage` do sync de linhagem (declarar todos como revisados) passa a valer só quando o prompt não traz a herança do sync.
- [ ] **Passo 3: rodar e ver passar.** Rodar `test/guias-navegaveis.test.js` e o teste do protocolo regravado no boot (`grep -l "pr-review-auto" test/*.test.js`). Esperado: PASS.
- [ ] **Passo 4: suíte e gate.** No WSL, `FAROL_TEST_CONCORRENCIA=4 npm test` (as falhas só de `git` nesta worktree são de ambiente; listar quais) e, num clone nativo da branch, `npm run check && npm run lint && npm test`. Conferir que nenhum teste de gate mudou: `git diff --stat origin/main -- test/postagem-*.test.js test/credencial-no-texto.test.js test/public-review-language.test.js test/pr-proprio.test.js test/espera-regras-e-pr-proprio.test.js test/instancia-isolada.test.js test/diff-vazio-de-linhagem.test.js test/heranca-de-producao.test.js` sem saída. Esperado: verde e diff vazio.
- [ ] **Passo 5: commit**

```bash
git add CLAUDE.md docs/REVIEW-GATES.md workspace-template/CLAUDE.md workspace-template/prompts/pr-review-auto.md
git commit -m "docs(sync): sync por herança no guia do mantenedor, nos gates e no protocolo da sessão"
```

---

## Decisões deste plano sobre pontos que o desenho deixou abertos

1. **Sentido do `compare` da ancestralidade.** O desenho diz "`compare <origem>...<foto>` com `behind_by` 0", que mede o contrário do que a frase seguinte pede ("a foto é ancestral da ponta da origem"). Vale a frase: `compare <foto>...<ponta>` com `behind_by` 0 e merge-base na foto (`ehAncestral`), a mesma régua de `heranca-de-producao.js`. O mesmo vale para o primeiro pai na linhagem da base.
2. **Merge commit anterior no head de trabalho.** Só o merge mais recente é o do sync; os outros commits, merge ou não, seguem a regra de hoje (PR mesclado em branch contínua). Um re-sync com dois merges próprios cai na revisão de hoje: conservador e raro.
3. **Dependência transitiva.** "Não importa nenhum arquivo a ler" é aplicado até o ponto fixo: o herdado que volta à leitura passa a ser arquivo a ler, e quem o importa volta também. É a leitura literal da decisão 2 e o lado seguro.
4. **O que é "dependência que não deu para conferir".** Código JS e TS precisa estar no mapa, parseado sem degradação; import relativo sem destino (o arquivo que a base apagou) devolve à leitura; pacote externo não. Código de outra linguagem (Python, Go, Vue...) volta sempre, porque o mapa não o lê. Arquivo de dado, esquema ou documento herda sem conferência de import. Exigir `map.complete` inteiro faria a regra nunca disparar (todo import de pacote externo vira limitação no mapa).
5. **Mapa no modo `off`.** O desenho manda usar o mapa de importação, que hoje só existe com `reviewContextMode` ligado. O sync o constrói só quando há procedência (local, sem modelo); PR comum não paga nada a mais.
6. **Arquivo removido.** "O que aparece só de um lado" foi lido como arquivo sem blob no head (`removed`): vai à leitura. Arquivo adicionado idêntico à foto herda.
7. **Escopo da sessão.** "Recebe só os arquivos a ler no escopo de leitura" vale para a materialização dos patches; o `.source.json` segue inteiro, para a sessão poder abrir um herdado pela consulta.
8. **Achado técnico sem linha em herdado.** Vira dívida também: o arquivo inteiro é idêntico ao revisado na origem e a base não mexeu nele. Achado sem arquivo continua bloqueando.
9. **Linha INFO.** Uma por decisão gravada nesse caminho, emitida no `recordDecision` (sessão) e no fim do caminho sem sessão; a medição em si não loga.
10. **Relançamento no mesmo head fora da rodada complementar e prova do próprio PR.** O sync não herda no relançamento que já hoje revisa cheio, e a herança do sync nunca passa pela prova do PR: cada rodada mede de novo.
11. **Achado da sessão herdado.** Marca nova `herdadoDaOrigem` (e a `herdadoDaProducao` de hoje), aceita só com `result.herancaDoSync`; a conferência de contexto alterado usa `mexidosNaBase` mais os arquivos a ler, sem nova leitura do GitHub.
