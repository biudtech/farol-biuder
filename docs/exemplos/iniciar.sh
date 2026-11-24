#!/bin/sh
# Mantém o motor e o front de pé na hospedagem compartilhada sem Docker (docs/HOSPEDAGEM.md,
# "Hospedagem compartilhada, sem Docker"). Sobe o que estiver parado e não mexe no que está de pé.
# Roda a cada minuto pelo vigia.mjs, pelo cron da hospedagem (reserva, que também religa o vigia) e
# à mão. Sem segredo aqui: as credenciais moram no HOME do motor (gh, Claude) e no config.json.
#
# Uso: /bin/sh <base>/iniciar.sh   (sem variável nenhuma: a base é a pasta deste arquivo)
#
# Espera em <base>: app/ (o clone do repositório, com o front construído em app/web), os scripts
# vizinhos (vigia.mjs, atualizar-claude.sh, autoatualizar.sh, backup-telemetria.mjs), e cria run/
# (modo 700: pids, sockets e marcas) e log/.
#
# O que é da instância vai em <base>/hospedagem.env, lido a cada rodada se existir (shell, sem
# segredo, fora do repositório), para duas variáveis: FAROL_DADOS (o HOME do motor, padrão
# <base>/dados) e FAROL_NODE_BIN (a pasta do node e do npm; padrão a do Node 24 da CloudLinux,
# /opt/alt/alt-nodejs24/root/usr/bin). As duas são exportadas aos scripts que a rodada chama;
# qualquer outro ajuste deles (FAROL_MOTOR_SOCKET, por exemplo) precisa de export no arquivo.
# A base é FAROL_BASE ou a pasta deste arquivo. Exemplo de hospedagem.env:
#   FAROL_DADOS=/home/<usuario>/farol/home
set -u
BASE="${FAROL_BASE:-$(cd "$(dirname "$0")" && pwd)}"
# shellcheck disable=SC1091
[ -f "$BASE/hospedagem.env" ] && . "$BASE/hospedagem.env"
DADOS="${FAROL_DADOS:-$BASE/dados}"
NODE_BIN="${FAROL_NODE_BIN:-/opt/alt/alt-nodejs24/root/usr/bin}"
NODE="$NODE_BIN/node"
export FAROL_BASE="$BASE" FAROL_DADOS="$DADOS" FAROL_NODE_BIN="$NODE_BIN"
export PATH="$BASE/pnpm/bin:$BASE/bin:$DADOS/.local/bin:$NODE_BIN:/usr/local/bin:/usr/bin:/bin"
# A hospedagem limita quantas threads o usuário abre: poucas para o libuv e para o V8.
# A conta divide perto de 1 GB de memória entre todos os apps: o heap do motor e do front fica
# limitado para sobrar espaço aos processos curtos (gh, git, claude), que falham sem memória.
export UV_THREADPOOL_SIZE=2 NODE_OPTIONS="--v8-pool-size=2 --max-old-space-size=96"
# O gh (Go) abre uma thread por núcleo e estoura o limite de processos do usuário: uma só.
export GOMAXPROCS=1
# O binário nativo do Next (SWC) sobe um runtime tokio com uma thread por núcleo (64 numa máquina
# medida): sem este teto o front sozinho esgota o limite de processos e o gh e o git não abrem.
export TOKIO_WORKER_THREADS=2 NEXT_TELEMETRY_DISABLED=1
mkdir -p "$BASE/run" "$BASE/log"
chmod 700 "$BASE/run"

vivo() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# Uma rodada por vez: o vigia e o cron podem chegar juntos, e duas rodadas subiriam dois motores
# (o segundo morre no socket, mas grava o pid dele por cima e o motor real fica sem dono). Com a
# trava ocupada, espera até 20 s antes de desistir: a rodada leva segundos, e o autoatualizar.sh,
# que acabou de parar o motor, conta com esta rodada para subi-lo. A trava esquecida por uma rodada
# morta sai depois de 10 minutos.
TRAVA="$BASE/run/iniciar.trava"
espera=0
until mkdir "$TRAVA" 2>/dev/null; do
  espera=$((espera + 1))
  if [ "$espera" -gt 20 ]; then
    [ -n "$(find "$TRAVA" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rmdir "$TRAVA" 2>/dev/null
    exit 0
  fi
  sleep 1
done
trap 'rmdir "$TRAVA" 2>/dev/null' EXIT
# o TERM do vigia (rodada que passou do teto) vira saída, e a saída solta a trava
trap 'exit 143' TERM INT HUP

# O vigia roda esta rodada a cada minuto, porque o cron da hospedagem roda em intervalos soltos (em
# 21/11/2026 ficou quase uma hora parado e a main nova não entrou no ar). O cron segue como
# reserva: se o vigia cair, a próxima rodada do cron o religa. O vigia é Node: a hospedagem
# encerra o sh de longa duração com uma hora de vida (medido em 24/11/2026).
if ! vivo "$BASE/run/vigia.pid"; then
  nohup setsid "$NODE" "$BASE/vigia.mjs" >/dev/null 2>&1 &
  echo "$(date -Iseconds) vigia iniciado" >>"$BASE/log/iniciar.log"
fi

if ! vivo "$BASE/run/motor.pid"; then
  (
    cd "$BASE/app" || exit 1
    HOME="$DADOS" FAROL_INSTANCIA_HOSPEDADA=1 TZ=America/Sao_Paulo \
      nohup setsid "$NODE" server.js >>"$BASE/log/motor.log" 2>&1 &
    echo $! >"$BASE/run/motor.pid"
  )
  echo "$(date -Iseconds) motor iniciado" >>"$BASE/log/iniciar.log"
fi

if ! vivo "$BASE/run/web.pid"; then
  (
    cd "$BASE/app/web" || exit 1
    # A config já resolvida no build: sem ela o Next transpila o next.config.ts na subida, carrega
    # o binário nativo do SWC e abre as threads do tokio (o TOKIO_WORKER_THREADS não vale ali).
    __NEXT_PRIVATE_STANDALONE_CONFIG="$("$NODE" -e 'process.stdout.write(JSON.stringify(require("./.next/required-server-files.json").config))')" \
    FAROL_WEB_SOCKET="$BASE/run/web.sock" NODE_ENV=production \
      nohup setsid "$NODE" servidor.mjs >>"$BASE/log/web.log" 2>&1 &
    echo $! >"$BASE/run/web.pid"
  )
  echo "$(date -Iseconds) front iniciado" >>"$BASE/log/iniciar.log"
fi

# O Claude Code do motor fica na última versão: o atualizar-claude.sh confere no máximo uma vez
# por hora e sai na hora nas outras rodadas. A marca diz quando a rodada rodou pela última vez.
touch "$BASE/run/cron.ultima"
nohup /bin/sh "$BASE/atualizar-claude.sh" >/dev/null 2>&1 &

# Backup diário do registro (backup-telemetria.mjs, "O backup do registro" no guia). A marca do dia
# (de Brasília) é conferida aqui, no sh: subir um Node a cada minuto só para ele ver que já copiou
# gasta threads, e com uma revisão no pico o Node nem abre (medido em 24/11/2026: falhou o
# uv_thread_create). Cópia que falha não grava a marca e grava run/backup.espera: uma hora sem
# chamar, para a falha não virar uma por minuto. Com uma cópia em curso (a trava dela), também não.
if [ "$(cat "$BASE/run/backup.ultima" 2>/dev/null)" != "$(TZ=America/Sao_Paulo date +%F)" ] &&
  [ -z "$(find "$BASE/run/backup.espera" -mmin -60 2>/dev/null)" ] && [ ! -d "$BASE/run/backup.trava" ]; then
  nohup "$NODE" --no-warnings "$BASE/backup-telemetria.mjs" >/dev/null 2>>"$BASE/log/backup.log" &
fi

# A main no ar sozinha ("A main no ar sozinha" no guia): confere no máximo a cada 4 minutos se há
# commit novo com o CI verde e o pacote do front, troca e volta atrás sozinho se a subida falhar.
# Não corta revisão em curso.
nohup /bin/sh "$BASE/autoatualizar.sh" >/dev/null 2>&1 &
