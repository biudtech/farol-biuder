# Front do Farol BIUD

A tela do Farol, em Next.js (App Router) e TypeScript estrito. O navegador fala direto com a
API do motor: `fetch` com `Authorization: Bearer`, e `x-farol: 1` em todo POST. Aqui não há
rota de API, cookie nem segredo.

Este pacote é independente do motor: tem `package.json`, `package-lock.json` e gate próprios.
Na Vercel, o diretório raiz do projeto é `web/`.

Hoje ele entrega a fundação (transporte, contratos, pareamento e a casca das cinco abas) e as
telas Radar, Histórico e Time. Consumo e Sistema ainda estão em construção.

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
| `src/componentes/` | Componentes de React, cada um com o CSS Module ao lado. Os de uma tela ficam numa pasta com o nome dela (`radar/`, `historico/`, `time/`), com um CSS Module só. `Markdown.tsx` desenha o texto de um review |
| `src/contratos/` | Os tipos do que o motor manda e os leitores que conferem a forma na borda. `radar.ts` tem as chaves do snapshot que o Radar usa; `historico.ts`, a página de `GET /api/decisions`, o detalhe por chave e a chave `pushbacks`; `time.ts`, a lista de `GET /api/team` e os perfis de `config.people` |
| `src/radar/` | A lógica do Radar, sem React: como fatiar o snapshot nos blocos (`fatias.ts`), como escrever o que o motor manda (`formato.ts`) e as ações das três telas, com rota, corpo e a mensagem de cada recusa (`acoes.ts`) |
| `src/historico/` | A lógica do Histórico, sem React: a tabela de rótulos de `status` e `action` (`rotulos.ts`) e a consulta que mora no endereço, com o pedido que ela vira e as frases do resultado (`consulta.ts`) |
| `src/time/` | A lógica do Time, sem React: a cópia conferida da taxonomia do perfil (`taxonomia.ts`) e o endereço, as fatias, o corpo de `people` e as frases (`time.ts`) |
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
  errada, ou `null`, conta como ausente (`campo`). O item aparece com o que deu para ler. As chaves de topo são lista fechada no motor (`test/snapshot-chaves.test.js`, na
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
  `bullets` são até dois pontos factuais sobre o trabalho. A ordem é a do motor: quem tem a
  entrada mais recente primeiro. O motor guarda dez entradas por pessoa
  (`writeMemory`, `lib/engine/decision.js`).
- **`config.people`** (`parsePeople`, `lib/parse.js`): `{ login em minúsculas: { papel?,
  dominios?: { dominio: nivel } } }`. Os valores aceitos são os de `lib/taxonomy.js`.
- **`POST /api/settings` com `{ people }`** troca o mapa inteiro pelo que chega
  (`updateSettings`, `server.js`). Valor fora da taxonomia é descartado sem recusa, e pessoa
  sem papel nem competência sai do mapa. Responde `{ ok, ignoradas, config }`.
- **`POST /api/team/remove` com `{ login }`** (`removeTeamMember`, `lib/engine/decision.js`)
  apaga o arquivo do dossiê, a entrada da pessoa em `config.people` e todo registro de
  `pushbacks` em que ela é a autora. Não há cópia: não se desfaz. Responde
  `{ ok: true, removed }` (`removed: false` quando não havia nada) ou
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
- **Salvar manda a lista inteira.** O corpo é o `config.people` que a aba tem no momento do
  clique, com a pessoa alterada (`comPerfil`). Por isso o salvar só é oferecido com a lista
  inteira e em dia (`motivoQueImpedeSalvar`): fica fechado quando o snapshot não trouxe os
  perfis, quando algum perfil chegou ilegível (salvar o apagaria) e quando o fluxo de eventos
  não está conectado (a lista pode estar velha). Se o perfil da pessoa muda no motor com a
  edição aberta, a tela avisa e deixa descartar a edição. O que não dá para evitar está dito
  na tela: alteração de outra aba que ainda não chegou aqui é sobrescrita.
- **O `ok` do salvar não é o desfecho.** O motor descarta valor que não reconhece sem
  recusar. A frase do resultado sai do `config.people` da resposta: "gravou", ou "gravou
  diferente do pedido", com o que ficou.
- **Remover pergunta antes.** É a pessoa inteira e não se desfaz. A pergunta
  (`confirmacaoDa`, `src/radar/acoes.ts`) diz o que é apagado, com o que a tela vê (quantas
  entradas, se há perfil, quantas contestações), e o efeito: a sessão não encontra histórico,
  o prompt sai sem perfil e sem contestações, e as contestações apagadas deixam de entrar
  como lição nas revisões de outros autores do repositório. Depois do aceite a tela pede a
  lista de novo; o perfil e as contestações saem com o estado que o motor empurra.
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
  sem que nenhuma fique sabendo. A edição da conta já é por operação (`accounts/edit`); a de
  perfil não.
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

- "Sair" aborta as chamadas em curso e apaga o token deste navegador. As outras abas abertas
  vão ao pareamento junto, e parear numa aba conecta as outras;
- "Sair" não revoga a sessão no motor: o token apagado continua valendo lá até expirar. O
  motor revoga uma sessão pelo identificador dela (`POST /api/auth/revoke`, com o `id` que
  `POST /api/auth/sessions` lista), e a tela que usa isso ainda não existe. Para derrubar
  todas de uma vez, `node tools/farol-parear.js --revogar-todas`;
- um 401 apaga só o token que foi recusado, nunca o que outra aba acabou de guardar.
