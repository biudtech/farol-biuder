# Hospedar o motor em container

Guia de quem sobe o motor do Farol num container: o que a imagem traz, o que tem de estar no
volume, a primeira subida e o que o orquestrador precisa garantir. O front (`web/`) não entra
na imagem: ele vai para a Vercel e fala com o motor pela API.

Cada afirmação daqui foi conferida no código ou na prova local de 16/11/2026 (Docker Desktop,
`linux/amd64`). O que não foi provado está em [O que não foi provado](#o-que-não-foi-provado).
As regras da fronteira (Host, Origin, CORS, autenticação) estão em
[`CONFIGURATION.md`](CONFIGURATION.md#para-hospedar) e não se repetem aqui.

<!-- indice:inicio (gerado; test/guias-navegaveis.test.js reprova se divergir das seções) -->

## Índice

- [A imagem](#a-imagem)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [O volume](#o-volume)
- [O config.json da instância](#o-configjson-da-instância)
- [Primeira subida](#primeira-subida)
- [O que o orquestrador precisa garantir](#o-que-o-orquestrador-precisa-garantir)
- [O fuso do processo](#o-fuso-do-processo)
- [Riscos conhecidos](#riscos-conhecidos)
- [Atualizar a versão](#atualizar-a-versão)
- [Publicar a imagem](#publicar-a-imagem)
- [O que não foi provado](#o-que-não-foi-provado)

<!-- indice:fim -->

## A imagem

O [`Dockerfile`](../Dockerfile) da raiz. As versões são `ARG` no topo dele, e trocar uma é
reconstruir a imagem.

| peça | versão | de onde vem |
|---|---|---|
| base | `node:24.22.1-bookworm-slim`, fixada por digest | o contrato de Node do `package.json` e do `.nvmrc` |
| `git` | 2.39.5 (`1:2.39.5-0+deb12u3`) | o pacote do Debian 12 |
| `gh` | 2.104.0 | o repositório apt oficial do GitHub CLI, com o chaveiro conferido por sha256 no build |
| Claude Code | 2.1.326 | o pacote npm `@anthropic-ai/claude-code`, instalado em `/usr/local/bin` |
| apoio | `ca-certificates`, `procps`, `tini`, `tzdata` | o Debian da base, sem versão fixada |

O motor não exige versão mínima de `git`, de `gh` nem do Claude Code. `GET /api/doctor` diz se
o `gh` e o `claude` respondem e qual versão têm (o `git` não aparece lá), e o motor avisa quando
o Claude Code fica mais de três dias atrás da última versão publicada no npm
(`lib/engine/versao-claude.js`): a versão fixada na imagem vai acender esse aviso até a imagem
ser reconstruída com o `ARG` novo.

O build roda `apt-get upgrade`, então os pacotes do sistema trazem as correções de segurança
publicadas até o dia do build.

O que entra do repositório, em `/opt/farol`, com dono root e sem permissão de escrita para o
usuário do motor: `server.js`, `package.json`, `LICENSE`, `lib/`, `workspace-template/`,
`assets/third-party/babel-parser/` e quatro ferramentas (`tools/farol-parear.js`,
`tools/jira-mcp.js`, `tools/diagnosticar-legados.js` e `tools/simular-politica.js`). Não entram
`web/`, `test/`, `docs/`, `.git` nem `.github`: o `.dockerignore` nega tudo e libera por lista, e
`test/imagem-do-motor.test.js` confere que tudo o que o `server.js` importa está no que é
copiado.

O processo:

- roda como o usuário `farol`, UID e GID 10001. Nunca root: com uid 0 o Claude Code recusa a
  revisão headless;
- o PID 1 é o `tini`, que repassa o `SIGTERM` ao motor e recolhe os processos órfãos. Sem ele
  o Node seria o PID 1 e não os recolheria: o motor encerra a árvore de uma sessão com
  `SIGKILL` no grupo, e os netos adotados pelo PID 1 ficavam como zumbis (medido na prova, dois
  `<defunct>` com o Node como PID 1 e nenhum com o `tini`);
- escuta na porta 47170, a do `EXPOSE` e a da sonda da imagem (`HEALTHCHECK` em
  `GET /api/health`, pelo próprio Node, sem `curl`). Quem trocar `port` no `config.json` troca
  a sonda junto;
- roda com a raiz somente leitura (`--read-only` com `tmpfs` em `/tmp`). Fora do volume e de
  `/tmp`, só `/run/lock` e `/var/tmp` são graváveis na imagem, e com a raiz somente leitura
  nem eles.

A imagem não tem `curl`, `wget`, `jq`, `ssh` nem `pnpm`.

## Variáveis de ambiente

A imagem já define todas. Nenhuma é segredo.

| variável | valor na imagem | para que serve |
|---|---|---|
| `HOME` | `/home/farol` | o HOME do usuário do motor, que é o volume |
| `FAROL_HOME` | `/home/farol/.farol` | a pasta de dados. É o `~/.farol` do HOME acima de propósito: outro valor liga a instância isolada, que não escreve no GitHub (`lib/paths.js`) |
| `FAROL_INSTANCIA_HOSPEDADA` | `1` | a trava abaixo |
| `NODE_ENV` | `production` | o motor não a lê; vale para o que ele executa |
| `TZ` | `America/Sao_Paulo` | [o fuso do processo](#o-fuso-do-processo) |
| `DISABLE_AUTOUPDATER` | `1` | o Claude Code não tenta se atualizar: a versão é a da imagem |

**`FAROL_INSTANCIA_HOSPEDADA=1` impede o motor de subir aberto.** Para o motor, `config.json`
ausente é instalação nova: ele sobe em loopback, sem autenticação, com a conta detectada pelo
`gh` revisando e postando sozinha. Num container, o volume que não montou é exatamente isso.
Com a variável em `1`, o boot recusa (`lib/instancia-hospedada.js`):

- `config.json` ausente;
- `config.json` que não exige autenticação na API;
- `config.json` sem `hostPublico` e sem `origensPermitidas`.

Em cada caso o motor escreve o motivo no stderr, sai com código 1 e não cria nem altera nada
no volume. As mensagens:

```
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: não há config.json em /home/farol/.farol/config.json. Sem ele o motor subiria com os padrões, sem autenticação e com a conta agindo sozinha. Confira se o volume de dados está montado e grave o config.json da instância (docs/HOSPEDAGEM.md). Nada foi criado.
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: o config.json não exige autenticação na API. Grave "hostPublico" ou "origensPermitidas" (qualquer um dos dois liga a exigência, sem chave que desligue) e "localAuth": "exigir". Corrija /home/farol/.farol/config.json (o arquivo não foi alterado; docs/HOSPEDAGEM.md).
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: o config.json não define "hostPublico" nem "origensPermitidas". Grave o nome com que o proxy chega ao motor em "hostPublico" e a origem do front em "origensPermitidas". Corrija /home/farol/.farol/config.json (o arquivo não foi alterado; docs/HOSPEDAGEM.md).
```

A exigência de autenticação é a mesma regra do porteiro da API (`exigida`, em
`lib/local-auth/acesso.js`). Como `hostPublico` e `origensPermitidas` ligam a exigência
sozinhos, toda instância que passa pela terceira recusa exige autenticação, e o `config.json`
de máquina local (sem nenhuma das duas) recebe as duas últimas mensagens juntas. As recusas de
[`CONFIGURATION.md`](CONFIGURATION.md#para-hospedar) continuam valendo antes destas: arquivo
ilegível, nome de chave errado e valor inválido.

Só `1` liga. Ausente, vazia e `0` desligam (`0` serve para rodar a imagem numa máquina de
desenvolvimento). Qualquer outro valor (`true`, `sim`) impede o boot, para um erro de digitação
não virar a trava desligada.

## O volume

Um volume só, montado em `/home/farol`, o HOME inteiro do usuário do motor. Não basta montar
`~/.farol`: o motor e as ferramentas que ele chama gravam em outros pontos do HOME.

| caminho no volume | quem grava | o que é |
|---|---|---|
| `.farol/` | o motor | todo o estado: `config.json`, o workspace das sessões, o log, o histórico, o consumo, as sessões pareadas (`local-auth/`), a credencial do Jira, o cache das fontes. A lista está no [`CLAUDE.md`](../CLAUDE.md#onde-mora-o-dado) |
| `.farol/claude/<id>/` | o Claude Code | a pasta de cada perfil de assinatura, com o login (`.credentials.json`) |
| `.claude.json` | o motor | a confiança do Claude Code no workspace (`ensureWorkspaceTrusted`, `server.js`) |
| `.config/gh/`, `.local/state/gh/` | o `gh` | o login da conta revisora e o estado do `gh` |
| `.claude/`, `.cache/`, `.npm/` | o Claude Code e o npm | configuração padrão e caches, quando usados |

Fora do volume o motor só grava na pasta temporária (`/tmp`): a cópia efêmera da configuração
do perfil de assinatura, apagada no fim de cada uso (`lib/engine/perfil-assinatura.js`). `/tmp`
pode ser `tmpfs`: nada ali precisa sobreviver ao reinício.

O volume tem de ser gravável pelo UID 10001. O volume nomeado do Docker nasce assim, porque
copia o dono de `/home/farol` da imagem. Em Kubernetes, use `fsGroup: 10001`.

Na prova, um container novo com o mesmo volume manteve a sessão pareada (o mesmo token
respondeu 200 em `GET /api/state`), o `config.json`, o `~/.claude.json`, o perfil de assinatura
e os arquivos sentinela postos em `.farol/claude/<id>/.credentials.json` e em `.config/gh/`.

## O config.json da instância

O exemplo está em
[`exemplos/config.hospedagem.exemplo.json`](exemplos/config.hospedagem.exemplo.json), sem
segredo nenhum, e é o que o CI usa para subir a imagem. Troque os dois endereços e grave em
`/home/farol/.farol/config.json`, com dono 10001. O motor regrava esse arquivo no boot com modo
644; quem o protege é a pasta, `/home/farol` e `.farol`, as duas com modo 700 (medido na prova).

| chave | no exemplo | por quê |
|---|---|---|
| `bind` | `"0.0.0.0"` | dentro do container o proxy chega pela rede do pod, não pelo loopback. O padrão do motor continua sendo `127.0.0.1` |
| `port` | `47170` | a porta do `EXPOSE` e da sonda |
| `hostPublico` | `"farol.exemplo.com"` | o nome com que o proxy TLS chega ao motor, sem porta |
| `origensPermitidas` | `["https://painel.exemplo.com"]` | a origem do front na Vercel |
| `localAuth` | `"exigir"` | a exigência de autenticação dita por extenso; as duas chaves acima já a ligam |
| `conta` | `autoReview: false` e os três desfechos em `wait` | a primeira subida recomendada: o motor monitora, põe na fila e não posta nada sozinho |

O exemplo não traz o login da conta (`conta.user`): ele é detectado do `gh` no primeiro ciclo
depois do login. Para fixá-lo desde o início, acrescente `"user": "<login>"` à conta.

## Primeira subida

Os comandos são os do Docker; no orquestrador, o equivalente. `IMAGEM` é a imagem construída
(`docker build -t farol-biuder-motor:dev .`).

1. **Grave o `config.json` no volume**, antes de subir o motor. O config entra pela entrada
   padrão e nasce com o dono certo:

   ```sh
   docker volume create farol-dados
   docker run --rm -i -v farol-dados:/home/farol --entrypoint sh "$IMAGEM" \
     -c 'umask 077; mkdir -p ~/.farol && cat > ~/.farol/config.json' < config.json
   ```

2. **Suba o motor**, com a raiz somente leitura:

   ```sh
   docker run -d --name farol --read-only --tmpfs /tmp \
     -v farol-dados:/home/farol -p 127.0.0.1:47170:47170 "$IMAGEM"
   ```

   Sem `config.json`, ou com um que não serve, o container sai com código 1 e o motivo está em
   `docker logs farol`.

3. **Confira a saúde.** `docker inspect --format '{{.State.Health.Status}}' farol` tem de dizer
   `healthy`. Pelo proxy: `GET /api/health` responde `200 {"ok":true}`, `GET /` responde 404 em
   JSON e `GET /api/state` sem token responde 401.

4. **Pareie.** O código sai no terminal, vale dez minutos e uma vez só:

   ```sh
   docker exec farol node tools/farol-parear.js
   ```

   Troque o código pelo token como em
   [Chamar a API sem tela](CONFIGURATION.md#chamar-a-api-sem-tela), com `FAROL` no endereço
   `https://` do proxy, ou digite-o no front. Com o cabeçalho guardado, `GET /api/doctor`
   mostra o que o motor enxerga: as versões do `gh` e do Claude Code, `root: false` e
   `instanciaIsolada: false`.

5. **Logue o `gh` na conta revisora**, como o usuário do motor (o `docker exec` já entra como
   ele). O token vem de um arquivo ou do teclado, nunca como argumento:

   ```sh
   docker exec -i farol gh auth login --hostname github.com --with-token < token.txt
   ```

   O login fica em `~/.config/gh`, no volume. **`GH_TOKEN` no ambiente do container não
   serve**: o motor pede o token com `gh auth token --user <login>` (`refreshTokens`,
   `server.js`), e esse comando só lê o login guardado. Medido na imagem: com `GH_TOKEN`
   definido, `gh auth token` devolve o valor da variável e `gh auth token --user <login>`
   responde `no oauth token found`. O motor também apaga `GH_TOKEN` e `GITHUB_TOKEN` herdados
   antes de chamar o `gh` em nome da conta (`ghEnv`).

6. **Faça o login da assinatura do Claude**, pelas três rotas de
   [Login da assinatura pela API](CONFIGURATION.md#login-da-assinatura-pela-api): crie o
   perfil de assinatura, chame `login-web/start`, abra o endereço num navegador e devolva o
   código em `login-web/code`. O login fica em `~/.farol/claude/<id>`, no volume. Na prova, o
   `start` devolveu o endereço de autorização de dentro do container; o resto pede uma conta de
   verdade.

7. **Defina a conta revisora e saia do modo de espera.** Com o `gh` logado, o motor detecta o
   login no ciclo seguinte. Confira a conta em `GET /api/state` e, quando quiser que o motor
   aja, mude a política pela tela Sistema ou por `POST /api/accounts/edit`
   ([a conta e a política](CONFIGURATION.md#a-conta-revisora-e-a-política)).

## O que o orquestrador precisa garantir

- **Uma réplica, sempre.** O estado é arquivo em disco, e a trava de instância única é o
  `listen` na porta (`start`, `server.js`), que só vale dentro do mesmo container: duas
  réplicas no mesmo volume revisariam em dobro e gravariam o estado uma por cima da outra.
- **Estratégia `Recreate`**, nunca troca gradual: na troca gradual a réplica nova sobe com a
  antiga ainda viva, no mesmo volume.
- **Volume de bloco, com um escritor só** (`ReadWriteOnce`), e não sistema de arquivos de
  rede. O motor grava por renomear atômico e por arquivo de trava, e mantém repositórios `git`
  no cache das fontes; nada disso foi exercitado em NFS ou EFS, e o volume de rede ainda
  permitiria a segunda réplica.
- **Sondas em `GET /api/health`**, na porta 47170. A rota responde antes da allowlist de Host,
  então o probe pode chegar pelo IP do pod. Ela diz só que o processo atende HTTP.
- **Proxy com TLS na frente**, e `hostPublico` igual ao nome que o proxy entrega no cabeçalho
  `Host`, sem porta. O stream de `GET /api/events` é SSE: o proxy não pode fazer buffer da
  resposta nem cortar a conexão ociosa cedo.
- **Raiz somente leitura** (`readOnlyRootFilesystem: true`), com um volume temporário em `/tmp`
  e o processo como UID 10001 (`runAsNonRoot`, `runAsUser: 10001`, `fsGroup: 10001`).
- **Tempo de encerramento.** O motor trata `SIGTERM` e sai com código 0; na prova o
  `docker stop` levou cerca de meio segundo. Trinta segundos sobram. A revisão em andamento não
  é esperada: o processo dela morre com o container, e no boot seguinte o PR volta à fila
  (`recoverInflight`, `server.js`), o que gasta a sessão de novo. Reinicie com a fila vazia
  quando der.
- **Saída para a internet**: `api.github.com` e `github.com` (o `gh` e o `git`), a API da
  Anthropic e `claude.com` (o Claude Code), `registry.npmjs.org` (a conferência de versão do
  Claude Code) e o Jira da organização, se houver site cadastrado.

## O fuso do processo

A imagem fixa `TZ=America/Sao_Paulo` (com `tzdata` instalado). Sem a variável o container
rodaria em UTC, e o motor usa o fuso do processo em quatro lugares:

- **o dia do consumo** (`localDay`, `lib/engine/usage.js`): cada sessão é somada no dia local
  do processo. Em UTC o dia viraria às 21h de Brasília, e o "hoje" do Consumo zeraria nessa
  hora;
- **a hora em que o limite do plano volta** (`resetAtFrom`, `lib/log-taxonomy.js`): o Claude
  Code escreve a hora no fuso do processo dele, e o motor a interpreta no fuso do próprio
  processo. Os dois herdam a mesma `TZ`, então a conta fecha em qualquer fuso; o que muda é a
  hora mostrada ao operador (`horaCurta`, `lib/engine/limite-plano.js`);
- **as horas escritas em avisos e motivos** (a política da conta em
  `lib/engine/contas-config.js`, a pausa do GitHub em `lib/engine/limite-gh.js`, o pedido de
  revisão em `lib/engine/pedido-de-revisao.js`);
- **o carimbo de dia da âncora de re-revisão** (`diaLocal`, `lib/engine/review.js`), que hoje
  só serve ao diagnóstico.

Não dependem do fuso do processo: a linha do `farol.log`, que sai sempre em horário de Brasília
com o deslocamento escrito, e a série de atividade de `GET /api/usage`
(`lib/usage/activity.js`), que usa `America/Sao_Paulo` por constante.

Quem trocar `TZ` no orquestrador troca os quatro pontos acima.

## Riscos conhecidos

1. **A sessão de revisão alcança as credenciais.** Ela roda como o mesmo usuário do motor, no
   mesmo container, com shell: o login da assinatura (`.credentials.json`), o login do `gh`
   (`~/.config/gh`) e o token da conta que o motor passa no ambiente dela estão ao alcance de
   um comando. As guardas da sessão negam os caminhos óbvios e não fecham os outros
   ([o detalhe](CONFIGURATION.md#3-a-sessão-de-revisão-alcança-a-credencial-da-assinatura)).
   Um PR revisado pode trazer texto que tente induzir a sessão a ler esses arquivos. Não está
   resolvido: é isolamento de processo, decisão de arquitetura. O que mitigaria: rodar a
   sessão como outro usuário, ou em outro container, sem acesso à pasta do perfil e ao
   `~/.config/gh`; entregar à sessão um token do GitHub só de leitura, diferente do que posta;
   restringir a saída de rede da sessão aos endereços de que ela precisa. Enquanto isso, use
   para a conta revisora um token com o menor escopo que a revisão permite e trate as duas
   credenciais como expostas a qualquer PR revisado.

2. **O código de pareamento pode ser queimado por quem não pareou.** `POST /api/auth/pair` é
   pública. Cada tentativa errada conta contra todos os códigos pendentes, e a quinta os tira
   do arquivo (`registrarErro`, `lib/local-auth/pareamento.js`). Quem alcança o proxy consegue,
   com cinco pedidos, invalidar o código que alguém acabou de gerar, e repetir isso impede
   qualquer pareamento novo. Medido na imagem: cinco pedidos sem token, todos com a mesma
   resposta `codigo_invalido`, e o código pendente saiu do disco. Ninguém entra por aí: o código
   tem dez caracteres em base32 (cerca de 50 bits), vale dez minutos e uma vez, e a sessão já
   pareada seguiu valendo. O motor grava uma linha `WARN` no `farol.log` a cada bloqueio. Não foi corrigido neste lote
   (ver [o que falta](#o-que-não-foi-provado)). Até lá: limite a taxa de `POST /api/auth/pair`
   no proxy, por endereço de origem, e use o código assim que gerar.

3. **Sem a ferramenta da avaliação técnica.** A imagem não traz `pnpm` nem a ferramenta fixada
   em `lib/technical-review/tool.json`, que é instalada à parte no volume
   (`node lib/technical-review/setup.js`, [a instalação](CONFIGURATION.md#avaliação-técnica-dos-prs-revisados))
   a partir de um repositório privado. Sem ela a avaliação técnica registra a ferramenta como
   indisponível (`lib/technical-review/verdict.js`). Na primeira subida, com tudo em `wait`,
   nada é postado de qualquer forma. A instalação dentro do container não foi feita nem medida;
   se for feita, atenção ao `NODE_ENV=production` da imagem, que faz o `pnpm install` deixar de
   fora as dependências de desenvolvimento.

4. **`/tmp` sem execução.** O `--tmpfs /tmp` do Docker monta com `noexec`. O motor subiu, e o
   Claude Code respondeu a `auth status` e a `auth login` assim, mas uma revisão de verdade não
   foi rodada: se a sessão precisar executar algo a partir de `/tmp`, monte-o com `exec`.

5. **A versão do Claude Code envelhece.** O motor pede o modelo por apelido, e quem decide para
   onde o apelido aponta é o CLI. A imagem fixa a versão e desliga a atualização automática:
   manter o CLI em dia é reconstruir a imagem.

6. **Um `claude` em `~/.local/bin` ganha do da imagem.** O motor põe essa pasta na frente do
   PATH (`server.js`), e ela fica no volume. Não rode o instalador nativo do Claude Code dentro
   do container.

## Atualizar a versão

Troque a imagem e mantenha o volume: pare o container, suba o novo com o mesmo volume. Na
prova, uma imagem reconstruída subiu sobre o volume da anterior com a sessão pareada, a
configuração e os perfis no lugar.

No boot o motor regrava cinco arquivos do protocolo no workspace do volume e copia o prompt que
faltar; o `.claude/settings.json` do workspace não é atualizado
([imagem nova com volume antigo](CONFIGURATION.md#6-imagem-nova-com-volume-antigo)). Voltar
para uma imagem anterior com o volume já usado por uma mais nova não foi exercitado.

## Publicar a imagem

O CI constrói a imagem e a prova com o container de pé (job `imagem` de
`.github/workflows/ci.yml`, que roda [`tools/provar-imagem.sh`](../tools/provar-imagem.sh)),
e **não publica**: não há login em registro, não há push e não há segredo no workflow. Falta
decidir, com o tech lead:

- **o registro**: o ECR da conta da BIUD na AWS ou o GHCR da organização;
- **quem dispara**: uma tag de versão ou um disparo manual;
- **a credencial**: para o ECR, OIDC do GitHub Actions para um papel da AWS com permissão só
  de push naquele repositório, sem chave de longa duração; para o GHCR, o `GITHUB_TOKEN` do
  job com `packages: write`;
- **a marca da imagem**: a versão do `package.json`, hoje `3.0.0-dev`, e o commit;
- **o destino**: o cluster (EKS) e o manifesto, com os requisitos de
  [O que o orquestrador precisa garantir](#o-que-o-orquestrador-precisa-garantir).

Um esboço do job, para quando isso estiver decidido. Ele não existe no workflow, e as ações da
AWS e o nome do papel são suposições a conferir:

```yaml
# publicar:
#   name: publicar
#   runs-on: ubuntu-latest
#   needs: [gate, web, imagem]
#   if: startsWith(github.ref, 'refs/tags/v')
#   permissions:
#     contents: read
#     id-token: write            # só para o OIDC da AWS
#   steps:
#     - uses: actions/checkout@v7
#     - uses: aws-actions/configure-aws-credentials@<versão fixada>
#       with:
#         role-to-assume: arn:aws:iam::<conta>:role/<papel-de-push-do-farol>
#         aws-region: <região>
#     - uses: aws-actions/amazon-ecr-login@<versão fixada>
#       id: ecr
#     - name: Construir, provar e publicar
#       run: |
#         IMAGEM="${{ steps.ecr.outputs.registry }}/farol-biuder-motor:${GITHUB_REF_NAME#v}"
#         docker build \
#           --build-arg FAROL_VERSAO="${GITHUB_REF_NAME#v}" \
#           --build-arg FAROL_REVISAO="${{ github.sha }}" \
#           --build-arg FAROL_CRIADA_EM="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#           --tag "$IMAGEM" .
#         bash tools/provar-imagem.sh "$IMAGEM"
#         docker push "$IMAGEM"
```

A imagem não leva segredo em camada, em `ARG` nem em variável: publicá-la num registro privado
não expõe credencial. O `config.json`, o login do `gh` e o da assinatura só existem no volume.

## O que não foi provado

- **O login real do `gh`** dentro do container (pede o token da conta revisora) e o motor
  buscando PRs com ele.
- **O login da assinatura até o fim.** A primeira rota devolveu o endereço de autorização; o
  código e a credencial gravada pedem uma conta de verdade.
- **Uma revisão de verdade dentro do container**: sessão headless, leitura das fontes pelo
  `git`, postagem. Nem o uso do plano lido com um login real.
- **A imagem em `linux/arm64`**: a base é multiarquitetura, e o build e a prova foram só em
  `linux/amd64`.
- **A imagem num orquestrador** (Kubernetes, `fsGroup`, sondas, proxy com TLS e SSE). A prova
  foi com o Docker, numa máquina só.
- **Varredura de vulnerabilidade.** O `docker scout` da máquina da prova pede login no Docker
  Hub, e não havia outra ferramenta instalada. O que foi conferido: com o `apt-get upgrade` do
  build, nenhum pacote do sistema tinha atualização pendente nos repositórios do Debian e do
  `gh`.

O que falta fazer, além de publicar:

- **Fechar a queima do código de pareamento** (risco 2). A correção mínima é a tentativa
  errada deixar de contar contra os códigos pendentes e a rota ganhar um limite de taxa
  próprio, que responda a quem excede sem tocar no código. Ela muda uma regra da autenticação
  que tem teste (os cinco erros que invalidam o código) e, atrás do proxy, todo pedido chega
  ao motor com o endereço do proxy: limitar por origem pede confiar num cabeçalho que o proxy
  preencha. É decisão de quem responde pela autenticação, não um ajuste de empacotamento.
- **Isolar a sessão de revisão das credenciais** (risco 1).
- **Decidir como a ferramenta da avaliação técnica entra** (risco 3): na imagem, ou instalada
  no volume.
