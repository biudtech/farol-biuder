# Imagem do motor do Farol BIUD (docs/HOSPEDAGEM.md). Só o motor: o front de web/ vai para a
# Vercel e não entra aqui. Uma réplica, com o volume de dados em /home/farol.
#
# As versões ficam nestes ARG, e trocar uma delas é reconstruir a imagem. De onde veio cada uma:
#   NODE_VERSION e NODE_DIGEST  o contrato do package.json (engines.node) e do .nvmrc; o digest é o do
#                               índice multiarquitetura de node:24.22.1-bookworm-slim, lido com
#                               "docker buildx imagetools inspect" em 16/11/2026
#   GH_VERSION                 o pacote gh do repositório apt oficial (cli.github.com/packages)
#   GH_KEYRING_SHA256           o sha256 do chaveiro desse repositório; as chaves dentro dele são
#                               2C6106201985B60E6C7AC87323F3D4EA75716059 (de 2022, vencida em 09/2026) e
#                               7F38BBB59D064DBCB3D84D725612B36462313325 (de 2026). Chaveiro diferente
#                               quebra o build de propósito: confira as chaves antes de trocar o hash
#   CLAUDE_CODE_VERSION         o pacote npm @anthropic-ai/claude-code, o mesmo que o motor consulta
#                               para dizer se o CLI está atrasado (lib/engine/versao-claude.js)
#   PNPM_VERSION                o pacote npm pnpm, que constrói a ferramenta da avaliação técnica
#                               (lib/technical-review/tool.json). O package.json da ferramenta no
#                               commit do pino não declara packageManager, e o pnpm-lock.yaml dele
#                               é lockfileVersion 9.0, o formato que o pnpm 10 lê e escreve. É a
#                               última da linha 10 (de 25/10/2026); a cópia de trabalho da
#                               ferramenta foi instalada com a 10.32.1, da mesma linha
# O git NÃO tem versão fixada: é o do Debian 12 (bookworm) no dia do build. Fixar o patch do
# Debian quebraria o build no dia em que o Debian trocasse o pacote por uma correção, que é
# justamente a versão que se quer. A versão que entrou fica escrita em /etc/farol-versoes, que
# tools/provar-imagem.sh imprime.
# O motor não exige versão mínima de git, de gh nem do Claude Code: o diagnóstico confere que
# existem e avisa quando o Claude Code fica mais de três dias atrás da última versão publicada.
ARG NODE_VERSION=24.22.1
ARG NODE_DIGEST=sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_DIGEST}

ARG GH_VERSION=2.105.0
ARG GH_SHA256_AMD64=79e7ab5db738c48777b696e374f8b428f0647debfb424f44d2f426370407fe2f
ARG GH_SHA256_ARM64=b1278c75107423d818f1937fd92cafc9e5e9b606631568f68d7fb816f5885a02
ARG CLAUDE_CODE_VERSION=2.1.326
ARG PNPM_VERSION=10.34.9
ARG FAROL_UID=10001
ARG FAROL_GID=10001

# gh com a versão fixada e git na versão do Debian da base. O gh vem do pacote da release no
# GitHub (o repositório apt oficial só mantém a versão mais nova, e o pino quebrava a cada
# lançamento), baixado com o próprio Node (a imagem não tem curl) e conferido contra o sha256
# da arquitetura, tirado do gh_<versão>_checksums.txt da release, antes de ser extraído.
# Os pacotes de apoio também vêm do Debian, sem versão fixada: ca-certificates (TLS do git),
# procps (o motor chama "ps" para saber se um processo de fonte ainda vive), tini (o init, veja
# o ENTRYPOINT) e tzdata (o fuso, veja TZ).
# O "apt-get upgrade" traz as correções de segurança que o Debian publicou depois do digest da
# base (em 16/11/2026 eram duas, apt e libapt-pkg6.0): a imagem não nasce com atualização de
# segurança pendente, ao custo de os pacotes do sistema dependerem do dia do build.
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get upgrade -y --no-install-recommends; \
    apt-get install -y --no-install-recommends ca-certificates git procps tini tzdata; \
    rm -rf /var/lib/apt/lists/*; \
    case "$(dpkg --print-architecture)" in \
      amd64) GH_ARCH=amd64; GH_SHA256="${GH_SHA256_AMD64}" ;; \
      arm64) GH_ARCH=arm64; GH_SHA256="${GH_SHA256_ARM64}" ;; \
      *) echo "arquitetura sem gh conferido"; exit 1 ;; \
    esac; \
    GH_TGZ="/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"; \
    GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz" \
      GH_TGZ="${GH_TGZ}" node -e "fetch(process.env.GH_URL).then((r) => { if (!r.ok) throw new Error('pacote do gh: HTTP ' + r.status); return r.arrayBuffer(); }).then((b) => require('node:fs').writeFileSync(process.env.GH_TGZ, Buffer.from(b)))"; \
    echo "${GH_SHA256}  ${GH_TGZ}" | sha256sum -c -; \
    tar -xzf "${GH_TGZ}" -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" /usr/local/bin/gh; \
    rm -rf "${GH_TGZ}" "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}"; \
    git --version; \
    gh --version

# O Claude Code, pelo pacote npm e na versão exata, em /usr/local/bin: é onde o "/bin/sh -lc" do
# motor o acha (o /etc/profile do Debian repõe o PATH). O instalador nativo o poria em
# ~/.local/bin, que aqui é o volume, e não a imagem.
# O pnpm, também pelo npm, na versão exata e em /usr/local/bin. Não pelo corepack: ele baixa o
# gerenciador na primeira chamada, já dentro do container e da rede de produção, para o cache do
# volume, e confere a assinatura contra chaves embutidas no Node, que envelhecem; aqui a versão
# entra no build e a prova da imagem a confere. O pnpm serve à instalação da ferramenta da
# avaliação técnica, que é feita depois, no volume, por um passo explícito de quem opera
# (docs/HOSPEDAGEM.md): o código dela é privado e não entra na imagem. A construção não pede
# compilador nem python: nenhuma dependência do lock tem módulo nativo para compilar (os
# binários do rollup e do esbuild vêm prontos, por plataforma), e o pnpm 10 não roda script de
# instalação de dependência que não esteja numa lista de permissão.
RUN set -eux; \
    npm install --global --no-fund --no-audit --no-update-notifier "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "pnpm@${PNPM_VERSION}"; \
    # O postinstall do Claude Code é o que põe o binário nativo no lugar. O npm passou a pular
    # script de instalação fora de uma lista de permissão (aviso "install-scripts", visto no CI em
    # 17/11/2026), e aí o "claude" falha com "native binary not installed". O script roda aqui de
    # forma explícita, e só o dele: a versão é a fixada acima.
    node "$(npm root --global)/@anthropic-ai/claude-code/install.cjs"; \
    npm cache clean --force; \
    rm -rf /root/.npm /root/.cache /tmp/*; \
    claude --version | grep -F "${CLAUDE_CODE_VERSION}"; \
    test "$(pnpm --version)" = "${PNPM_VERSION}"; \
    { echo "node $(node --version)"; git --version; gh --version | head -n 1; echo "claude $(claude --version)"; echo "pnpm $(pnpm --version)"; } > /etc/farol-versoes; \
    chmod 0644 /etc/farol-versoes; \
    cat /etc/farol-versoes

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
COPY tools/farol-parear.js tools/jira-mcp.js tools/diagnosticar-legados.js tools/
RUN chmod -R a+rX,go-w /opt/farol

# HOME é o volume inteiro, e não só ~/.farol: o motor grava ~/.claude.json, o gh grava
# ~/.config/gh, e o Claude Code grava ~/.claude e ~/.cache. FAROL_HOME fica no padrão (~/.farol)
# de propósito: outro valor liga a instância isolada, que não escreve no GitHub.
# FAROL_INSTANCIA_HOSPEDADA=1 faz o boot recusar volume sem config.json, config sem autenticação
# exigida e config sem hostPublico nem origensPermitidas (lib/instancia-hospedada.js).
# TZ: o motor corta o dia do consumo e mostra horas no fuso do processo; sem TZ seria UTC.
# DISABLE_AUTOUPDATER: o Claude Code não tenta se atualizar; a versão é a da imagem.
# NODE_ENV fica de fora de propósito: o motor não a lê, e "production" faria o pnpm da
# ferramenta da avaliação técnica deixar de instalar as dependências de desenvolvimento.
# XDG_DATA_HOME, XDG_CACHE_HOME e XDG_STATE_HOME: a loja de pacotes, o cache e o estado do pnpm,
# na instalação da ferramenta, ficam no volume, que é o que a raiz somente leitura deixa
# gravar. Os valores são os padrões do HOME, escritos por extenso: o gh e o Claude Code
# continuam gravando onde já gravavam. A loja no mesmo volume da ferramenta deixa o pnpm ligar
# os arquivos em vez de copiar; os temporários vão para o os.tmpdir() do Node, /tmp.
# npm_config_update_notifier=false: nem o pnpm nem o npm vão ao registro atrás de versão nova.
ENV HOME=/home/farol \
    FAROL_HOME=/home/farol/.farol \
    FAROL_INSTANCIA_HOSPEDADA=1 \
    TZ=America/Sao_Paulo \
    DISABLE_AUTOUPDATER=1 \
    XDG_DATA_HOME=/home/farol/.local/share \
    XDG_CACHE_HOME=/home/farol/.cache \
    XDG_STATE_HOME=/home/farol/.local/state \
    npm_config_update_notifier=false

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
