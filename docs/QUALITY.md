# Contrato de qualidade do motor

Como o código do motor é organizado e verificado. Leia junto com o [`CLAUDE.md`](../CLAUDE.md),
que manda nos invariantes. O front de `web/` tem gate próprio (typecheck, ESLint, Vitest e
build), descrito em [`web/README.md`](../web/README.md): nada daqui vale para ele.

## Princípios

1. **Responsabilidade única por unidade.** Cada função e cada módulo faz uma coisa. Nada de
   função que busca no `gh`, decide, formata e posta tudo junto: cada passo é uma unidade
   nomeada.
2. **Separação de camadas.** A dependência aponta numa direção só: composição (quem liga as
   peças) → adapter (fala com o mundo: `gh`, HTTP, `claude`) → domínio (a regra: gate de
   aprovação, política da conta) → dados (ler e gravar estado em disco).
3. **Estrutura consistente.** Coisas parecidas têm a mesma forma. Os normalizadores de config
   moram juntos em `lib/parse.js`; as preferências têm uma tabela só, `lib/settings.js`.
4. **Erros classificados num ponto só.** A classificação de falha mora em
   `lib/log-taxonomy.js`; não há regex de erro espalhada. Não existe classe de erro de
   aplicação nem tratamento central de exceção, e há `catch` vazio com e sem justificativa: é a
   lacuna conhecida, e o `emptyCatch` do ratchet impede que ela cresça.
5. **Gate automático.** Sem ferramenta de hook por pacote (seria dependência, contra o
   invariante 1). O gate é o trio abaixo, no CI e no pre-push.
6. **Testabilidade por construção.** O servidor HTTP (`lib/http-server.js`) é separado da
   `Engine`, e o `server.js` só sobe o motor quando executado direto (`executadoDireto`, em
   `lib/paths.js`). Nunca faça trabalho no nível de topo de um módulo.

O que o motor não usa, de propósito: framework HTTP (é um `http.createServer`), banco (o
estado é arquivo em `~/.farol`), TypeScript e build (a validação é função pura de
normalização), biblioteca de autenticação (a da API é `lib/local-auth/`, em Node puro).

## Como o código está dividido

A classe `Engine` (`server.js`) guarda o estado e o ciclo, e delega para colaboradores de
`lib/engine/`. O padrão do colaborador: funções `(engine, ...args)`, sem `this`, e a `Engine`
ganha um método-fachada `x(a) { return mod.x(this, a); }`. `test/facades.test.js` deriva do
fonte a aridade esperada de cada fachada e exige um piso de 80 fachadas casadas, para a
varredura não passar vazia.

O que as extrações ensinaram, e vale para qualquer movimentação de código:

1. **Mover pode quebrar sem que nada acuse.** Uma constante deixada para trás vira
   `ReferenceError` de runtime: `node --check` passa, e a suíte passa se nada executa o código
   recém-chegado. O primeiro teste de um bloco movido só executa cada função.
2. **Extraia de baixo para cima.** Primeiro as folhas, só então o compositor.
3. **Asserção de texto sobre um arquivo fica cega quando o código sai dele.** A resposta não é
   repontar o regex, é migrar a asserção para teste de saída, e provar por mutação que o teste
   novo reprova o defeito antigo.
4. **O ratchet reclama de mudança de casa.** O `ternarioAninhado` conta `?` por trecho separado
   por `;`, depois de remover comentários e strings (`tools/quality/strip.js`). Mover ternário
   de arquivo só troca a dívida de lugar. Antes de perseguir o número, leia como ele é medido
   (`scanFile`, em `tools/quality/rules.js`).
5. **Achado de comportamento num refactor fica registrado em teste, não corrigido.** Mudar
   comportamento é decisão de produto.

## O gate, em um comando

```bash
npm run check && npm run lint && npm test
```

- `check` = `tools/check-syntax.js`: descobre todo `.js` do motor e roda `node --check` em cada
  um, por processo filho. Imprime quantos achou e reprova abaixo de um piso de 25 arquivos.
- `lint` = `tools/quality/gate.js` (o ratchet, abaixo) seguido de `tools/quality/higiene.js`
  (número de card em código só aparece na forma `TODO(BT-123)`; `docs/`, `workspace-template/`
  e `assets/` ficam fora).
- `test` = `tools/rodar-testes.js`: `node --test` sobre os testes do motor, com até quatro
  arquivos em paralelo e limite de 120 segundos por teste. `FAROL_TEST_CONCORRENCIA` aceita um
  inteiro de 1 a 4 (`FAROL_TEST_CONCORRENCIA=1 npm test`); outro valor é erro.

Os três, e o `npm run server`, passam antes por `lib/node-runtime.js` (os scripts `pre*` do
`package.json`), que confere plataforma e versão do Node. As três ferramentas não abrem
`web/` (`tools/nao-e-fonte.js`).

**Onde o gate roda.** No CI (`.github/workflows/ci.yml`), em todo push na `main` e em todo PR
para a `main`, em `ubuntu-latest` com Node 24.22.1: o job `gate` roda `check`, `lint` e
`test` sem `npm install`; o job `web` roda o gate do front; o job `ci` agrega os dois. E
localmente no pre-push (`tools/hooks/pre-push`, instalado por `npm run hooks:install`, que
grava `core.hooksPath` no clone): recusa push direto na `main` e roda `check`, `lint` e
`test`, nessa ordem, parando no primeiro vermelho. O pre-push não substitui o CI.

## Gate de ratchet

`tools/quality/gate.js` compara as violações de hoje com `tools/quality/baseline.json` e
reprova qualquer contagem que suba; arquivo que não está na baseline vale zero. Corrigiu
dívida? `npm run lint:update` regrava a baseline com o número mais baixo. A baseline nunca sobe
à mão. Ele mede o código de produção: `test/`, `docs/`, `workspace-template/`, `assets/` e
`web/` ficam fora da varredura.

Regras medidas (chaves de `tools/quality/rules.js`):

1. `maxLines`: o excesso de linhas úteis acima de 400 (zero quando o arquivo está dentro do
   teto). Como conta o excesso, crescer um arquivo que já está acima reprova.
2. `emptyCatch`: bloco `catch` vazio sem comentário de intenção.
3. `varUse`: uso de `var`.
4. `jsonParseCru`: `JSON.parse` direto fora de `lib/io.js`.
5. `jsonStringifyCru`: `JSON.stringify` direto fora de `lib/io.js`.
6. `processEnvDireto`: `process.env` direto fora de `lib/paths.js` e `lib/env.js`.
7. `ternarioAninhado`: dois ou mais `?` de ternário no mesmo statement.
8. `tempoMagico`: número de tempo em propriedade (`timeout: 5000`) ou na forma
   `N * 60 * 1000`.
9. `portaLiteral`: a porta 47170 escrita fora de `lib/constants.js`.
10. `profundidadeExcedida`: profundidade de chaves acima de 3 níveis dentro de função.

São aproximações sem árvore sintática, assumidas no cabeçalho do `rules.js`: o gate mede
regressão contra a baseline, então imprecisão estável não atrapalha. Não confunda o contador
com a regra: contorcer código legítimo para zerar o contador é perseguir métrica.

**Dívida que muda de caminho.** O teto é por arquivo, então mover código com dívida registrada
reprova no destino mesmo sem nada ter piorado. Nesse caso a entrega roda `npm run lint:update`
e prova, no próprio commit, que o total por regra não subiu.

### A baseline de hoje

Medida em 16/11/2026, no fechamento da fase 4, por `npm run lint:update`: 14 arquivos com
dívida registrada. Total por regra:

| Regra | Total |
|---|---:|
| `maxLines` | 979 |
| `profundidadeExcedida` | 32 |
| `jsonParseCru` | 11 |
| `ternarioAninhado` | 6 |
| `processEnvDireto` | 5 |
| `jsonStringifyCru` | 4 |
| `emptyCatch` | 3 |
| `tempoMagico` | 1 |

Os três arquivos acima do teto de 400 linhas úteis:

| Arquivo | Linhas no arquivo | Linhas úteis | Excesso (`maxLines`) |
|---|---:|---:|---:|
| `lib/engine/review.js` | 1452 | 838 | 438 |
| `server.js` | 1365 | 779 | 379 |
| `lib/engine/decision.js` | 898 | 562 | 162 |

Número que não for medido de novo sai, em vez de ficar: a fonte é o `baseline.json`.

## Achar trava sem guarda (auditoria de mutação)

O gate diz se a suíte passa; não diz se a suíte testa alguma coisa. O método para descobrir é
bruto: apague a trava, rode a suíte inteira, veja se alguém reclama. Zero falhas significa que
aquela linha não tem dono.

A heurística que sobra disso: **assimetria é cheiro.** Quando um invariante é guardado de um
lado (aprovar) e esquecido do outro (reprovar), ou um caminho novo faz diferente de um caminho
velho equivalente, o velho quase sempre tem uma razão. Vale repetir a varredura quando mexer
em gate, e obrigatoriamente antes de afrouxar qualquer trava.

## Pendências conhecidas

1. **Comentários de teste que explicam o patch pelo mecanismo antigo.** `test/boot.test.js` e
   `test/account-identity.test.js` ainda falam em `require`; o mecanismo de hoje é patch no
   objeto default e `await import()` depois.
2. **Trava estrutural nos módulos de patch.** `run` e `runShell` (`lib/io.js`) e `prMetrics`
   (`lib/engine/fanout.js`) só existem no export default, para o teste poder trocá-los. Hoje
   isso é só a ausência deles na lista de exports nomeados; uma checagem em
   `tools/quality/higiene.js` transformaria a regra em gate.
3. **Redução do `maxLines`.** O gate impede crescer; reduzir os três arquivos da tabela é
   trabalho de decomposição planejada.
