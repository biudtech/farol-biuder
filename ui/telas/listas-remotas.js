/* Farol · UI: listas de outros aparelhos (visão compartilhada, 7.C3).

   A projeção chega por dois caminhos: `POST /api/sync/lists` quando a página abre (o que o
   relógio do engine já leu) e o evento SSE `sync-lists`, que o bootstrap só repassa. A parte
   pura mora em ui/pure/listas-remotas.js; aqui mora o que toca estado() e rede.

   Quando chega projeção nova, a tela pede o redesenho pela função que o bootstrap injeta em
   `initListasRemotas` (nunca importando quem lê: seria ciclo). */

import { estado } from './estado.js';
import { api } from './infra.js';

// a busca inicial é uma só; falhou, tenta de novo no máximo uma vez por minuto
const BUSCA_MIN_MS = 60000;

const LISTAS = { dados: null, buscando: false, buscadoEm: 0 };
let _redesenhar = null;

function syncAtual() { return (estado() && estado().sync) || {}; }

async function buscarListas() {
  if (LISTAS.buscando || LISTAS.dados || Date.now() - LISTAS.buscadoEm < BUSCA_MIN_MS) return;
  LISTAS.buscando = true;
  LISTAS.buscadoEm = Date.now();
  const r = await api('/api/sync/lists', {});
  LISTAS.buscando = false;
  // o evento pode ter chegado durante a busca, e ele é mais novo que a resposta
  if (!r || r.ok !== true || LISTAS.dados) return;
  LISTAS.dados = r;
  if (_redesenhar) _redesenhar();
}

function aoListasRemotas(d) {
  LISTAS.dados = d && typeof d === 'object' ? d : null;
  if (_redesenhar && estado()) _redesenhar();
}

function initListasRemotas(redesenhar) {
  _redesenhar = redesenhar;
}

// A fila de cada aparelho (telas/radar-aparelhos.js) lê a projeção. Quem decide se ainda falta
// buscá-la é buscarListas, numa guarda só.
function dadosDasListas() {
  const sync = syncAtual();
  if (sync.shared === true && !sync.bloqueioCompartilhamento) buscarListas();
  return LISTAS.dados;
}

export { initListasRemotas, aoListasRemotas, dadosDasListas };
