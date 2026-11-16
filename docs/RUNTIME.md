# Contrato de runtime

Desenvolvimento, testes e execução do motor suportam somente **Node 24 LTS,
`>=24.22.1 <25`**, em Linux. O piso concreto é 24.22.1; não se declara suporte desde 24.0
nem para futuras majors. O `package.json` (`engines.node`) é a fonte do contrato; o
`package-lock.json`, o `.nvmrc` e a CI (`ubuntu-latest`, Node 24.22.1, nos dois jobs)
seguem esse piso.

Quem confere é `lib/node-runtime.js`: recusa plataforma que não é Linux antes de olhar a
versão, e depois recusa Node fora do intervalo, com a instrução de atualização na
mensagem. O motor não instala nem troca Node sozinho.

## Selecionar o runtime

Use `nvm install 24.22.1` e `nvm use` (ou o equivalente no seu gerenciador). Confira com
`node --version` e `node lib/node-runtime.js`, que imprime se o contrato foi atendido.
Depois rode `npm run check`, `npm run lint` e `npm test`.

A conferência roda sozinha em dois lugares: no começo do `server.js` (vale para
`node server.js` e `npm run server`) e nos scripts `pre*` do `package.json`
(`preserver`, `precheck`, `prelint` e `pretest`).
