# Farol BIUD, guia do mantenedor

Leia isto antes de mexer em qualquer arquivo. É o sumário de quem mantém o motor: o que ele é, onde
cada coisa mora, o que não se negocia e como rodar sem estragar nada.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->
## Índice

- [Os guias](#os-guias)
- [O que é](#o-que-é)
- [Mapa de arquivos](#mapa-de-arquivos)
- [Invariantes do projeto](#invariantes-do-projeto)
- [Onde mora o dado](#onde-mora-o-dado)
- [A API do motor](#a-api-do-motor)
- [Como rodar e testar](#como-rodar-e-testar)
<!-- indice:fim -->

## Os guias

| guia | assunto |
|---|---|
| [`README.md`](README.md) | o que é, as duas partes, como subir o motor, rodar o front e parear |
| [`web/README.md`](web/README.md) | o front: como rodar, convenções e o contrato de cada tela |
| [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md) | o invariante 4 em detalhe: gates de postagem, dedup, re-revisão, checkpoint |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | a conta e a política, perfis do Claude, Jira, preferências, hospedagem |
| [`docs/CONSUMO-REVIEWS.md`](docs/CONSUMO-REVIEWS.md) | o que o registro de consumo mede e por que ele não barra revisão |
| [`docs/QUALITY.md`](docs/QUALITY.md) | o gate do repositório e o ratchet de qualidade |
| [`docs/RUNTIME.md`](docs/RUNTIME.md) | o contrato de versão do Node |
| [`docs/SOURCE-STORAGE.md`](docs/SOURCE-STORAGE.md) | o cache das fontes de revisão e os limites dele |
| [`docs/CONTEXTO-FRONTEND.md`](docs/CONTEXTO-FRONTEND.md) | o mapa sintático do código do PR e os modos de `reviewContextMode` |

`docs/superpowers/` guarda os desenhos e os planos. São registro de decisão, não guia: não
descrevem o código de hoje. O desenho vigente é
`docs/superpowers/specs/2026-11-12-farol-biuder-enxuto-design.md`; as fases 1 a 4 dele (o corte
do motor, o contrato para o front, o front e a saída da tela antiga) estão feitas, e a 5
(container e publicação) não está neste repositório.

## O que é

Revisor autônomo de pull requests da BIUD. É um motor: um processo Node (`node server.js`), uma
instância, uma conta revisora do GitHub, só Linux. Ele:

1. consulta o GitHub com o `gh` (sem gastar token de IA) e monta a fila dos PRs pedidos à conta;
2. abre, para cada PR, uma sessão headless do Claude Code no workspace `~/.farol/workspace`, com o
   protocolo de `workspace-template/`, o card do Jira já lido e o diff já gravado em disco;
3. recebe o envelope JSON da sessão, passa pelos gates e posta APPROVE, REQUEST_CHANGES ou COMMENT,
   ou leva o PR à mesa ("Precisa de você") quando a política da conta manda esperar;
4. serve a API por HTTP e SSE. A tela é o front de `web/`, que fala com essa API de outra origem.

A sessão de IA nunca posta: quem escreve no GitHub é o motor, pela conta revisora.

O motor não serve página. A tela antiga (`ui/`, servida pelo próprio motor) saiu em 16/11/2026,
quando o front de `web/` passou a cobrir as cinco telas: fora de `/api/`, todo pedido responde 404
em JSON.

## Mapa de arquivos

Só cita o que existe, e não é completo: lista os arquivos principais de cada assunto (em
`lib/engine/`, cerca de um quinto dos arquivos fica sem linha aqui). Cada arquivo de `lib/` abre
com um comentário que diz o que ele faz e por quê: o mapa aponta o lugar, o cabeçalho é a fonte.
Para a lista inteira, `git ls-files lib`.

### Raiz

| Caminho | Papel |
|---|---|
| `server.js` | A classe `Engine` (estado, ciclo de checagem, fila, snapshot) e as fachadas que delegam para `lib/engine/`. `start()` sobe o HTTP e só então começa a monitorar: o listen na porta é o lock de instância única |
| `package.json` | Scripts e o contrato de Node (`engines.node`). Sem `dependencies` |
| `workspace-template/` | O protocolo que a sessão de IA lê. Na primeira execução a pasta inteira é copiada para `~/.farol/workspace`. A cada boot o `prepareHome` (`server.js`) regrava cinco arquivos (`CLAUDE.md`, `prompts/pr-review-auto.md`, que é o contrato da revisão headless, os agentes `pr-reviewer` e `claim-verifier` e o comando `.claude/commands/pr-review.md`) e copia o que faltar em `prompts/` (a pasta inteira se faltar o `pr-review-auto.md`, e cada prompt do template que o workspace não tiver, sem sobrescrever). O resto vem só da primeira cópia e nunca é atualizado, inclusive o `.claude/settings.json`. O `.claude/guardas.json` (o que a sessão não pode rodar) também vai na primeira cópia, mas essa cópia não é usada: a sessão lê o do template, por `--settings` (`lib/engine/guardas-da-sessao.js`). É entrada de modelo, calibrada: mudança ali é mudança de comportamento da revisão |
| `web/` | O front (Next.js e TypeScript), a única tela: fala direto com a API do motor e tem o pareamento, a casca das cinco abas e as cinco telas (Radar, Histórico, Time, Consumo e Sistema). Pacote à parte, com `package.json`, dependências e gate próprios (job `web` do CI); o invariante 1 continua valendo para a raiz. O `check`, o `lint` e o `npm test` do motor não entram nele (`tools/nao-e-fonte.js`, `tools/descoberta-de-testes.js`). Em `web/src/`: `app/` (as rotas, uma pasta por aba), `componentes/` (os componentes, com uma pasta por tela), `contratos/` (tipos e leitores do que o motor manda), `transporte/` (o cliente da API e o SSE), `estado/` (o store), a lógica sem React de cada tela (`radar/`, `historico/`, `time/`, `consumo/`, `sistema/`), `markdown/`, `navegacao/`, `tema/`, `seguranca/` e `proxy.ts` (a CSP). Guia em [`web/README.md`](web/README.md) |
| `assets/third-party/babel-parser/` | O parser sintático, artefato autocontido conferido por manifesto e hash (`lib/parser-runtime.js`) |
| `test/` | A suíte (`node --test`), um arquivo por assunto |
| `tools/` | Gate e utilitários (tabela abaixo) |

### `lib/`: infraestrutura sem estado do engine

| Caminho | Papel |
|---|---|
| `lib/paths.js` | Caminhos (`HOME`, `WORKSPACE`, `STATE_DIR`, `CONFIG_FILE`), `instanciaIsolada`, `rodandoComoRoot`, `executadoDireto` |
| `lib/node-runtime.js` | Recusa plataforma que não é Linux e Node fora do contrato do `package.json` |
| `lib/constants.js` | Fonte única dos literais de infra: porta padrão, `TEMPOS`, limites |
| `lib/env.js` | A leitura de `process.env` dos módulos de `lib/` (stubs de teste, depuração, cópia do ambiente sem certas variáveis). `lib/paths.js` lê as de caminho, e o `server.js` lê e ajusta o `PATH` e monta o ambiente do `gh` |
| `lib/io.js` | `run` e `runShell` (todo `gh` passa aqui; nunca lançam, devolvem `{ ok, code, stdout, stderr }`), `readJson`, escrita atômica |
| `lib/settings.js` | A tabela única das preferências (`SETTINGS`) e `normalizarConfig`, que lê `config.json` antigo sem lançar |
| `lib/parse.js` | Normalizadores de config: perfis do Claude, pessoas, `bind`, `hostPublico`, `origensPermitidas`, e o saneamento de modelo e esforço (os valores que entram numa linha de comando) |
| `lib/http-server.js` | HTTP e SSE: as rotas de `/api`. Fora de `/api/` responde 404 em JSON, sem ler o disco (`test/http-sem-pagina.test.js`) |
| `lib/http-guard.js` | Allowlist de Host e Origin, aplicada antes de qualquer rota menos a de saúde: o loopback com a porta, o `hostPublico` sem porta e as `origensPermitidas`, tudo por igualdade exata. Devolve a origem configurada que casou, e recusa pedido com dois `Host` |
| `lib/http-cors.js` | Os cabeçalhos CORS da origem que a allowlist devolveu (nunca `*`, sem credenciais) e a resposta do preflight |
| `lib/fronteira-hospedada.js` | A carga do `config.json` no boot e as recusas de boot: arquivo presente e ilegível, inclusive o link simbólico para nada (ausente é instalação nova e sobe; BOM UTF-8 é aceito), nome de chave errado que lembra `hostPublico`, `origensPermitidas`, `localAuth` ou `bind`, e valor inválido nessas quatro. Em todas o motor não sobe e o `config.json` não é tocado. Também saneia as chaves só de arquivo (`bind`, `hostPublico` e `origensPermitidas`) |
| `lib/local-auth/` | Autenticação da API: `modo.js` (quando é exigida), `acesso.js` (o porteiro), `pareamento.js` e `sessoes.js` (só hash em disco), `inventario.js` (toda rota `/api` classificada) |
| `lib/estado-delta.js` | O snapshot vai para a tela por diferença |
| `lib/log-taxonomy.js` | Fonte única de classificação de falha: o retry e o diagnóstico leem a mesma tabela |
| `lib/log-arquivo.js` | A linha do `farol.log` e a rotação |
| `lib/sensitive-text.js` | Detecção de credencial em texto (máscara de log e trava de postagem) |
| `lib/modelos.js`, `lib/format.js`, `lib/taxonomy.js` | Catálogo de modelos, rótulos, papéis e níveis do perfil de review |
| `lib/workspace.js` | Leitura dos dossiês por autor que a revisão alimenta |
| `lib/git-env.js`, `lib/git-isolado.js` | Ambiente do `git`: o comum e o isolado (sem config da máquina) que roda sobre a fonte de revisão |
| `lib/session-deadline.js`, `lib/spawnlog.js`, `lib/bounded-file.js`, `lib/persistence-metrics.js` | Prazo da sessão, registro opcional de processos, leitura limitada, métricas de gravação |
| `lib/jira/` | Folhas do Jira: `sites.js`, `credentials.js` (credencial fora do `config.json`), `client.js`, `card.js`, `cache.js`, `errors.js`, `fontes-produto.js`. Não se importam entre si: quem compõe é `lib/engine/jira.js` |
| `lib/review-source/` | Aquisição e cache das fontes do PR (`index.js`, `git.js`, `github.js`, `store.js`), leitura verificável (`reader.js`), orçamento de disco e recuperação, e `caminho-protegido.js` (o que a sessão pode ver de arquivo de ambiente e credencial) |
| `lib/review-context/` | Mapa sintático e seleção de contexto sobre a fonte fixada. Nunca concede prova de leitura |
| `lib/technical-review/` | A avaliação técnica do PR revisado com a ferramenta fixada em `tool.json`: `setup.js` (instalação), `runtime.js` e `worker.js` (execução), `evidence.js` (as lacunas que impedem APPROVE), `verdict.js`, `publication.js` (a conferência na hora de postar) |
| `lib/usage/` | Leitura do diário de consumo para a rota `/api/usage` |

### `lib/engine/`: colaboradores da `Engine`

Recebem o engine como contexto. Os que decidem postagem estão na seção do invariante 4.

| Assunto | Arquivos |
|---|---|
| Ciclo de uma revisão | `review.js` (lançamento, fila, ciclo), `headless-fila.js`, `porta-de-execucao.js`, `revisao-em-curso.js`, `analysis-source.js` (o preparo das fontes e do contexto), `review-prompt.js` (o prompt), `fanout.js` (os lotes de PR grande), `session.js` e `claude-child.js` (a sessão e o stream), `envelope-revisao.js`, `reparo-envelope.js`, `review-output.js` (a saída pública única), `desfecho-da-revisao.js`, `etapas-revisao.js` |
| Gate e postagem | `approval-policy.js`, `decision.js`, `postagem-portao.js`, `credencial-no-texto.js`, `public-review.js`, `public-review-text.js`, `instancia-isolada.js`, `pr-proprio.js`, `espera-pr-proprio.js`, `desfecho-automatico.js`, `ressalvas.js`, `gate-espera.js`, `espera-ci.js`, `postagem-recuo.js`, `postagem-retentativa.js`, `postagem-recusada.js`, `retirada-de-pedido.js`, `review-head-policy.js` (a regra do dedup por head), `comentario-proprio.js`, `chaves-de-postagem.js` |
| Prova e cobertura | `file-proof.js`, `read-evidence.js`, `pr-scope.js`, `pr-inventory.js`, `alcance.js`, `alcance-contexto.js`, `ambiente-nao-lido.js`, `prova-do-repositorio.js`, `provas-da-decisao.js`, `busca-da-prova.js`, `espera-prova.js`, `recuperacao-prova.js`, `recuperacao-head.js`, `verification-checkpoint.js`, `checkpoint-da-sessao.js` |
| Achados e rodadas | `review-findings.js`, `review-findings-contract.js`, `review-rounds.js`, `review-round-store.js`, `review-criteria.js`, `review-consistency.js`, `heranca-de-producao.js`, `estado-desmentido.js` |
| Fila, sinais e labels | `gh-queries.js`, `skip-review.js` (saída de cena e decisão de gente no head), `pedido-de-revisao.js`, `review-scope.js` (regras por organização e autor), `vigia-sessao.js`, `label-tardia.js`, `labels-a-tirar.js`, `label-propria-orfa.js`, `relogio-da-label.js`, `espera-conflito.js`, `checks-exigidos.js`, `baseline.js`, `vistos-reconciliacao.js` |
| Re-revisão e retomada | `rereview-stale.js`, `rereview-ancora.js`, `head-novo.js`, `destrava.js`, `pendencia-commit-novo.js`, `review-retry.js`, `retry-da-revisao.js`, `retomada-duravel.js`, `retomada-varredura.js`, `cancelamento-revisao.js` |
| Conta e Claude | `contas-config.js` (a política da conta e a edição por operação), `perfil-claude.js`, `pasta-do-perfil.js`, `perfil-assinatura.js`, `chave-do-perfil.js`, `login-web.js`, `uso-do-plano.js`, `limite-plano.js`, `provedores.js`, `model-router.js`, `versao-claude.js` |
| Consumo | `usage.js` (fonte única do que a tela de consumo mostra), `usage-accounting.js` (a conta por modelo e o cursor das retomadas), `uso-parcial.js`, `usage-tentativas.js`, `usage-series.js`, `usage-activity.js`, `usage-desfechos.js`, `snapshot-usage.js` (a projeção que vai no snapshot), `falhas.js`. Só mede: não há teto de gasto, e o consumo não barra revisão (decisão de 16/11/2026, `test/sem-teto-de-gasto.test.js`) |
| Histórico | `snapshot-decisions.js` (as 30 resolvidas mais recentes que vão no snapshot), `historico-paginado.js` (a consulta paginada de `GET /api/decisions`) |
| Resto | `jira.js` (compõe `lib/jira/`), `pushback.js` (contestação do autor), `padroes-do-time.js`, `diagnostico.js`, `limite-gh.js`, `orcamento-busca.js`, `saida-ordenada.js`, `guardas-da-sessao.js`, `estado-do-boot.js` (o que o boot ajusta no estado gravado) |

### `tools/`

| Caminho | Papel |
|---|---|
| `tools/check-syntax.js` | `npm run check`: `node --check` em todo `.js` descoberto |
| `tools/quality/` | `npm run lint`: `gate.js` (ratchet contra `baseline.json`, só para baixo), `rules.js` e `strip.js` (as regras e o removedor de strings e comentários), `higiene.js` |
| `tools/rodar-testes.js` | `npm test`: `node --test` com teto de 4 de concorrência, sobre os testes do motor (`tools/descoberta-de-testes.js` monta os padrões, sem o front) |
| `tools/hooks/pre-push` | Recusa push direto na `main` e roda o gate. Instala com `npm run hooks:install` |
| `tools/farol-parear.js` | Imprime um código de pareamento da API no stdout; `--revogar-todas` |
| `tools/jira-mcp.js` | O servidor MCP local do Jira que a sessão usa. Recebe só o id do site e lê a credencial do disco |
| `tools/simular-politica.js`, `tools/diagnosticar-legados.js` | Leitura: o que mudaria com outra política; o que há de formato antigo no disco |
| `tools/replay-saida-review.js` | Replay offline da saída pública única, sem modelo ([`docs/CONSUMO-REVIEWS.md`](docs/CONSUMO-REVIEWS.md)) |
| `tools/replay-contexto.js`, `tools/benchmark-contexto.js`, `tools/comparar-contexto-engine.js`, `tools/medir-parser-frontend.js` | Medição do mapa de contexto e do parser, sobre fontes sintéticas e sem modelo |
| `tools/provar-fontes-github.js` | Prova de aquisição das fontes de um PR público, só leitura, com `FAROL_HOME` temporário |
| `tools/medicao/contagem-dobrada.js` | Compara, num stream capturado de sessão, a soma do acumulador de uso com a soma por mensagem |
| `tools/git-env.js`, `tools/nao-e-fonte.js`, `tools/descoberta-de-testes.js` | Apoio das ferramentas: o ambiente do `git`, as pastas que nenhuma ferramenta abre, os padrões de teste do motor |

## Invariantes do projeto

Não se negociam. Mudar um deles é decisão do dono, com teste junto.

1. **O motor roda em Node puro, sem dependência npm de runtime.** `npm ls --omit=dev` não lista nada.
   A única exceção é o parser sintático `@babel/parser`, que não é resolvido em `node_modules`: o
   artefato que o motor usa é o de `assets/third-party/babel-parser/`, na versão do `manifest.json`
   de lá (7.28.5), conferido por hash (`lib/parser-runtime.js`). O pino em `devDependencies` existia
   para reproduzir esse artefato e hoje diverge dele (8.0.10, por um bump automático): é pendência
   aberta, e não muda o que roda. Não adicione pacote.
2. **Dados em `~/.farol`.** O estado do motor mora todo lá, e no container é o volume que
   persiste. O motor não escreve na pasta do código nem no diretório de trabalho, e no boot não
   escreve na pasta temporária (`test/boot-vazio.test.js`). As duas escritas fora de `~/.farol`
   estão em "Onde mora o dado".
3. **Log sem ruído.** O `farol.log` é a fonte do diagnóstico. `log()` grava qualquer nível, e hoje
   há, além de ERROR e WARN, algumas linhas INFO de evento que explica uma decisão (por exemplo,
   por que o automático foi segurado num PR). O que se espera de quem escreve log novo: falha, ou
   o motivo de uma decisão que alguém vai perguntar depois; nunca passo normal nem sucesso de
   rotina, e no máximo uma linha por mudança de estado, não uma por ciclo. A
   classificação de falha mora só em `lib/log-taxonomy.js`: falha nova se cadastra lá e passa a
   valer no retry e no diagnóstico de uma vez. Não escreva regex de erro em outro lugar.
4. **Nada é postado no GitHub sem gate.** Detalhe logo abaixo.
5. **Só Linux.** `lib/node-runtime.js` recusa outra plataforma, e não existe ramo de sistema
   operacional no código. Não crie um.
6. **Texto de tela e comentários em português, sem travessão.** Use vírgula, parênteses ou dois
   pontos.

### O invariante 4: nada é postado sem gate

É o coração do motor. As regras que valem hoje, cada uma com o lugar em que mora; o porquê e os casos
de origem estão em [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md).

**Uma boca só.** Toda escrita de review passa por `postReview` (`lib/engine/decision.js`): revisão
automática, clique na mesa, reenvio e esperas. As postagens do mesmo PR entram em fila, uma por vez.
Dentro dela, `postReviewOnce` recusa, nesta ordem:

- pendência na memória de rodadas, só com `reviewRoundsMode: "enforce"` e fora do clique
  (`lib/engine/review-rounds.js`);
- instância isolada e PR da própria conta (`lib/engine/postagem-portao.js`);
- payload fora do formato;
- credencial no texto (`lib/engine/credencial-no-texto.js`): responde `credencial_no_texto` citando
  só os campos, nunca o valor;
- linguagem interna no texto público (`lib/engine/public-review.js`): corpo e comentários inline não
  citam ferramenta, modelo, automação nem a própria conta em terceira pessoa; responde
  `internal_language`. Na revisão automática o texto barrado é reconstruído uma vez
  (`lib/engine/desfecho-da-revisao.js`);
- conta sem token no `gh`: não posta, para o review nunca sair assinado por outra identidade.

Entre a credencial e a linguagem entra a recusa por critérios inconsistentes
(`lib/engine/review-criteria.js`). E, já lendo o GitHub, logo antes do envio:

- a avaliação técnica na hora de aprovar (`lib/technical-review/publication.js`);
- PR mergeado ou fechado: APPROVE e REQUEST_CHANGES não saem; COMMENT sai. Estado desconhecido não
  cancela. Para item que chegou sem autor, o autor é lido aqui e a recusa de PR próprio é
  conferida de novo;
- dedup por head, abaixo.

**Admissibilidade antes da política.** `shouldAutoApprove` e `shouldAutoReject`
(`lib/engine/approval-policy.js`) decidem primeiro se o resultado pode sair (análise completa,
inventário e rodada fechados, resultado coerente, texto público presente, origem conhecida, nenhuma
lacuna de prova exigida) e só depois consultam a política da conta. As lacunas que impedem APPROVE
saem de `lib/technical-review/evidence.js`; o que separa limpo de com ressalvas é só
`lib/engine/ressalvas.js`. O que é ressalva e o que é lacuna quem decide é o motor, nunca o modelo.

**Decisão sem mesa, pela política da conta.** `config.conta` traz `autoReview`, `onClean`,
`onCaveats` e `onReject` (`lib/engine/contas-config.js`). Fora de `wait` o motor decide e posta
sozinho; em `wait` o PR vai à mesa, com o motivo dito no card. O com ressalvas nunca é mais
permissivo que o limpo. Revisão de origem sem marca nenhuma não posta sozinha
(`origemDoDono`, `lib/engine/desfecho-automatico.js`). Bloqueio que a sessão declara com causa de
estado (CI, conflito, dependência, fora do diff) não reprova sozinho.

**Dedup por head.** Uma aprovação ou reprovação publicada encerra aquele commit para a conta: antes
de postar na revisão automática, o motor lê os reviews da própria conta naquele `commit_id`
(`myReviewStates`), e leitura que falha não envia. Duas vias chegando juntas ao mesmo veredito no
mesmo head postam uma vez. Só commit novo abre rodada nova. Travado em
`test/postagem-dedup.test.js` e `test/postagem-coordenacao-desligada.test.js`.

**Head que anda durante a sessão não recebe o review.** O desfecho confere o head antes de postar; se
mudou, nada sai e a pendência fica marcada `stale_head` (`lib/engine/desfecho-da-revisao.js`).

**PR da própria conta sai como COMMENT.** O GitHub recusa a revisão decisiva do autor. O gate
responde `pr_proprio`, o portão recusa APPROVE e REQUEST_CHANGES por qualquer via, e o desfecho posta
COMMENT (`lib/engine/pr-proprio.js`, `lib/engine/espera-pr-proprio.js`). Travado em
`test/pr-proprio.test.js`.

**Espera do CI é opcional.** `aguardarCiParaAprovar` nasce desligada e é lida num lugar só
(`aguardaCiParaAprovar`, `lib/engine/gate-espera.js`). Desligada, o estado do CI não segura nem barra
a decisão: só é seguro onde o check é obrigatório no ruleset do repositório. Ligada, a aprovação
espera os checks obrigatórios verdes no commit revisado e sai sozinha quando fecham
(`lib/engine/espera-ci.js`); head diferente larga a espera.

**Gente no PR segura o automático.** Aprovação ou reprovação de uma pessoa no head, e a label
`<conta>:revisando` de outra conta, tiram o PR do caminho automático
(`lib/engine/skip-review.js`). O clique atravessa.

**Instância isolada não escreve no GitHub.** Com `FAROL_HOME` fora de `~/.farol`, postagem e label
são recusadas (`blocked: 'instancia_isolada'`, `lib/engine/instancia-isolada.js`), a menos que o
`config.json` dela traga `"instanciaIsoladaPosta": true` (só por arquivo). Com a variável
`FAROL_UPDATE_MANAGER=external` a instância não conta como isolada (`lib/paths.js`). Travado em
`test/instancia-isolada.test.js`.

**Nunca apague nem afrouxe teste de gate.** Os de postagem, dedup por head, espera do CI, PR
próprio, credencial no texto, linguagem pública e instância isolada só mudam junto com a regra, por
decisão do dono.

## Onde mora o dado

O estado mora em `~/.farol` (ou em `FAROL_HOME`, que liga a instância isolada):

| Caminho | O que é |
|---|---|
| `config.json` | Preferências e a conta. Parte só se edita pelo arquivo, com reinício (`port`, `bind`, `localAuth`, `hostPublico`, `origensPermitidas`) |
| `workspace/` | O diretório de trabalho de toda sessão de IA. Cinco arquivos do protocolo são regravados a cada boot e prompt que falta é copiado (ver o mapa); o `.claude/settings.json` não |
| `workspace/state/` | Estado do motor: `farol.log`, `decisions.json` (pendências e histórico), `usage.json` e `usage-sessions.json`, dossiês em `authors/`, os materiais da avaliação técnica em `technical-review/` |
| `local-auth/` | Sessões e códigos de pareamento da API, só hash |
| `claude/<id>/` | A pasta de configuração de cada perfil de assinatura do Claude, com o login |
| `jira-credentials.json` | A credencial do Jira, fora do `config.json` |
| `cards/` | O cache dos cards do Jira, por site (`lib/jira/cache.js`) |
| `mcp/` | A configuração do servidor MCP do Jira que a sessão recebe (`lib/engine/jira.js`) |
| `source-cache/` | O cache das fontes de revisão |
| `technical-review/repositories.json`, `toolchains/` | O cadastro por repositório e a ferramenta da avaliação técnica |

Fora de `~/.farol` o motor grava em dois lugares:

- `~/.claude.json`, no HOME do usuário: a confiança do Claude Code no workspace, para a sessão não
  parar no diálogo de "confiar nesta pasta". Antes de alterar, o arquivo que já existia é copiado
  para `~/.claude.json.farol-bak` (`ensureWorkspaceTrusted`, `server.js`).
- uma cópia efêmera da configuração do perfil de assinatura, na pasta temporária do sistema
  (`os.tmpdir()`), quando o motor testa o perfil ou lê o uso do plano. A credencial não é copiada,
  e a cópia é apagada no fim (`lib/engine/perfil-assinatura.js`).

Credencial fica fora do workspace de propósito: o workspace é o que a sessão de IA lê. A chave de
API do perfil do Claude mora no `config.json` e não sai do motor por resposta nenhuma: para fora o
perfil leva só `temChave` (`lib/engine/chave-do-perfil.js`, travado em
`test/chave-de-api-nao-sai.test.js`).

## A API do motor

Escuta em `127.0.0.1:47170` por padrão. A ordem das defesas, em toda requisição
(`lib/http-server.js`):

1. alvo que não é URL responde 400;
2. `GET /api/health` responde `{ "ok": true }` aqui, antes de tudo o mais: é o probe do
   orquestrador, que chega com um Host fora de qualquer lista. Corpo fixo, sem dado do motor;
3. allowlist de Host e Origin (`lib/http-guard.js`). Recusa é 403, sem cabeçalho CORS;
4. origem de `config.origensPermitidas`: a resposta ganha os cabeçalhos CORS, qualquer que seja
   o desfecho dali em diante (`lib/http-cors.js`);
5. `OPTIONS` em `/api/` responde 204 e não executa rota;
6. o cabeçalho `x-farol: 1` em todo POST;
7. a autenticação por Bearer quando exigida: sempre no modo hospedado (`config.hostPublico` ou
   `config.origensPermitidas` preenchidos, sem chave que desligue), e também com
   `config.localAuth: "exigir"` ou `bind` fora do loopback (`lib/local-auth/modo.js`).

Fora de `/api/` não há rota: depois da allowlist (item 3), qualquer caminho e qualquer método
respondem 404 com `{ "error": "not found" }`, o mesmo corpo da rota de API que não existe.

O token nasce em `POST /api/auth/pair`, trocado por um código de `node tools/farol-parear.js`.
Não há cookie, e a recusa do pareamento é uma só, sem dizer se há código esperando. Valor
inválido em `hostPublico`, `origensPermitidas`, `localAuth` ou `bind` não vira vazio nem
loopback, nome errado numa dessas chaves não é descartado calado, e `config.json` presente e
ilegível não vira os padrões: nos três casos o motor não sobe (`lib/fronteira-hospedada.js`). O detalhe de hospedagem está em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#para-hospedar).

Toda rota de `/api` está classificada em `lib/local-auth/inventario.js` (32 caminhos; três
públicos, cada um só no método dele: o pareamento, o status da autenticação e a saúde), e rota
nova sem classe reprova em `test/local-auth-inventario.test.js`. O estado inteiro sai em `GET /api/state` e, por
diferença, em `GET /api/events` (SSE); as chaves do snapshot são lista fechada, travada em
`test/snapshot-chaves.test.js`. A definição do dado é do motor: a tela fatia e formata, não
recalcula.

As rotas, todas em `lib/http-server.js`:

| Método | Rotas |
|---|---|
| `GET` | `/api/health`, `/api/auth/status`, `/api/state`, `/api/events` (SSE), `/api/decision`, `/api/decisions`, `/api/team`, `/api/usage`, `/api/log`, `/api/log/triage`, `/api/diagnostics`, `/api/doctor` |
| `POST` | `/api/auth/pair`, `/api/auth/sessions`, `/api/auth/revoke`, `/api/check`, `/api/review`, `/api/cancel`, `/api/decide`, `/api/ignore`, `/api/restore`, `/api/pushback`, `/api/settings`, `/api/accounts/edit`, `/api/team/remove`, `/api/claude/profile-test`, `/api/claude/login-web/start`, `/api/claude/login-web/code`, `/api/claude/login-web/cancel`, `/api/jira/credential`, `/api/jira/credential/remove`, `/api/jira/test` |

Nem toda rota tem tela. O front lê o estado só pelo SSE (não chama `GET /api/state`, que
serve a `tools/diagnosticar-legados.js` e a quem consulta à mão) e não usa `GET /api/log`, `GET /api/log/triage`,
`POST /api/jira/credential`, `POST /api/jira/credential/remove` nem as três de
`POST /api/claude/login-web/*`, e não cria nem remove perfil do Claude: a credencial do Jira, a
chave de API e o login da assinatura entram por chamada direta à API (com o Bearer do
pareamento e `x-farol: 1`). Os corpos estão em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#chamar-a-api-sem-tela) e nas lacunas do
[`web/README.md`](web/README.md).

Das preferências de `POST /api/settings`, o front edita `aguardarCiParaAprovar`,
`parallelReviews`, `reviewModel`, `reviewEffort` e `people`. Só mudam pela API ou pelo arquivo:
`jiraSites`, `claudeProfiles`, `claudeProfileId`, `intervalSeconds`, `globalParallelReviews`,
`reReviewResume`, `reviewFast`, `aguardarCiParaRevisar`, `autoPushback` e `debugSpawns`.
`soundEnabled`, `theme` e `autostart`, da tela antiga, saíram da tabela: voltam em `ignoradas`,
e num `config.json` antigo são descartadas na carga (`test/preferencias-sem-leitor.test.js`).

O snapshot leva só as 30 decisões resolvidas mais recentes. O histórico inteiro (até 3.000, a
mais nova primeiro) sai em `GET /api/decisions`, uma página por vez
(`lib/engine/historico-paginado.js`). Todos os parâmetros são opcionais:

- `page` (a partir de 1) e `pageSize` (padrão 30, teto 100);
- `q`, até 200 caracteres: busca sem caixa e sem acento em repositório, número, título, autor do
  PR e chave do card. Os termos são separados por espaço e todos têm de aparecer. Hífen e
  sublinhado fazem parte do termo: `proj-9` casa com `PROJ-9`, e não com "proj" num campo e 9
  em outro. Busca que fica sem letra nem dígito (`-`, `_`, só espaço) vale como sem busca;
- `veredito`: filtra pelo que foi publicado no PR (o `action` do item), não pelo parecer da
  sessão (`verdict`). Aceita `approve`, `request_changes`, `comment` e `skip`, que é o que não
  foi postado (pulado na mesa, substituído por rodada nova, PR já mergeado ou fechado, aprovação
  que deixou de ser necessária). Item sem `action`, ou com outro valor, entra em `skip`;
- `repo`, até 200 caracteres: `dono/nome` exato, sem caixa, com os espaços das pontas aparados.

Responde `{ ok, page, pageSize, total, pages, items, repos }`: `total` e `pages` contam o que
passou nos filtros, e `repos` são os repositórios de todo o histórico, uma entrada por
repositório (sem diferenciar caixa, com a grafia do item mais recente). Cada item sai pela
mesma projeção do snapshot (`decisionForUi`), e as pendentes ficam só no snapshot. Parâmetro
inválido ou repetido responde 400 com `{ ok: false, code: "parametro_invalido", campo }`;
página além do fim responde 200 com `items` vazio. Campo torto num item guardado (título ou
autor que não é texto) conta como vazio na busca. A rota só lê: não altera o histórico e não
escreve no log, nem no 200 nem no 400.

## Como rodar e testar

- **Rodar**: `node server.js` (ou `npm run server`, que antes confere Node e plataforma). Node
  `>=24.22.1 <25`, Linux, com `gh` e `claude` no PATH do usuário. Não rode como root: o Claude Code
  recusa o modo headless com uid 0, e toda revisão morreria no spawn.
- **Gate do motor, antes de qualquer entrega**: `npm run check && npm run lint && npm test`. O `lint` é
  ratchet: reprova contagem que sobe contra `tools/quality/baseline.json`. Corrigiu dívida?
  `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão.
- **Nunca passe de 4 de concorrência** na suíte (`FAROL_TEST_CONCORRENCIA`, de 1 a 4).
- **Gate do front**, em `web/`: `npm ci && npm audit && npm run typecheck && npm run lint && npm test && npm run build`
  (o que o job `web` do CI roda).
- **Fora de Linux** o motor não roda (`lib/node-runtime.js` recusa): rode o gate num Linux com
  Node 24.22.1 (WSL, por exemplo). O CI roda em `ubuntu-latest`.
- **Instância para olhar**: `FAROL_HOME=/tmp/farol-teste node server.js` sobe o motor sem
  tocar nos dados reais, e por ser isolada não escreve no GitHub. Para trocar a porta, grave
  `{"port": 47180}` no `config.json` dela antes de subir.
- **Instância nova age sozinha.** Com a pasta de dados vazia e o `gh` logado, a conta detectada
  nasce revisando, aprovando e reprovando sozinha. Para subir sem agir, grave a conta em espera no
  `config.json` antes do primeiro boot: a receita está em
  [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#a-conta-revisora-e-a-política) e é provada em
  `test/conta-detectada.test.js`.
- **Stub da sessão**: `FAROL_HEADLESS_CMD` substitui o `claude` headless (imprima um envelope
  `{"result": "..."}` no stdout). É o que os testes usam.
- **Teste novo que sobe a `Engine`** fixa `FAROL_HOME` numa pasta temporária antes de importar o
  `server.js`: os caminhos são constantes de módulo, lidas na carga.
- As buscas do `gh` são só leitura; o que escreve no GitHub passa pelos gates do invariante 4.
- **A trava dos guias**: `test/guias-navegaveis.test.js` confere o índice deste arquivo e dos dois
  guias de `docs/` contra as próprias seções, o mapa do código do README contra o `package.json`, e
  todo link relativo.
