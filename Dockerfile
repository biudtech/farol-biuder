# Imagem do motor do Farol BIUD (docs/HOSPEDAGEM.md). Só o motor: o front de web/ vai para a
# Vercel e não entra aqui. Uma réplica, com o volume de dados em /home/farol.
#
# As versões ficam nestes ARG, e trocar uma delas é reconstruir a imagem. De onde veio cada uma:
#   NODE_VERSION e NODE_DIGEST  o contrato do package.json (engines.node) e do .nvmrc; o digest é o do
#                               índice multiarquitetura de node:24.22.1-bookworm-slim, lido com
#                               "docker buildx imagetools inspect" em 16/11/2026
#   GIT_VERSION                 o pacote git do Debian 12 (bookworm) naquela data
#   GH_VERSION                  o pacote gh do repositório apt oficial (cli.github.com/packages)
#   GH_KEYRING_SHA256           o sha256 do chaveiro desse repositório; as chaves dentro dele são
#                               2C6106201985B60E6C7AC87323F3D4EA75716059 (de 2022, vencida em 09/2026) e
#                               7F38BBB59D064DBCB3D84D725612B36462313325 (de 2026). Chaveiro diferente
#                               quebra o build de propósito: confira as chaves antes de trocar o hash
#   CLAUDE_CODE_VERSION         o pacote npm @anthropic-ai/claude-code, o mesmo que o motor consulta
#                               para dizer se o CLI está atrasado (lib/engine/versao-claude.js)
# O motor não exige versão mínima de git, de gh nem do Claude Code: o diagnóstico confere que
# existem e avisa quando o Claude Code fica mais de três dias atrás da última versão publicada.
ARG NODE_VERSION=24.22.1
ARG NODE_DIGEST=sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_DIGEST}

ARG GIT_VERSION=1:2.39.5-0+deb12u3
ARG GH_VERSION=2.104.0
ARG GH_KEYRING_SHA256=6084d5d7bd8e288441e0e94fc6275570895da18e6751f70f057485dc2d1a811b
ARG CLAUDE_CODE_VERSION=2.1.326
ARG FAROL_UID=10001
ARG FAROL_GID=10001

# git e gh com a versão fixada. O chaveiro do repositório do gh é baixado com o próprio Node (a
# imagem não tem curl) e conferido contra o sha256 acima antes de o apt confiar nele.
# Os pacotes de apoio vêm do Debian da base, sem versão fixada: ca-certificates (TLS do git),
# procps (o motor chama "ps" para saber se um processo de fonte ainda vive), tini (o init, veja
# o ENTRYPOINT) e tzdata (o fuso, veja TZ).
# O "apt-get upgrade" traz as correções de segurança que o Debian publicou depois do digest da
# base (em 16/11/2026 eram duas, apt e libapt-pkg6.0): a imagem não nasce com atualização de
# segurança pendente, ao custo de os pacotes do sistema dependerem do dia do build.
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get upgrade -y --no-install-recommends; \
    apt-get install -y --no-install-recommends ca-certificates "git=${GIT_VERSION}" procps tini tzdata; \
    install -d -m 0755 /etc/apt/keyrings; \
    node -e "fetch('https://cli.github.com/packages/githubcli-archive-keyring.gpg').then((r) => { if (!r.ok) throw new Error('chaveiro do gh: HTTP ' + r.status); return r.arrayBuffer(); }).then((b) => require('node:fs').writeFileSync('/etc/apt/keyrings/githubcli-archive-keyring.gpg', Buffer.from(b)))"; \
    echo "${GH_KEYRING_SHA256}  /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c -; \
    chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "gh=${GH_VERSION}"; \
    rm -rf /var/lib/apt/lists/*; \
    git --version; \
    gh --version

# O Claude Code, pelo pacote npm e na versão exata, em /usr/local/bin: é onde o "/bin/sh -lc" do
# motor o acha (o /etc/profile do Debian repõe o PATH). O instalador nativo o poria em
# ~/.local/bin, que aqui é o volume, e não a imagem.
RUN set -eux; \
    npm install --global --no-fund --no-audit --no-update-notifier "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    npm cache clean --force; \
    rm -rf /root/.npm /tmp/*; \
    claude --version | grep -F "${CLAUDE_CODE_VERSION}"

# Usuário comum com UID e GID fixos: com uid 0 o Claude Code recusa a revisão headless. O HOME
# dele é o volume, e nasce vazio e só dele.
RUN set -eux; \
    groupadd --gid "${FAROL_GID}" farol; \
    useradd --uid "${FAROL_UID}" --gid "${FAROL_GID}" --home-dir /home/farol --no-create-home --shell /usr/sbin/nologin farol; \
    install -d -m 0700 -o farol -g farol /home/farol

# Só o que o motor lê em execução. O código fica do root e ninguém mais escreve nele: o motor
# não grava na pasta do código (CLAUDE.md, invariante 2).
WORKDIR /opt/farol
COPY package.json server.js LICENSE ./
COPY lib/ lib/
COPY workspace-template/ workspace-template/
COPY assets/third-party/babel-parser/ assets/third-party/babel-parser/
COPY tools/farol-parear.js tools/jira-mcp.js tools/diagnosticar-legados.js tools/simular-politica.js tools/
RUN chmod -R a+rX,go-w /opt/farol

# HOME é o volume inteiro, e não só ~/.farol: o motor grava ~/.claude.json, o gh grava
# ~/.config/gh, e o Claude Code grava ~/.claude e ~/.cache. FAROL_HOME fica no padrão (~/.farol)
# de propósito: outro valor liga a instância isolada, que não escreve no GitHub.
# FAROL_INSTANCIA_HOSPEDADA=1 faz o boot recusar volume sem config.json, config sem autenticação
# exigida e config sem hostPublico nem origensPermitidas (lib/instancia-hospedada.js).
# TZ: o motor corta o dia do consumo e mostra horas no fuso do processo; sem TZ seria UTC.
# DISABLE_AUTOUPDATER: o Claude Code não tenta se atualizar; a versão é a da imagem.
ENV NODE_ENV=production \
    HOME=/home/farol \
    FAROL_HOME=/home/farol/.farol \
    FAROL_INSTANCIA_HOSPEDADA=1 \
    TZ=America/Sao_Paulo \
    DISABLE_AUTOUPDATER=1

ARG FAROL_VERSAO=0.0.0-dev
ARG FAROL_REVISAO=desconhecida
ARG FAROL_FONTE=https://github.com/biudtech/farol-biuder
ARG FAROL_CRIADA_EM=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="farol-biuder-motor" \
      org.opencontainers.image.description="Motor do Farol BIUD: revisor autônomo de pull requests (API HTTP e SSE)" \
      org.opencontainers.image.source="${FAROL_FONTE}" \
      org.opencontainers.image.revision="${FAROL_REVISAO}" \
      org.opencontainers.image.version="${FAROL_VERSAO}" \
      org.opencontainers.image.created="${FAROL_CRIADA_EM}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="BIUD"

USER ${FAROL_UID}:${FAROL_GID}
VOLUME ["/home/farol"]
# a porta padrão do motor; quem trocar "port" no config.json troca também a sonda abaixo
EXPOSE 47170
STOPSIGNAL SIGTERM

# A sonda é a rota pública de saúde, pelo próprio Node (a imagem não tem curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:47170/api/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# tini é o PID 1: repassa o SIGTERM ao motor, que encerra com código 0, e recolhe os processos
# órfãos. O motor mata a árvore da sessão de revisão com SIGKILL no grupo (cancelamento e prazo);
# os netos que sobram são adotados pelo PID 1, e o Node como PID 1 não os recolhe: viram zumbis
# até o container reiniciar.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
