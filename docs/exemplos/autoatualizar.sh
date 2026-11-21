#!/bin/sh
# Põe no ar sozinho cada commit novo da main, na hospedagem compartilhada sem Docker
# (docs/HOSPEDAGEM.md, "A main no ar sozinha"). Não serve ao container: lá quem troca a versão
# é a imagem.
#
# O código vem por git. O front não é construído aqui: o build do Next não cabe no limite de
# threads da hospedagem, então o job pacote-do-front do CI o constrói com o endereço público e
# publica o artefato front-<commit>. O artefato só existe quando o gate, o front e a imagem
# passaram naquele commit: commit sem CI verde nunca entra no ar.
#
# Uso, a cada rodada do agendador (o intervalo é conferido aqui dentro):
#   FAROL_BASE=<base> /bin/sh autoatualizar.sh          confere no máximo a cada 5 minutos
#   FAROL_BASE=<base> /bin/sh autoatualizar.sh --agora  confere sem olhar o intervalo
#
# Espera em <base>: app/ (o clone do repositório, com o front em app/web), run/ com motor.pid,
# web.pid e o socket do motor, log/, e o script que sobe o que estiver parado.
#
# Variáveis: FAROL_BASE (obrigatória), FAROL_DADOS (o HOME do motor, onde mora o login do gh;
# padrão <base>/dados), FAROL_INICIAR (padrão <base>/iniciar.sh), FAROL_MOTOR_SOCKET (padrão
# <base>/run/motor.sock), FAROL_ATUALIZAR_INTERVALO_MIN (padrão 5) e FAROL_NODE_BIN (a pasta do
# node e do npm, quando não estão no PATH).
#
# Revisão em curso não é cortada: com uma sessão do Claude aberta pelo motor, a troca fica para
# a rodada seguinte. Depois de trocar, o motor e o front precisam estar de pé e o motor precisa
# responder /api/health em até um minuto. Se não, tudo volta ao commit anterior (código, .next e
# dependências), o commit recusado vai para run/autoatualizar.recusados e não é tentado de novo:
# o próximo commit da main é.
#
# O log só ganha linha quando a versão muda, quando um commit espera o pacote do CI pela
# primeira vez ou quando algo falha (linha com ERRO). run/autoatualizar.marca é a hora da última
# conferência.
set -u
BASE="${FAROL_BASE:?defina FAROL_BASE com a pasta base da hospedagem}"
DADOS="${FAROL_DADOS:-$BASE/dados}"
APP="$BASE/app"
INICIAR="${FAROL_INICIAR:-$BASE/iniciar.sh}"
SOCKET="${FAROL_MOTOR_SOCKET:-$BASE/run/motor.sock}"
INTERVALO_MIN="${FAROL_ATUALIZAR_INTERVALO_MIN:-5}"
LOG="$BASE/log/autoatualizar.log"
MARCA="$BASE/run/autoatualizar.marca"
TRAVA="$BASE/run/autoatualizar.trava"
RECUSADOS="$BASE/run/autoatualizar.recusados"
AVISADO="$BASE/run/autoatualizar.esperando"

[ -n "${FAROL_NODE_BIN:-}" ] && PATH="$FAROL_NODE_BIN:$PATH"
export PATH="$BASE/bin:$PATH"
# a hospedagem compartilhada limita as threads do usuário: o gh (Go), o git e o npm abrem poucas
export GOMAXPROCS=1 UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1
GIT="git -C $APP -c pack.threads=1 -c index.threads=1"

anotar() { echo "$(date -Iseconds) $*" >>"$LOG"; }
curto() { echo "$1" | cut -c1-8; }

if [ "${1:-}" != "--agora" ] && [ -f "$MARCA" ] && [ -z "$(find "$MARCA" -mmin +"$INTERVALO_MIN" 2>/dev/null)" ]; then
  exit 0
fi

# uma conferência por vez; a trava esquecida por um processo morto sai depois de 30 minutos
if ! mkdir "$TRAVA" 2>/dev/null; then
  [ -n "$(find "$TRAVA" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rmdir "$TRAVA" 2>/dev/null
  exit 0
fi
TMP=""
trap 'rmdir "$TRAVA" 2>/dev/null; [ -n "$TMP" ] && rm -rf "$TMP"' EXIT
touch "$MARCA"

$GIT fetch -q origin main 2>/dev/null || { anotar "ERRO git fetch falhou"; exit 1; }
ATUAL="$($GIT rev-parse HEAD)"
NOVO="$($GIT rev-parse origin/main)"
[ "$ATUAL" = "$NOVO" ] && exit 0
grep -qx "$NOVO" "$RECUSADOS" 2>/dev/null && exit 0
if ! $GIT merge-base --is-ancestor "$ATUAL" "$NOVO"; then
  anotar "ERRO $(curto "$NOVO") não descende do commit no ar $(curto "$ATUAL"): troca manual"
  exit 1
fi

# revisão em curso: a sessão do Claude é filha do motor
MOTOR_PID="$(cat "$BASE/run/motor.pid" 2>/dev/null)"
if [ -n "$MOTOR_PID" ] && ps -o args= --ppid "$MOTOR_PID" 2>/dev/null | grep -q 'output-format stream-json'; then
  exit 0
fi

REPO="$($GIT remote get-url origin | sed 's#.*github\.com[:/]##; s#\.git$##')"
# o artefato só existe quando os três gates passaram naquele commit; commit anterior ao job, ou
# com o CI vermelho, nunca tem, e fica esperando até a main andar
RODADA="$(HOME="$DADOS" timeout 120 gh api "repos/$REPO/actions/artifacts?name=front-$NOVO" \
  --jq '[.artifacts[] | select(.expired == false)][0].workflow_run.id // empty' 2>/dev/null)"
if [ -z "$RODADA" ]; then
  if [ "$(cat "$AVISADO" 2>/dev/null)" != "$NOVO" ]; then
    echo "$NOVO" >"$AVISADO"
    anotar "$(curto "$NOVO") espera o CI verde e o pacote do front"
  fi
  exit 0
fi
TMP="$(mktemp -d)"
if ! HOME="$DADOS" timeout 300 gh run download "$RODADA" --repo "$REPO" -n "front-$NOVO" -D "$TMP" >/dev/null 2>&1 \
  || ! tar -xzf "$TMP/front.tgz" -C "$TMP" 2>/dev/null \
  || [ "$(cat "$TMP/.next/REVISAO_FAROL" 2>/dev/null)" != "$NOVO" ]; then
  anotar "ERRO o pacote do front de $(curto "$NOVO") não baixou ou não confere com o commit"
  exit 1
fi

DEPS_MUDARAM=0
$GIT diff --quiet "$ATUAL" "$NOVO" -- web/package.json web/package-lock.json || DEPS_MUDARAM=1

dependencias() {
  [ "$DEPS_MUDARAM" = 1 ] || return 0
  (cd "$APP/web" && timeout 900 npm ci --omit=dev --no-audit --no-fund --maxsockets=2 >>"$BASE/log/npm-prod.log" 2>&1)
}
reiniciar() {
  for p in motor web; do kill "$(cat "$BASE/run/$p.pid" 2>/dev/null)" 2>/dev/null; done
  sleep 3
  /bin/sh "$INICIAR" >/dev/null 2>&1
}
de_pe() {
  i=0
  while [ "$i" -lt 12 ]; do
    sleep 5; i=$((i + 1))
    for p in motor web; do kill -0 "$(cat "$BASE/run/$p.pid" 2>/dev/null)" 2>/dev/null || continue 2; done
    curl -s --max-time 5 --unix-socket "$SOCKET" http://localhost/api/health 2>/dev/null | grep -q '"ok":true' && return 0
  done
  return 1
}

rm -rf "$APP/web/.next.antigo"
$GIT merge -q --ff-only "$NOVO" \
  && mv "$APP/web/.next" "$APP/web/.next.antigo" \
  && mv "$TMP/.next" "$APP/web/.next" \
  && dependencias \
  && reiniciar \
  && de_pe
if [ $? -eq 0 ]; then
  rm -rf "$APP/web/.next.antigo"
  anotar "atualizado de $(curto "$ATUAL") para $(curto "$NOVO")"
  exit 0
fi

# volta tudo ao commit anterior e não tenta este de novo
echo "$NOVO" >>"$RECUSADOS"
$GIT reset -q --hard "$ATUAL"
if [ -d "$APP/web/.next.antigo" ]; then
  rm -rf "$APP/web/.next"
  mv "$APP/web/.next.antigo" "$APP/web/.next"
fi
dependencias
reiniciar
if de_pe; then
  anotar "ERRO $(curto "$NOVO") não ficou de pé; voltou para $(curto "$ATUAL") e não será tentado de novo"
else
  anotar "ERRO $(curto "$NOVO") não ficou de pé e a volta para $(curto "$ATUAL") também não: alguém precisa olhar"
fi
exit 1
