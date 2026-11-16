// Porteiro da API local (A4, spec 7.A4 itens 2, 3 e 5). O lib/http-server.js consulta
// estas funções e nada mais; a regra fica aqui. No modo que exige, todo /api/* pede
// Authorization: Bearer com uma sessão válida, exceto POST /api/auth/pair e GET
// /api/auth/status (GET /api/health responde antes de chegar aqui). O modo exige sempre que
// a config traz hostPublico ou origensPermitidas (lib/local-auth/modo.js, que lê as duas da
// própria config). Nenhuma resposta daqui emite cookie: o token sai só no corpo do
// pareamento, e a página o guarda em localStorage, que é isolado por origem.
import { LOCAL_AUTH, TEMPOS } from '../constants.js';
import { exigeAutenticacao } from './modo.js';
import { verificarSessao, emitirSessao, listarSessoes, revogarSessao } from './sessoes.js';
import { tentarCodigo } from './pareamento.js';
import { rotaPublicaDeAutenticacao } from './inventario.js';
import { loopback } from '../http-guard.js';

const FORMATO_BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const RECUSA = Object.freeze({ status: 401, body: Object.freeze({ error: 'nao_autenticado' }) });
const CODIGO_INVALIDO = Object.freeze({ ok: false, code: 'codigo_invalido' });

function exigida(config) {
  return exigeAutenticacao({ config, bindForaDoLoopback: !loopback(config?.bind) });
}

function autenticada(req) {
  const m = FORMATO_BEARER.exec(String(req.headers.authorization || ''));
  return !!m && verificarSessao(m[1]);
}

// Fora do modo que exige, devolve null sem tocar em disco.
function recusaSemCredencial(req, rota, config) {
  if (rotaPublicaDeAutenticacao(req.method, rota)) return null;
  if (!exigida(config) || autenticada(req)) return null;
  return RECUSA;
}

// Um stream aberto não sobrevive à própria credencial: sem isto, revogar não cortava a aba
// que já estava aberta (achado da jornada do pareamento). Fora do modo que exige, a vigília
// responde sempre sim, sem tocar em disco.
function vigiaDoStream(req, config) {
  if (!exigida(config)) return () => true;
  const token = tokenDe(req);
  let conferidoEm = Date.now();
  let valida = true;
  return (agora = Date.now()) => {
    if (!valida) return false;
    if (agora - conferidoEm < TEMPOS.STREAM_RECONFERENCIA_MS) return true;
    conferidoEm = agora;
    valida = verificarSessao(token, agora);
    return valida;
  };
}

function tokenDe(req) {
  const m = FORMATO_BEARER.exec(String(req.headers.authorization || ''));
  return m ? m[1] : '';
}

// A lista nunca leva hash inteiro nem token; revogar a PRÓPRIA sessão é permitido e a
// resposta diz isso, porque a tela precisa voltar ao pareamento.
function sessoes(req) {
  return { ok: true, sessoes: listarSessoes({ tokenAtual: tokenDe(req) }) };
}

function revogar(req, body) {
  const id = String((body && body.id) || '');
  const atual = listarSessoes({ tokenAtual: tokenDe(req) }).find((s) => s.atual);
  if (!revogarSessao(id)) return { ok: false, code: 'sessao_inexistente' };
  return { ok: true, eraAtual: !!atual && atual.id === id };
}

function statusAutenticacao(req, config) {
  return { exigida: exigida(config), autenticado: autenticada(req) };
}

// A linha do farol.log quando as tentativas erradas bloqueiam código pendente. Sem o código e
// sem o valor tentado: quem opera precisa saber que aconteceu, não o que foi digitado.
function avisoDeBloqueio(quantos) {
  const quem = quantos === 1 ? 'código pendente bloqueado' : `${quantos} códigos pendentes bloqueados`;
  return `pareamento: ${quem} por ${LOCAL_AUTH.CODIGO_MAX_ERROS} tentativas erradas em POST /api/auth/pair. Gere outro com: node tools/farol-parear.js`;
}

// `avisar` recebe a linha do log (o servidor passa o WARN do engine): uma por bloqueio.
function parear(body, avisar = null) {
  const dados = body || {};
  // A recusa é UMA só para quem chama, qualquer que seja o motivo (não há código pendente,
  // o código não confere, este erro acabou de queimá-lo): hospedada, a rota é alcançável por
  // qualquer um, e o motivo e as tentativas restantes diriam a quem não pareou se há código
  // esperando e quando queimá-lo. O motivo fica do lado de dentro (tentarCodigo), e o limite
  // de tentativas continua valendo.
  const tentativa = tentarCodigo(String(dados.codigo || ''), Date.now(), avisar && ((quantos) => avisar(avisoDeBloqueio(quantos))));
  if (!tentativa.ok) return CODIGO_INVALIDO;
  const rotulo = String(dados.rotulo || '').slice(0, LOCAL_AUTH.ROTULO_MAX);
  return { ok: true, token: emitirSessao(rotulo) };
}

export default { recusaSemCredencial, statusAutenticacao, parear, sessoes, revogar, vigiaDoStream };
export { recusaSemCredencial, statusAutenticacao, parear, sessoes, revogar, vigiaDoStream };
