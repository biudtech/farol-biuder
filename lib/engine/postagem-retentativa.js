// Retentativa da postagem na revisão automática. A única recusa passageira é a leitura
// dos meus reviews do head que falhou no GitHub (`estado-desconhecido`, em postReviewOnce):
// nada saiu, então repetir é seguro.
import { TEMPOS } from '../constants.js';

const RETENTATIVAS_NA_REVISAO = 3;

function falhaPassageira(post) {
  return !!post && post.ok !== true && post.estado === 'nao_enviada' && post.attempted === false && post.motivo === 'estado-desconhecido';
}

function esperaReal(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Objeto e não função solta: a suíte troca a espera sem mexer em relógio global.
const retentativa = { esperar: esperaReal };

// A revisão automática tenta de novo, no máximo 3 vezes e com 2 s entre elas, só quando a
// recusa é passageira.
async function postarComRetentativas(postar) {
  let post = await postar();
  for (let i = 0; i < RETENTATIVAS_NA_REVISAO && falhaPassageira(post); i++) {
    await retentativa.esperar(TEMPOS.POSTAGEM_RETENTATIVA_MS);
    post = await postar();
  }
  return post;
}

// O recuo do reenvio depois das tentativas rápidas (17/11/2026: o reenvio nunca desiste para uma
// pessoa). `longas` = tentativas além das rápidas; 0 = a primeira espera longa. Até seis horas.
const RECUO_DO_REENVIO_MS = 15 * 60_000;
const RECUO_MAXIMO_DO_REENVIO_MS = 6 * 60 * 60_000;
function recuoDoReenvio(longas) {
  return Math.min(RECUO_MAXIMO_DO_REENVIO_MS, RECUO_DO_REENVIO_MS * 2 ** Math.min(Math.max(longas, 0), 5));
}

export default { falhaPassageira, postarComRetentativas, retentativa, recuoDoReenvio };
export { falhaPassageira, postarComRetentativas, retentativa, recuoDoReenvio };
