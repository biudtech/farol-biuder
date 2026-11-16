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

O que continua medido: cada sessão no diário (`usage-sessions.json`), os agregados
(`usage.json`, por dia, tipo, conta e modelo), o custo com a origem dele e a chave `usage` do
snapshot, que não traz `budgets`. O agregado `byProfileDay` (gasto por perfil e dia) continua
sendo gravado e hoje não tem leitor.

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
| `account`, `provider`, `model`, `kind`, `repo` | Filtro por igualdade; ausente ou `all` não filtra. `kind` é `review`, `pushback`, `chat`, `tool` ou `outro` (`chat` e `tool` só aparecem em registro antigo: o motor não abre mais essas sessões) |
| `search` | Até 200 caracteres, sem caixa, sobre a referência, o tipo e o modelo. Restringe só o histórico |
| `focus` | `review` (operações de revisão concluídas no período) ou `pr` (um por PR). Restringe só o histórico |
| `page` | Página do histórico, base zero, oito operações por página |

A resposta traz `range`, `options` (os valores de cada filtro), `totals`, `byKind`,
`completed` (`reviews` e `prs`), `retries`, `unidentified`, `since`, `series` (por dia),
`models`, `history` e `incomplete` (o diário tem menos linhas que o agregado espera).

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
