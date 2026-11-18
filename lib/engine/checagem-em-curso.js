// A checagem em andamento, que o Radar mostra (17/11/2026): quantas buscas do ciclo de
// monitoramento já voltaram e qual está no ar.
//
// O que é contado é o que o ciclo de fato faz (_coletarPanorama, server.js): uma busca de PRs
// abertos por organização monitorada da conta revisora (`gh search prs --owner`). O ciclo não
// busca por repositório, e por isso a unidade aqui é a organização, nunca o repositório: o motor
// não sabe quantos repositórios há em cada uma. As buscas que vêm depois (os PRs pedidos à conta e
// os já revisados por ela) e o resto do ciclo não entram na contagem: com as organizações todas
// buscadas, `feitas` fica igual a `total` e `agora` sai, até o ciclo terminar.
//
// Custo por evento: o snapshot vai por diferença (lib/estado-delta.js), e este módulo empurra o
// estado no máximo uma vez por segundo por causa da contagem. A mudança que chega antes disso
// espera o resto do segundo num relógio só, que leva o valor mais novo.
//
// Só vale com o ciclo em curso: fora dele a chave do snapshot vai `null`.
const INTERVALO_MS = 1000;

function empurrar(engine, agora = Date.now()) {
  if (typeof engine.pushState !== 'function') return;
  const passou = agora - (engine.checagemEmpurradaEm || 0);
  if (passou >= INTERVALO_MS) {
    engine.checagemEmpurradaEm = agora;
    engine.pushState();
    return;
  }
  if (engine.checagemRelogio) return;
  engine.checagemRelogio = setTimeout(() => {
    engine.checagemRelogio = null;
    engine.checagemEmpurradaEm = Date.now();
    engine.pushState();
  }, INTERVALO_MS - passou);
  if (typeof engine.checagemRelogio.unref === 'function') engine.checagemRelogio.unref();
}

function organizacoesDa(acc) { return Array.isArray(acc && acc.owners) ? acc.owners.length : 0; }

function quantasOrganizacoes(contas) {
  if (!Array.isArray(contas)) return 0;
  return contas.reduce((n, acc) => n + organizacoesDa(acc), 0);
}

// No começo do ciclo, com as contas que ele vai percorrer.
function iniciarChecagem(engine, contas) {
  engine.checagemEmCurso = { total: quantasOrganizacoes(contas), feitas: 0, agora: null };
  empurrar(engine);
}

// A busca de uma organização, com a contagem em volta. Falha da busca também conta como feita:
// o ciclo segue para a próxima.
async function buscarOrganizacao(engine, owner, user) {
  const c = engine.checagemEmCurso;
  if (c) { c.agora = String(owner); empurrar(engine); }
  try {
    return await engine.searchPRs(['--owner', owner], user);
  } finally {
    if (c) {
      c.feitas = Math.min(c.total, c.feitas + 1);
      if (c.feitas >= c.total) c.agora = null;
      empurrar(engine);
    }
  }
}

// A chave `checagem` do snapshot: `{ total, feitas, agora? }` com o ciclo em curso, ou null.
function checagemParaTela(engine) {
  const c = engine && engine.checking ? engine.checagemEmCurso : null;
  if (!c || !Number.isSafeInteger(c.total)) return null;
  return c.agora ? { total: c.total, feitas: c.feitas, agora: c.agora } : { total: c.total, feitas: c.feitas };
}

export default { iniciarChecagem, buscarOrganizacao, checagemParaTela, INTERVALO_MS };
export { iniciarChecagem, buscarOrganizacao, checagemParaTela, INTERVALO_MS };
