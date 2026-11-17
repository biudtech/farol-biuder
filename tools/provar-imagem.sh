#!/usr/bin/env bash
# Prova a imagem do motor com o container de pé: é o que o job `imagem` do CI roda depois do
# build, e roda igual numa máquina com Docker.
#
#   bash tools/provar-imagem.sh <imagem>        (padrão: farol-biuder-motor:dev)
#
# Confere, com o config.json de exemplo de docs/exemplos e a raiz do container somente leitura:
#   - o processo não é root;
#   - GET /api/health responde 200, GET / responde 404 em JSON e GET /api/state sem token, 401;
#   - a sonda da imagem (HEALTHCHECK) fica "healthy";
#   - `docker stop` encerra o motor com código 0;
#   - as três recusas da instância hospedada: sem config.json, config que não exige
#     autenticação e config sem hostPublico nem origensPermitidas. Em cada uma o container sai
#     com código 1, diz o motivo, e o config.json fica como estava.
#
# Não publica nada, não usa registro e não precisa de segredo. Os pedidos HTTP saem de dentro do
# container (docker exec com o Node da imagem), então não há porta publicada.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # no Git Bash, impede a conversão dos caminhos do container

IMAGEM="${1:-farol-biuder-motor:dev}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
EXEMPLO="$RAIZ/docs/exemplos/config.hospedagem.exemplo.json"
SUFIXO="$$-$(date +%s)"
CONTAINER="farol-prova-ci-$SUFIXO"
VOLUME="farol-prova-ci-$SUFIXO"
VOLUME_DA_RECUSA="farol-prova-ci-recusa-$SUFIXO"
SAIDA="$(mktemp)"

limpar() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" "$VOLUME_DA_RECUSA" >/dev/null 2>&1 || true
  rm -f "$SAIDA"
}
trap limpar EXIT

falhou() { echo "FALHOU: $*" >&2; exit 1; }
passou() { echo "ok: $*"; }

# Grava o config.json (lido da entrada padrão) num volume novo, como o usuário do motor.
gravar_config() {
  docker volume create "$1" >/dev/null
  docker run --rm -i -v "$1:/home/farol" --entrypoint sh "$IMAGEM" -c 'umask 077; mkdir -p "$HOME/.farol" && cat > "$HOME/.farol/config.json"'
}

hash_do_config() {
  docker run --rm -v "$1:/home/farol" --entrypoint sh "$IMAGEM" -c 'sha256sum "$HOME/.farol/config.json" | cut -d" " -f1'
}

# Um GET de dentro do container. Imprime "<status> <content-type> <corpo>".
pedir() {
  docker exec "$CONTAINER" node -e '
    fetch("http://127.0.0.1:47170" + process.argv[1], { signal: AbortSignal.timeout(5000) })
      .then(async (r) => console.log(r.status, r.headers.get("content-type"), await r.text()))
      .catch((e) => { console.log("erro", e.message); process.exit(1); });
  ' "$1"
}

esperar() { # $1 = o que esperar, $2 = comando que diz se chegou
  for _ in $(seq 1 60); do
    if eval "$2"; then return 0; fi
    [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" = "true" ] || { docker logs "$CONTAINER" >&2; falhou "o container saiu antes de $1"; }
    sleep 2
  done
  docker logs "$CONTAINER" >&2
  falhou "passou o prazo esperando $1"
}

echo "== imagem: $IMAGEM"
USUARIO="$(docker image inspect --format '{{.Config.User}}' "$IMAGEM")"
case "$USUARIO" in ''|0|0:*|root|root:*) falhou "a imagem roda como root (USER=$USUARIO)";; esac
passou "USER da imagem é $USUARIO"

echo "== sobe com o config.json de exemplo, raiz somente leitura"
gravar_config "$VOLUME" < "$EXEMPLO"
docker run -d --name "$CONTAINER" --read-only --tmpfs /tmp -v "$VOLUME:/home/farol" "$IMAGEM" >/dev/null
esperar "o motor escutar" 'docker logs "$CONTAINER" 2>&1 | grep -q "\[farol\] monitorando"'
UID_DO_PROCESSO="$(docker exec "$CONTAINER" id -u)"
[ "$UID_DO_PROCESSO" != "0" ] || falhou "o processo roda com uid 0"
passou "o motor subiu com uid $UID_DO_PROCESSO"

RESPOSTA="$(pedir /api/health)"
[ "$RESPOSTA" = '200 application/json {"ok":true}' ] || falhou "GET /api/health respondeu: $RESPOSTA"
passou "GET /api/health -> $RESPOSTA"
RESPOSTA="$(pedir /)"
[ "$RESPOSTA" = '404 application/json {"error":"not found"}' ] || falhou "GET / respondeu: $RESPOSTA"
passou "GET / -> $RESPOSTA"
RESPOSTA="$(pedir /api/state)"
[ "$RESPOSTA" = '401 application/json {"error":"nao_autenticado"}' ] || falhou "GET /api/state sem token respondeu: $RESPOSTA"
passou "GET /api/state sem token -> $RESPOSTA"

esperar "a sonda ficar healthy" '[ "$(docker inspect --format "{{.State.Health.Status}}" "$CONTAINER")" = "healthy" ]'
passou "HEALTHCHECK healthy"

docker stop --time 20 "$CONTAINER" >/dev/null
CODIGO="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER")"
[ "$CODIGO" = "0" ] || falhou "docker stop: o motor saiu com código $CODIGO (o SIGTERM não foi tratado)"
passou "docker stop -> código 0"
docker rm "$CONTAINER" >/dev/null

# Roda o motor esperando a recusa: código 1, a mensagem esperada, e nenhum "monitorando".
recusa() { # $1 = rótulo, $2 = trecho esperado da mensagem, o resto = argumentos do docker run
  local rotulo="$1" esperado="$2" codigo=0
  shift 2
  docker run --rm --read-only --tmpfs /tmp "$@" "$IMAGEM" >"$SAIDA" 2>&1 || codigo=$?
  [ "$codigo" = "1" ] || { cat "$SAIDA" >&2; falhou "$rotulo: código de saída $codigo, esperado 1"; }
  grep -qF "$esperado" "$SAIDA" || { cat "$SAIDA" >&2; falhou "$rotulo: a mensagem não traz \"$esperado\""; }
  if grep -q "monitorando" "$SAIDA"; then falhou "$rotulo: o motor subiu"; fi
  passou "$rotulo -> código 1: $(head -n 1 "$SAIDA" | cut -c1-110)..."
}

# O mesmo, com um config.json dado: além da recusa, o arquivo fica byte a byte como estava.
recusa_com_config() { # $1 = rótulo, $2 = trecho esperado, $3 = o config.json
  local antes
  docker volume rm "$VOLUME_DA_RECUSA" >/dev/null 2>&1 || true
  printf '%s' "$3" | gravar_config "$VOLUME_DA_RECUSA"
  antes="$(hash_do_config "$VOLUME_DA_RECUSA")"
  recusa "$1" "$2" -v "$VOLUME_DA_RECUSA:/home/farol"
  [ "$(hash_do_config "$VOLUME_DA_RECUSA")" = "$antes" ] || falhou "$1: o config.json foi alterado"
}

echo "== as recusas da instância hospedada"
recusa "sem config.json (volume vazio)" 'o motor não sobe: não há config.json em /home/farol/.farol/config.json'
recusa_com_config "config que não exige autenticação" 'o config.json não exige autenticação na API' \
  '{"port":47170,"conta":{"autoReview":false,"onClean":"wait","onCaveats":"wait","onReject":"wait"}}'
recusa_com_config "config sem hostPublico nem origensPermitidas" 'o config.json não define "hostPublico" nem "origensPermitidas"' \
  '{"bind":"0.0.0.0","localAuth":"exigir"}'

echo "imagem provada: $IMAGEM"
