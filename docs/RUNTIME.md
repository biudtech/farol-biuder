# Contrato de runtime

Desenvolvimento, testes e execução externa do motor suportam somente **Node 24
LTS, `>=24.22.1 <25`**. O piso concreto é 24.22.1; não se declara suporte desde
24.0 nem para futuras majors. `package.json` é a fonte do contrato; o lockfile,
`.nvmrc` e a CI (Linux, `ubuntu-latest`, Node 24.22.1) seguem esse piso. O motor
roda só em Linux: `lib/node-runtime.js` recusa outra plataforma antes de conferir
a versão.

## Decisões do piso

O contrato vigente adota a [versão de segurança Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1),
que atualiza os certificados, bloqueia cadeias TLS afetadas e inclui Undici 7.30.1.
O piso anterior 24.16.0 não representa o requisito atual. Isso não atribui uma
causa nem declara corrigidos os crashes locais anteriores.

O piso inicial 24.15.0 foi revisto por evidência upstream: um encerramento nativo
em conexões TCP no Windows foi relatado nessa versão, e um mantenedor confirmou
a correção em 24.16.0 na [issue Node #63620](https://github.com/nodejs/node/issues/63620).
As [notas oficiais de 24.16.0](https://nodejs.org/en/blog/release/v24.16.0)
registram libuv 1.52.1 e a correção de inicialização de estrutura Windows.
O crash local do Farol com `0xC0000409` não possui pilha nativa correlacionada;
semelhança de assinatura não comprova a mesma causa. Logs e medições de 24.15.0
são preservados como histórico. Os gates devem validar o novo piso.

## Selecionar o runtime

No ambiente do projeto, use `nvm install 24.22.1` e `nvm use` (ou o equivalente
no seu gerenciador). Confira `node --version` e `node lib/node-runtime.js`.
Depois execute `npm run check`, `npm run lint` e `npm test`.
Não altere outros projetos ou instâncias em execução para validar o Farol.

`npm run server` e `node server.js` verificam o contrato antes de iniciar o motor,
e `npm run check`, `npm run lint` e `npm test` também (os scripts `pre*` do
`package.json`). Um Node incompatível é recusado com instrução de atualização; o
Farol não instala nem troca Node automaticamente.

## Histórico de Node 22

Classificação: **“Ocorrência sem causa determinada em runtime que deixou de fazer
parte do contrato de suporte.”**

Os resultados, logs e reproduzidor de Node 22.12 permanecem como registro
histórico. Não se declara o crash corrigido, nem que sua causa seja Node, parser,
hardware ou outro componente. A investigação deixou de ser obrigação desta
entrega por decisão de produto; um defeito demonstrado em runtime suportado
continua exigindo correção. Comparações históricas que citam Node 22 não são
evidência de suporte vigente.

Seleção de contexto continua em `off` por padrão. Esta política não promove
ganhos de qualidade ou economia de tokens nem habilita voz.
