> A aprovação exige admissibilidade técnica. A política de postagem e os gates estão em [REVIEW-GATES.md](REVIEW-GATES.md).

# Configuração operacional do Farol

Guia de quem configura e mantém o motor de revisão: uma instância, uma conta revisora do
GitHub, Linux, `node server.js` (Node `>=24.22.1 <25`), revisão headless com o Claude Code.
O `CLAUDE.md` da raiz é o sumário do projeto e guarda os invariantes.

Toda configuração mora em `~/.farol/config.json` (o HOME do Farol; veja `FAROL_HOME` em
[Para hospedar](#para-hospedar)). Parte dela a tela edita; o resto é só de arquivo e vale
depois de reiniciar o motor.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [A conta revisora e a política](#a-conta-revisora-e-a-política)
- [Preferências do config.json](#preferências-do-configjson)
- [Modelo e esforço das sessões autônomas](#modelo-e-esforço-das-sessões-autônomas)
- [Perfis do Claude](#perfis-do-claude)
- [Avaliação técnica dos PRs revisados](#avaliação-técnica-dos-prs-revisados)
- [Jira](#jira)
- [Padrões do time na revisão](#padrões-do-time-na-revisão)
- [Fontes versionadas e contexto controlado](#fontes-versionadas-e-contexto-controlado)
- [Para hospedar](#para-hospedar)

<!-- indice:fim -->

## A conta revisora e a política

A instância tem uma conta revisora só, no campo `config.conta`:

```json
{
  "conta": {
    "user": "login-da-conta",
    "owners": ["biudtech"],
    "autoReview": true,
    "onClean": "approve",
    "onCaveats": "approve",
    "onReject": "request_changes",
    "padroesRevisao": "texto livre",
    "reviewRules": {}
  }
}
```

Esses são todos os campos (`CAMPOS_DA_CONTA` em `lib/settings.js`); qualquer outro é
descartado na leitura. A política de revisar e de publicar mora só na conta: não existe
chave geral que a substitua.

### Os quatro campos da política

| campo | valores | padrão da conta detectada |
|---|---|---|
| `autoReview` | `true` (revisa sozinho o PR pedido à conta), `false` (só põe na fila) | `true` |
| `onClean` | `approve`, `wait` | `approve` |
| `onCaveats` | `approve`, `wait` | `approve` |
| `onReject` | `request_changes`, `wait` | `request_changes` |

O padrão é `PADRAO` em `lib/engine/contas-config.js`. A leitura da política
(`politicaExplicita`) dá ao campo ausente ou fora do domínio o valor padrão, e a gravação
(`contaParaGravar`) escreve os quatro por extenso no arquivo. **O com ressalvas nunca é
mais permissivo que o limpo:** com `onClean: "wait"`, a leitura devolve `onCaveats: "wait"`
seja o que for que esteja gravado, e a edição que pede `onCaveats: "approve"` nessa conta é
recusada com o motivo (`aplicarEdicao`).

### De onde vem o login

O login da conta (`user`) vem do arquivo ou, se o arquivo não traz login, da detecção do `gh`
no primeiro boot (`contaDetectada`): a conta nasce com o login ativo do `gh`, com
`owners: ["biudtech"]` quando não havia organização escolhida (`OWNERS_PADRAO` em
`lib/settings.js`) e com a política por extenso. Os campos de política que o arquivo já
trazia, mesmo sem login, são mantidos. Com a conta configurada, o `gh` não é consultado para
detectar outra. A tela nunca muda o login.

**Uma instância nova, com a pasta de dados vazia e o `gh` logado, nasce revisando, aprovando
e reprovando sozinha**, porque esse é o padrão da conta detectada. Quem não quer isso grava a
receita abaixo antes do primeiro boot.

### Receita da instância que sobe sem agir

Grave no `config.json`, antes do primeiro boot:

```json
{ "conta": { "autoReview": false, "onClean": "wait", "onCaveats": "wait", "onReject": "wait" } }
```

A instância monitora, põe os PRs na fila e não posta nada sozinha. A escolha sobrevive ao
primeiro `check()`, à detecção da conta pelo `gh` e ao reinício, e a conta detectada fica
gravada com esses quatro valores (travado em `test/conta-detectada.test.js`, caso "receita da
instância que sobe sem agir"). Só `"autoReview": false` não basta: a revisão automática
desliga, mas os outros três campos caem no padrão, então um PR revisado por clique ainda é
aprovado sozinho (limpo ou com ressalvas) e reprovado sozinho.

Uma regra de review por organização ou autor marcada Automático revisa sozinha mesmo com
`autoReview: false` (ver abaixo). A receita parte de `reviewRules` vazio.

### A tela edita por operação

Em Sistema > Contas, a tela manda `POST /api/accounts/edit` dizendo qual campo mudou
(`tipo: "editar"`, com `campos`) ou qual regra de review mudou (`tipo: "regra-review"`), e o
motor aplica sobre a config atual (`aplicarEdicao` e `editarConta` em
`lib/engine/contas-config.js`). Campos editáveis: `owners`, os quatro da política e
`padroesRevisao` (`CAMPOS_EDITAVEIS`). Campo desconhecido ou valor fora do domínio volta em
`ignorados`, sem virar o padrão. Mudar as organizações dispara uma checagem na hora.

Toda mudança de política vai a `state/politica-historico.json` (dentro do workspace), com
data e origem (`janela do Farol`, `navegador`, `migração` ou `detecção do gh`), até 200
entradas. O motivo "a política manda aguardar" no card diz quando e de onde veio a
configuração que segurou (`motivoDaPolitica`), e o Diagnóstico lista as mudanças recentes.

### `config.json` antigo

`normalizarConfig` (`lib/settings.js`) lê qualquer `config.json` de versões anteriores sem
lançar e devolve só o que o motor ainda lê. As regras, do comentário e do código dela:

- `conta` no formato novo vale. Sem ela, vale a primeira conta **não silenciada** da lista
  antiga `accounts`; sem lista, o modo simples `ghUser` + `owners`.
- Lista só de contas silenciadas vira uma conta sem login que não age (`autoReview: false` e
  os três desfechos em `wait`): a silenciada nunca agia.
- Da conta ficam só os campos de `CAMPOS_DA_CONTA`, e só valor do domínio.
- **Ler uma config antiga nunca deixa a conta mais permissiva do que ela era.** Com as chaves
  gerais antigas `autoReview` ou `autoApproveAll` no arquivo, ou com conta vinda do formato
  antigo sem o marcador `esquemaConfig`, o campo que a conta não escolheu recebe o que valia
  então: revisa pela chave geral antiga, com ressalvas só aprova com `autoApproveAll`
  verdadeiro, e reprovar sozinha fica em `wait`. Vale também antes de existir login.
- Perfil do Claude que não é `dir` nem `apikey` sai.
- `seniority` atravessa e vira o perfil por pessoa (`people`) no boot.
- Chave que não está em `SETTINGS` nem em `CHAVES_SO_DE_ARQUIVO` é descartada.

O que a leitura decidiu vai ao rastro com origem `migração`, uma vez, e o arquivo é regravado
no formato novo (`aoCarregar`).

### Review por organização e autor

Cada regra em `conta.reviewRules` escolhe Automático (`auto`) ou Manual (`manual`) para uma
organização inteira ou para um autor dentro dela, por exemplo
`{"acme": {"mode": "manual", "authors": {"joao": "auto"}}}` (`lib/engine/review-scope.js`).

- O autor vence a organização, e a organização vence a conta (`regraDoPr`,
  `politicaDeInicio`). Sem regra para a organização, vale `autoReview` da conta.
- A regra vale nos dois sentidos: com a conta em "só põe na fila", uma organização ou um
  autor em Automático revisa sozinho.
- Manual permite o clique Revisar e impede a revisão automática, inclusive a retentativa
  automática (`bloqueioDeInicio`).
- PR sem organização ou sem autor conhecido, quando há regra que dependeria dele, conta como
  manual.
- A edição é pontual: mexer numa regra não regrava as outras nem a política de publicação, e
  "herdar" (`inherit`) remove só a regra escolhida.

Aprovar e pedir mudanças continuam obedecendo a `onClean`, `onCaveats` e `onReject`.

## Preferências do config.json

A tabela única é `SETTINGS`, em `lib/settings.js`: chave, padrão, se a tela edita (`ui`) e o
saneador. `POST /api/settings` aceita só as chaves com `ui: true` e devolve as outras em
`ignoradas`. Chave marcada `omitirPadraoAoGravar` não é escrita no arquivo enquanto estiver
no padrão.

| chave | padrão | quem edita |
|---|---|---|
| `conta` | `null` | `POST /api/accounts/edit` e o arquivo ([acima](#a-conta-revisora-e-a-política)) |
| `jiraSites` | `[]` | tela (Sistema > Jira) |
| `intervalSeconds` | `300` (180 a 3600) | tela |
| `parallelReviews` | `1` (1 a 4) | tela, "Revisões paralelas por conta" |
| `globalParallelReviews` | `0` (0 a 8; 0 = sem teto total) | tela, "Teto total desta instalação" |
| `soundEnabled`, `theme`, `autostart` | `true`, `"dark"`, `false` | tela |
| `reReviewResume` | `true` | tela, "Retomar a sessão na segunda rodada" |
| `reviewFast` | `false` | tela, "Modo rápido da revisão" |
| `aguardarCiParaRevisar` | `false` | tela, "Esperar o CI antes de revisar" |
| `aguardarCiParaAprovar` | `false` | tela, "CI obrigatório antes da aprovação" |
| `people` | `{}` | tela |
| `reviewModel`, `reviewEffort` | `""` | tela ([modelo e esforço](#modelo-e-esforço-das-sessões-autônomas)) |
| `autoPushback`, `debugSpawns` | `true`, `false` | tela |
| `claudeProfiles`, `claudeProfileId` | `[]`, `""` | tela ([perfis](#perfis-do-claude)) |
| `reviewSingleOutput` | `false` | arquivo |
| `reviewRoundsMode` | `"observe"` (`"enforce"` liga os gates de rodada) | arquivo |
| `reviewContextMode`, `reviewContextTokens`, `reviewContextLimits` | `"off"`, `3000`, `{}` | arquivo ([fontes](#fontes-versionadas-e-contexto-controlado)) |
| `sourceCacheLimits` | `{}` | arquivo |
| `reviewNavigationFacts`, `reviewBatchedReads`, `reviewAgentOwnership` | `false` | arquivo |
| `autoOpus` | `null` (lista do roteador) | arquivo |
| `port` | `47170` | arquivo |
| `bind` | `"127.0.0.1"` | arquivo ([Para hospedar](#para-hospedar)) |
| `localAuth` | `""` (`"exigir"` liga a autenticação) | arquivo |

Lidas só do arquivo e fora da tabela (`CHAVES_SO_DE_ARQUIVO`): `instanciaIsoladaPosta` e
`aguardarMergeavelParaRevisar` (ligada salvo `false` explícito: PR em conflito com a base
não abre sessão automática, `lib/engine/espera-conflito.js`).

**CI obrigatório antes da aprovação** (`aguardarCiParaAprovar`, lida só por
`aguardaCiParaAprovar` em `lib/engine/gate-espera.js`). Ligada, a aprovação espera os checks
obrigatórios verdes no commit revisado. Desligada (padrão), o estado do CI não segura nem
adia a decisão.
**Só é seguro desligar onde o check é obrigatório no ruleset**: sem isso, o Farol pode aprovar com o CI vermelho
e o GitHub não barra o merge. Detalhe em
[`REVIEW-GATES.md`](REVIEW-GATES.md).

**Paralelismo.** `parallelReviews` é o limite de revisões simultâneas da conta;
`globalParallelReviews` é o teto da instância inteira, e 0 deixa só o limite da conta. Com
uma conta por instância, vale o menor dos dois quando o teto total está ligado.

## Modelo e esforço das sessões autônomas

`reviewModel` e `reviewEffort` viram as flags `--model` e `--effort` da linha headless
(`claude -p`). São os únicos valores de configuração que entram numa linha de comando
montada por concatenação e passada ao `/bin/sh -lc`, então a defesa é allowlist, nunca
escaping (`sanitizeClaudeModel` e `sanitizeClaudeEffort` em `lib/parse.js`), aplicada em três
lugares: no construtor da `Engine` (config editada à mão; inválido vira `""`), no
`updateSettings` (inválido mantém o valor anterior) e de novo em `buildModelFlags`
(`lib/engine/session.js`), que é o único ponto que monta a flag e é pura. Com o stub de
testes (`FAROL_HEADLESS_CMD`) ela devolve vazio.

**Modelos** (o catálogo é `SELECOES_CLAUDE`, em `lib/modelos.js`): `""` (padrão do CLI),
`auto`, `best`, `opus`, `sonnet`, `fable`. Haiku e qualquer nome com `haiku` são recusados
(`MODELO_FRACO`), inclusive pelo nome completo; config antiga com ele cai no padrão. Nome
completo no formato `claude-...` escrito à mão no arquivo é aceito (`MODEL_FULL_RE`), como
escotilha para modelo novo, mas não aparece no seletor.

**`auto` é do Farol, não do CLI.** O roteador (`lib/engine/model-router.js`) revisa todo PR
com o Opus no esforço herdado e sobe para `--effort xhigh` em repositório crítico, caminho
sensível ou PR muito grande (`AUTO_POR_FAIXA` e `AUTO_POR_CONTEXTO` em `lib/modelos.js`; a
lista de contexto é `autoOpus`). `buildModelFlags` nunca manda `--model auto`, e fora da
revisão roteada o Auto deixa modelo e esforço no padrão do CLI.

Ficam fora de propósito: `opusplan` (o `claude -p` não tem plan mode), `default`
(indistinguível de `""`) e `opus[1m]` ou `sonnet[1m]` (colchete é glob para o `/bin/sh`).

**Esforço:** `low`, `medium`, `high`, `xhigh`. `max` fica fora, porque a revisão headless roda
sem ninguém olhando e com prazo. `effortForModel` só tira o esforço quando o catálogo diz que
a família não aceita. Com `reviewFast` ligado, a revisão usa `medium`, salvo `low` explícito.

Não há modelo nem esforço por conta: a instância tem uma conta só.

## Perfis do Claude

O motor roda o Claude Code com um perfil de `config.claudeProfiles`, saneado por
`normalizeClaudeProfiles` (`lib/parse.js`). Há dois tipos, e só eles:

| tipo | forma | o que a sessão recebe |
|---|---|---|
| assinatura | `{ id, label, kind: "dir", dir }` | `CLAUDE_CONFIG_DIR` com a pasta do perfil, e nenhuma chave |
| chave de API | `{ id, label, kind: "apikey", apiKey, baseUrl }` | `ANTHROPIC_API_KEY` e, se houver, `ANTHROPIC_BASE_URL`; nenhuma pasta |

`baseUrl` é opcional e serve para qualquer endpoint compatível com a API de Mensagens da
Anthropic. Chave, endereço e pasta passam por `sanitizeClaudeDir`: valor com aspa dupla ou
quebra de linha no meio rejeita o perfil inteiro, porque vira valor de variável de shell.

Nos dois tipos o ambiente do processo filho é limpo antes: `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN` e `CLAUDE_CONFIG_DIR`
herdados do motor nunca chegam à sessão (`applyClaudeAuthEnv`), e a linha do shell repete a
limpeza depois do profile do usuário (`claudeAuthPosixPrefix`). Travado em
`test/assinatura-ambiente-do-filho.test.js`.

### Qual perfil a sessão usa

`authDaConta` (`lib/engine/perfil-claude.js`): o perfil padrão (`claudeProfileId`), se ele
resolver; senão o primeiro perfil utilizável da lista; senão nenhum, e a sessão não abre. O
motor não troca de perfil sozinho. Quando o plano chega ao limite, a fila espera a hora do
reset no mesmo perfil, sem estacionar e sem abrir sessão; sem hora informada, espera uma hora
e tenta de novo (`aposLimite` em `lib/engine/limite-plano.js`, registro em
`state/limite-plano.json`). Uma sessão que dá certo libera o perfil antes. O clique manual
atravessa a espera.

`problemasDePerfil` aponta o `claudeProfileId` que não existe ou não resolve, e a tela e o
Diagnóstico mostram.

### Onde a pasta do perfil de assinatura mora

Dentro do HOME do Farol, porque no container só esse volume persiste. Com `dir` vazio, que é
como a tela cria o perfil, a pasta é `~/.farol/claude/<id>` (`CLAUDE_PERFIS_DIR` em
`lib/paths.js`), e o id precisa caber em `[A-Za-z0-9_-]`, até 64 caracteres. Pasta informada
só vale pelo arquivo, absoluta, dentro do HOME do Farol e fora do workspace das sessões
(`pastaDoPerfil` em `lib/engine/pasta-do-perfil.js`); fora disso o perfil não resolve e
aparece como inválido. A pasta que chega pela tela é descartada: `POST /api/settings` mantém
a que já está no arquivo (`semPastaDaTela`). O login cria a pasta com modo 0700.

### A chave de API nunca sai do motor

`lib/engine/chave-do-perfil.js`, travado em `test/chave-de-api-nao-sai.test.js`:

- Para fora (snapshot, SSE e resposta de `POST /api/settings`), o perfil de chave leva só
  `temChave`, um booleano, nunca o valor nem um pedaço (`configParaFora`).
- Salvar pela tela sem redigitar a chave, ou com a chave vazia, mantém a guardada
  (`comChaveGuardada`). `temChave` que venha no corpo não é gravado.
- Mudar o endereço (`baseUrl`) de um perfil que já tem chave exige digitar a chave de novo no
  mesmo salvar: sem ela, o salvar inteiro é recusado com `chave_exigida` e a lista dos perfis
  (`recusaDoEndereco`). Espaço, aspas em volta e barra final não contam como mudança.
- Perfil novo de chave sem chave é descartado como incompleto.
- Para apagar a chave, remove-se o perfil.

### Login pela tela

O motor não tem terminal. Em Sistema > Plano e chaves, o botão Entrar com a assinatura do
cartão do perfil chama `POST /api/claude/login-web/start`: o motor roda `claude auth login`
na pasta do perfil e devolve o link de autorização. A pessoa abre o link em qualquer máquina,
entra com a conta do plano e cola na tela o código que a página da Anthropic mostra;
`POST /api/claude/login-web/code` entrega o código à entrada padrão do Claude Code, e saída 0
é login feito. `POST /api/claude/login-web/cancel` encerra, pelo `loginId` ou pelo
`profileId`.

- Um login por vez no motor, aberto por no máximo dez minutos. O segundo pedido é recusado com
  `login-em-curso` e diz de qual perfil é o login aberto.
- O código é credencial de uso único: vai só para o stdin do CLI e não aparece em log, estado,
  snapshot nem aviso. A rota do código é da classe `recebe-segredo`
  (`lib/local-auth/inventario.js`), e o motivo de uma recusa volta sem o link e sem o código.
- Perfil de chave de API não entra por login (`sem-login`).
- A saída ordenada do motor encerra o login em curso.

Módulo `lib/engine/login-web.js`, travado em `test/login-web.test.js` e
`test/login-web-http.test.js`. O login que dá certo de ponta a ponta não foi medido com um
Claude Code real neste repositório.

### Perfil sem login não é perfil pronto

O perfil de assinatura só conta como pronto com o arquivo `.credentials.json` na pasta; o
motor confere que ele existe e nunca o abre (`temCredencial` em
`lib/engine/perfil-assinatura.js`). Sem ele, o check Claude Code de Sistema fica vermelho
dizendo que falta login (`prontidaoDoPerfil`), e a sessão é recusada antes de abrir o processo
(`recusaSemLogin`), na classe permanente `sem-perfil-de-chave` de `lib/log-taxonomy.js`: a
revisão estaciona com o motivo em vez de relançar a cada ciclo. Login vencido com a credencial
ainda na pasta só aparece quando a sessão roda (classe `oauth-expirado`, também permanente) e
na validade mostrada no cartão. Travado em `test/assinatura-sem-login.test.js`.

### Testar perfil

`POST /api/claude/profile-test` (`testarPerfil`). No perfil de assinatura, roda
`claude auth status --json` contra uma cópia efêmera da configuração da pasta, com a
credencial lida da pasta original, e não grava nada nela (`rodarNaCopia`). No perfil de chave
de API só confere a forma, porque validar a chave exigiria uma chamada paga. O nome comercial
do plano nunca é informado.

### Uso do plano e validade do login

Cada perfil de assinatura mostra no cartão quanto de cada janela do plano já foi usado
(sessão, semana e semana por modelo), quando cada uma volta e quando o login deixa de se
renovar sozinho (`lib/engine/uso-do-plano.js`, tela em `ui/pure/uso-do-plano.js`, teste em
`test/uso-do-plano.test.js`). Perfil de chave de API não entra.

- A fonte é `claude -p "/usage" --output-format json`, que não chama modelo. O motor lê com
  cache de cinco minutos, uma leitura por vez, contra a cópia efêmera da configuração.
- A validade vem do campo `credential_expires_at`. Renovar o token de acesso não a estende:
  a data mostrada é a de refazer o login.
- Toast quando faltam três dias e de novo no último dia, uma vez por faixa; login vencido
  aparece em vermelho. Renovar é entrar de novo pelo botão do perfil.
- Quando o CLI não responde, a última leitura boa fica na tela por até uma hora, marcada como
  desatualizada.
- O percentual é informação, não gate: a fila só espera quando o plano chega ao limite. O
  texto do uso é em inglês e não é contrato do Claude Code; se mudar, a tela diz que o uso não
  foi lido.

A leitura dentro do container não foi medida com um Claude Code real neste repositório.

### Orçamento por perfil

Cada perfil, dos dois tipos, aceita teto em dólar: `budgetDaily`, `budgetTotal` (contado a
partir de `budgetSince`, `YYYY-MM-DD`), `budgetByWeekday` (`"0"` domingo a `"6"` sábado) e
`budgetDates` (por data). O teto do dia sai de `dailyCapFor` (`lib/engine/usage.js`): data
única vence dia da semana, que vence o teto base. `0` é teto válido; campo ausente é sem teto.
Estourar pausa a revisão automática (`budgetBlockedFor`); o clique manual atravessa.

## Avaliação técnica dos PRs revisados

A avaliação técnica de cada PR revisado usa a cópia da BIUD do catálogo de regras,
`eng-behaviour`. O pino está em `lib/technical-review/tool.json`: origem
`https://github.com/biudtech/eng-behaviour.git`, um commit fixo e a construção
(`pnpm install --frozen-lockfile` e `pnpm build`).

A instalação é explícita: `node lib/technical-review/setup.js`, opcionalmente com
`--source <origem>`. Ela clona a origem, faz checkout do commit, constrói, confere e só então
troca a pasta em `~/.farol/toolchains/eng-behaviour@<versão>` (`lib/technical-review/toolchain.js`).
O repositório é privado da organização: no servidor, o `git clone` precisa da credencial de
uma conta com acesso a ele, e o `pnpm` precisa estar instalado.

Esse nome `eng-behaviour` aqui é só a ferramenta que avalia os PRs revisados
(`lib/technical-review/`). O motor não roda mais a doutrina como gate do próprio repositório.

## Jira

O Farol lê cards de vários Jiras e escolhe o site pela organização do GitHub dona do PR. Há
um cliente REST em Node puro e um servidor MCP local (`tools/jira-mcp.js`): a sessão sobe com
`--mcp-config` apontando para o MCP do Farol mais `--strict-mcp-config`, que desliga os
outros (`mcpArgsFor` em `lib/engine/jira.js`). O modelo chama `getJiraIssue` e
`searchJiraIssuesUsingJql`, já apontados para o site certo.

**Decisões fechadas (não reabrir sem motivo novo):**

1. **A chave do mapeamento é a organização do GitHub, não a conta.** Uma conta cobre várias
   organizações, que podem ter Jiras diferentes.
2. **Sem site de reserva.** Organização sem site cadastrado é card não verificável, nunca "tenta
   o site padrão". Ler o Jira errado é pior do que não ler.
3. **Modelo híbrido.** O Farol pré-busca o card e expõe a ferramenta escopada, porque parte das
   chamadas do modelo é investigação própria (card ligado, JQL).
4. **A credencial é e-mail e API token do Atlassian, por site**, em
   `~/.farol/jira-credentials.json`, fora do `config.json`. É o formato que funciona headless e
   para quem é convidado numa organização que não administra.
5. **O segredo nunca passa por linha de comando.** O `--mcp-config` leva só o id do site; o
   servidor MCP lê a credencial do disco.
6. **`--strict-mcp-config` só entra quando existe pelo menos um site.** A partir do primeiro
   site o Farol assume todos os MCPs da sessão, inclusive quando a organização daquele PR não
   tem site: deixar outro conector vivo faria o modelo ler o Jira de outra empresa.
7. **Card ilegível força `cardMet = false`.**
8. **Recurso desligado não é card ilegível.** Com `jiraSites` vazio o código é `desligado`, que
   não loga, não etiqueta, não injeta bloco no prompt e não mexe no `cardMet`; sem isso, quem
   nunca ligou o recurso perderia a aprovação automática.
9. **O conteúdo do card é dado, não instrução.** O texto entra delimitado e rotulado, e as
   marcas do delimitador são removidas do conteúdo antes.

**A tela.** Jira é seção própria de Sistema (`sys-jira`, `ui/telas/sistema-jira.js`): o
mapeamento organização para host no topo, a credencial em bloco próprio e o aviso de que o
primeiro site muda os MCPs da sessão.

**Testar o site** (`POST /api/jira/test`, `testarSite` em `lib/engine/jira.js`, testes em
`test/jira-teste-site.test.js`) prova o site sem esperar PR, por `/rest/api/2/myself`:
qualquer credencial válida responde, então falha ali é credencial ou URL, nunca permissão em
projeto. A recusa leva `motivo` junto do `code`, que vem da tabela de `lib/jira/errors.js`.
Erro cru do fetch chega como `indisponivel` (`comoJiraError` em `lib/jira/client.js`).

**Pegadinhas já pagas (todas com teste):**

- O namespace do cache (`lib/jira/cache.js`) leva o tamanho do id na frente, porque o
  saneamento achata ponto em underscore e dois pares id e host diferentes cairiam na mesma
  pasta. O namespace é id e host juntos.
- A tela recusa site inválido; o servidor não o descarta em silêncio.
- A config de "sem site" usa um nome que id nenhum produz (`sem.site.json`).
- `fields` como lista não é card: o Jira responde 200 com envelope de erro.
- O protocolo do workspace instrui o caso da seção de card ausente e não promete escopo em
  caminho não escopado.

## Padrões do time na revisão

O campo `padroesRevisao` da conta, editado em Sistema > Contas, entra na revisão como critério
de leitura: padrões de projeto preferidos, camadas, nomes, o que evitar. Quando o código se
afasta de um deles, o apontamento sai como sugestão citando o padrão; desvio de padrão só
bloqueia quando também é defeito pelo protocolo (`lib/engine/padroes-do-time.js`, teste em
`test/padroes-do-time.test.js`).

- **Onde fica:** na conta, no `config.json`. Não fica no workspace porque o protocolo do
  workspace é regravado a cada boot.
- **Como entra:** delimitado e rotulado como dado, no molde do card do Jira. Não muda o
  protocolo, os critérios de aprovar sozinho nem a política da conta. Segredo colado por engano
  sai mascarado; o prompt leva até 6.000 caracteres (o resto é cortado com aviso) e a conta
  guarda até 20.000 (`normalizarPadroes`).
- **Regras do repositório:** a revisão também lê o que o repositório revisado declara
  (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING`, ADRs) e cita a regra que embasou cada cobrança. Se
  uma regra do repositório conflita com um padrão do time, vale a do repositório naquele PR.

A memória de rodadas é configurada por `reviewRoundsMode`: `observe` é o padrão e só exibe as
comparações; `enforce` liga os gates de rodada (`roundGap` em
`lib/engine/approval-policy.js`). O campo não troca a política de publicação da conta. Veja
[`REVIEW-GATES.md`](REVIEW-GATES.md), memória de achados entre rodadas.

## Fontes versionadas e contexto controlado

A revisão pode preparar fontes autorizadas pelo GitHub sem checkout pessoal ou declaração de
perfil técnico. O manifesto separa H (head analisado), B (ponta da base)
e M (merge-base). Paginação, quantidade e estabilidade do PR são conferidas; ausência de
patch não retira o arquivo do escopo. Consulta adicional de árvore, texto ou arquivo usa
o mesmo manifesto e revalida a conta e o acesso ao repositório. Nunca substitui um SHA
indisponível pela branch atual. O caminho anterior continua disponível quando a aquisição
falha, com cobertura e limitações próprias, sem inventar leitura.

O cache fica em `~/.farol/source-cache/`, separado do material temporário. O isolamento
inclui host, conta e identidade do repositório. Objetos Git são compartilhados somente
nesse escopo, com leases e referências por consumidor; materializações continuam separadas.
Binários e segredos reconhecidos não entram no cache textual. Nenhum filtro garante
reconhecer todos os segredos possíveis em código; fontes continuam dados não confiáveis.

As opções avançadas abaixo pertencem ao `config.json`, com os valores padrão do código
(`DEFAULT_LIMITS` em `lib/review-context/map.js`, `DEFAULTS` em `lib/review-source/contract.js`).
Mescle os campos, sem substituir o arquivo, e reinicie o motor.

```json
{
  "reviewContextMode": "off",
  "reviewContextTokens": 3000,
  "reviewContextLimits": { "files": 600, "bytes": 8388608, "fileBytes": 262144, "timeMs": 30000, "depth": 2, "paths": 120 },
  "sourceCacheLimits": { "maxBytes": 2147483648, "reserveBytes": 536870912, "globalMaxBytes": 4294967296, "globalReserveBytes": 1073741824, "acquisitionReserveBytes": 16777216, "monitorIntervalMs": 250, "concurrency": 1, "maxQueued": 8 }
}
```

`off` preserva a seleção anterior e não cria o mapa. `observe` levanta o mapa e registra
métricas sem injetar a seleção no prompt. `assist` permite a seleção adicional, com orçamento
estimado em caracteres/4, sem afirmar tokens faturados ou qualidade da decisão do modelo.
Regras e blockers obrigatórios ficam fora desse orçamento e não são retirados para caber.
Se o mapa falhar ou ficar incompleto em assist, não se herda validade de análise apenas
porque o blob não mudou. Conteúdo disponível, leitura observada e análise válida são fatos
distintos. Nenhum desses modos muda os gates ou a política de publicação da conta.

O parser `@babel/parser` 7.28.5 roda em worker limitado, sem ligar ou executar
o código do projeto. O artefato oficial autocontido, a licença e os hashes ficam em
`assets/third-party/babel-parser/`, sem depender de `node_modules`.
JS, TS, JSX, TSX, imports de tipos e reexports têm relações sintáticas. Isso não constitui
resolução semântica de props, bindings ou chamadas. CommonJS, aliases e dependências
dinâmicas conservam confiança e limitações explícitas. Sintaxe não suportada amplia a
investigação textual, sem excluir silenciosamente arquivos. JSONC/extends e resoluções
não suportadas nunca provam ausência de uso. O cache de 4 MiB contabiliza apenas a
serialização das análises retidas, não a memória total do worker ou do processo.
Relações são reconstruídas para H/M e configuração.
O orçamento de tempo do levantamento é verificado entre leituras; cada consulta de rede
também tem seu timeout próprio. Não representa prazo máximo rígido de ponta a ponta.

O limite de 2 GiB por escopo é coordenado com orçamento global lógico de 4 GiB e piso
global livre de 1 GiB. Reservas duráveis coordenam admissões simultâneas; aquisição
desconhecida é monitorada e interrompida quando o orçamento deixa de ser atendido.
Objetos, Git, temporários, metadados e materiais ativos ou pendentes entram na medição.
Legados são observados separadamente, sem remoção nem inclusão retroativa no teto de
4 GiB. O limite é lógico e amostrado; não promete overshoot físico zero. Material ativo
nunca é eliminado para cumprir quota. Estado incerto adia o trabalho. Veja
`docs/SOURCE-STORAGE.md` para contabilização, precisão e exclusões. Os dados de capacidade não
fazem uma varredura global por atualização da interface.

Materiais técnicos novos têm manifesto de propriedade e consumidores. A coleta é
assíncrona, limitada e independente da próxima review. Falha de remoção tem retry;
abort sem confirmação de término preserva o material. Diretórios legados sem manifesto
permanecem pendentes de diagnóstico. Evidências e resultados duráveis não são cache.
Após reinício, coleta de preparação interrompida exige decisão final correspondente
ao PR/head/conta e prova de término dos processos, sem referência ativa, fila ou
retomada. Sem desfecho comprovado, o material permanece preservado para diagnóstico.

Para desfazer a seleção, volte `reviewContextMode` para `off`. Voltar o motor a uma versão
anterior deve esperar os consumidores terminarem e não apagar estado, checkpoints, resultados
ou diretórios novos desconhecidos.

## Para hospedar

O motor hospedado roda num container Linux atrás de um proxy. Seis pontos, cada um conferido
no código.

### 1. `localAuth: "exigir"` é obrigatório

`exigeAutenticacao` (`lib/local-auth/modo.js`) só exige autenticação em dois casos:
`localAuth: "exigir"` no `config.json`, ou `bind` fora do loopback (`loopback` em
`lib/http-guard.js`: ausente, `127.0.0.1`, `localhost` e `[::1]` contam como loopback). **Com
o motor em loopback atrás de um proxy na mesma máquina, a autenticação não é exigida por
padrão**, e quem alcança o proxy alcança a API inteira. Grave `"localAuth": "exigir"`; a
chave é só de arquivo, porque uma página sem credencial não pode ligar nem desligar a própria
proteção.

Com a autenticação exigida, todo `/api/*` pede `Authorization: Bearer <token>`, exceto
`POST /api/auth/pair` e `GET /api/auth/status` (`lib/local-auth/acesso.js`). Para obter o
token:

1. No próprio container, com o mesmo `FAROL_HOME` do motor: `node tools/farol-parear.js`. Ele
   imprime no terminal um código de uso único, válido por dez minutos.
2. A tela pede o código e chama `POST /api/auth/pair` com `{ "codigo": "...", "rotulo": "..." }`;
   a resposta traz o token só no corpo, sem cookie, e a página o guarda no navegador.
3. A sessão vence com 30 dias sem uso ou 90 dias depois de emitida. Em disco fica só o hash,
   em `~/.farol/local-auth/`.

`node tools/farol-parear.js --revogar-todas` revoga todas as sessões e códigos. Um stream SSE
aberto é cortado quando a credencial dele é revogada.

### 2. O que o proxy manda no Host e no Origin

A allowlist de `lib/http-guard.js` (`validarHostEOrigem`) roda antes de qualquer rota, com a
porta efetiva do socket. Com o `bind` em loopback, o Host aceito é só `127.0.0.1:<porta>` ou
`localhost:<porta>`, por igualdade exata (com `bind: "[::1]"`, também `[::1]:<porta>`, e a
origem `http://[::1]:<porta>`). O `Origin` ausente passa; presente, precisa ser
`http://127.0.0.1:<porta>` ou `http://localhost:<porta>`. Recusa é
`403 { error: "forbidden", motivo: "host" | "origin" }`.

Então o proxy precisa reescrever o Host para `127.0.0.1:<porta>` e retirar (ou reescrever) o
`Origin` que o navegador manda com o domínio público, senão os `POST` da tela voltam 403. Host
permitido não é autenticação: por isso o item 1.

Com `bind` fora do loopback, o Host `<bind>:<porta>` e as origens `http://<bind>:<porta>` e
`https://<bind>` também passam, e a autenticação passa a ser exigida sozinha. `sanearBind`
(`lib/parse.js`) aceita IPv4, IPv6 entre colchetes ou nome de host em caixa baixa; o resto
volta para `127.0.0.1`. `bind` e `port` são só de arquivo e valem depois de reiniciar.

### 3. A sessão de revisão alcança a credencial da assinatura

A sessão do Claude Code roda como o mesmo usuário do motor e com `CLAUDE_CONFIG_DIR` na pasta
do perfil, então a credencial da assinatura (`.credentials.json`) está ao alcance dela por
comando de shell. As guardas que o motor passa à sessão de revisão
(`workspace-template/.claude/guardas.json`, por `--settings`, `lib/engine/guardas-da-sessao.js`)
negam:

- `Read(**/.credentials.json)`, a leitura direta pela ferramenta Read;
- `Bash(*.credentials.json*)`, comando de shell cujo texto contém `.credentials.json`;
- e, à parte da credencial, `gh pr diff`, os arquivos do PR por `gh api`, tarball, zipball,
  diff e patch por `gh api`, `gh repo clone` e `git clone`.

Comando que chega ao arquivo sem escrever esse nome (curinga, variável, outra ferramenta) não
casa a guarda. `lib/engine/leitura-sensivel.js` só registra a leitura pela ferramenta Read e
não bloqueia nada. Trate a credencial como acessível a qualquer PR revisado.

### 4. Remover um perfil não apaga a pasta dele

Nenhum código do motor apaga `~/.farol/claude/<id>`. Remover o perfil de assinatura tira o
perfil da configuração, e a pasta, com o login dentro, fica no volume. Apague-a à mão. Um
perfil novo com o mesmo id reaproveita a pasta e o login que estiverem lá.

### 5. `FAROL_HOME` e o usuário do container

`FAROL_HOME` troca o HOME do Farol. Fora de `~/.farol`, ele liga a instância isolada
(`instanciaIsolada` em `lib/paths.js`): toda escrita no GitHub (review e label) é
recusada com `blocked: "instancia_isolada"`, salvo
`"instanciaIsoladaPosta": true` no `config.json` (`lib/engine/instancia-isolada.js`). Por isso
no container o HOME do Farol fica no padrão, `~/.farol` do usuário que roda o motor, e é essa
pasta que vai no volume persistente. A variável `FAROL_UPDATE_MANAGER=external` também tira a
instância da condição de isolada.

Não rode o motor como root: o Claude Code recusa `--dangerously-skip-permissions` com uid 0,
e a revisão headless sempre passa essa flag (classe permanente `skip-permissions-root` em
`lib/log-taxonomy.js`).

### 6. Imagem nova com volume antigo

O workspace mora no volume (`~/.farol/workspace`), e o boot regrava nele cinco arquivos do
protocolo: `CLAUDE.md`, `prompts/pr-review-auto.md`, os dois agentes e
`.claude/commands/pr-review.md` (`prepareHome`, `server.js`). Ele também copia o prompt do
template que faltar em `prompts/`, sem sobrescrever o que existe. O `.claude/settings.json` é copiado
uma vez, quando o workspace nasce, e nunca mais: mudança nele numa imagem nova não chega a um
volume que já existe, e precisa ser aplicada à mão no volume. O `.claude/guardas.json` não tem
esse problema, porque a sessão o lê direto da imagem.
