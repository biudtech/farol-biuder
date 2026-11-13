// A saída ordenada do motor (saiu do server.js em 02/11/2026, no merge da main com o Farol
// nativo, quando as duas pontas juntas passaram do teto de linhas do server.js).
import { pararManutencaoMaterial } from '../technical-review/cleanup.js';

// Saída ORDENADA devolve os leases que este aparelho segura, para outro aparelho não
// esperar até o TTL por um trabalho que já morreu. `once` nos dois sinais porque o
// handler não pode correr duas vezes, e o `stopSync` é síncrono (os aborts saem em
// best effort, sem await): pendurar a saída do processo em rede seria pior que o
// lease preso que ela evita. Queda dura continua coberta só pelo TTL. O server.js a reexporta para o
// teste do caminho de saída por sinal.
function registrarSaidaOrdenada(engine) {
  if (engine.saidaRegistrada) return;
  engine.saidaRegistrada = true;
  const sair = () => {
    pararManutencaoMaterial();
    try { engine.syncStop(); } catch { /* encerrando: nada a fazer */ }
  };
  // SIGHUP junto: o terminal que fecha e o supervisor que recarrega o enviam, e sem ele a
  // saída ordenada não rodava
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sinal, () => { sair(); process.exit(0); });
  process.once('beforeExit', sair);
}

export { registrarSaidaOrdenada };
