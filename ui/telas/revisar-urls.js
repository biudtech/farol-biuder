import { api } from './infra.js';

/* Boca ÚNICA do clique Revisar. Todos os caminhos (fila, "revisar de novo",
   revisar tudo) passam por aqui, pela mesma razão do enqueueHeadless no
   engine: garantia que precisa valer sempre mora no estrangulamento, e não em cada
   chamador. */
function revisarUrls(urls, extras = {}) {
  return api('/api/review', { urls, ...extras });
}

export { revisarUrls };
