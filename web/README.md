# Front do Farol BIUD

A tela do Farol, em Next.js (App Router) e TypeScript estrito. O navegador fala direto com a
API do motor: `fetch` com `Authorization: Bearer`, e `x-farol: 1` em todo POST. Aqui não há
rota de API, cookie nem segredo.

Este pacote é independente do motor: tem `package.json`, `package-lock.json` e gate próprios.
Na Vercel, o diretório raiz do projeto é `web/`.

Hoje ele entrega a fundação (transporte, contratos, pareamento e a casca das cinco abas) e a
tela Radar. Histórico, Time, Consumo e Sistema ainda estão em construção.

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
| `src/componentes/` | Componentes de React, cada um com o CSS Module ao lado. Os de uma tela ficam numa pasta com o nome dela (`radar/`), com um CSS Module só |
| `src/contratos/` | Os tipos do que o motor manda e os leitores que conferem a forma na borda. `radar.ts` tem as chaves do snapshot que o Radar usa |
| `src/radar/` | A lógica do Radar, sem React: como fatiar o snapshot nos blocos (`fatias.ts`), como escrever o que o motor manda (`formato.ts`) e as ações, com rota, corpo e a mensagem de cada recusa (`acoes.ts`) |
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
  aparece pré-formatado; a renderização de markdown fica para o Histórico. O link do PR passa
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
