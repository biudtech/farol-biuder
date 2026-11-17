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

### A conta se edita por operação

`POST /api/accounts/edit` aplica uma operação sobre a conta que o motor tem (`aplicarEdicao` e
`editarConta` em `lib/engine/contas-config.js`). O corpo tem sempre `user`, o login da conta
revisora: sem ele a resposta é `{ "ok": false, "erro": "conta sem login" }`, e com outro login,
`a conta @x não é a conta deste Farol`. Há dois tipos; outro valor de `tipo` responde
`operação de conta desconhecida`.

| `tipo` | Campos | O que faz |
|---|---|---|
| `"editar"` | `campos`: um objeto com `owners`, `autoReview`, `onClean`, `onCaveats`, `onReject` ou `padroesRevisao` (`CAMPOS_EDITAVEIS`) | Troca só os campos que vieram; `owners` troca a lista inteira. Campo vazio apaga o valor, e a gravação repõe o padrão nos quatro da política. Campo desconhecido ou valor fora do domínio volta em `ignorados`, sem virar o padrão |
| `"regra-review"` | `organization` (obrigatório), `author` (opcional) e `mode`: `auto`, `manual` ou `inherit` | Grava a regra da organização, ou a do autor dentro dela (`editarRegra`, `lib/engine/review-scope.js`); `inherit` remove só a regra escolhida. Organização ou autor fora do formato, ou `mode` desconhecido, é recusa com `erro` |

A resposta de sucesso é `{ "ok": true, "ignoradas": [], "ignorados": [...] }`, sem a conta
gravada: confira no estado. Mudar as organizações dispara uma checagem na hora. Com as
variáveis de [Chamar a API sem tela](#chamar-a-api-sem-tela):

```sh
# a política: com ressalvas passa a esperar você
curl -sS -X POST "$FAROL/api/accounts/edit" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
  --data '{"tipo":"editar","user":"login-da-conta","campos":{"onCaveats":"wait"}}'

# uma regra de review: o autor joao, da organização acme, é revisado sozinho
curl -sS -X POST "$FAROL/api/accounts/edit" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
  --data '{"tipo":"regra-review","user":"login-da-conta","organization":"acme","author":"joao","mode":"auto"}'

# os padrões do time, lidos de um arquivo de texto
jq -Rs '{tipo: "editar", user: "login-da-conta", campos: {padroesRevisao: .}}' < padroes.txt \
  | curl -sS -X POST "$FAROL/api/accounts/edit" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" --data @-
```

No front, a seção Conta revisora e política da tela Sistema edita as organizações e os quatro
campos da política. `padroesRevisao` e as regras de review não têm campo lá: mudam pela API,
como acima, ou pelo arquivo.

Toda mudança de política vai a `state/politica-historico.json` (dentro do workspace), com
data e origem, até 200 entradas. A origem de um pedido pela API é `navegador` sempre que ele
traz `User-Agent`, inclusive o de um `curl` (o motor não distingue os dois), e `desconhecida`
quando não traz (`origemDaRequisicao`). As outras são `migração` (a carga de uma config
antiga) e `detecção do gh`; registro antigo pode trazer `janela do Farol`. O motivo "a
política manda aguardar" no card diz quando e de onde veio a configuração que segurou
(`motivoDaPolitica`), e o diagnóstico (`GET /api/diagnostics`) lista as mudanças recentes.

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
- Perfil do Claude que não é `dir` nem `apikey` sai, e do perfil que fica saem os campos de
  teto de gasto (`budgetDaily` e os outros quatro), que não têm mais leitor.
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
- Manual permite a revisão pedida por clique e impede a revisão automática, inclusive a retentativa
  automática (`bloqueioDeInicio`).
- PR sem organização ou sem autor conhecido, quando há regra que dependeria dele, conta como
  manual.
- A edição é pontual: mexer numa regra não regrava as outras nem a política de publicação, e
  "herdar" (`inherit`) remove só a regra escolhida.

Aprovar e pedir mudanças continuam obedecendo a `onClean`, `onCaveats` e `onReject`.

## Preferências do config.json

A tabela única é `SETTINGS`, em `lib/settings.js`: chave, padrão, se a API aceita (`ui`) e o
saneador. `POST /api/settings` aceita só as chaves com `ui: true` e devolve as outras em
`ignoradas`. "Sistema" e "Time" na coluna abaixo são as telas do front (`web/`); "API" é
`POST /api/settings` chamado à mão ([como chamar](#chamar-a-api-sem-tela)), e "arquivo" é o
`config.json`, com o motor parado. Chave marcada `omitirPadraoAoGravar` não é escrita no arquivo enquanto estiver
no padrão.

| chave | padrão | onde se muda |
|---|---|---|
| `conta` | `null` | Sistema (política e organizações, por `POST /api/accounts/edit`) e o arquivo ([acima](#a-conta-revisora-e-a-política)) |
| `aguardarCiParaAprovar` | `false` | Sistema, "CI obrigatório antes de aprovar" |
| `parallelReviews` | `1` (1 a 4) | Sistema, "Revisões ao mesmo tempo" |
| `reviewModel`, `reviewEffort` | `""` | Sistema ([modelo e esforço](#modelo-e-esforço-das-sessões-autônomas)) |
| `people` | `{}` | Time |
| `jiraSites` | `[]` | API ou arquivo; Sistema só mostra ([Jira](#jira)) |
| `claudeProfiles`, `claudeProfileId` | `[]`, `""` | API ou arquivo; Sistema só mostra e testa ([perfis](#criar-trocar-e-remover-perfil)) |
| `intervalSeconds` | `300` (180 a 3600) | API ou arquivo |
| `globalParallelReviews` | `0` (0 a 8; 0 = sem teto total) | API ou arquivo; Sistema avisa quando está ligado |
| `reReviewResume` | `true` (retoma a sessão na segunda rodada) | API ou arquivo |
| `reviewFast` | `false` (modo rápido da revisão) | API ou arquivo |
| `aguardarCiParaRevisar` | `false` (espera o CI antes de revisar) | API ou arquivo |
| `autoPushback`, `debugSpawns` | `true`, `false` | API ou arquivo |
| `reviewSingleOutput` | `false` | arquivo |
| `reviewRoundsMode` | `"observe"` (`"enforce"` liga os gates de rodada) | arquivo |
| `reviewContextMode`, `reviewContextTokens`, `reviewContextLimits` | `"off"`, `3000`, `{}` | arquivo ([fontes](#fontes-versionadas-e-contexto-controlado)) |
| `sourceCacheLimits` | `{}` | arquivo |
| `reviewNavigationFacts`, `reviewBatchedReads`, `reviewAgentOwnership` | `false` | arquivo |
| `autoOpus` | `null` (lista do roteador) | arquivo |
| `port` | `47170` | arquivo |
| `bind` | `"127.0.0.1"` | arquivo ([Para hospedar](#para-hospedar)) |
| `localAuth` | `""` (`"exigir"` liga a autenticação; outro valor preenchido impede o boot) | arquivo ([Para hospedar](#para-hospedar)) |
| `hostPublico` | `""` (o nome com que o proxy chega ao motor) | arquivo ([Para hospedar](#para-hospedar)) |
| `origensPermitidas` | `[]` (as origens de onde o front chama a API) | arquivo ([Para hospedar](#para-hospedar)) |

Desde 16/11/2026, quando a tela antiga saiu, sete chaves que ela editava só mudam pela API ou
pelo arquivo: `intervalSeconds`, `globalParallelReviews`, `reReviewResume`, `reviewFast`,
`aguardarCiParaRevisar`, `autoPushback` e `debugSpawns`. Um exemplo:

```sh
# FAROL e CAB: veja "Chamar a API sem tela"
curl -sS -X POST "$FAROL/api/settings" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
  --data '{"intervalSeconds":600,"aguardarCiParaRevisar":true}'
```

`soundEnabled`, `theme` e `autostart` eram da tela antiga (som, tema e abrir com o sistema) e
saíram da tabela em 16/11/2026, porque nada no motor as lia. Num `config.json` antigo elas são
descartadas na carga, sem erro, e somem na próxima gravação; `POST /api/settings` as devolve em
`ignoradas` (`test/preferencias-sem-leitor.test.js`). A carga não regrava o arquivo por causa
delas: ele só é regravado no boot quando a leitura da conta mudou alguma coisa (formato antigo,
chave geral antiga, ou política que não estava com os quatro campos por extenso), e aí elas já
saem nessa gravação (`aoCarregar`, `lib/engine/contas-config.js`). O tema
do front fica no navegador.

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
herdados do motor nunca chegam à sessão (`applyClaudeAuthEnv`). A linha do shell limpa de novo,
depois do profile do usuário (`claudeAuthPosixPrefix`, `lib/parse.js`): no perfil de assinatura
faz `unset` das cinco e reexporta a pasta do perfil; no perfil de chave de API faz só
`unset CLAUDE_CODE_OAUTH_TOKEN`, porque a chave viaja pelo ambiente e repeti-la ali a poria na
linha de comando. Travado em
`test/assinatura-ambiente-do-filho.test.js`.

### Qual perfil a sessão usa

`authDaConta` (`lib/engine/perfil-claude.js`): o perfil padrão (`claudeProfileId`), se ele
resolver; senão o primeiro perfil utilizável da lista; senão nenhum, e a sessão não abre. O
motor não troca de perfil sozinho. Quando o plano chega ao limite, a fila espera a hora do
reset no mesmo perfil, sem estacionar e sem abrir sessão; sem hora informada, espera uma hora
e tenta de novo (`aposLimite` em `lib/engine/limite-plano.js`, registro em
`state/limite-plano.json`). Uma sessão que dá certo libera o perfil antes. O clique manual
atravessa a espera.

`problemasDePerfil` aponta o `claudeProfileId` que não existe ou não resolve; a seção Saúde
da tela Sistema e o diagnóstico (`GET /api/diagnostics`) mostram.

### Onde a pasta do perfil de assinatura mora

Dentro do HOME do Farol, porque no container só esse volume persiste. Com `dir` vazio, que é
como o perfil criado pela API nasce, a pasta é `~/.farol/claude/<id>` (`CLAUDE_PERFIS_DIR` em
`lib/paths.js`), e o id precisa caber em `[A-Za-z0-9_-]`, até 64 caracteres. Pasta informada
só vale pelo arquivo, absoluta, dentro do HOME do Farol e fora do workspace das sessões
(`pastaDoPerfil` em `lib/engine/pasta-do-perfil.js`); fora disso o perfil não resolve e
aparece como inválido. A pasta que chega pela API é descartada: `POST /api/settings` mantém
a que já está no arquivo (`semPastaDaTela`). O login cria a pasta com modo 0700.

### Chamar a API sem tela

O que não tem tela se faz por `curl`, de uma máquina que alcance o motor. Os exemplos deste
guia usam `bash`, `curl` 7.55 ou mais novo, `jq` e duas variáveis:

```sh
FAROL=http://127.0.0.1:47170       # hospedado: https:// e o hostPublico
CAB="$HOME/.farol-cabecalho"       # o cabeçalho de autorização, num arquivo só seu

# 1. no servidor do motor, com o FAROL_HOME dele: gera um código (dez minutos, uma vez só)
node tools/farol-parear.js

# 2. troca o código pelo token e guarda o cabeçalho pronto no arquivo, com modo 600
read -rs -p 'Código de pareamento: ' CODIGO; echo
( umask 077
  printf '%s' "$CODIGO" | jq -Rs '{codigo: ., rotulo: "terminal"}' \
    | curl -sS -X POST "$FAROL/api/auth/pair" -H "x-farol: 1" -H "Content-Type: application/json" --data @- \
    | jq -r 'if .ok then "Authorization: Bearer \(.token)" else empty end' > "$CAB" )
unset CODIGO
[ -s "$CAB" ] || echo 'pareamento recusado: gere outro código'

# 3. uma chamada autenticada
curl -sS "$FAROL/api/state" -H @"$CAB" | jq '{status, conta: .account.user}'
```

`POST /api/auth/pair` recebe `{ "codigo": "...", "rotulo": "..." }` e responde
`{ "ok": true, "token": "..." }`; a recusa é uma só, `{ "ok": false, "code": "codigo_invalido" }`,
e nesse caso o arquivo fica vazio. O token é uma sessão como a do navegador: aparece em
Sistema, em Sessões pareadas, com o rótulo dado, e se revoga por lá. Todo `POST` leva
`x-farol: 1`. Com a autenticação desligada (motor só em loopback, sem `localAuth`), o
`-H @"$CAB"` é dispensável.

**Segredo não vai na linha de comando.** O argumento de um comando fica visível para os outros
usuários da máquina na lista de processos (`ps`) enquanto o comando roda, e o comando digitado
fica no histórico do shell. O que cada parte dos exemplos faz, e o que não faz:

- `read -rs` lê o segredo do teclado sem eco. Ele não é digitado como comando, então não vai ao
  histórico. Fica numa variável do shell, que não é exportada (processo filho não a herda) e
  é apagada com `unset` logo depois.
- `printf` é comando interno do `bash`: não abre processo, então o segredo não aparece no
  `ps`. Ele sai pelo pipe para a entrada padrão do `jq`.
- `jq -Rs` lê o texto cru da entrada padrão e monta o JSON. Na linha de comando dele só há o
  filtro. Não passe segredo por `--arg`: iria para o `ps`.
- `curl --data @-` lê o corpo da entrada padrão, e `-H @"$CAB"` lê o cabeçalho do arquivo. O
  token nunca é argumento do `curl`. `-H "Authorization: Bearer $TOKEN"` o poria no `ps` a cada
  chamada.
- O arquivo `$CAB` nasce com modo 600 (`umask 077` dentro do subshell): os outros usuários não
  o leem. O seu usuário e o root leem: é o token da sessão em disco, válido até a sessão vencer
  (30 dias sem uso, 90 no total) ou ser revogada. Ao terminar, revogue a sessão em Sistema e
  apague o arquivo.
- Corpo sem segredo (`--data '{"intervalSeconds":600}'`) pode ir na linha de comando.
- Nada disso protege o caminho de rede: fora do loopback, use o endereço `https://` do proxy.

### Criar, trocar e remover perfil

A tela mostra os perfis e testa cada um, mas não cria, não edita e não remove (ela não tem
campo para segredo). Isso se faz por `POST /api/settings` ou pelo `config.json` com o motor
parado. `claudeProfiles` é sempre a **lista inteira**: o perfil que não vier na lista é removido.

```sh
# um perfil de assinatura (a pasta é do motor; o login vem depois, veja abaixo)
curl -sS -X POST "$FAROL/api/settings" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
  --data '{"claudeProfiles":[{"id":"plano","label":"Plano","kind":"dir"}],"claudeProfileId":"plano"}'

# acrescentar um perfil de chave de API: a lista vai com os DOIS, senão o primeiro some.
# A chave vem de um arquivo (chave.txt, modo 600), lido pela entrada padrão do jq; apague-o depois.
jq -Rs '{
    claudeProfiles: [
      { id: "plano", label: "Plano", kind: "dir" },
      { id: "chave", label: "Chave", kind: "apikey", apiKey: rtrimstr("\n") }
    ],
    claudeProfileId: "plano"
  }' < chave.txt | curl -sS -X POST "$FAROL/api/settings" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" --data @-
```

A resposta traz `ok`, as `ignoradas` e a `config` como sai do motor (o perfil de chave só com
`temChave`). Perfil que o saneamento recusa (sem `id`, de chave sem chave, com chave ou
endereço fora da forma) some da lista sem erro: confira `config.claudeProfiles` na resposta.
Perfil de chave que já existe pode ir sem `apiKey`: o motor mantém a guardada. Remover é
mandar a lista sem o perfil. `claudeProfileId` diz qual perfil as sessões usam.

### A chave de API nunca sai do motor

`lib/engine/chave-do-perfil.js`, travado em `test/chave-de-api-nao-sai.test.js`:

- Para fora (snapshot, SSE e resposta de `POST /api/settings`), o perfil de chave leva só
  `temChave`, um booleano, nunca o valor nem um pedaço (`configParaFora`).
- Salvar sem redigitar a chave, ou com a chave vazia, mantém a guardada
  (`comChaveGuardada`). `temChave` que venha no corpo não é gravado.
- Mudar o endereço (`baseUrl`) de um perfil que já tem chave exige digitar a chave de novo no
  mesmo salvar: sem ela, o salvar inteiro é recusado com `chave_exigida` e a lista dos perfis
  (`recusaDoEndereco`). Espaço, aspas em volta e barra final não contam como mudança.
- Perfil novo de chave sem chave é descartado como incompleto.
- Para apagar a chave, remove-se o perfil.

### Login da assinatura pela API

O motor não tem terminal, e a tela não tem o botão de login (a tela antiga tinha; ela saiu em
16/11/2026). O login se faz com três chamadas à API, de qualquer máquina que alcance o motor,
com o Bearer do pareamento e `x-farol: 1`:

1. `POST /api/claude/login-web/start` com `{ "profileId": "<id do perfil de assinatura>" }`.
   O motor roda `claude auth login` na pasta do perfil e responde
   `{ "ok": true, "loginId": "...", "url": "https://..." }`.
2. Abra a `url` num navegador qualquer, entre com a conta do plano e copie o código que a
   página da Anthropic mostra (`<código>#<estado>`).
3. `POST /api/claude/login-web/code` com `{ "loginId": "...", "code": "<o código inteiro>" }`.
   O motor entrega o código à entrada padrão do Claude Code; saída 0 é login feito, e a
   resposta é `{ "ok": true }`.

Com as variáveis de [Chamar a API sem tela](#chamar-a-api-sem-tela):

```sh
# o início: a resposta (loginId e url) fica num arquivo só seu
( umask 077
  curl -sS -X POST "$FAROL/api/claude/login-web/start" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
    --data '{"profileId":"plano"}' > "$HOME/.farol-login" )
jq -r '.url // .motivo' "$HOME/.farol-login"      # abra este endereço no navegador

# o código que a página mostra: do teclado para o corpo, sem passar por argumento
read -rs -p 'Código da página: ' CODE; echo
printf '%s' "$CODE" | jq -Rs --slurpfile l "$HOME/.farol-login" '{loginId: $l[0].loginId, code: .}' \
  | curl -sS -X POST "$FAROL/api/claude/login-web/code" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" --data @-
unset CODE; rm -f "$HOME/.farol-login"
```

O código é credencial de uso único: não o cole na linha de comando.
`POST /api/claude/login-web/cancel` encerra, com `{ "loginId": "..." }` ou
`{ "profileId": "..." }`. Para conferir, `POST /api/claude/profile-test` com
`{ "profileId": "..." }`, ou o teste do perfil na tela Sistema. As recusas voltam com
`ok: false`, um `code` (`sem-login`, `login-em-curso`, `sem-link`, `expirou`,
`codigo-invalido`, `sem-resposta`, `recusado`) e o `motivo`.

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
renovar sozinho (`lib/engine/uso-do-plano.js`, teste em `test/uso-do-plano.test.js`). Perfil
de chave de API não entra.

- A fonte é `claude -p "/usage" --output-format json`, que não chama modelo. O motor lê com
  cache de cinco minutos, uma leitura por vez, contra a cópia efêmera da configuração.
- A validade vem do campo `credential_expires_at`. Renovar o token de acesso não a estende:
  a data mostrada é a de refazer o login.
- Toast quando faltam três dias e de novo no último dia, uma vez por faixa; login vencido
  aparece em vermelho. Renovar é fazer o login de novo ([acima](#login-da-assinatura-pela-api)).
- Quando o CLI não responde, a última leitura boa fica na tela por até uma hora, marcada como
  desatualizada.
- O percentual é informação, não gate: a fila só espera quando o plano chega ao limite. O
  texto do uso é em inglês e não é contrato do Claude Code; se mudar, a tela diz que o uso não
  foi lido.

A leitura dentro do container não foi medida com um Claude Code real neste repositório.

### Sem teto de gasto

O motor não tem teto de gasto (decisão de 16/11/2026): nenhuma revisão automática, nova
rodada, retentativa, recuperação de prova, busca de contestação ou lote é barrada, adiada ou
estacionada por dinheiro. O consumo continua medido e mostrado (`lib/engine/usage.js`,
`GET /api/usage`), com o custo sempre dito estimado; ele só não decide nada.

Um `config.json` antigo pode trazer teto num perfil: `budgetDaily`, `budgetTotal`,
`budgetSince`, `budgetByWeekday` e `budgetDates`. O motor sobe normalmente,
`normalizeClaudeProfiles` (`lib/parse.js`) descarta os cinco campos na carga e o perfil
continua valendo. A carga não reescreve o arquivo por causa deles: eles somem na próxima
gravação da configuração (qualquer salvar de preferência ou de conta). E o PR que estava estacionado por
orçamento num estado gravado antes volta a ser elegível no boot (`estacionamentoDoBoot`,
`lib/engine/estado-do-boot.js`): o motor regrava o `auto-review-parked.json` sem ele e grava
uma linha INFO no `farol.log` com quantos voltaram e quais, uma vez. Travado em
`test/sem-teto-de-gasto.test.js`.

O que continua segurando revisão automática não é gasto medido pelo motor: o limite de uso
da assinatura do Claude (acima), o teto de uso que a organização põe no Claude
(`limite-da-organizacao`, `lib/log-taxonomy.js`: falha permanente, que estaciona o PR até
alguém subir o teto lá ou trocar o perfil), a pausa das buscas pelo limite de requisições do
GitHub e o teto de revisões simultâneas (`parallelReviews` e `globalParallelReviews`).

Efeito para quem opera: a nova rodada por commit não tem contagem diária nem limite de gasto.
O que a segura é a espera de 5 minutos com o head quieto (`HEAD_QUIETO_MS`) e, depois de 3
rodadas presas seguidas (`MAX_RODADAS_PRESAS`, `lib/engine/review.js`), a espera de 30 minutos
(`HEAD_QUIETO_LONGO_MS`). Um autor que empurra commit o dia todo gera rodadas o dia todo.

## Avaliação técnica dos PRs revisados

A avaliação técnica de cada PR revisado usa a cópia da BIUD do catálogo de regras,
`eng-behaviour`. O pino está em `lib/technical-review/tool.json`: origem
`https://github.com/biudtech/eng-behaviour.git`, um commit fixo e a construção
(`pnpm install --frozen-lockfile` e `pnpm build`).

A instalação é explícita: `node lib/technical-review/setup.js`, opcionalmente com
`--source <caminho ou URL>`. Ela clona a origem numa pasta de preparo (`.install-*`, ao lado),
confere que o commit do pino existe nela, faz checkout dele, constrói, grava o carimbo de
construção, confere e só então troca a pasta em `~/.farol/toolchains/eng-behaviour@<versão>`
(`lib/technical-review/toolchain.js`). Pede `git` e `pnpm` no PATH; a imagem do container traz
os dois, com o `pnpm` na versão que o `Dockerfile` fixa.

- **O clone do repositório privado usa o login do `gh`.** Para a origem HTTPS do GitHub (a do
  pino), o clone roda com o `git` isolado do motor e a credencial do `gh`
  (`credential.helper=!gh auth git-credential`), a mesma lista da busca das fontes de revisão
  (`FLAGS_CREDENCIAL_DO_GH`, `lib/git-isolado.js`). O token não vai em argumento, em URL nem no
  log: o `git` o pede ao `gh` na hora. Pré-requisito: a conta logada no `gh` enxerga
  `biudtech/eng-behaviour` (`gh repo view biudtech/eng-behaviour`). Origem com usuário ou
  token na URL é recusada antes de rodar qualquer comando. Caminho local e origem fora do
  GitHub seguem com o `git` comum, sem credencial.
- **Origem com `?` ou `#`** também é recusada antes de qualquer comando, e a mensagem não a
  repete: um token na consulta ficaria na linha de comando.
- **Cada falha diz a causa** (`lib/technical-review/setup-falhas.js`) e sai com código 2: o `gh`
  ausente, sem acesso ao repositório (o `gh` não está logado ou a conta não enxerga o
  repositório), falha de rede no clone, `git` ausente, commit do pino que não existe na origem,
  checkout que não terminou, gerenciador de pacotes ausente, falha de rede no `pnpm install`,
  acesso recusado pelo registro de pacotes (401 ou 403), passo que passou do prazo (dez
  minutos), instalação interrompida (`SIGINT` ou `SIGTERM`) e passo morto por sinal de fora.
  Todo passo roda com `LC_ALL=C`, porque a classificação lê a saída em inglês, e do `pnpm` vale
  o último código `ERR_PNPM_*` da saída. Saída que não casa com nenhuma causa conhecida vira a
  mensagem do passo, com o código de saída (e o `ERR_PNPM_*`, quando há).
- **Uma por vez**: a instalação cria a trava `~/.farol/toolchains/.instalacao.trava` (com o pid e
  a hora) e a solta no fim, com sucesso ou com falha. A segunda instalação que a acha sai com
  código 2 e "outra instalação da ferramenta técnica em curso desde <hora>; se ela morreu, apague
  <arquivo>", sem tocar em nada. Logo antes de trocar a pasta, a instalação confere de novo a do
  lugar: se ela já vale, fica.
- **Idempotente**: instalação válida não é refeita, e o comando sai na hora.
- **Atômica**: a falha em qualquer passo remove a pasta de preparo, e a pasta válida, se havia,
  não é tocada. A instalação morta sem chance de limpar (`SIGKILL` no próprio `setup.js`) deixa
  a pasta de preparo e a trava: apagada a trava, a próxima instalação remove a sobra, porque só
  quem detém a trava limpa e, com ela, nenhuma outra está em curso. Uma
  pasta anterior que deixou de validar (pino trocado no mesmo número de versão) é guardada como
  `eng-behaviour@<versão>.incomplete-<id>` quando a nova fica pronta, e sai só à mão.

Quais repositórios são avaliados vem do cadastro privado,
`~/.farol/technical-review/repositories.json` (`lib/technical-review/profiles.js`). Este
repositório é público e não versiona cadastro real: o exemplo, com um repositório fictício e
cada campo que o motor lê, está em
[`exemplos/repositories.exemplo.json`](exemplos/repositories.exemplo.json), e os campos estão
explicados em [`HOSPEDAGEM.md`](HOSPEDAGEM.md#o-cadastro-dos-repositórios).

O estado das duas partes aparece em `GET /api/doctor`, na chave `avaliacaoTecnica`, e na linha
"Avaliação técnica" de Sistema > Saúde: a ferramenta (instalada e íntegra, ausente ou com
identidade não comprovada, com a versão e o commit do pino) e o cadastro (quantos repositórios
declarados, ausente ou ilegível), com o efeito do que falta. A conferência é o mesmo
`requireTool` que a avaliação usa, e por isso respeita `FAROL_ENG_BEHAVIOUR_HOME` (`lib/env.js`)
quando a variável aponta outra pasta; a instalação grava sempre no lugar padrão. No boot, uma
linha no `farol.log` diz o estado quando ele é anormal (`lib/technical-review/estado.js`), em
`WARN`: repositório declarado sem a ferramenta íntegra, ou cadastro que não abre. Com tudo certo,
ou sem cadastro, não há linha. A linha da tela só muda quando o diagnóstico roda: depois de
instalar ou de trocar o cadastro, use "Rodar o diagnóstico de novo" em Sistema > Saúde.

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

**A tela.** Jira é seção própria de Sistema, só de leitura: mostra os sites, se cada um tem
credencial, e testa a conexão. Site e credencial entram pela API
([como chamar](#chamar-a-api-sem-tela)) ou, no caso dos sites, pelo arquivo.

Um site tem cinco campos (`umSite`, `lib/jira/sites.js`):

| campo | o que é |
|---|---|
| `id` | o nome do site no Farol: letras, dígitos, `_` e `-`, até 64. É a chave da credencial |
| `label` | o rótulo mostrado; vazio, vira o host |
| `baseUrl` | a origem do Jira, só `https://host`: sem caminho, sem usuário, sem query |
| `owners` | as organizações do GitHub que usam este Jira (gravadas em minúsculas) |
| `projectKeys` | as chaves de projeto aceitas (gravadas em maiúsculas) |

Site sem `id` válido, sem `baseUrl` válida ou com `id` repetido é descartado sem erro.
`jiraSites` é a lista inteira: o site que não vier é removido (a credencial dele fica no disco
até ser tirada).

```sh
# os sites
curl -sS -X POST "$FAROL/api/settings" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" \
  --data '{"jiraSites":[{"id":"biud","label":"Jira BIUD","baseUrl":"https://exemplo.atlassian.net","owners":["biudtech"],"projectKeys":["BT"]}]}'

# a credencial do site: o token do Atlassian vem do teclado, sem eco, e vai no corpo pela entrada padrão
read -rs -p 'Token do Jira: ' JIRA; echo
printf '%s' "$JIRA" | jq -Rs '{siteId: "biud", email: "pessoa@exemplo.com", token: .}' \
  | curl -sS -X POST "$FAROL/api/jira/credential" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" --data @-
unset JIRA

# tirar a credencial
curl -sS -X POST "$FAROL/api/jira/credential/remove" -H @"$CAB" -H "x-farol: 1" -H "Content-Type: application/json" --data '{"siteId":"biud"}'
```

`POST /api/jira/credential` responde `{ "ok": true }`, ou
`{ "ok": false, "error": "dados incompletos" }` quando falta `siteId`, `email` ou `token`;
`POST /api/jira/credential/remove` responde `{ "ok": true }`, ou `{ "ok": false }` quando o
site não tinha credencial. A credencial fica em `~/.farol/jira-credentials.json`, fora do
`config.json`, e não volta em resposta nenhuma (travado em
`test/jira-credencial-http.test.js`). O primeiro site muda os MCPs da sessão.

**Testar o site** (`POST /api/jira/test`, `testarSite` em `lib/engine/jira.js`, testes em
`test/jira-teste-site.test.js`) prova o site sem esperar PR, por `/rest/api/2/myself`:
qualquer credencial válida responde, então falha ali é credencial ou URL, nunca permissão em
projeto. A recusa leva `motivo` junto do `code`, que vem da tabela de `lib/jira/errors.js`.
Erro cru do fetch chega como `indisponivel` (`comoJiraError` em `lib/jira/client.js`).

**Pegadinhas já pagas (todas com teste):**

- O namespace do cache (`lib/jira/cache.js`) leva o tamanho do id na frente, porque o
  saneamento achata ponto em underscore e dois pares id e host diferentes cairiam na mesma
  pasta. O namespace é id e host juntos.
- A config de "sem site" usa um nome que id nenhum produz (`sem.site.json`).
- `fields` como lista não é card: o Jira responde 200 com envelope de erro.
- O protocolo do workspace instrui o caso da seção de card ausente e não promete escopo em
  caminho não escopado.

## Padrões do time na revisão

O campo `padroesRevisao` da conta (editado por `POST /api/accounts/edit` ou no arquivo; o
front não tem campo para ele) entra na revisão como critério
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

Antes de abrir a sessão, o motor prepara as fontes do PR (`prepareSources`,
`lib/review-source/index.js`) num manifesto com três commits: H (o head analisado), B (a ponta
da base) e M (o merge-base). O cache fica em `~/.farol/source-cache/`, um diretório por host,
conta e repositório; limites, travas e manutenção estão em
[`SOURCE-STORAGE.md`](SOURCE-STORAGE.md).

As chaves abaixo são só de arquivo, com os padrões do código (`DEFAULT_LIMITS` em
`lib/review-context/map.js`, `DEFAULTS` em `lib/review-source/contract.js`). Mescle os campos,
sem substituir o arquivo, e reinicie o motor.

```json
{
  "reviewContextMode": "off",
  "reviewContextTokens": 3000,
  "reviewContextLimits": { "files": 600, "bytes": 8388608, "fileBytes": 262144, "timeMs": 30000, "depth": 2, "paths": 120 },
  "sourceCacheLimits": { "maxBytes": 2147483648, "reserveBytes": 536870912, "globalMaxBytes": 4294967296, "globalReserveBytes": 1073741824, "acquisitionReserveBytes": 16777216, "monitorIntervalMs": 250, "concurrency": 1, "maxQueued": 8 }
}
```

- `reviewContextMode`: `off` não cria o mapa sintático; `observe` levanta o mapa e a seleção
  só para medir, sem injetar nada no prompt; `assist` injeta a seleção, com orçamento estimado
  em caracteres/4 (`reviewContextTokens`, de 256 a 12.000). Nenhum dos modos muda os gates nem
  a política da conta. O que o mapa prova e não prova está em
  [`CONTEXTO-FRONTEND.md`](CONTEXTO-FRONTEND.md).
- `reviewContextLimits`: cada campo aceita número positivo, até quatro vezes o padrão.
- `sourceCacheLimits`: cada campo aceita inteiro positivo; `concurrency` vai no máximo a 2.

Para desfazer a seleção, volte `reviewContextMode` para `off`.

## Para hospedar

O motor hospedado roda num container Linux atrás de um proxy com TLS, e o front fala com a API
dele de outra origem. Sete pontos, cada um conferido no código. O `config.json` mínimo da
fronteira:

```json
{
  "hostPublico": "farol.exemplo.com",
  "origensPermitidas": ["https://painel.exemplo.com"]
}
```

As duas chaves são só de arquivo e valem depois de reiniciar: `POST /api/settings` as devolve
em `ignoradas` e `POST /api/accounts/edit` não as alcança, porque quem chama a API não pode
abrir a própria porta.

A imagem do container, o volume, a primeira subida e o que o orquestrador precisa garantir
estão em [`HOSPEDAGEM.md`](HOSPEDAGEM.md), com um `config.json` de exemplo completo. A imagem
liga `FAROL_INSTANCIA_HOSPEDADA=1`: com ela o motor também não sobe sem `config.json`, com um
que não exija autenticação ou com um sem nenhuma das duas chaves acima
([as três recusas](HOSPEDAGEM.md#variáveis-de-ambiente)).

### 1. `hostPublico` ou `origensPermitidas` já exigem autenticação

`exigeAutenticacao` (`lib/local-auth/modo.js`) exige autenticação em três casos:

- **modo hospedado**: `hostPublico` ou `origensPermitidas` preenchidos. A pergunta é feita
  antes de o `localAuth` ser lido, então não existe valor de configuração que desligue;
- `localAuth: "exigir"` no `config.json`;
- `bind` fora do loopback (`loopback` em `lib/http-guard.js`: ausente, `127.0.0.1`, `localhost`
  e `[::1]` contam como loopback).

Com qualquer uma das duas chaves da fronteira você não precisa gravar `localAuth`. **O caso
que continua sem autenticação por padrão é o motor em loopback, sem nenhuma das duas chaves,
atrás de um proxy que reescreve o Host para `127.0.0.1:<porta>`**: ali quem alcança o proxy
alcança a API inteira, e é preciso gravar `"localAuth": "exigir"`. Prefira `hostPublico`, que
dispensa a reescrita (item 2).

**Valor inválido ou nome errado nas chaves da fronteira não sobe.** As chaves são quatro:
`hostPublico`, `origensPermitidas`, `localAuth` e `bind`. O motor não inicia quando o
`config.json` traz:

- `hostPublico` ou `origensPermitidas` com um valor que o motor não aceita (item 2), inclusive
  um único item inválido numa lista de origens válidas, e inclusive o tipo trocado
  (`"hostPublico": []`, `"origensPermitidas": ""`);
- `localAuth` preenchido com qualquer coisa que não seja exatamente `"exigir"` (`"Exigir"`,
  `true`, `"sim"`);
- `bind` preenchido com um valor que `sanearBind` não aceita (por exemplo `"0.0.0.0:47170"`: a
  porta vai na chave `port`);
- uma chave que não é a grafia exata de uma das quatro, mas fica igual a ela quando se ignoram
  maiúsculas, `_`, `-` e espaço (`hostpublico`, `Host_Publico`, `LocalAuth`, `Bind`), ou uma
  chave que o motor não conhece e que, nessa mesma comparação, começa por `host`, `origens`,
  `origem`, `origin` ou `localauth` (`origensPermitida`, `origins`). Chave desconhecida é
  descartada na leitura sem aviso; sem esta recusa, o nome errado subia sem autenticação.

Nesses casos o motor escreve o motivo no stderr e no `farol.log` (o arquivo é criado na hora se
a pasta `workspace/state/` já existir; sem a pasta, fica só o stderr), sai com código 1 e não
altera o `config.json` (`lib/fronteira-hospedada.js`). A mensagem de valor traz a chave, o
valor recusado e o formato aceito; a de nome traz a chave como foi escrita e a grafia certa. O
valor e o nome saem com os caracteres de controle escapados:

```
[farol] config.json inválido, o motor não sobe: "hostPublico" tem valor recusado: "https://farol.exemplo.com". Formato aceito: um nome de host ou um IPv4, sem esquema, sem caminho, sem porta e sem espaço, por exemplo "farol.exemplo.com". Corrija ou apague a chave em /home/farol/.farol/config.json (o arquivo não foi alterado).
[farol] config.json inválido, o motor não sobe: a chave "hostpublico" não existe; a grafia certa é "hostPublico" (maiúsculas e minúsculas contam, sem "_", "-" nem espaço). Corrija ou apague a chave em /home/farol/.farol/config.json (o arquivo não foi alterado).
```

É assim porque vazio quer dizer "não hospedado": se um erro de digitação virasse vazio em
silêncio, o motor em loopback atrás de um proxy que reescreve o Host ficaria com a API inteira
sem autenticação. Vazio de verdade continua sem erro: chave ausente, `null`, `""` nas três
chaves de texto e `[]` em `origensPermitidas`.

**`config.json` presente e ilegível também não sobe.** Se o arquivo existe e não dá para ler,
está vazio (zero bytes ou só espaço), não é JSON, é JSON que não é um objeto (`[]`,
`"texto"`), ou é um link simbólico que aponta para um arquivo que não existe, o motor não
inicia, pelo mesmo caminho: motivo no stderr e no `farol.log` (com a mesma condição da pasta),
código 1, e o arquivo, ou o link, fica como estava, sem cópia ao lado. Subir com os padrões no
lugar dele seria uma instância em loopback puro, sem autenticação e com a conta padrão, que
age sozinha. O BOM UTF-8 no início do arquivo não é erro: a leitura o ignora e o arquivo não é
regravado por causa dele.

```
[farol] config.json ilegível, o motor não sobe: não é JSON válido (linha 1, coluna 64). Arquivo: /home/farol/.farol/config.json. Corrija o arquivo: ele não foi alterado nem renomeado, e o motor não sobe com os padrões no lugar dele.
```

A mensagem traz a linha e a coluna quando o erro as tem, e nunca um trecho do arquivo: a chave
de API do perfil do Claude mora nele. Arquivo **ausente** é outra coisa, a instalação nova, e
sobe, menos na instância hospedada (`FAROL_INSTANCIA_HOSPEDADA=1`), em que ausente é o volume
que não montou e o motor não sobe. Valor torto dentro de um JSON válido, fora das quatro chaves
da fronteira, continua sendo saneado sem derrubar o boot.

Depois de subir, confira: `GET /api/auth/status` tem de responder `"exigida": true`.

Com a autenticação exigida, todo `/api/*` pede `Authorization: Bearer <token>`, exceto
`POST /api/auth/pair`, `GET /api/auth/status` (`lib/local-auth/acesso.js`) e
`GET /api/health` (item 7). Para obter o token:

1. No próprio container, com o mesmo `FAROL_HOME` do motor: `node tools/farol-parear.js`. Ele
   imprime no terminal um código de uso único, válido por dez minutos.
2. A tela pede o código e chama `POST /api/auth/pair` com `{ "codigo": "...", "rotulo": "..." }`;
   a resposta traz o token só no corpo, sem cookie, e a página o guarda no navegador. Código
   que não vale recebe sempre a mesma recusa, `{ "ok": false, "code": "codigo_invalido" }`,
   sem dizer se há código esperando nem quantas tentativas restam; cinco erros invalidam o
   código pendente, e aí é preciso gerar outro. Quando isso acontece o motor grava uma linha
   `WARN` no `farol.log`, uma por bloqueio, sem o código e sem o valor tentado.
3. A sessão vence com 30 dias sem uso ou 90 dias depois de emitida. Em disco fica só o hash,
   em `~/.farol/local-auth/`.

`node tools/farol-parear.js --revogar-todas` revoga todas as sessões e códigos. Um stream SSE
aberto é cortado quando a credencial dele é revogada.

### 2. O Host, o Origin e o CORS

A allowlist de `lib/http-guard.js` (`validarHostEOrigem`) roda antes de qualquer rota (só a
de saúde responde antes, item 7), com a porta efetiva do socket. Recusa é
`403 { error: "forbidden", motivo: "host" | "origin" }`, sem cabeçalho CORS. Host permitido
não é autenticação: por isso o item 1.

**Host.** O motor aceita, por igualdade exata de texto:

- `127.0.0.1:<porta>` e `localhost:<porta>`, sempre (com `bind: "[::1]"`, também
  `[::1]:<porta>`);
- o `hostPublico`, **sem porta**: `farol.exemplo.com`. É o que chega pelo proxy com TLS na
  porta 443, então o proxy não precisa reescrever o Host.

`farol.exemplo.com:443` é recusado, como qualquer outra porta: navegador, curl e o cliente HTTP
do Node tiram a porta padrão do esquema antes de montar o Host, e o motor não aceita uma
segunda forma do mesmo nome. Se o endereço público usa uma porta que não é a padrão (`:8443`),
o Host chega com ela e é recusado; nesse caso o proxy tem de reescrever o Host. Também são
recusados o nome em maiúsculas, com ponto final, com usuário (`x@farol.exemplo.com`), o
subdomínio e o nome que só começa ou termina igual. Pedido com dois cabeçalhos `Host` é
recusado, em qualquer ordem (`hostDoPedido`).

`sanearHostPublico` (`lib/parse.js`) aceita um nome de host ou um IPv4, e passa para caixa
baixa. Esquema, caminho, porta, espaço, ponto final, curinga ou IPv6 entre colchetes são valor
inválido, e com valor inválido o motor não sobe (item 1).

**Origin.** Ausente, passa (curl, o probe, a navegação direta). Presente, precisa ser uma
destas, também por igualdade exata:

- `http://127.0.0.1:<porta>` ou `http://localhost:<porta>`: a origem do próprio motor. Não
  leva cabeçalho CORS. O motor não serve página, então só chega assim quem manda esse
  `Origin` à mão;
- um item de `origensPermitidas`.

O `hostPublico` não vira origem sozinho. A origem do front (`https://farol.exemplo.com`) tem
de estar em `origensPermitidas`; sem isso todo pedido dela volta 403, a começar pelo
pareamento.

`sanearOrigensPermitidas` (`lib/parse.js`) aceita só o item que é uma origem exata
`https://host` ou `https://host:porta`: sem caminho, sem barra final, sem curinga, sem usuário.
Caixa alta é passada para baixa e item repetido conta uma vez. Qualquer outro item, ou um
valor que não é lista, é inválido, e basta um para o motor não subir (item 1). Dois detalhes:

- a porta padrão do esquema não se escreve (`https://painel.exemplo.com:443` é inválido): o
  navegador nunca a manda no `Origin`, e o item ficaria na lista sem casar com nada;
- `http://` só é aceito para `localhost` e `127.0.0.1` (por exemplo `http://localhost:3000`),
  para o front em desenvolvimento. Qualquer outro `http://` é inválido. O desenho da fase fala
  só em `https://`; esta exceção é um desvio declarado dele. Lembre que uma origem dessas na
  lista também liga a exigência de autenticação.

**CORS** (`lib/http-cors.js`). Quando o `Origin` é um item de `origensPermitidas`, toda
resposta leva, inclusive 401, 403 do `x-farol`, 404, 500 e o stream de `/api/events`:

```
Access-Control-Allow-Origin: <a origem, como está na lista>
Vary: Origin
Access-Control-Allow-Headers: Authorization, Content-Type, x-farol
Access-Control-Allow-Methods: GET, POST
```

Nunca `*`, e nunca `Access-Control-Allow-Credentials`: não há cookie, o token vai no
`Authorization`. Todo `OPTIONS` em `/api/` responde `204` sem executar rota, depois da allowlist
e antes do `x-farol` e da autenticação; quando a origem é uma das permitidas, com os cabeçalhos
acima e `Access-Control-Max-Age: 600`. As listas de método e de cabeçalho são fixas: o que o
preflight pede não é lido. O `x-farol: 1` continua exigido em todo `POST`, e está entre os
cabeçalhos anunciados para o `fetch` do front poder mandá-lo.

**Sem `hostPublico`**, com o motor em loopback, o proxy precisa reescrever o Host para
`127.0.0.1:<porta>`. Com `bind` fora do loopback, o Host `<bind>:<porta>` e as origens
`http://<bind>:<porta>` e `https://<bind>` também passam, e a autenticação passa a ser exigida
sozinha. `sanearBind` (`lib/parse.js`) aceita IPv4, IPv6 entre colchetes ou nome de host, e
passa para caixa baixa; `bind` preenchido com qualquer outra coisa impede o boot (item 1), e
só a chave ausente, `null` ou `""` fica em `127.0.0.1`. `bind` e `port` são só de arquivo e
valem depois de reiniciar.

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
no container o HOME do Farol fica no padrão, `~/.farol` do usuário que roda o motor. O volume
persistente é o HOME inteiro desse usuário (`/home/farol` na imagem), porque o motor, o `gh` e
o Claude Code também gravam fora de `~/.farol` ([o volume](HOSPEDAGEM.md#o-volume)). A variável
`FAROL_UPDATE_MANAGER=external` também tira a instância da condição de isolada.

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

### 7. Saúde: `GET /api/health`

Para o probe do orquestrador. Responde `200 {"ok":true}` e mais nada: o corpo é fixo e não
leva versão, caminho, conta, fila nem estado de credencial. Diz só que o processo atende HTTP;
não diz se o `gh` está logado nem se há perfil do Claude (isso está em `GET /api/doctor`, com
autenticação).

É a única rota que responde **antes** da allowlist de Host, sem autenticação e sem `x-farol`,
porque o probe chega pelo IP do pod (`Host: 10.0.0.7:47170`), que não está em lista nenhuma.
Só o `GET` no caminho exato escapa (a query string é ignorada): `POST /api/health`,
`/api/health/` e qualquer outro método ou caminho passam pelas defesas de sempre. A resposta
não leva cabeçalho CORS, então uma página de outro site não consegue lê-la.
