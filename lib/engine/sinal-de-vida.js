// O sinal de vida da sessão de revisão (18/11/2026): `ultimoSinalEm` no registro da sessão, que
// vai para a tela em `activeSessions` (sessao-projecao.js) e diz ao cartão do Radar se a sessão
// está calada ("sem sinal") ou trabalhando.
//
// A linha do feed já renovava o sinal (pushActivity, session.js), mas o modelo pensando ou
// escrevendo não vira linha: chega como `stream_event`, que só renovava o prazo da sessão. Sem
// isto, uma sessão saudável no meio de um raciocínio longo aparecia "sem sinal" e convidava a
// cancelar. O stream_event chega muitas vezes por segundo: o sinal renova no máximo a cada
// INTERVALO_DO_SINAL_MS, e só então empurra o estado, para não gerar diferença à toa no SSE.
//
// PURA na parte que decide (deveRenovar); renovarSinalDeVida só lê e escreve o registro.

const INTERVALO_DO_SINAL_MS = 5000;

// O sinal renova quando o último ficou para trás o intervalo inteiro, ou quando não há sinal.
function deveRenovar(ultimo, agora) {
  const antes = Number(ultimo);
  return !Number.isFinite(antes) || antes <= 0 || agora - antes >= INTERVALO_DO_SINAL_MS;
}

// Devolve true quando renovou (e empurrou o estado). Sessão que não está entre as revisões em
// curso (chat, ferramentas) não tem cartão e fica de fora.
function renovarSinalDeVida(engine, id, agora = Date.now()) {
  const rec = id && engine && engine.activeReviews && engine.activeReviews.get(id);
  if (!rec || !deveRenovar(rec.ultimoSinalEm, agora)) return false;
  rec.ultimoSinalEm = agora;
  if (typeof engine.pushState === 'function') engine.pushState();
  return true;
}

const sinalMod = { INTERVALO_DO_SINAL_MS, deveRenovar, renovarSinalDeVida };
export default sinalMod;
export { INTERVALO_DO_SINAL_MS, deveRenovar, renovarSinalDeVida };
