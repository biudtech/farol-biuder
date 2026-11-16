# Front do Farol BIUD

A tela do Farol, em Next.js (App Router) e TypeScript estrito. O navegador fala direto com a
API do motor: `fetch` com `Authorization: Bearer`, e `x-farol: 1` em todo POST. Aqui não há
rota de API, cookie nem segredo.

Este pacote é independente do motor: tem `package.json`, `package-lock.json` e gate próprios.
Na Vercel, o diretório raiz do projeto é `web/`.

Hoje ele entrega a fundação (transporte, contratos, pareamento e a casca das cinco abas) e as
cinco telas: Radar, Histórico, Time, Consumo e Sistema.

## Rodar contra um motor local

O motor só roda em Linux (veja o [`CLAUDE.md`](../CLAUDE.md) da raiz). O front roda em qualquer
sistema com Node 24.

1. No `config.json` do motor (`~/.farol/config.json`, ou o do `FAROL_HOME` que você usa),
   libere a origem do front e reinicie o motor:

   ```json
   { "origensPermitidas": ["http://localhost:3100"] }
   ```

   A origem é comparada por igualdade exata: abra o front em `http://localhost:3100`, não em
   `http://127.0.0.1:3100`. Com `origensPermitidas` preenchida o motor passa a exigir
   autenticação em toda a API, e é isso que o pareamento resolve. O detalhe está em
   [`docs/CONFIGURATION.md`](../docs/CONFIGURATION.md#para-hospedar).

2. No front:

   ```sh
   cd web
   npm ci
   cp .env.example .env.local
   npm run dev
   ```

3. Abra `http://localhost:3100`. A tela pede um código: gere-o no terminal do motor, com o
   mesmo `FAROL_HOME` dele, e digite.

   ```sh
   node tools/farol-parear.js
   ```

Se o motor não estiver na mesma máquina do navegador, ele precisa escutar fora do loopback
(`bind` no `config.json`) e o endereço em `NEXT_PUBLIC_FAROL_API` tem de ser o que o navegador
alcança.

## Variáveis

| Variável | O que é |
|---|---|
| `NEXT_PUBLIC_FAROL_API` | A origem do motor, sem caminho: `http://127.0.0.1:47170` em desenvolvimento, `https://...` hospedado. É lida no build e fica pública no bundle. Entra também no `connect-src` da CSP. Só `http` ou `https`, com nome de host, IPv4 ou IPv6 entre colchetes e porta opcional; valor com curinga, espaço, usuário, caminho, query ou fragmento é recusado, e a tela avisa que falta o endereço |

É a única. Nenhuma variável deste pacote guarda segredo, e nenhuma deve guardar: o que tem
prefixo `NEXT_PUBLIC_` vai para o navegador.

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento na porta 3100 |
| `npm run build` | Build de produção |
| `npm run start` | Serve o build na porta 3100 |
| `npm run typecheck` | Gera os tipos das rotas (`next typegen`) e roda o `tsc` |
| `npm run lint` | ESLint, sem tolerar aviso |
| `npm test` | Vitest, com no máximo 4 workers |

O gate, antes de qualquer entrega, é o que o job `web` do CI roda:

```sh
npm ci && npm audit && npm run typecheck && npm run lint && npm test && npm run build
```

O `npm audit` cobre também as dependências de desenvolvimento: nada sobe com vulnerabilidade
conhecida. O `overrides` do `package.json` existe por isso (fixa o `minimatch` usado pelo
`typescript-eslint` numa versão corrigida); quando o `typescript-eslint` passar a pedir a versão
corrigida sozinho, o `overrides` sai.

## Pastas

| Pasta | O que mora nela |
|---|---|
| `src/app/` | As rotas (App Router). Uma pasta por aba, o `layout.tsx` da raiz, o `globals.css` com as cores dos dois temas e as páginas de aviso do front (`not-found.tsx`, `error.tsx` e `global-error.tsx`) |
| `src/componentes/` | Componentes de React, cada um com o CSS Module ao lado. Os de uma tela ficam numa pasta com o nome dela (`radar/`, `historico/`, `time/`, `consumo/`, `sistema/`), com um CSS Module só. `Markdown.tsx` desenha o texto de um review |
| `src/contratos/` | Os tipos do que o motor manda e os leitores que conferem a forma na borda. `radar.ts` tem as chaves do snapshot que o Radar usa; `historico.ts`, a página de `GET /api/decisions`, o detalhe por chave e a chave `pushbacks`; `time.ts`, a lista de `GET /api/team` e os perfis de `config.people`; `consumo.ts`, a chave `usage` e o relatório de `GET /api/usage`; `sistema.ts`, as chaves `doctor`, `accounts`, `modelos`, `claudePerfis`, `jiraSites` e o resto de `config`, mais as respostas das rotas de sessões, diagnóstico e testes; `segredos.ts`, a tabela dos nomes de segredo, os formatos de credencial e a máscara de texto |
| `src/radar/` | A lógica do Radar, sem React: como fatiar o snapshot nos blocos (`fatias.ts`), como escrever o que o motor manda (`formato.ts`) e as ações das três telas, com rota, corpo e a mensagem de cada recusa (`acoes.ts`) |
| `src/historico/` | A lógica do Histórico, sem React: a tabela de rótulos de `status` e `action` (`rotulos.ts`) e a consulta que mora no endereço, com o pedido que ela vira e as frases do resultado (`consulta.ts`) |
| `src/time/` | A lógica do Time, sem React: a cópia conferida da taxonomia do perfil (`taxonomia.ts`) e o endereço, as fatias, o corpo de `people` e as frases (`time.ts`) |
| `src/consumo/` | A lógica do Consumo, sem React: a consulta que mora no endereço e o pedido que ela vira (`consulta.ts`), os números em pt-BR e os rótulos (`formato.ts`), a geometria do gráfico (`grafico.ts`) e a auditoria do registro em frases (`auditoria.ts`) |
| `src/sistema/` | A lógica do Sistema, sem React: a política da conta, o que a pessoa alterou e o que amplia a publicação (`politica.ts`), as chaves de automação (`automacao.ts`), o rascunho refeito sobre o valor novo do motor (`rascunho.ts`), a saúde em linhas (`saude.ts`), as sessões e o Sair (`sessoes.ts`) e as ações, com corpo, pergunta e conferência (`acoes.ts`) |
| `src/markdown/` | O leitor de markdown próprio: texto para árvore de blocos e trechos, sem HTML e sem dependência |
| `src/transporte/` | O cliente único do motor: `get`, `post`, o fluxo de eventos, o token e o endereço. Sem React |
| `src/estado/` | O store e a sessão que liga o cliente ao store. A instância e o gancho `useApp` ficam em `instancia.ts` |
| `src/navegacao/` | A lista das abas |
| `src/tema/` | A troca de tema e o teste de contraste das cores |
| `src/seguranca/` | A regra da Content-Security-Policy e os cabeçalhos fixos que o `next.config.ts` devolve |
| `src/proxy.ts` | Gera o nonce e o cabeçalho da CSP a cada pedido; o `matcher` dele diz o que fica de fora |

## Convenções para os próximos lotes

**Onde entra tela.** Cada aba é uma pasta em `src/app/` com um `page.tsx` fino, que só escolhe
o componente. A tela mesma é um componente em `src/componentes/`, com `'use client'`, porque
os dados vêm do navegador. A lista das abas é `src/navegacao/abas.ts`.

**Onde entra tipo.** Todo dado do motor tem tipo e leitor em `src/contratos/`, e é lido do que
o motor emite, nunca inventado:

- chave do snapshot: em `src/contratos/snapshot.ts`, troque o `unknown` da chave em
  `FormasDoSnapshot` pelo tipo e o `qualquer` dela em `LEITORES` pelo leitor. O leitor devolve
  o valor conferido, ou `undefined` quando a forma não é a esperada. Para lista e mapa use
  `lerLista` e `lerRegistro` (`src/contratos/formas.ts`), com um leitor de item que monta o
  item campo a campo: só o que identifica o item é exigido (sem ele o item é descartado, com
  registro, e o resto da lista entra); todo outro campo é opcional no tipo, e campo de forma
  errada, ou `null`, conta como ausente (`campo`). O item aparece com o que deu para ler.
  O item é montado campo a campo, nunca guardado como veio: o que vier a mais, inclusive um
  segredo, não entra (veja "A tela Sistema"). As chaves de topo são lista fechada no motor (`test/snapshot-chaves.test.js`, na
  raiz), e `snapshot.test.ts` reprova se as duas listas divergirem;
- resposta de rota: um leitor `(bruto: unknown) => Tipo | null`, como os de
  `src/contratos/auth.ts`.

**Como chamar o motor.** Sempre pelo cliente (`app.cliente`, de `src/estado/instancia.ts`):
`get(caminho, leitor)` e `post(caminho, corpo, leitor)`. Os dois devolvem um `Resultado` e
nunca lançam, e o corpo só chega depois de passar pelo leitor. Não use `fetch` direto numa
tela: é o cliente que manda o Bearer e o `x-farol`, e que trata o 401. O 401 apaga só o token
que foi no pedido; se a aba ficou sem token ela volta ao pareamento, e se outra aba já guardou
um token novo a sessão segue com ele.

Os dois aceitam um último argumento `{ sinal }`, com um `AbortSignal`, para a tela abortar a
chamada que não interessa mais (a busca que o usuário trocou, por exemplo). Chamada abortada
devolve a falha `cancelado`, que não é erro do motor: quem recebe não mostra mensagem nem grava
nada. Sair, perder a sessão ou desmontar a página aborta todas as chamadas em curso do mesmo
jeito.

Resposta fora de 2xx vira a falha `recusado`, com o status. Quando o corpo da recusa traz um
código (`code`), a falha leva `detalhe: { codigo, campo? }`: é assim que a tela sabe qual
parâmetro o motor recusou no 400 de `GET /api/decisions`. Só esses dois saem do corpo de uma
recusa, e só com forma de identificador (letra, depois letras, dígitos, sublinhado ou hífen,
até 80). Quem responde fora de 2xx pode não ser o motor (um proxy no caminho), então o corpo
só é lido quando se declara JSON, até 16 kB e em até 2 s: corpo maior, sem fim ou parado é
largado, e a recusa segue só com o status.

**Como ler o estado.** `useApp((e) => e.snapshot?.chave)`. O seletor devolve um primitivo ou
uma referência que já está no store, nunca um objeto montado na hora. A definição do dado é do
motor: a tela fatia e formata, não recalcula. Chave que chega com forma errada mantém o valor
anterior e deixa um aviso no console; a tela precisa saber desenhar sem a chave. Depois de um
POST a tela não muda nada por conta própria: mostra o resultado e espera o estado que o motor
empurra.

**Eventos do motor.** O fluxo entrega ao store `state`, `state-patch`, `activity` (a linha
nova do feed de uma sessão, que entra no fim do feed dela em `snapshot.activity`) e `toast`
(o aviso com que o motor diz o desfecho de uma ação ou de uma revisão: `{ kind, text }`, com
`kind` `info`, `ok` ou `error`; lido em `src/contratos/eventos.ts`, com teto de 400
caracteres, e guardado em `recados`, os três mais recentes). Os outros (`needs-decision`,
`new-prs` e afins) passam por `aoEvento`, em `src/estado/app.ts`, e ainda não têm quem os
leia: é ali que entram. Exceção lançada ali não derruba a conexão: o
evento é descartado, o fluxo segue e o console recebe um aviso, uma vez.

O fluxo se cuida sozinho: 90 s sem nada do motor (contados desde o pedido, antes mesmo dos
cabeçalhos) derrubam a conexão, e a reconexão espera de 3 a 30 s, dobrando a cada falha. A
espera só volta a 3 s quando o fluxo entrega um evento, não quando o motor aceita a conexão.
Um evento que passa de 8 MiB sem terminar também derruba a conexão.

**Como testar.** O teste mora ao lado do arquivo, com nome `*.test.ts` ou `*.test.tsx`. Lógica
(transporte, contrato, estado) testa sem React, com `fetch` e relógio de mentira; escreva o
teste antes. Componente usa Testing Library e começa com `// @vitest-environment jsdom`. Cor
nova que vira texto entra em `src/tema/contraste.test.ts`.

**Estilo.** CSS Modules e as variáveis de `globals.css`. Sem atributo `style` e sem biblioteca
de componentes: a CSP de produção não aceita estilo em linha. Para texto sobre fundo de estado
use as variáveis terminadas em `-texto`, `--foco` para o anel de foco, `--borda-campo` para o
contorno de campo e `--borda-botao` para o de botão sem preenchimento.

**API do Next.** A versão fixada traz a própria documentação em `node_modules/next/dist/docs/`.
Consulte-a antes de usar uma API do Next: ela mudou entre versões (o antigo `middleware` aqui é
`proxy`, por exemplo).

**Texto.** Tela e comentários em português, sem travessão. Jargão de IA não se traduz (token,
prompt).

## A tela Radar

A aba `/radar` é `src/componentes/radar/Radar.tsx`. Ela lê o snapshot do store, fatia nos
blocos e liga os botões às ações:

| Bloco | Componente | De onde vem |
|---|---|---|
| Ações gerais (Checar agora, revisar pela URL de um PR) | `AcoesGerais.tsx` | `status`, `lastCheckAt`, `nextCheckAt` |
| Precisa de você | `PrecisaDeVoce.tsx` | `decisions.pending` sem espera |
| Analisando agora | `AnalisandoAgora.tsx` | `activeSessions` e `activity` |
| Esperando o CI | `EsperandoOCi.tsx` | `decisions.pending` com `esperaCi`, ou com `esperaProva` que o motor retoma sozinho |
| Fila | `Fila.tsx` | `queue`, com `parked`, `inicioAutomatico` e `esperaConflito`; depois `headlessWaitingPrs` com `headlessWaitingDetails` |
| Ignorados | `Ignorados.tsx` | só o que foi ignorado nesta aba (o snapshot não traz a lista) |

Os avisos do topo saem de `account`, `status`, `error` e `buscasPausadas`. No pé da tela fica
a região de resultado (`aria-live`): o envio em curso, o que o motor respondeu ao pedido e os
avisos dele (evento `toast`).

Regras que valem para quem mexer nela:

- **A tela não decide.** Os botões de uma pendência saem de `acoesDaPendencia`
  (`src/radar/fatias.ts`), que lê só `prProprio` e `blockedKind: "stale_head"`. Fora disso a
  tela oferece a ação e mostra a recusa do motor. Não acrescente regra de elegibilidade aqui:
  se faltar um campo, ele entra no snapshot do motor.
- **Um PR aparece uma vez.** `fatiarFila` tira da Fila o PR com sessão em curso, e da espera
  de execução o que ainda está na fila ou já tem pendência. É só exibição: a lista do motor
  não muda, e a contagem do título conta o que está na tela.
- **Ação.** Todo POST passa por `executar` (`src/radar/acoes.ts`) e pelo gancho `useAcoes`,
  que guarda o que está no ar por alvo (o PR ou a sessão), desabilita os botões do alvo e
  publica o envio e o resultado na região viva. A recusa do motor chega em
  `{ ok: false, blocked, error }`: `blocked` é o código, e a frase de cada código está na
  tabela `RECUSAS`. Código novo do motor entra ali; sem entrada, a tela mostra a frase que o
  motor mandou.
- **O `ok` do motor não é o desfecho.** Depois de `{ ok: true }` a tela só diz "O motor
  aceitou o pedido". Numa decisão o motor responde `ok` também quando já havia um review
  igual e ele não publicou de novo: o que aconteceu de fato vem no aviso dele (`toast`), que
  a tela mostra como texto. Não escreva frase que afirme publicação a partir do `ok`.
- **Confirmação.** `confirmacaoDa` diz quais ações perguntam antes e com que texto: as três
  que publicam no GitHub (Aprovar, Pedir mudanças e Comentar), o Pular de uma pendência de
  "Esperando o CI" (descarta o que o motor faria sozinho) e o Cancelar. A pergunta abre no
  próprio cartão, fecha com Escape, e fecha sozinha, dizendo por quê, se o motor mudar o item
  e a ação deixar de ser oferecida. Ao confirmar, o foco vai à região de resultado.
- **O texto mostrado é o do parecer.** `reportMarkdown` é o review do parecer da sessão. O
  motor publica o texto que guardou para a ação clicada, com comentários em linha. Por isso a
  pergunta só diz "o review mostrado acima" quando a ação é a do parecer; nas outras ela
  avisa que sai um texto que a tela não mostra.
- **Texto de fora é texto.** Título, autor, motivo, feed, aviso do motor e review entram como
  filho de texto do React, nunca por `dangerouslySetInnerHTML`. O review vem em markdown e
  é desenhado pelo componente `Markdown` (veja "O renderizador de markdown"). O link do PR passa
  por `linkDoPr`: só `https://github.com/`, com `rel="noreferrer noopener"` e
  `target="_blank"`. A revisão sob demanda manda a URL canônica do PR (`prDaUrl`), não o que
  foi digitado.
- **Cor não é o único sinal.** Erro e aviso começam dizendo o que são ("Erro:", "Aviso:",
  "Bloqueado:").
- **Hora.** As datas saem de `dataHora`, no fuso do navegador, sempre absolutas: a tela não
  tem relógio próprio, e os testes não dependem da hora.
- **Desenho.** A tela lê cada chave do snapshot por um seletor próprio, e os blocos são
  `memo`: o bloco só é redesenhado quando a fatia dele muda de referência
  (`Radar.desempenho.test.tsx`). Ao passar uma lista derivada a um bloco, use `useMemo`.

### Lacunas do contrato

O que a tela não faz porque o motor não manda. Cada item se resolve no snapshot ou na resposta
do motor, não com regra na tela:

- **O texto de cada ação.** A projeção da pendência (`decisionForUi`) traz só o review do
  parecer. O texto e os comentários em linha que o motor publica em Aprovar, Pedir mudanças e
  Comentar (`payloads`) não saem do motor, então a tela não consegue mostrá-los antes do
  clique.
- **As ações permitidas por pendência.** Não há campo que diga o que cada pendência aceita
  (por exemplo, Aprovar barrado pela avaliação técnica). A tela oferece o botão e o motor
  recusa.
- **Quando o motor revisa de novo sozinho** (`reRounds`). A pendência de commit novo mostra o
  motivo do bloqueio e o Revisar agora, mas não diz se e quando a rodada automática sai.
- **A lista dos ignorados.** O snapshot não a traz: só dá para restaurar o que foi ignorado
  na aba aberta.
- **O bloco de cada pendência.** Não há campo que diga se a pendência espera clique ou se
  resolve sozinha: a tela corta pela presença de `esperaCi` e de `esperaProva` sem `pedeVoce`.

## A tela Histórico

A aba `/historico` é `src/componentes/historico/Historico.tsx`. Ela mostra as revisões que o
motor já resolveu (até 3.000), uma página de 30 por vez, lidas de `GET /api/decisions`. Não
lê a lista do snapshot, que só leva as 30 mais recentes.

| Parte | Componente | De onde vem |
|---|---|---|
| Busca e filtros | `Filtros.tsx` | `q`, `veredito` e `repo` da rota; as opções de repositório são o `repos` da resposta |
| Lista e paginação | `Lista.tsx`, `Paginacao.tsx` | `items`, `page`, `pages` e `total` da resposta |
| Detalhe da revisão | `Detalhe.tsx` | o item da página; fora dela, `GET /api/decision?key=` |
| Contestação do autor | `Contestacao.tsx` | a chave `pushbacks` do snapshot, pelo PR |

Regras que valem para quem mexer nela:

- **Quem busca e filtra é o motor.** A tela manda o que a pessoa escolheu e mostra o que
  voltou; não filtra nem ordena nada. O filtro de desfecho olha o que foi publicado (`action`),
  e por isso os rótulos dele dizem isso: Aprovados, Mudanças pedidas, Comentados, Não
  publicados.
- **A consulta mora no endereço.** `q`, `veredito`, `repo`, `pagina` e a revisão aberta (`id`
  e `pr`, a chave do PR) ficam na query string (`src/historico/consulta.ts`), lidos por
  `useSearchParams` e escritos pela History API, que o Next integra ao roteador (o endereço
  muda sem pedir a página ao servidor do front). Filtro, página e abrir ou fechar a revisão
  empilham uma entrada; a busca digitada e a correção de página trocam a entrada atual.
- **Busca com espera, pedido anterior abortado.** O campo espera 300 ms depois da última tecla
  (`ESPERA_DA_BUSCA_MS`); Enter manda na hora. Cada pedido novo aborta o anterior pelo
  `AbortSignal` do cliente, e resposta de pedido abortado não entra na tela.
- **Valor do endereço que a tela não conhece vai ao motor como veio.** Quem recusa é ele, com
  400 e o nome do campo, e a tela diz qual campo foi recusado. Só a página é saneada aqui
  (inteiro a partir de 1). Página além do fim (200 com `items` vazio e `pages` maior que zero)
  volta para a última.
- **Rótulos numa tabela só.** `src/historico/rotulos.ts` traduz `status` e `action`. O teste
  ao lado varre `lib/engine/*.js`, pega todo arquivo que chama `resolveIntoHistory` ou
  `recordDecision` e reprova se um literal escrito num `status:` desses arquivos não tiver
  rótulo. É uma leitura de texto: status montado de outro jeito escapa dela, e na tela
  aparece cru. O parecer da sessão (`verdict`) só aparece quando difere do que foi publicado.
- **Publicado é o que o motor conta como publicado.** Só `approve`, `request_changes` e
  `comment` (`PUBLICADOS`, em `lib/engine/historico-paginado.js`). `action` ausente ou de
  valor desconhecido aparece como "Nada publicado" (o desconhecido, com o valor cru ao lado),
  que é como o filtro do motor o trata. A pendência da mesa, que só chega pelo detalhe por
  chave, mostra "Nada publicado ainda".
- **A lista não se refaz sozinha.** Quando o snapshot passa a ter revisão resolvida mais nova
  que a da última carga (`marcaDasResolvidas`: o id e a hora do topo de `decisions.resolved`),
  aparece o aviso "Há revisões novas" com o botão Atualizar, que pede a mesma página de novo.
- **Estados.** Durante uma carga a página anterior fica na tela, esmaecida e com `aria-busy`.
  Vazio sem filtro e vazio com filtro têm textos diferentes. Falha de rede tem Tentar de
  novo; recusa de parâmetro tem Limpar busca e filtros. Item sem `id` ou sem `key` é
  descartado, contado e avisado. O resultado ("61 revisões, página 2 de 3") sai numa região
  viva educada.
- **Detalhe.** Abre na própria página, no lugar da lista (que continua montada), com o foco
  no título; Escape ou "Voltar à lista" fecham, e o foco volta ao botão que abriu. Escape
  dentro de um campo de texto ou de um seletor é do campo, e não fecha o detalhe. Mostra o
  que foi publicado, os motivos (`reasons`), os pontos de atenção (`attention`), o resumo
  técnico (`technical`), as rodadas (`rounds`), as etapas (`stages`), a conferência de
  afirmações e o texto do parecer, desenhado de markdown.
- **Ações.** Passam por `executar` e `useAcoes`, como no Radar. "Revisar de novo" manda
  `POST /api/review` com a URL canônica do PR (`prDaUrl`) e não pergunta: o clique não
  publica, mas a análise que ele abre termina pela política da conta, que pode publicar
  sozinha, e a tela diz isso. A contestação só aparece quando há registro para o PR, e as
  duas ações dela (`POST /api/pushback`) perguntam antes. Nenhuma publica no GitHub, mas
  gravar um desfecho tem efeito além da tela (`lib/engine/pushback.js`): o registro fica
  confirmado e marcado como manual, entra no prompt das próximas revisões dos PRs do autor
  e, com o desfecho `author_right` ou `mixed`, no das revisões de outros autores do mesmo
  repositório; e o motor deixa de procurar contestação naquele PR sozinho. Apagar o registro
  (desfecho vazio) desfaz isso. A pergunta diz o que vale para o desfecho escolhido.

### Lacunas do contrato

- **Revisão por id.** O motor só busca uma revisão pela chave do PR (`GET /api/decision?key=`),
  e devolve a pendência do PR ou, sem ela, a resolvida mais recente. Um endereço que aponta
  para uma revisão antiga de um PR com várias só abre se ela estiver na página carregada;
  fora disso a tela mostra a que o motor devolveu e avisa que não é a pedida.
- **A contestação não vem na projeção.** `decisionForUi` não traz nada sobre contestação: o
  registro vem na chave `pushbacks` do snapshot, por PR. Não dá para dizer a qual rodada do PR
  ele se refere, e a tela o mostra em toda revisão daquele PR, dizendo que é do PR.
- **O texto publicado.** `reportMarkdown` é o review que o motor escolheu mostrar, e a
  projeção não diz se ele é o da ação publicada ou o do parecer. Quando os dois diferem, a
  tela avisa que o texto pode não ser o que saiu no PR.
- **Novidade sem filtro.** O aviso de revisões novas olha o topo das resolvidas do snapshot,
  que não sabe dos filtros: ele aparece mesmo quando a revisão nova não passa pela consulta
  aberta.
- **Sessão em curso por revisão.** O item não diz se o PR já está sendo revisado de novo. A
  tela oferece "Revisar de novo" e mostra a resposta do motor.
- **O aviso do motor cita uma tela que não existe aqui.** Quando o motor suspeita de
  contestação, o aviso dele (evento `toast`, texto de `lib/engine/pushback.js`) manda
  confirmar o desfecho em "Revisões recentes", que é da tela antiga. A tela nova mostra o
  aviso como o motor escreveu; o desfecho se confirma no detalhe da revisão, no Histórico.

## A tela Time

A aba `/time` é `src/componentes/time/Time.tsx`. Ela mostra o que o motor guarda sobre cada
pessoa que teve PR revisado. É dado sobre colegas: fica no motor. Nada dele vai a
`localStorage` nem ao console (o registro da borda leva só contagem), e do endereço só consta
o login de quem está com o dossiê aberto (`?autor=`), que é o identificador que o motor já usa.

| Parte | Componente | De onde vem |
|---|---|---|
| Lista e busca | `Time.tsx`, `ListaDoTime.tsx` | `GET /api/team` (a lista inteira) e `config.people` do snapshot |
| Dossiê | `Dossie.tsx` | o item da lista, `config.people` e `pushbacks` do snapshot, pelo autor |
| Papel e competência | `EditorDoPerfil.tsx` | `config.people`; grava com `POST /api/settings` |

O contrato, lido do motor:

- **`GET /api/team`** (`parseTeam`, `lib/workspace.js`) responde a lista crua, sem envelope,
  página nem filtro: `[{ login, name, entries: [{ date, ref, verdict, bullets }] }]`. `login` é
  o nome do arquivo do dossiê (`state/authors/<login>.md`); `name` repete o login quando o
  dossiê não traz nome; `date` é o dia em UTC (`AAAA-MM-DD`), `ref` é `dono/repo#n`, `verdict`
  é o que foi publicado (`APPROVE`, `REQUEST CHANGES` ou `REQUEST_CHANGES`, `COMMENT`) e
  `bullets` são os pontos que a sessão anotou sobre o trabalho (quantos, quem pede é o prompt da
  revisão; `writeMemory` grava os que vierem). A ordem é a do motor: quem tem a entrada mais recente
  primeiro. O motor guarda dez entradas por pessoa
  (`writeMemory`, `lib/engine/decision.js`).
- **`config.people`** (`parsePeople`, `lib/parse.js`): `{ login em minúsculas: { papel?,
  dominios?: { dominio: nivel } } }`. Os valores aceitos são os de `lib/taxonomy.js`.
- **`POST /api/settings` com `{ people }`** troca o mapa inteiro pelo que chega
  (`updateSettings`, `server.js`). Valor fora da taxonomia é descartado sem recusa, e pessoa
  sem papel nem competência sai do mapa. Responde `{ ok, ignoradas, config }`.
- **`POST /api/team/remove` com `{ login }`** (`removeTeamMember`, `lib/engine/decision.js`)
  apaga três coisas, e só elas: o arquivo do dossiê, a entrada da pessoa em `config.people` e
  todo registro de `pushbacks` em que ela é a autora. Não há cópia: não se desfaz. As
  revisões dos PRs dela continuam no histórico (`GET /api/decisions` busca por autor) e no
  log do motor. Responde `{ ok: true, removed }` (`removed: true` quando havia ao menos uma
  das três, sem dizer quais; `false` quando não havia nenhuma) ou
  `{ ok: false, error: "login inválido" }` para login fora do formato do GitHub.

Regras que valem para quem mexer nela:

- **A tela fatia e formata.** A ordem é a do motor. A contagem é o tamanho da lista de
  entradas, e a "última entrada" é a primeira que o motor listou. Papel, competência e
  desfecho aparecem com rótulo; valor que a tela não conhece aparece cru.
- **A busca é daqui, e só porque a lista vem inteira.** `filtrarPorNome` (`src/time/time.ts`)
  procura no login e no nome, sem caixa e sem acento. O que se digita fica na memória da aba:
  não vai ao motor nem ao endereço (seria um nome de colega no histórico do navegador).
- **Quem só tem perfil também aparece.** `GET /api/team` só lista quem tem dossiê. Quem tem
  papel ou competência gravados e não tem dossiê vem de `config.people` (`soComPerfil`), depois
  dos dossiês, porque o perfil dele entra no prompt do mesmo jeito.
- **A taxonomia é cópia conferida.** `src/time/taxonomia.ts` repete os papéis, os domínios e
  os níveis de `lib/taxonomy.js`, com os rótulos; `taxonomia.test.ts` lê aquele arquivo e
  reprova se uma chave ou um rótulo divergir.
- **Dossiê.** Abre na própria página, com o foco no título; Escape ou "Voltar à lista" fecham,
  e o foco volta ao botão que abriu. As entradas aparecem uma a uma, com o dia, o PR e o que
  foi publicado quando o motor diz; os pontos são desenhados de markdown, que é como o motor
  os grava. As contestações dos PRs da pessoa aparecem só para leitura: o desfecho se
  confirma no Histórico.
- **Salvar manda a lista inteira, montada do dado cru.** O store guarda `config.people` duas
  vezes: lido (`people`, para mostrar) e como o motor mandou (`peopleCru`). O corpo do salvar
  sai do cru que a aba tem no momento do clique, e só a pessoa editada muda (`comPerfil`):
  as outras voltam como vieram, inclusive com campo que a tela não conhece ou valor que ela
  não lê. Na pessoa editada trocam-se o papel e os domínios; outro campo dela fica. A chave
  é o login em minúsculas, como o motor guarda.
- **Ilegível avisa, não fecha.** Pessoa que a tela não leu inteira (o JSON lido difere do
  cru) é contada em `peopleIlegiveis` e vira aviso no editor. O salvar segue aberto, porque
  o corpo não tira ninguém.
- **Quando o salvar fica fechado** (`motivoQueImpedeSalvar`): sem a lista de perfis no
  snapshot; com o fluxo de eventos fora de "conectado"; e, depois de uma reconexão, enquanto
  o primeiro `state` da conexão nova não chega. Para isso o store tem `estadoEmDia`
  (`src/estado/app.ts`): "conectado" vem no HTTP 200, ainda com o snapshot de antes da queda,
  e o sinal só vira verdadeiro com o estado inteiro daquela conexão. O indicador de conexão
  das outras telas não mudou.
- **Perfil que muda no motor com a edição aberta** vira aviso, e dá para descartar a edição.
  O que não dá para evitar está dito na tela: alteração de outra aba que ainda não chegou
  aqui é sobrescrita.
- **Edição por salvar não se perde calada.** Escape e "Voltar à lista" com papel ou
  competência alterados perguntam antes de descartar. Trocar de pessoa só acontece pelo
  endereço (o voltar e o avançar do navegador, um link colado), e isso a página não segura:
  o dossiê troca e a edição vai embora sem pergunta.
- **O `ok` do salvar não é o desfecho.** O motor descarta o que não reconhece sem recusar.
  A frase do resultado sai do `config.people` da resposta, conferido inteiro contra o
  enviado: "gravou", "gravou diferente do pedido" e, se o perfil de outra pessoa mudou ou
  saiu da lista, quem (`outrasQueDiferem`).
- **Salvar e remover da mesma pessoa se excluem.** As duas ações têm o mesmo alvo
  (`alvoDaPessoa`): com uma no ar, o botão da outra fica desabilitado.
- **Remover pergunta antes, e não promete mais do que o motor faz.** A pergunta
  (`confirmacaoDa`, `src/radar/acoes.ts`) diz as três coisas apagadas, com o que a tela vê
  (quantas entradas, se há perfil, quantas contestações), que não se desfaz, que as revisões
  dos PRs da pessoa continuam no Histórico e no log, e o efeito: a sessão não encontra o
  dossiê, o prompt sai sem perfil e sem contestações, e as contestações apagadas deixam de
  entrar como lição nas revisões de outros autores do repositório. O resultado repete o que
  o motor respondeu em `removed`, sem afirmar que as três existiam.
- **Depois de uma remoção aceita** o dossiê fecha (trocando a entrada do endereço), a tela
  pede a lista de novo e, enquanto a carga nova não chega ou se ela falhar, quem foi removido
  não aparece na lista nem abre com Salvar e Remover. O erro da carga, com o Tentar de novo,
  e o aviso de Atualizar aparecem também com o dossiê aberto.
- **Contestações no dossiê.** Só leitura. A tela diz que entram no prompt as 5 confirmadas
  mais recentes da pessoa (`personProfileBlock`; o teste confere o número contra o motor).
- **O efeito do papel e da competência, como a tela o diz.** Entram no prompt das revisões
  dos PRs da pessoa, no bloco "Perfil do autor" (`personProfileBlock`,
  `lib/engine/review-prompt.js`): o papel dá o tom e a competência por domínio calibra a
  postura. Nenhum gate e nenhuma regra da política da conta lê esses campos.
- **A lista não se refaz sozinha.** Ela não está no snapshot. Quando o snapshot passa a ter
  revisão resolvida mais nova que a da última carga, aparece o aviso com o botão Atualizar.

### Lacunas do contrato

- **Remover uma entrada só.** O motor só remove a pessoa inteira. Não há rota para apagar
  uma entrada do dossiê, nem cópia que permita desfazer.
- **Os valores permitidos não vêm do motor.** Papéis, domínios e níveis não saem em rota
  nem no snapshot: a tela tem a cópia conferida por teste.
- **O salvar de perfil não é por pessoa.** `people` vai e volta inteiro, sem versão: o motor
  não tem como recusar uma lista velha, e duas abas salvando ao mesmo tempo se sobrescrevem
  sem que nenhuma fique sabendo. O que a tela faz (corpo do dado cru, salvar fechado sem o
  estado da conexão, conferência da resposta) reduz a janela, não a fecha. A correção de
  fundo é no motor: uma operação por pessoa sobre a config atual, como a conta já tem em
  `accounts/edit`.
- **Remover não apaga o histórico nem o log.** `removeTeamMember` não toca em
  `decisions.json` nem no `farol.log`: o login da pessoa continua nas revisões dos PRs dela
  e nas linhas de log. Quem precisa tirar a pessoa de tudo não consegue por esta rota.
- **O voltar do navegador descarta a edição sem perguntar.** A página não tem como segurar
  a troca de endereço feita pelo navegador.
- **A lista não avisa que mudou.** Não há chave no snapshot nem evento para o Time. O aviso
  de Atualizar olha as revisões resolvidas, que não dizem se a memória de alguém mudou, e uma
  remoção feita em outra aba só aparece na próxima carga.
- **Não há números por pessoa.** O motor não manda quantas revisões a pessoa teve nem os
  desfechos somados: só as dez entradas mais recentes. A contagem da tela é a de entradas.
- **A entrada não liga à revisão.** Vem o dia e a chave do PR, sem hora, sem endereço e sem
  o id da revisão: não dá para abrir a revisão no Histórico a partir dela. Entrada antiga traz
  só o nome curto do repositório, e aparece como veio.
- **Login que o motor não remove.** A remoção só aceita login no formato do GitHub (letras,
  dígitos e hífen, até 39). Dossiê de outro nome (`dependabot[bot]`, por exemplo) é listado,
  e a remoção dele é recusada com "login inválido".
- **A recusa de `POST /api/settings` tem outra forma.** Vem em `code` e `erro`, e a das
  outras ações em `blocked` e `error`; `lerRespostaDeAcao` lê as duas.

## A tela Consumo

A aba `/consumo` é `src/componentes/consumo/Consumo.tsx`. Ela mostra quanto as sessões de IA do
motor consumiram: tokens e custo em dólar. Só lê: não há ação nela. E só mede: o motor não tem
teto de gasto (decisão de 16/11/2026), então a tela não mostra teto, bloqueio nem pausa.

| Parte | Componente | De onde vem |
|---|---|---|
| Auditoria do registro | `AuditoriaDoRegistro.tsx` | `usage.auditoria` do snapshot |
| Período e filtros | `Filtros.tsx` | o endereço; as opções são o `options` da resposta |
| Resumo do período | `ResumoDoPeriodo.tsx` | `range`, `totals`, `completed`, `retries` de `GET /api/usage` |
| Gasto por dia | `GraficoPorDia.tsx` | `series` |
| Por tipo e por modelo | `Quebras.tsx` | `byKind` e `models` |
| Diário de execuções | `Diario.tsx`, `TabelaDeExecucoes.tsx` | `history` |
| Sessões recentes | `SessoesRecentes.tsx` | `usage.recentSessions` do snapshot |

O contrato, lido do motor:

- **A chave `usage` do snapshot** (`usageSummary`, `lib/engine/usage.js`, pela projeção de
  `lib/engine/snapshot-usage.js`). A tela guarda `recentSessions`, `auditoria`,
  `sessionsSince` e `totals.sessions`. A chave traz também as séries por dia (`series`,
  `stackedSeries`, `matrixSeries`, até 120 dias), que a tela não usa: com elas a soma de um
  período teria de ser feita aqui.
- **`usage.recentSessions`**: as 100 sessões mais recentes, a mais nova primeiro, com `at`,
  `kind`, `ref`, `model`, os quatro contadores de tokens, `costUsd`, `costSource` e `status`.
- **`GET /api/usage`** (`lib/engine/usage-activity.js`, `lib/usage/report.js`) lê o diário
  inteiro, que não tem poda. Parâmetros, todos opcionais: `start` e `end` (dias `AAAA-MM-DD`,
  inclusivos; sem eles, os 30 dias que terminam no hoje do motor), `kind`, `model`, `repo`,
  `account`, `provider` e `device` (igualdade exata; ausente ou `all` não filtra), `search`
  (até 200 caracteres, na referência, no tipo e no modelo), `focus` (`review` ou `pr`) e
  `page` (a partir de zero, 8 operações por página). `kind`, `model` e `repo` recortam as
  somas, a série e as quebras; `search`, `focus` e `page`, só o diário. `model` compara com o
  modelo principal da execução: `models` ainda pode trazer outros, que são partes das mesmas
  execuções. Cada operação do diário vem com todas as tentativas dela, inclusive as de fora
  do período ou do filtro. Responde sempre 200:
  `{ ok: true, range, options, totals, byKind, completed, retries, unidentified, since,
  sinceDay, series, models, history, incomplete }`, ou `{ ok: false, motivo }` com uma frase.
  A tela manda `start`, `end`, `kind`, `model`, `repo`, `search` e `page`.

Regras que valem para quem mexer nela:

- **A tela não soma.** Toda soma é do motor: `totals` para o período, `series` por dia,
  `byKind` por tipo, `models` por modelo, `auditoria` para o registro inteiro. A tela não soma
  linhas de uma página nem tentativas de uma operação. As contas daqui são de exibição e
  estão ditas: a participação percentual (a fatia de uma linha no total do motor) e entrada
  mais saída da mesma linha (para ordenar os modelos).
- **O custo é sempre "estimado".** `costUsd` é o `total_cost_usd` que a sessão do Claude Code
  informa ao terminar; o motor não tem tabela de preço. Em perfil de assinatura ninguém cobra
  esse valor, e a tela diz isso junto do resumo. A modalidade aparece nas três parcelas em
  que o motor a separa, sem "N de M": as execuções por assinatura (`subscription`), o dólar
  das de chave de API (`apiUsd`, `apiEstimatedUsd`, `apiUnknown`) e as sem modalidade
  registrada (`unknownBilling`). Cada execução mostra a origem do custo
  (`costSource`): informado pela sessão, "calculado pelo motor" (a sessão morreu antes de
  informar, e o motor usa a mediana do custo por token de saída das sessões concluídas do
  mesmo modelo) ou "Desconhecido", que não mostra o zero gravado.
- **O dia é o de Brasília.** O período e o diário são em "dia de Brasília" (`FUSO_DO_DIA`,
  `lib/constants.js`). A tela escreve o dia trocando a ordem do texto, sem `Date`. A hora de
  cada execução (`at`) sai no fuso do navegador, como nas outras telas.
- **A auditoria em texto.** `linhasDaAuditoria` (`src/consumo/auditoria.ts`) escreve o total
  do registro inteiro, o que não virou resultado, o que o motor calculou e o que ficou com
  custo desconhecido. É medição: nenhuma dessas frases fala de limite, e nada na tela pausa
  revisão. A lista de teto por perfil que um motor antigo ainda mande em `usage` não é lida.
- **A consulta mora no endereço.** `inicio`, `fim`, `tipo`, `modelo`, `repo`, `q` e `pagina`
  (`src/consumo/consulta.ts`), no molde do Histórico: filtro, período pronto e página
  empilham; busca, datas e página corrigida trocam a entrada. A busca espera 300 ms, e cada
  pedido novo aborta o anterior. Valor que a tela não conhece vai ao motor como veio.
- **O hoje é o do motor.** Os períodos prontos (7, 30 e 90 dias) terminam no `range.end` do
  relatório na tela e gravam as duas datas no endereço; antes da primeira resposta ficam
  desabilitados. A tela não lê o relógio. O atalho só fica marcado quando as duas datas do
  endereço são as do relatório, ou quando não há data nenhuma (o padrão do motor, sempre 30
  dias). Com uma data só, a dica diz o que o motor faz: só "De" cresce a cada dia; só "Até"
  começa 30 dias antes do hoje do motor, e com data mais antiga ele não entrega o relatório.
- **Data digitada só vira pedido quando serve.** O campo guarda o que se digita e só manda ao
  endereço um dia que existe, de 1970 em diante (`dataAceita`): enquanto se digita o ano, o
  navegador entrega 0002, 0020, 0202. Data do endereço não é julgada aqui: vai ao motor.
- **O diário mostra as tentativas de fora.** As de fora do período saem marcadas com "fora
  do período" na coluna Quando, e a tela diz por que as linhas não fecham com o total.
- **O gráfico é complemento.** SVG próprio, sem biblioteca, com `role="img"` e um nome que
  resume o período, o maior dia e o total do motor. A mesma informação está na tabela logo
  abaixo. A geometria é função pura (`src/consumo/grafico.ts`): escala de passo redondo, até
  seis rótulos no eixo horizontal, dia sem execução com barra vazia. Período com mais de 120
  dias não é desenhado. Cores só das variáveis de `globals.css`.
- **Tabela larga rola no próprio contêiner,** que tem nome e recebe foco. A página não rola
  para o lado em 375 px.
- **O relatório não se refaz sozinho.** Quando `usage.totals.sessions` do snapshot muda,
  aparece o aviso de sessão nova com o botão Atualizar, dizendo que ela pode não entrar no
  recorte (o aviso não olha período nem filtro). A auditoria e as sessões recentes vêm do
  snapshot e andam sozinhas.
- **Estados.** Durante uma carga o relatório anterior fica na tela, esmaecido e com
  `aria-busy`. Sem execução no período, a tela diz isso (com filtro a frase muda) e não
  desenha gráfico nem quebras. Falha de rede tem Tentar de novo. `{ ok: false, motivo }`
  mostra a frase do motor e oferece voltar ao período padrão. Item sem o que o identifica é
  descartado, contado e avisado; número que não veio aparece como "sem dado", não como zero.
- **Número torto não vira "US$ NaN".** Negativo, infinito ou que não é número aparece como
  "valor inválido"; fracionário onde se espera inteiro aparece com as casas que tem;
  participação acima de 100% aparece como veio. O rótulo do eixo do gráfico tem as casas que
  o passo pede (0,025 pede três), para a marca não ser arredondada. As funções puras não
  lançam com valor denormal, enorme ou `NaN`.

### Lacunas do contrato

- **A recusa não tem código nem campo.** Período inválido volta como 200 com
  `{ ok: false, motivo }`, e a mesma forma serve para o diário indisponível. A tela não tem
  como dizer qual parâmetro foi recusado, nem separar recusa de indisponibilidade: mostra a
  frase. Filtro com valor que não existe não é recusado: volta vazio. O cliente já lê `code`
  e `campo` de um 400, se a rota passar a responder assim.
- **Dois dias diferentes.** O diário e `GET /api/usage` usam o dia de Brasília; o agregado
  (`usage.series`) usa o dia local do processo do motor (`localDay`), que só é o de Brasília
  se o processo rodar nesse fuso. A tela não usa o agregado, e por isso só fala no dia de
  Brasília.
- **As execuções por chave de API não são contadas.** O motor soma o dólar delas e conta só
  as de custo desconhecido. A tela não tira a contagem por diferença.
- **A tentativa de fora do filtro não vem marcada.** A tela marca a de fora do período
  comparando o dia dela com `range`; para o filtro teria de repetir a regra do motor.
- **Sem custo nem cache por modelo no período.** `models` traz execuções e tokens de entrada
  e de saída. O custo por modelo existe só nas séries diárias do snapshot, que a tela teria
  de somar.
- **Sem total por operação.** Uma operação com retomada traz as tentativas, cada uma com os
  tokens e o custo dela, e nenhuma soma. A tela mostra uma linha por tentativa.
- **Sem endereço do PR.** Vem só a chave `dono/repo#n`; a tela monta o endereço do GitHub
  (`urlDoPr`), e referência de outro formato fica como texto.
- **Os períodos não vêm do motor.** Ele aceita qualquer intervalo e não lista os oferecidos:
  7, 30 e 90 são escolha da tela, e o hoje dele só se conhece pela resposta.
- **Página além do fim não é dita.** O motor devolve a última página sem avisar; a tela
  compara `history.page` com o pedido e corrige o endereço.
- **`account`, `provider`, `device` e `focus` não são oferecidos.** Uma instância tem uma
  conta, um provedor e um aparelho; `focus` (só revisões concluídas, ou uma por PR) ficou
  de fora.
- **O motivo da falha de uma sessão** (`usage.falhasPorSessao`) não é mostrado: é texto
  de erro do motor. As falhas registradas aparecem no relatório do motor, na tela Sistema.
- **Sem gasto por perfil.** O snapshot não traz mais linha por perfil do Claude (ela existia
  para o teto, que saiu). Cada sessão recente vem com o `profileId`, que a tela não lê, e
  `GET /api/usage` não filtra por perfil.

## A tela Sistema

A aba `/sistema` é `src/componentes/sistema/Sistema.tsx`. É a tela que mais pode fazer estrago:
muda o que o motor publica sozinho no GitHub e quem tem acesso a ele. Sete seções, cada uma com
título próprio e um índice no topo:

| Seção | Componente | De onde vem | O que edita |
|---|---|---|---|
| Saúde | `Saude.tsx` | `doctor`, `modelos.cli`, `claudePerfis.problemas`, `accounts` e `app.version` do snapshot; `GET /api/doctor`; `GET /api/diagnostics` | nada |
| Conta revisora e política | `ContaEPolitica.tsx` | `accounts` do snapshot | organizações e os quatro campos da política, por `POST /api/accounts/edit` |
| Automação | `Automacao.tsx` | `config` e `modelos.claude` do snapshot | `aguardarCiParaAprovar`, `parallelReviews`, `reviewModel` e `reviewEffort`, por `POST /api/settings` |
| Perfil do Claude | `PerfilDoClaude.tsx` | `config.claudeProfiles`, `claudePerfis.uso` e `doctor.claudeAuth` do snapshot; `POST /api/claude/profile-test` | nada |
| Jira | `Jira.tsx` | `jiraSites` do snapshot; `POST /api/jira/test` | nada |
| Sessões pareadas | `Sessoes.tsx` | `POST /api/auth/sessions` | revoga uma sessão, por `POST /api/auth/revoke` |
| Rede e acesso | `Sistema.tsx` | `bind`, `port`, `hostPublico`, `origensPermitidas` e `localAuth` de `config` | nada |

**A tela não tem teto de gasto** (decisão de 16/11/2026): o revisor é autônomo e não trava por
gasto. O motor não tem mais o gate, e a tela não mostra, não edita nem avisa teto. Nenhum
`POST /api/settings` com `claudeProfiles` sai do front, e nenhum fonte lê campo de teto
(`sistema/acoes.test.ts` confere as duas coisas). O campo de teto que um `config.json` antigo
ainda traga num perfil (`budgetDaily`, `budgetTotal`, `budgetSince`, `budgetByWeekday` ou
`budgetDates`) é descartado pelo motor na carga e não chega à tela.

O contrato, lido do motor:

- **`POST /api/settings`** (`updateSettings`, `server.js`) mescla por chave de topo: só a chave
  que vai no corpo muda, e cada uma passa pelo saneador dela (`SETTINGS`, `lib/settings.js`).
  O valor de uma chave troca o anterior inteiro. Responde `{ ok, ignoradas, config }`, com a
  `config` sem a chave de API; valor que o motor não aceita não é recusado.

  | chave | o corpo | o que o motor faz com valor inválido | onde é usada |
  |---|---|---|---|
  | `aguardarCiParaAprovar` | o booleano | só `true` liga; o resto vira `false` | `aguardaCiParaAprovar`, `lib/engine/gate-espera.js` |
  | `parallelReviews` | o número | fora de 1 a 4 vai para a ponta; o que não é número mantém o anterior | `parallelLimit`, `lib/engine/headless-fila.js` |
  | `reviewModel` | o texto (vazio é o padrão do Claude Code) | fora do catálogo e do formato de nome completo mantém o anterior | `buildModelFlags`, `lib/engine/session.js`, e o roteador do Auto |
  | `reviewEffort` | o texto (vazio não manda a flag) | fora de `low`, `medium`, `high`, `xhigh` mantém o anterior | `buildModelFlags`, `lib/engine/session.js` |
  | `people` | o mapa INTEIRO (tela Time) | valor fora da taxonomia é descartado | `personProfileBlock`, `lib/engine/review-prompt.js` |
  | `claudeProfiles` | a lista INTEIRA (o front não manda) | perfil incompleto sai da lista | `authDaConta`, `lib/engine/perfil-claude.js` |
  | `jiraSites` | a lista INTEIRA (o front não manda) | site inválido ou repetido sai da lista | `lib/engine/jira.js` |

  `bind`, `hostPublico`, `origensPermitidas`, `port` e `localAuth` não são aceitas: voltam em
  `ignoradas`.
- **`reviewModel` aceita dois formatos** (`sanitizeModel`, `lib/parse.js`): um apelido do
  catálogo (`auto`, `best`, `opus`, `sonnet`, `fable`) ou um nome completo `claude-...`, só com
  letras minúsculas, dígitos e hífen, que é a escotilha para modelo novo. O seletor oferece só
  o catálogo que o motor manda; o nome completo entra pelo arquivo de configuração e aparece
  na tela como opção extra, dita como fixada no arquivo. Qualquer nome com `haiku` é recusado.
- **`POST /api/accounts/edit`** (`aplicarEdicao`, `lib/engine/contas-config.js`) recebe
  `{ tipo: "editar", user, campos }` e aplica sobre a conta que o motor tem: cada campo troca o
  valor, e `owners` troca a lista inteira de organizações. Campo que não vai não muda. Campo
  vazio apaga o valor, e o motor regrava o padrão, que publica sozinho. Responde
  `{ ok: true, ignoradas, ignorados }` (sem a conta gravada), ou `{ ok: false, erro }`. Com
  `onClean` em `wait` o motor põe `onCaveats` em `wait`, e recusa o pedido de `approve`.
- **Quando a política nova vale.** O motor lê a política ao começar cada revisão
  (`politicaDeInicio`, `lib/engine/review-scope.js`), ao decidir o resultado de cada uma
  (`shouldAutoApprove` e `shouldAutoReject`, `lib/engine/approval-policy.js`) e quando uma
  espera do CI já armada fecha (`politicaAindaAprova`, `lib/engine/espera-ci.js`). O evento
  `settings-changed` é emitido e ninguém o ouve: a pendência que já está em "Precisa de você"
  porque a política mandava esperar não é reavaliada, e continua esperando o clique.
- **Desligar `aguardarCiParaAprovar` tem efeito imediato.** Na varredura seguinte, toda
  aprovação que estava esperando o CI é publicada sem esperar os checks, mesmo com o CI
  vermelho, se o commit ainda é o revisado e a política ainda manda aprovar; a pendência que
  pediu mudanças só pelo CI vai para a mesa (`umaEspera` e `liberarSemCi`,
  `lib/engine/espera-ci.js`).
- **`POST /api/auth/sessions`** responde `{ ok, sessoes: [{ id, rotulo, criadoEm, ultimoUsoEm,
  atual }] }`; `id` é um pedaço do hash do token. **`POST /api/auth/revoke`** recebe `{ id }` e
  responde `{ ok: true, eraAtual }` ou `{ ok: false, code: "sessao_inexistente" }`.
- **`GET /api/doctor`** refaz o diagnóstico e devolve o mesmo objeto da chave `doctor`.
  **`GET /api/diagnostics`** devolve `{ ok, markdown, falhas }`, com o texto que o motor monta e
  mascara. **`POST /api/claude/profile-test`** (`{ profileId }`) e **`POST /api/jira/test`**
  (`{ siteId }`) não gravam nada.

Regras que valem para quem mexer nela:

- **Segredo não passa da borda** (`src/contratos/segredos.ts`). Duas regras, estreitas de
  propósito, porque erram para os dois lados se forem frouxas:
  - por nome do campo, só TEXTO é descartado, e só quando o nome é um dos da tabela
    `NOMES_DE_SEGREDO` ou termina num deles, palavra a palavra (`token`, `ghToken`,
    `anthropicApiKey`, `senha`, `credential`, `authorization` e afins). Número e booleano nunca
    são segredo: `inputTokens`, `tokens`, `tokenOk`, `hasCredential` passam. Nome que só
    contém o pedaço não casa: `tokenizer`, `secretaria`, `chaveDoCard`, `key`, `cardKey`,
    `projectKeys`;
  - por valor, os formatos conhecidos de credencial, em qualquer posição do texto: JWT,
    `AKIA` e `ASIA` da AWS, `glpat-`, `ghp_`, `gho_`, `ghs_`, `ghu_`, `github_pat_`, `sk-ant-`,
    `sk-` só no formato de chave (longa e sem separador, para `sk-anthropic-1` passar),
    `xox?-` do Slack, `ATATT` do Atlassian, bloco PEM de chave privada, `Bearer` e `Basic`
    seguidos de credencial e endereço com `usuario:senha@`.
- **Texto curto sai inteiro; texto para ler só perde o trecho.** Um valor de até 200
  caracteres com formato de credencial (um rótulo, um endereço, um id) é descartado. Texto
  que a tela mostra para ler nunca some inteiro: o trecho é trocado por "[segredo omitido]"
  (`mascararSegredos`). Passam por essa máscara: o review (`reportMarkdown`, no Radar e no
  Histórico), os motivos de uma pendência (`reasons`), as linhas do feed de uma sessão
  (`activity`), o erro do motor (`error` do snapshot), o aviso do motor (evento `toast`), a
  frase de uma recusa (`error` e `erro` das respostas de ação), o erro de leitura do uso do
  plano (`claudePerfis.uso.*.erro`), o motivo e o aviso do teste de perfil, o motivo do teste
  do Jira e o relatório de `GET /api/diagnostics`.
- **Os tipos lidos não têm campo de segredo.** Os de `src/contratos/sistema.ts` são montados
  campo a campo: do segredo a tela só conhece a presença (`tokenOk`, `temChave`,
  `hasCredential`). Do perfil do Claude a chave (`apiKey`) e a pasta (`dir`) não são lidas nem
  guardadas, e não há lista crua de perfis no store, porque a tela não manda perfil de volta.
  O teste `sistema.test.ts` passa um snapshot com token, chave, senha e credencial e confere
  que nada disso chega ao store. Chave do snapshot sem tipo também passa por `semSegredos`. A
  tela não tem campo para digitar segredo.
- **O que ainda entra como veio.** Dois valores do store não são montados campo a campo, por
  desenho dos lotes anteriores: os itens de `decisions.resolved` e `config.people` cru (o
  corpo do salvar do Time).
- **Um salvar, uma seção, só o que a pessoa alterou.** O corpo leva a diferença entre o
  rascunho e o valor que a pessoa viu ao começar a editar, não a diferença contra o motor de
  agora: a conta manda os campos que ela alterou (`camposAlterados`); a automação, as chaves
  que ela alterou. Salvar a automação não reenvia política nem perfis.
- **Valor que muda no motor com a edição aberta** (`useRascunho`, `src/sistema/rascunho.ts`).
  Sem edição, o formulário acompanha o motor. Com edição, o rascunho é refeito sobre o valor
  novo: o campo que a pessoa não tocou passa a mostrar o que o motor tem, e não vai no corpo,
  então o que outra pessoa mudou não é desfeito. Das organizações vai a lista atual do motor,
  com o que a pessoa acrescentou e sem o que ela tirou (`organizacoesMescladas`). O campo que
  os dois mexeram, cada um para um valor, aparece no aviso com os dois valores, e a pergunta
  de ampliação é calculada contra o valor atual do motor. Cada formulário tem o descartar.
- **O `ok` não é o desfecho.** A automação confere a `config` da resposta contra o enviado,
  chave a chave (`diferencasDaAutomacao`): "gravou" ou "gravou diferente do pedido". A rota da
  conta não devolve a conta gravada: a tela diz o que pediu, o que o motor disse ter ignorado,
  e manda conferir no estado que chega.
- **Só salva com o estado em dia.** `impedimentoDeSalvar`: conectado e com o primeiro `state`
  da conexão atual (`estadoEmDia`). Vale para a conta e a automação.
- **Ampliar a publicação pergunta antes.** `ampliacoesDaConta` e `ampliacoesDaAutomacao` listam,
  com o efeito exato, o que amplia o que o motor faz ou publica sem clique: ligar a revisão
  automática, trocar esperar por publicar em qualquer dos três desfechos, acrescentar
  organização e desligar o CI antes de aprovar. A pergunta da conta diz quando a política nova
  vale e que a mesa não é reavaliada; a do CI diz primeiro o efeito imediato. O que reduz vai
  direto. Revogar sessão pergunta sempre.
- **A tela não manda campo vazio da política.** Vazio faria o motor regravar o padrão.
  `camposAlterados` só manda valor do domínio (`DOMINIO_DA_POLITICA`, conferido por teste
  contra `lib/settings.js`), e não manda `onCaveats` com `onClean` em espera. Nesse caso o
  campo é mostrado em espera sem mexer no rascunho, e a nota diz o ajuste: voltar a limpa para
  publicar devolve o com ressalvas ao valor que estava.
- **Valores permitidos.** Os modelos vêm do catálogo do motor (`modelos.claude`). Os níveis de
  `effort` e a faixa do paralelismo são cópia conferida por teste contra `lib/parse.js`
  (`automacao.test.ts`).
- **Edição por salvar.** A tela avisa no topo e segura o fechar e o recarregar da página
  (`beforeunload`).
- **Acessibilidade.** O efeito de cada seletor e de cada checkbox está ligado ao campo por
  `aria-describedby`. Depois de "Tirar" uma organização o foco vai ao campo de acrescentar.
  Depois de um salvar o foco vai à região de resultado.
- **Saúde é o que o motor mediu.** `verificacoesDaSaude` escreve uma linha por verificação, com
  o estado em texto ("OK", "Atenção", "Sem dado"); os rótulos são os de `ambienteDoDoctor`
  (`lib/engine/diagnostico.js`), conferidos por teste. Rodar o diagnóstico de novo não abre
  sessão de IA. Os caminhos de pasta que o `doctor` traz não são lidos.
- **Sessão atual.** Revogar a sessão `atual` avisa que este navegador volta ao pareamento, e
  depois do aceite a tela chama `app.esquecerSessao('revogada')`: o token sai daqui e a tela
  vai ao pareamento. Revogar outra pede a lista de novo.
- **Só leitura.** Os perfis do Claude (criar, tirar, chave de API, login da assinatura, perfil
  padrão), o Jira (sites e credencial), o login e o token do GitHub, e as cinco chaves de
  rede. `bind`, `hostPublico` e `origensPermitidas` mudam só pelo arquivo: tirar a própria
  origem trancaria a tela para fora.

### Lacunas do contrato

- **O endereço do site do Jira troca sem pedir a credencial.** A credencial fica guardada por
  `id` de site, e `POST /api/settings` com `jiraSites` aceita mudar o `baseUrl` de um site que
  já tem credencial: a próxima leitura manda o e-mail e o token do Atlassian para o endereço
  novo. Tirar o site e criar outro com o mesmo `id` dá no mesmo, porque a credencial fica. O
  perfil do Claude tem essa trava (`recusaDoEndereco`); o Jira não. A correção é no motor, e
  sem ela editar o endereço ou o `id` de um site por esta tela não é seguro. Neste lote a
  seção inteira ficou só leitura: a parte que seria segura (rótulo, organizações e projetos
  de um site, e site novo sem credencial) não foi construída.
- **A credencial do Jira, a chave de API e o login da assinatura só entram pela tela antiga.**
  As rotas existem (`jira/credential`, `claudeProfiles` com `apiKey`, `claude/login-web/*`),
  mas todas recebem segredo digitado, e esta tela não tem campo para isso.
- **"Presente" não é "válido".** `tokenOk` e `doctor.ghAuth` dizem que o `gh` tem token, não
  que o GitHub o aceita. A chave de API só tem `temChave`: o teste do perfil não a confere,
  porque custaria uma chamada paga. Validade de verdade só há para o login da assinatura
  (teste do perfil) e para a credencial do Jira (teste de conexão).
- **A rota da conta não devolve a conta gravada.** `POST /api/accounts/edit` responde só
  `ok` e `ignorados`: a conferência do que ficou depende do snapshot seguinte.
- **As organizações vão como lista inteira, sem versão.** O que a tela manda é a lista atual
  do motor com a diferença da pessoa, o que fecha o caso de quem viu a mudança chegar; a
  mudança de outra aba que ainda não chegou a esta é sobrescrita. A correção é no motor:
  operação de acrescentar e de tirar organização.
- **A política nova não reavalia a mesa.** Trocar esperar por publicar não publica o que já
  está em "Precisa de você", e a tela diz isso na pergunta. Não há rota para reavaliar.
- **A lista de sessões não está no snapshot nem tem evento.** Sessão criada ou revogada em
  outro navegador só aparece ao atualizar a lista.
- **As regras de review por organização e autor** (`reviewRules`) não são mostradas nem
  editadas: a tela só avisa que existem, porque decidem quem é revisado sozinho.
- **O limite total de sessões** (`globalParallelReviews`), o intervalo de checagem, a retomada
  de sessão, o modo rápido e as outras preferências que o motor aceita ficaram de fora deste
  lote. O limite total aparece como nota quando está ligado.
- **Trocar de aba do Farol descarta a edição sem perguntar.** A página só segura o fechar e o
  recarregar.
- **O diagnóstico não tem mensagem por verificação.** `doctor` traz valores, não frases: os
  detalhes das linhas são escritos aqui, com os mesmos textos do relatório do motor.
- **A recusa de `accounts/edit` e a de `auth/revoke` têm formas próprias** (`erro`; `code`),
  diferentes das outras ações; `lerRespostaDeAcao` lê as três.

## O renderizador de markdown

`src/markdown/markdown.ts` lê o texto de um review e devolve uma árvore de blocos e trechos;
`src/componentes/Markdown.tsx` desenha a árvore com elementos do React. Não há dependência,
`dangerouslySetInnerHTML` nem HTML montado por texto: todo conteúdo é filho de texto. Três
atributos levam valor que sai do review, cada um filtrado: o `href` do link (só o que passa
em `linkSeguro`), o `data-linguagem` do bloco de código (a palavra depois da cerca, só
letras, dígitos e `_ + # . -`, até 40) e o `start` da lista numerada (um número de até nove
dígitos).

O que ele lê: títulos (`#` a `######`), parágrafos (a quebra de linha fica, como no GitHub),
listas com marcador e numeradas (uma dentro da outra), citação, bloco de código com cerca
(crases ou tis), régua, negrito, itálico, código em linha, link `[texto](https://...)` e
endereço `https://` solto.

O que ele não lê, e aparece como o texto que é: HTML (`<script>`, `<img>`), tabela, nota de
rodapé, bloco de código por recuo e imagem (`![texto](endereço)` aparece inteira, e o
endereço dela não vira link).

O link (`linkSeguro`) só existe para endereço `https` com host. Não vira link, e fica como
texto: outro esquema (`javascript:`, `data:`, `http:`, caminho relativo), arroba na
autoridade (usuário e senha, mesmo vazios, como em `https://@host`), espaço, caractere de
controle ou controle de direção do texto (U+202A a U+202E, U+2066 a U+2069) no endereço. No
endereço solto o texto visível é o endereço normalizado, que é para onde o link vai (um host
escrito com ponto ideográfico aparece com o ponto comum). O link sai com
`rel="noreferrer noopener"` e `target="_blank"`. Destino local ou de rede interna
(`https://localhost`, por exemplo) passa: é `https`, o endereço fica à vista e quem abre é a
pessoa.

Tetos, porque o texto vem de fora:

- 100.000 caracteres, contados depois de a tabulação virar quatro espaços. O que passar é
  cortado, sem partir par substituto, e a tela diz. O motor limita em 60.000 o corpo do
  payload que publica (`MAX_REVIEW_BODY`), mas o texto que a projeção entrega pode vir de
  outra fonte (o relatório da sessão saneado), que não tem esse teto;
- 2.048 caracteres de endereço. Endereço solto que não terminou antes disso, ou que encosta
  no fim de um texto cortado, fica texto inteiro: não vira link para um pedaço dele;
- 6 níveis de citação e lista e 6 níveis de ênfase. Além deles o conteúdo vira texto.

O custo da leitura é limitado, não estritamente linear: não há expressão regular com
retrocesso sobre a linha, e a busca de fecho que falha é lembrada, mas cada `[texto](`
procura o `)` em até 2.348 caracteres. O pior caso é o texto de 100.000 caracteres feito só
de `[a](`, que custa perto de 60 milhões de passos (entre 0,1 e 0,2 s onde foi medido).
`markdown.test.ts` mede as entradas que travariam um leitor ingênuo, com 100.000 caracteres
cada, e exige menos de 1,5 s por entrada.

O título do texto começa no nível 4 (`nivelBase`), porque o review aparece dentro de um
cartão ou de uma seção que já tem título.

## Segurança

A Content-Security-Policy sai em toda resposta que passa pelo `src/proxy.ts`, montada por
`src/seguranca/csp.ts`. Passa por ele tudo o que pode ser HTML: as abas, a página não
encontrada (inclusive a de um caminho que só parece arquivo estático, como `/icon.svgx`) e os
pedidos de pré-carregamento. Ficam de fora só os arquivos de `/_next/static/`, o otimizador de
imagem (`/_next/image`) e o `/icon.svg`, cada um no caminho exato, e o redirecionamento da
raiz, que não tem corpo. `src/proxy.test.ts` prova o que casa e o que não casa. Em produção:

- `script-src 'self' 'nonce-...' 'strict-dynamic'` e `style-src 'self' 'nonce-...'`: sem
  `unsafe-inline` e sem `unsafe-eval`. O nonce muda a cada pedido, e por isso toda página é
  desenhada no servidor a cada pedido (nenhuma é estática);
- `connect-src 'self'` mais a origem de `NEXT_PUBLIC_FAROL_API`. Endereço recusado (veja
  "Variáveis") não entra: o `connect-src` fica só `'self'`;
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

Só no `npm run dev` entram `'unsafe-eval'` em `script-src` e `'unsafe-inline'` em `style-src`,
que as ferramentas de desenvolvimento do Next exigem.

`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` e `Permissions-Policy` (que nega
câmera, microfone, geolocalização e os outros recursos do aparelho) saem do `next.config.ts`,
em toda resposta; a lista está em `src/seguranca/cabecalhos.ts`.

As páginas de aviso (`not-found.tsx`, `error.tsx` e `global-error.tsx`) são do front porque as
embutidas do Next usam o atributo `style`, que esta CSP bloqueia.

O token da sessão fica no `localStorage` da origem do front, que é um só para todas as abas:

- "Sair" aborta as chamadas em curso, pede ao motor que revogue a sessão deste navegador e só
  então apaga o token daqui (`sair`, `src/estado/app.ts`). Ele acha a sessão `atual` em
  `POST /api/auth/sessions` e a revoga pelo `id` em `POST /api/auth/revoke`, com 5 s de prazo
  para as duas chamadas. As outras abas abertas vão ao pareamento junto, e parear numa aba
  conecta as outras;
- falha de rede, prazo vencido, rota que recusa, sessão `atual` fora da lista ou exceção no
  caminho não impedem o sair local: o token sai deste navegador do mesmo jeito (`try/finally`),
  e a tela de pareamento diz o que aconteceu (`textoDaSaida`, `src/sistema/sessoes.ts`). São
  três desfechos: a sessão foi revogada no motor; nada foi revogado, e ela continua valendo lá
  até expirar (não deu para pedir a lista, a rota recusou, ou a sessão não estava na lista);
  ou não deu para confirmar, quando o pedido de revogação saiu e a resposta não chegou (rede,
  ou o prazo venceu na segunda chamada). Nesse último a tela não afirma nem uma coisa nem
  outra. Para derrubar a sessão: Sistema, Sessões pareadas, a partir de um navegador pareado,
  ou todas de uma vez com `node tools/farol-parear.js --revogar-todas`;
- se o motor já recusava o token (401) quando o Sair o consultou, a tela vai ao pareamento
  pelo 401, com o aviso dele, e não diz que revogou;
- se outra aba já gravou outro token (pareou de novo) enquanto o Sair corria, esta aba não
  vai ao pareamento com um token válido guardado: relê o armazenamento e segue pareada com o
  novo, quer o aviso do navegador (`storage`) tenha chegado antes, quer só o 401;
- um 401 apaga só o token que foi recusado, nunca o que outra aba acabou de guardar.
