# Farol BIUD, fase 1: motor enxuto. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir o motor do `farol-biuder` ao ciclo de revisão autônoma de PR, rodando só em Linux como `node server.js`, com a suíte verde a cada lote.

**Architecture:** Corte por lotes no próprio fork. Cada lote remove um grupo de módulos, a fiação dele no núcleo (`server.js`, `lib/http-server.js`, `lib/engine/review.js`, `session.js`, `decision.js`) e os testes que só protegiam o que saiu. Regra de gate nunca é apagada. A `ui/` antiga continua servindo até a fase 4, só perdendo as telas do que sai.

**Tech Stack:** Node 24.22.1 (ESM, sem dependência npm de runtime), `node --test`, `gh` CLI, Claude Code CLI.

**Spec:** `docs/superpowers/specs/2026-11-12-farol-biuder-enxuto-design.md` (seções 6.1, 6.1.1 e 6.3). As fases 2 a 5 têm plano próprio.

## Global Constraints

- Rebase proibido em qualquer forma. A base entra na branch por `git merge --no-ff`. PR é mesclado com `gh pr merge --merge`.
- Nenhuma atribuição de IA em commit, PR ou comentário.
- Toda escrita no GitHub usa a conta `wandersonbiuder`, trocada no mesmo comando: `gh auth switch --user wandersonbiuder && gh ...`.
- PR abre pela skill `abrir-pr`, sem revisor; revisor só com os checks obrigatórios verdes.
- Um lote = uma branch curta saída da `main` (`corte/<NN>-<nome>`) = um PR. O check obrigatório chama-se `ci` e o nome não muda.
- Gate de cada lote, em Linux (WSL nesta máquina, Node 24.22.1): `npm run check && npm run lint && npm test`, com teto de 4 workers.
- Arquivos em LF. Texto e comentário em português, sem travessão.
- Nunca apagar nem afrouxar teste de gate (postagem, dedup por head, espera do CI, PR próprio como COMMENT, credencial no texto, linguagem pública, instância isolada). Teste que só protegia módulo removido é apagado; teste de contrato (inventário de rotas, superfície da `ui/pure`, guias, `data-goto`) é ajustado no mesmo commit, com o motivo na mensagem.
- Nada de código "desligado por configuração": o que sai é apagado.
- Ficam, mesmo parecendo candidatos: `lib/engine/pr-proprio.js`, `espera-pr-proprio.js`, `contas-config.js`, `provedores.js` (reduzido), `lib/local-auth/`, `tools/farol-parear.js`, `tools/jira-mcp.js`, `skip-review.js` e as labels `<conta>:revisando`.

## Review Focus

1. **`config.json` antigo com chaves do que saiu** (várias contas, perfis `dir`/`maquina`/Codex, `sync`, `cadeiaPerfis`): o boot não lança; a chave desconhecida é ignorada. Teste na Task 14.
2. **PR da própria conta revisora** continua saindo como COMMENT, nunca APPROVE nem REQUEST_CHANGES, depois do corte de Meus PRs. Teste na Task 11.
3. **`decisions.json` antigo** com campos de sync, chat ou autoanálise: `decisionForUi` e `resolveIntoHistory` leem sem lançar. Teste na Task 13.
4. **Postagem sem coordenação**: com o sync removido, dois ciclos seguidos no mesmo head postam uma vez só. Teste na Task 13.
5. **Boot em Linux com `~/.farol` vazio e uid comum**: o motor sobe, escuta, responde `GET /api/state` e não escreve fora do `HOME`. Teste na Task 16.

## Ritual de cada lote

Todo lote segue estes passos; as tasks só dizem o que muda neles.

1. `git switch main && git pull --ff-only && git switch -c corte/<NN>-<nome>`.
2. Apagar os arquivos listados em **Sai**.
3. Tirar a fiação listada em **Fiação**. Para achar o resto: `grep -rnE "<padrões da task>" server.js lib ui test tools --include=*.js --include=*.html` deve voltar vazio ao fim (critério **Pronto quando**).
4. Ajustar os testes de contrato listados em **Contrato**. Rota removida sai de `lib/local-auth/inventario.js` e o número esperado em `test/local-auth-inventario.test.js` desce na mesma conta. Nome removido de `ui/pure` sai da lista congelada de `test/ui-pure-superficie.test.js`. Aba, seção ou âncora removida sai do `ui/index.html` junto com todo `data-goto` que apontava para ela.
5. Apagar os testes que só exercitavam o que saiu. Antes de apagar um teste, ler o que ele afirma: se afirma regra de gate, ele fica e é adaptado.
6. Rodar o gate. Depois `npm run lint:update` e conferir que nenhuma contagem subiu.
7. Commit único por lote: `refactor(corte): <o que saiu>`, com o motivo dos ajustes de contrato no corpo.
8. Push, PR pela skill `abrir-pr`, esperar o `ci` verde, mesclar com `--merge`.

---

### Task 1: CI só Linux, sem Electron, sem release nativa, sem eng-behaviour

**Sai:** job `electron` de `.github/workflows/ci.yml`; `.github/workflows/release-nativo.yml`; `tools/eng-behaviour/`, `eng-behaviour.json`, `eng-behaviour.rules.md`; scripts `eng` e `preeng` do `package.json`; a chamada do `eng` em `tools/hooks/pre-push`.

**Fiação:** em `ci.yml`, matriz do `gate` vira só `ubuntu-latest`; o passo de testes perde o ramo de macOS; `test/jira-mcp-processo.test.js` passa a rodar no `gate` (já roda pelo `npm test`: conferir que não é excluído por `tools/rodar-testes.js`); o agregador `ci` passa a ter `needs: [gate]`.

**Contrato:** `test/eng-behaviour-gate.test.js` e qualquer teste que leia `eng-behaviour*` saem. `test/guias-navegaveis.test.js`: tirar a referência ao script `eng`.

**Pronto quando:** `grep -rn "eng-behaviour\|release-nativo" . --include=*.js --include=*.json --include=*.yml --include=*.md -l | grep -v docs/superpowers` volta só menções históricas em `CHANGELOG.md`; gate verde; o PR mostra um único job obrigatório.

- [ ] Ritual completo. Commit: `ci: gate só em Linux, sem Electron nem release nativa`.

### Task 2: Cortes limpos de rota (review-audit, preferences, chat, reviewers)

**Sai:** `lib/review-audit/`, `lib/preferences/`, `lib/engine/chat.js`, `lib/engine/chat-export.js`; `ui/telas/review-audits.js`, `preferences-transfer.js`, `chat.js`, `reviewers.js`; `ui/pure/review-audits.js`, `preferences.js`, `chat.js`; testes correspondentes.

**Fiação:** rotas `/api/review-audits`, `/api/preferences/transfer`, `/api/chat`, `/api/chat/export`, `/api/chat/send`, `/api/chat/stop`, `/api/reviewer-candidates` em `lib/http-server.js`; `tickReviewAudits`, as sete fachadas de chat e `server.js:718-724` (reviewers) no `server.js`; `parseProjectReviewers`/`parseDefaultReviewers` em `lib/parse.js`; chave `chats` do snapshot; eventos SSE `chat` e `chat-activity`.

**Pronto quando:** `grep -rnE "review-audit|preferences/|chatSend|chat-export|projectReviewers|defaultReviewers" server.js lib ui` vazio.

- [ ] Ritual completo. Commit: `refactor(corte): saem auditoria de revisão, preferências, chat e reviewers`.

### Task 3: Auto-update

**Sai:** `lib/update-installer.js`, `lib/engine/update*.js`, `ui/telas/sistema-atualizacao.js`, testes `update-*` e `ui-update`.

**Fiação:** `maybeAutoUpdate` no ciclo (`server.js:945`) e as nove fachadas; rota `/api/update`; chave `update` do snapshot; `atualizacaoExterna` em `lib/paths.js` fica (a instância isolada a lê).

**Pronto quando:** `grep -rnE "maybeAutoUpdate|update-installer|applyUpdate|checkUpdate" server.js lib ui` vazio.

- [ ] Ritual completo. Commit: `refactor(corte): sai o auto-update`.

### Task 4: Electron, instaladores e distribuição

**Sai:** `main.js`, `lib/electron-runtime.js`, `lib/desktop-identity.js`, `lib/autostart-mac.js`, `lib/renderer-recovery.js`, `installer/`, `Instalar.*`, `Desinstalar.*`, `tools/make-*`, `tools/electron-smoke*`, `tools/pack-ico.js`, `tools/publish-release.ps1`, `tools/release/`, `tools/release-footer.md`, `tools/emuladores/`, `docs/ELECTRON-SMOKE.md`, `docs/MACOS.md`, `docs/RELEASE.md`, `dist/` se versionado; testes `installer-*`, `instalador-*`, `native-bundle-mac`, `autostart-mac`, `desktop-identity`, `distribuicao-listas`, `pacote-auditoria`.

**Fiação:** `package.json`: saem `main`, `start`, `prestart`, `dependencies.electron`, `engines.farolShell`; `name` vira `farol-biuder`, `version` vira `3.0.0-dev`, `description` vira "Revisor autônomo de pull requests da BIUD". Os onze testes que leem `main.js` como texto: cada afirmação sobre `main.js` é removida; a afirmação sobre o motor fica.

**Contrato:** `test/guias-navegaveis.test.js` passa a travar dois guias (`docs/REVIEW-GATES.md`, `docs/CONFIGURATION.md`) e os scripts que sobraram.

**Pronto quando:** `grep -rnE "electron|main\.js|installer/|make-package" server.js lib test tools package.json` vazio; `npm ls --omit=dev` não lista dependência.

- [ ] Ritual completo. Commit: `refactor(corte): saem Electron, instaladores e pacote de distribuição`.

### Task 5: Cascas nativas

**Sai:** `shell/`, `lib/engine/casca-*.js`, `lib/engine/update-casca.js` (se ainda existir), `lib/engine/avisos-nativos.js`, `test/*casca*`, `test/fixtures/casca/`.

**Fiação:** `publicarCasca`, `bootstrapDaCasca` e `modoCasca` no `server.js`; `lib/engine/saida-ordenada.js` (import de casca); `lib/http-server.js` (eventos `casca`, `aviso-nativo`, `casca-saida`); `lib/paths.js` (`modoCasca`, `versaoDaCasca`, `bootstrapFeito`, `ambienteDoBootstrap`, `pidDoPai`, `ENGINE_DIR`, `CASCA_DIR`, `CASCA_FILE`); `lib/local-auth/` (classe `casca` de código e sessão, exigência por modo casca); chave `casca` do snapshot.

**Pronto quando:** `grep -rniE "casca|FAROL_SHELL|aviso-nativo" server.js lib test` vazio.

- [ ] Ritual completo. Commit: `refactor(corte): saem as cascas nativas`.

### Task 6: Motor só Linux

**Sai:** ramos `IS_WIN` e `IS_MAC` em todo `lib/` e `server.js` (`buildSessionScriptMac`, `osascript`, `detectGitBash`, `codexWindowsPathDirs`, `taskkill`, o `nul` de `git-isolado.js`); testes condicionados a Windows ou macOS.

**Fiação:** `lib/paths.js` exporta só `IS_LINUX` (sempre verdadeiro em plataforma suportada); `lib/node-runtime.js` recusa plataforma diferente de `linux` com a mensagem `O motor do Farol roda só em Linux.`.

**Pronto quando:** `grep -rnE "IS_WIN|IS_MAC|win32|darwin" server.js lib` vazio fora de `lib/node-runtime.js`.

- [ ] **Teste primeiro:** em `test/node-runtime.test.js`, `plataformaSuportada('win32') === false`, `plataformaSuportada('darwin') === false`, `plataformaSuportada('linux') === true`; rodar e ver falhar; implementar `plataformaSuportada(plataforma: string): boolean` em `lib/node-runtime.js`; rodar e ver passar.
- [ ] Ritual completo. Commit: `refactor(corte): motor só em Linux`.

### Task 7: Intervenções, Entregas, Destaques e ferramentas

**Antes do corte (commit próprio no mesmo PR):** mover `clearLog` de `lib/engine/tools.js` e a leitura do log de `lib/workspace.js` para `lib/engine/diagnostico.js`, com os testes existentes apontando para o novo lugar; tirar de `lib/settings.js` o import de `ui/pure/interventions.js` (a função usada vai para `lib/settings.js`).

**Sai:** `lib/engine/interventions.js`, `entregas-fatias.js`, `tools.js`; `parseHighlights` de `lib/workspace.js`; `ui/telas/interventions.js`, `intervention-*.js`, `entregas.js`, `ferramentas.js`, `confete.js`, `novidades.js`, `release-notes*.js`; `ui/pure/interventions.js`, `entregas.js`; `workspace-template/.claude/commands/pr-kudos.md` e `pr-health.md`; abas `entregas` e `destaques` do `ui/index.html`.

**Fiação:** rotas `/api/highlights`, `/api/deliveries`, `/api/tool`, `/api/tool/clear`, `/api/log/clear` (fica `/api/log`, `/api/log/triage`, `/api/diagnostics`); `gh-queries.js` (busca de entregas); chaves `interventions` e `toolRuns` do snapshot; eventos `intervention`, `focus-intervention`, `tool-done`; `argsDeSomenteLeitura` e a sessão de IA do diagnóstico em `session.js`.

**Fica:** `parseTeam` e `GET /api/team`, `POST /api/team/remove`.

**Pronto quando:** `grep -rnE "interventions|entregas|deliveries|highlights|toolRuns|kudos|pr-health" server.js lib ui` vazio.

- [ ] Ritual completo. Commits: `refactor: log e limpeza do log moram no diagnóstico` e `refactor(corte): saem intervenções, Entregas, Destaques e ferramentas`.

### Task 8: Especialistas e capacity

**Antes do corte:** mover `check`, `digest` e `safeText` de `lib/specialists/contract.js` para `lib/review-context/contrato.js` e `lib/capacity/processes.js` para `lib/review-source/processos.js`, ajustando os imports de `review-context/map.js` e `review-source/recovery-owner.js`.

**Sai:** `lib/specialists/`, `lib/capacity/`, `ui/telas/specialists.js`, `capacity.js`, `ui/pure/specialists.js`, `capacity.js`, testes.

**Fiação:** `prepareSpecialist` (`review.js:1232`) e `attachSpecialistEvidence` (`review.js:1432`, `decision.js`); `hasPolicies`, `prepareAccount`, `observeAdmission`, `sessionBudgetBlocked` em `review.js:725,747` e `session.js:800-852`; `cadeia-perfis.js` (import de `capacity/processes`); rotas `/api/specialists`, `/api/capacity`. O teto de gasto (`usage.js`, `freios-de-gasto.js`) não é tocado.

**Pronto quando:** `grep -rnE "specialist|capacity/|hasPolicies" server.js lib ui` vazio; `test/freios-de-gasto*.test.js` verdes sem alteração.

- [ ] Ritual completo. Commit: `refactor(corte): saem especialistas e capacity`.

### Task 9: Só Claude, um perfil por chave de API

**Sai:** `lib/codex/`, `lib/agy/`, `lib/engine/restricted-codex.js`, `restricted-provider.js`, `cadeia-perfis.js`, `limite-na-cadeia.js`, `login-web.js`; `ui/pure/agy.js`, `cadeia.js`, `login-web.js`; testes.

**Fiação:** `runProvedor` em `session.js:857-860` chama só `runClaudeStream`; `provedores.js` fica com um provedor (`claude`) e `semCustoEmDolar` devolve sempre `false`; `authFromProfile` em `perfil-claude.js` aceita só `kind: 'apikey'`; `resolveClaudeAuth` no `server.js` devolve o perfil de `config.claudeProfileId` ou o primeiro `apikey`; sanitizers de Codex e agy saem de `lib/parse.js`; `limite-plano.js` fica; rotas `/api/claude/login-web/*`, `/api/claude-login`, `/api/claude/profile-adopt` saem; `/api/claude/profile-test` fica; chaves `cadeiaPerfis` e `provedores` do snapshot saem.

**Pronto quando:** `grep -rniE "codex|agy|cadeiaPerfis|login-web|kind: 'dir'|maquina" server.js lib ui` vazio.

- [ ] **Teste primeiro:** em `test/perfil-claude.test.js`, `authFromProfile({ id: 'a', kind: 'apikey', apiKey: 'k' })` devolve auth utilizável; `authFromProfile({ id: 'b', kind: 'dir', dir: '/x' })` devolve `null`; perfil sem `apiKey` devolve `null`.
- [ ] Ritual completo. Commit: `refactor(corte): só Claude, perfil por chave de API`.

### Task 10: Panorama, prontidão e o que a fila não usa

**Sai:** `lib/engine/prontidao-pr.js`, `prontidao-pr-estado.js`, `radar-na-tela.js`, `review-signal.js`, `review-label-control.js`; co-assinatura (`coAssinar`, `autoridadeNaSaida` em `skip-review.js`, `coassinatura-coordenada.js`, `codeowners.js` se sem outro uso); `config.revisarComOutrosRevisando`; `ui/telas/prontidao.js`, `review-labels.js`, `radar-diagnostico.js`; `ui/pure/prontidao*.js`; `tools/web/`, `docs/WEB.md`, `tools/review-quality/`, `tools/avaliar-qualidade-review.js`, `docs/REVIEW-QUALITY.md`.

**Antes do corte:** `regraDaBranch` (lida por `checks-exigidos.js`) sai de `prontidao-pr.js` para `lib/engine/checks-exigidos.js`, com o teste junto.

**Fiação:** busca do Panorama em `gh-queries.js` (fica só a busca de PRs pedidos à conta); chaves `panorama`, `prontidao`, `reviewStatesGh`, `staleStates` do snapshot (a `staleStates` fica se `rereview-ancora.js` a ler: conferir); rota `/api/review-labels`; sub-abas `panorama` do Radar no `ui/index.html`.

**Fica:** label `<conta>:revisando`, saída de cena, `labels-a-tirar.js`, `label-propria-orfa.js`, `label-tardia.js`, `vigia-sessao.js`.

**Pronto quando:** `grep -rnE "panorama|prontidao|coAssinar|reviewSignals|revisarComOutrosRevisando" server.js lib ui` vazio; `test/skip-review*.test.js` verdes (os casos de co-assinatura saem, os de saída de cena ficam).

- [ ] Ritual completo. Commit: `refactor(corte): saem Panorama, prontidão e co-assinatura`.

### Task 11: Autoanálise e Meus PRs

**Sai:** `lib/engine/self-*.js`, `selfpr.js`, `autoanalise-agente.js`, `meus-prs-base.js`, `aviso-da-base.js`, `superado-pela-base.js`, `restricted-launch.js`, `restricted-source*.js`; `tools/farol-autoanalise.js`; `workspace-template/prompts/self-review.md`; `ui/telas/autoanalise-andamento.js`, `meus-prs.js`, `merge-bloqueado.js`; `ui/pure/autoanalise*.js`, `meus-prs*.js`, `merge-bloqueado.js`; a classe de sessão `autoanalise` e `ROTAS_DA_AUTOANALISE` em `lib/local-auth/`; `--autoanalise` em `tools/farol-parear.js`.

**Fiação:** as 23 referências a `selfMod` e `reconcileSelfAnalyses` no `server.js`; guardas `opts.restricted` e de perfil de autoanálise em `session.js` e `headless-fila.js`; rotas `/api/self-review*`, `/api/pr/hide`, `/api/pr/unhide`; `myAuthoredPRs` em `gh-queries.js`; chaves `myPRs`, `hiddenPRs`, `selfAnalyses`, `mergeStates`, `baseDosMeusPRs` do snapshot; evento `meu-pr-base`.

**Atenção:** `ehMeu` em `pr-proprio.js` lê `myPRs`. Passa a decidir só pelo autor do item (`ehPrProprio(pr.author, conta)`).

**Pronto quando:** `grep -rnE "selfMod|selfAnal|myPRs|self-review|autoanalise|mergeSelfPR|hiddenPRs" server.js lib ui tools` vazio.

- [ ] **Teste primeiro (Review Focus 2):** em `test/pr-proprio.test.js`, com `engine.myPRs` inexistente e `pr.author` igual à conta em caixa diferente, `shouldAutoApprove(pr, resultadoAprovavel)` devolve `{ ok: false, motivo: 'pr_proprio' }`, `shouldAutoReject` devolve `false` e o desfecho posta `COMMENT`.
- [ ] Ritual completo. Commit: `refactor(corte): saem autoanálise e Meus PRs`.

### Task 12: Sessão de terminal

**Sai:** `lib/engine/escopo-do-terminal.js`, `terminal-encerrado.js`, `segredo-de-saida.js`, `autorizacao-postagem.js`; `buildSessionScript*` e `buildLogin*` em `session.js`; `ui/telas/sessoes.js` (a parte de terminal; o cartão "Analisando agora" fica); `config.skipPermissions`.

**Fiação:** `review.js:380` (`abrirRevisaoNoTerminal`): `launchReview` recusa `mode: 'terminal'` com `400 { error: 'modo_invalido' }`; capabilities reexportadas por `decision.js`; rotas `/api/session-exit` e `/api/review/post`; cabeçalhos `x-farol-session` e `x-farol-review-cap` em `lib/local-auth/acesso.js`.

**Pronto quando:** `grep -rnE "terminal|session-exit|review/post|reviewCaps|segredoDeSaida" server.js lib ui` vazio (fora de comentários de histórico, que também saem).

- [ ] **Teste primeiro:** em `test/http-review.test.js`, `POST /api/review { urls: [u], mode: 'terminal' }` responde 400 com `error: 'modo_invalido'` e não cria sessão.
- [ ] Ritual completo. Commit: `refactor(corte): sai a sessão de terminal`.

### Task 13: Sync, celular e radar compartilhado (dois PRs)

**PR 13a, desligar no núcleo:** `engine.syncCoordenacaoAtiva()` deixa de existir; cada consumidor fica com o ramo que hoje roda com a coordenação desligada. Pontos: `review.js:468-532, 550, 776, 860` (`admissao`, `sync-distribuicao`, `sync-fechamento`, `sync-checkpoint`), `headless-fila.js`, `porta-de-execucao.js`, `skip-review.js`, `pushback.js`, `postagem-arbitragem.js`, `registro-postagem.js`, `postagem-reconciliacao.js`, `labels-a-tirar.js`, `label-propria-orfa.js`, `revisao-em-curso.js`, `technical-review/objection-reading.js`, `usage/activity.js`, `gh-queries.js` (`conta-entre-aparelhos`: passa a 1 aparelho fixo), `session.js` (`login-celular`). O que de `lib/sync/keys.js` for hash ou id puro usado na postagem vai para `lib/engine/chaves-de-postagem.js` com os mesmos nomes exportados.

**PR 13b, apagar:** `lib/sync/`, `lib/engine/sync-*.js`, `admissao.js`, `escolha.js`, `politica-efetiva.js`, `conta-entre-aparelhos.js`, `espera-prova-recibo.js`, `papel-do-aparelho.js`, `pr-por-tag.js`, `diagnostico-identidade.js`, `coassinatura-coordenada.js`, `review-round-sync.js`, `login-celular.js`, `capacidades.js`; `firebase/`; `tools/sync-rules.js`; script `sync:rules`; `ui/telas` e `ui/pure` de aparelhos, sync, compartilhado, listas remotas, espelho, pareamento de aparelhos, grupos; as 31 rotas `/api/sync/*`; chave `sync` e `capacidades` do snapshot; eventos `sync-*`; `modo celular` em `lib/local-auth/modo.js` e `ATIVACAO_AUTOMATICA_A4`, `ATIVACAO_TETO_GRUPO_C4B` em `lib/constants.js`.

**Pronto quando:** `grep -rniE "sync|firebase|aparelho|lease|celular" server.js lib ui tools test` vazio (exceto `readFileSync`/`writeFileSync` e afins: usar `grep -vE "Sync\("`).

- [ ] **Teste primeiro, no 13a (Review Focus 4):** em `test/postagem-dedup.test.js`, duas chamadas seguidas de `postReview` para o mesmo PR e head, com `gh` de mentira contando escritas: uma escrita em `/reviews`, a segunda devolve `already_reviewed`.
- [ ] **Teste primeiro, no 13b (Review Focus 3):** em `test/decisoes-legadas.test.js`, um `decisions.json` de fixture com `sync`, `chat`, `selfAnalysis` e `esperaProva` dentro das decisões: `decisionForUi` devolve objeto sem esses campos e `resolveIntoHistory` não lança.
- [ ] Ritual completo duas vezes. Commits: `refactor(corte): revisão e postagem sem coordenação entre aparelhos` e `refactor(corte): sai a sincronização entre aparelhos`.

### Task 14: Uma conta

**Sai:** `lib/engine/contas-gh.js`, `contas-migracao.js`, `conta-que-age.js`, `conta-na-tela.js` (o que sobrar vai para `review.js`); `ui/telas/contas.js` (barra de contas), `ui/pure/contas-gh.js`; campos `muted`, `color`, `kind`, `label` da conta.

**Fiação:** a config passa a ter `conta: { user, owners[], autoReview, onClean, onCaveats, onReject, padroesRevisao }`. `accountList()` devolve lista de um elemento a partir de `config.conta` (os consumidores do núcleo seguem iterando; não reescrever a fila). `ghEnv(user)` ignora o argumento diferente de `config.conta.user`. `recusaDeSilenciada` e a atribuição `reserva` saem de `postagem-portao.js`. `POST /api/accounts/edit` aceita só `tipo: 'editar'` e `'regra-review'`. Snapshot: `accounts` continua lista de um (a fase 3 lê assim), `contasGh` sai.

**Leitura de config antiga:** `lib/settings.js` ganha `normalizarConfig(cru: object): object`. Com `accounts[]` e sem `conta`, a primeira conta não silenciada vira `conta`; `ghUser`+`owners` legados também. Chaves desconhecidas são descartadas sem lançar.

**Pronto quando:** `grep -rnE "muted|contasGh|conta-que-age|contas-migracao|atribuicaoDoPr" server.js lib ui` vazio; `test/contas-respeitadas.test.js` verde com os casos de uma conta.

- [ ] **Teste primeiro (Review Focus 1):** em `test/settings-normalizar.test.js`: (a) `normalizarConfig({ accounts: [{ user: 'a', muted: true }, { user: 'b', owners: ['biudtech'], onClean: 'approve' }], cadeiaPerfis: [], sync: {}, claudeProfiles: [{ id: 'x', kind: 'dir' }, { id: 'y', kind: 'apikey', apiKey: 'k' }] })` devolve `conta.user === 'b'`, `conta.onClean === 'approve'`, sem `accounts`, `cadeiaPerfis` nem `sync`, e `claudeProfiles` só com `y`; (b) `normalizarConfig({})` devolve objeto sem `conta` e não lança; (c) `normalizarConfig('lixo')` devolve `{}`.
- [ ] Ritual completo. Commit: `refactor(corte): uma instância, uma conta revisora`.

### Task 15: Snapshot e inventário finais

**Fiação:** conferir `snapshot()` em `server.js` contra a lista fechada de chaves que ficam: `app, modelos, claudePerfis, status, error, baseline, account, accounts, pushbacks, config, jiraSites, lastCheckAt, nextCheckAt, buscasPausadas, queue, inicioAutomatico, esperaConflito, parked, reRounds, staleStates, activeSessions, activity, headlessWaiting, headlessWaitingDetails, filaJusta, decisions, reviewActions, usage, doctor, paths`. Qualquer outra sai. `lib/local-auth/inventario.js` e `lib/http-server.js` ficam com as mesmas rotas, uma a uma.

- [ ] **Teste primeiro:** em `test/snapshot-chaves.test.js`, `Object.keys(engine.snapshot()).sort()` é igual à lista acima ordenada; em `test/local-auth-inventario.test.js`, o conjunto de rotas tratadas em `http-server.js` é igual ao do inventário e nenhuma começa por `/api/sync`, `/api/self-review`, `/api/chat`, `/api/tool`.
- [ ] Ritual completo. Commit: `refactor(corte): snapshot e inventário de rotas do motor enxuto`.

### Task 16: Fechamento da fase

**Fiação:** `CLAUDE.md` reescrito do zero para o motor que sobrou (o que é, mapa de arquivos real, invariantes 1, 2, 3, 4 e 6; o 5 vira "só Linux"; o 7 sai), com o índice que `test/guias-navegaveis.test.js` trava. `README.md` reescrito: o que é, como rodar (`node server.js`), como testar. `docs/REVIEW-GATES.md` e `docs/CONFIGURATION.md`: saem as seções do que saiu, sem link morto. `docs/QUALITY.md`: sai a parte do eng-behaviour. `CHANGELOG.md`: entrada `3.0.0-dev` listando os cortes. `npm run lint:update` final.

- [ ] **Teste primeiro (Review Focus 5):** em `test/boot-vazio.test.js`, com `HOME` apontando para uma pasta temporária vazia e `FAROL_HEADLESS_CMD` de mentira, `node server.js` sobe, `GET /api/state` responde 200 com `queue: []`, nenhum arquivo é criado fora do `HOME` temporário, e SIGTERM encerra com código 0.
- [ ] Medir e anotar no PR: arquivos versionados e linhas antes (1.944 arquivos, ~450 mil linhas em `5fa446df`) e depois.
- [ ] Ritual completo. Commit: `docs: guias do motor enxuto`.

## Fora deste plano

- CORS, `hostPublico`, histórico paginado, `GET /api/health`: fase 2.
- Front em `web/`: fase 3. Remoção da `ui/`: fase 4. Container e publicação: fase 5.
