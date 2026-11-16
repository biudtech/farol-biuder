# Farol BIUD

Revisor autônomo de pull requests da BIUD.

O Farol é um motor: um processo Node que monitora os PRs pedidos a uma conta revisora do GitHub,
revisa cada um numa sessão headless do Claude Code (com o card do Jira lido e o diff em disco), passa
o resultado pelos gates e posta aprovação, pedido de mudanças ou comentário. O que a política da
conta não decide sozinha fica na mesa, esperando uma pessoa.

Uma instância, uma conta revisora, só Linux, sem dependência npm de runtime.

## Como rodar

Requisitos, no usuário que roda o motor:

- Linux e Node `>=24.22.1 <25` (o `.nvmrc` fixa 24.22.1);
- `gh` logado na conta revisora (`gh auth login`);
- `claude` (Claude Code) no PATH;
- usuário comum, nunca root: o Claude Code recusa o modo headless com uid 0.

```sh
node server.js
```

O motor escuta em `http://127.0.0.1:47170`, serve a tela nesse endereço e guarda tudo em `~/.farol`.

**Uma instância nova age sozinha.** Com `~/.farol` vazio e o `gh` logado, a conta detectada nasce
revisando, aprovando e reprovando sem perguntar. Para subir sem agir, grave em
`~/.farol/config.json` antes do primeiro boot:

```json
{ "conta": { "autoReview": false, "onClean": "wait", "onCaveats": "wait", "onReject": "wait" } }
```

Na primeira checagem, os PRs que já pediam revisão ficam fora da fila: o motor só revisa o que chegar
depois.

## Configuração mínima

Tudo mora em `~/.farol/config.json`; a tela (Sistema) edita a maior parte. O detalhe está em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

| O quê | Onde | Leia |
|---|---|---|
| A conta revisora: login, organizações monitoradas (`owners`) e a política (`autoReview`, `onClean`, `onCaveats`, `onReject`) | `conta`, pela tela ou pelo arquivo | [A conta revisora e a política](docs/CONFIGURATION.md#a-conta-revisora-e-a-política) |
| O perfil do Claude: por assinatura (login feito pela própria tela) ou por chave de API (a chave entra e não sai mais do motor) | `claudeProfiles`, pela tela | [Perfis do Claude](docs/CONFIGURATION.md#perfis-do-claude) |
| O Jira de cada organização, para a revisão ler o card | `jiraSites`, pela tela | [Jira](docs/CONFIGURATION.md#jira) |
| Motor hospedado: `hostPublico` (o nome com que o proxy chega ao motor) e `origensPermitidas` (de onde o front chama a API). Qualquer uma das duas já exige autenticação | só pelo arquivo | [Para hospedar](docs/CONFIGURATION.md#para-hospedar) |
| Autenticação da API sem as duas chaves acima: `"localAuth": "exigir"`, obrigatório em qualquer instância que não seja só da própria máquina | só pelo arquivo | [Para hospedar](docs/CONFIGURATION.md#para-hospedar) |

Com a autenticação exigida, a tela pede um código de pareamento. Gere um no servidor com
`node tools/farol-parear.js`.

## Como testar

```sh
npm run check && npm run lint && npm test
```

É o gate do repositório e o mesmo que o CI roda (check obrigatório `ci`). A suíte usa o runner nativo
do Node e sobe o motor contra pastas temporárias. Fora de Linux, rode num container:

```sh
docker run --rm -v "$PWD:/src:ro" node:24.22.1-bookworm bash -c \
  'cp -r /src /work && cd /work && npm run check && npm run lint && npm test'
```

Para olhar a tela sem tocar nos dados reais: `FAROL_HOME=/tmp/farol-teste node server.js`. Uma
instância com `FAROL_HOME` fora de `~/.farol` não escreve no GitHub, salvo com
`"instanciaIsoladaPosta": true` no `config.json` dela ou com a variável
`FAROL_UPDATE_MANAGER=external`.

## Mapa do código

| Caminho | O que é |
|---|---|
| `server.js` | A entrada do motor: `node server.js`, ou `npm run server`, que antes confere Node e plataforma |
| `lib/engine/` | O ciclo de revisão: fila, sessão, gates, postagem, re-revisão, consumo |
| `lib/http-server.js` | A API (`/api`) e o SSE |
| `lib/local-auth/` | Autenticação e pareamento da API |
| `lib/settings.js` | A tabela das preferências e a leitura do `config.json` |
| `lib/jira/` | Leitura do card do Jira |
| `lib/review-source/` | Aquisição e cache do código do PR |
| `lib/technical-review/` | A avaliação técnica do PR revisado |
| `workspace-template/` | O protocolo que a sessão de IA lê |
| `ui/` | A tela, servida pelo motor |
| `test/` | A suíte: `npm test` |
| `tools/quality/` | O gate de qualidade: `npm run lint` |
| `tools/check-syntax.js` | O gate de sintaxe: `npm run check` |
| `tools/farol-parear.js` | Gera o código de pareamento da API |

O mapa por assunto, os invariantes e as regras de quem mexe no código estão no
[`CLAUDE.md`](CLAUDE.md).

## Guias

- [`CLAUDE.md`](CLAUDE.md): guia do mantenedor.
- [`docs/REVIEW-GATES.md`](docs/REVIEW-GATES.md): as regras de postagem, uma a uma.
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md): configuração e hospedagem.
- [`docs/QUALITY.md`](docs/QUALITY.md): o gate e o ratchet de qualidade.
- [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md): como contribuir.
- [`.github/SECURITY.md`](.github/SECURITY.md): como reportar falha de segurança.
- [`CHANGELOG.md`](CHANGELOG.md): histórico.
