#!/usr/bin/env bash
# Prova a imagem do motor com o container de pé: é o que o job `imagem` do CI roda depois do
# build, e roda igual numa máquina com Docker.
#
#   bash tools/provar-imagem.sh <imagem>        (padrão: farol-biuder-motor:dev)
#
# Imprime as versões gravadas na imagem (/etc/farol-versoes) e confere, com o config.json de
# exemplo de docs/exemplos e a raiz do container somente leitura:
#   - o processo não é root;
#   - GET /api/health responde 200, GET / responde 404 em JSON e GET /api/state sem token, 401;
#   - a sonda da imagem (HEALTHCHECK) fica "healthy";
#   - `docker stop` encerra o motor com código 0;
#   - as três recusas da instância hospedada: sem config.json, config que não exige
#     autenticação e config sem hostPublico nem origensPermitidas. Em cada uma o container sai
#     com código 1 em até um minuto e diz o motivo; com config.json, o arquivo fica como estava;
#     sem config.json, o volume continua vazio.
#
# Não publica nada, não usa registro e não precisa de segredo. Os pedidos HTTP saem de dentro do
# container (docker exec com o Node da imagem), então não há porta publicada.
#
# Nenhum erro é engolido: fora da limpeza do fim (que roda também quando algo já falhou), todo
# comando que falha derruba o script, e cada conferência diz o que esperava.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # no Git Bash, impede a conversão dos caminhos do container

IMAGEM="${1:-farol-biuder-motor:dev}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
EXEMPLO="$RAIZ/docs/exemplos/config.hospedagem.exemplo.json"
SUFIXO="$$-$(date +%s)"
CONTAINER="farol-prova-ci-$SUFIXO"
CONTAINER_DA_RECUSA="farol-prova-ci-recusa-$SUFIXO"
VOLUME="farol-prova-ci-$SUFIXO"
VOLUME_DA_RECUSA="farol-prova-ci-recusa-$SUFIXO"
PRAZO_DA_RECUSA=60
SAIDA="$(mktemp)"

# A limpeza do fim: roda em qualquer saída, inclusive depois de uma falha, quando parte do que
# ela remove pode nem ter sido criada. Só aqui a falha de um comando é tolerada.
limpar() {
  docker rm -f "$CONTAINER" "$CONTAINER_DA_RECUSA" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" "$VOLUME_DA_RECUSA" >/dev/null 2>&1 || true
  rm -f "$SAIDA"
}
trap limpar EXIT

falhou() { echo "FALHOU: $*" >&2; exit 1; }
passou() { echo "ok: $*"; }

# Grava o config.json (lido da entrada padrão) no volume dado, como o usuário do motor.
gravar_config() {
  docker run --rm -i -v "$1:/home/farol" --entrypoint sh "$IMAGEM" -c 'umask 077; mkdir -p "$HOME/.farol" && cat > "$HOME/.farol/config.json"'
}

hash_do_config() {
  docker run --rm -v "$1:/home/farol" --entrypoint sh "$IMAGEM" -c 'sha256sum "$HOME/.farol/config.json" | cut -d" " -f1'
}

# O que há no volume, um caminho por linha (vazio: nada).
conteudo_do_volume() {
  docker run --rm -v "$1:/home/farol" --entrypoint sh "$IMAGEM" -c 'cd "$HOME" && find . -mindepth 1 | sort'
}

# Um GET de dentro do container. Imprime "<status> <content-type> <corpo>".
pedir() {
  docker exec "$CONTAINER" node -e '
    fetch("http://127.0.0.1:47170" + process.argv[1], { signal: AbortSignal.timeout(5000) })
      .then(async (r) => console.log(r.status, r.headers.get("content-type"), await r.text()))
      .catch((e) => { console.log("erro", e.message); process.exit(1); });
  ' "$1"
}

conferir_resposta() { # $1 = caminho, $2 = a resposta esperada, inteira
  local resposta
  resposta="$(pedir "$1")" || falhou "GET $1 não respondeu: $resposta"
  [ "$resposta" = "$2" ] || falhou "GET $1 respondeu \"$resposta\", esperado \"$2\""
  passou "GET $1 -> $resposta"
}

motor_escutando() {
  local saida
  saida="$(docker logs "$CONTAINER" 2>&1)"
  [[ "$saida" == *"[farol] monitorando"* ]]
}

sonda_saudavel() {
  local estado
  estado="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER")"
  [ "$estado" = "healthy" ]
}

esperar() { # $1 = o que se espera (texto), $2 = a função que diz se chegou
  local rodando
  for _ in $(seq 1 60); do
    if "$2"; then return 0; fi
    rodando="$(docker inspect --format '{{.State.Running}}' "$CONTAINER")"
    if [ "$rodando" != "true" ]; then
      docker logs "$CONTAINER" >&2
      falhou "o container saiu antes de $1"
    fi
    sleep 2
  done
  docker logs "$CONTAINER" >&2
  falhou "passou o prazo esperando $1"
}

echo "== imagem: $IMAGEM"
USUARIO="$(docker image inspect --format '{{.Config.User}}' "$IMAGEM")"
case "$USUARIO" in ''|0|0:*|root|root:*) falhou "a imagem roda como root (USER=$USUARIO)";; esac
passou "USER da imagem é $USUARIO"
echo "== versões gravadas na imagem (/etc/farol-versoes)"
docker run --rm --entrypoint cat "$IMAGEM" /etc/farol-versoes

echo "== sobe com o config.json de exemplo, raiz somente leitura"
docker volume create "$VOLUME" >/dev/null
gravar_config "$VOLUME" < "$EXEMPLO"
docker run -d --name "$CONTAINER" --read-only --tmpfs /tmp -v "$VOLUME:/home/farol" "$IMAGEM" >/dev/null
esperar "o motor escutar" motor_escutando
UID_DO_PROCESSO="$(docker exec "$CONTAINER" id -u)"
[ "$UID_DO_PROCESSO" != "0" ] || falhou "o processo roda com uid 0"
passou "o motor subiu com uid $UID_DO_PROCESSO"

conferir_resposta /api/health '200 application/json {"ok":true}'
conferir_resposta / '404 application/json {"error":"not found"}'
conferir_resposta /api/state '401 application/json {"error":"nao_autenticado"}'

esperar "a sonda ficar healthy" sonda_saudavel
passou "HEALTHCHECK healthy"

docker stop --time 20 "$CONTAINER" >/dev/null
CODIGO="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER")"
[ "$CODIGO" = "0" ] || falhou "docker stop: o motor saiu com código $CODIGO (o SIGTERM não foi tratado)"
passou "docker stop -> código 0"
docker rm "$CONTAINER" >/dev/null

# Roda o motor sobre o volume da recusa e exige: saída em até PRAZO_DA_RECUSA segundos, código 1
# e a mensagem esperada. Se a recusa regredir e o motor subir, o `timeout` devolve 124, o script
# falha aqui e a limpeza do fim remove o container, que tem nome.
recusa() { # $1 = rótulo, $2 = trecho esperado da mensagem
  local codigo=0
  timeout "$PRAZO_DA_RECUSA" docker run --name "$CONTAINER_DA_RECUSA" --read-only --tmpfs /tmp \
    -v "$VOLUME_DA_RECUSA:/home/farol" "$IMAGEM" >"$SAIDA" 2>&1 || codigo=$?
  if [ "$codigo" = "124" ]; then
    cat "$SAIDA" >&2
    falhou "$1: o motor não saiu em ${PRAZO_DA_RECUSA}s (a recusa regrediu e ele subiu)"
  fi
  if [ "$codigo" != "1" ]; then
    cat "$SAIDA" >&2
    falhou "$1: código de saída $codigo, esperado 1"
  fi
  if ! grep -qF "$2" "$SAIDA"; then
    cat "$SAIDA" >&2
    falhou "$1: a mensagem não traz \"$2\""
  fi
  if grep -qF "[farol] monitorando" "$SAIDA"; then falhou "$1: o motor chegou a subir"; fi
  docker rm "$CONTAINER_DA_RECUSA" >/dev/null
  passou "$1 -> código 1: $(head -n 1 "$SAIDA" | cut -c1-110)..."
}

# Volume da recusa novo e vazio a cada caso.
volume_da_recusa_novo() {
  local existe
  existe="$(docker volume ls -q --filter "name=^${VOLUME_DA_RECUSA}$")"
  if [ -n "$existe" ]; then docker volume rm "$VOLUME_DA_RECUSA" >/dev/null; fi
  docker volume create "$VOLUME_DA_RECUSA" >/dev/null
}

# Sem config.json: além da recusa, o volume continua vazio (nada foi criado nele).
recusa_sem_config() { # $1 = rótulo, $2 = trecho esperado
  local depois
  volume_da_recusa_novo
  recusa "$1" "$2"
  depois="$(conteudo_do_volume "$VOLUME_DA_RECUSA")"
  [ -z "$depois" ] || falhou "$1: a recusa criou no volume: $depois"
  passou "$1: o volume continua vazio"
}

# Com um config.json dado: além da recusa, o arquivo fica byte a byte como estava.
recusa_com_config() { # $1 = rótulo, $2 = trecho esperado, $3 = o config.json
  local antes depois
  volume_da_recusa_novo
  printf '%s' "$3" | gravar_config "$VOLUME_DA_RECUSA"
  antes="$(hash_do_config "$VOLUME_DA_RECUSA")"
  recusa "$1" "$2"
  depois="$(hash_do_config "$VOLUME_DA_RECUSA")"
  [ "$depois" = "$antes" ] || falhou "$1: o config.json foi alterado"
}

echo "== as recusas da instância hospedada"
recusa_sem_config "sem config.json (volume vazio)" 'o motor não sobe: não há config.json em /home/farol/.farol/config.json'
recusa_com_config "config que não exige autenticação" 'o config.json não exige autenticação na API' \
  '{"port":47170,"conta":{"autoReview":false,"onClean":"wait","onCaveats":"wait","onReject":"wait"}}'
recusa_com_config "config sem hostPublico nem origensPermitidas" 'o config.json não define "hostPublico" nem "origensPermitidas"' \
  '{"bind":"0.0.0.0","localAuth":"exigir"}'

echo "imagem provada: $IMAGEM"
