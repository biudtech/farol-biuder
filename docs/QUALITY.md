# Contrato de qualidade do Farol

Diretriz de qualidade de código do Farol, extraída de uma referência de backend em camadas e adaptada ao stack do Farol (Node puro, sem dependência npm de runtime, sem framework). Leia junto com o `CLAUDE.md` (que manda nos invariantes do app). Este arquivo manda em COMO o código é organizado e verificado.

## De onde vem

A referência é um backend TypeScript com framework HTTP, ORM e validação por schema, com uma arquitetura em camadas madura. O valor dela pro Farol não é o stack (que é o oposto do nosso), é o conjunto de princípios que tornam o código previsível e seguro de mudar. Abaixo separo o que transfere do que não transfere, pra não copiar cegamente.

## Princípios universais (valem pro Farol)

1. **Responsabilidade única por unidade.** Cada função e cada módulo faz UMA coisa: fiação, adapter, regra e acesso a dados, cada um no seu arquivo. No Farol a tradução é: nada de função que busca no gh, decide, formata e posta tudo junto; cada passo é uma unidade nomeada.

2. **Separação de camadas.** O fluxo tem estágios distintos e a dependência aponta numa direção só: composição (quem liga as peças) → adapter (fala com o mundo: gh, http, claude) → domínio (a regra: gate de aprovação, política da conta) → dados (ler/gravar estado em disco). A camada de baixo não conhece a de cima.

3. **Estrutura consistente e previsível.** Coisas parecidas têm a mesma forma. Normalizadores de config moram juntos em `lib/parse.js` e seguem o mesmo formato de entrada e saída.

4. **Erros tipados e centralizados.** Erros de operação com causa clara (rede, limite de sessão, binário do claude ausente) são classificados num ponto só, não com `catch` improvisado espalhado. A classificação de falha mora em `lib/log-taxonomy.js`, e o `farol.log` (invariante 3: só falhas) é o ponto central.

5. **Gate automático, não manual.** O Farol não usa ferramenta de hook por pacote (seria dependência, viola o invariante 1), mas tem o equivalente dentro do zero-deps: `npm run check` (`node --check` em todo `.js`) + `npm run lint` (catraca de qualidade + higiene) + `npm test` (runner nativo `node --test`). Rodar isso é obrigatório antes de qualquer entrega, e é a rede que protege a decomposição em ondas. A mesma trinca roda no **CI** (`.github/workflows/ci.yml`) em todo push na `main` e em todo PR para a `main`, em `ubuntu-latest` com Node 24.22.1, que é a plataforma do motor. O job agregador `ci` é o status check exigido pela proteção da `main`, o que permite mexer no job `gate` sem reconfigurar a regra.

6. **Testabilidade por construção.** O servidor HTTP é separado da `Engine`, e o `server.js` só sobe quando executado direto (`executadoDireto`, em `lib/paths.js`). Importar o `server.js` ou um módulo de `lib/` não tem efeito colateral (só `new Engine()` toca disco). Isso é o que torna o teste possível: preservar essa propriedade é regra (nunca fazer trabalho no top-level do módulo).

## O que NÃO transfere (não force no Farol)

Estes são específicos do stack da referência e violariam os invariantes do Farol (ver `CLAUDE.md`, invariante 1: o motor roda em Node puro, sem dependência npm de runtime):

- **Framework HTTP, plugins, ciclo de request/response.** O Farol tem um `http.createServer` mínimo, de propósito.
- **ORM sobre banco.** O estado do Farol é arquivo em `~/.farol`, não banco. A ideia de "acesso a dados isolado" transfere; o ORM não.
- **Schema-first e tipos derivados.** Não há TypeScript nem build. Validação continua sendo função pura de normalização (`parse*`).
- **Fatias verticais por rota.** Estrutura boa pra HTTP REST; o Farol é um engine de polling + orquestração, e a decomposição natural é por RESPONSABILIDADE (gh, review, decisão, sessão), não por rota.
- **Bibliotecas de autenticação e rate-limit.** A API local do Farol escuta em `127.0.0.1` por padrão; a autenticação dela é a de `lib/local-auth/`, em Node puro.

## Como o Farol aplica isso (plano em ondas)

O débito original era o `server.js`: uma classe `Engine` de 3122 linhas fazendo tudo (o oposto dos princípios 1 e 2). A correção é decompor em ondas, cada uma protegida pela rede de teste, sem mudar comportamento e sem quebrar os invariantes do `CLAUDE.md`.

- **Onda 0 (feita):** este contrato + a rede (`npm test`, `npm run check`), baseline verde.
- **Onda 1 (feita):** funções puras sem estado pra `lib/` (`format`, `io`, `parse`, `taxonomy`), com teste.
- **Onda 2 (feita):** camadas base `lib/paths.js` (versão, plataforma, caminhos), `lib/workspace.js` (leitura dos artefatos do workspace) e `lib/http-server.js` (adapter HTTP+SSE), e a `Engine` separada por responsabilidade em `lib/engine/` (colaboradores que recebem o `engine` como ctx; a `Engine` mantém fachadas finas que delegam), como `pushback`, `decision`, `gh-queries`, `session` e `review` (pipeline headless + gate). O que ficou na `Engine` é o núcleo legítimo (composição, ciclo de vida, política da conta, polling, settings e snapshot).
- **Onda 3 (feita):** cobertura e gate. Havia módulos de produção sem nenhum teste, e o teste do `pushback.js` era uma cópia manual do gate, ou seja, testava o teste. O `npm run check` validava três arquivos escolhidos a dedo e ignorava os de `lib/`. Corrigido: `tools/check-syntax.js` descobre todo `.js` do projeto, e `test/facades.test.js` deriva do fonte a aridade esperada de cada fachada, no lugar de uma tabela curada.
- **Onda 4 (feita, e depois migrada pra ESM; a `ui/` de que ela trata saiu em 16/11/2026):** o `ui/app.js` não tinha **nenhum** teste, porque é um script de navegador que toca `document` no top-level (o que também viola o princípio 6). As funções puras saíram para `ui/pure.js`, que usa `export` nativo; `ui/index.html` carrega um `<script type="module">` só, e o `node --test` importa o mesmo arquivo (`import * as P from '../ui/pure.js'`, ou `await import()` quando precisa vir depois de fixar `process.env`, como `TZ`).

  **Regra do arquivo puro:** só entra o que for puro. Função que precise de estado global ou de `document` fica nas telas; para trazer, primeiro passe o que ela lê como parâmetro.

- **Onda 5 (feita em passos, de 17/08 a 16/09/2026; a `ui/` saiu em 16/11/2026):** o render, o estado e a fiação que sobravam no `ui/app.js` foram saindo aos poucos. No fim o `ui/pure.js` era só uma fachada que reexporta os módulos de `ui/pure/` (um por assunto, em camadas sem ciclo; contrato em `ui/pure/README.md`), e o `ui/app.js` é o bootstrap da página: liga o SSE ao estado, comanda a troca de aba e o `data-goto` e inicializa as telas, que moram em `ui/telas/` e se registram em `ui/telas/registro.js` (contrato em `ui/telas/README.md`).

  O que os passos ensinaram, e vale pra qualquer extração:

  1. **Mover pode quebrar sem que nada acuse.** Uma constante deixada pra trás vira `ReferenceError` de runtime: `node --check` passa e a suíte passa se nada executa o código recém-chegado. Quem denuncia é comparar a saída da função antiga (reconstruída do `git show main:<arquivo>`, com os globais injetados) com a da nova, em várias entradas. O primeiro teste de um bloco movido só **executa** cada função.
  2. **Extraia de baixo pra cima.** Primeiro as folhas, só então o compositor; tentar o compositor antes arrasta as folhas impuras junto.
  3. **Asserção de texto sobre um arquivo fica cega quando o código sai dele.** Regex contra o fonte quebra quando o código se move sem mudar de comportamento. A resposta não é repontar o regex, é **migrar a asserção pra teste de saída**, e provar por mutação que o teste novo reprova o defeito antigo.
  4. **Import morto não quebra nada e por isso apodrece.** Símbolo importado que ninguém usa passa por `node --check`, pelo lint, pela suíte e pelo CI. A guarda mora em `test/app-carrega.test.js`.
  5. **O ratchet reclama de mudança de casa, e extrair para função não reduz a contagem.** O `ternarioAninhado` conta `?` por trecho separado por `;` no arquivo inteiro, depois de remover comentários e strings (`strip.js`). Mover ternário de arquivo só troca a dívida de lugar; o que reduz é nomear em `const` próprio ou tratar repetição com um helper. **Antes de perseguir o número, leia como ele é medido, e bisecte com o scanner de verdade** (`scanFile(source, relPath)`, em `tools/quality/rules.js`) em vez de reimplementar a fórmula.
  6. **Achado de comportamento num refactor fica registrado em teste, não corrigido.** Mudar comportamento é decisão de produto, não refactor.

### Números de hoje (mantenha esta linha viva)

| Arquivo | Linhas no arquivo | Linhas úteis (`maxLines`) |
|---|---|---|
| `server.js` | 1522 | 871 |
| `lib/engine/review.js` (maior módulo de `lib/`) | 1484 | 851 |
| `lib/engine/decision.js` | 898 | 562 |

A `ui/` (a tela antiga, que entrava nestes números) saiu em 16/11/2026, com os testes dela. Os números da tabela são os de 15/11/2026 e não foram medidos de novo depois disso.

Medidos em 15/11/2026, no commit `c16cb47c` (versão `3.0.0-dev`): linhas no arquivo por `wc -l`; linhas úteis por `scanFile` de `tools/quality/rules.js` (linhas não vazias depois de tirar comentários e strings), e os três arquivos da tabela são os únicos acima do teto de 400 segundo o `scanRepo` de `tools/quality/gate.js`; módulos por `git ls-files 'ui/pure/*.js' | wc -l` e `git ls-files 'ui/telas/*.js' | wc -l`; testes por `git ls-files 'test/*.test.js' | wc -l`.

Quem mexer aqui e deixar esses números defasados repete o problema que esta seção já teve: o documento afirmava "~2600 linhas com ~120 métodos" muito depois de o `server.js` ter caído para mil. Número que não foi medido de novo sai, em vez de ficar.

Padrão do colaborador: funções `(engine, ...args)`, todo `this.` vira `engine.`, e a `Engine` ganha um método-fachada `x(a) { return mod.x(this, a); }`. Assim nenhum chamador muda e o comportamento é idêntico.

Regra de cada onda: extrai um pedaço → `grep this.` no módulo novo deve dar zero → `npm run check && npm run lint && npm test` verde → só então segue. Sem regressão; refactor é movimentação, não reescrita.

## O ui/app.js virou executável em teste (18/08/2026)

> Registro histórico: a `ui/`, o `test/app-carrega.test.js` e o DOM de mentira
> (`test/helpers/dom-stub.js`) saíram em 16/11/2026, com a tela antiga. O front de `web/` tem
> gate próprio.

A onda 5 carregava um custo declarado: **nenhum teste executava o `ui/app.js`**. Os
arquivos que o "testavam" liam o fonte como texto e casavam regex, e num único dia isso
deixou passar dois bugs, ambos com sintaxe válida e CI verde:

1. bloco de Consumo movido pro `pure.js` deixando `USAGE_KIND_COLOR` pra trás;
2. um regex de conversão enfiando `ctxRev` **dentro** da string `'var(--accent)'`, o que
   quebrou uma tela inteira, em produção, por duas releases.

`jsdom` resolveria e está fora (invariante 1). Então entrou `test/helpers/dom-stub.js`:
um DOM mínimo escrito à mão, deliberadamente burro, que existe pra **uma** pergunta:
"carregar a tela e desenhar com um estado plausível levanta exceção?".

O caminho exercitado é o mesmo do app real: o handler de `state` do SSE, que é o
orquestrador de render. `test/app-carrega.test.js` dispara estados plausíveis nele,
inclusive com as abas Sistema e Consumo **ativas** (esses ramos só desenham quando a
aba está ativa, e foi assim que a primeira versão do teste deixou passar a mutação do
Consumo).

Provado por mutação: reintroduzir qualquer um dos dois bugs reprova o teste, e
`node --check` continua passando nas duas versões corrompidas, que é o ponto.

**O limite, pra ninguém confundir cobertura com garantia:** o stub não faz layout,
cascata nem evento de verdade. Verde aqui não diz que a tela está certa, diz que ela
não explode. Validar visual e clique continua sendo abrir o app.

Nota de operação: o script de test chegou a usar `--test-force-exit`, porque carregar o
`app.js` liga os timers dele e o runner esperava o event loop drenar.
Ele saiu em 13/11/2026: o encerramento forçado truncava o relatório de alguns arquivos,
e um teste que falhasse no trecho cortado não apareceria.

## Achar trava sem guarda (auditoria de mutação)

O gate diz se a suíte passa. Ele **não** diz se a suíte testa alguma coisa. A
diferença apareceu em 17/08/2026, quando a pergunta virou "o que dá pra quebrar sem
ninguém perceber?".

O método é bruto e funciona: **apaga a trava, roda a suíte inteira, vê se alguém
reclama.** Zero falhas significa que aquela linha não tem dono.

Rodado sobre as 15 travas do caminho de decisão e postagem, achou **três** sem guarda,
todas com a mesma assinatura: um par onde uma metade tinha teste e a outra não.

| trava | approve | reject |
|---|---|---|
| clique nunca auto-posta | 2 testes | **nenhum** |
| cobertura incompleta | 8 testes | **nenhum** |
| token da conta dona (não é par, é única) | n/a | **nenhum** |

As duas primeiras eram assimetria pura: o mesmo invariante, guardado de um lado e
esquecido do outro, sendo que o comentário do código dizia que o lado desguardado era
o *mais* grave ("reprovar com leitura parcial é pior ainda"). A terceira era a única
coisa impedindo um review de sair assinado pela conta errada.

**A heurística que sobra disso, e que vale pra revisar qualquer contribuição: assimetria
é cheiro.** Quando um caminho novo faz diferente de um caminho velho equivalente, o
velho quase sempre tem uma razão. Foi assim que os dois furos do reenvio apareceram
também: `retryFailedPosts` e `decide()` fazem a mesma coisa (postar um payload decidido
antes) e só um deles lia o head ao vivo.

Vale repetir a varredura quando mexer em gate, e obrigatoriamente antes de afrouxar
qualquer trava: se apagar a linha não reprova nada, o teste que deveria protegê-la não
existe, e o próximo a mexer ali não vai ter aviso nenhum.

## O gate, em um comando

```bash
npm run check && npm run lint && npm test
```

- `check` = `tools/check-syntax.js`, que **descobre** todo `.js` do projeto (ESM nativo; o gate imprime quantos achou, e por isso o número não é escrito aqui) e valida a sintaxe rodando `node --check` por processo filho em cada um.
- `lint` = `tools/quality/gate.js` (o ratchet, ver abaixo) seguido de `tools/quality/higiene.js` (número de card em código só aparece na forma `TODO(BT-123)`; `docs/`, `workspace-template/` e `assets/` ficam fora).
- `test` = `tools/rodar-testes.js`, que executa a rede completa no runner nativo do Node.

Os quatro scripts passam antes por `lib/node-runtime.js` (os `pre*` do `package.json`), que confere a versão do Node. Verde nos três é pré-requisito de qualquer entrega.

A suíte executa até quatro arquivos em paralelo. Em máquina ocupada, `FAROL_TEST_CONCORRENCIA` aceita um inteiro de 1 a 4 para reduzir a disputa por recursos; casos, asserções, limites de tempo e código de saída continuam os mesmos. Por exemplo: `FAROL_TEST_CONCORRENCIA=1 npm test`. O CI usa o padrão de quatro arquivos.

**Onde o gate roda.** No CI, como passos do job `gate`. E localmente no pre-push (`tools/hooks/pre-push`, instalado por `npm run hooks:install`, que grava `core.hooksPath` no clone): ele recusa push direto na `main` (o caminho é branch, PR, `ci` verde e merge) e depois roda `check`, `lint` e `test`, nessa ordem, parando no primeiro vermelho. O pre-push não substitui o CI: o que vale como plataforma é o Linux do CI.

Os dois testes estruturais da rede trazem **piso anti-vacuidade** (`test/facades.test.js` exige um mínimo de fachadas casadas, `tools/check-syntax.js` um mínimo de arquivos encontrados): verificação dirigida por varredura que deixa de casar vira laço vazio e fica verde sem verificar nada, que é a pior falha possível num gate.

### Princípio 4 ainda não está completo

Não existe classe de erro de aplicação nem tratamento central de erro. A classificação de falha já é única (`lib/log-taxonomy.js`), mas há `catch` vazios espalhados, alguns com justificativa no comentário ("best-effort", "log nunca derruba o app") e outros sem. É a lacuna conhecida deste contrato; o `emptyCatch` do ratchet impede que ela cresça.

## Gate de ratchet

O gate de ratchet é o enforcement mecânico local do Farol, em Node puro (`tools/quality/`): compara as violações com `tools/quality/baseline.json` e reprova qualquer contagem que SUBA (arquivo novo com violação é subir de zero). Corrigiu dívida? `npm run lint:update` trava o número mais baixo. A baseline nunca sobe à mão. Ele mede o código de produção: `test/`, `docs/`, `workspace-template/` e `assets/` ficam fora da varredura.

As regras se dividem em três grupos, e vale saber em qual cada uma cai.

- **Fonte de verdade única**: `jsonParseCru`, `jsonStringifyCru`, `processEnvDireto`, `portaLiteral` e `tempoMagico`. Distinguir invariante compartilhado de coincidência de valor normalmente exige entender o domínio; aqui o domínio é conhecido e os santuários são nomeados no `rules.js`, então dá pra medir sem adivinhar.
- **Forma do código**: `emptyCatch`, `varUse`, `ternarioAninhado`, `profundidadeExcedida`.
- **Tamanho**: `maxLines` (400) mede tamanho de arquivo, que não é o critério certo de responsabilidade única. O contador fica como ratchet sobre dívida já medida, não como afirmação de que tamanho é o critério certo. Tirá-lo é decisão do dono; deixá-lo sem dizer isto seria a divergência ficar escondida.

**Por que o `maxLines` conta linhas, e não arquivos** (22/09/2026). Até então ele valia 1 para o arquivo acima do teto e 0 para o resto, e isso abria um buraco no ratchet: arquivo que JÁ estava na baseline podia crescer à vontade, porque a contagem continuava 1. Medido no `server.js`, que a Onda 2 tinha levado a ~905 linhas: ele voltou a 2144 linhas em 15/09/2026 e chegou a 2326 em 22/09/2026, com o gate verde em cada um dos 51 commits do caminho. Hoje `maxLines` é **quantas linhas úteis o arquivo tem acima de 400**, então o ratchet que já existia passa a reprovar o crescimento sem mecanismo novo, e a promessa de que "a contagem só desce" vale também por dentro dos arquivos da dívida.

Regras medidas (chaves do `rules.js`):

1. `maxLines`: arquivo não pode exceder 400 linhas de código útil. A contagem é o EXCESSO (linhas úteis menos 400, zero quando está dentro do teto), então crescer um arquivo que já está acima reprova.
2. `emptyCatch`: blocos `catch` vazios sem comentário de intenção reprovam.
3. `varUse`: uso de `var` é reprovado; use `const`/`let`.
4. `jsonParseCru`: chamadas diretas a `JSON.parse` fora de `lib/io.js` reprovam.
5. `jsonStringifyCru`: chamadas diretas a `JSON.stringify` fora de `lib/io.js` reprovam.
6. `processEnvDireto`: acesso direto a `process.env` fora de `lib/paths.js` e `lib/env.js` reprova.
7. `ternarioAninhado`: dois ou mais ternários no mesmo statement reprovam.
8. `tempoMagico`: números mágicos de tempo (milissegundos, segundos) em propriedades ou cálculos reprovam.
9. `portaLiteral`: porta 47170 escrita em código fora de `lib/constants.js` reprova.
10. `profundidadeExcedida`: profundidade de chaves dentro de função acima de 3 níveis reprova (contada a partir do corpo da função).

**Dívida que muda de caminho** (15/09/2026). O teto é por arquivo e arquivo ausente na baseline vale zero (`comparar`, em `tools/quality/gate.js`), então mover código com dívida registrada reprova no destino mesmo sem nada ter piorado. Nesse caso a dívida acompanha o código: a entrega roda `npm run lint:update` e prova, no próprio commit, que **o total por regra não subiu** (somando as contagens do `baseline.json` antes e depois; nenhuma regra pode crescer). O que continua proibido é o total subir, que é dívida nova entrando pela porta dos fundos.

Não confunda o contador com a regra. O `ternarioAninhado` quebra o arquivo por `;` e conta `?` por statement, então ele também acusa ternário dentro de template literal (`\`${p ? 's' : ''}\`` dentro do ramo de outro ternário), que uma regra que lê a árvore sintática **não** acusaria: lá o pai do ternário de dentro é o template, não o ternário de fora. Contorcer código legítimo para zerar o contador é perseguir métrica, o mesmo motivo pelo qual o `maxLines` está declarado como divergência acima.

## Backlog da onda de qualidade (16/08/2026, deferido com veredito de review)

Itens julgados num review final como "não bloqueia, fica pra depois". Quem pegar qualidade em seguida, começa por aqui:

1. **Comentários de teste ensinando o invariante CommonJS morto**: `test/boot.test.js` (~linha 5) e `test/account-identity.test.js` (~15) ainda explicam o patch em termos de `require`/referência capturada no load. Pós-ESM o mecanismo real é outro (patch no objeto default + `await import()` depois). Reescrever os comentários pra ensinar o mecanismo atual.
2. **Trava estrutural nos módulos de patch**: a garantia de que `run`/`runShell` (`lib/io.js`) e `prMetrics` (`lib/engine/fanout.js`) só existem no default mutável é hoje uma omissão da lista de named exports. Uma checagem no `tools/quality/higiene.js` proibindo esses nomes em `export {}` desses dois arquivos transformaria a doutrina em gate.
3. **Ondas futuras do ratchet**: `maxLines` segue com 3 arquivos acima do teto (15/11/2026: `server.js` com 871 linhas úteis, `lib/engine/review.js` 851 e `lib/engine/decision.js` 562). O gate impede crescer; a redução é trabalho de decomposição planejada, não de correção pontual.
