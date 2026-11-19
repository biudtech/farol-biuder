# Consumo e saída dos reviews

O que o registro de consumo mede, como ele é consultado e por que não barra revisão. A tela
que mostra isto é o Consumo do front ([`web/README.md`](../web/README.md)); a definição de
cada número é do motor.

## O consumo mede, não barra

O motor não tem teto de gasto (decisão de 16/11/2026). Nenhuma revisão automática, nova
rodada, retentativa, recuperação de prova, busca de contestação ou lote consulta o gasto. A
trava é `test/sem-teto-de-gasto.test.js`.

Config e estado antigos: os campos de teto de um perfil (`budgetDaily`, `budgetTotal`,
`budgetSince`, `budgetByWeekday`, `budgetDates`) são descartados na carga do `config.json`,
sem erro, e o PR estacionado por orçamento num estado gravado volta a ser elegível no boot. O
detalhe está em [`CONFIGURATION.md`](CONFIGURATION.md#sem-teto-de-gasto).

O que continua medido: cada sessão no diário (no banco da telemetria, abaixo), os agregados
(`usage.json`, por dia, tipo, conta e modelo), o custo com a origem dele e a chave `usage` do
snapshot, que não traz `budgets`. O agregado `byProfileDay` (gasto por perfil e dia) continua
sendo gravado e hoje não tem leitor.

## Onde o registro mora

Desde 16/11/2026 o diário de sessões, as tentativas abertas e os motivos de falha moram num
arquivo SQLite, `~/.farol/workspace/state/telemetria.db` (`lib/telemetria/`). O motor abre o
banco uma vez, com WAL e `synchronous=FULL`, e só os módulos de `lib/telemetria/` têm SQL. Registrar uma sessão é um `INSERT`
numa transação, e não mais a regravação do arquivo inteiro (5,5 MB na instância real, a cada
sessão). A tentativa aberta é uma linha que o parcial atualiza e o fechamento apaga; o desfecho
marcado depois (`marcarDesfecho`) atualiza a linha mais recente daquele id.

| tabela | o que guarda |
|---|---|
| `sessoes` | uma linha por sessão, na ordem do diário (`seq`). Coluna para cada campo que o motor grava, `accounting` e `modelUsage` em JSON, e `extra` (JSON) para o resto, inclusive o que só registro antigo tem (`corrigidoEm`) e o valor de tipo inesperado. Índices por id, tentativa, cursor de retomada e modelo |
| `tentativas` | as tentativas de sessão abertas, pela chave do attemptId |
| `falhas` | os motivos de falha, na ordem, com o teto de 500 |

O esquema tem versão (`PRAGMA user_version`, hoje 1) e migrações numeradas em
`lib/telemetria/banco.js`.

O agregado continua JSON: é pequeno (228 kB), podado em 120 dias, e não se deriva das sessões.
Na instância real ele tem 5.568 sessões e 5,44 bilhões de tokens de entrada; o diário, 5.567
linhas e 5,34 bilhões, porque o agregado vem de antes do diário. Uma consulta sobre as sessões
mudaria os números da tela.

As leituras filtram e contam no SQL: as sessões recentes do snapshot, a primeira sessão, a
auditoria do registro, a linha anterior do cursor das retomadas e a amostra da taxa de custo. A
soma do custo usa uma soma em ordem, sem compensação, porque o `SUM` do SQLite compensa o erro de
arredondamento e mudaria os últimos dígitos do número da tela. `GET /api/usage` agrupa no
`lib/usage/`, porque a operação, a conclusão e as retentativas dependem do histórico inteiro de
cada operação, sobre as linhas do banco (sem o `accounting`, que ele não usa). Essas linhas e a
auditoria ficam em cache depois da primeira leitura e crescem com cada sessão registrada, sem
reler o diário (`lib/engine/usage-diario-banco.js`). Medido com 50 mil sessões sintéticas em
17/11/2026: a primeira consulta custa uns 580 ms (a leitura do banco), as seguintes uns 300 ms,
quase tudo no agrupamento de `lib/usage/`, que custa o mesmo lendo da memória (320 ms no caminho
de antes); registrar uma sessão custa uns 5 ms.

Escrita que o banco recusa (disco cheio, erro de I/O) não perde a linha: ela fica em memória, as
leituras a enxergam e a próxima gravação a grava, com um `WARN` quando passa a falhar e um `INFO`
quando volta. Leitura que falha não derruba o snapshot: o consumo sai sem a parte que não leu.

O banco abre no `start()`, depois que o motor tomou a porta (a trava de instância única), e não no
construtor: uma segunda instância no mesmo `FAROL_HOME`, que vai perder a porta, não abre o banco,
não importa nada e não fecha as tentativas vivas da primeira. Nessa abertura, todo JSON do
consumo presente é importado numa transação, só com as linhas que o banco ainda não tem (a chave
da sessão é `at`, `id`, `attemptId`, tipo e conta; a da tentativa, o attemptId; a da falha, o id),
conferido (o banco depois é o de antes mais as linhas que faltavam, linha a linha, com a
contagem e as somas batendo) e só então renomeado para `<nome>.migrado-<dia>`. A linha `INFO`
diz quantas entraram, quantas já estavam e quantas linhas ilegíveis (que não são objeto) ficaram
de fora. Isso cobre a primeira subida, a queda entre o COMMIT e o rename, e a subida em que o banco
não abriu: o motor gravou num JSON novo, com uma linha `WARN` (classe `telemetria-anormal`), e o
que ele gravou entra no banco quando ele voltar. Nessa subida sem banco o diário começa vazio: a
tela mostra só o consumo dela, e a retomada de uma sessão cuja linha anterior está no banco não
acha o cursor e sai com custo desconhecido (`missing-baseline`), sem contar em dobro no agregado.

A prova com os dados reais é `tools/comparar-consumo-sqlite.js`: a rota e o snapshot dão o mesmo
JSON, comparado com as chaves ordenadas, antes e depois. O "antes" do teste de paridade é o
caminho JSON desta versão, que passa às mesmas funções do código anterior; a prova com os dados
reais rodou também contra o código anterior, com o mesmo resultado. A cópia segura do arquivo e o
que falta decidir (retenção, backup) estão em [`HOSPEDAGEM.md`](HOSPEDAGEM.md#o-banco-da-telemetria).

## De onde vem o custo

O custo em dólar só existe no evento final da sessão do Claude (`total_cost_usd`). É um
número calculado pelo CLI: referência, não confirmação de cobrança. O motor não tem tabela de
preços.

Cada linha do diário carrega `costSource` (`lib/engine/usage.js`):

- `medido`: veio do evento final;
- `estimado`: a sessão morreu antes do evento final, então os tokens são medidos e o custo é
  estimado pela taxa (dólar por token de saída) das sessões concluídas do mesmo modelo, que
  estão no próprio registro. Entra na soma, com a origem dita;
- `desconhecido`: não há taxa para estimar (menos de três sessões medidas do modelo, ou sessão sem
  token de saída). Não entra na soma do custo, e é contado à parte.

## A conta por modelo e as retomadas

O uso que o evento final informa cobre só o coordenador; `modelUsage`, quando vem completo,
cobre a árvore inteira, com os subagentes (`lib/engine/usage-accounting.js`). Uma sessão com
dois modelos participa dos dois, e é uma sessão só no total. Se a soma por modelo não fecha
com o total da linha, os tokens ficam como "Sem atribuição por modelo", em vez de serem
distribuídos por suposição.

Numa sessão retomada (`--resume`) o CLI devolve o total acumulado. O registro guarda um
cursor por conta, perfil e sessão do provedor (`accounting`), e a retomada grava a diferença
em relação ao último total confirmado. Sem cursor confiável (total que encolheu, modelo que
sumiu), o gasto incremental fica desconhecido, em vez de o total antigo ser gravado como
gasto novo.

## `GET /api/usage`

Lê o diário inteiro, sob demanda: o snapshot leva só um resumo e as 100 sessões mais recentes
(`lib/usage/`, `lib/engine/usage-activity.js`). Só lê.

| Parâmetro | Valor |
|---|---|
| `start`, `end` | Dias inclusivos, `AAAA-MM-DD`, no dia de Brasília. Padrão: os últimos 30 dias. Data futura ou intervalo invertido responde `{ ok: false, motivo }` |
| `account`, `provider`, `model`, `kind`, `repo`, `device`, `profile` | Filtro por igualdade; ausente ou `all` não filtra. `profile` é o perfil do Claude da sessão. `kind` é `review`, `pushback`, `chat`, `tool` ou `outro` (`chat` e `tool` só aparecem em registro antigo: o motor não abre mais essas sessões). `device` só tem o valor `local` |
| `search` | Até 200 caracteres, sem caixa, sobre a referência, o tipo e o modelo. Restringe só o histórico |
| `focus` | `review` (operações de revisão concluídas no período) ou `pr` (um por PR). Restringe só o histórico |
| `author` | O autor do PR, sem caixa. Vem das decisões pelo `ref` da linha (a pendente e a mais recente primeiro); linha de PR sem decisão não tem autor |
| `page`, `pageSize` | Página do histórico, base zero; `pageSize` operações por página, padrão 8, teto 50 (valor torto vale o padrão) |
| `formato` | `csv` (o único): as operações do histórico que passam nos filtros, todas e sem página, como `text/csv` para baixar, com o escape do CSV do Histórico. Outro valor, ou repetido, responde 400 com `campo: "formato"` |

A resposta traz `range`, `options` (os valores de cada filtro), `totals`, `byKind`,
`completed` (`reviews` e `prs`), `retries`, `unidentified`, `since` e `sinceDay` (o instante e o dia da linha mais antiga do diário),
`series` (por dia),
`models`, `repos`, `porGatilho`, `history` e `incomplete` (o diário tem menos linhas que o agregado espera).

Desde 19/11/2026 (redesenho, lote 2):

- `thinkingTokens` (os tokens de pensamento) entra nos totais, em cada balde, nas linhas e em
  `models`. Cada modelo leva também `costUsd` (o custo que o provedor mediu por modelo quando a
  linha o tem, senão o da linha) e `unknownCost` (as linhas de custo desconhecido, que não somam).
- Cada linha tem `gatilho`, por que a sessão rodou: `primeira` (a revisão pedida, pela fila ou
  pelo clique), `commit_novo` (o round automático depois de um push), `rodada_extra` (o motor
  revisando de novo o mesmo commit: o desfecho sem mesa, a busca da prova e a reconferência
  técnica) ou `contestacao` (a leitura do pushback). É gravado no registro daqui em diante
  (`lib/engine/gatilho-da-sessao.js`); o registro antigo sem marca, e o que perdeu a marca num
  reinício, conta como `primeira` na revisão e `contestacao` no pushback; conversa e ferramenta
  ficam vazias. `porGatilho` soma o período por gatilho, com o vazio à parte, como `repos`.
- Cada linha tem `author` e, na página, a decisão da rodada dela (`lib/engine/consumo-das-sessoes.js`):
  das decisões do mesmo PR, a primeira criada no registro da linha ou depois. Dela saem
  `decisaoId`, `etapas` (`[{ id, label, ms }]`), `card` e `arquivosLidos` (das provas), cada um
  só quando a decisão o tem. A rodada que ainda não decidiu, e o pushback, ficam sem eles. Com o
  histórico indisponível o relatório sai igual, sem autor e sem esses campos.
- `history.pageSize` diz o tamanho da página usado.

Como ler:

- As tentativas são agrupadas em operações pelo id do motor, com conta, perfil e tipo. Ids
  diferentes não são unidos por PR nem por horário. Linha sem id reconhecível entra no
  consumo e não permite inferir conclusão nem retentativa (`unidentified`).
- Concluída é a operação cujo último resultado é `ok` e cai no período e nos filtros. É
  resultado técnico, não publicação de review no GitHub.
- Retentativa é toda tentativa depois da primeira da operação, contada no recorte em que
  ocorreu.
- Tokens de entrada e saída ficam separados dos de cache.

## Saída pública única (`reviewSingleOutput`)

Opção experimental, desligada por padrão e só por arquivo (`POST /api/settings` devolve a
chave em `ignoradas`). Ligada, o prompt pede `reviewOutputVersion: 1` e um único objeto
`review`, com `event`, `body` e `comments`, para o veredito escolhido, sem `payloads` nem
`reviewMarkdown` (`lib/engine/review-output.js`). O parser expande o resultado para o
contrato que o resto do motor usa, recusa versão desconhecida, contrato misturado e evento
incompatível com o veredito, e não cria aprovação alternativa para um pedido de mudanças. Os
gates de postagem não mudam.

`node tools/replay-saida-review.js arquivo.json [outro.jsonl ...]` compara, sem modelo e sem
publicar, o envelope antigo com a representação única equivalente. Mede a representação de
uma conclusão já produzida, não a qualidade da decisão: o relatório traz
`decisionQualityMeasured: false`.
