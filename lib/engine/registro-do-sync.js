// O registro do sync por herança (24/11/2026, sync-por-heranca.js): a marca `sincronizacao` que a
// classe limpa de ressalvas.js lê, vinda da medição feita antes da sessão (vale também para o head
// de trabalho `sync/*`, que a consulta de pr-de-sincronizacao.js não reconhece), e o que a decisão
// guarda: o caminho, a origem, a foto e as contagens, com uma linha INFO por decisão (o motivo que
// alguém vai perguntar depois). Só a marca do motor (`result.herancaDoSync`, gravada em
// file-proof.js) conta; a que vier do modelo já foi descartada lá.
const CAMINHO_SYNC = 'sync_por_heranca';
const CAMINHO_SYNC_SEM_SESSAO = 'sync_por_heranca_sem_sessao';

function marcaValida(h) {
  return !!h && typeof h.origem === 'string' && h.origem && typeof h.destino === 'string' && typeof h.foto === 'string'
    && Array.isArray(h.herdados) && Number.isInteger(h.lidos);
}

// A marca `sincronizacao` da medição, ou null para a consulta de hoje decidir.
function sincronizacaoDoSync(result) {
  const h = result?.herancaDoSync;
  if (!marcaValida(h)) return null;
  return { origem: h.origem, destino: h.destino, commits: h.commits, heranca: { foto: h.foto, herdados: h.herdados.length, lidos: h.lidos } };
}

// O que a decisão da sessão guarda do sync. Vazio sem a marca ou com o caminho já dado (o caminho
// sem sessão grava o próprio registro e a própria linha).
function extraDoSync(engine, pr, result, extra) {
  const h = result?.herancaDoSync;
  if (!marcaValida(h) || extra?.caminho) return {};
  const herancaSync = { origem: h.origem, foto: h.foto, herdados: h.herdados.length, lidos: h.lidos };
  engine.log('INFO', `${pr.key}: sync da ${h.origem} (foto ${h.foto.slice(0, 7)}): ${herancaSync.herdados} arquivo(s) herdados sem leitura, `
    + `${h.lidos} lido(s); desfecho ${extra?.status || 'pendente'} (caminho ${CAMINHO_SYNC}).`);
  return { caminho: CAMINHO_SYNC, herancaSync };
}

export { CAMINHO_SYNC, CAMINHO_SYNC_SEM_SESSAO, sincronizacaoDoSync, extraDoSync };
