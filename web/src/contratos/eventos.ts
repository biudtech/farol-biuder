// Os eventos do fluxo que não são estado. Por ora, só o `toast`: o aviso com que o motor diz
// o desfecho de uma ação ou de uma revisão ("aprovado sem ressalvas", "já havia um APPROVE
// seu; não postei de novo", "Falha ao postar em ..."). O motor emite
// `engine.emit('toast', { kind, text })`, e lib/http-server.js repassa a todo cliente como
// `event: toast` com esse objeto em JSON. `kind` é "info", "ok" ou "error".
import { ehObjeto, ehTexto } from './formas';

export type TomDoRecado = 'info' | 'ok' | 'erro';

export interface RecadoDoMotor {
  tom: TomDoRecado;
  texto: string;
}

// O texto é do motor, mas pode citar o que veio de fora (erro do gh, título): tem teto.
export const TETO_DO_RECADO = 400;

const TONS: Record<string, TomDoRecado> = { info: 'info', ok: 'ok', error: 'erro' };

// Devolve o recado, ou null quando não há texto. `kind` ausente ou desconhecido vale como
// informação, que é como a tela antiga tratava.
export function lerRecado(bruto: unknown): RecadoDoMotor | null {
  if (!ehObjeto(bruto) || !ehTexto(bruto.text)) return null;
  const limpo = bruto.text.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  const texto = limpo.length > TETO_DO_RECADO ? `${limpo.slice(0, TETO_DO_RECADO)}…` : limpo;
  const tom = ehTexto(bruto.kind) && Object.hasOwn(TONS, bruto.kind) ? (TONS[bruto.kind] as TomDoRecado) : 'info';
  return { tom, texto };
}
