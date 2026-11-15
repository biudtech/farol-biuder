// Listas de outros aparelhos (visão compartilhada, 7.C3), parte PURA.
//
// Recebe a projeção que o engine entrega (evento `sync-lists` e `POST /api/sync/lists`,
// lib/engine/sync-listas.js), a lista local da aba e o `STATE.sync`, e devolve o que a aba
// mostra. Nada aqui toca DOM nem lê estado global.
//
// DUAS AFIRMAÇÕES QUE ESTE MÓDULO NÃO PODE ERRAR, travadas em teste:
//   1. o PR que este aparelho também vê aparece UMA vez, com a origem "este aparelho", e a
//      contagem da aba não o soma de novo;
//   2. dado indisponível (visão desligada, bloqueada, sem outro aparelho, sem chave), leitura
//      que falhou e leitura velha são estados diferentes, com frases diferentes. A idade limite
//      vem do engine (`limiteMs`), a tela não define regra de dado. Aparelho que não é o admin
//      recebe `so-admin` e não mostra nada: nem linha, nem faixa (decisão do dono, 06/11/2026).
import { fmtClock } from './comum.js';
import { visaoCompartilhada } from './compartilhado.js';

const INDISPONIVEL = {
  'sem-frota': 'Nenhum outro aparelho com a chave aberta foi visto nas últimas 24 horas: só este aparelho aparece aqui.',
  'sem-chave': 'A chave do conjunto não está aberta neste aparelho, então as listas dos outros não abrem aqui.',
  'sem-credencial': 'Este aparelho não está conectado à sincronização, então as listas dos outros não chegam.',
  desligada: 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
  'compartilhamento-desligado': 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
};

const GERAL = {
  desligada: 'A visão compartilhada está desligada: só este aparelho aparece aqui.',
  bloqueada: 'O Farol bloqueou a visão compartilhada neste aparelho: as listas dos outros aparelhos não aparecem.',
  aguardando: 'A primeira leitura das listas dos outros aparelhos ainda não chegou.',
};

function chaveDe(pr) {
  return String((pr && pr.key) || '').toLowerCase();
}

export function estadoDasListas(listas, sync) {
  const visao = visaoCompartilhada(sync);
  if (visao !== 'ligada') return { estado: visao, texto: GERAL[visao] };
  if (!listas || typeof listas !== 'object') return { estado: 'aguardando', texto: GERAL.aguardando };
  if (listas.estado === 'ligada') return { estado: 'ligada', texto: '' };
  if (listas.estado === 'aguardando') return { estado: 'aguardando', texto: GERAL.aguardando };
  // só o admin vê as listas dos outros (lib/engine/sync-listas.js); aqui não há o que dizer
  if (listas.estado === 'so-admin') return { estado: 'so-admin', texto: '' };
  return { estado: 'indisponivel', texto: INDISPONIVEL[listas.estado] || 'As listas dos outros aparelhos não estão disponíveis agora.' };
}

// 'falhou' e 'desatualizado' são os dois estados de dado velho; 'local' e 'sem-publicador'
// não têm linha remota para mostrar
export function estadoDoEscopo(escopo, limiteMs, agora = Date.now()) {
  const e = escopo || {};
  if (e.estado !== 'ok') return String(e.estado || 'aguardando');
  const velhaLeitura = agora - (Number(e.lidoEm) || 0) > (Number(limiteMs) || 0);
  const publicadorParado = (Number(e.confirmadoAte) || 0) <= agora;
  return velhaLeitura || publicadorParado ? 'desatualizado' : 'ok';
}

function nomeDaOrigem(escopo) {
  return escopo.aparelho || 'outro aparelho';
}

function avisoDoEscopo(escopo, estado) {
  const nome = nomeDaOrigem(escopo);
  if (estado === 'falhou') {
    const antes = escopo.lidoEm ? `mostrando a de ${fmtClock(escopo.lidoEm)}, que pode estar velha` : 'nenhuma leitura anterior deu certo';
    return `A leitura da lista do ${nome} falhou às ${fmtClock(escopo.falhaEm)}; ${antes}.`;
  }
  if ((Number(escopo.confirmadoAte) || 0) <= (escopo.agora || 0)) {
    return `Lista desatualizada: o ${nome} não confirma esta lista, e a última confirmação venceu às ${fmtClock(escopo.confirmadoAte)}.`;
  }
  return `Lista desatualizada: a última leitura da lista do ${nome} é de ${fmtClock(escopo.lidoEm)}.`;
}

function vazioMesclado(locais, geral) {
  return { remotas: [], deste: locais.length, outros: 0, total: locais.length, naoAbriram: 0, avisos: [], geral };
}

// Mescla a lista local da aba com as linhas remotas do tipo pedido. `filtro` é o filtro da
// aba (escopo de conta, ocultos), aplicado às linhas remotas como às locais.
export function mesclarListaRemota(locais, listas, tipo, opcoes = {}) {
  const lista = Array.isArray(locais) ? locais : [];
  const agora = opcoes.agora || Date.now();
  const filtro = typeof opcoes.filtro === 'function' ? opcoes.filtro : () => true;
  const geral = estadoDasListas(listas, opcoes.sync);
  if (geral.estado !== 'ligada') return vazioMesclado(lista, geral);
  const vistas = new Set(lista.map(chaveDe));
  const porChave = new Map();
  const avisos = [];
  let naoAbriram = 0;
  const escopos = (Array.isArray(listas.escopos) ? listas.escopos : []).filter((x) => x && x.tipo === tipo);
  for (const escopo of escopos) {
    naoAbriram += Number(escopo.naoAbriram) || 0;
    const estado = estadoDoEscopo(escopo, listas.limiteMs, agora);
    if (estado === 'falhou' || estado === 'desatualizado') avisos.push({ estado, texto: avisoDoEscopo({ ...escopo, agora }, estado) });
    for (const l of Array.isArray(escopo.linhas) ? escopo.linhas : []) {
      const linha = { ...l, account: l.account || escopo.account, dev: escopo.dev, aparelho: nomeDaOrigem(escopo) };
      const chave = chaveDe(linha);
      const anterior = porChave.get(chave);
      if (!chave || vistas.has(chave) || !filtro(linha)) continue;
      if (!anterior || (Number(linha.u) || 0) > (Number(anterior.u) || 0)) porChave.set(chave, linha);
    }
  }
  const remotas = [...porChave.values()].sort((a, b) => (Number(b.u) || 0) - (Number(a.u) || 0));
  const outros = new Set(remotas.map((l) => l.dev)).size;
  return { remotas, deste: lista.length, outros, total: lista.length + remotas.length, naoAbriram, avisos, geral };
}
