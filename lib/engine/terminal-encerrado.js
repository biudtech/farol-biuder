// Fechamento dos terminais de revisão.

function encerrarTerminal(engine, { keys = [], label, id, code } = {}) {
  engine.activeReviews.delete(id);
  if (code !== 0 && code !== null && code !== undefined) engine.log('WARN', `sessao "${label}" saiu com codigo ${code}`);
  for (const k of keys) engine.unsee(k);
  engine.emit('toast', { kind: 'ok', text: `${label}: sessão encerrada. De volta ao monitoramento.` });
  engine.pushState();
  if (keys.length) engine.checkNow();
}

export { encerrarTerminal };
