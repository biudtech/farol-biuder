// A saída ordenada do motor (saiu do server.js em 02/11/2026, no merge da main com o Farol
// nativo, quando as duas pontas juntas passaram do teto de linhas do server.js).
import { pararManutencaoMaterial } from '../technical-review/cleanup.js';

// Saída ORDENADA para a manutenção do material da avaliação técnica antes de o processo sair.
// `once` nos sinais porque o handler não pode correr duas vezes. O server.js a reexporta para
// o teste do caminho de saída por sinal (test/saida-por-sinal.test.js).
function registrarSaidaOrdenada(engine) {
  if (engine.saidaRegistrada) return;
  engine.saidaRegistrada = true;
  const sair = () => pararManutencaoMaterial();
  // SIGHUP junto: o terminal que fecha e o supervisor que recarrega o enviam, e sem ele a
  // saída ordenada não rodava
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sinal, () => { sair(); process.exit(0); });
  process.once('beforeExit', sair);
}

export { registrarSaidaOrdenada };
