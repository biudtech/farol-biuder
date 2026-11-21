# Front do Farol BIUD

A tela do Farol, em Next.js (App Router) e TypeScript estrito. O navegador fala direto com a
API do motor: `fetch` com `Authorization: Bearer`, e `x-farol: 1` em todo POST. Aqui não há
rota de API, cookie nem segredo. A exceção é a [sessão pelo portão](#sessão-pelo-portão), em
que um login na frente injeta a credencial e o front manda o cookie da própria origem.

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
| `npm run start:socket` | Serve o build num socket Unix (`servidor.mjs`), no caminho absoluto de `FAROL_WEB_SOCKET`, com permissão 600; sem a variável, recusa. É o caminho da hospedagem compartilhada atrás de um proxy ([`docs/HOSPEDAGEM.md`](../docs/HOSPEDAGEM.md#hospedagem-compartilhada-sem-docker)) |
| `npm run test:servidor` | Prova o `start:socket` sobre o build (rode `npm run build` antes; só Linux): CSP por nonce, permissão 600, socket órfão, socket vivo e o encerramento |
| `npm run typecheck` | Gera os tipos das rotas (`next typegen`) e roda o `tsc` |
| `npm run lint` | ESLint, sem tolerar aviso |
| `npm test` | Vitest, com no máximo 4 workers |

O gate, antes de qualquer entrega, é o que o job `web` do CI roda:

```sh
npm ci && npm run audit && npm run typecheck && npm run lint && npm test && npm run build && npm run test:servidor
```

O `npm run audit` (`auditoria.mjs`) roda o `npm audit` e cobre também as dependências de
desenvolvimento: nada sobe com vulnerabilidade conhecida. A única saída é uma exceção em
`auditoria-excecoes.json`, com motivo e prazo, para advisory sem versão corrigida que fica fora do
build; exceção vencida e advisory nova reprovam. Hoje há uma: o `picomatch` (GHSA-fc5q-39xc-vjpf),
até 31/12/2026. O `overrides` do `package.json` existe por isso (fixa o `minimatch` usado pelo
`typescript-eslint` numa versão corrigida); quando o `typescript-eslint` passar a pedir a versão
corrigida sozinho, o `overrides` sai.

## Pastas

| Pasta | O que mora nela |
|---|---|
| `src/app/` | As rotas (App Router). Uma pasta por aba, o `layout.tsx` da raiz, o `globals.css` com as cores dos dois temas e as páginas de aviso do front (`not-found.tsx`, `error.tsx` e `global-error.tsx`) |
| `src/componentes/` | Componentes de React, cada um com o CSS Module ao lado. Os de uma tela ficam numa pasta com o nome dela (`radar/`, `historico/`, `time/`, `consumo/`, `sistema/`), com um CSS Module só (o Radar tem também o do painel De fora). `cartao/` é o cartão único de um PR, que todas as telas usam (redesenho de 19/11/2026). `Markdown.tsx` desenha o texto de um review |
| `src/contratos/` | Os tipos do que o motor manda e os leitores que conferem a forma na borda. `radar.ts` tem as chaves do snapshot que o Radar usa, e `de-fora.ts`, as chaves `deFora` e `emRetentativa`; `historico.ts`, a página de `GET /api/decisions`, o detalhe por chave e a chave `pushbacks`; `time.ts`, a lista de `GET /api/team` e os perfis de `config.people`; `consumo.ts`, a chave `usage` e o relatório de `GET /api/usage`; `sistema.ts`, as chaves `doctor` (só o estado dos perfis do Claude), `accounts`, `modelos`, `claudePerfis`, `jiraSites` e o resto de `config`, mais as respostas das rotas de sessões, testes, login da assinatura e credencial do Jira; `segredos.ts`, a tabela dos nomes de segredo, os formatos de credencial e a máscara de texto |
| `src/radar/` | A lógica do Radar, sem React: como fatiar o snapshot nas seções (`fatias.ts`), o recorte das postadas de hoje (`postadas.ts`), como escrever o que o motor manda (`formato.ts`), o que o cartão de um PR diz (`cartao.ts`), o painel De fora da fila em frases (`de-fora.ts`), a sessão que some sem resultado (`falhas.ts`) e as ações das telas, com rota, corpo e a mensagem de cada recusa (`acoes.ts`) |
| `src/historico/` | A lógica do Histórico, sem React: a tabela de rótulos de `status` e `action`, com o tom e o chip de cada desfecho (`rotulos.ts`), os dias da lista (`dias.ts`) e a consulta que mora no endereço, com o pedido que ela vira e as frases do resultado (`consulta.ts`) |
| `src/time/` | A lógica do Time, sem React: a cópia conferida da taxonomia do perfil (`taxonomia.ts`) e o endereço, as fatias, o corpo de `people` e as frases (`time.ts`) |
| `src/consumo/` | A lógica do Consumo, sem React: a consulta que mora no endereço e o pedido que ela vira (`consulta.ts`), os números em pt-BR e os rótulos (`formato.ts`), a geometria do gráfico (`grafico.ts`) e a auditoria do registro em frases (`auditoria.ts`) |
| `src/sistema/` | A lógica do Sistema, sem React: a política da conta, o que a pessoa alterou e o que amplia a publicação (`politica.ts`), as chaves de automação (`automacao.ts`), o rascunho refeito sobre o valor novo do motor (`rascunho.ts`), as sessões e o Sair (`sessoes.ts`), as ações, com corpo, pergunta e conferência (`acoes.ts`), o estado e o resumo de cada assunto do menu (`linhas.ts`), os assuntos e a rota de cada um (`assuntos.ts`), as regras por organização e autor (`regras.ts`), os padrões do time (`padroes.ts`), o ritmo (`ritmo.ts`), a ordem de uso dos perfis e o Subir na ordem (`perfis.ts`), o login da assinatura (`login-web.ts`) e os últimos cards e a credencial do Jira (`jira.ts`) |
| `src/markdown/` | O leitor de markdown próprio: texto para árvore de blocos e trechos, sem HTML e sem dependência |
| `src/transporte/` | O cliente único do motor: `get`, `post`, o fluxo de eventos, o token e o endereço. Sem React |
| `src/estado/` | O store e a sessão que liga o cliente ao store. A instância e o gancho `useApp` ficam em `instancia.ts` |
| `src/navegacao/` | A lista das abas |
| `src/tema/` | A troca de tema e o teste de contraste das cores |
| `src/seguranca/` | A regra da Content-Security-Policy e os cabeçalhos fixos que o `next.config.ts` devolve |
| `src/proxy.ts` | Gera o nonce e o cabeçalho da CSP a cada pedido; o `matcher` dele diz o que fica de fora |

## Convenções

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
caracteres, e guardado em `recados`, os três mais recentes, cada um saindo sozinho depois de
`DURACAO_DO_RECADO_MS`). Os outros (`needs-decision`,
`new-prs` e afins) passam por `aoEvento`, em `src/estado/app.ts`, e ainda não têm quem os
leia: é ali que entram. Exceção lançada ali não derruba a conexão: o
evento é descartado, o fluxo segue e o console recebe um aviso, uma vez.

O fluxo se cuida sozinho: 90 s sem nada do motor (contados desde o pedido, antes mesmo dos
cabeçalhos) derrubam a conexão, e a reconexão espera de 3 a 30 s, dobrando a cada falha. A
espera só volta a 3 s quando o fluxo entrega um evento, não quando o motor aceita a conexão.
Um evento que passa de 8 MiB sem terminar também derruba a conexão.

Quando a conexão cai com a tela já desenhada, a casca mostra a faixa "Sem motor"
(`FaixaDeQueda.tsx`) no alto do conteúdo: a hora da queda (a primeira desde o último
"conectado", medida aqui), que o que está na tela é do último estado recebido, e a hora da
próxima tentativa, que o cliente informa pelo recuo (`aoMudarConexao(conexao, esperaMs)`).
"Tentar agora" adianta essa tentativa (`tentarAgora` do fluxo aberto, por `app.tentarReconectar`)
sem zerar o recuo das seguintes. No começo de cada tentativa, a do relógio ou a do clique, o
fluxo avisa (`aoTentar`): a faixa troca a hora por "Tentando reconectar…" e o botão fica ocupado
até o desfecho, para nunca mostrar uma próxima tentativa já vencida. Sem estado recebido não há
faixa: a tela é a de conexão.

**Como testar.** O teste mora ao lado do arquivo, com nome `*.test.ts` ou `*.test.tsx`. Lógica
(transporte, contrato, estado) testa sem React, com `fetch` e relógio de mentira; escreva o
teste antes. Componente usa Testing Library e começa com `// @vitest-environment jsdom`. Cor
nova que vira texto entra em `src/tema/contraste.test.ts`.

**Estilo.** CSS Modules e as variáveis de `globals.css`. Sem atributo `style` e sem biblioteca
de componentes: a CSP de produção não aceita estilo em linha. Para texto sobre fundo de estado
use as variáveis terminadas em `-texto`, `--foco` para o anel de foco, `--borda-campo` para o
contorno de campo e `--borda-botao` para o de botão sem preenchimento. Espaçamento (margin,
padding e gap) só pela escala de `globals.css`, base 4 px: `--esp-meio` (2 px) e `--esp-1` a
`--esp-9` (4, 8, 12, 16, 20, 24, 32, 48 e 64 px). Os quatro espaços que precisam ser iguais em
todas as telas têm nome próprio: `--esp-secoes` (entre seções), `--esp-cartoes` (entre cartões),
`--esp-cartao` (o interno do cartão) e `--esp-cabecalho` (o lateral do cabeçalho e da página).
Valor solto em px nessas propriedades reprova em `src/tema/espacamento.test.ts` (só o traço de
1 px fica literal).

**API do Next.** A versão fixada traz a própria documentação em `node_modules/next/dist/docs/`.
Consulte-a antes de usar uma API do Next: ela mudou entre versões (o antigo `middleware` aqui é
`proxy`, por exemplo).

**Texto.** Tela e comentários em português, sem travessão. Jargão de IA não se traduz (token,
prompt).

## A tela Radar

A aba `/radar` é `src/componentes/radar/Radar.tsx`: o que o revisor autônomo está fazendo
agora. Ela lê o snapshot do store, fatia nas seções e liga os botões às ações. Cada PR é o
cartão único (redesenho de 19/11/2026, no molde do cartão da autoanálise do Farol;
`src/componentes/cartao/Cartao.tsx`, com o que cada peça diz em `src/radar/cartao.ts`), descrito
em "O cartão de um PR", abaixo. O cartão mora fora da pasta do Radar para as outras telas o
usarem:

| Seção | Componente | De onde vem |
|---|---|---|
| Topo: "Radar", "N em análise · N na fila" e o botão "Revisar um PR" | `Radar.tsx`, `RevisarUmPr.tsx` | a contagem do que está na tela (depois de `fatiarFila`); o painel do botão tem o campo da URL, o Revisar e o Checar agora com o estado da checagem (`status`, `lastCheckAt`, `nextCheckAt` e, com o ciclo em curso, `checagem`) |
| Checagem em curso | `Radar.tsx` | `checagem` com `status` `checking`: "Checando as N organizações · K de N · agora: dono", com o spinner pequeno, numa linha sem região viva (muda a cada segundo). O ciclo do motor busca por organização, e não por repositório: o desenho dizia "repositórios", e a tela diz a unidade que o motor conta |
| Avisos do topo | `Radar.tsx` | `account`, `status`, `error` e `buscasPausadas`; a checagem que falhou leva o Checar agora junto |
| Em análise | `EmAnalise.tsx` | `activeSessions` (com `progresso`, `pedido`, `estimativa`, `arquivosPr`, `pr.account`, `card` e `perfilId`, este com o rótulo de `config.claudeProfiles`) e o último evento de cada sessão em `activity`. A contagem ao lado do título; um cartão por sessão, com a porcentagem grande e a barra única; depois, as sessões que sumiram sem resultado e cujo PR não está mais na fila (`useFalhas.ts`) |
| Fila | `Fila.tsx` | `queue` sem os PRs de `deFora`, com `parked`, `inicioAutomatico`, `esperaConflito` e `emRetentativa`; depois `headlessWaitingPrs` com `headlessWaitingDetails`. A contagem e a pílula de De fora ao lado do título. Um cartão por PR, com a borda neutra, sem pílulas: a posição no canto, as marcas (rascunho, parada, em conflito, esperando vaga) ao lado do autor, e o rodapé com o ponto e o que segura o PR (a vaga, o conflito com a base, o limite do plano, a retentativa automática), com Revisar agora, Ignorar e Abrir no GitHub |
| De fora da fila | `DeFora.tsx` | `deFora`: o botão flutuante no canto ("De fora da fila", "Ver os PRs e o motivo de cada um" e o número), a pílula ao lado do título da Fila e o painel lateral que os dois abrem, descrito em "De fora da fila", abaixo. Com zero PRs de fora, o botão e a pílula não aparecem |
| Postadas hoje | `PostadasHoje.tsx` | `decisions.resolved`, cortado por `postadasDeHoje` (`src/radar/postadas.ts`), e o detalhe de cada uma em `GET /api/decision?key=&id=` (checks, `criteriosDoCard`, achados, `rodadasDoPr`, `tamanhoDoPr` e `execucao`), buscado uma vez por revisão. A borda e o parecer pelo que saiu (aprovado verde, pediu mudanças vermelho, comentado âmbar), Revisar de novo, Abrir no GitHub e, na faixa, Ver resultado (o Histórico com a revisão aberta) |
| Ignorados | `Ignorados.tsx` | só o que foi ignorado nesta aba (o snapshot não traz a lista); some quando não há nada |

Estados: antes do primeiro estado, o esqueleto com "Carregando o estado do motor."
(`role="status"`); tudo em dia (primeira checagem terminada, estado inteiro, nada em análise
nem na fila), o símbolo da BIUD, "Tudo revisado" e a próxima checagem quando o motor manda
`nextCheckAt`; primeira checagem em curso, a Fila diz que ainda não terminou, com o spinner;
primeira checagem que falhou, o erro com o Checar agora, e a Fila não diz que não há nada; chave
ausente, o erro diz qual, e a seção desenha vazia. Nenhuma notificação eterna (regra do dono de
20/11/2026): o que o motor respondeu a uma ação aparece no lugar dela, embaixo dos botões
(`ResultadoNoItem`), e some sozinho depois de `DURACAO_DO_RESULTADO_MS` (8 s, `useAcoes`). No
"Revisar um PR" a recusa aparece no painel, junto do campo, até a pessoa editar a URL, e o aceite
deixa "Na fila" ao lado do botão pelo mesmo tempo; no Time, a recusa do Adicionar e do Salvar
aparece junto do botão, até a pessoa editar o formulário. No pé da tela fica o anúncio
(`AnuncioDaTela`, `role="status"`, sem botão): os avisos do motor (evento `toast`) aparecem à vista,
discretos, e saem sozinhos depois de `DURACAO_DO_RECADO_MS` (8 s, `guardarRecado`); o resultado da
ação, que já está à vista no lugar dela, fica ali só para o leitor de tela e aparece quando o
anúncio recebe o foco. Nada no app depende de clique para sumir.

**Sem mesa e sem espera do CI.** O revisor é autônomo: o front não aprova, não pede mudanças,
não comenta e não pula pendência (`POST /api/decide` saiu do front), e não há bloco "Precisa de
você" nem "Esperando o CI". As pendências de `decisions.pending` não aparecem no Radar, não
contam no topo e não seguram o "Tudo revisado": o Histórico as mostra como "nada postado". O
leitor de `decisions.pending` continua em `src/contratos/radar.ts`, porque o Histórico o usa.

Regras que valem para quem mexer nela:

- **Um PR aparece uma vez.** `fatiarFila` tira da Fila o PR com sessão em curso, e da espera
  de execução o que ainda está na fila. É só exibição: a lista do motor não muda, e a contagem
  do topo conta o que está na tela.
- **A Fila mostra só o que o motor vai revisar.** O PR de `deFora` (o motor não vai revisá-lo
  sozinho, `lib/engine/de-fora.js`) sai da Fila, da espera e das duas contagens (`fatiarFila`),
  e aparece só no painel De fora. Quem decide o que é de fora é o motor: a tela não olha label,
  review nem regra.
- **Ação.** Todo POST passa por `executar` (`src/radar/acoes.ts`) e pelo gancho `useAcoes`,
  que guarda o que está no ar por alvo (o PR ou a sessão), desabilita os botões do alvo e
  publica o envio e o resultado na região viva. O botão clicado mostra o spinner e o texto do
  processo ("Enviando…", "Cancelando…", "Checando…", "Lendo o PR…"). A recusa do motor chega
  em `{ ok: false, blocked, error }`: `blocked` é o código, e a frase de cada código está na
  tabela `RECUSAS`. Código novo do motor entra ali; sem entrada, a tela mostra a frase que o
  motor mandou.
- **O `ok` do motor não é o desfecho.** Depois de `{ ok: true }` a tela só diz "O motor
  aceitou o pedido": o que aconteceu de fato vem no estado e no aviso dele (`toast`), que a tela
  mostra como texto. Não escreva frase que afirme publicação a partir do `ok`.
- **Confirmação.** `confirmacaoDa` diz quais ações perguntam antes e com que texto; no Radar,
  só o Cancelar. A pergunta abre no próprio item, fecha com Escape, e fecha sozinha, dizendo por
  quê, se o motor mudar o item e a ação deixar de ser oferecida. Ao confirmar, o foco vai ao
  anúncio da tela. Sessão com o cancelamento aceito mostra "Cancelando…" ocupado.
- **Postadas hoje é recorte, não regra.** Entra a resolvida com `action` publicado (`approve`,
  `request_changes`, `comment`: a régua `foiPublicado` do Histórico e do motor) e `resolvedAt`
  no dia de hoje, no fuso do navegador. O desfecho em texto sai de `ROTULO_DA_ACAO` e
  `textoDoStatus` (`src/historico/rotulos.ts`), então um `already_reviewed` aparece dizendo que
  nada foi publicado de novo. O link da revisão é o endereço que o Histórico lê
  (`/historico?id=…&pr=…`, `enderecoDa` de `src/historico/consulta.ts`). Item que o leitor
  descarta vira nota, para a lista vazia não esconder nada.
- **Texto de fora é texto.** Título, autor, motivo, feed e aviso do motor entram como filho de
  texto do React, nunca por `dangerouslySetInnerHTML`. O link do PR passa por `linkDoPr`: só
  `https://github.com/`, com `rel="noreferrer noopener"` e `target="_blank"`. A revisão sob
  demanda manda a URL canônica do PR (`prDaUrl`), não o que foi digitado.
- **Cor não é o único sinal.** Erro e aviso começam dizendo o que são ("Erro:", "Aviso:"), e a
  borda do cartão repete o que o nome do cartão, o rodapé e as pílulas já dizem em texto.
- **Hora.** As datas saem de `dataHora` e `horaCurta`, no fuso do navegador, sempre absolutas.
  O tempo decorrido da faixa é duração, não data, e é o único relógio da tela (um por cartão,
  de 1 s). Fora dele a tela não tem relógio: "hoje" é lido quando a lista das resolvidas (ou a próxima
  checagem) muda, e as funções sem React recebem o instante, para os testes não dependerem da
  hora.
- **Desenho.** A tela lê cada chave do snapshot por um seletor próprio, e as seções são
  `memo`: a seção só é redesenhada quando a fatia dela muda de referência
  (`Radar.desempenho.test.tsx`). Ao passar uma lista derivada a uma seção, use `useMemo`. O
  cartão da sessão recebe o último evento como número, para a linha nova do feed de uma sessão
  não redesenhar as outras. A barra é SVG com a largura em atributo: a CSP recusa estilo em
  linha.

### O cartão de um PR

O cartão único (`src/componentes/cartao/Cartao.tsx`, com o CSS Module ao lado) serve a todas as
telas: `Cartao` (a casca e o cabeçalho), `Pilulas`, `Faixa`, `Rodape`, `FaixaDaFila`, `Avatar`,
`AbrirNoGitHub` e `BotaoOcupado`. Muda só a borda e o que o cartão mostra pelo estado.

- **Borda pelo estado**: cartão na superfície, raio 16, borda de 1,5 px; rodando, 2 px da
  primária e a sombra leve (o único com sombra); postada aprovada, ok; pediu mudanças ou falha,
  perigo; sem sinal ou comentada, aviso; fila, neutra. As cores de estado na borda são misturadas
  com a superfície (`color-mix`), para ficarem leves nos dois temas. O estado também vai em texto:
  no nome do cartão (`article`), no rodapé e nas pílulas.
- **Cabeçalho**: a foto do GitHub do autor (`https://avatars.githubusercontent.com/<login>?s=72`,
  `alt` vazio, 44 px (40 no painel De fora), `loading="lazy"`, sem referer; a origem é a única
  imagem de fora no `img-src` da CSP; login que não tem forma de login e foto que falha caem nas
  iniciais), e numa linha a chave como link do PR, o login do autor, o ramo (quando a tela tem) e
  o contexto, só com o que existe (arquivos, quem pediu e o perfil do Claude, na sessão; a
  rodada, o card, o tamanho e a hora, na postada; a hora da última atualização, na fila); embaixo,
  o título. No canto, os botões, ou a posição na fila.
- **Botões**: rodando, "Revisando" ocupado ("Postando" na postagem); parado, Revisar agora (fila),
  Revisar de novo (postada) ou Tentar de novo (falha); Abrir no GitHub e Ignorar onde a ação
  existe. O botão ocupado é focável (`aria-disabled`): quando o botão clicado vira "Revisando",
  o foco vai para ele, e depois para o "Revisando" do cartão da sessão que abriu, nunca para o
  body (`marcarFoco` e `BotaoOcupado`, em `Cartao.tsx`); quem estava em outro lugar não é puxado.
- **Três pílulas** (sessão, falha e postada), chips na cor do estado: Checks obrigatórios (os
  `checks` do detalhe; enquanto roda, "Lidos no fim da revisão", porque o motor só lê os checks no
  fim), Card (os critérios de `criteriosDoCard`; enquanto roda, "Ainda não lido", "Lendo os
  critérios", e depois da etapa o card lido pela chave `card` da sessão, "BT-1 lido", ou "Nenhum
  card lido" quando ela não veio) e Parecer (o que foi publicado, com os bloqueios; "Em análise"
  ou "Nada foi publicado"). Sem dado, o traço com texto neutro.
- **Faixa** (`role="group"`): primeiro a barra única, a porcentagem da revisão inteira
  (`progresso.percentual`, arredondada) grande ao lado e a barra de 10 px com `aria-valuenow`,
  com a frase embaixo ("da revisão inteira · termina em cerca de N min", quando o motor estima
  o restante); sem o progresso, a barra indefinida, sem número; terminada, nenhuma. Depois as
  cinco etapas como detalhe, Fontes, Card, Código, Conferência e Postagem, cada uma com o traço
  e o nome, a feita com ✓ e verde, a atual na primária com `aria-current="step"`, a da falha com
  "!". Por último o rodapé: o que a sessão faz agora à esquerda (no código, "Lendo o código: K
  de N arquivos · agora em" o arquivo da vez, em código) e à direita o tempo decorrido, o típico
  ("típico N min", da `estimativa`) ou a conta que posta, e a ação (Cancelar ou Ver resultado).
  A falha (a sessão que sumiu sem resultado) não tem botão de dispensar: some sozinha quando chega
  sessão ou decisão nova do PR, quando o PR que estava na fila sai dela, ou no teto de
  `VALIDADE_DA_FALHA_MS` (30 min, `src/radar/falhas.ts`). Ela não deixa rastro no Histórico, que só
  mostra decisão; a tentativa fica no registro de consumo, com o desfecho. O tempo é um relógio de 1 s só da faixa, que troca o texto sem tirar o foco: o
  cabeçalho, o avatar e as pílulas não redesenham a cada segundo, e a borda do "sem sinal" vira
  com um disparo só, na hora. Com movimento reduzido o pulso da etapa para e a barra
  indefinida vira uma faixa parada.
- **Rodapé da fila** (`FaixaDaFila`): o ponto na cor do que segura o PR (segue sozinho, ok;
  espera conflito, limite do plano, retentativa ou o clique, aviso; parada, perigo) e o texto,
  com as ações à direita.
- **A etapa nunca recua**: é a do `progresso`, e o cartão guarda o piso para um estado atrasado
  não fazer a faixa voltar.
- **Estados**: ao clicar em Revisar, "Iniciando a revisão." na hora, antes do servidor
  (`useIniciadas.ts`; a recusa do motor desfaz, a sessão que abre ou o PR que vai esperar vaga
  encerram, e sem sessão em 2 min o cartão volta ao que era); buscando o código, lendo o card,
  lendo (o arquivo da vez), conferindo e postando, pela etapa; sem sinal, com mais de 45 s sem
  sinal de vida da sessão no código ou na conferência, que são as etapas
  em que o modelo trabalha; postada; e falhou: a sessão que some sem cancelamento e sem decisão do
  PR depois do começo dela, passados 3 s de carência (a decisão pode chegar no estado seguinte),
  com o motivo da parada do PR em `parked` ou do último aviso do feed. A falha aparece no cartão
  da fila quando o PR está nela, e sai quando o PR volta a ter sessão ou ganha decisão.
- **Sinal de vida**: a hora mais nova entre a última linha do feed, o começo da sessão e o
  `ultimoSinalEm` que o motor publica em `activeSessions` (`lib/engine/sinal-de-vida.js`): o
  modelo pensando ou escrevendo chega como `stream_event`, que não vira linha, e renova o sinal no
  máximo a cada 5 s.
- **Relógio do motor contra o do navegador**: as horas da sessão são do motor, e o relógio da tela
  é do navegador. A cada retrato a tela mede a diferença contra o `agora` do snapshot (a hora do
  motor quando ele foi montado), arredondada ao segundo e trocada só com 2 s ou mais de mudança
  (`useDesvio.ts`), e o tempo decorrido e o "sem sinal" contam na hora do motor. O `agora` sozinho
  não vira evento do SSE (`semMudanca`, `lib/estado-delta.js`): vai junto de toda mudança de verdade.

### De fora da fila

Os PRs pedidos à conta que o motor não vai revisar sozinho, cada um com o motivo
(`deFora`, montada por `lib/engine/de-fora.js` e lida em `src/contratos/de-fora.ts`). A tela não
decide quem é de fora: tira esses PRs da Fila e da contagem e os mostra aqui.

- **Botão e pílula.** O botão flutuante fica no canto de baixo da tela ("De fora da fila", "Ver
  os PRs e o motivo de cada um" e o número; o nome acessível diz "De fora da fila: N PRs."), e a
  pílula com o número fica ao lado do título da Fila. Os dois são botões de verdade, com
  `aria-haspopup="dialog"` e `aria-expanded`, e abrem o mesmo painel. Com zero PRs de fora,
  nenhum dos dois aparece. Embaixo da tela fica um respiro, para o botão não cobrir o último
  cartão. Com a fila vazia e PR de fora, a Fila continua na tela, dizendo que está vazia, com a
  pílula: o painel não depende só do botão flutuante.
- **Painel.** Um diálogo modal (`role="dialog"`, `aria-modal`) que entra pela direita, até
  560 px e a tela inteira no celular: o título "De fora com justificativa", quantos PRs ficaram
  de fora e que o Revisar continua funcionando em todos; os filtros por motivo (botões com
  `aria-pressed`: Todos e um por motivo com PR, na ordem de precedência do motor, cada um com a
  contagem); e um cartão por PR. Fecha no X, no Esc e no fundo escurecido; ao abrir, o foco vai
  ao X; Tab e Shift+Tab giram dentro dele; ao fechar, o foco volta a quem o abriu (o botão ou a
  pílula), ou ao conteúdo principal se ele saiu da tela. Quando o cartão com o foco sai do
  painel (o PR foi para a revisão), o foco vai ao cartão que ficou no lugar dele, ao último, ou
  ao X com a lista vazia, nunca à página. Enquanto o painel está aberto, o anúncio discreto
  das ações mora dentro dele, no pé, e sai do pé da página: o envio, o aceite e a recusa do
  "Revisar mesmo assim" são vistos e anunciados no modal.
- **O cartão de fora.** O cartão único, compacto, abre com o motivo em destaque, na cor do
  motivo e com um ícone: o título e o que aconteceu, e no rodapé quando o PR volta à fila, com
  Abrir no GitHub e "Revisar mesmo assim" (`POST /api/review` com a URL do PR, o mesmo pedido do
  Revisar de hoje; o motor aceita o clique em todos os motivos). O ignorado tem também o
  Restaurar, o mesmo da seção Ignorados do Radar. As frases moram em
  `src/radar/de-fora.ts` (`fraseDoMotivo`), uma por motivo:

| Motivo do motor | Filtro | Destaque | Quando volta |
|---|---|---|---|
| `decisao_de_gente` | Revisado por gente | "bia aprovou este commit" ou "pediu mudanças neste commit", com o head e a hora do review | no próximo commit |
| `outra_conta` | Outra conta revisando | "Outra conta está revisando", com quem e, pela label, desde quando | pela label, se ela sair sem review naquele commit ou quando ela caduca (`SINAL_REVISAO_TTL_MS`, 3 horas de label vista pelo Farol, sem contar o tempo com a máquina dormindo; `VALIDADE_DA_LABEL_HORAS` repete o número e o teste confere); pela saída de cena, no próximo commit |
| `estacionado` | Parado por falha | "Parado por falha", com a frase da parada e o motivo do motor | com commit novo ou pedido novo de revisão (`lib/engine/destrava.js`); a sessão cancelada e a parada sem motivo gravado (`legado`) não voltam sozinhas |
| `pedido_retirado` | Pedido retirado | "Pedido de revisão retirado", com a hora | quando a revisão for pedida de novo |
| `regra_manual` | Regra: só no clique | "Regra: só no clique", com a organização ou o autor da regra (`source` `organizacao` ou `autor`); com `escopo_desconhecido` ou `autor_desconhecido`, que há regra mas a organização ou o autor do PR é desconhecido | não volta sozinho: a regra muda no Sistema |
| `auto_desligado` | Revisar sozinho desligado | "Revisar sozinho está desligado" | quando o revisar sozinho for ligado no Sistema |
| `ignorado` | Ignorado | "Ignorado" | não volta sozinho |

Rascunho não é motivo (o motor não segura a primeira revisão por isso), e o desenho aprovado o
listava: a tela segue o motor. Quando volta é a regra que o motor já tem para cada motivo, dita em
texto; a tela não tem relógio para ela.

### Lacunas do contrato

O que a tela não faz porque o motor não manda. Cada item se resolve no snapshot ou na resposta
do motor, não com regra na tela:

- **O que o cartão não mostra.** As branches de origem e destino (a busca da fila, `gh search
  prs`, não as traz, e a sessão só lê a de origem quando há site do Jira: o cartão tem o lugar
  do ramo, e o Radar o deixa vazio), os checks em números ("4 de 4 verdes", que o desenho
  mostra: o motor guarda só os que não estão verdes), o estado dos checks enquanto roda (o motor
  só os lê no fim), quanto uma revisão costuma levar para um PR da fila (a estimativa existe só na
  sessão aberta) e qual review vai sair na postagem: a linha some, ou a pílula diz o traço. As falhas
  e os cliques em curso são desta aba: recarregar a página esquece.
- **O que acontece dentro da etapa.** O `progresso` traz os nomes das cinco etapas
  (`etapas`) e, no código, quantos arquivos foram lidos e o último que a sessão leu
  (`arquivoAtual`): é o último lido, não o que está sendo lido (o motor só vê a leitura quando
  ela volta). Qual review vai sair na postagem não se sabe antes do desfecho.
- **Checagem por organização.** A `checagem` conta as buscas por organização do ciclo; as buscas
  que vêm depois (os PRs pedidos à conta e os já revisados) e o resto do ciclo não entram, e com
  todas as organizações buscadas a linha fica em "N de N", sem "agora", até o ciclo terminar.
- **A lista dos ignorados.** O snapshot não a traz: só dá para restaurar o que foi ignorado
  na aba aberta.
- **Item ilegível da fila.** `queue` e `activeSessions` descartam o item torto com registro no
  console, sem contagem no estado: a Fila não consegue avisar "1 item ficou de fora" como as
  Postadas hoje avisam.
- **Postadas de um dia cheio.** O snapshot leva só as 30 resolvidas mais recentes: num dia com
  mais que isso, as mais antigas do dia ficam só no Histórico (o link "Ver histórico" leva
  para lá).
- **Quem vigia o dia.** Uma aba aberta da véspera troca de dia quando chega a próxima
  resolvida ou muda a próxima checagem.

### O que o front ainda não usa do que o motor manda

Cinco chaves do snapshot continuam sem tipo em `src/contratos/snapshot.ts` (`unknown`): chegam
ao store e nenhuma tela as lê. Aqui a lacuna é do front.

- **`reRounds`** (`reRoundParaUi`, `lib/engine/review.js`): por pendência de commit novo, o que
  a rodada automática vai fazer e a partir de quando, ou por que não vai. Sem ler a chave, a
  tela não diz se e quando o motor revisa de novo sozinho um PR que recebeu commit novo.
- **`baseline`**: desde quando o motor vigia e quantos PRs ficaram fora da fila na primeira
  checagem (`lib/engine/baseline.js`).
- **`filaJusta`**: o rodízio entre organizações e o teto de revisões simultâneas, como estão
  agora (`filaJusta`, `server.js`).
- **`reviewActions`**: a última ação registrada para cada PR que o snapshot traz
  (`snapshotReviewActions`, `lib/engine/snapshot-decisions.js`).
- **`paths`**: as pastas do motor (`home` e `workspace`).

## A tela Histórico

A aba `/historico` é `src/componentes/historico/Historico.tsx`. Ela mostra as revisões que o
motor já resolveu (até 3.000), uma página de 30 por vez, lidas de `GET /api/decisions`, e, antes
delas, as pendências da mesa que o snapshot traz. Não lê a lista das resolvidas do snapshot, que
só leva as 30 mais recentes. Desde o redesenho (lote 4, 19/11/2026) a lista usa o cartão único
do Radar (`src/componentes/cartao/`): um cartão por revisão, agrupado por dia, com o detalhe
aberto no próprio cartão.

| Parte | Componente | De onde vem |
|---|---|---|
| Topo | `Historico.tsx` (`Pagina`), `ExportarCsv.tsx` | "Histórico", "N revisões nos últimos 7 dias" (`recentes7Dias` da resposta, sem os filtros) e a frase do resultado (`total`, `page` e `pages`); o botão "Exportar CSV" pede `GET /api/decisions?formato=csv` com a busca e os filtros do endereço, sem página, e entrega o texto como arquivo `farol-historico-AAAA-MM-DD.csv` |
| Busca e filtros | `Filtros.tsx` | `q`, `veredito` (as pílulas do desfecho), `repo` e o período da rota; as opções de repositório são o `repos` da resposta |
| Sem nada postado ainda | `Lista.tsx` (`Pendencias`) | `decisions.pending` e `decisions.ilegiveis` do snapshot |
| Cartões por dia e paginação | `Lista.tsx` (`CartaoDaRevisao`), `Paginacao.tsx`, `src/historico/dias.ts`, `src/historico/cartao.ts` | `items`, `page`, `pages` e `total` da resposta |
| Detalhe no cartão | `Lista.tsx`, `Detalhe.tsx` (`Analise`) | o item da página, com `criteriosDoCard`, `checks`, `execucao` (com `perfis` e `sessoes`), `achados`, `rodadasDoPr` e `tamanhoDoPr` de `GET /api/decision?key=&id=` |
| Detalhe de fora da página | `Detalhe.tsx` | só `GET /api/decision?key=` (endereço colado com revisão que a página não traz, e as pendências da mesa) |
| Contestação do autor | `Contestacao.tsx` | a chave `pushbacks` do snapshot, pelo PR |

Regras que valem para quem mexer nela:

- **Quem busca e filtra é o motor.** A tela manda o que a pessoa escolheu e mostra o que
  voltou; não filtra nem ordena nada. O filtro de desfecho olha o que foi publicado (`action`),
  e por isso os rótulos dele dizem isso: Aprovados, Mudanças pedidas, Comentados, Não
  publicados.
- **Busca e desfecho à vista, o resto atrás de Filtrar.** O campo de busca fica sempre na tela,
  e o filtro pelo que foi publicado também, em pílulas (Todos, Aprovados, Mudanças pedidas,
  Comentados, Não publicados): cada uma é um botão de 44 px com `aria-pressed`, e a apertada usa o
  par da aba ativa. Valor de `veredito` do endereço que a tela não conhece vira uma pílula a mais,
  apertada, com "(valor do endereço)". Repositório e "Período" ficam no painel do botão Filtrar
  (`ui.gaveta`), que diz quantos estão valendo. Os que valem aparecem embaixo como chips; o X de
  cada um tira só aquele, e "Limpar filtros" tira os dois e mantém a busca e o desfecho. O período (últimos 7 ou
  30 dias, hoje incluído) mora no endereço como `periodo`, e vai ao motor como `desde`, o primeiro
  dia no fuso do motor (`desdeDoPeriodo`): a hora em que a revisão foi resolvida.
- **A consulta mora no endereço.** `q`, `veredito`, `repo`, `periodo`, `pagina` e a revisão aberta (`id`
  e `pr`, a chave do PR) ficam na query string (`src/historico/consulta.ts`), lidos por
  `useSearchParams` e escritos pela History API, que o Next integra ao roteador (o endereço
  muda sem pedir a página ao servidor do front). Filtro, página e abrir ou fechar a revisão
  empilham uma entrada; a busca digitada e a correção de página trocam a entrada atual.
- **Paginação, e não "Carregar mais".** O desenho mostra "Carregar mais", mas a página mora no
  endereço e uma página é um pedido ao motor: acumulando, o endereço da terceira carga teria de
  refazer três pedidos, o voltar do navegador não desfaria nada e o Atualizar do aviso de
  revisões novas não teria uma página para pedir. Anterior e Próxima levam o foco ao título da
  lista.
- **Busca com espera, pedido anterior abortado.** O campo espera 300 ms depois da última tecla
  (`ESPERA_DA_BUSCA_MS`); Enter manda na hora. Cada pedido novo aborta o anterior pelo
  `AbortSignal` do cliente, e resposta de pedido abortado não entra na tela.
- **Valor do endereço que a tela não conhece vai ao motor como veio.** Quem recusa é ele, com
  400 e o nome do campo, e a tela diz qual campo foi recusado. Só a página é saneada aqui
  (inteiro a partir de 1). Página além do fim (200 com `items` vazio e `pages` maior que zero)
  volta para a última.
- **Cartões por dia, no fuso de Brasília.** As revisões da página são agrupadas pelo dia de
  `resolvedAt` no fuso do motor (`FUSO_DO_HISTORICO`, `America/Sao_Paulo`, o mesmo do Período e
  do nome do CSV; `src/historico/dias.ts`): "Hoje, 19 de novembro", "Ontem, 18 de novembro",
  depois o dia da semana e a data por extenso (com o ano, se não é o de agora); sem hora, "Sem
  data registrada". O título do dia (h3) diz quantas revisões a página traz dele ("· 9
  revisões"); com mais de uma página, "nesta página", porque o dia pode continuar na outra. O
  "hoje" é o da hora em que a página chegou. A ordem é a do motor: itens seguidos do mesmo dia
  formam um grupo. As horas dos cartões também são de Brasília.
- **Um cartão por revisão** (`CartaoDaRevisao`, em `Lista.tsx`, com o `Cartao` do lote 3). A
  borda segue o que foi publicado (aprovado verde, comentado âmbar, pediu mudanças vermelho,
  nada postado neutra; `tomDoCartao`, `src/historico/cartao.ts`), e o estado vai em texto no
  nome do cartão. Fechado: a foto do autor, a chave (link para o PR), o autor, a hora, a rodada e
  o card (`contextoDoCartao`), o título do PR (h4) e, à direita, o selo do desfecho e a seta
  (botão de 44 px com `aria-expanded` e `aria-controls`, "Abrir o detalhe de PR #n de dono/repo").
  O motivo fixo do motor (`blockedReason`) fica embaixo, quando há. O motor não manda resumo
  curto do parecer, e o cartão não inventa um. Revisão que não publicou nada oferece "Revisar de
  novo" também fechada.
- **Pendências da mesa: "Sem nada postado ainda".** O front não tem mais mesa (aprovar, pedir
  mudanças, comentar, pular), e o motor não mudou: o que ele deixa em `decisions.pending`
  aparece no topo da aba, num grupo próprio antes da lista paginada, fora da busca, dos filtros
  e das páginas (vem do estado ao vivo, não da rota), e o grupo diz isso. Cada pendência é uma
  linha com a bolinha cinza ("Nada postado"), o título e a hora da análise; aberta, "O motor não
  postou nada ainda." seguido do motivo que ele manda (`blockedReason` e, se a publicação
  falhou, se ele ainda tenta sozinho, de `postRetry`), "repo#n · autor · nada postado", "Abrir a
  revisão" (o detalhe pela chave, `GET /api/decision?key=`) e "Revisar de novo" quando há URL
  de PR do GitHub. Nenhum botão de mesa. Pendência que a borda descartou é contada e avisada.
- **Rótulos numa tabela só.** `src/historico/rotulos.ts` traduz `status` e `action`, e dá o tom
  e o chip de cada desfecho. O teste ao lado varre `lib/engine/*.js`, pega todo arquivo que
  chama `resolveIntoHistory` ou `recordDecision` e reprova se um literal escrito num `status:`
  desses arquivos não tiver rótulo. É uma leitura de texto: status montado de outro jeito
  escapa dela, e na tela aparece cru. O parecer da sessão (`verdict`) só aparece quando difere
  do que foi publicado.
- **Publicado é o que o motor conta como publicado.** Só `approve`, `request_changes` e
  `comment` (`PUBLICADOS`, em `lib/engine/historico-paginado.js`). `action` ausente ou de
  valor desconhecido aparece como "Nada publicado" (o desconhecido, com o valor cru ao lado),
  que é como o filtro do motor o trata. A pendência da mesa mostra "Nada publicado ainda".
- **A lista não se refaz sozinha.** Quando o snapshot passa a ter revisão resolvida mais nova
  que a da última carga (`marcaDasResolvidas`: o id e a hora do topo de `decisions.resolved`),
  aparece o aviso "Há revisões novas" com o botão Atualizar, que pede a mesma página de novo.
- **Carregamentos.** Sem nada ainda, esqueleto ("Carregando as revisões."). Ao trocar filtro,
  busca ou página, a barra no topo da lista (`BarraDeCarga`) e a página anterior na tela,
  apagada (`ui.apagada`) e com `aria-busy`. O detalhe que espera o motor mostra esqueleto
  ("Carregando a revisão.").
- **Estados.** Nada revisado ainda: "Nenhuma revisão ainda", com o link para o Radar. Filtro
  sem resultado: a frase e "Limpar busca e filtros". Falha de rede tem Tentar de novo; com uma
  lista anterior, ela fica na tela e o erro diz que ela é da última carga que deu certo. Recusa
  de parâmetro tem "Limpar busca e filtros". Histórico indisponível (503,
  `historico_indisponivel`) diz isso e tem Tentar de novo. Item sem `id` ou sem `key` é
  descartado, contado e avisado. O resultado ("61 revisões, página 2 de 3") é a frase do topo,
  numa região viva educada.
- **Detalhe no próprio cartão.** A seta abre o detalhe dentro do cartão (uma região "Revisão
  de PR #n de dono/repo"), e a lista continua na tela; um cartão aberto por vez, porque a revisão
  aberta mora no endereço (`id` e `pr`) e o voltar do navegador fecha e reabre. O foco fica na
  seta; Escape (fora de campo de texto e de seletor) ou a seta fecham, e o foco volta à seta.
  Aberto, o cartão ganha as pílulas do Radar (checks, card e parecer, `pilulasDaPostada`), que
  dizem "Carregando" até o complemento de `GET /api/decision` chegar, a análise (`Analise`, a
  mesma do detalhe de fora da página) e o rodapé: a hora, o tempo (o do diário quando ele sabe a
  rodada, senão o das etapas), as sessões, o custo e os perfis do Claude (`rodapeDoCartao`), e as
  ações "Ver o review postado" (ou "Ver o texto da revisão", quando nada saiu; só com texto
  gravado), "Abrir no GitHub" e "Revisar de novo" (principal quando nada foi postado). Revisão que
  a página não traz (endereço colado, ou a pendência da mesa) abre no detalhe de fora da página,
  no lugar da lista, como antes: foco no título, "← Histórico", e "repo#n · autor · Nª rodada ·
  card", o título, o chip do que foi publicado, a hora e "Ver no GitHub" (só para
  `https://github.com/`). Nos dois, a análise mostra a frase da avaliação técnica (`technical.message`,
  o texto curto que o motor manda); e "Achados", uma linha por item: o bloqueio
  (`blockedReason`) aberto; os achados da sessão (`achados`), com a severidade (Bloqueia,
  Sugestão, Pergunta, Detalhe) e o título na linha, o que bloqueia e não foi resolvido aberto, e,
  dentro da linha, `arquivo:linha`, o resumo, a situação numa rodada seguinte e o trecho do diff
  daquela linha (só o lado do head, em `<pre>`, com o número de cada linha e a marca da
  adicionada); os motivos (`reasons`) e os pontos de atenção (`attention`) fechados. Em "Mais detalhes", fechados e com o resumo na linha: Critérios do card
  (`criteriosDoCard`, com o resumo "2 de 3 atendidos" e uma linha por critério, com a marca e o
  estado em texto: atende, não atende ou não conferido; só quando a sessão declarou), Checks do
  head (`checks`, com o resumo "tudo verde · osv herdado"), Execução (com `execucao`, o resumo "7 min · US$ 2,84" e
  duração, custo, modelo e os perfis do Claude da rodada pelo rótulo de `config.claudeProfiles`;
  "Sessões da rodada", uma por linha, da mais antiga para a mais nova, com a hora, por que rodou
  (primeira revisão, commit novo, rodada extra no mesmo commit, contestação do autor), o modelo, o
  perfil, o tempo, o custo, se retomou a conversa e o desfecho quando não foi `ok`; com `tamanhoDoPr`, "14 arquivos, +612 −148", ou só os arquivos nas
  revisões gravadas antes de 17/11/2026; sem ela, o que foi publicado; e sempre publicado,
  parecer, situação, card, datas, avaliação técnica, conferência de afirmações), Rodadas
  (`rodadasDoPr`, uma por linha, a mais nova primeiro: "3ª · 17/11/2026, 13:21 · a3f91c2 · pediu
  mudanças", com o resumo na linha pela contagem; e, abaixo, a comparação entre rodadas de
  `rounds` quando há), Etapas da sessão (`stages`) e o review completo, desenhado de markdown (ou "Esta
  revisão ficou sem texto gravado."). Revisão que não postou nada diz isso logo abaixo do
  chip.
- **Ações.** Passam por `executar` e `useAcoes`, como no Radar. "Ver o review postado" abre a
  linha "Review completo" da análise e leva o foco ao resumo dela (não há cópia do texto em outro
  lugar do cartão). "Revisar de novo", no rodapé do cartão aberto (e no pé do detalhe de fora da
  página), manda `POST /api/review` com a URL canônica do PR (`prDaUrl`) e não pergunta: o clique
  não publica, mas a análise que ele abre termina pela política da conta, que pode publicar
  sozinha, e o detalhe de fora da página diz isso. A contestação só aparece quando há registro para o PR, e
  as duas ações dela (`POST /api/pushback`) perguntam antes. Nenhuma publica no GitHub, mas
  gravar um desfecho tem efeito além da tela (`lib/engine/pushback.js`): o registro fica
  confirmado e marcado como manual, entra no prompt das próximas revisões dos PRs do autor
  e, com o desfecho `author_right` ou `mixed`, no das revisões de outros autores do mesmo
  repositório; e o motor deixa de procurar contestação naquele PR sozinho. Apagar o registro
  (desfecho vazio) desfaz isso. A pergunta diz o que vale para o desfecho escolhido.

### Lacunas do contrato

- **Os 7 dias do topo não seguem o filtro.** `recentes7Dias` conta todas as resolvidas dos últimos
  7 dias, sem a busca nem os filtros abertos, como o desenho: o total do filtro é a frase ao lado.
- **O CSV é o recorte do motor.** As colunas, o escape e a proteção contra fórmula são do motor
  (`lib/engine/historico-csv.js`); a tela só devolve a marca de ordem de bytes que a leitura do
  texto tira e entrega o arquivo. O nome do arquivo é montado aqui com o dia no fuso do motor,
  porque o cabeçalho do motor não chega de outra origem.
- **Resumo curto do parecer.** A projeção (`decisionForUi`) não traz um resumo de uma frase do
  parecer: a linha da lista fica sem resumo e a frase do detalhe é a da avaliação técnica.
- **Achados só pela rota do detalhe, e o trecho só daqui em diante.** `achados` vem da memória
  de rodadas, que só existe para a análise completa: revisão sem rodada gravada fica com os
  motivos, como antes. O trecho do diff é gravado nas provas desde 17/11/2026, só quando a linha
  do achado está no diff e nunca de arquivo de ambiente ou credencial; antes disso o achado
  mostra só `arquivo:linha`.
- **Critérios do card só quando a sessão os declara.** O campo `criteriosDoCard` é opcional no
  envelope e o prompt o pede só quando o card tem critérios de aceitação lidos: revisão sem card,
  com card não lido ou gravada antes de 17/11/2026 fica sem a linha. É o que a sessão declarou,
  e não decide nada: a decisão sobre o card continua sendo `cardMet` e a parte deste PR.
- **Critérios, checks e execução só no detalhe.** `criteriosDoCard`, `checks` e `execucao` vêm só em `GET /api/decision`
  (`lib/engine/detalhe-da-decisao.js`). A revisão aberta da página é pedida também, pela chave e
  pelo `id`, e ganha essas linhas quando a resposta é a mesma revisão (`useDetalhe`); aberta por
  endereço fora da página, vale a mais recente do PR, como antes. Os checks verdes não vêm por nome
  (o motor guarda só o que faltava), e revisão gravada antes de 17/11/2026 não tem checks. A
  execução é a da rodada (as tentativas do PR desde a revisão anterior), e a tela diz quando o
  começo é incerto (`inicioIncerto`).
- **Rodadas uma a uma.** `rodadasDoPr` é a lista das decisões guardadas do PR. A rodada é a
  posição entre as guardadas: com o histórico no teto, as primeiras podem ter sido descartadas,
  e a linha diz isso (`inicioIncerto`).
- **Pendência sem filtro.** As pendências vêm do snapshot, que não sabe da busca nem dos
  filtros: elas aparecem com qualquer consulta, e o grupo diz isso.
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
- **Do desenho do redesenho (lote 4), o que o motor não manda:**
  - "Ver o review postado" no GitHub: o motor não guarda o endereço do review publicado (nem o id
    dele). O botão abre o texto que o motor gravou (`reportMarkdown`), e "Abrir no GitHub" leva ao
    PR.
  - "Aprovado com ressalva" como selo: a projeção não separa a aprovação limpa da com ressalvas
    (`lib/engine/ressalvas.js` decide, mas o item não diz). O selo é o do que foi publicado.
  - "rodada 2 de 2" no cartão fechado: o "de N" vem de `rodadasDoPr`, que só chega com o detalhe;
    fechado, o cartão diz "2ª rodada" (`rounds.ordinal`), e aberto, "rodada 2 de 2".
  - A contagem de revisões do dia: o motor não manda total por dia; a do título é a da página.
  - Pílula "N bloqueios" à parte: os bloqueios entram na pílula do parecer ("Pediu mudanças · 2
    bloqueios"), como no Radar, e só com os `achados` do detalhe.
  - Os checks verdes por nome: o motor guarda só o que faltava, e a pílula diz "Verdes".
  - A cor do avatar: o cartão usa a foto do GitHub, ou as iniciais em cinza.

## A tela Time

A aba `/time` é `src/componentes/time/Time.tsx`. Ela mostra o que o motor guarda sobre cada
pessoa que teve PR revisado. É dado sobre colegas: fica no motor. Nada dele vai a
`localStorage` nem ao console (o registro da borda leva só contagem), e do endereço só consta
o login de quem está com o dossiê aberto (`?autor=`), que é o identificador que o motor já usa.

| Parte | Componente | De onde vem |
|---|---|---|
| Grade de cartões e busca | `Time.tsx`, `ListaDoTime.tsx` (`CartaoDaPessoa`) | `GET /api/team` (a lista inteira, com `numeros`) e `config.people` do snapshot |
| Dossiê | `Dossie.tsx` | o item da lista, `config.people` e `pushbacks` do snapshot, pelo autor |
| Papel e competência | `EditorDoPerfil.tsx` | `config.people`; grava com `POST /api/settings` |
| Remover do Time | `RemoverDoTime.tsx` | grava com `POST /api/team/remove` |
| Adicionar pessoa | `AdicionarPessoa.tsx` | grava com `people` em `POST /api/settings` |

O desenho é o enxuto (17/11/2026), com as peças de `src/componentes/ui`:

- **Grade de cartões** (redesenho, lote 4). "Time" e "N pessoas" no alto, com "Adicionar
  pessoa" como botão principal, a busca e uma grade (`auto-fill`, mínimo de 340 px; uma coluna no
  celular) com um cartão por pessoa, na casca do cartão único: a foto do GitHub (as iniciais
  quando o login não tem a forma do GitHub ou a foto falha; enfeite, `alt` vazio), o nome (h2; o
  do dossiê, ou o login), o @login, o papel numa pílula ("Sem papel" em âmbar); os números de
  30 dias que o motor manda (`numerosDoCartao`: PRs revisados, aprovados de primeira e, quando o
  motor conta, pedidos de mudança), ou a frase de que o motor não os mandou (nunca zero
  inventado); "O que o Farol já aprendeu", os dois pontos mais recentes que o motor anotou nas
  entradas do dossiê, sem repetir, de markdown (`aprendizados`); os domínios do perfil com o
  nível ("Frontend: Autoridade", `dominiosDoCartao`); e as ações "Ver dossiê" e "Editar papel",
  botões de verdade com o nome da pessoa para o leitor de tela. "Editar papel" abre o dossiê com
  "Como revisar os PRs desta pessoa" aberta e o foco no seletor do papel; o salvar é o mesmo do
  dossiê. Estados: esqueleto na
  primeira carga, barra no topo com a lista anterior apagada na recarga, "Ninguém do Time passa
  pela busca." com o Limpar, o cartão "Ninguém no Time ainda" e o erro com o Tentar de novo
  (com a lista anterior, quando há).
- **Dossiê.** "← Time" (nome acessível "Voltar à lista do Time"), o avatar, o nome e, sob ele,
  o login, o papel e o que o motor sustenta: quantas entradas guarda e o dia da mais recente.
  O desenho pedia "PRs em 30 dias" e "aprovados de primeira", que o motor não manda. Embaixo,
  uma `Linha` por assunto: "O que o Farol observa" aberta (os pontos das entradas, de
  markdown, agrupados pelo dia e PR da entrada); fechadas, com o resumo na linha, "Como
  revisar os PRs desta pessoa" (o editor; resumo com o papel e as competências), "Números"
  (os desfechos somados das entradas listadas, mais as contestações), "Últimas revisões" (uma
  entrada por linha, com a bolinha do desfecho, o PR e o dia) e "Contestações" (só leitura,
  quando há). Remover fica no fim, discreto. Estados: esqueleto ao abrir pelo endereço antes
  da lista chegar, sem dossiê, dossiê sem entradas (sem "Números" nem "Últimas revisões"),
  sem a lista do Time e sem dossiê nem perfil.
- **Botões ocupados.** Salvar diz "Salvando…" e Remover diz "Removendo…" (`Botao` com
  `ocupado`), com o spinner e desabilitados. O resultado aparece no lugar da ação e no anúncio da tela, e some sozinho.
- **Adicionar pessoa.** O botão do topo abre o formulário (`AdicionarPessoa.tsx`): login do
  GitHub obrigatório, conferido na forma do GitHub, e papel opcional. Vai por `people` em
  `POST /api/settings`, o mapa inteiro relido no motor logo antes (`GET /api/state`, `config.people`)
  com a pessoa nova a mais (`comPessoaNova`), e o motor
  guarda a pessoa sem papel quando a chave tem forma de login (`parsePeople`). Quem já está no
  Time não entra de novo, e a resposta só é dada como certa quando a pessoa está no mapa gravado.

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
- **Dossiê.** Abre na própria página, com o foco no título (o h1 do dossiê, que já existe
  enquanto a lista carrega), ou no papel, pelo "Editar papel"; Escape ou "Voltar à lista do Time"
  fecham, e o foco volta ao "Ver dossiê" do cartão (ou ao título da lista, se a pessoa não está mais nela). As entradas aparecem com o
  dia, o PR e o que foi publicado quando o motor diz; os pontos são desenhados de markdown,
  que é como o motor os grava. "Números" traz os de 30 dias que o motor manda (`numeros`:
  PRs, aprovação de primeira, rodadas por PR e, quando o motor manda, os bloqueios, as
  revisões publicadas que pediram mudanças; com o resumo "1,6 rodada por PR") e a contagem
  das entradas listadas. As contestações dos PRs da pessoa aparecem só para leitura: o
  desfecho se confirma no Histórico.
- **Salvar manda a lista inteira, montada do dado cru.** O store guarda `config.people` duas
  vezes: lido (`people`, para mostrar) e como o motor mandou (`peopleCru`). No clique, a tela
  relê o mapa no motor (`config.people` de `GET /api/state`, `relerPessoas` em `Time.tsx`) e o
  corpo do salvar sai dele, com só a pessoa editada mudando (`comPerfil`); releitura que falha
  não envia nada:
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

- **Criar uma pessoa é salvar o mapa inteiro.** Não há rota por pessoa: a pessoa nova vai no
  mapa inteiro de `config.people`, com o mesmo risco do salvar de perfil (abaixo).
- **Remover uma entrada só.** O motor só remove a pessoa inteira. Não há rota para apagar
  uma entrada do dossiê, nem cópia que permita desfazer.
- **Os valores permitidos não vêm do motor.** Papéis, domínios e níveis não saem em rota
  nem no snapshot: a tela tem a cópia conferida por teste.
- **O salvar de perfil não é por pessoa.** `people` vai e volta inteiro, sem versão: o motor
  não tem como recusar uma lista velha, e duas abas salvando ao mesmo tempo se sobrescrevem
  sem que nenhuma fique sabendo. O que a tela faz (releitura do mapa no motor logo antes do
  envio, salvar fechado sem o estado da conexão, conferência da resposta) reduz a janela ao
  intervalo entre a releitura e o envio, não a fecha. A correção de
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
- **Números no teto do histórico.** Com o histórico guardado no teto (3.000), o motor marca os
  números (`historicoNoTeto`) e a tela diz que valem para os PRs com histórico completo.
- **Números só de 30 dias e só de quem tem dossiê.** `numeros` vem no autor de `GET /api/team`
  (`lib/engine/numeros-do-time.js`), só com PR cuja primeira revisão publicada caiu na janela;
  quem só tem perfil não está na lista e fica sem números. Os bloqueios são os desses mesmos
  PRs, e não todo pedido de mudanças dos 30 dias.
- **A entrada não liga à revisão.** Vem o dia e a chave do PR, sem hora, sem endereço e sem
  o id da revisão: não dá para abrir a revisão no Histórico a partir dela. Entrada antiga traz
  só o nome curto do repositório, e aparece como veio.
- **Login que o motor não remove.** A remoção só aceita login no formato do GitHub (letras,
  dígitos e hífen, até 39). Dossiê de outro nome (`dependabot[bot]`, por exemplo) é listado,
  e a remoção dele é recusada com "login inválido".
- **A recusa de `POST /api/settings` tem outra forma.** Vem em `code` e `erro`, e a das
  outras ações em `blocked` e `error`; `lerRespostaDeAcao` lê as duas.
- **Do desenho do redesenho (lote 4), o que o motor não manda:**
  - "O que o Farol já aprendeu" como síntese: o motor não resume o dossiê. O cartão mostra os
    pontos mais recentes que a sessão anotou, como vieram; o resto fica em "Ver dossiê".
  - O nome da pessoa: só vem quando o título do dossiê traz um; senão o cartão mostra o login.
  - "pedidos de mudança" são revisões, não PRs: `bloqueios` conta as revisões publicadas dos PRs
    da janela que pediram mudanças, e motor antigo não manda (a caixa some).
  - Os domínios do desenho eram repositórios e produtos ("MIA", "engine-ai"); o motor só conhece
    os quatro domínios da taxonomia (`lib/taxonomy.js`) com o nível, e é isso que o cartão mostra.
  - O papel do desenho ("Dev pleno", "Infra") é texto livre; o motor aceita só os papéis da
    taxonomia.
  - A cor do avatar: o cartão usa a foto do GitHub, ou as iniciais em cinza.

## A tela Consumo

A aba `/consumo` é `src/componentes/consumo/Consumo.tsx`. Ela mostra quanto as sessões de IA do
motor consumiram (tokens e custo em dólar) e quanto ainda há de plano em cada perfil do Claude.
Só lê: a única ação é baixar o CSV. E só mede: o motor não tem teto de gasto (decisão de
16/11/2026), então a tela não mostra teto, bloqueio nem pausa.

No redesenho (lote 5, 19/11/2026, referência visual aprovada no canvas do Consumo) a tela tem,
de cima para baixo:

1. o título, a frase com o período (em dia de Brasília) e, à direita, os períodos prontos
   (Hoje, 7, 30 e 90 dias), botões com `aria-pressed`;
2. a barra de filtros: Buscar sessão, Repositório, Autor do PR, Modelo e Perfil do Claude, e
   "Outro período" (De e Até) que abre;
3. as pílulas do que está escolhido ("Filtrando:"), cada uma o botão que a tira, e Limpar filtros;
4. os números do período: custo estimado, revisões concluídas, execuções de IA (as tentativas,
   `attempts`) e tokens de saída. As quebras por repositório, modelo e gatilho também contam
   execuções; "Cada sessão" conta operações;
5. o plano de cada perfil do Claude, um cartão por perfil com o selo e as janelas do plano;
6. lado a lado, o custo por dia (uma barra por dia, cada uma um botão que vira o filtro do dia) e
   o custo por repositório (o nome é um botão que vira o filtro de repositório);
7. lado a lado, o custo por modelo e "Para que foi o gasto" (por gatilho);
8. "Cada sessão": a tabela paginada, uma linha por operação, que abre com os tokens por tipo, o
   tempo por etapa, as tentativas, os arquivos lidos, o card, Ver no Histórico e Abrir o PR, e
   o botão Baixar CSV;
9. fechadas numa linha cada (`Linha`): Detalhes do período, Sessões recentes e Auditoria do
   registro.

| Parte | Componente | De onde vem |
|---|---|---|
| Períodos prontos, barra de filtros e pílulas | `Filtros.tsx` | o endereço; as opções são o `options` da resposta |
| Números do período; plano de cada perfil | `Numeros.tsx` (`src/consumo/plano.ts`) | `totals`, `completed`, `retries`; `config.claudeProfiles`, `config.claudeProfileId`, `claudePerfis` e `activeSessions[].perfilId` do snapshot |
| Custo por dia e a tabela "Ver em tabela" | `CustoPorDia.tsx` | `series` (com dia clicado, do segundo pedido) |
| Por repositório, por modelo e por gatilho | `Quebras.tsx` | `repos`, `models` e `porGatilho` |
| Cada sessão, Baixar CSV | `Sessoes.tsx` (`src/consumo/sessao.ts`) | `history`; `formato=csv` |
| Detalhes do período e as notas | `ResumoDoPeriodo.tsx` | `totals`, `completed`, `retries`, `unidentified`, `incomplete`, `sinceDay` |
| Sessões recentes | `SessoesRecentes.tsx`, `TabelaDeExecucoes.tsx` | `usage.recentSessions` do snapshot |
| Auditoria do registro | `AuditoriaDoRegistro.tsx` | `usage.auditoria` do snapshot |

O contrato, lido do motor:

- **A chave `usage` do snapshot** (`usageSummary`, `lib/engine/usage.js`, pela projeção de
  `lib/engine/snapshot-usage.js`). A tela guarda `recentSessions`, `auditoria`,
  `sessionsSince` e `totals.sessions`. A chave traz também as séries por dia (`series`,
  `stackedSeries`, `matrixSeries`, até 120 dias), que a tela não usa: com elas a soma de um
  período teria de ser feita aqui.
- **`usage.recentSessions`**: as 100 sessões mais recentes, a mais nova primeiro, com `at`,
  `kind`, `ref`, `model`, `profileId`, os contadores de tokens, `costUsd`, `costSource` e
  `status`.
- **O plano por perfil** sai do que o snapshot já traz para o Sistema: a lista e a ordem dos
  perfis (`config.claudeProfiles`, o padrão em `config.claudeProfileId`), o uso do plano lido
  pelo motor (`claudePerfis.uso[id]`: `lido`, `ok`, `erro`, `desatualizado` e as `janelas`, cada
  uma com `nome`, `usado` de 0 a 1 e `resetTexto`), os problemas (`claudePerfis.problemas`) e o
  perfil de cada sessão em curso (`activeSessions[].perfilId`). O selo, nesta ordem: "Com
  problema: código", "Em uso agora", "Perfil padrão" ou "Sem uso agora" (neutro: o motor não
  diz o papel do perfil, e a tela não deduz um). Uso acima de 100% aparece
  como veio, com a barra cheia.
- **`GET /api/usage`** (`lib/engine/usage-activity.js`, `lib/usage/report.js`,
  `lib/engine/consumo-das-sessoes.js`) lê o diário inteiro. O contrato está em
  [`docs/CONSUMO-REVIEWS.md`](../docs/CONSUMO-REVIEWS.md#get-apiusage). A tela manda `start`,
  `end`, `kind` (só o que vem de um endereço antigo), `model`, `repo`, `author`, `profile`,
  `search` e `page`, e no CSV `formato=csv`. Não manda `pageSize`: vale o padrão do motor, 8
  operações por página. Lê `range`, `options` (com `author` e `profile`), `totals` (com
  `thinkingTokens`), `completed`, `retries`, `unidentified`, `sinceDay`, `series`, `models`
  (com `thinkingTokens`, `costUsd` e `unknownCost`), `repos`, `porGatilho`, `history` (com
  `pageSize`) e `incomplete`; em cada linha, `profile`, `gatilho`, `author`, `thinkingTokens`,
  a duração (`duration`, só com `durationKnown`) e, na página, `decisaoId`, `etapas`, `card` e
  `arquivosLidos`. Responde sempre 200, ou `{ ok: false, motivo }` com uma frase; o único 400 é
  o do formato torto.

Regras que valem para quem mexer nela:

- **A tela não soma entre linhas.** Toda soma é do motor: `totals` para o período, `series`
  por dia, `models` por modelo, `repos` por repositório, `porGatilho` por gatilho, `auditoria`
  para o registro inteiro. A tela não soma linhas de uma página nem tentativas de uma operação.
  As contas daqui são de exibição e ficam dentro de uma mesma linha: a largura de cada barra (a
  parte sobre a maior da lista, `fracao`), e os cinco tipos de token da mesma tentativa, somados
  para a coluna Tokens e para a largura das faixas da linha aberta (`somaDosTokens`). Custo médio
  por revisão seria conta da tela, e não entra.
- **O custo é sempre "estimado".** `costUsd` é o `total_cost_usd` que a sessão do Claude Code
  informa ao terminar; o motor não tem tabela de preço, e por isso não há custo por tipo de
  token (não-meta do desenho): a linha aberta mostra os tokens de cada tipo e o custo da sessão
  inteira. Cada execução mostra a origem do custo (`costSource`): informado pela sessão,
  "calculado pelo motor" ou "Desconhecido", que não mostra o zero gravado. A modalidade
  (assinatura, chave de API, sem registro) fica em Detalhes do período, e as sem modalidade
  viram nota à vista.
- **O clique vira filtro.** O nome do repositório filtra pelo repositório; a barra de um dia
  filtra pelo dia (`dia` no endereço). O motor só sabe recortar por período, então o dia vai
  como `start` e `end` iguais, e a tela faz um segundo pedido, o do período inteiro com os
  mesmos filtros e sem a busca nem a página (`caminhoDoPeriodo`), só para o gráfico por dia e os
  períodos prontos continuarem mostrando o período. Enquanto esse segundo pedido não volta, o
  gráfico segue com o último relatório do período que a tela teve (com os mesmos filtros), sem
  desmontar: o foco fica no botão clicado, os períodos prontos seguem valendo e não aparece
  pílula de período. A tela espera os dois pedidos (barra no topo, CSV desabilitado), e a falha
  ou a recusa do segundo aparece à parte, como "Gráfico do período", com o motivo. Clicar de
  novo no mesmo dia ou repositório tira o filtro, e a pílula também. Trocar o período (botão
  pronto, De, Até ou a pílula do período) tira o dia clicado.
- **Pílulas.** Uma por filtro ativo (`filtrosAtivos`, `src/consumo/consulta.ts`): período fora
  dos prontos, dia, tipo (de endereço antigo), repositório, autor, modelo, perfil (com o nome
  que a configuração dá) e busca. Tirar uma pílula empilha o endereço, e o foco vai ao título da
  página.
- **A linha que abre.** O botão da coluna Quando tem `aria-expanded` e `aria-controls`; a linha
  aberta mostra os tokens da tentativa mais recente por tipo (com a faixa e a lista em texto), o
  tempo de cada etapa (relativo à mais longa), as tentativas com o desfecho de cada uma e, com
  mais de uma, o custo e os tokens de cada tentativa, sem somar; os arquivos lidos, o card e o
  autor quando o motor os manda, e "o motor não informou", "nenhum card lido" ou "Sem etapas"
  quando não. A linha de uma operação com retomada diz "última de N tentativas".
- **A consulta mora no endereço.** `inicio`, `fim`, `dia`, `tipo`, `modelo`, `repo`, `autor`,
  `perfil`, `q` e `pagina` (`src/consumo/consulta.ts`): filtro, período pronto, clique e página
  empilham; busca, datas e página corrigida trocam a entrada. A busca espera 300 ms (Enter manda
  na hora), e cada pedido novo aborta o anterior. Valor que a tela não conhece vai ao motor como
  veio, e o seletor o mostra com "(valor do endereço)".
- **O hoje é o do motor.** Os períodos prontos terminam no `range.end` do relatório do período e
  gravam as duas datas no endereço; antes da primeira resposta ficam desabilitados. A tela não
  lê o relógio, a não ser para o nome de reserva do arquivo do CSV (o mesmo dia de Brasília que
  o motor usa). Fora dos prontos, nenhum botão fica marcado, o período vira pílula e "Outro período"
  nasce aberto, com a dica do que o motor faz com uma data só.
- **Data digitada só vira pedido quando serve.** O campo guarda o que se digita e só manda ao
  endereço um dia que existe, de 1970 em diante (`dataAceita`).
- **Baixar CSV** pede `GET /api/usage?formato=csv` com o mesmo recorte da tela (filtros, dia e
  busca, sem página), pelo cliente: o pedido leva o Bearer ou passa pelo portão, como todo
  pedido do front, e um link direto para a rota não levaria a credencial. O texto vira arquivo
  no navegador, com a marca de ordem de bytes, como no Histórico. O nome é o do
  `Content-Disposition` do motor (a opção `cabecalhos` do cliente); `nomeDoCsv` é só a reserva
  para quando ele não chega, que é o caso do motor em outra origem, cujo CORS não expõe o
  cabeçalho (pelo portão, na mesma origem, ele chega). Período que o motor não aceita volta em
  JSON (`{ ok: false, motivo }`) também no CSV: a tela diz a frase dele e não baixa nada. Enquanto
  a tela carrega um pedido novo, o botão fica desabilitado.
- **Gráfico com alternativa em texto.** As barras são SVG próprio, sem biblioteca, com a altura
  e a largura em atributo do SVG (a CSP recusa `style`). Cada barra do dia é um botão cujo nome
  diz o dia e o valor; a frase do período, o maior dia e o total ficam para o leitor de tela; e
  "Ver em tabela" traz os dias com execução. Nas quebras o valor está escrito ao lado da barra,
  que é decorativa. Período com mais de 120 dias não desenha as barras.
- **Cores só das variáveis** de `globals.css`, nos pares que `src/tema/contraste.test.ts`
  confere nos dois temas: barra `--accent` sobre o trilho `--surface-2`, barra do dia escolhido
  `--text`, nome clicável `--link` e, escolhido, `--accent-ink` sobre `--accent`, período marcado
  e pílula `--surface` sobre `--text`, foco `--foco`.
- **Celular.** Os blocos lado a lado viram coluna, a barra de filtros quebra linha, as barras
  das quebras descem para baixo do nome, e a tabela larga rola no próprio contêiner, que tem
  nome e recebe foco. A página não rola para o lado em 375 px.
- **O relatório não se refaz sozinho.** Quando `usage.totals.sessions` do snapshot muda, aparece
  o aviso de sessão nova com o botão Atualizar. O plano, as sessões recentes e a auditoria vêm do
  snapshot e andam sozinhos.
- **Estados.** Na primeira carga, o esqueleto; o plano, as sessões recentes e a auditoria não
  esperam. Ao trocar período, filtro ou página, a barra de carga aparece e o relatório anterior
  fica apagado (`ui.apagada`) e com `aria-busy`. Sem execução no período, a frase (com filtro ela
  muda) e os números zerados do motor. Falha de rede tem Tentar de novo; recusa que nomeia um
  campo oferece limpar; `{ ok: false, motivo }` mostra a frase do motor e oferece voltar ao
  período padrão (sem datas e sem dia). Item sem o que o identifica é descartado, contado e
  avisado; número que não veio aparece como "sem dado", não como zero. A região viva
  ("Resultado da consulta", escondida da vista) anuncia o resultado de cada carga.
- **Número torto não vira "US$ NaN".** Negativo, infinito ou que não é número aparece como
  "valor inválido". As funções puras não lançam com valor denormal, enorme ou `NaN`.

### Lacunas do contrato

- **Sem custo médio por revisão.** O desenho tem "Custo médio por revisão" e a mediana do tempo
  por revisão; o motor conta as revisões concluídas e soma o custo do período (que inclui erro,
  contestação e rodada extra), mas não manda nem a média nem a mediana. O número saiu da tela.
- **O dia clicado é um período de um dia.** O motor não tem filtro por dia: a tela manda
  `start` e `end` iguais e faz um segundo pedido para o gráfico. Um parâmetro `day` (ou a série
  do período junto do recorte do dia) tiraria o segundo pedido.
- **A busca não olha título, autor nem card.** `search` procura na referência, no tipo e no
  modelo; o desenho sugeria "PR, título, autor ou card". O autor tem filtro próprio; título e
  card o diário não guarda.
- **Arquivos lidos é uma contagem.** `arquivosLidos` é `provas.cobertura.lidos`; o total do PR
  (o "de N" do desenho) e a conferência do uso fora do diff não vêm.
- **O card vem só com a chave.** Sem o texto de "lido e cumprido" ou "parte deste PR
  comprovada": isso está no detalhe da decisão, em `GET /api/decision`.
- **Rodada que ainda não decidiu fica sem etapas, card e arquivos**, e a contestação também.
- **Gatilho com limite conhecido.** A revisão retomada depois de um reinício e o clique manual
  contam como `primeira` (`gatilho-da-sessao.js`). Registro antigo sem marca também.
- **Sem total por operação na página.** A linha mostra a tentativa mais recente; aberta, cada
  tentativa com o custo e os tokens dela. O CSV soma as tentativas do recorte (o motor faz).
- **Desfecho é o da sessão, não o do review.** A pílula da tabela é o `status` da sessão
  (Concluída, Erro, Parcial); o veredito publicado (aprovado, pediu mudanças) está no Histórico,
  e o diário não o traz.
- **Um perfil só por linha.** `profile` é o perfil da tentativa mais recente da operação.
- **O plano não vem por período.** O uso de cada janela é o de agora, lido pelo motor; não há
  série do uso do plano nem gasto por perfil no período (a quebra por perfil não existe;
  `byProfileDay` é gravado e não tem leitor).
- **A recusa não tem código nem campo.** Período inválido volta como 200 com
  `{ ok: false, motivo }`. Filtro com valor que não existe não é recusado: volta vazio.
- **Dois dias diferentes.** O diário e `GET /api/usage` usam o dia de Brasília; o agregado
  (`usage.series`) usa o dia local do processo do motor. A tela não usa o agregado.
- **As execuções por chave de API não são contadas.** O motor soma o dólar delas e conta só as
  de custo desconhecido.
- **Sem endereço do PR.** Vem só a chave `dono/repo#n`; a tela monta o endereço do GitHub
  (`urlDoPr`), e referência de outro formato fica como texto.
- **Os períodos não vêm do motor.** Hoje, 7, 30 e 90 são escolha da tela.
- **Página além do fim não é dita.** O motor devolve a última página sem avisar; a tela
  compara `history.page` com o pedido e corrige o endereço.
- **`account`, `provider`, `device`, `focus` e o tipo não são oferecidos.** Uma instância tem uma
  conta, um provedor e um aparelho; o tipo saiu da barra no redesenho (o gatilho diz mais), e o
  `tipo` de um endereço antigo continua valendo, como pílula.
- **O baixar do CSV repete o do Histórico.** `baixar` de `Sessoes.tsx` é o mesmo de
  `ExportarCsv.tsx`; ficou duplicado para este lote não tocar o Histórico (lote 4). Pode virar
  um módulo comum depois dos dois.

## A tela Sistema

A aba `/sistema` é `src/componentes/sistema/Sistema.tsx`. É a tela que mais pode fazer estrago:
muda o que o motor publica sozinho no GitHub, quem tem acesso a ele e duas credenciais. No
redesenho de 19/11/2026 (lote 6; meta 8 e decisões 3 e 4 do desenho) ela é um menu de assuntos à
esquerda, cada um com a bolinha de estado (verde OK, âmbar atenção, vermelho problema, cinza sem
dado ou desligado) e um resumo, e o assunto aberto à direita. São os sete assuntos do desenho
aprovado (decisão do dono): a Saúde do motor e o bloco Rede e acesso saíram da tela, com o código
que só eles usavam. O diagnóstico continua no motor, pela API (`GET /api/doctor` e
`GET /api/diagnostics`), que a tela não chama. O estado e o resumo de cada assunto saem do que
ele já calcula (`src/sistema/linhas.ts`). Sem o estado do motor a página mostra o esqueleto.

**A rota guarda o assunto** (`src/sistema/assuntos.ts`): `/sistema/<assunto>`, com `conta`,
`regras`, `padroes`, `claude`, `jira`, `ritmo` e `acesso`, nessa ordem no menu (`/sistema/saude`
é 404).
`/sistema` abre o primeiro, e assunto que não existe é 404. A tela mora no layout de `/sistema`
(`src/app/sistema/layout.tsx`, `SistemaNaRota.tsx`, que lê o assunto de `usePathname`); a página
`src/app/sistema/[[...assunto]]/page.tsx` só confere o endereço e chama `notFound()`. Como o
layout fica montado quando só o assunto muda, e todos os assuntos ficam montados com só o aberto
visível (`hidden`), **trocar de assunto não perde o que foi digitado em outro**. O clique no menu
leva o foco ao título do assunto. **No celular** (até 760 px) o menu vira a lista: `/sistema`
mostra só a lista, sem item marcado como a página atual (a largura sai de `matchMedia`, a mesma
do `@media` do CSS), e `/sistema/<assunto>` mostra só o assunto, com o link Voltar aos assuntos.

| Assunto | Componente | De onde vem | O que edita |
|---|---|---|---|
| Conta revisora | `ContaEPolitica.tsx` | `accounts` do snapshot; a política explicada em frase (`fraseDaPolitica`, `src/sistema/politica.ts`); as duas regras fixas do motor, como texto | organizações e os quatro campos da política, por `POST /api/accounts/edit` |
| Regras por organização e autor | `Regras.tsx` | `accounts[].reviewRules` (lido em `regras`, `src/contratos/sistema.ts`) | cria, troca o modo e remove uma regra por vez, por `POST /api/accounts/edit` com `tipo: "regra-review"` |
| Padrões do time | `Padroes.tsx` | `accounts[].padroesRevisao` (lido em `padroes`, com o trecho em formato de credencial trocado) | o texto inteiro, por `POST /api/accounts/edit` com `campos.padroesRevisao` |
| Claude | `PerfilDoClaude.tsx`, `LoginWeb.tsx` e `Automacao.tsx` (bloco Modelo e sessões) | `config.claudeProfiles` e `claudeProfileId`, `claudePerfis.uso`, `doctor.claudeAuth`, `modelos.claude` | Subir na ordem (`claudeProfileId` e `claudeProfiles`), `parallelReviews`, `reviewModel`, `reviewEffort` e `reviewFast`, por `POST /api/settings`; Testar (`POST /api/claude/profile-test`); Refazer login (`POST /api/claude/login-web/*`) |
| Jira | `Jira.tsx`, `CredencialDoJira.tsx` | `jiraSites` e, dos últimos cards lidos, `decisions.resolved` do snapshot | Testar (`POST /api/jira/test`) e Trocar credencial (`POST /api/jira/credential`) |
| Ritmo da revisão | `Ritmo.tsx` | `config` do snapshot | `intervalSeconds`, `reReviewResume` e `autoPushback`, por `POST /api/settings` |
| Quem está conectado | `Sessoes.tsx` | `POST /api/auth/sessions` | Sair (a sessão deste navegador) e Revogar (as outras), por `POST /api/auth/revoke` |

**A tela não tem teto de gasto** (decisão de 16/11/2026): o revisor é autônomo e não trava por
gasto. O motor não tem mais o gate, e a tela não mostra, não edita nem avisa teto. Nenhum fonte
lê campo de teto (`sistema/acoes.test.ts` confere). O campo de teto que um `config.json` antigo
ainda traga num perfil (`budgetDaily`, `budgetTotal`, `budgetSince`, `budgetByWeekday` ou
`budgetDates`) é descartado pelo motor na carga e não chega à tela.

O contrato, lido do motor:

- **`POST /api/settings`** (`updateSettings`, `server.js`) mescla por chave de topo: só a chave
  que vai no corpo muda, e cada uma passa pelo saneador dela (`SETTINGS`, `lib/settings.js`).
  O valor de uma chave troca o anterior inteiro. Responde `{ ok, ignoradas, config }`, com a
  `config` sem a chave de API; valor que o motor não aceita não é recusado. Antes de gravar, a
  rota repõe a pasta e a chave de API que o motor já guardava de cada perfil (`patchDaTela`,
  `lib/engine/chave-do-perfil.js`) e recusa com `{ ok: false, code: "chave_exigida", erro }` a
  lista que mudaria o endereço de um perfil de chave sem a chave de novo (`recusaDoEndereco`).

  | chave | o corpo | o que o motor faz com valor inválido | onde é usada |
  |---|---|---|---|
  | `parallelReviews` | o número | fora de 1 a 4 vai para a ponta; o que não é número mantém o anterior | `parallelLimit`, `lib/engine/headless-fila.js` |
  | `reviewModel` | o texto (vazio é o padrão do Claude Code) | fora do catálogo e do formato de nome completo mantém o anterior | `buildModelFlags`, `lib/engine/session.js`, e o roteador do Auto |
  | `reviewEffort` | o texto (vazio não manda a flag) | fora de `low`, `medium`, `high`, `xhigh` mantém o anterior | `buildModelFlags`, `lib/engine/session.js` |
  | `reviewFast` | o booleano | qualquer valor vira booleano | o modo rápido, `lib/engine/review.js` e `lib/modelos.js` |
  | `intervalSeconds` | o número de segundos | fora de 180 a 3600 vai para a ponta; o que não é número vira 300 | o ciclo de checagem; salvar faz o motor checar na hora |
  | `reReviewResume` | o booleano | só `false` desliga | a retomada da sessão na rodada nova, `lib/engine/review.js` |
  | `autoPushback` | o booleano | qualquer valor vira booleano | `scanPushbacks`, `lib/engine/pushback.js` |
  | `claudeProfileId` e `claudeProfiles` | o padrão e a lista INTEIRA, só do Subir na ordem | perfil incompleto sai da lista | `candidatosDaConta`, `lib/engine/perfil-claude.js` |
  | `people` | o mapa INTEIRO (tela Time) | valor fora da taxonomia é descartado | `personProfileBlock`, `lib/engine/review-prompt.js` |
  | `jiraSites` | a lista INTEIRA (o front não manda) | site inválido ou repetido sai da lista | `lib/engine/jira.js` |

  `bind`, `hostPublico`, `origensPermitidas`, `port` e `localAuth` não são aceitas (e a tela não
  as lê nem mostra): voltam em
  `ignoradas`. `aguardarCiParaAprovar` e `aguardarCiParaRevisar` saíram do motor em 17/11/2026 (o
  revisor nunca espera o CI) e também voltam em `ignoradas`.
- **`reviewModel` aceita dois formatos** (`sanitizeModel`, `lib/parse.js`): um apelido do
  catálogo (`auto`, `best`, `opus`, `sonnet`, `fable`) ou um nome completo `claude-...`, só com
  letras minúsculas, dígitos e hífen, que é a escotilha para modelo novo. O seletor oferece só
  o catálogo que o motor manda; o nome completo entra pelo arquivo de configuração e aparece
  na tela como opção extra, dita como fixada no arquivo. Qualquer nome com `haiku` é recusado.
- **`POST /api/accounts/edit`** (`aplicarEdicao`, `lib/engine/contas-config.js`) recebe uma de
  duas operações sobre a conta que o motor tem:
  - `{ tipo: "editar", user, campos }`: cada campo troca o valor, e `owners` troca a lista inteira
    de organizações. Campo que não vai não muda. Campo vazio apaga o valor: nos quatro da
    política o motor regrava o padrão, que publica sozinho; em `padroesRevisao`, tira os padrões;
  - `{ tipo: "regra-review", user, organization, author?, mode }` (`editarRegra`,
    `lib/engine/review-scope.js`): `mode` é `auto` (revisa sozinho), `manual` (só no clique) ou
    `inherit` (tira a regra). Sem `author` a regra é da organização; com ele, só daquele autor
    ali, e vence a da organização. Organização e autor vão em minúsculas, sem o @; nome fora da
    forma do GitHub é recusado com `{ ok: false, erro }`. Mexer numa regra nunca regrava as outras.

  Responde `{ ok: true, ignoradas, ignorados }` (sem a conta gravada), ou `{ ok: false, erro }`.
  Desde 17/11/2026 o motor não aceita `wait` em desfecho nenhum: o pedido volta em `ignorados`.
- **Quando a política nova vale.** O motor lê a política ao começar cada revisão
  (`politicaDeInicio`, `lib/engine/review-scope.js`, que também aplica as regras por organização e
  autor), ao decidir o resultado de cada uma (`shouldAutoApprove` e `shouldAutoReject`,
  `lib/engine/approval-policy.js`). O evento `settings-changed` é emitido e ninguém o ouve.
- **O revisor nunca espera o CI** (17/11/2026). O motor não tem mais a chave
  `aguardarCiParaAprovar`.
- **`POST /api/auth/sessions`** responde `{ ok, sessoes: [{ id, rotulo, criadoEm, ultimoUsoEm,
  atual }] }`; `id` é um pedaço do hash do token. **`POST /api/auth/revoke`** recebe `{ id }` e
  responde `{ ok: true, eraAtual }` ou `{ ok: false, code: "sessao_inexistente" }`.
- **`GET /api/doctor`** e **`GET /api/diagnostics`** ficam só na API: a tela não as chama. Da
  chave `doctor` ela lê só `claudeAuth` e `claudePerfilPronto`, para o assunto Claude.
  **`POST /api/claude/profile-test`** (`{ profileId }`) e **`POST /api/jira/test`**
  (`{ siteId }`) não gravam nada.
- **O login da assinatura** (`lib/engine/login-web.js`): `POST /api/claude/login-web/start` com
  `{ profileId }` devolve `{ ok: true, loginId, url }` (o endereço da página de autorização da
  Anthropic) ou `{ ok: false, code, motivo, perfilAberto? }` (`sem-login` para perfil que não é de
  assinatura, `login-em-curso` com o perfil do login aberto, `sem-link`).
  `POST /api/claude/login-web/code` com `{ loginId, code }` responde `{ ok: true }` ou `{ ok: false,
  code, motivo }` (`expirou`, `codigo-invalido`, `sem-resposta`, `recusado`); depois do código o
  motor encerra o login de qualquer jeito. `POST /api/claude/login-web/cancel` com `{ loginId }` ou
  `{ profileId }` responde `{ ok: true }`. Um login por vez no motor.
- **A credencial do Jira**: `POST /api/jira/credential` com `{ siteId, email, token }` responde
  `{ ok: true }` ou `{ ok: false, error: "dados incompletos" }`. O motor guarda a credencial fora
  do `config.json` (`lib/jira/credentials.js`) e nunca a devolve: o snapshot leva só
  `hasCredential`.

Regras que valem para quem mexer nela:

- **Segredo digitado não fica na tela** (decisão 3 do desenho; a antimeta "segredo que volta em
  resposta da API ou aparece na tela depois de gravado"). São dois: o token de API do Atlassian
  (`CredencialDoJira.tsx`) e o código do login da assinatura (`LoginWeb.tsx`). Os dois:
  - ficam em campo mascarado não controlado pelo React: o valor não entra em estado nenhum, nem
    no store, nem na união `Acao`. O código do login é `type="password"`. O token do Jira não é
    senha e não pode ir para o gerenciador de senhas: e-mail mais campo de senha é a forma de um
    login, e o navegador oferece guardar o campo de senha mesmo com `autocomplete="off"`. Por isso
    ele é `type="text"` com o valor em bolinhas pelo CSS (`-webkit-text-security: disc`, a classe
    `mascarado`), `autocomplete="off"` no campo e no formulário, nome e id que não parecem login
    (`farol-jira-token-de-api`, `farol-jira-conta-atlassian`) e as marcas que 1Password, LastPass
    e Bitwarden respeitam (`data-1p-ignore`, `data-lpignore`, `data-bwignore`);
  - são lidos só na hora do envio, vão só no corpo do POST e são apagados do campo antes de o
    pedido sair, dê certo ou não (na falha, a pessoa cola de novo; o e-mail do Jira, que não é
    segredo, fica);
  - a resposta é lida só no `ok` e na frase da recusa (`lerGravacaoDaCredencial`,
    `lerFimDoLogin`): mesmo que o motor ecoasse o valor, ele não passaria da borda. O teste da
    tela manda um motor de mentira que ecoa o token e confere que ele não está no DOM nem no
    store.
  São os dois únicos campos mascarados da tela, e nenhum outro rótulo pede segredo.
- **Perfil por chave de API não tem Refazer login.** O login é só do perfil de assinatura
  (`kind: "dir"`); no de chave a tela diz, no lugar do botão, que a chave entra e muda só pela
  API do motor. A tela não tem campo para a chave, não cria nem remove perfil.
- **Subir na ordem é o único corpo com `claudeProfiles`** (`src/sistema/perfis.ts`). A ordem de
  uso é a do motor (`candidatosDaConta`): o padrão primeiro, depois a lista; a sessão usa o
  primeiro que não está no limite do plano. Subir troca o perfil com o de cima, e o primeiro vira
  o padrão: o corpo leva `claudeProfileId` e a lista na ordem nova, com só `id`, `label`, `kind`
  e, no de chave, `baseUrl`; nunca a chave, a pasta, `temChave` nem campo de teto
  (`sistema/perfis.test.ts` confere a saída de `corpoDeSubir`, e `sistema/acoes.test.ts`, o corpo
  que essa saída vira em `pedidoDa`; só esse arquivo pode montar
  `claudeProfiles`). O motor repõe a pasta e a chave guardadas. Com algum perfil descartado na
  borda (cara de segredo, forma torta ou tipo desconhecido) a tela não monta o corpo, porque
  mandar a lista sem ele o tiraria do motor, e diz por quê. A resposta é conferida pela ordem de
  uso gravada.
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
  (`mascararSegredos`). Passam por essa máscara, além das mensagens do motor de antes: os
  padrões do time (que avisam quando houve troca, porque salvar grava o texto como está no
  campo), o motivo das recusas do login e a frase da recusa da credencial.
- **Os tipos lidos não têm campo de segredo.** Os de `src/contratos/sistema.ts` são montados
  campo a campo: do segredo a tela só conhece a presença (`tokenOk`, `temChave`,
  `hasCredential`). Do perfil do Claude a chave (`apiKey`) e a pasta (`dir`) não são lidas nem
  guardadas. O teste `sistema.test.ts` passa um snapshot com token, chave, senha e credencial e
  confere que nada disso chega ao store.
- **O que ainda entra como veio.** Dois valores do store não são montados campo a campo, por
  desenho dos lotes anteriores: os itens de `decisions.resolved` (de onde saem os últimos cards
  lidos do Jira, pelo `card`, a `key` e o `resolvedAt`) e `config.people` cru.
- **Um salvar, uma coisa, só o que a pessoa alterou.** O corpo leva a diferença entre o
  rascunho e o valor que a pessoa viu ao começar a editar, não a diferença contra o motor de
  agora: a conta manda os campos que ela alterou (`camposAlterados`); a automação e o ritmo, as
  chaves que ela alterou; os padrões, o texto; uma regra, a operação dela.
- **Valor que muda no motor com a edição aberta** (`useRascunho`, `src/sistema/rascunho.ts`).
  Sem edição, o formulário acompanha o motor. Com edição, o rascunho é refeito sobre o valor
  novo: o campo que a pessoa não tocou passa a mostrar o que o motor tem, e não vai no corpo. O
  campo que os dois mexeram aparece no aviso com os dois valores. Cada formulário tem o descartar.
- **O `ok` não é o desfecho.** A automação e o ritmo conferem a `config` da resposta contra o
  enviado, chave a chave (`diferencasDaAutomacao`, `diferencasDoRitmo`); a ordem dos perfis, pela
  ordem de uso gravada. A rota da conta não devolve a conta gravada: a tela diz o que pediu, o
  que o motor disse ter ignorado, e manda conferir no estado que chega.
- **Só salva com o estado em dia.** `impedimentoDeSalvar`: conectado e com o primeiro `state`
  da conexão atual (`estadoEmDia`). Vale para todo salvar, para Subir na ordem, para as regras e
  para Refazer login e Trocar credencial.
- **Ampliar a publicação pergunta antes.** `ampliacoesDaConta` lista, com o efeito exato, o que
  amplia o que o motor faz ou publica sem clique: ligar a revisão automática, trocar o esperar
  que veio do motor por publicar e acrescentar organização. A regra que revisa sozinho pergunta,
  e tirar uma regra também (o alvo volta à política da conta, que pode ser mais ampla). A regra
  que põe no clique, a automação, o ritmo e os padrões com texto não perguntam: nada disso amplia
  o que é publicado. Duas perguntas não são de publicação: salvar os padrões com o campo vazio,
  que apaga todos, e Subir na ordem quando o perfil que vai para o topo é de chave de API, porque
  as revisões passam a gastar na API paga. Sair e Revogar perguntam sempre, e Cancelar o login
  aberto (o de outro login que o motor tem aberto) diz de qual perfil é e pergunta. A pergunta abre no lugar do
  botão (`AcaoComPergunta.tsx`), com o foco no "Voltar sem enviar".
- **O que foi digitado não se perde na falha.** Os formulários com rascunho mantêm a edição e
  dizem "Erro ao salvar" no pé; a regra nova só sai do formulário quando o motor aceita; os
  segredos são a exceção, pelo motivo acima.
- **O revisor nunca espera** (desenho de 17/11/2026). Os seletores da política oferecem só
  publicar (`OPCOES_DA_TELA`, `src/sistema/politica.ts`), e `camposAlterados` nunca manda
  `wait`. Uma conta que chega com `wait` mostra o valor numa opção desabilitada.
- **Regras fixas são texto.** "Check que já falha na base não segura" e "Merge-back sem commit
  próprio sai limpo" aparecem na conta como texto informativo, não como caixa de marcar.
- **Valores permitidos.** Os modelos vêm do catálogo do motor (`modelos.claude`). Os níveis de
  `effort`, a faixa do paralelismo, a faixa do intervalo, a forma do nome de organização e autor
  das regras e os tetos dos padrões são cópia conferida por teste contra o motor
  (`automacao.test.ts`, `ritmo.test.ts`, `regras.test.ts`, `padroes.test.ts`).
- **Edição por salvar.** A tela avisa no topo, o item do menu diz "alteração por salvar" no
  resumo, e a página segura o fechar e o recarregar (`beforeunload`). Trocar de assunto não a
  perde; trocar de aba do Farol a descarta.
- **Carregamentos por processo.** Salvar mostra "Salvando…"; Sair, "Saindo…"; Revogar,
  "Revogando…"; Subir na ordem, "Subindo…"; Refazer login, "Abrindo o login…" e "Enviando o
  código…"; Trocar credencial, "Enviando…"; testar perfil e site, "Testando…".
- **Acessibilidade.** Menu em `nav` com `aria-current="page"` no assunto aberto; cada assunto é
  uma região com o título `h2`, e os blocos de dentro, `h3`. O perfil do Claude abre num botão
  real com `aria-expanded`. O efeito de cada seletor e de cada checkbox está ligado ao campo por
  `aria-describedby`. Toda resposta de teste, login e credencial sai numa região viva.
- **Sair.** Revogar a sessão `atual` avisa que este navegador volta ao pareamento. Depois do
  aceite vale a resposta do motor, não a lista: com `eraAtual: true` (ou o Sair) a tela chama
  `app.esquecerSessao('revogada')`, mesmo que a lista dissesse que a sessão era outra; sem ela,
  pede a lista de novo (`aoAceitar` de `useAcoes`).
- **Só leitura.** Criar e remover perfil do Claude e a chave de API; o site do Jira (endereço,
  organizações e projetos); o login e o token do GitHub. As cinco chaves de rede não aparecem.

### Lacunas do contrato

- **O endereço do site do Jira troca sem pedir a credencial.** A credencial fica guardada por
  `id` de site, e `POST /api/settings` com `jiraSites` aceita mudar o `baseUrl` de um site que
  já tem credencial: a próxima leitura manda o e-mail e o token do Atlassian para o endereço
  novo. O perfil do Claude tem essa trava (`recusaDoEndereco`); o Jira não. A correção é no
  motor, e sem ela editar o site por esta tela não é seguro: o "Editar site" do desenho não foi
  construído, e site novo entra pela API ou pelo arquivo.
- **A chave de API e o perfil do Claude não têm tela.** Criar, trocar ou remover perfil e a chave
  de API: `POST /api/settings` com `claudeProfiles` (a lista inteira; o de chave leva `apiKey`) e
  `claudeProfileId`, por chamada direta à API (`docs/CONFIGURATION.md`). Tirar a credencial do
  Jira: `POST /api/jira/credential/remove` com `{ siteId }`, também só pela API.
- **"Presente" não é "válido".** `tokenOk` e `doctor.ghAuth` dizem que o `gh` tem token, não
  que o GitHub o aceita. A chave de API só tem `temChave`. Validade de verdade só há para o login
  da assinatura (Testar e a validade lida pelo motor) e para a credencial do Jira (Testar a
  conexão).
- **Qual perfil está em uso agora não vem no snapshot.** A troca no limite do plano é do motor
  (`escolherPerfil`) e não sai para a tela: ela mostra a ordem de uso e o padrão. O que sai é o
  perfil no limite (`claudePerfis.limites`, `limitesParaTela`): a linha ganha o chip "No limite
  do plano" e, aberta, diz até quando; quando a fila parou pelo uso lido antes da sessão
  (`origem: "uso"`), diz também a janela que estava em 100%.
- **Os últimos cards lidos são só os das 30 decisões do snapshot.** O motor não guarda leitura
  de card por site; a tela liga o card ao site pela organização do PR e pela chave do projeto.
- **A rota da conta não devolve a conta gravada.** `POST /api/accounts/edit` responde só
  `ok` e `ignorados`: a conferência do que ficou depende do snapshot seguinte.
- **As organizações vão como lista inteira, sem versão.** A mudança de outra aba que ainda não
  chegou a esta é sobrescrita. A correção é no motor: operação de acrescentar e de tirar
  organização.
- **A lista de sessões não está no snapshot nem tem evento.** Sessão criada ou revogada em
  outro navegador só aparece ao atualizar a lista.
- **O limite total de sessões** (`globalParallelReviews`) e `debugSpawns` ficaram fora da tela.
  O limite total aparece como nota quando está ligado.
- **Trocar de aba do Farol descarta a edição sem perguntar.** A página só segura o fechar e o
  recarregar.
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
  outra. Para derrubar a sessão: Sistema, Quem está conectado, a partir de um navegador pareado,
  ou todas de uma vez com `node tools/farol-parear.js --revogar-todas`;
- se o motor já recusava o token (401) quando o Sair o consultou, a tela vai ao pareamento
  pelo 401, com o aviso dele, e não diz que revogou;
- se outra aba já gravou outro token (pareou de novo) enquanto o Sair corria, esta aba não
  vai ao pareamento com um token válido guardado: relê o armazenamento e segue pareada com o
  novo, quer o aviso do navegador (`storage`) tenha chegado antes, quer só o 401;
- um 401 apaga só o token que foi recusado, nunca o que outra aba acabou de guardar.

### Sessão pelo portão

Atrás de um portão de login na mesma origem (a hospedagem compartilhada de
[`docs/HOSPEDAGEM.md`](../docs/HOSPEDAGEM.md#hospedagem-compartilhada-sem-docker)), quem está
logado no portão recebe dele uma sessão do motor, injetada como `Authorization: Bearer` em todo
pedido que o portão repassa. O navegador não vê esse token, e o front não guarda nada
(`src/estado/app.ts`):

- **Entrar.** Com token guardado, o de sempre. Sem token, o front pergunta
  `GET /api/auth/status` (com o cookie da própria origem, para o portão reconhecer o login) e
  só entra sem token quando o motor responde `exigida: true` e `autenticado: true` àquele
  pedido. Um motor sem portão responde `autenticado: false` a um pedido sem token, e a tela é o
  pareamento. Resposta torta, falha de rede ou `exigida: false` também levam ao pareamento:
  o front nunca se considera autenticado sem o motor dizer isso.
- **Nesse modo** os pedidos não levam `Authorization` (quem manda é o portão) e levam o cookie
  da mesma origem (`credentials: 'same-origin'`, que não vai a outra origem); fora dele,
  `credentials: 'omit'`, como sempre. A casca mostra "Sessão do login da frente".
- **401.** Não há token a apagar e o pareamento não adianta (o portão o bloqueia): a página
  volta à raiz (`location.assign('/')`), onde o portão mostra o login. Uma vez por minuto
  (`JANELA_DA_RECARGA_MS`, a hora fica no `sessionStorage`): o segundo 401 dentro desse tempo
  mostra uma tela com a mensagem e o botão Entrar de novo, em vez do laço de recargas.
- **Sair.** `POST /auth/logout` (rota do portão, mesma origem, com `x-farol: 1`, sem o motor no
  caminho), que revoga a sessão do motor e apaga o cookie, e depois a raiz. Revogar a sessão
  `atual` em Sistema, Quem está conectado (o Sair), faz o mesmo; a lista continua listando.
- **Outra aba** que pareia passa esta aba para o token guardado; outra aba que apaga o token não
  muda nada aqui.

O que o portão precisa fazer está em
[`docs/HOSPEDAGEM.md`](../docs/HOSPEDAGEM.md#hospedagem-compartilhada-sem-docker).
