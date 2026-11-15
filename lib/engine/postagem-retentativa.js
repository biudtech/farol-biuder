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

export default { falhaPassageira, postarComRetentativas, retentativa };
export { falhaPassageira, postarComRetentativas, retentativa };
