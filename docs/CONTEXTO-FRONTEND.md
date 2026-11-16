# Contexto de frontend e modos de seleção

O mapa sintático do código do PR (`lib/review-context/`) e o que ele prova ou não prova. A
chave é `reviewContextMode`, só por arquivo (`off`, `observe` ou `assist`; o padrão é `off`),
lida em `lib/engine/analysis-source.js`. O mapa nunca concede prova de leitura.

## O que a bateria fixa

A bateria é `test/review-context-frontend.test.js`, só com fontes sintéticas. Relação
sintática comprova que a declaração está naquele arquivo; não comprova execução, correção de
props ou contrato. Resolver um caminho relativo explícito existente é evidência de dependência
de arquivo. Aliases, resolução sem extensão e chamadas CommonJS são candidatos que exigem
confirmação. Dependências dinâmicas e falhas do parser permanecem não resolvidas
explicitamente.

| Caso | Evidência necessária | Limite esperado |
|---|---|---|
| JS/JSX, consumidor de componente e mudança de props | Import do componente e consumidor fora do patch recuperado | Uso sintático não prova compatibilidade das props |
| TS/TSX, hooks e contrato compartilhado | Caminhos hook → contrato e componente → hook, inclusive no M | Sem inferência de tipos, chamadas ou fluxo de dados |
| Imports somente de tipos | Relação preservada com natureza `type` | Não confundir com dependência de runtime |
| Import sem destino resolvido, inclusive `./api.js` em fonte TS e alias desconhecido | Mapa incompleto, consumidor candidato e herança reaberta em `assist` | Não resolve substituição de extensão do TypeScript nem distingue pacote externo de alias não configurado |
| Alias configurado | Configuração e destino existente registrados | Candidato, sem executar config ou resolver plugins |
| Barrels, reexports e `export *` | Arestas consumidor → barrel → origem | `export *` não prova qual binding foi usado |
| CommonJS misturado com ESM | `require` literal como candidato; import estático como sintaxe | Binding `require` pode estar sombreado |
| Rename e delete | Relação antiga recupera consumidor mesmo sem destino no H | M é a comparação; B não o substitui |
| Alteração de resolução | Arquivos inalterados permanecem candidatos à investigação | Mudança de config não autoriza herdar validade automaticamente |
| Import dinâmico | Limitação explícita e caminho candidato quando literal | Expressão calculada fica não resolvida |
| Sintaxe inválida/não suportada | Arquivo permanece no mapa, fallback identificado e investigação ampliada | Nunca transformar falha em ausência de impacto |
| Conteúdo com efeitos de topo | Extração funciona; marcador externo não é criado | Somente parsing de texto, sem import, eval, execução ou resolução do projeto |

## Modos

`off` é o padrão. Os três modos mantêm a preparação comum das fontes (`prepareSources`). O
modo não promove disponibilidade em cache a evidência de análise.

| Trabalho | off | observe | assist |
|---|---|---|---|
| Aquisição comum e cache de fontes | Sim | Sim | Sim |
| Construção do mapa sintático | Não (só com `reviewNavigationFacts` ligado) | Sim | Sim |
| Seleção limitada de trechos | Não | Sim, só medição | Sim |
| Injeção dos trechos novos no prompt | Não | Não | Sim |
| Alterar herança pela seleção | Não | Não | Sim, conservadoramente (`inheritanceForContext`) |
| Falha do mapa/seleção | Não se aplica | WARN no log; prompt comum preservado | WARN no log, sem bloco parcial e sem herdar validade pelo mapa |

## Limites de memória

O teto de 4 MiB (`CACHE_LIMIT_BYTES`, `lib/review-context/parser.js`) contabiliza a
serialização das análises sintáticas retidas no cache do processo principal. Não inclui
objetos JS, AST transitória, heap do worker, runtime ou cache de fontes: não representa a RAM
total. Não há índice sintático persistido; após reinício a análise é refeita.

## O parser

O parser é o `@babel/parser` 7.28.5, usado somente para gerar AST, sem transpilação, bundler
ou execução de fontes. O motor carrega o artefato de
`assets/third-party/babel-parser/dist/parser.cjs` (512.279 bytes), com a licença MIT e o
`manifest.json` de SHA-256 ao lado; `lib/parser-runtime.js` confere versão, tamanho e hash a
cada carga e não tem caminho alternativo por `node_modules`.

`node tools/medir-parser-frontend.js` mede o parser sobre 120 arquivos TSX sintéticos
(análise fria, outra análise com os mesmos blobs e outra autorização) e imprime um JSON com
tempos, memória do processo e as limitações da medição. Não chama modelo.

## O que o grafo registra

O grafo registra declaração de import/reexport e caminho candidato, sem inferir
compatibilidade de props, contrato de hooks, binding usado por `export *` ou chamadas.
Aliases suportam o JSON de `tsconfig.json`/`jsconfig.json` na raiz; `extends` não é expandido
e vira limitação declarada. CommonJS sombreado e import calculado nunca viram prova de
ausência. Falha sintática mantém o arquivo, com candidatos textuais marcados.

Qualquer dependência não resolvida torna o mapa incompleto e amplia os candidatos de código
sob os limites existentes. Em `assist`, a herança de análise é reaberta; `observe` mantém o
comportamento comum. Isso inclui imports relativos com extensão de saída (`./api.js` cujo
fonte é `api.ts`), aliases desconhecidos e pacotes externos: sem resolução demonstrada, o mapa
não distingue essas situações com segurança.
