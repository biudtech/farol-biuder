// A conta que AGE no GitHub (06/10/2026). Regra de produto: conta silenciada continua
// monitorada, mas não inicia novas ações. Revisões admitidas antes do silêncio podem concluir.
//
// Incidente: no Farol de um celular, o `gh` tinha duas contas cobrindo a mesma org, a
// primeira silenciada e a segunda ativa. O dono quis agir como a ativa num PR da org e a
// ação saiu com a identidade da silenciada (um review dispensado, reviews re-solicitados).
// A escolha por org era "a primeira conta que cobre a org", sem olhar silêncio nem token,
// e os caminhos de escrita por clique não conferiam o silêncio da conta resolvida.
//
// Duas metades, as duas aqui:
// 1. RESOLVER: a conta de uma org é a primeira ativa com token, senão a primeira ativa, e a
//    silenciada só quando ninguém mais cobre a org (`contaDaOrg`). No dedup das buscas, a
//    conta capaz vence a incapaz, e empate mantém a primeira (`guardarPelaCapaz`, o G18).
// 2. RECUSAR: se mesmo assim a conta resolvida for silenciada, a escrita não sai e o motivo
//    é dito (`recusaDeSilenciada`). Nunca se troca de conta em silêncio no caminho de
//    escrita: quem escolhe a conta é a resolução acima, não a hora de postar.

function minusculo(v) {
  return String(v || '').toLowerCase();
}

function silenciada(engine, conta) {
  return !!conta && typeof engine.isMuted === 'function' && engine.isMuted(conta);
}

// Sem `tokenFor` (engine de teste mínimo) o token não decide nada.
function temToken(engine, conta) {
  return typeof engine.tokenFor !== 'function' || !!engine.tokenFor(conta);
}

// Capaz de agir: não silenciada e com token desta conta no `gh`.
function capazDeAgir(engine, conta) {
  return !!conta && !silenciada(engine, conta) && temToken(engine, conta);
}

// A conta monitorada que responde pela org, ou null quando nenhuma cobre a org.
function contaDaOrg(engine, owner) {
  const o = minusculo(owner);
  const cobrem = engine.accountList().filter((a) => (a.owners || []).some((x) => minusculo(x) === o));
  const ativas = cobrem.filter((a) => !a.muted);
  return ativas.find((a) => temToken(engine, a.user)) || ativas[0] || cobrem[0] || null;
}

// G18 do dedup por chave: o mesmo PR chega pela busca de duas contas (as duas cobrem a org,
// ou o time pediu revisão às duas). A capaz de agir vence a incapaz; empate mantém a primeira.
function guardarPelaCapaz(engine, mapa, pr, conta) {
  const anterior = mapa.get(pr.key);
  if (!anterior || (!capazDeAgir(engine, engine.accountForPr(anterior)) && capazDeAgir(engine, conta))) {
    mapa.set(pr.key, pr);
  }
}

function textoDeSilenciada(conta) {
  return `conta ${conta} está silenciada e não age; reative a conta ou use outra`;
}

// Recusa de escrita no GitHub com conta silenciada. null = pode seguir (para o silêncio).
function recusaDeSilenciada(engine, conta) {
  if (!silenciada(engine, conta)) return null;
  return { ok: false, blocked: 'conta_silenciada', error: textoDeSilenciada(conta) };
}

export default {
  contaDaOrg, guardarPelaCapaz, textoDeSilenciada, recusaDeSilenciada,
};
export {
  contaDaOrg, guardarPelaCapaz, textoDeSilenciada, recusaDeSilenciada,
};
