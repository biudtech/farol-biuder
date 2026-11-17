// O histórico das decisões resolvidas atrás de uma interface só, com dois lugares onde ele pode
// morar (lote 2 do banco da telemetria, 17/11/2026):
//   - o banco (lib/telemetria/historico.js): resolver uma decisão é um INSERT em transação, e as
//     leituras consultam a tabela;
//   - o array `resolved` do decisions.json, como era até então. Continua valendo quando o banco
//     não abriu ou a importação falhou nesta subida, e para o engine de teste montado à mão.
// Quem decide é `engine.historicoNoBanco` com `engine.historicoH` aberto (iniciarHistorico,
// telemetria-do-motor.js). Cada leitura devolve o mesmo nos dois lugares
// (test/telemetria-historico-paridade.test.js).
//
// O que o banco não dá sozinho e o array dava de graça:
//   - cache: as regras do motor leem o histórico inteiro a cada ciclo e a cada snapshot (a
//     última ação de cada PR, por exemplo). Elas recebem o `leve` de cada decisão (os campos que
//     leem, CAMPOS_LEVES), carregado uma vez e mantido a cada gravação; as 30 mais recentes do
//     snapshot ficam inteiras em memória pelo mesmo motivo;
//   - escrita que falha não perde a decisão: com o banco recusando (disco cheio, I/O), ela fica
//     no `resolved` do decisions.json, que vira a fila durável do que ainda não entrou no banco
//     (sempre mais novo que o banco). As leituras a enxergam por cima do banco, e a gravação
//     seguinte grava a fila e a decisão nova na mesma transação. WARN quando passa a falhar,
//     INFO quando volta, uma linha por mudança de estado.
//
// A ordem da gravação, para a decisão não sumir dos dois lados nem ficar nos dois numa queda:
// o resolveIntoHistory grava no banco (COMMIT) e só depois quem chamou regrava o decisions.json
// sem a pendência (saveDecisions). Uma queda entre os dois deixa a decisão no banco e ainda nas
// pendências; a subida seguinte a encontra no banco pela chave da pendência e a tira de lá sem
// gravar de novo (iniciarHistorico).
import * as tabela from '../telemetria/historico.js';
import { transacao } from '../telemetria/banco.js';
import { colunasDaBusca, paginaDoHistorico, termosDe, seguroNoSql, reposDasGrafias } from './busca-do-historico.js';
import { PUBLICADOS } from './historico-paginado.js';

// Teto do histórico guardado. Era 200 até a v2.40.2 e passou a 3000 (pedido do dono,
// 11/08/2026: "não quero essa limitação mais, se for colocar pelo menos 3000"), porque a caixa
// de revisão virou destino de clique na tabela de Consumo e clique não pode esbarrar em teto.
const HIST_LIMIT = 3000;
// as recentes inteiras em memória: as 30 do snapshot (snapshot-decisions.js)
const RECENTES_EM_MEMORIA = 30;

function log(engine, nivel, msg) { if (typeof engine.log === 'function') engine.log(nivel, msg); }
function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

function noBanco(engine) { return !!(engine && engine.historicoH && engine.historicoNoBanco); }

// O histórico INDISPONÍVEL (B1 da revisão de 17/11/2026): o decisions.json diz que o histórico
// mora no banco e o banco não abriu nesta subida (historicoForaDoBanco, iniciarHistorico), ou a
// última leitura dele falhou. Nesse estado a lista que as regras recebem pode estar vazia sem que
// nada tenha sido decidido, e quem trataria o vazio como "nada decidido" pergunta aqui antes
// (chavesComDecisao, os vistos, a migração dos ignorados, o re-request, a retomada, a memória de
// critérios e a rota). Uma linha WARN quando o estado liga, uma INFO quando desliga.
function historicoIndisponivel(engine) { return !!(engine && (engine.historicoForaDoBanco || engine.historicoLeituraFalhando)); }

const SEGURA = 'até ele voltar, o motor não devolve à fila PR já visto, não marca ignorados, não rearma re-request, não retoma sessão interrompida, a memória de critérios sai como não verificável e GET /api/decisions responde 503';

function mudarEstado(engine, campo, valor, motivo) {
  const antes = historicoIndisponivel(engine);
  engine[campo] = valor;
  const depois = historicoIndisponivel(engine);
  if (!antes && depois) log(engine, 'WARN', `telemetria: histórico de decisões indisponível (${motivo}); ${SEGURA}`);
  else if (antes && !depois) log(engine, 'INFO', 'telemetria: o histórico de decisões voltou a responder');
}

function marcarForaDoBanco(engine, motivo) { mudarEstado(engine, 'historicoForaDoBanco', true, motivo); }

// As chaves de PR com decisão (pendente ou resolvida), ou null quando o histórico está
// indisponível: quem recebe null não decide nada nesta rodada.
function chavesComDecisao(engine) {
  const resolvidas = historico(engine).leves();
  if (historicoIndisponivel(engine)) return null;
  return new Set([...((engine.decisions && engine.decisions.pending) || []).map((d) => d.key), ...resolvidas.map((d) => d.key)]);
}

// O `resolved` do decisions.json: o histórico inteiro no modo JSON, a fila do que o banco ainda
// não aceitou no modo banco.
function arquivo(engine) {
  const d = engine && engine.decisions;
  return (d && Array.isArray(d.resolved)) ? d.resolved : [];
}

function cache(engine) {
  const h = engine.historicoH;
  if (!engine.historicoCache || engine.historicoCache.h !== h) engine.historicoCache = { h, leves: null, recentes: null, seqDe: new WeakMap() };
  return engine.historicoCache;
}

function leves(engine) {
  const c = cache(engine);
  if (!c.leves) {
    const linhas = tabela.levesDasDecisoes(engine.historicoH);
    c.leves = linhas.map((l) => l.leve);
    for (const l of linhas) c.seqDe.set(l.leve, l.seq);
  }
  return c.leves;
}

function recentes(engine) {
  const c = cache(engine);
  if (!c.recentes) c.recentes = tabela.decisoesRecentes(engine.historicoH, RECENTES_EM_MEMORIA);
  return c.recentes;
}

// Depois de um COMMIT: as linhas novas (da mais antiga para a mais nova) entram no topo do cache,
// e o que passou do teto sai do fim, como saiu do banco.
function crescerCache(engine, gravadas) {
  const c = cache(engine);
  for (const g of gravadas) {
    c.seqDe.set(g.leve, g.seq);
    if (c.leves) c.leves.unshift(g.leve);
    if (c.recentes) c.recentes.unshift({ seq: g.seq, item: g.item });
  }
  if (c.leves && c.leves.length > HIST_LIMIT) c.leves.length = HIST_LIMIT;
  if (c.recentes && c.recentes.length > RECENTES_EM_MEMORIA) c.recentes.length = RECENTES_EM_MEMORIA;
}

function gravarNoBanco(engine, fila, item) {
  const h = engine.historicoH;
  return transacao(h, () => {
    const gravadas = [];
    for (const d of [...fila.slice().reverse(), item]) {
      const g = tabela.inserirDecisao(h, d, colunasDaBusca);
      if (g.seq !== null) gravadas.push(g);
    }
    tabela.podarDecisoes(h, HIST_LIMIT);
    return gravadas;
  });
}

// O resolveIntoHistory: a decisão (já "slim") entra no histórico, a mais nova no topo, com o teto.
function guardar(engine, item) {
  if (!noBanco(engine)) {
    engine.decisions.resolved.unshift(item);
    engine.decisions.resolved = engine.decisions.resolved.slice(0, HIST_LIMIT);
    return;
  }
  const fila = arquivo(engine);
  let gravadas;
  try { gravadas = gravarNoBanco(engine, fila, item); } catch (err) {
    engine.decisions.resolved = [item, ...fila].slice(0, HIST_LIMIT);
    if (!engine.historicoFalhando) {
      engine.historicoFalhando = true;
      log(engine, 'WARN', `telemetria: gravar o histórico de decisões no telemetria.db falhou (${err.message}); a decisão fica no decisions.json e entra no banco na próxima gravação`);
    }
    return;
  }
  engine.decisions.resolved = [];
  try { crescerCache(engine, gravadas); } catch { engine.historicoCache = null; }
  if (engine.historicoFalhando) {
    engine.historicoFalhando = false;
    log(engine, 'INFO', `telemetria: o banco voltou a gravar o histórico: ${plural(fila.length, 'decisão pendente gravada', 'decisões pendentes gravadas')}`);
  }
}

// A decisão resolvida mudou (a marca da retirada do pedido de mudanças, retirada-de-pedido.js):
// no modo JSON a mudança já está no array e vai no saveDecisions; no banco, a linha é reescrita.
// Com o UPDATE recusado, o item fica em memória (naoGravadas, por seq) e é ele que a próxima
// varredura recebe: sem isso ela releria a linha do banco, a contagem de tentativas voltaria a
// zero e o teto da retirada deixaria de valer.
function naoGravadas(engine) {
  if (!engine.historicoNaoGravadas) engine.historicoNaoGravadas = new Map();
  return engine.historicoNaoGravadas;
}

function atualizar(engine, item) {
  if (!noBanco(engine) || arquivo(engine).includes(item)) return true;
  const c = cache(engine);
  const seq = c.seqDe.get(item);
  if (seq === undefined) return false;
  try {
    const r = tabela.atualizarDecisao(engine.historicoH, seq, item, colunasDaBusca);
    naoGravadas(engine).delete(seq);
    engine.historicoCache = null;
    return !!r;
  } catch (err) {
    naoGravadas(engine).set(seq, item);
    log(engine, 'WARN', `telemetria: atualizar a decisão ${item.key} no histórico do telemetria.db falhou (${err.message}); a mudança fica em memória e vale só até o motor reiniciar`);
    return false;
  }
}

// As decisões do banco com a marca da retirada, inteiras; a que tem mudança não gravada vem da memória.
function retiradasDoBanco(engine) {
  const c = cache(engine);
  const saida = [];
  for (const leve of leves(engine).filter((d) => d.retiradaPendente)) {
    const seq = c.seqDe.get(leve);
    const emMemoria = naoGravadas(engine).get(seq);
    if (!emMemoria) { saida.push(porSeq(engine, leve, true)); continue; }
    c.seqDe.set(emMemoria, seq);
    if (emMemoria.retiradaPendente) saida.push(emMemoria);
  }
  return saida;
}

// A leitura do banco que falha não derruba quem lê: devolve o vazio e liga o estado indisponível.
function ler(engine, oQue, fn, padrao) {
  try {
    const v = fn();
    if (engine.historicoLeituraFalhando) mudarEstado(engine, 'historicoLeituraFalhando', false);
    return v;
  } catch (err) {
    mudarEstado(engine, 'historicoLeituraFalhando', true, `ler ${oQue} no telemetria.db falhou: ${err.message}`);
    return padrao;
  }
}

// A rota não escreve no log (CLAUDE.md, GET /api/decisions): a leitura que falha ali devolve null
// e a rota responde 503, sem mexer no estado.
function semLog(fn) { try { return fn(); } catch { return null; } }

function comFila(engine, doBanco) {
  const fila = arquivo(engine);
  return fila.length ? [...fila, ...doBanco].slice(0, HIST_LIMIT) : doBanco;
}

// A página de GET /api/decisions. No banco, filtra e pagina no SQL; sai pela lista dos leves
// (mesma função do modo JSON, exata por construção) quando há fila, linha torta ou termo que o
// SQL não compara como o JavaScript. Os itens da página saem inteiros.
function paginaNoBanco(engine, filtros) {
  const h = engine.historicoH;
  const termos = termosDe(filtros.q);
  const repoDobrado = filtros.repo.toLowerCase();
  if (arquivo(engine).length || !termos.every(seguroNoSql) || !seguroNoSql(repoDobrado) || tabela.temTorta(h)) return paginaPelaLista(engine, filtros);
  const { total, itens } = tabela.paginaDeDecisoes(h, { termos, veredito: filtros.veredito, repoDobrado, publicados: PUBLICADOS },
    { limite: filtros.pageSize, offset: (filtros.page - 1) * filtros.pageSize });
  return { total, pages: Math.ceil(total / filtros.pageSize), items: itens, repos: reposDasGrafias(tabela.grafiasDosRepos(h)) };
}

function paginaPelaLista(engine, filtros) {
  const r = paginaDoHistorico(comFila(engine, leves(engine)), filtros);
  const c = cache(engine);
  return { ...r, items: r.items.map((d) => (c.seqDe.has(d) ? tabela.decisaoPorSeq(engine.historicoH, c.seqDe.get(d)) : d)) };
}

function historicoBanco(engine) {
  return {
    noBanco: true,
    leves: () => comFila(engine, ler(engine, 'o histórico', () => leves(engine), [])),
    recentes: (n) => comFila(engine, ler(engine, 'as decisões recentes', () => recentesDoBanco(engine, n), [])).slice(0, n),
    ultimaDaChave: (key) => arquivo(engine).find((x) => x && x.key === key) || ler(engine, 'a decisão do PR', () => ultimaDoBanco(engine, key), null),
    comRetiradaPendente: () => [...arquivo(engine).filter((d) => d?.retiradaPendente), ...ler(engine, 'as retiradas pendentes', () => retiradasDoBanco(engine), [])],
    pagina: (filtros) => semLog(() => paginaNoBanco(engine, filtros)),
    todas: () => comFila(engine, ler(engine, 'o histórico', () => tabela.todasAsDecisoes(engine.historicoH).map((r) => r.item), [])),
    guardar: (item) => guardar(engine, item),
    atualizar: (item) => atualizar(engine, item),
  };
}

function recentesDoBanco(engine, n) {
  const linhas = n <= RECENTES_EM_MEMORIA ? recentes(engine).slice(0, n) : tabela.decisoesRecentes(engine.historicoH, n);
  return linhas.map((r) => r.item);
}

// A chave que o SQL não compara como o JavaScript (texto torto) sai pelo cache dos leves.
function ultimaDoBanco(engine, key) {
  if (seguroNoSql(key)) return tabela.ultimaDecisaoDaChave(engine.historicoH, key);
  return porSeq(engine, leves(engine).find((x) => x.key === key));
}

// O item inteiro de um leve do cache. `lembrar` guarda o seq do item devolvido, para o atualizar.
function porSeq(engine, leve, lembrar = false) {
  if (!leve) return null;
  const c = cache(engine);
  const seq = c.seqDe.get(leve);
  const item = tabela.decisaoPorSeq(engine.historicoH, seq);
  if (lembrar && item) c.seqDe.set(item, seq);
  return item;
}

function historicoJson(engine) {
  const lista = () => arquivo(engine);
  return {
    noBanco: false,
    leves: lista,
    recentes: (n) => lista().slice(0, n),
    ultimaDaChave: (key) => lista().find((x) => x && x.key === key) || null,
    comRetiradaPendente: () => lista().filter((d) => d?.retiradaPendente),
    pagina: (filtros) => paginaDoHistorico(lista(), filtros),
    todas: lista,
    guardar: (item) => guardar(engine, item),
    atualizar: () => true,
  };
}

function historico(engine) { return noBanco(engine) ? historicoBanco(engine) : historicoJson(engine || {}); }

// As decisões inteiras, da mais nova para a mais antiga, de onde estiverem: para teste e ferramenta.
function decisoesResolvidas(engine) { return historico(engine).todas(); }

export { historico, decisoesResolvidas, historicoIndisponivel, marcarForaDoBanco, chavesComDecisao, HIST_LIMIT, RECENTES_EM_MEMORIA };
