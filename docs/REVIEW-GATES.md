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
- O que não está aqui não foi conferido, e não quer dizer que não exista. Prova por arquivo, fan-out
  de PR grande, memória de achados entre rodadas, recuperação da prova e retomada de sessão têm
  regra no código (`file-proof.js`, `fanout.js`, `review-rounds.js`, `espera-prova.js`,
  `retomada-duravel.js`) e não têm seção.
- Frase nova neste guia só entra depois de aberta a função que ela descreve.

## A boca única de postagem

Toda escrita de review passa por `postReview` (`lib/engine/decision.js`): o desfecho da revisão
automática (`via: 'revisao'`), o clique na mesa (`via: 'clique'`), o reenvio (`via: 'reenvio'`) e a
espera do CI (`via: 'espera-ci'`). As postagens do mesmo PR entram numa fila e saem uma por vez
(`enfileirarPostagem`).

Dentro da fila, `postReviewOnce` faz as recusas nesta ordem. As sete primeiras não chamam o `gh`:

1. **Memória de rodadas** (`publicationRefusal`, `lib/engine/review-rounds.js`): só com
   `reviewRoundsMode: "enforce"` e fora do clique. Responde `round_memory`.
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
   APPROVE. Responde `technical_review`.
10. **Estado do PR** (`recusaPorEstado`, `lib/engine/postagem-portao.js`): PR mergeado ou fechado
    não recebe APPROVE nem REQUEST_CHANGES; COMMENT sai. Estado que não pôde ser lido não cancela.
    Para item que chegou sem autor, o autor é lido aqui e a recusa de PR próprio é conferida de novo.
11. **Dedup por head**, na revisão automática: ver [Dedup por head](#dedup-por-head).

Só então o review é enviado (`gh api repos/<repo>/pulls/<n>/reviews`). Se o GitHub recusar o
conteúdo com 422, há um recuo de um degrau: com comentários inline, os pontos voltam para o corpo;
sem inline, sai sem a âncora do commit. O texto recuado passa de novo pela credencial e pela
linguagem (`lib/engine/postagem-recuo.js`).

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
| `round_incompleto` | a memória de rodadas tem pendência |
| `review_inconsistent` | veredito, achados e texto público discordam |
| `nao_aprovavel` | o veredito não é aprovar, ou o APPROVE não veio pronto |
| `sem_texto` | aprovação sem corpo e sem comentário |
| `origem_desconhecida` | a revisão não veio da fila nem de um clique |
| `prova_tecnica_incompleta` | sobrou lacuna exigida (ver [Ressalva e lacuna](#ressalva-e-lacuna)) |
| `politica` | a política da conta manda esperar |
| `ci_vermelho`, `ci_em_andamento` | só com a espera do CI ligada |

`shouldAutoReject` devolve verdadeiro ou falso. Não reprova sozinho quando: o resultado é
incoerente; a avaliação técnica falhou pela declaração do repositório; a análise não sustenta a
reprovação (`analiseSustentaReprovacao`); o bloqueio é só de estado do PR (CI, conflito,
dependência, fora do diff: `reprovacaoSoDeEstado`); a espera do CI está desligada e só o CI vermelho
sustenta o pedido; o inventário ou a memória de rodadas têm pendência; o REQUEST_CHANGES não veio
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

Prova gravada por uma versão anterior das regras (`VERSAO_DAS_REGRAS`,
`lib/technical-review/verdict.js`) não vale como ressalva: pede revisão nova.

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

O padrão de uma conta sem escolha é agir em tudo: `autoReview: true`, `approve`, `approve` e
`request_changes` (`PADRAO`). Em `wait`, o PR vai à mesa ("Precisa de você") com o motivo no card.

**Origem.** A revisão posta sozinha quando veio da fila ou de um clique (`origemDoDono`,
`lib/engine/desfecho-automatico.js`). Só a revisão sem marca nenhuma de origem não posta sozinha, e
o card diz isso.

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

Leitura que falha (sem token, `gh` fora, exigência da branch desconhecida) espera o próximo ciclo:
aqui a falta de dado segura. Uma espera armada antes de a chave ser desligada é liberada no ciclo
seguinte sem olhar o CI, com o head ainda conferido (`liberarSemCi`).

Começar a revisão só com os checks obrigatórios verdes é outra chave, `aguardarCiParaRevisar`,
também desligada por padrão (`bloqueiaAutomatico`, `lib/engine/skip-review.js`).

## Dedup por head

Uma aprovação ou reprovação publicada encerra aquele commit para a conta. Só commit novo abre
rodada automática nova.

A regra é `decisaoAutomaticaJaPublicada` (`lib/engine/review-head-policy.js`): existe review
`APPROVED` ou `CHANGES_REQUESTED` da conta naquele `commit_id`. Quem lê é `myReviewStates`.

- **Na postagem automática** (`postReviewOnce`, vias `revisao`, `reenvio` e `espera-ci`): já
  decidido responde `ok` com `alreadyReviewed`, sem postar. Se a leitura falha, o review não é
  enviado.
- **Na mesma fila do PR**: duas vias que chegam juntas ao mesmo veredito no mesmo head postam uma
  vez (`postReviewSerial` guarda a assinatura do que acabou de sair).
- **No clique** (`decide`): se já existe review da conta com o mesmo estado no head atual, a
  pendência é resolvida como `already_reviewed` sem postar de novo.

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

O review postado leva o `commit_id` do head lido.

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
regra por organização e autor); conta sem token; orçamento estourado; revisão estacionada; outra
pessoa revisando; saída de cena registrada; PR em conflito com a base.

Passadas as travas, vale o relógio: a rodada espera o head ficar quieto por
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

Duas exceções, e só elas:

- `"instanciaIsoladaPosta": true` no `config.json` da instância (só por arquivo);
- a variável `FAROL_UPDATE_MANAGER=external`, com que a instância deixa de contar como isolada.

A recusa grava uma linha de log por boot, não uma por tentativa. O que foi recusado volta ao reenvio
se a instância deixar de ser isolada (`lib/engine/postagem-recusada.js`).

Travado em `test/instancia-isolada.test.js`.
