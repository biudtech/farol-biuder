// O que das sessões ativas vai para a tela. PURA, sem engine e sem IO.
//
// Saiu do lib/engine/session.js em 30/09/2026: o arquivo está acima do teto de tamanho e
// o ratchet passou a medir crescimento, e isto aqui é assunto próprio, a fronteira entre
// o registro interno da sessão (mapas, blobs, Set de leitura) e o que a tela pode ver.
import { progressoDaSessao } from './progresso-revisao.js';

// projeção das sessões ativas pro snapshot: PURA. Tira o que é interno (fileBlobs,
// o mapa cru de agents) e entrega a contagem e a lista compacta que a UI mostra.
// `agora` entra de fora para a porcentagem (o tempo restante) seguir pura.
function projectSessions(records, agora = Date.now()) {
  return (records || []).map((s) => {
    // `ultimoLido` sai cru: o arquivo da vez vai só dentro do progresso, na etapa do código
    const { fileBlobs, agents, filesRead, scopeRoot, arquivosALer, ultimoLido, ...rest } = s;
    void fileBlobs; void scopeRoot; void arquivosALer; void ultimoLido;
    // a porcentagem da revisão em andamento (progresso-revisao.js): só sessão com etapa marcada
    const progresso = progressoDaSessao(s, agora);
    if (progresso) rest.progresso = progresso;
    // NUMERADOR da leitura vai para a tela (o Set nao vai): "12 arquivos do PR lidos" e
    // medida de verdade, ao contrario da barra que existia antes, que era a contagem de
    // linhas do feed passada por uma exponencial e saturava em 90%.
    if (filesRead && filesRead.size) rest.lidos = filesRead.size;
    const list = Object.values(agents || {});
    if (!list.length) return rest;
    return {
      ...rest,
      agents: list.map(a => ({ n: a.n, label: a.label, desc: a.desc, done: !!a.done })),
      agentsLive: list.filter(a => !a.done).length,
    };
  });
}

const projecaoMod = { projectSessions };
export default projecaoMod;
export { projectSessions };
