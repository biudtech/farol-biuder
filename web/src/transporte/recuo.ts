// Os tempos do fluxo de eventos. A espera dobra de 3 a 30 s: o motor que voltou é
// reencontrado rápido e o que não voltou não é martelado.
export const RECUO_INICIAL_MS = 3000;
export const RECUO_MAXIMO_MS = 30000;
// O motor manda um batimento a cada 25 s. Sem nada por 90 s, a conexão morreu sem avisar
// (proxy que segura o fluxo), e quem lê derruba e reconecta.
export const OCIOSO_MS = 90000;

export function proximoRecuo(atualMs: number): number {
  if (!Number.isFinite(atualMs) || atualMs <= 0) return RECUO_INICIAL_MS;
  return Math.min(atualMs * 2, RECUO_MAXIMO_MS);
}
