#!/bin/sh
# Mantém o Claude Code do motor na última versão publicada, na hospedagem compartilhada sem
# Docker (docs/HOSPEDAGEM.md, "Hospedagem compartilhada, sem Docker"). Não serve ao container:
# lá a versão é a da imagem e a atualização automática fica desligada.
#
# O motor pede o modelo por apelido e lê o uso do plano pelo próprio Claude Code: versão velha
# aponta para modelo legado e não informa a validade do login (a 2.1.310 não mandava o campo).
#
# Espera a instalação nativa do Claude Code no HOME do motor: ~/.local/bin/claude, um link para
# ~/.local/share/claude/versions/<versão>, feita uma vez com "claude install latest". Quem
# atualiza é o próprio "claude update", que troca o link: a sessão em curso continua no arquivo
# da versão em que abriu.
#
# Uso, a cada rodada do agendador da hospedagem (o intervalo é conferido aqui dentro):
#   FAROL_BASE=<base> /bin/sh atualizar-claude.sh          confere no máximo uma vez por hora
#   FAROL_BASE=<base> /bin/sh atualizar-claude.sh --agora  confere sem olhar o intervalo
#
# Variáveis: FAROL_BASE (obrigatória, a pasta com run/ e log/), FAROL_DADOS (o HOME do motor,
# padrão <base>/dados), FAROL_CLAUDE_INTERVALO_MIN (padrão 60) e FAROL_CLAUDE_RESERVA (um
# binário do Claude Code guardado à parte, padrão <base>/bin/claude.reserva).
#
# Rede de segurança: se depois da conferência o Claude Code nativo não responder a versão, o
# link passa a apontar para a reserva, quando ela existe, e a linha de erro fica no log: o motor
# segue revisando com a reserva, e alguém precisa olhar.
#
# O log só ganha linha quando a versão muda ou quando algo falha. run/claude-update.marca é a
# hora da última conferência.
set -u
BASE="${FAROL_BASE:?defina FAROL_BASE com a pasta base da hospedagem}"
DADOS="${FAROL_DADOS:-$BASE/dados}"
NATIVO="$DADOS/.local/bin/claude"
RESERVA="${FAROL_CLAUDE_RESERVA:-$BASE/bin/claude.reserva}"
INTERVALO_MIN="${FAROL_CLAUDE_INTERVALO_MIN:-60}"
LOG="$BASE/log/claude-update.log"
MARCA="$BASE/run/claude-update.marca"
TRAVA="$BASE/run/claude-update.trava"

export HOME="$DADOS"
export PATH="$DADOS/.local/bin:/usr/local/bin:/usr/bin:/bin"
# a hospedagem compartilhada limita as threads do usuário
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-2}"

anotar() { echo "$(date -Iseconds) $*" >>"$LOG"; }
versao() { "$NATIVO" --version 2>/dev/null | head -1; }

if [ "${1:-}" != "--agora" ] && [ -f "$MARCA" ] && [ -z "$(find "$MARCA" -mmin +"$INTERVALO_MIN" 2>/dev/null)" ]; then
  exit 0
fi

# uma conferência por vez; a trava esquecida por um processo morto sai depois de 30 minutos
if ! mkdir "$TRAVA" 2>/dev/null; then
  [ -n "$(find "$TRAVA" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rmdir "$TRAVA" 2>/dev/null
  exit 0
fi
trap 'rmdir "$TRAVA" 2>/dev/null' EXIT
touch "$MARCA"

ANTES="$(versao)"
SAIDA="$(timeout 900 "$NATIVO" update 2>&1)"
CODIGO=$?
DEPOIS="$(versao)"

if [ -z "$DEPOIS" ]; then
  anotar "ERRO o Claude Code nativo não responde a versão (antes: ${ANTES:-nenhuma}; update saiu com $CODIGO)"
  if [ -x "$RESERVA" ]; then
    mkdir -p "$DADOS/.local/bin"
    ln -sfn "$RESERVA" "$NATIVO" && anotar "ERRO o link do Claude Code aponta para a reserva: confira a instalação nativa"
  fi
  exit 1
fi

if [ "$ANTES" != "$DEPOIS" ]; then
  anotar "atualizado de ${ANTES:-nenhuma} para $DEPOIS"
elif [ "$CODIGO" -ne 0 ]; then
  anotar "ERRO claude update saiu com $CODIGO e a versão continua $DEPOIS: $(echo "$SAIDA" | tail -1 | cut -c1-200)"
fi
exit 0
