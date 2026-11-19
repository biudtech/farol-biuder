// "De fora da fila" (redesenho de 19/11/2026): os PRs pedidos à conta que o motor NÃO vai revisar
// sozinho, cada um com o motivo, e a retentativa por PR, as duas chaves que o Radar lê do
// snapshot (`deFora` e `emRetentativa`).
//
// É projeção do que o motor já decide, sem regra nova: a fila do motor (`queue`) não muda, e quem
// tira estes PRs da contagem da Fila é a tela. O antimeta do desenho manda no código: um PR que o
// motor ainda vai revisar sozinho nunca entra aqui (fila comum, conflito com a base, limite do
// plano, retentativa automática, PR em revisão ou esperando vaga). PR próprio também não: o motor
// nem o revisa. Rascunho não é motivo: ele não segura a primeira revisão (entra só por outro).
//
// Os motivos, na ordem de precedência quando há mais de um (decisão 1 do desenho):
//   estacionado       autoReviewParked e parkedMotivos (detalhe: tipo e motivo)
//   outra_conta       a saída de cena (skipComentado) ou a label viva de outra pessoa no item
//   decisao_de_gente  o registro de segurado-por-gente.js (quem, o estado e quando)
//   pedido_retirado   o mesmo registro
//   regra_manual      politicaDeInicio com regra manual (a origem: organização ou autor)
//   auto_desligado    politicaDeInicio com a conta sem revisar sozinha
//   ignorado          engine.ignorados cruzado com o panorama, sem data
// Os PRs candidatos são os pedidos à conta: a fila e os do panorama marcados `mine`. Regra e
// automático desligado só valem para quem está na fila, que é o que o motor revisaria sozinho.
//
// PURA sobre o engine: sem IO e sem log.
import { politicaDeInicio } from './review-scope.js';
import { ehMeu } from './pr-proprio.js';

const PARKED_MOTIVO_MAX = 200;

function emCurso(engine) {
  return new Set([
    ...(engine.headlessQueue || []).map(p => p && p.key),
    ...(engine.headlessIniciando || []),
    ...[...(engine.activeReviews?.values() || [])].flatMap(s => s.keys || []),
  ]);
}

function candidatos(engine) {
  const vistos = new Map();
  for (const pr of engine.queue || []) if (pr && pr.key && !vistos.has(pr.key)) vistos.set(pr.key, { pr, naFila: true });
  for (const pr of engine.panorama || []) if (pr && pr.key && pr.mine && !vistos.has(pr.key)) vistos.set(pr.key, { pr, naFila: false });
  return [...vistos.values()];
}

const instante = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(String(v || ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function estacionado(engine, pr) {
  if (!engine.autoReviewParked?.has(pr.key)) return null;
  const m = (engine.parkedMotivos || {})[pr.key] || {};
  return {
    motivo: 'estacionado',
    detalhe: { tipo: String(m.tipo || 'legado'), motivo: String(m.motivo || '').slice(0, PARKED_MOTIVO_MAX) },
    desde: instante(m.at), head: m.head ? String(m.head) : null,
  };
}

function outraConta(engine, pr) {
  const reg = (engine.skipComentado || {})[pr.key];
  if (reg) {
    const quem = Array.isArray(reg.quem) ? reg.quem.map(String) : [];
    return { motivo: 'outra_conta', detalhe: { fonte: 'saida_de_cena' }, desde: instante(reg.at), head: reg.head ? String(reg.head) : null, quem };
  }
  const quem = Array.isArray(pr.outrosRevisando) ? pr.outrosRevisando.map(String) : [];
  if (!quem.length) return null;
  const vistas = (engine.labelVistaDesde || {})[pr.key] || {};
  const carimbos = quem.map(q => instante(vistas[q.toLowerCase()])).filter(n => n !== null);
  return { motivo: 'outra_conta', detalhe: { fonte: 'label' }, desde: carimbos.length ? Math.min(...carimbos) : null, head: null, quem };
}

function seguradoPorGente(engine, pr, motivo) {
  const reg = engine.seguradoPorGente instanceof Map ? engine.seguradoPorGente.get(pr.key) : null;
  if (!reg || reg.motivo !== motivo) return null;
  const decisivos = (reg.decisivos || []).map(d => ({ quem: d.quem, estado: d.estado, em: d.em }));
  const base = { motivo, desde: instante(reg.desde), head: reg.head || null };
  if (motivo === 'pedido_retirado') return { ...base, detalhe: {} };
  return { ...base, detalhe: { decisivos }, quem: decisivos.map(d => d.quem) };
}

function regra(engine, pr, naFila) {
  if (!naFila) return null;
  // a retentativa automática retoma sozinha mesmo com a conta só na fila (review-retry.js)
  const politica = politicaDeInicio(engine, pr, { retry: !!engine.retryAfterNet?.has(pr.key) });
  if (politica.automatic) return null;
  if (politica.reason === 'auto_desligado') return { motivo: 'auto_desligado', detalhe: {}, desde: null, head: null };
  const detalhe = { source: politica.source };
  if (politica.organization) detalhe.organization = politica.organization;
  if (politica.author) detalhe.author = politica.author;
  return { motivo: 'regra_manual', detalhe, desde: null, head: null };
}

function ignorado(engine, pr) {
  return engine.ignorados?.has(pr.key) ? { motivo: 'ignorado', detalhe: {}, desde: null, head: null } : null;
}

function motivoDoPr(engine, pr, naFila) {
  return estacionado(engine, pr)
    || outraConta(engine, pr)
    || seguradoPorGente(engine, pr, 'decisao_de_gente')
    || seguradoPorGente(engine, pr, 'pedido_retirado')
    || regra(engine, pr, naFila)
    || ignorado(engine, pr);
}

function deForaParaTela(engine) {
  const ocupados = emCurso(engine);
  const out = [];
  for (const { pr, naFila } of candidatos(engine)) {
    if (ocupados.has(pr.key) || ehMeu(engine, pr)) continue;
    const m = motivoDoPr(engine, pr, naFila);
    if (!m) continue;
    const { quem, ...resto } = m;
    out.push({
      key: pr.key, url: String(pr.url || ''), title: String(pr.title || ''), author: String(pr.author || ''),
      repo: String(pr.repo || ''), number: Number(pr.number) || 0,
      ...resto, ...(quem ? { quem } : {}),
    });
  }
  return out;
}

// { key: { tentativas, aPartirDe } } da retentativa por PR (engine.retryAfterNet): `aPartirDe` é
// a hora em que a retentativa pode rodar (o reset do limite do plano), ou null quando já pode.
function emRetentativaParaTela(engine) {
  const out = {};
  for (const [key, v] of engine.retryAfterNet || []) {
    out[key] = { tentativas: Number(v?.tries) || 0, aPartirDe: instante(v?.notBefore) };
  }
  return out;
}

export { deForaParaTela, emRetentativaParaTela };
