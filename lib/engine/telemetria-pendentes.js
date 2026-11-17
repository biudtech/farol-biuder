// Escrita no banco da telemetria que falha (disco cheio, erro de I/O) não perde o que ia ser
// gravado. O JSON de antes guardava a linha no array em memória e a regravava inteira na próxima
// vez; aqui o item fica numa fila por assunto (sessões, tentativas, falhas), as leituras o
// enxergam, e toda gravação nova tenta primeiro esvaziar a fila, na ordem.
//
// Log por mudança de estado, não por tentativa: um WARN quando o assunto passa a falhar e um INFO
// quando volta a gravar, com quantos itens entraram. A fila tem teto: passando dele, o mais antigo
// sai e é contado, e a linha da volta diz quantos se perderam.
const TETO = 1000;

function fila(engine, assunto) {
  if (!engine.telemetriaFilas) engine.telemetriaFilas = {};
  if (!engine.telemetriaFilas[assunto]) engine.telemetriaFilas[assunto] = { itens: [], falhando: false, perdidos: 0 };
  return engine.telemetriaFilas[assunto];
}

function log(engine, nivel, msg) { if (typeof engine.log === 'function') engine.log(nivel, msg); }

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

// Põe o item na fila e grava a fila inteira, na ordem. `gravarUm(item)` lança se o banco recusar.
// Devolve true se a fila esvaziou.
function gravarComFila(engine, assunto, item, gravarUm) {
  const f = fila(engine, assunto);
  const antigos = f.itens.length;
  f.itens.push(item);
  if (f.itens.length > TETO) { f.itens.shift(); f.perdidos++; }
  try {
    while (f.itens.length) {
      gravarUm(f.itens[0]);
      f.itens.shift();
    }
  } catch (err) {
    if (!f.falhando) {
      f.falhando = true;
      log(engine, 'WARN', `telemetria: gravar ${assunto} no telemetria.db falhou (${err.message}); as linhas ficam em memória e entram na próxima gravação`);
    }
    return false;
  }
  if (f.falhando) {
    const perdidos = f.perdidos ? `; ${plural(f.perdidos, 'linha se perdeu', 'linhas se perderam')} por passar do teto de ${TETO} em memória` : '';
    log(engine, 'INFO', `telemetria: o banco voltou a gravar: ${plural(Math.min(antigos, TETO), 'linha pendente', 'linhas pendentes')} de ${assunto} gravadas${perdidos}`);
    Object.assign(f, { falhando: false, perdidos: 0 });
  }
  return true;
}

// O que ainda não entrou no banco, na ordem.
function pendentes(engine, assunto) { return engine.telemetriaFilas?.[assunto]?.itens || []; }

export { gravarComFila, pendentes };
