// Vigia da hospedagem compartilhada sem Docker (docs/HOSPEDAGEM.md, "O agendador não pode ser um
// shell longo"): roda o iniciar.sh a cada minuto, sem depender do cron da hospedagem, que roda em
// intervalos soltos. O iniciar.sh religa o motor e o front, confere o Claude Code, faz o backup do
// dia e chama o autoatualizar.sh. Quem sobe o vigia é o próprio iniciar.sh, quando ele não está
// vivo; o cron fica de reserva para isso.
//
// Em Node, não em sh: medido em 23 e 24/11/2026, o laço em sh levava SIGKILL de fora com 60
// minutos de vida, sem linha de saída no log (uma religada por hora no iniciar.log), enquanto os
// processos Node da mesma conta vivem dias. A hospedagem encerra o shell de longa duração.
//
// Uso: node <base>/vigia.mjs   (a base é FAROL_BASE ou a pasta deste arquivo; o pid vai para
// <base>/run/vigia.pid). Início, saída com o código e os sinais capturáveis vão para
// <base>/log/vigia.log: sumir sem linha de saída é SIGKILL de fora.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.FAROL_BASE || import.meta.dirname;
const LOG = path.join(BASE, 'log', 'vigia.log');
const INTERVALO_MS = 60_000;
// Uma rodada presa não segura o vigia: o iniciar.sh termina em segundos (o resto vai em segundo
// plano), e a trava dele vence em 10 minutos.
const TETO_RODADA_MS = 5 * 60_000;

function log(msg) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} vigia ${process.pid} ${msg}\n`);
  } catch {
    // sem log não há o que fazer; o vigia segue
  }
}

writeFileSync(path.join(BASE, 'run', 'vigia.pid'), `${process.pid}\n`);
log(`inicio node=${process.version} ppid=${process.ppid}`);
process.on('exit', (code) => log(`saiu rc=${code}`));
for (const sinal of ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2', 'SIGPIPE', 'SIGXCPU', 'SIGXFSZ']) {
  process.on(sinal, () => {
    log(`sinal ${sinal}`);
    process.exit(128);
  });
}
process.on('uncaughtException', (erro) => log(`excecao ${erro?.message ?? erro}`));

// O ambiente da rodada: o do vigia, sem o FAROL_DADOS e o FAROL_NODE_BIN que a rodada que o subiu
// exportou. A rodada os relê do hospedagem.env a cada vez, e o arquivo editado vale já na seguinte.
function ambienteDaRodada() {
  const { FAROL_DADOS: _dados, FAROL_NODE_BIN: _node, ...resto } = process.env;
  return { ...resto, FAROL_BASE: BASE };
}

function rodada() {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = spawn('/bin/sh', [path.join(BASE, 'iniciar.sh')], { stdio: 'ignore', env: ambienteDaRodada() });
    } catch (erro) {
      log(`iniciar nao abriu: ${erro.message}`);
      resolve();
      return;
    }
    // TERM antes do KILL: o trap do iniciar.sh solta a trava, e a rodada seguinte não espera 10 min
    let mata = null;
    const teto = setTimeout(() => {
      log('iniciar passou do teto; encerrado');
      filho.kill('SIGTERM');
      mata = setTimeout(() => filho.kill('SIGKILL'), 5_000);
    }, TETO_RODADA_MS);
    filho.on('error', (erro) => {
      clearTimeout(teto);
      log(`iniciar nao abriu: ${erro.message}`);
      resolve();
    });
    filho.on('close', (code, signal) => {
      clearTimeout(teto);
      clearTimeout(mata);
      if (code !== 0) log(`iniciar rc=${code ?? `sinal ${signal}`}`);
      resolve();
    });
  });
}

for (;;) {
  await rodada();
  await new Promise((r) => setTimeout(r, INTERVALO_MS));
}
