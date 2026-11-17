# Farol BIUD

Revisor autônomo de pull requests da BIUD. Monitora os PRs pedidos a uma conta revisora do
GitHub, revisa cada um numa sessão headless do Claude Code (com o card do Jira lido e o diff em
disco), passa o resultado pelos gates e posta aprovação, pedido de mudanças ou comentário. O
que a política da conta não decide sozinha fica na mesa ("Precisa de você"), esperando uma
pessoa.

São duas partes, no mesmo repositório:

- **O motor** (a raiz): um processo Node, uma instância, uma conta revisora, só Linux, sem
  dependência npm de runtime. Serve só a API (HTTP e SSE) e guarda tudo em `~/.farol`.
- **O front** ([`web/`](web/README.md)): a tela, em Next.js, pacote à parte. Roda em outro
  endereço e fala com o motor só pela API. Cinco telas: Radar, Histórico, Time, Consumo e
  Sistema.

## Subir o motor

No usuário que roda o motor: Linux, Node `>=24.22.1 <25` (o `.nvmrc` fixa 24.22.1), `gh`
logado na conta revisora (`gh auth login`) e `claude` (Claude Code) no PATH. Usuário comum,
nunca root: o Claude Code recusa o modo headless com uid 0.

```sh
node server.js
```

O motor escuta em `http://127.0.0.1:47170`. Fora de `/api/` ele responde 404: não há página.

Para rodar em container há um [`Dockerfile`](Dockerfile) na raiz, com `git`, `gh` e Claude Code
(os dois últimos em versão fixada): `docker build -t farol-biuder-motor:dev .`. A imagem só sobe com um
`config.json` de instância hospedada no volume; o passo a passo está em
[`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md).

**Uma instância nova age sozinha.** Com `~/.farol` vazio e o `gh` logado, a conta detectada
nasce revisando, aprovando e reprovando sem perguntar. Para subir sem agir, grave em
`~/.farol/config.json` antes do primeiro boot:

```json
{ "conta": { "autoReview": false, "onClean": "wait", "onCaveats": "wait", "onReject": "wait" } }
```

Na primeira checagem, os PRs que já pediam revisão ficam fora da fila: o motor só revisa o que
chegar depois.

## Rodar o front contra o motor

1. Libere a origem do front no `config.json` do motor e reinicie:

   ```json
   { "origensPermitidas": ["http://localhost:3100"] }
   ```

   Com `origensPermitidas` preenchida o motor passa a exigir autenticação em toda a API.

2. Suba o front (qualquer sistema com Node 24):

   ```sh
   cd web
   npm ci
   cp .env.example .env.local
   npm run dev
   ```

3. **Parear.** Abra `http://localhost:3100`. A tela pede um código: gere-o no servidor do
   motor, com o mesmo `FAROL_HOME` dele, e digite. O código vale dez minutos e uma vez só.

   ```sh
   node tools/farol-parear.js
   ```

O que a tela Sistema edita: as organizações e a política da conta, e quatro chaves de
automação. Perfil do Claude (chave de API ou login da assinatura), sites e credencial do Jira e
as outras preferências entram pela API ou pelo arquivo; as chaves de rede (`bind`, `port`,
`hostPublico`, `origensPermitidas`, `localAuth`), só pelo arquivo. O passo a passo de cada uma
está em [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

## Testar

```sh
npm run check && npm run lint && npm test     # o motor, em Linux
cd web && npm ci && npm audit && npm run typecheck && npm run lint && npm test && npm run build
```

O CI roda os dois. O motor recusa plataforma que não é Linux: em outra máquina, rode o gate
dele num Linux (WSL, por exemplo). Para subir um motor sem tocar nos dados reais:
`FAROL_HOME=/tmp/farol-teste node server.js`; uma instância com `FAROL_HOME` fora de `~/.farol`
não escreve no GitHub.

## Mapa do código

| Caminho | O que é |
|---|---|
| `server.js` | A entrada do motor: `node server.js` ou `npm run server`. O próprio `server.js` confere plataforma e Node antes de tudo |
| `lib/engine/` | O ciclo de revisão: fila, sessão, gates, postagem, re-revisão, consumo |
| `lib/http-server.js` | A API (`/api`) e o SSE |
| `lib/local-auth/` | Autenticação e pareamento da API |
| `lib/settings.js` | A tabela das preferências e a leitura do `config.json` |
| `lib/jira/` | Leitura do card do Jira |
| `lib/review-source/` | Aquisição e cache do código do PR |
| `lib/technical-review/` | A avaliação técnica do PR revisado |
| `workspace-template/` | O protocolo que a sessão de IA lê |
| `web/` | O front, pacote à parte |
| `test/` | A suíte do motor: `npm test` |
| `tools/quality/` | O gate de qualidade: `npm run lint` |
| `tools/check-syntax.js` | O gate de sintaxe: `npm run check` |
| `tools/farol-parear.js` | Gera o código de pareamento da API |
| `Dockerfile`, `tools/provar-imagem.sh` | A imagem do container do motor e a prova dela com o container de pé |

## Guias

| Guia | Assunto |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Guia do mantenedor: mapa por assunto, invariantes, a API, como testar |
| [`web/README.md`](web/README.md) | O front: como rodar, convenções, o contrato de cada tela |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Conta e política, preferências, perfis do Claude, Jira, hospedagem |
| [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md) | O motor em container: a imagem, o volume, a primeira subida, o que o orquestrador garante |
| [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md) | As regras de postagem, uma a uma |
| [`docs/CONSUMO-REVIEWS.md`](docs/CONSUMO-REVIEWS.md) | O que o consumo mede e `GET /api/usage` |
| [`docs/QUALITY.md`](docs/QUALITY.md) | O gate e o ratchet de qualidade |
| [`docs/RUNTIME.md`](docs/RUNTIME.md) | O contrato de versão do Node |
| [`docs/SOURCE-STORAGE.md`](docs/SOURCE-STORAGE.md) | O cache das fontes de revisão |
| [`docs/CONTEXTO-FRONTEND.md`](docs/CONTEXTO-FRONTEND.md) | O mapa sintático do código do PR e os modos de seleção |
| [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md), [`.github/SECURITY.md`](.github/SECURITY.md) | Como contribuir e como reportar falha de segurança |
| [`CHANGELOG.md`](CHANGELOG.md) | Histórico |

`docs/superpowers/` guarda desenhos e planos: é registro de decisão, não descreve o código de
hoje. O desenho vigente é
[`docs/superpowers/specs/2026-11-12-farol-biuder-enxuto-design.md`](docs/superpowers/specs/2026-11-12-farol-biuder-enxuto-design.md).
