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
- [O banco da telemetria](#o-banco-da-telemetria)
- [O config.json da instância](#o-configjson-da-instância)
- [Primeira subida](#primeira-subida)
- [Avaliação técnica](#avaliação-técnica)
- [O que o orquestrador precisa garantir](#o-que-o-orquestrador-precisa-garantir)
- [O fuso do processo](#o-fuso-do-processo)
- [Riscos conhecidos](#riscos-conhecidos)
- [Atualizar a versão](#atualizar-a-versão)
- [Publicar a imagem](#publicar-a-imagem)
- [Hospedagem compartilhada, sem Docker](#hospedagem-compartilhada-sem-docker)
- [O que não foi provado](#o-que-não-foi-provado)

<!-- indice:fim -->

## A imagem

O [`Dockerfile`](../Dockerfile) da raiz. As versões são `ARG` no topo dele, e trocar uma é
reconstruir a imagem.

| peça | versão | de onde vem |
|---|---|---|
| base | `node:24.22.1-bookworm-slim`, fixada por digest | o contrato de Node do `package.json` e do `.nvmrc` |
| `git` | a do Debian 12 no dia do build (2.39.5 em 16/11/2026) | o pacote do Debian, sem versão fixada: fixar o patch quebraria o build quando o Debian o trocasse por uma correção |
| `gh` | 2.105.0 | o repositório apt oficial do GitHub CLI, com o chaveiro conferido por sha256 no build |
| Claude Code | 2.1.326 | o pacote npm `@anthropic-ai/claude-code`, instalado em `/usr/local/bin` |
| `pnpm` | 10.34.9 | o pacote npm `pnpm`, instalado em `/usr/local/bin`; constrói a ferramenta da [avaliação técnica](#avaliação-técnica) |
| apoio | `ca-certificates`, `procps`, `tini`, `tzdata` | o Debian da base, sem versão fixada |

O motor não exige versão mínima de `git`, de `gh` nem do Claude Code. `GET /api/doctor` diz se
o `gh` e o `claude` respondem e qual versão têm (o `git` não aparece lá), e o motor avisa quando
o Claude Code fica mais de três dias atrás da última versão publicada no npm
(`lib/engine/versao-claude.js`): a versão fixada na imagem vai acender esse aviso até a imagem
ser reconstruída com o `ARG` novo.

O build roda `apt-get upgrade`, então os pacotes do sistema trazem as correções de segurança
publicadas até o dia do build. As versões que entraram ficam escritas em `/etc/farol-versoes`,
dentro da imagem, e `tools/provar-imagem.sh` as imprime.

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

A imagem não tem `curl`, `wget`, `jq` nem `ssh`. Traz o `pnpm`, mas não a ferramenta da avaliação
técnica: o código dela é privado, e ela é instalada no volume ([Avaliação técnica](#avaliação-técnica)).

## Variáveis de ambiente

A imagem já define todas. Nenhuma é segredo. `NODE_ENV` não é definida: o motor não a lê, e
`production` faria o `pnpm` da ferramenta da avaliação técnica pular as dependências de
desenvolvimento.

| variável | valor na imagem | para que serve |
|---|---|---|
| `HOME` | `/home/farol` | o HOME do usuário do motor, que é o volume |
| `FAROL_HOME` | `/home/farol/.farol` | a pasta de dados. É o `~/.farol` do HOME acima de propósito: outro valor liga a instância isolada, que não escreve no GitHub (`lib/paths.js`) |
| `FAROL_INSTANCIA_HOSPEDADA` | `1` | a trava abaixo |
| `TZ` | `America/Sao_Paulo` | [o fuso do processo](#o-fuso-do-processo) |
| `DISABLE_AUTOUPDATER` | `1` | o Claude Code não tenta se atualizar: a versão é a da imagem |
| `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` | `/home/farol/.local/share`, `/home/farol/.cache`, `/home/farol/.local/state` | a loja de pacotes, o cache e o estado do `pnpm` no volume, com a raiz somente leitura. São os padrões do HOME escritos por extenso: o `gh` e o Claude Code continuam gravando onde já gravavam |
| `npm_config_update_notifier` | `false` | o `pnpm` e o `npm` não consultam o registro atrás de versão nova |

**`FAROL_INSTANCIA_HOSPEDADA=1` impede o motor de subir aberto.** Para o motor, `config.json`
ausente é instalação nova: ele sobe em loopback, sem autenticação, com a conta detectada pelo
`gh` revisando e postando sozinha. Num container, o volume que não montou é exatamente isso.
Com a variável em `1`, o boot recusa (`lib/instancia-hospedada.js`):

- `config.json` ausente;
- `config.json` que não exige autenticação na API;
- `config.json` sem `hostPublico` e sem `origensPermitidas`.

Em cada caso o motor escreve o motivo no stderr e sai com código 1, e o `config.json` não é
criado nem tocado. A linha da recusa também vai para o `farol.log` quando a pasta de estado
(`.farol/workspace/state/`) já existe no volume, que é o caso de uma instância que já rodou;
num volume vazio, nada é criado. As mensagens:

```
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: não há config.json em /home/farol/.farol/config.json. Sem ele o motor subiria com os padrões, sem autenticação e com a conta agindo sozinha. Confira se o volume de dados está montado e grave o config.json da instância (docs/HOSPEDAGEM.md). O config.json não foi criado.
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: o config.json não exige autenticação na API. Grave "hostPublico" ou "origensPermitidas" (qualquer um dos dois liga a exigência, sem chave que desligue) e "localAuth": "exigir". Corrija /home/farol/.farol/config.json (o arquivo não foi alterado; docs/HOSPEDAGEM.md).
[farol] instância hospedada (FAROL_INSTANCIA_HOSPEDADA=1), o motor não sobe: o config.json não define "hostPublico" nem "origensPermitidas". Grave o nome com que o proxy chega ao motor em "hostPublico" e a origem do front em "origensPermitidas". Corrija /home/farol/.farol/config.json (o arquivo não foi alterado; docs/HOSPEDAGEM.md).
```

A exigência de autenticação é a mesma regra do porteiro da API (`exigida`, em
`lib/local-auth/acesso.js`). Como `hostPublico` e `origensPermitidas` ligam a exigência
sozinhos, toda instância que passa pela terceira recusa exige autenticação, e o `config.json`
de máquina local (sem nenhuma das duas) recebe as duas últimas mensagens juntas. As recusas de
[`CONFIGURATION.md`](CONFIGURATION.md#para-hospedar) continuam valendo antes destas: arquivo
ilegível, nome de chave errado e valor inválido.

Só `1` liga, e só ausente e `0` desligam (`0` serve para rodar a imagem numa máquina de
desenvolvimento). Qualquer outro valor impede o boot, inclusive `true`, `sim` e a variável
**vazia**: um manifesto com `value: ""` por cima do padrão da imagem não desliga a trava, faz o
container sair com código 1.

**Dois avisos, que não recusam.** A config passa pela trava e mesmo assim não atende ninguém; o
motor sobe e grava uma linha `WARN` no `farol.log` e no stderr (`avisosDaHospedagem`):

- `bind` em loopback ou ausente: dentro do container o motor escuta só para o próprio
  container, e o proxy não conecta;
- `origensPermitidas` sem `hostPublico`, com `bind` fora do loopback: a allowlist de Host
  aceita só `127.0.0.1`, `localhost` e o próprio `bind`, com a porta. O pedido que o proxy
  entregar com o nome público no `Host` recebe 403, a menos que o proxy reescreva o `Host`.

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
| `.farol/toolchains/eng-behaviour@<versão>/` | `setup.js` | a ferramenta da avaliação técnica, instalada por quem opera |
| `.farol/technical-review/repositories.json` | quem opera | o cadastro dos repositórios avaliados |
| `.local/share/pnpm/` | o `pnpm` | a loja de pacotes da instalação da ferramenta |

Fora do volume o motor só grava na pasta temporária (`/tmp`): a cópia efêmera da configuração
do perfil de assinatura, apagada no fim de cada uso (`lib/engine/perfil-assinatura.js`). A
instalação da ferramenta da avaliação técnica também só grava no volume e em `/tmp` (medido na
prova com a raiz somente leitura). `/tmp`
pode ser `tmpfs`: nada ali precisa sobreviver ao reinício.

O volume tem de ser gravável pelo UID 10001. O volume nomeado do Docker nasce assim, porque
copia o dono de `/home/farol` da imagem. Em Kubernetes, use `fsGroup: 10001`.

Na prova, um container novo com o mesmo volume manteve a sessão pareada (o mesmo token
respondeu 200 em `GET /api/state`), o `config.json`, o `~/.claude.json`, o perfil de assinatura
e os arquivos sentinela postos em `.farol/claude/<id>/.credentials.json` e em `.config/gh/`.

## O banco da telemetria

O registro de consumo (as sessões, as tentativas abertas e os motivos de falha) e o histórico das
decisões resolvidas (até 3.000, a mais nova primeiro) moram num arquivo SQLite no volume: `.farol/workspace/state/telemetria.db` (`TELEMETRIA_DB`, `lib/paths.js`),
aberto pelo `node:sqlite` do próprio Node, sem pacote. O agregado do consumo continua no
`usage.json`, ao lado. O motor abre o arquivo uma vez, depois de tomar a porta (a trava de
instância única: uma segunda instância no mesmo volume não chega a abri-lo), com WAL,
`synchronous=FULL` (cada gravação vai ao disco antes de o motor seguir, como o `fsync` do JSON de
antes) e permissão 600, e o fecha na saída ordenada (SIGTERM). Ao lado dele ficam o
`telemetria.db-wal` e o `telemetria.db-shm`, que fazem parte do banco enquanto o motor está de pé.

Na primeira subida desta versão o motor importa os JSON antigos (`usage-sessions.json`,
`usage-tentativas.json` e `falhas-sessao.json`), confere a contagem, as somas e cada linha, e
renomeia cada um para `<nome>.migrado-<dia>` (nada é apagado; quando der por certo, quem opera
pode apagá-los). Isso dá uma linha `INFO` no `farol.log`. Se o banco não abrir (o arquivo
existe e está corrompido, é de uma versão mais nova do motor ou de outro dono, ou não pôde ser
criado) ou a importação falhar, o motor sobe assim mesmo, grava nos JSON como antes e escreve uma
linha `WARN` começando por `telemetria:` com a causa. O que ele gravar nos JSON nessa subida
entra no banco quando ele voltar a abrir: a importação de toda subida traz só as linhas que o
banco ainda não tem. Durante a subida sem banco, a tela mostra só o consumo dessa subida, e uma
retomada de sessão cuja linha anterior está no banco sai com custo desconhecido, sem contar em
dobro. O detalhe está em [`docs/CONSUMO-REVIEWS.md`](CONSUMO-REVIEWS.md#onde-o-registro-mora).

Medido com os dados da instância de desenvolvimento em 16/11/2026: 5.567 sessões, 3 tentativas
abertas e 244 falhas viraram um `telemetria.db` de 3,9 MB, no lugar de 5,8 MB de JSON.

**O histórico das decisões** (desde 17/11/2026). O `decisions.json` passa a guardar só as
pendências; o histórico (`resolved`) vai para a tabela `resolvidas` do mesmo banco. Na primeira
subida desta versão o motor importa o histórico que o arquivo tiver (só o que o banco ainda não
tem), confere a contagem e cada decisão, copia o arquivo original para
`decisions.json.migrado-<dia>` e só então regrava o `decisions.json` com `resolved: []` e a marca
`"historicoNoBanco": true`, com uma linha `INFO`. A cópia é feita num nome temporário
(`.parcial`) e renomeada no fim, e não se repete se já houver uma cópia íntegra do mesmo arquivo
(mesmo tamanho e hash). Ela fica no volume até quem opera apagá-la. Resolver uma decisão grava no
banco antes de regravar o `decisions.json`; se o processo cair entre os dois, a subida seguinte
acha a pendência no histórico e a tira das pendências, sem gravar de novo (o dossiê do autor, o
aviso e o evento para a tela daquela decisão se perdem; o review, quando houve, já está no GitHub).

**Folga de disco para migrar:** 2,5 vezes o tamanho do `decisions.json` livres na pasta de estado
(medido: o pico é de 1,9 vez, o banco com o WAL da transação ou o banco com a cópia). Sem essa
folga o motor não migra naquela subida: segue no `decisions.json`, como antes, com uma linha
`WARN` que diz quantos bytes faltam, e tenta de novo na subida seguinte.

**Banco fora antes e depois da migração.** Antes da primeira migração (sem a marca), banco que não
abre, importação que não confere ou falta de folga deixam o histórico inteiro no `decisions.json`,
como antes, com uma linha `WARN`; ele entra no banco numa subida seguinte. Depois da migração (com
a marca), o histórico mora no banco: se ele não abrir, ou se uma leitura dele falhar com o motor de
pé, o histórico fica **indisponível**, com uma linha `WARN` (`histórico de decisões indisponível`)
e outra `INFO` quando volta. Nesse estado o motor não trata o vazio como "nada foi decidido": não
devolve à fila PR já visto, não marca PR como ignorado, não rearma re-request, não retoma sessão
interrompida, a memória de critérios sai como não verificável (o que barra a publicação por
critérios) e `GET /api/decisions` responde 503 com `historico_indisponivel`. Decisão nova que o
banco não aceitar fica no `resolved` do `decisions.json` e entra no banco depois.

**Voltar a imagem para antes deste lote** exige restaurar o `decisions.json.migrado-<dia>` no lugar
do `decisions.json`, com o motor parado: a versão anterior não lê o histórico do banco e subiria
com o histórico vazio. As pendências criadas depois da migração ficam no `decisions.json` atual;
quem restaurar copia o `pending` dele para o arquivo restaurado antes de subir.

Medido com o histórico real em 17/11/2026 (2.596 decisões, `decisions.json` de 217 MB, numa cópia
num disco Linux do WSL): a importação levou de 3,9 a 5,4 s, o processo chegou a 1,1 GB de memória
(o construtor, que ainda lê o arquivo grande nessa subida, já ocupa 0,87 GB), o `decisions.json`
ficou com 37 bytes e o banco com 202 MB (o `-wal` é zerado ao fim da importação). Na subida
seguinte o construtor levou 0,12 s e o processo inteiro 106 MB, no lugar de 1,1 s e 0,87 GB.

**Copiar com o motor de pé.** Com WAL, copiar só o `.db` não basta: parte das gravações ainda
está no `-wal`, e copiar os três arquivos soltos pode pegar um no meio de uma gravação. O jeito
seguro é pedir ao próprio SQLite uma cópia consistente. A imagem não traz o `sqlite3`; o Node
dela faz o mesmo, por uma conexão só de leitura, que não atrapalha o motor. O destino abaixo fica
no volume (`/home/farol`) e o `umask 077` faz a cópia nascer com 600 (sem ele, nasceria 644 e
legível por outros usuários do host que enxergam o volume). Tire-a com `docker cp` e apague:

```
docker exec <container> sh -c 'umask 077; node -e "new (require(\"node:sqlite\").DatabaseSync)(process.argv[1], { readOnly: true }).prepare(\"VACUUM INTO ?\").run(process.argv[2])" \
  /home/farol/.farol/workspace/state/telemetria.db /home/farol/telemetria-copia.db'
docker cp <container>:/home/farol/telemetria-copia.db ./telemetria-copia.db
docker exec <container> rm /home/farol/telemetria-copia.db
```

O destino não pode existir. O resultado é um arquivo só, sem `-wal`, que se abre em qualquer
SQLite. O mesmo comando funciona com o motor parado (provado no WSL em 17/11/2026: banco
fechado, sem `-wal` nem `-shm`, cópia íntegra com 600); nesse caso a conexão só de leitura deixa
um `-wal` vazio e um `-shm` ao lado do banco, que o motor reaproveita na próxima subida. Com o
motor parado, os arquivos também podem ser copiados como estão (o fechamento ordenado já devolve
o WAL ao `.db`). O backup contínuo (Litestream ou cópia agendada para o S3) é o lote de backup,
ainda não feito: hoje a cópia do banco é a cópia do volume.

**Retenção: decisão pendente.** As sessões não têm poda, como no JSON de antes: o banco cresce
uns 700 bytes por sessão registrada. Os motivos de falha seguem com o teto de 500. O histórico
das decisões segue com o teto de 3.000 (a mais antiga sai quando entra uma nova), com uns 78 KB
por decisão no histórico real, quase tudo o inventário do diff. Apagar linhas não encolhe o
arquivo: o espaço é reaproveitado pelas próximas.

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
| `hostPublico` | `"farol.exemplo.invalid"` | o nome com que o proxy TLS chega ao motor, sem porta |
| `origensPermitidas` | `["https://painel.exemplo.invalid"]` | a origem do front na Vercel |
| `localAuth` | `"exigir"` | a exigência de autenticação dita por extenso; as duas chaves acima já a ligam |
| `conta` | `autoReview: false` e os três desfechos em `wait` | a primeira subida recomendada: o motor monitora, põe na fila e não posta nada sozinho |

Os dois endereços do exemplo terminam em `.invalid`, um nome reservado que nunca resolve.
**Subir o exemplo sem trocar não abre nada, e também não funciona:** o motor sobe, a saúde
responde, e todo pedido que chegar com o nome de verdade no `Host` recebe
`403 {"error":"forbidden","motivo":"host"}`, porque só `farol.exemplo.invalid` está na lista
(`lib/http-guard.js`).

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

8. **Instale a avaliação técnica**, antes de deixar o motor aprovar sozinho: a ferramenta e o
   cadastro dos repositórios, como em [Avaliação técnica](#avaliação-técnica). Sem as duas, nenhuma
   aprovação sai como limpa.

## Avaliação técnica

Cada PR revisado de um repositório cadastrado passa pela avaliação técnica, com a ferramenta
`eng-behaviour` no commit fixado em `lib/technical-review/tool.json` (hoje a 0.17.0, commit
`ed3e1535cb84`). São duas peças, e as duas moram no volume, em `~/.farol`: a ferramenta, que é
código privado da BIUD e por isso não entra na imagem (o build não leva segredo), e o cadastro
dos repositórios. Postas uma vez, sobrevivem a reinício e a troca de imagem: na prova, o
`docker restart` e um container novo de uma imagem reconstruída, sobre o mesmo volume, acharam
a ferramenta íntegra.

### O que a imagem traz

O `git`, o `gh` e o `pnpm` 10.34.9, com a loja, o cache e o estado do `pnpm` apontados para o
volume (`XDG_DATA_HOME`, `XDG_CACHE_HOME` e `XDG_STATE_HOME`, em
[Variáveis de ambiente](#variáveis-de-ambiente)). A versão do `pnpm` vem do lock da ferramenta: o
`package.json` dela no pino não declara `packageManager`, e o `pnpm-lock.yaml` é
`lockfileVersion: '9.0'`, o formato da linha 10 do `pnpm`. Não há compilador nem python na
imagem, e a construção não precisa: nenhuma dependência do lock compila módulo nativo, e o
`pnpm` 10 não roda script de instalação de dependência (na prova ele avisou
`Ignored build scripts: esbuild@0.21.5`, e a construção, que é só o `tsc`, terminou). A imagem
cresceu cerca de 30 MB com o `pnpm` (de 1,08 GB para 1,12 GB).

### Instalar a ferramenta

Pré-requisito: o `gh` do container logado na conta revisora (passo 5 da
[Primeira subida](#primeira-subida)), e essa conta enxerga o repositório privado da ferramenta.
Confira e instale, como o usuário do motor (o `docker exec` já entra como ele):

```sh
docker exec farol gh repo view biudtech/eng-behaviour --json name
docker exec farol node lib/technical-review/setup.js
```

O `setup.js` clona `https://github.com/biudtech/eng-behaviour.git` com o `git` isolado do motor
e a credencial do `gh` (`credential.helper=!gh auth git-credential`, a mesma da busca das fontes
de revisão), confere que o commit do pino existe, faz checkout dele, roda
`pnpm install --frozen-lockfile` e `pnpm build`, e só então põe a pasta pronta em
`~/.farol/toolchains/eng-behaviour@0.17.0`. O token não vai em argumento, em URL nem no log: o
`git` o pede ao `gh` na hora, pela entrada padrão. O detalhe está em
[`CONFIGURATION.md`](CONFIGURATION.md#avaliação-técnica-dos-prs-revisados).

Medido na prova (clone de uma cópia local montada somente leitura, com a raiz do container
somente leitura): 13,6 segundos do começo ao fim, dos quais 5,4 do `pnpm install` com a loja
vazia; a ferramenta ocupa 62 MB no volume (54 MB de `node_modules`), e a loja do `pnpm`, 59 MB,
quase toda nos mesmos arquivos, ligados por hard link. Rodar o `setup.js` de novo com a
ferramenta íntegra não refaz nada e sai em menos de 0,1 segundo.

Cada falha sai com código 2, diz a causa e termina com "nada foi instalado, e a instalação
anterior, se havia, ficou como estava". As que quem opera vai encontrar:

| causa | começo da mensagem |
|---|---|
| o `gh` sem login, ou a conta sem acesso ao repositório | `sem acesso ao repositório da ferramenta técnica (https://github.com/biudtech/eng-behaviour.git): o gh não está logado, ou a conta logada não enxerga esse repositório. Confira com "gh auth status" e "gh repo view biudtech/eng-behaviour", como o usuário do motor.` |
| sem rede até o GitHub | `falha de rede no clone da ferramenta técnica: https://github.com/biudtech/eng-behaviour.git não respondeu.` |
| o `gh` não instalado | `o "gh" não está instalado ou não está no PATH do usuário que roda a instalação` |
| commit do pino fora da origem | `o commit do pino (ed3e1535..., em lib/technical-review/tool.json) não existe em <origem>` |
| `pnpm` ausente | `o gerenciador de pacotes "pnpm" não está instalado ou não está no PATH` |
| sem rede até o registro de pacotes | `falha de rede em "pnpm install --frozen-lockfile": o registro de pacotes não respondeu` |
| registro de pacotes que recusa (401 ou 403) | `o registro de pacotes recusou o acesso em "pnpm install --frozen-lockfile" (ERR_PNPM_FETCH_401)` |
| outra instalação em curso | `outra instalação da ferramenta técnica em curso desde <hora> (pid <pid>); se ela morreu, apague /home/farol/.farol/toolchains/.instalacao.trava` |
| passo morto de fora | `o passo "pnpm" foi encerrado pelo sinal SIGKILL antes de terminar.` |

As duas primeiras foram medidas na imagem, num volume sem login do `gh` (a segunda com
`--network none`), e são o que `tools/provar-imagem.sh` confere no CI; as outras são travadas por
teste com dublê (`test/avaliacao-tecnica-instalacao.test.js`). Origem com usuário ou token na
URL é recusada antes de qualquer comando.

A instalação é atômica. Na prova, o `pnpm install` morto com `SIGKILL` no meio do download
deixou `~/.farol/toolchains` vazia num volume novo (a ferramenta continuou "não instalada", e a
pasta de preparo saiu), e, sobre uma ferramenta já presente, deixou a pasta anterior no lugar,
intacta. A instalação seguinte terminou normalmente, com a loja do `pnpm` pela metade. Duas
instalações ao mesmo tempo não se atropelam: a segunda acha a trava `.instalacao.trava` em
`~/.farol/toolchains` e sai sem tocar em nada. Se o `setup.js` morrer sem soltar a trava
(`SIGKILL` nele mesmo), apague o arquivo que a mensagem cita e rode de novo.

### O cadastro dos repositórios

Só os repositórios do cadastro são avaliados. O arquivo é
`~/.farol/technical-review/repositories.json`, e este repositório não versiona cadastro real
(é público). O exemplo, com um repositório fictício, está em
[`exemplos/repositories.exemplo.json`](exemplos/repositories.exemplo.json). Cada campo que o
motor lê:

- `repositories`: um objeto com uma entrada por repositório, com a chave `dono/nome` igual à do
  PR, caixa inclusa (`profileFor`, `lib/technical-review/profiles.js`).
- `declaration`: obrigatório. Sem ele a entrada conta como fora do cadastro. O motor confere as
  pastas e entrega o resto à ferramenta, que recusa chave que ela não conhece.
- `declaration.scopes`: lista não vazia entre `core`, `frontend` e `backend`, os grupos de regras
  do catálogo que valem para o repositório.
- `declaration.sourceDirs`, `testDirs`, `e2eDirs` e `componentDirs`: pastas relativas à raiz, de
  código de produção, de teste, de teste de ponta a ponta e de componentes. Lista com itens,
  `null` (o repositório não tem aquele material) ou ausente (a regra que depende do campo não
  roda); lista vazia é recusada. O motor confere, antes da ferramenta, que cada pasta existe no
  commit com a caixa exata: a que falta fica de fora e vira ressalva, e o campo que fica sem
  pasta nenhuma trava a avaliação (`lib/technical-review/declaracao.js`).
- `declaration.deliveryMayRepeat`: booleano, se o transporte que o repositório consome admite
  entrega repetida (liga a regra de idempotência).
- `declaration.isolationScope`: texto, o nome do escopo de isolamento (`tenant`, `conta`); a
  presença declara o repositório como de vários contextos.
- `declaration.componentEntryPointOnlyReexports`: booleano, se o ponto de entrada de uma pasta de
  componente só reexporta.
- `baselines`: a dívida conhecida por regra, conferida pela ferramenta (`repositoryId`,
  `catalogVersion`, `rule`, `openedAt`, `initialFindings`, `currentFindings`,
  `closureCondition` e `known`); `[]` quando não há (`lib/technical-review/debt.js`).
- `instrucaoDeProduto`: texto ou `null`, a instrução do projeto que vai à ferramenta e ao prompt
  da sessão de revisão (`lib/technical-review/worker.js`, `lib/technical-review/prompt.js`).

A impressão da entrada inteira vai no relatório: mudar a entrada de um repositório depois de uma
revisão faz a aprovação pendente dele pedir revisão nova ("declaração técnica mudou").

Para pôr o arquivo no volume, pela entrada padrão, que já cria a pasta e o arquivo com o dono
do motor (10001) e só para ele (700 e 600):

```sh
docker exec -i farol sh -c 'umask 077; mkdir -p ~/.farol/technical-review && cat > ~/.farol/technical-review/repositories.json' < repositories.json
```

Com `docker cp` ou `kubectl cp`, a pasta `technical-review` tem de existir antes: crie-a como o
usuário do motor, copie, e acerte o dono e o modo depois. Com `docker cp` o arquivo chega com
dono root (medido: `0:0`, modo 755), e o acerto é como root:

```sh
docker exec farol sh -c 'umask 077; mkdir -p ~/.farol/technical-review'
docker cp repositories.json farol:/home/farol/.farol/technical-review/repositories.json
docker exec -u 0 farol sh -c 'chown 10001:10001 /home/farol/.farol/technical-review/repositories.json && chmod 600 /home/farol/.farol/technical-review/repositories.json'
```

Em Kubernetes, `kubectl cp` roda o `tar` dentro do container, como o usuário dele, e o arquivo
deve nascer com o dono 10001; o modo segue o do arquivo de origem (não exercitado aqui):

```sh
kubectl exec <pod> -- sh -c 'umask 077; mkdir -p ~/.farol/technical-review'
kubectl cp repositories.json <pod>:/home/farol/.farol/technical-review/repositories.json
kubectl exec <pod> -- sh -c 'chmod 600 ~/.farol/technical-review/repositories.json && ls -ln ~/.farol/technical-review'
```

Se o `ls -ln` mostrar outro dono, acerte com `chown 10001:10001` num contexto que rode como
root. O motor lê o arquivo a cada avaliação: não precisa reiniciar.

Repositório fora do cadastro é revisado e publicado sem avaliação técnica: o resultado aprovável
leva o ponto "Este repositório não tem declaração técnica cadastrada, então a avaliação técnica
automática não rodou." (`pontosDoApp`, `lib/engine/ressalvas.js`) e sai como com ressalvas, decidido
pelo `onCaveats` da conta. Cadastro presente e ilegível não vira "fora do cadastro": a avaliação
falha para todo repositório, e a publicação recusa o APPROVE com `technical_review`
(`lib/technical-review/publication.js`).

### Conferir

`GET /api/doctor` traz a chave `avaliacaoTecnica`. Medido na prova, com a ferramenta instalada
e o cadastro do exemplo:

```json
{ "ferramenta": "integra", "versao": "0.17.0", "commit": "ed3e1535cb84faf572fe66c6dc13a1af441588ee",
  "cadastro": "legivel", "repositorios": 1, "pronta": true,
  "detalhe": "ferramenta instalada e íntegra (eng-behaviour 0.17.0, commit ed3e1535cb84); 1 repositório declarado" }
```

`ferramenta` é `integra`, `ausente` ou `nao-comprovada` (a pasta existe, mas não é o checkout
limpo do commit do pino com o carimbo de construção); `cadastro` é `legivel`, `ausente` ou
`ilegivel`. A tela mostra o mesmo `detalhe` na linha "Avaliação técnica" de Sistema > Saúde, com
o estado em texto: OK quando ela roda para alguém (ferramenta íntegra e pelo menos um
repositório declarado), Atenção nos outros casos. Nenhum caminho de arquivo sai no diagnóstico.
A linha só muda quando o diagnóstico roda: depois de instalar a ferramenta ou de trocar o
cadastro, use "Rodar o diagnóstico de novo" em Sistema > Saúde (ou chame `GET /api/doctor`).

No boot, o `farol.log` só ganha linha quando o estado é anormal: repositório declarado sem a
ferramenta íntegra (com o comando da instalação) ou cadastro ilegível, as duas em `WARN`. Tudo
certo, ou sem cadastro (quem não usa a avaliação técnica), não gera linha. Com a instância
hospedada ligada, a linha vai também ao stderr (o `docker logs`). Medido na prova, com o cadastro
do exemplo e sem a ferramenta:

```
[farol] avaliação técnica: ferramenta ausente (eng-behaviour 0.17.0, commit ed3e1535cb84 não instalada); 1 repositório declarado: a avaliação técnica dos repositórios declarados falha: nenhuma regra é avaliada, a sessão de revisão é orientada a não aprovar e nenhuma aprovação deles sai como limpa, até a ferramenta íntegra ser instalada. Instale no volume, dentro do container e como o usuário do motor: node lib/technical-review/setup.js (docs/HOSPEDAGEM.md).
```

O resumo do log no diagnóstico classifica a linha como "Avaliação técnica sem a ferramenta
íntegra ou com o cadastro ilegível", que não passa sozinha (`lib/log-taxonomy.js`).

### Atualizar quando o pino mudar

A imagem nova traz o `tool.json` novo, e a ferramenta do volume deixa de valer. Versão nova
muda a pasta (`eng-behaviour@<versão>`), e o diagnóstico passa a dizer `ausente`; o mesmo número
de versão com outro commit passa a dizer `nao-comprovada`. Nos dois casos, rode a instalação de
novo, com o mesmo pré-requisito do `gh`. A pasta da versão anterior fica no volume e sai à mão
(`docker exec farol rm -rf ~/.farol/toolchains/eng-behaviour@<versão antiga>`); a do mesmo número
de versão é guardada como `eng-behaviour@<versão>.incomplete-<id>` quando a nova fica pronta, e
também sai à mão. Se o lock da ferramenta mudar de formato, o `pnpm` da imagem muda junto
(`ARG PNPM_VERSION` e `test/imagem-do-motor.test.js`).

### Quando falta uma parte

- **Sem o cadastro, ou com o repositório fora dele**: nenhuma regra do catálogo é avaliada para
  ele, a revisão roda e publica, e toda aprovação leva a ressalva de repositório sem declaração
  técnica: o `onClean` nunca se aplica. Na hora de publicar, a aprovação é conferida contra o
  commit, a prova e o contexto da revisão (`provaEsgotadaRefusal`,
  `lib/technical-review/publication.js`).
- **Com o cadastro e sem a ferramenta íntegra**: para o repositório declarado a avaliação falha
  com a causa `tool`, e nenhuma regra é avaliada. A sessão de revisão recebe "Verificação
  técnica pendente" com a ordem de não concluir pela aprovação (`lib/technical-review/prompt.js`).
  Se a revisão aprovar mesmo assim, a falha vira ressalva da rodada ("execução da avaliação
  técnica não concluída; segue como ressalva desta revisão") e a aprovação sai como com
  ressalvas, nunca como limpa; a publicação a aceita enquanto o perfil e o pino forem os da
  rodada (`test/publicacao-prova-atual.test.js`). PR que estiver na recuperação durável por
  outro motivo fica pausado com "Ferramenta de verificação técnica indisponível"
  (`lib/engine/recuperacao-prova.js`) até a ferramenta voltar. O diagnóstico e o `WARN` do boot
  apontam a instalação.

### A avaliação de verdade, medida

Na prova, dentro do container, sem rede (`--network none`) e com a raiz somente leitura, a
avaliação foi chamada como o runtime a chama (`audit`, que abre o `worker.js` com a ferramenta
instalada, e `finishTechnicalReview`, que monta o relatório que a decisão lê), com o cadastro do
exemplo lido do volume, sobre um repositório de teste em `/tmp` com dois commits (a base com
`src/pedido.ts` e um teste; o head acrescentando `src/cupom.ts`). Resultado, em 320 ms: 15 regras no
relatório; as duas automáticas aplicáveis rodaram e passaram
(`core.javascript.no-nested-ternary` e `core.suppression.declared`); as 13 de julgamento ficaram
`not-run` com a causa `sem-avaliacao`, porque quem as avalia é a sessão do Claude
(`technicalAssessments` no envelope), que a prova não abriu. Nenhum achado. O relatório saiu
`not-run`, a lacuna foi "avaliação técnica inconclusiva" e o resumo da tela, ressalva. Nada foi
gravado fora de `/tmp` e do volume; no volume, só o índice do `git` da ferramenta, que a
conferência de identidade (`git status`) atualiza.

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
  Claude Code) e o Jira da organização, se houver site cadastrado. A instalação da ferramenta
  da avaliação técnica, quando roda, vai a `github.com` (o clone) e a `registry.npmjs.org` (o
  `pnpm install`). Na avaliação de cada PR, o preparo do material usa o mesmo GitHub da
  revisão, e o avaliador (`lib/technical-review/worker.js`) roda sem rede (medido na prova, com
  `--network none`).

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

   **O `~/.profile` do volume é um ponto de persistência.** O motor chama o Claude Code sempre
   por `/bin/sh -lc`: a sessão de revisão (`lib/engine/claude-child.js`), o login da assinatura
   (`lib/engine/login-web.js`) e os comandos de versão, de teste de perfil e de uso do plano
   (`runShell`, `lib/io.js`). O shell de login lê o `/etc/profile` e depois o `~/.profile`, e
   aqui `~` é o volume, gravável pela própria sessão. Uma sessão induzida que grave nesse
   arquivo passa a rodar código em todo shell que o motor abrir dali em diante, inclusive
   depois de reiniciar o container e de trocar a imagem. A imagem não cria esse arquivo, e o
   motor não confere se ele existe. O que mitigaria, sem estar feito: montar por cima um
   `~/.profile` de dono root e somente leitura (um arquivo vazio basta), ou trocar as chamadas
   para um shell sem login, já que na imagem o `claude` está no PATH padrão.

2. **O código de pareamento pode ser queimado por quem não pareou.** `POST /api/auth/pair` é
   pública. Cada tentativa errada conta contra todos os códigos pendentes, e a quinta os tira
   do arquivo (`registrarErro`, `lib/local-auth/pareamento.js`). Quem alcança o proxy consegue,
   com cinco pedidos, invalidar o código que alguém acabou de gerar, e repetir isso impede
   qualquer pareamento novo. Medido na imagem: cinco pedidos sem token, todos com a mesma
   resposta `codigo_invalido`, e o código pendente saiu do disco. Ninguém entra por aí: o código
   tem dez caracteres em base32 (cerca de 50 bits), vale dez minutos e uma vez, e a sessão já
   pareada seguiu valendo. Adivinhar o código não é viável: são cerca de 50 bits, cinco
   tentativas por código e dez minutos. O motor grava uma linha `WARN` no `farol.log` a cada
   bloqueio. Há ainda um sinal lateral: a tentativa errada só grava em disco quando existe
   código pendente (`registrarErro` volta antes de gravar com a lista vazia), então o tempo da
   resposta pode revelar a quem não pareou se há código esperando. É plausível pelo código e
   não foi medido. Não foi corrigido neste lote (ver
   [o que falta](#o-que-não-foi-provado)). Até lá: limite a taxa de `POST /api/auth/pair` no
   proxy, por endereço de origem, e use o código assim que gerar.

3. **A ferramenta da avaliação técnica não acompanha a imagem.** Ela mora no volume e é
   instalada por quem opera ([Avaliação técnica](#avaliação-técnica)). Volume novo, ou imagem
   nova com outro pino em `lib/technical-review/tool.json`, fica sem a ferramenta íntegra até
   alguém rodar `node lib/technical-review/setup.js` no container, e nesse intervalo os
   repositórios cadastrados não têm regra avaliada e nenhuma aprovação deles sai como limpa. O
   diagnóstico e a linha do boot dizem quando isso acontece; nada reinstala sozinho, porque a
   instalação pede o login do `gh` com acesso ao repositório privado.

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
configuração e os perfis no lugar, e a ferramenta da avaliação técnica íntegra. Se a imagem nova
mudou o pino da ferramenta, reinstale-a ([Atualizar quando o pino mudar](#atualizar-quando-o-pino-mudar)).

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
AWS e o nome do papel são suposições a conferir. O que ele pede além do que está escrito:

- **um gatilho por tag.** O workflow de hoje só dispara em push na `main`, em pull request para
  a `main` e à mão (`workflow_dispatch`): sem `on: push: tags`, a condição `if` do esboço nunca
  é verdadeira;
- **mudar a trava junto, por decisão.** `test/node-runtime.test.js` reprova hoje qualquer
  `id-token: write`, `docker push`, `docker login`, `secrets.` e ação que não seja as duas já
  usadas. O job de publicação muda esse teste no mesmo PR;
- **a confiança do papel na AWS restrita à tag.** A política de confiança do papel deve aceitar
  só o `sub` do OIDC deste repositório em referência de tag
  (`repo:biudtech/farol-biuder:ref:refs/tags/v*`), e não qualquer branch ou pull request;
- **ações fixadas por SHA de commit**, com a versão no comentário, e não por tag móvel. As duas
  que o workflow já usa estão por tag de versão maior.

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
#     - uses: aws-actions/configure-aws-credentials@<SHA do commit>   # vX.Y.Z
#       with:
#         role-to-assume: arn:aws:iam::<conta>:role/<papel-de-push-do-farol>
#         aws-region: <região>
#     - uses: aws-actions/amazon-ecr-login@<SHA do commit>             # vX.Y.Z
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

## Hospedagem compartilhada, sem Docker

Quando não há container (uma hospedagem compartilhada com Node 24, sem root, em que vários
clientes dividem a máquina), o motor e o front rodam como processos do usuário da hospedagem e
escutam em **sockets Unix**, não em portas. Ali a porta em `127.0.0.1` é alcançável por qualquer
usuário da máquina; o socket com permissão 600 só pelo próprio usuário. Um proxy da hospedagem
(por exemplo, um app Node atrás do servidor web, com o login que a hospedagem oferecer) recebe o
`https://` público e encaminha para os dois sockets, na **mesma origem**:

| caminho público | vai para |
|---|---|
| `/api/*` | o socket do motor (`socket` no `config.json`) |
| todo o resto | o socket do front (`FAROL_WEB_SOCKET`, `npm run start:socket`) |

Nos exemplos, `<base>` é a pasta do usuário da hospedagem e `farol.exemplo.invalid` o domínio
público: troque pelos de verdade, que não se versionam.

**As pastas.** Os dados do motor em `<base>/dados` e os sockets em `<base>/run`, as duas com
modo 700. O motor e o front recusam socket numa pasta que não existe ou que o grupo ou os
outros gravam: quem grava na pasta troca o socket por outro e recebe os pedidos do proxy.

**O motor.** Rode `node server.js` com `HOME=<base>/dados` e sem `FAROL_HOME`. Assim os dados
ficam em `<base>/dados/.farol` (`lib/paths.js` resolve o `~/.farol` pelo `HOME`), o login do
`gh` e o `~/.claude.json` ficam na mesma pasta, e a instância não conta como isolada: com
`FAROL_HOME` fora do `~/.farol` ela não postaria no GitHub
([instância isolada](#variáveis-de-ambiente)). Ligue também `FAROL_INSTANCIA_HOSPEDADA=1`, que
recusa a subida sem `config.json` ou sem a fronteira. O `config.json`, em
`<base>/dados/.farol/config.json`, gravado antes da primeira subida:

```json
{
  "socket": "<base>/run/motor.sock",
  "hostPublico": "farol.exemplo.invalid",
  "origensPermitidas": ["https://farol.exemplo.invalid"],
  "localAuth": "exigir",
  "conta": { "autoReview": false, "onClean": "wait", "onCaveats": "wait", "onReject": "wait" }
}
```

- `socket`: o motor escuta **só** no socket, com permissão 600, e a porta TCP não abre. A trava
  de instância única continua valendo: socket em uso por um processo vivo recusa a subida; o
  arquivo órfão de uma queda (ninguém escuta nele) é removido e o motor sobe; o que não é socket
  naquele caminho nunca é apagado. Na saída ordenada (SIGTERM, SIGINT, SIGHUP) o socket é
  removido. O caminho tem de ser absoluto e caber em 107 bytes (o limite de socket Unix do
  Linux). `socket` com `bind` é recusa de boot: com socket não há porta, e o `bind` escrito
  espera uma;
- `hostPublico`: **obrigatório com `socket`** (sem ele o motor não sobe). Pelo socket não há
  porta nem endereço de origem, e o motor aceita só o Host público que o proxy repassa; nenhum
  nome de loopback (`localhost`, `127.0.0.1:<porta>`) vale ali. Com ele a autenticação é sempre
  exigida;
- `origensPermitidas` com a própria origem pública: o navegador manda `Origin` nos `POST`, mesmo
  na mesma origem, e o motor só aceita origem escrita na lista. A resposta ganha os cabeçalhos
  CORS dessa origem, o que na mesma origem não muda nada;
- `conta` em espera: a primeira subida monitora e não posta nada sozinha
  ([receita](CONFIGURATION.md#receita-da-instância-que-sobe-sem-agir)).

Pareie com `HOME=<base>/dados node tools/farol-parear.js` (o mesmo `HOME` do motor). Para olhar
a API pelo socket, sem o proxy: `curl --unix-socket <base>/run/motor.sock -H 'Host:
farol.exemplo.invalid' http://farol.exemplo.invalid/api/auth/status`.

**O front.** O endereço do motor é lido no build e, na mesma origem, é a própria origem
pública:

```sh
cd web
npm ci
NEXT_PUBLIC_FAROL_API=https://farol.exemplo.invalid npm run build
FAROL_WEB_SOCKET=<base>/run/web.sock npm run start:socket
```

`npm run start:socket` (`web/servidor.mjs`) sobe o mesmo handler do `next start`, então a CSP
por nonce de `web/src/proxy.ts` continua saindo, com `connect-src 'self'
https://farol.exemplo.invalid`. O socket segue as regras do motor (600, órfão removido, vivo
recusa, removido no SIGTERM e no SIGINT); sem `FAROL_WEB_SOCKET` o servidor recusa com a
mensagem e `npm start` continua sendo a porta TCP.

**O que o proxy precisa fazer.**

- Repassar `Host` e `Origin` como chegaram do navegador, sem reescrevê-los para o loopback: o
  motor confere o `Host` contra `hostPublico` e o `Origin` contra `origensPermitidas`, e recusa
  com 403 o resto. Repassar também `x-farol`, `Authorization`, `Content-Type` e `Accept`. Um
  proxy que só encaminha deixa o `Authorization: Bearer` do pareamento chegar intacto; um
  portão de login que injeta a credencial é o caso abaixo.
- Não bufferizar o SSE de `GET /api/events` (`text/event-stream`; o motor já manda
  `X-Accel-Buffering: no`) e dar a ele tempo de leitura longo: a conexão fica aberta por horas,
  com um evento de batimento a cada 25 segundos. Com o tempo curto a tela cai e reconecta.
- Não guardar em cache nenhuma resposta de `/api/` (o motor manda `Cache-Control: no-store`).

**A sessão pelo portão.** O proxy pode ser um portão de login (com o login de uma conta do
Google, por exemplo) que dispensa o pareamento: para quem está logado nele, o portão emite uma
sessão do próprio motor (`emitirSessao`, de `lib/local-auth/sessoes.js`, com o mesmo
`FAROL_HOME` do motor) e a injeta como `Authorization: Bearer <token>` em todo pedido que
repassa, sobrescrevendo o que o navegador mandar. O navegador nunca vê esse token. O front
percebe o modo sozinho: sem token guardado, ele pergunta `GET /api/auth/status`, e só entra sem
token quando o motor responde `"exigida": true` e `"autenticado": true` àquele pedido, o que só
acontece com alguém injetando a credencial na frente. Sem portão a resposta é
`"autenticado": false` e o caminho é o pareamento de sempre. O que o portão precisa fazer:

- injetar o Bearer de uma sessão válida do motor em todo pedido de quem está logado, e nunca
  repassar o `Authorization` que vier do navegador;
- reconhecer quem está logado pelo cookie da própria origem (o front, nesse modo, manda o
  cookie da mesma origem; fora dele, não manda cookie nenhum), com `SameSite=Lax` ou mais
  estrito, `Secure` e `HttpOnly`: o cookie passa a valer como credencial;
- bloquear `POST /api/auth/pair` para quem está logado (a sessão já existe);
- responder `401` a pedido de `/api/` sem a sessão dele (o front recarrega a página na raiz uma
  vez por minuto; o segundo `401` dentro desse tempo mostra uma tela com Entrar de novo) e servir
  a página de login em `GET /` para quem não está logado;
- ter `POST /auth/logout`, que revoga a sessão do motor e apaga o cookie. O Sair do front chama
  essa rota (mesma origem, com `x-farol: 1`) e volta à raiz; revogar a sessão atual em Sistema
  faz o mesmo.

A casca do front mostra "Sessão do login da frente" nesse modo, para quem opera não procurar o
pareamento.

## O que não foi provado

- **O login real do `gh`** dentro do container (pede o token da conta revisora) e o motor
  buscando PRs com ele.
- **O login da assinatura até o fim.** A primeira rota devolveu o endereço de autorização; o
  código e a credencial gravada pedem uma conta de verdade.
- **Uma revisão de verdade dentro do container**: sessão headless, leitura das fontes pelo
  `git`, postagem. Nem o uso do plano lido com um login real.
- **O clone da ferramenta da avaliação técnica pelo login do `gh`.** Sem conta logada no
  container, a prova clonou de uma cópia local montada somente leitura. O caminho do
  repositório privado está provado por teste com dublê (os argumentos do `git`, o ambiente
  isolado e o helper do `gh`, sem token em argumento) e, na imagem, até onde vai sem conta: o
  `setup.js` sem login do `gh` chega ao GitHub e sai com a mensagem de sem acesso.
- **As regras de julgamento da avaliação técnica.** A prova executou a ferramenta de verdade,
  sem rede, e só as regras automáticas rodaram: as de julgamento pedem a avaliação da sessão do
  Claude (`technicalAssessments`), que não foi aberta.
- **O cadastro posto por `kubectl cp`** e o dono que ele deixa num pod.
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
- **Fechar o `~/.profile` do volume** (risco 1).
