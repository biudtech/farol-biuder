# Gates de revisão e postagem do Farol

O detalhe do invariante 4 do [`CLAUDE.md`](../CLAUDE.md): nada é postado no GitHub sem gate. Cada
seção diz a regra e o arquivo em que ela mora.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->
## Índice

- [Como ler este guia](#como-ler-este-guia)
- [A boca única de postagem](#a-boca-única-de-postagem)
- [O gate automático](#o-gate-automático)
- [Ressalva e lacuna](#ressalva-e-lacuna)
- [A decisão sem mesa](#a-decisão-sem-mesa)
- [CI obrigatório antes da aprovação](#ci-obrigatório-antes-da-aprovação)
- [Dedup por head](#dedup-por-head)
- [Head que anda](#head-que-anda)
- [PR da própria conta](#pr-da-própria-conta)
- [Texto público](#texto-público)
- [Um Farol por PR](#um-farol-por-pr)
- [Re-revisão automática](#re-revisão-automática)
- [Retirada do pedido de mudanças](#retirada-do-pedido-de-mudanças)
- [Checkpoint de verificação](#checkpoint-de-verificação)
- [Arquivo de ambiente e caminho protegido](#arquivo-de-ambiente-e-caminho-protegido)
- [Instância isolada](#instância-isolada)
<!-- indice:fim -->

## Como ler este guia

Este guia foi reescrito no fechamento da fase 1 (15/11/2026) e ficou só com o que foi conferido no
código naquele dia, função a função. A versão anterior acumulava o histórico do aplicativo de mesa e
afirmava regras de módulos que saíram; ela está no histórico do git.

Três consequências para quem mantém:

- A fonte é o código. Cada arquivo de `lib/engine/` abre com um comentário que conta a regra e o
  caso que a originou. Este guia aponta o lugar; na divergência, vale o código, e o guia é corrigido
  no mesmo PR.
- O que não está aqui não foi conferido, e não quer dizer que não exista. A lista do que tem regra
  no código e ficou sem seção está logo abaixo.
- Frase nova neste guia só entra depois de aberta a função que ela descreve.

Sem seção neste guia, com o arquivo em que cada assunto mora (todos em `lib/engine/`, salvo
indicação):

| assunto | onde ler |
|---|---|
| Prova por arquivo, cobertura da leitura e herança entre PRs | `file-proof.js`, `read-evidence.js`, `pr-scope.js`, `prova-do-repositorio.js` |
| Alcance: uso do código alterado fora do diff | `alcance.js`, `alcance-contexto.js` |
| Inventário do diff | `pr-inventory.js` |
| Fan-out de PR grande | `fanout.js` |
| Memória de achados entre rodadas e critérios | `review-rounds.js`, `review-round-store.js`, `review-findings.js`, `review-criteria.js` |
| Recuperação durável da prova e teto de rodadas por commit | `espera-prova.js`, `recuperacao-prova.js`, `busca-da-prova.js`, `recuperacao-head.js` |
| Retomada de sessão e retry depois de falha | `retomada-duravel.js`, `retomada-varredura.js`, `review-retry.js`, `retry-da-revisao.js` |
| Dívida herdada da production | `heranca-de-producao.js` |
| Achado técnico fora das linhas do PR | `lib/technical-review/divida-fora-das-linhas.js` |
| Pedido de mudanças apoiado em estado que não vale | `estado-desmentido.js` |
| Estacionamento e destrava por estado novo | `review.js`, `destrava.js`, `pendencia-commit-novo.js`, `head-novo.js` |
| Espera do conflito com a base | `espera-conflito.js` |
| Vigia da sessão e pedido de revisão retirado | `vigia-sessao.js`, `pedido-de-revisao.js` |
| Label própria órfã e limpeza de labels | `label-propria-orfa.js`, `labels-a-tirar.js`, `relogio-da-label.js` |
| Cancelamento da revisão | `cancelamento-revisao.js` |
| Tempo por etapa e estimativa | `etapas-revisao.js`, `estimativa-sessao.js` |
| Runtime privado da avaliação técnica e declaração por repositório | `lib/technical-review/setup.js`, `toolchain.js`, `profiles.js`, `declaracao.js`, na mesma pasta |
| Limite do plano e registro de consumo (o consumo não barra revisão: não há teto de gasto) | `limite-plano.js`, `usage.js` |
| Contestação do autor | `pushback.js` |
| Card do Jira no prompt | `jira.js` |
| Classificação de falha e retry | `lib/log-taxonomy.js` |

## A boca única de postagem

Toda escrita de review passa por `postReview` (`lib/engine/decision.js`): o desfecho da revisão
automática (`via: 'revisao'`), o clique na mesa (`via: 'clique'`), o reenvio (`via: 'reenvio'`) e a
espera do CI (`via: 'espera-ci'`). As postagens do mesmo PR entram numa fila e saem uma por vez
(`enfileirarPostagem`).

Há uma escrita no GitHub que não passa por `postReview`: a retirada do pedido de mudanças
(`enviarRetirada`, `lib/engine/retirada-de-pedido.js`, um PUT em `/dismissals`). Ela passa por
`recusaDaConta`, por `recusaPorEstado` e pela trava de linguagem, e não passa pela fila por PR,
pela memória de rodadas nem pela trava de credencial. O texto dela é fixo, montado pelo app.

Dentro da fila, `postReviewOnce` faz as recusas nesta ordem. As sete primeiras não chamam o `gh`:

1. **Memória de rodadas** (`publicationRefusal`, `lib/engine/review-rounds.js`): só com
   `reviewRoundsMode: "enforce"` e fora do clique. Responde `round_memory`. O padrão da chave é
   `observe` (`lib/settings.js`), então numa instância sem essa escolha a recusa não acontece.
2. **Instância isolada** (`recusaDaConta`, `lib/engine/postagem-portao.js`): `instancia_isolada`.
3. **PR da própria conta**, na mesma função: APPROVE e REQUEST_CHANGES respondem `pr_proprio`.
4. **Formato do payload** (`normalizeReviewPayload`): `invalid_payload`.
5. **Credencial no texto** (`recusaPorCredencial`, `lib/engine/credencial-no-texto.js`):
   `credencial_no_texto`.
6. **Critérios inconsistentes** (`criteriaPublicationRefusal`, `lib/engine/review-criteria.js`).
7. **Linguagem interna no texto público** (`publicReviewLanguageIssues`,
   `lib/engine/public-review.js`): `internal_language`.
8. **Conta sem token no `gh`** (o token é lido aqui, se ainda não foi): não posta, para o review não sair assinado por outra identidade.
9. **Avaliação técnica** (`approvalRefusal`, `lib/technical-review/publication.js`): só para
   APPROVE. Responde `technical_review`. A prova vem de `publicationEvidence`
   (`lib/technical-review/registry.js`): a guardada em memória pela revisão que acabou de rodar
   (`engine.technicalApprovals`) ou, sem ela, a gravada na pendência do PR. Sem nenhuma das duas
   não há prova, e o APPROVE é recusado.
10. **Estado do PR** (`recusaPorEstado`, `lib/engine/postagem-portao.js`): PR mergeado ou fechado
    não recebe APPROVE nem REQUEST_CHANGES; COMMENT sai. Estado que não pôde ser lido não cancela.
    Para item que chegou sem autor, o autor é lido aqui e a recusa de PR próprio é conferida de novo.
11. **Dedup por head**, na revisão automática: ver [Dedup por head](#dedup-por-head).

Só então o review é enviado (`gh api repos/<repo>/pulls/<n>/reviews`). Se o GitHub recusar o
conteúdo com 422, há um recuo de um degrau: com comentários inline, os pontos voltam para o corpo;
sem inline, sai sem a âncora do commit. Os dois degraus saem sem `commit_id`, e por isso o recuo
tem conferência própria: `recusaDoRecuo` (`lib/engine/postagem-recuo.js`) relê o head logo antes
e recusa com `head_mudou` ou `head_desconhecido`. O texto recuado passa de novo pela credencial e
pela linguagem.

O clique na mesa (`decide`, no mesmo arquivo) não é atalho: ele confere antes os critérios, o dedup
no head atual e se o head andou, e depois entra pela mesma `postReview`. O que o clique pula é a
memória de rodadas (item 1) e o dedup automático (item 11), porque a decisão é de uma pessoa.

## O gate automático

`shouldAutoApprove` e `shouldAutoReject` (`lib/engine/approval-policy.js`) dizem se o resultado de
uma sessão pode sair sozinho. A admissibilidade vem antes da política da conta.

`shouldAutoApprove` devolve `{ ok, motivo }`. Os motivos de recusa, na ordem em que são conferidos:

| motivo | quando |
|---|---|
| `pr_proprio` | o PR é da conta que revisa |
| `inventario_no_limite` | o diff passa do que o GitHub lista, e não pode ser medido inteiro |
| `analise_incompleta` | o envelope voltou com a análise incompleta (salvo a rodada no teto do commit) |
| `inventario_incompleto` | o inventário do diff não fechou |
| `round_incompleto` | a memória de rodadas tem pendência (só com `reviewRoundsMode: "enforce"`; o padrão é `observe`) |
| `review_inconsistent` | veredito, achados e texto público discordam |
| `nao_aprovavel` | o veredito não é aprovar, ou o APPROVE não veio pronto |
| `sem_texto` | aprovação sem corpo e sem comentário |
| `origem_desconhecida` | o PR não traz nenhuma marca de origem (ver [A decisão sem mesa](#a-decisão-sem-mesa)) |
| `prova_tecnica_incompleta` | sobrou lacuna exigida (ver [Ressalva e lacuna](#ressalva-e-lacuna)) |
| `politica` | a política da conta manda esperar |
| `ci_vermelho`, `ci_em_andamento` | só com a espera do CI ligada |

`shouldAutoReject` devolve verdadeiro ou falso. Não reprova sozinho quando: o resultado é
incoerente; a avaliação técnica falhou pela declaração do repositório; a análise não sustenta a
reprovação (`analiseSustentaReprovacao`); o bloqueio é só de estado do PR (CI, conflito,
dependência, fora do diff: `reprovacaoSoDeEstado`); a espera do CI está desligada e só o CI vermelho
sustenta o pedido; o inventário tem pendência, ou a memória de rodadas (esta só em `enforce`); o
REQUEST_CHANGES não veio
pronto e com texto; a origem é desconhecida; o PR é da própria conta; ou a política da conta não é
`request_changes`.

A reprovação automática não consulta cobertura da leitura, checkpoint nem contestação de outro
review: ela sai, e o card registra a nota (`notasDaReprovacao`, `lib/engine/ressalvas.js`). A nota é
do app, nunca do texto público.

## Ressalva e lacuna

Duas listas diferentes, e é o motor que decide em qual cada coisa cai, nunca o modelo.

- **Ressalva** (`attentionPoints`, `lib/engine/ressalvas.js`) é a única coisa que separa um
  resultado limpo de um com ressalvas. Nenhuma ressalva: vale `onClean`. Uma ou mais: vale
  `onCaveats`. Nada dessa lista é escrito no PR, salvo o que é dirigido a quem decide o merge.
- **Lacuna** (`approvalGaps`, `lib/technical-review/evidence.js`) é o que falta de prova para
  aprovar. `lacunasExigidas` (`lib/engine/busca-da-prova.js`) fica só com as duras (`ehLacunaDura`,
  `lib/technical-review/verdict.js`) e as do CI; as outras viram ressalva na rodada que as
  encontrou. Lacuna exigida impede APPROVE, também no clique: a conferência se repete na publicação
  (`lib/technical-review/publication.js`).

Prova antiga, em dois lugares que fazem coisas diferentes:

- na publicação, `legacyEvidenceGap` (`lib/technical-review/verdict.js`) recusa o APPROVE cuja
  prova dispensou lacunas e foi gravada sem carimbo de versão, ou com carimbo menor que 2, e pede
  revisão nova;
- na espera da prova (`lib/engine/espera-prova.js`), a pendência armada com regras anteriores a
  `VERSAO_DAS_REGRAS` é relançada.

## A decisão sem mesa

Regra do dono de 18/10/2026: a conta configurada para aprovar sozinha aprova sozinha, e a
configurada para reprovar sozinha reprova sozinha. O desfecho de uma revisão headless está em
`concluirRevisao` (`lib/engine/desfecho-da-revisao.js`).

A política é da conta (`config.conta`, lida em `lib/engine/contas-config.js`):

| campo | valores | o que decide |
|---|---|---|
| `autoReview` | `true`, `false` | se o PR pedido à conta é revisado sem clique |
| `onClean` | `approve`, `wait` | resultado aprovável sem ressalva |
| `onCaveats` | `approve`, `wait` | resultado aprovável com ressalva; nunca mais permissivo que `onClean` |
| `onReject` | `request_changes`, `wait` | resultado que pede mudanças |

O padrão de uma conta nova é agir em tudo: `autoReview: true`, `approve`, `approve` e
`request_changes` (`PADRAO`). Para um `config.json` de versão anterior vale outra regra, a de
`normalizarConfig` (`lib/settings.js`): o campo que a conta não tinha escolhido não ganha o
padrão novo, e com ressalvas e reprovação ficam em `wait` salvo a chave antiga de aprovar tudo.
O detalhe está em [`CONFIGURATION.md`](CONFIGURATION.md). Em `wait`, o PR vai à mesa ("Precisa
de você") com o motivo no card.

**Origem.** A revisão posta sozinha quando o PR traz uma marca de origem (`origemDoDono`,
`lib/engine/desfecho-automatico.js`). A função aceita seis marcas. Três têm quem as escreva hoje:
`requested` (o PR pedido à conta, vindo da fila), `manual` (o clique) e `origemDono`, que a
pendência grava e é o que faz o reenvio e a espera do CI passarem. As outras três (`viaAdmin`,
`viaComando`, `viaDistribuicao`) são lidas e não têm escritor. Só a revisão sem marca nenhuma não
posta sozinha, e o card diz isso.

**Os caminhos do desfecho**, todos atrás da conferência de head e do dedup:

1. APPROVE da sessão, quando `shouldAutoApprove` aceita.
2. REQUEST_CHANGES da sessão, quando `shouldAutoReject` aceita.
3. REQUEST_CHANGES montado pelo app (`caminhoNovo`), quando a sessão aprovou, a conta reprova
   sozinha e há defeito do PR (`defeitosDoPr`: violação técnica confirmada, achado não resolvido, a
   parte do card deste PR não entregue).
4. REQUEST_CHANGES pelo CI obrigatório vermelho, só com a espera do CI ligada.
5. COMMENT em PR da própria conta.

O que não sai por nenhum deles vira pendência (`registrarPendencia`): espera automática, quando há
uma armada, ou mesa.

**Cancelamento.** Cada postagem do desfecho é cercada: `conferirCancelamento` antes de montar o
envio, e `iniciarPublicacao` logo antes de enviar, que confere de novo e marca a sessão como não
cancelável (`lib/engine/cancelamento-revisao.js`). Depois de iniciado o envio, não há garantia de
interromper o efeito no GitHub.

**Falha ao postar.** Na hora, o desfecho repete até 3 vezes, com 2 segundos entre elas, só a
recusa passageira de não ter conseguido ler os reviews do commit
(`lib/engine/postagem-retentativa.js`). Falha transitória deixa a pendência marcada para o
reenvio: `retryFailedPosts` (`lib/engine/decision.js`) tenta a cada ciclo, até 3 tentativas, e
antes de cada uma relê o head e os reviews da conta. Head que mudou desarma o reenvio; leitura
que falha segura até o ciclo seguinte.

**Pendência atendida por fora.** A cada ciclo, `reconcilePending` tira a pendência sem postar
quando o PR foi mergeado ou fechado, ou quando a conta já tem review que a atende.

**Gente já decidiu o commit.** Se a rodada só rodou para retirar um pedido automático anterior e
outra pessoa já aprovou ou reprovou aquele commit, a aprovação automática é dispensada sem postar
(`dispensarAprovacaoEmHeadDecidido`).

## CI obrigatório antes da aprovação

A chave é `aguardarCiParaAprovar`, lida num lugar só (`aguardaCiParaAprovar`,
`lib/engine/gate-espera.js`). O padrão é desligada.

**Desligada**, o estado do CI não segura nem adia a decisão em via nenhuma, e fica só como nota no
app. O merge só fica barrado pelo GitHub onde o check é obrigatório no ruleset do repositório, e
desligar só é seguro nesse caso: num repositório sem check obrigatório, desligar permite APPROVE com o CI vermelho,
e nada barra o merge. O pedido de mudanças sustentado só pelo CI vermelho não sai
sozinho.

**Ligada**, o resultado aprovável com check obrigatório vermelho ou rodando fica como pendência com
a marca `esperaCi`, gravada no `decisions.json` (`lib/engine/espera-ci.js`). A cada ciclo,
`aprovarQuandoOCiFechar` faz uma leitura por PR em espera:

- checks verdes no mesmo head que a sessão leu: confere a política da conta de novo, consulta se
  gente já decidiu o commit e posta pelo `postReview`;
- head diferente: larga a espera e marca a pendência como commit novo; nunca posta em head que a
  sessão não leu;
- CI vermelho ou rodando: segue esperando, sem pedir clique;
- CI vermelho com a conta reprovando sozinha: `reprovarPeloCi` posta o REQUEST_CHANGES citando os
  checks e resolve a pendência como reprovada. A espera acaba ali; só outro commit abre análise
  nova.

Na hora de postar a aprovação, decisão de gente naquele commit resolve a pendência como
`approval_not_needed`, sem postar (`consciencia` e `dispensar`).

A espera também é armada para um resultado que pede mudanças só por estado do PR com causa de CI,
quando a conta reprova sozinha e a origem é conhecida (`esperaDeEstado`,
`lib/engine/desfecho-da-revisao.js`). Para essa pendência, CI verde no mesmo head leva à mesa e
nunca vira APPROVE; CI vermelho segue o `reprovarPeloCi`.

Leitura que falha (sem token, `gh` fora, exigência da branch desconhecida) espera o próximo ciclo:
aqui a falta de dado segura. Uma espera armada antes de a chave ser desligada é liberada no ciclo
seguinte sem olhar o CI, com o head ainda conferido (`liberarSemCi`).

Começar a revisão só com os checks obrigatórios verdes é outra chave, `aguardarCiParaRevisar`,
também desligada por padrão (`bloqueiaAutomatico`, `lib/engine/skip-review.js`).

## Dedup por head

Nas vias automáticas, uma aprovação ou reprovação publicada encerra aquele commit para a conta.
Só commit novo abre rodada automática nova. A revisão por clique fica fora dessa regra (abaixo).

A regra é `decisaoAutomaticaJaPublicada` (`lib/engine/review-head-policy.js`): existe review
`APPROVED` ou `CHANGES_REQUESTED` da conta naquele `commit_id`. Quem lê é `myReviewStates`.

- **Na postagem automática** (`postReviewOnce`, vias `revisao`, `reenvio` e `espera-ci`): já
  decidido responde `ok` com `alreadyReviewed`, sem postar. Se a leitura falha, o review não é
  enviado.
- **Na mesma fila do PR**: duas vias que chegam juntas ao mesmo veredito no mesmo head postam uma
  vez. `postReviewSerial` guarda a assinatura (conta, PR, evento e head) do APPROVE ou
  REQUEST_CHANGES que acabou de sair, por `TEMPOS.POSTAGEM_MEMORIA_MS` (5 minutos), e responde
  `{ ok: true, deduped: true }` sem postar. Vale para toda via, clique incluso, e o `decide`
  grava essa resposta como postado.
- **No clique** (`decide`): se já existe review da conta com o mesmo estado no head atual, a
  pendência é resolvida como `already_reviewed` sem postar de novo.
- **COMMENT de PR próprio** deduplica pelo texto, não pelo estado: já saiu quando existe um
  comentário da conta, naquele commit, com o mesmo corpo (`lib/engine/comentario-proprio.js`).

**Revisão por clique fica fora do dedup por head.** Para o PR marcado `manual`,
`decisaoAutomaticaJaPublicada` e `postagemAutomatica` devolvem falso, então a leitura de reviews
da boca não roda, e `myReviewStates` descarta os reviews anteriores ao pedido de revisão. Quem
clica em Revisar num commit já decidido pela conta recebe revisão e postagem novas.

O mesmo `myReviewStates` é lido também no desfecho (`lib/engine/desfecho-da-revisao.js`) e na espera
do CI (`lib/engine/espera-ci.js`), antes de cada um montar o próprio pedido. Para saber todos os
pontos de hoje: `git grep -n "myReviewStates(" lib server.js`.

Travado em `test/postagem-dedup.test.js` e `test/postagem-coordenacao-desligada.test.js`.

## Head que anda

O review fala do commit que a sessão leu, e não sai em outro.

- **No desfecho automático**: antes de postar, `headAndou` (`lib/engine/desfecho-da-revisao.js`)
  relê o head. Se mudou durante a sessão, nada é postado e a pendência fica marcada `stale_head`.
- **No clique**: se o head de agora difere do que a sessão leu, `decide` não posta, grava na
  pendência `blockedKind: 'stale_head'` com o head novo e responde `blocked: 'stale_head'`.
- **Na espera do CI**: head diferente larga a espera.
- **A cada ciclo**: `marcarCommitNovo` (`lib/engine/pendencia-commit-novo.js`) converte em
  `stale_head` a pendência viva cujo head no GitHub não é mais o lido.

O review postado leva o `commit_id` do head lido, salvo no recuo do 422, em que os dois degraus
saem sem ele depois da conferência de head do próprio recuo.

**Ponto de atenção: head que não deu para ler.** `headAndou` devolve falso quando não consegue
ler o head, ou quando a sessão não confirmou o que leu: falta de dado não vira `stale_head`. O
APPROVE continua barrado nesse caso, pela lacuna de commit não confirmado. `shouldAutoReject` não
confere `headSha`, então o REQUEST_CHANGES da sessão pode sair sem âncora de commit. O reenvio e
o recuo fazem o oposto: sem ler o head, seguram.

A marca `stale_head` é gravada em vários arquivos. Para a lista de hoje:
`git grep -ln "stale_head" lib server.js`.

## PR da própria conta

O GitHub recusa a revisão decisiva do autor. Aqui a regra tem quatro pontas:

- `ehPrProprio` (`lib/engine/pr-proprio.js`) compara o autor do PR com a conta revisora, sem
  diferenciar caixa.
- O gate responde `pr_proprio` para o APPROVE, e `shouldAutoReject` devolve falso.
- O portão de postagem recusa APPROVE e REQUEST_CHANGES por qualquer via, inclusive o clique.
- O desfecho posta a revisão como COMMENT (`payloadDoPrProprio`), quando a política da conta para
  aquele veredito é automática; com a conta em `wait`, vai à mesa.

Uma pendência de PR próprio que estava em espera é largada por `lib/engine/espera-pr-proprio.js`.
Travado em `test/pr-proprio.test.js`.

## Texto público

Duas travas determinísticas, as duas antes de qualquer `gh`, valendo para corpo e para cada
comentário inline, em APPROVE, REQUEST_CHANGES e COMMENT.

**Credencial** (`lib/engine/credencial-no-texto.js`): texto com credencial não sai. A recusa cita
só os campos, nunca o valor. A régua é `hasCredential` (`lib/sensitive-text.js`).

**Linguagem** (`lib/engine/public-review.js`): o review é texto de uma pessoa revisando o PR de um
colega. Não cita ferramenta, modelo, automação nem o processo da revisão, e não cita a própria
conta que assina em terceira pessoa (a conta dentro de crase, bloco de código ou URL é literal
técnico e não conta). A recusa é `internal_language`.

No desfecho automático, o texto barrado pela linguagem é reconstruído uma vez
(`postarReconstruindo`, `lib/engine/desfecho-da-revisao.js`) e passa de novo pelas travas. No
clique não há reconstrução: a pendência fica com o motivo dito.

O prompt da sessão pede o texto certo; estas travas são a garantia, porque não dependem do modelo.

## Um Farol por PR

Outras pessoas do time rodam o próprio Farol. O sinal de "estou revisando" é a label
`<conta>:revisando` no PR.

**A label própria** entra no primeiro evento da sessão ou 15 segundos depois da admissão, o que
vier primeiro (`armarLabelTardia`, `lib/engine/label-tardia.js`, com `TEMPOS.LABEL_APOS_SPAWN_MS`),
e sai no fim da sessão. A sessão que morre nos primeiros segundos não chega a marcar o PR. A
remoção que falha é tentada de novo a cada ciclo (`lib/engine/labels-a-tirar.js`).

**Saída de cena** (`lib/engine/skip-review.js`): ver a label de outra conta tira o PR do caminho
automático naquele head, de forma durável, sem postar nada no PR. A saída caduca quando a outra
pessoa ficou sem a label e sem review naquele head (`standDownCaducou`), e é largada em commit
novo. Sem a lista de reviews, não caduca.

**Gente já decidiu o head** (`bloqueadoPorHistorico`, na mesma `bloqueiaAutomatico`): aprovação ou
pedido de mudanças de uma pessoa no head ativo segura a rodada automática. Conta de ferramenta não
é pessoa. A exceção é o pedido automático desta conta aberto em commit anterior, quando só há
aprovações: a rodada roda para retirá-lo. Falta de dado não bloqueia.

O clique em Revisar atravessa os dois (`pr.manual`).

**Limite conhecido:** dois Faróis que começam no mesmo instante não se veem, e os dois revisam. A
label reduz duplicata; não é trava distribuída.

## Re-revisão automática

Depois de um review da conta, commit novo no PR abre rodada nova sem clique. Há dois gatilhos
(`explicaReRound`, `lib/engine/review.js`):

- **A**: o review postado pela conta ficou em head antigo;
- **B**: há uma pendência marcada `stale_head`.

As travas que seguram qualquer rodada automática estão em `travaDoRound`, e cada uma tem motivo
nomeado para o card: PR em rascunho; revisão automática desligada para aquele PR (a conta, ou a
regra por organização e autor); conta sem token; revisão estacionada; outra
pessoa revisando; saída de cena registrada; PR em conflito com a base.

Entre as travas e o relógio, `explicaReRound` ainda segura em três casos: retry pós-falha
pendente para o PR (quem relança é o retry); pendência viva na mesa que não é `stale_head`; e a
âncora por head, pela qual cada head relança no máximo uma vez.

Depois disso vale o relógio: a rodada espera o head ficar quieto por
`TEMPOS.HEAD_QUIETO_MS` (5 minutos), contra rajada de pushes, e depois de três rodadas presas
seguidas a espera passa a `TEMPOS.HEAD_QUIETO_LONGO_MS` (30 minutos). Carimbo ausente espera um
ciclo: falta de dado não dispara.

A rodada relançada passa por tudo de novo: gate, dedup por head, política da conta.

## Retirada do pedido de mudanças

Regra do dono de 05/11/2026: se o problema que gerou o pedido de mudanças foi resolvido, o pedido
sai sozinho, e isso não é aprovação (`lib/engine/retirada-de-pedido.js`).

- Só sai o pedido automático desta conta. O feito à mão e o de outro revisor não são tocados.
- "Resolvido" é evidência, nunca o texto da sessão (`provaDaRetirada`): veredito de aprovar,
  análise completa, commit confirmado, nenhuma lacuna dispensada além de divergência entre
  passadas, rodada anterior na memória e sem pendência nela, nenhum defeito do PR, e o gate da
  aprovação sem recusa (política e CI não contam como recusa aqui).
- Com a espera do CI ligada e o CI ainda não verde naquele head, a retirada fica marcada e a
  varredura a conclui quando ele fechar. Com a espera desligada, o CI não adia a retirada.
- Retirar não aprova: o desfecho segue atrás dos gates e da política da conta.

A retirada passa pelas mesmas recusas de conta e de estado do PR do portão de postagem.

## Checkpoint de verificação

Memória, por PR, do que a revisão já conferiu contra o código: afirmação, arquivo, linha, veredito
e evidência (`lib/engine/verification-checkpoint.js`).

- **Só o motor escreve.** A sessão sinaliza com o marcador `FAROL_CHECKPOINT:` e o motor grava a
  entrada (`registrarCheckpoint`, `lib/engine/checkpoint-da-sessao.js`). Sessão que o motor não
  lançou com o protocolo de checkpoint não registra nada.
- **Só acrescenta.** Uma passada que discorda da anterior gera entrada nova. A divergência entre
  passadas vira ressalva.
- **O que conta para o PR de agora** (`relevantEntries`): a entrada do mesmo head, a entrada sem
  head gravado e a de outro head cujo arquivo citado tem o mesmo blob hoje.
- **Dentro de uma sessão vale o último veredito** de cada afirmação: refinar a própria resposta não
  é divergência (`porPassada`).

O arquivo fica em `state/verification/`, no workspace.

## Arquivo de ambiente e caminho protegido

Caminho protegido (`.env*`, `.ssh`, credencial, chave) nunca chega cru à sessão. A régua única é
`lib/review-source/caminho-protegido.js`:

- o arquivo de ambiente chega como projeção das linhas alteradas, só com o que comprovadamente
  não é credencial (`lib/review-source/env-changes.js`);
- a projeção é gravada com outro nome, `_farol_redigido_/_<caminho achatado>.redigido`, para não
  casar com regra de `deny` de leitura de `.env` que a sessão herde;
- o resto do que é protegido não chega.

O que a sessão não leu por isso vira ressalva com o caminho do arquivo
(`lib/engine/ambiente-nao-lido.js`), e a política da conta decide.

A sessão de revisão recebe por `--settings` o arquivo `workspace-template/.claude/guardas.json`
(`lib/engine/guardas-da-sessao.js`), lido direto do template. Ele só nega:

- `gh pr diff`;
- `gh api` em `pulls/<n>/files`, tarball, zipball e diff ou patch por cabeçalho;
- `gh repo clone` e `git clone`;
- `Read` de `.credentials.json` em qualquer pasta, e comando de shell cujo texto contém
  `.credentials.json`.

As duas últimas protegem a credencial do perfil de assinatura do Claude só contra a leitura que
escreve o nome do arquivo. Ver "Para hospedar" em [`CONFIGURATION.md`](CONFIGURATION.md).

## Instância isolada

Com `FAROL_HOME` fora de `~/.farol`, a instância é isolada (`instanciaIsolada`, `lib/paths.js`) e não
escreve no GitHub: review, adição e remoção de label são recusados com
`blocked: 'instancia_isolada'` (`recusaDeIsolada`, `lib/engine/instancia-isolada.js`).

Três exceções:

- `"instanciaIsoladaPosta": true` no `config.json` da instância (só por arquivo);
- a variável `FAROL_UPDATE_MANAGER=external`, com que a instância deixa de contar como isolada;
- a variável `NODE_TEST_CONTEXT` (o executor de testes): com ela a instância nunca conta como
  isolada.

A recusa grava uma linha de log por boot, não uma por tentativa. O que foi recusado volta ao reenvio
se a instância deixar de ser isolada (`lib/engine/postagem-recusada.js`).

Travado em `test/instancia-isolada.test.js`.
