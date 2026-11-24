# Sync por herança: ler só o que a sincronização trouxe de novo

Data: 24/11/2026. Estado: aprovado pelo dono em 24/11/2026, com as três decisões da seção "Decisões do dono".

## Intenção e porquê

O PR de sincronização entre branches contínuas (homologation para development, o merge-back da
production, a bancada para a homologation) leva para uma branch o que já foi revisado em PRs
mesclados na outra. Hoje o motor relê o diff inteiro. Medido em `biudtech/engine-ai#1489`
(24/11/2026, "sync da homologation na development"): 65 arquivos, 1 min 45 s de sessão,
US$ 0,91, e o dono perguntou por que um "simples sync de ambiente" passou por revisão completa.
Dos 65 arquivos, 57 estavam idênticos à ponta da homologation que o merge trouxe; 8 tinham
conteúdo misturado das duas branches (resolução de conflito ou trabalho das duas pontas):
`prisma/schema.prisma`, `common/zone-ownership/mapa-de-zonas.ts`,
`apps/engine-ai/src/mia-whatsapp/whatsapp-chat.service.ts` e mais cinco.

A decisão do dono (24/11/2026, opção 1 de três): **herdar os idênticos sem ler e revisar só os
misturados**. O conteúdo que nenhum PR revisou como está (a resolução de conflito) continua
passando pela sessão; o que já foi revisado não é relido.

## Objetivos

1. Reconhecer como sincronização também o PR cujo head é uma branch de trabalho do sync
   (`sync/homologation-into-development-20261124`), não só o que tem head em branch contínua.
2. Antes da sessão, separar o diff em **herdados** (idênticos à ponta da origem e sem trabalho
   próprio da base que o sync sobrescreva) e **a ler** (o resto).
3. A sessão lê e prova só os arquivos a ler; os herdados contam como cobertos, com a origem dita.
4. Sem nenhum arquivo a ler, o sync é decidido sem sessão (como o diff vazio de linhagem).
5. O resultado limpo continua dependendo de não haver defeito nos arquivos lidos.
6. A decisão registra quantos arquivos foram herdados e quantos lidos, e de onde veio a herança.

## Não objetivos

- Mudar a revisão de PR que não é sincronização.
- Aprovar sem sessão quando há arquivo misturado (era a opção 3, recusada).
- Afrouxar portão de postagem, dedup por head, PR próprio, espera do CI ou instância isolada.
- Herdar entre PRs comuns por nome de arquivo.

## Anti-objetivos (falha mesmo que funcione)

- Aprovar uma resolução de conflito que ninguém leu.
- Herdar arquivo em que a base tinha trabalho próprio que o sync apagou: o arquivo idêntico à
  origem pode ser justamente o "aceitei o lado da origem" que jogou fora o trabalho da base.
- Herdar por nome de branch ou por mensagem de commit, sem conferir conteúdo.
- Herdar quando a medição falha ou fica incompleta (falta de dado nunca vira herança).

## Restrições

- Os invariantes do `CLAUDE.md` do repositório (Node puro, log sem ruído, nada postado sem gate,
  testes de gate intocados, só Linux, português sem travessão).
- O teto da comparação do GitHub: 300 arquivos por `compare` (o mesmo de
  `heranca-de-producao.js`). Acima disso, não há herança e a revisão é a de hoje.
- A conta revisora lê pelo `gh` com o token dela; a medição custa poucas chamadas por PR.
- O ratchet de lint (`tools/quality/baseline.json`), em especial o teto de linhas do
  `lib/engine/review.js`.

## Abordagens consideradas

1. **Sessão só nos misturados (escolhida pelo dono).** Herda os idênticos, lê só os misturados;
   sem misturados, decide sem sessão. Mantém a leitura onde há conteúdo novo, com o menor tempo e
   custo possível no resto.
2. **Tudo ou nada.** Sem sessão só quando não há nenhum misturado; com um, revisão completa. Mais
   simples, mas quase não dispara (o próprio #1489 tinha 8).
3. **Confiar no merge.** Sem sessão sempre que todos os commits vieram de PRs mesclados. O mais
   rápido, e aprova sem leitura o único trecho que ninguém revisou.

## O desenho

### 1. A procedência do sync (quem é a origem)

Novo critério, ao lado do atual de `lib/engine/pr-de-sincronizacao.js` (que continua valendo
para head e base contínuas):

- A **base** é contínua ou bancada (lista atual: `production`, `homologation`, `development`,
  `main`, `master`, `release_hmg_*`, `release_prd_*`), e o PR não vem de fork.
- A **origem** é uma branch contínua ou bancada **diferente da base**, e a **foto da origem** é um
  commit dela:
  - head contínuo: a origem é o head, a foto é a ponta dele (o caso de hoje);
  - head de trabalho (`sync/*` ou qualquer nome): a foto é o **segundo pai de um merge commit do
    PR** cujo primeiro pai está na linhagem da base, e a origem é a branch contínua ou bancada que
    contém essa foto (o `compare <origem>...<foto>` com `behind_by` 0 a partir da foto, ou seja,
    a foto é ancestral da ponta da origem). Com mais de um merge commit candidato, vale o mais
    recente na lista de commits do PR; sem nenhum, não há origem.
- Os commits do PR que **não** são merge commits do próprio sync seguem a regra atual: cada um já
  entrou por um PR mesclado, que não é este, numa branch contínua ou bancada.
- Qualquer leitura que falhe, venha torta ou cortada (mais de 100 commits na consulta GraphQL,
  mais de 300 arquivos no compare) devolve "não é sync com herança", e a revisão é a de hoje.

A medição roda **antes da sessão**: em `prepareReviewReading` (`lib/engine/analysis-source.js`,
depois do inventário e das heranças que já existem, antes do fan-out e do prompt). A detecção
atual, que hoje só roda depois da sessão (`estado-desmentido.js:checksEEstadoDoPr`), passa a
reaproveitar esta medição quando ela existe, para a marca `sincronizacao` (e a classe limpa de
`ressalvas.js`) valer também para o head de trabalho.

### 2. Herdados e a ler

Para cada arquivo do inventário do PR (diff contra a base):

- **herdado** quando as duas coisas valem:
  1. o conteúdo no head é igual ao da foto da origem (o arquivo não aparece em
     `compare <foto>...<head>`; renomeado conta pelo caminho novo e pelo antigo);
  2. a base **não** mexeu no arquivo desde o ancestral comum com a foto, medido contra a **base no
     momento do merge do sync** (o primeiro pai do merge commit da foto), e não contra a ponta
     atual da base: o arquivo não aparece em `compare <merge-base(primeiro pai, foto)>...<primeiro
     pai>`. É contra essa base que quem fez o sync resolveu os conflitos; o que a base recebeu
     depois aparece como conflito no próprio GitHub. É a mesma régua de `heranca-de-producao.js`,
     que hoje está fixa na `production` e na ponta da base;
  3. o arquivo **não depende** de algo que o sync mudou: não importa nenhum arquivo a ler (os
     misturados) nem um arquivo que a base mudou desde o ancestral comum (a mesma medição do item
     2). A conferência usa o que o motor já tem para devolver herdado à leitura (a releitura de
     `inheritanceForContext` e o `revalidarAusenciaHerdada` em `analysis-source.js`, e o mapa de
     importação do contexto); arquivo cuja dependência não deu para conferir volta à leitura;
  4. o arquivo **não tem achado bloqueante aberto** de rodada anterior do mesmo PR
     (`review-rounds.js`): com achado aberto, ele volta à leitura, para a sessão conferir se
     ainda vale.
- **a ler**: todo o resto (inclusive o arquivo protegido que a regra atual exige ler, o que não
  deu para comparar, e o que aparece só de um lado).

O resultado entra como uma **terceira fonte de herança** (`juntarHerancas`,
`lib/engine/prova-do-repositorio.js`), com `origens` dizendo a branch e a foto
(`homologation@158c3d8`), e por isso flui sozinho para o que a herança já alimenta: as métricas e o
fan-out (`metricsIncrementais`), o bloco de prova do prompt (`fileProofBlock`, com uma terceira
variante de texto: "idêntico à ponta da homologation (commit 158c3d8), já revisado nos PRs de
origem"), a reconciliação da cobertura (`reconcileInheritedCoverage`, que põe o herdado em
`coverage.inherited`) e a gravação da prova. O índice de provas entre PRs continua sem os herdados
(`registrarNoIndiceDoRepositorio` já exclui `coverage.inherited`).

### 3. A sessão

- Recebe só os arquivos a ler no escopo de leitura e no bloco de cobertura, e a lista dos herdados
  com a origem, como contexto (pode abrir um herdado se precisar entender um misturado, mas não é
  cobrada por ele).
- O protocolo (`workspace-template/CLAUDE.md`, item 3bis, e `prompts/pr-review-auto.md`) passa a
  dizer: no sync com herança conferida pelo motor, o `reviewed` é o que a sessão leu; os herdados
  já estão cobertos pelo motor; não declarar herdado como lido; aprovar quando os lidos não têm
  defeito. A regra "não aprove o que não leu" continua valendo para os arquivos a ler.
- O alcance (quem usa o código fora do diff) é exigido só dos arquivos a ler.

### 4. Sem nenhum arquivo a ler

Quando todos os arquivos do diff são herdados, a revisão é decidida **sem sessão**, no mesmo ponto
e com o mesmo formato do diff vazio de linhagem (`lib/engine/diff-vazio-de-linhagem.js`):
APPROVE de texto fixo dizendo que o PR só leva para a base o que já foi revisado na origem
(N arquivos idênticos à ponta da `<origem>`, commit `<foto>`), a prova na memória
(`technicalApprovals`, com a marca de origem do motor, que a avaliação técnica na publicação
aceita só por ela) e todos os portões de `postReview`. Valem as mesmas condições daquele caminho:
política da conta que aprova sozinha, `reviewRoundsMode` diferente de `enforce`, origem do dono,
gente no head e label de outra conta encerram sem postar, head que andou marca `stale_head`.
(Isto é decisão minha, consequência direta da opção 1: sem nada a ler, não há o que a sessão
revise.)

### 5. Avaliação técnica e achados em arquivo herdado

- A avaliação técnica (`lib/technical-review/runtime.js`) roda sobre o diff inteiro. O achado
  automático em linha de arquivo herdado vira **dívida herdada da origem**, pelo mesmo desenho de
  `divida-fora-das-linhas.js` (que já rebaixa achado fora das linhas do PR): informa, não bloqueia
  a aprovação do sync. O achado em arquivo a ler segue a regra de hoje.
- O achado da sessão que ela marcar como herdado (`herdadoDaProducao`, hoje só para a production)
  é generalizado para a origem do sync: só é rebaixado se o arquivo estiver na lista de herdados
  do motor. A sessão nunca decide sozinha o que é herdado.

### 6. O que fica registrado

- A decisão leva `caminho: 'sync_por_heranca'` (ou `'sync_por_heranca_sem_sessao'`), a origem e a
  foto, e as contagens (`herdados`, `lidos`), projetadas para a tela como o `caminho` do diff vazio.
- Uma linha INFO no `farol.log` por decisão nesse caminho, com as contagens (motivo de decisão que
  alguém vai perguntar depois).
- O consumo não muda de forma: a sessão menor aparece como sessão menor.

## Testes que travam a regra

- Detecção: head contínuo (o caso de hoje), head `sync/*` com merge da origem, merge cujo segundo
  pai não é ancestral de branch contínua (não é sync), commit sem PR mesclado (não é sync), leitura
  que falha, compare no teto de 300 (sem herança).
- Separação: idêntico à foto e base intocada (herdado); idêntico à foto com a base tendo mexido
  (a ler: o sobrescrito); diferente da foto (a ler); renomeado; protegido.
- Sessão: o escopo e o bloco de prova com só os arquivos a ler; o `coverage.inherited` com os
  herdados; o resultado limpo com os lidos sem defeito; com defeito, a reprovação de sempre.
- Sem arquivo a ler: decide sem sessão, posta APPROVE com a prova do motor, e cada condição que
  encerra sem postar.
- Avaliação técnica: achado em herdado vira dívida; em arquivo a ler, segue bloqueando.
- O caso real: um fixture com a forma do `engine-ai#1489`. Medido pela revisão do desenho em
  24/11/2026: contra a base no momento do merge (primeiro pai `9c5f4d1`), 55 herdados e 10 a ler
  (os 8 misturados mais 2 que a base tinha tocado), antes da regra de dependência; contra a ponta
  atual da development, seriam 24 e 41. O fixture trava a primeira forma e a regra de dependência
  por cima dela.
- Dependência: arquivo idêntico à origem que importa um misturado, ou um arquivo que a base mudou
  (o `quadros-do-turno.ts` que a development apagou no caso real), volta à leitura.
- Achado bloqueante aberto de rodada anterior num arquivo que seria herdado: volta à leitura.
- Nenhum teste de gate muda (postagem, dedup por head, espera do CI, PR próprio, credencial,
  linguagem, instância isolada).

## Decisões do dono (24/11/2026)

Levantadas pela revisão do desenho por um construtor independente, que mediu o `engine-ai#1489`:

1. A régua "a base não mexeu no arquivo" usa a base **no momento do merge do sync** (primeiro pai
   do merge commit), não a ponta atual da base.
2. O arquivo herdado que **depende** de algo que o sync mudou (importa um misturado, ou um arquivo
   que a base mudou) **volta à leitura**. Isto deixa a decisão sem sessão mais rara, de propósito.
3. O arquivo com **achado bloqueante aberto** de rodada anterior **volta à leitura**.

Decisões minhas, que o dono pode rever: com mais de uma branch contínua contendo a foto, a origem é
a que a mensagem do merge cita, e sem citação a primeira da ordem `production`, `homologation`,
`development`, `main`, `master`, bancadas; a avaliação técnica roda também antes da decisão sem
sessão, e qualquer achado dela em arquivo que não seja herdado impede esse caminho; a sessão que
declarar um herdado como lido não muda nada (o herdado já está coberto pelo motor).

## O que fica com quem constrói

- Os nomes de função e de módulo (um módulo novo para a medição, ao lado de
  `pr-de-sincronizacao.js`, é o esperado).
- Como reaproveitar `heranca-de-producao.js` (generalizar com a origem como parâmetro, ou extrair a
  régua comum) sem mudar o comportamento dele para a production.
- O texto exato do APPROVE sem sessão e da variante do bloco de prova, no tom dos que já existem.
- A ordem das leituras do GitHub e o cache delas dentro de uma revisão.
- Documentação: `CLAUDE.md` (invariante 4 e mapa), `docs/REVIEW-GATES.md` e os guias que
  `test/guias-navegaveis.test.js` confere.
