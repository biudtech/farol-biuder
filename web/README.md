# Front do Farol BIUD

A tela do Farol, em Next.js (App Router) e TypeScript estrito. O navegador fala direto com a
API do motor: `fetch` com `Authorization: Bearer`, e `x-farol: 1` em todo POST. Aqui não há
rota de API, cookie nem segredo.

Este pacote é independente do motor: tem `package.json`, `package-lock.json` e gate próprios.
Na Vercel, o diretório raiz do projeto é `web/`.

Hoje ele entrega a fundação: transporte, contratos, pareamento e a casca das cinco abas
(Radar, Histórico, Time, Consumo e Sistema), cada uma ainda em construção.

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
| `NEXT_PUBLIC_FAROL_API` | A origem do motor, sem caminho: `http://127.0.0.1:47170` em desenvolvimento, `https://...` hospedado. É lida no build e fica pública no bundle. Entra também no `connect-src` da CSP |

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
| `src/app/` | As rotas (App Router). Uma pasta por aba, o `layout.tsx` da raiz e o `globals.css` com as cores dos dois temas |
| `src/componentes/` | Componentes de React, cada um com o CSS Module ao lado |
| `src/contratos/` | Os tipos do que o motor manda e os leitores que conferem a forma na borda |
| `src/transporte/` | O cliente único do motor: `get`, `post`, o fluxo de eventos, o token e o endereço. Sem React |
| `src/estado/` | O store e a sessão que liga o cliente ao store. A instância e o gancho `useApp` ficam em `instancia.ts` |
| `src/navegacao/` | A lista das abas |
| `src/tema/` | A troca de tema e o teste de contraste das cores |
| `src/seguranca/` | A regra da Content-Security-Policy |
| `src/proxy.ts` | Gera o nonce e o cabeçalho da CSP a cada pedido |

## Convenções para os próximos lotes

**Onde entra tela.** Cada aba é uma pasta em `src/app/` com um `page.tsx` fino, que só escolhe
o componente. A tela mesma é um componente em `src/componentes/`, com `'use client'`, porque
os dados vêm do navegador. A lista das abas é `src/navegacao/abas.ts`.

**Onde entra tipo.** Todo dado do motor tem tipo e leitor em `src/contratos/`, e é lido do que
o motor emite, nunca inventado:

- chave do snapshot: em `src/contratos/snapshot.ts`, troque o `unknown` da chave em
  `FormasDoSnapshot` pelo tipo e o `qualquer` dela em `VALIDADORES` pelo validador. As chaves
  de topo são lista fechada no motor (`test/snapshot-chaves.test.js`, na raiz), e
  `snapshot.test.ts` reprova se as duas listas divergirem;
- resposta de rota: um leitor `(bruto: unknown) => Tipo | null`, como os de
  `src/contratos/auth.ts`.

**Como chamar o motor.** Sempre pelo cliente (`app.cliente`, de `src/estado/instancia.ts`):
`get(caminho, leitor)` e `post(caminho, corpo, leitor)`. Os dois devolvem um `Resultado` e
nunca lançam, e o corpo só chega depois de passar pelo leitor. Não use `fetch` direto numa
tela: é o cliente que manda o Bearer e o `x-farol`, e que trata o 401 (apaga o token e volta ao
pareamento).

**Como ler o estado.** `useApp((e) => e.snapshot?.chave)`. O seletor devolve um primitivo ou
uma referência que já está no store, nunca um objeto montado na hora. A definição do dado é do
motor: a tela fatia e formata, não recalcula. Chave que chega com forma errada mantém o valor
anterior e deixa um aviso no console; a tela precisa saber desenhar sem a chave.

**Eventos do motor.** O fluxo entrega hoje só `state` e `state-patch` ao store. Os outros
(`toast`, `activity`, `needs-decision` e afins) passam por `aoEvento`, em `src/estado/app.ts`,
e ainda não têm quem os leia: é ali que entram.

**Como testar.** O teste mora ao lado do arquivo, com nome `*.test.ts` ou `*.test.tsx`. Lógica
(transporte, contrato, estado) testa sem React, com `fetch` e relógio de mentira; escreva o
teste antes. Componente usa Testing Library e começa com `// @vitest-environment jsdom`. Cor
nova que vira texto entra em `src/tema/contraste.test.ts`.

**Estilo.** CSS Modules e as variáveis de `globals.css`. Sem atributo `style` e sem biblioteca
de componentes: a CSP de produção não aceita estilo em linha. Para texto sobre fundo de estado
use as variáveis terminadas em `-texto`, e `--foco` para o anel de foco.

**API do Next.** A versão fixada traz a própria documentação em `node_modules/next/dist/docs/`.
Consulte-a antes de usar uma API do Next: ela mudou entre versões (o antigo `middleware` aqui é
`proxy`, por exemplo).

**Texto.** Tela e comentários em português, sem travessão. Jargão de IA não se traduz (token,
prompt).

## Segurança

A Content-Security-Policy sai em toda página, montada por `src/seguranca/csp.ts`. Em produção:

- `script-src 'self' 'nonce-...' 'strict-dynamic'` e `style-src 'self' 'nonce-...'`: sem
  `unsafe-inline` e sem `unsafe-eval`. O nonce muda a cada pedido, e por isso toda página é
  desenhada no servidor a cada pedido (nenhuma é estática);
- `connect-src 'self'` mais a origem de `NEXT_PUBLIC_FAROL_API`;
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

Só no `npm run dev` entram `'unsafe-eval'` em `script-src` e `'unsafe-inline'` em `style-src`,
que as ferramentas de desenvolvimento do Next exigem.

`X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options` saem do `next.config.ts`.

O token da sessão fica no `localStorage` da origem do front. "Sair" apaga o token deste
navegador; não revoga a sessão no motor (`node tools/farol-parear.js --revogar-todas` revoga
todas).
