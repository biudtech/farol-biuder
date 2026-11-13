// Camada de consulta ao GitHub via gh (Onda 2, colaborador). O análogo dos "selectors"
// do lace: só leitura, zero tokens de IA, devolve estrutura normalizada. Funções recebem
// o engine como ctx (pra token/conta/cache); a Engine mantém fachadas finas. Ver docs/QUALITY.md.
import io from '../io.js';
import contasGh from './contas-gh.js';
import limiteGh from './limite-gh.js';
import orcamento from './orcamento-busca.js';
import orgSemAcesso from './org-sem-acesso.js';
import contaEntreAparelhos from './conta-entre-aparelhos.js';

// Espera a vez desta conta no orçamento de busca e carimba o gasto. O registro vive no
// engine (memória de processo, como o limite-gh: reabrir o Farol custa uma busca, não
// uma cota). `dormir` é injetável só para o teste não gastar tempo de relógio real.
function registroDeBusca(engine) {
  if (!(engine.buscasGh instanceof Map)) engine.buscasGh = new Map();
  return engine.buscasGh;
}

async function aguardarAVez(engine, user, dormir = (ms) => new Promise(r => setTimeout(r, ms))) {
  const reg = registroDeBusca(engine);
  // a conta pode estar em outros aparelhos do conjunto: o teto do GitHub é dela, não deste
  const espera = orcamento.esperaAntesDaBusca(reg, user, Date.now(), contaEntreAparelhos.aparelhosComAConta(engine, user));
  if (espera > 0) await dormir(espera);
  // carimba DEPOIS da espera: a janela tem que contar o instante em que a busca sai,
  // não o instante em que ela foi pedida
  orcamento.registrarBusca(reg, user);
}

async function searchPRs(engine, extraArgs, user, agora = Date.now()) {
  // conta no limite de requisicoes do GitHub: nem tenta. Insistir falha E consome cota,
  // entao a tentativa prolonga o proprio bloqueio (lib/engine/limite-gh.js). Devolve null,
  // que e o mesmo contrato de falha de busca: o check() preserva o que ja sabia.
  if (limiteGh.emEspera(engine, user, agora)) return null;
  // conta pedida sem token: NÃO busca com outra identidade (o @me resolveria na conta
  // errada e o resultado pareceria válido, M11). Trata como falha de busca (null),
  // que o check() já preserva. A frase "sem token no gh" é contrato (retry transitório).
  if (!engine.tokenFor(user)) {
    contasGh.avisarSemToken(engine, user, `gh search pulado (${user || 'primaria'} sem token no gh)`);
    return null;
  }
  // `labels` viaja desde a v2.48.4 pro gate de "outra pessoa já está revisando"
  // (lib/engine/skip-review.js). A label `<conta>:revisando` é o sinal ESCRITO
  // desde 28/08/2026 à tarde. Vem da MESMA chamada, sem custo de rede extra; só
  // o nome de cada label entra no objeto, porque cor/id/descrição não decidem
  // nada e o objeto do PR vai cru pro snapshot da UI a cada push.
  const args = ['search', 'prs', ...extraArgs, '--state', 'open', '--limit', '100',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt,labels'];
  // ESPERA A VEZ desta conta antes de gastar (lib/engine/orcamento-busca.js, que tem a
  // medição). O ciclo pede 14 buscas quase juntas e o limite de busca do GitHub é por
  // MINUTO: sem isto, o que sai é rajada, e rajada vira 403 que só prolonga o bloqueio.
  await aguardarAVez(engine, user);
  const r = await io.run('gh', args, { env: engine.ghEnv(user) });
  if (!r.ok) {
    if (await limiteGh.tratarFalhaDeBusca(engine, user, r.stderr, agora)) return null;
    if (orgSemAcesso.registrarFalha(engine, user, extraArgs, r.stderr)) return null;
    engine.log('WARN', `gh search falhou (${user || 'primaria'}: ${extraArgs.join(' ')}): ${r.stderr.trim().slice(0, 300)}`);
    return null;
  }
  let items;
  try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
  orgSemAcesso.registrarSucesso(engine, user, extraArgs);
  // o gh corta no --limit sem avisar e, com best-match como ordenação, QUAIS 100
  // entram é imprevisível: um PR pedido a mim pode ficar fora do radar em silêncio.
  // O teto é da API de search (não dá pra subir), então pelo menos deixa rastro.
  // Medido nos itens CRUS (antes dos filtros): o corte aconteceu no gh, não aqui.
  // O retorno fica intacto (4 chamadores no check()) e o sinal vai pro log.
  if (items.length >= 100) {
    engine.log('WARN', `gh search no teto do --limit 100 (${user || 'primaria'}: ${extraArgs.join(' ')}): pode haver PRs fora do radar`);
  }
  const acc = user || engine.primaryUser();
  const me = (acc || '').toLowerCase();
  // rascunhos ENTRAM no radar e na fila (pedido do Wanderson em 15/08/2026, fluxo
  // da empresa: PR nasce draft e o review precisa acontecer antes do ready). O
  // isDraft viaja no objeto pro selo "rascunho" na UI; o merge de rascunho segue
  // bloqueado no mergeSelfPR, que revalida pelo estado real na hora do clique.
  return items
    .filter(p => ((p.author && p.author.login) || '').toLowerCase() !== me)
    .map(p => ({
      key: `${p.repository.nameWithOwner}#${p.number}`,
      url: p.url,
      title: p.title,
      author: (p.author && p.author.login) || '',
      repo: p.repository.nameWithOwner,
      number: p.number,
      updatedAt: p.updatedAt,
      isDraft: !!p.isDraft,
      labels: labelNames(p.labels),
      account: acc
    }));
}

// só os NOMES das labels, que é o que o gate de pulo lê. Entrada torta (campo
// ausente, item sem name) vira lista vazia em vez de derrubar a busca inteira.
function labelNames(labels) {
  return Array.isArray(labels) ? labels.map(l => String((l && l.name) || '')).filter(Boolean) : [];
}

// PRs abertos de AUTORIA minha (fonte da autoanalise). Diferente de searchPRs:
// nao filtra a mim (obvio) e MANTEM rascunhos (autoanalisar um draft antes de
// marcar ready e justamente o uso principal). So leitura, zero tokens de IA.
async function myAuthoredPRs(engine, user, agora = Date.now()) {
  const acc = user || engine.primaryUser();
  const me = (acc || '').toLowerCase();
  if (!me) return null;
  if (limiteGh.emEspera(engine, user, agora)) return null;
  if (!engine.tokenFor(user)) {
    contasGh.avisarSemToken(engine, user, `gh search prs --author @me pulado (${acc} sem token no gh)`);
    return null;
  }
  await aguardarAVez(engine, user);
  const r = await io.run('gh', ['search', 'prs', '--author', '@me', '--state', 'open', '--limit', '50',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt'], { env: engine.ghEnv(user) });
  if (!r.ok) {
    if (await limiteGh.tratarFalhaDeBusca(engine, user, r.stderr, agora)) return null;
    engine.log('WARN', `gh search prs --author @me (${acc}) falhou: ${r.stderr.trim().slice(0, 300)}`);
    return null;
  }
  let items;
  try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
  return items.map(p => ({
    key: `${p.repository.nameWithOwner}#${p.number}`,
    url: p.url,
    title: p.title,
    author: (p.author && p.author.login) || me,
    repo: p.repository.nameWithOwner,
    number: p.number,
    updatedAt: p.updatedAt,
    isDraft: !!p.isDraft,
    account: acc
  }));
}

// Estado atual do PR no GitHub (OPEN/CLOSED/MERGED). null = nao deu pra confirmar
// (sem token da conta ou falha de rede/gh): quem chama NUNCA trata null como "ainda
// aberto" nem como "mergeado", só como "sem prova ainda" (mesma regra de
// myReviewsWithTime em decision.js). Existe pra runOneHeadless e reconcilePending
// cancelarem revisão/pendência de PR que já foi mergeado por fora (outro revisor,
// merge manual, self-merge), em vez de postar review num PR fechado.
async function prState(engine, pr) {
  const lido = await prEstadoELabels(engine, pr);
  return lido ? lido.estado : null;
}

// A mergeabilidade do PR com a base (C2): 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN', ou null quando
// não deu pra ler. Quem chama só segura por 'CONFLICTING'; os outros valores nunca seguram.
async function mergeavelDoPr(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await io.run('gh', ['pr', 'view', url, '--json', 'mergeable'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout || '{}');
  const v = String((j && j.mergeable) || '');
  return v === 'CONFLICTING' || v === 'MERGEABLE' || v === 'UNKNOWN' ? v : null;
}

// O estado e as labels do PR numa chamada só (o vigia da sessão precisa dos dois a cada
// tique, e uma segunda chamada seria custo por tique). null = não deu pra confirmar, com a
// mesma regra do prState; `labels` é a lista de nomes (vazia quando o PR não tem nenhuma).
async function prEstadoELabels(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await io.run('gh', ['pr', 'view', url, '--json', 'state,labels'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout || '{}');
    const estado = String(j.state || '');
    if (!estado) return null;
    const labels = Array.isArray(j.labels) ? j.labels.map((l) => String((l && l.name) || '')).filter(Boolean) : [];
    return { estado, labels };
  } catch { return null; }
}

// Quem pediu a revisão da conta e quando (B1): UMA leitura da timeline por sessão automática,
// nunca por ciclo. Devolve o último `review_requested` dirigido à conta (sem diferenciar caixa)
// ou a um time, no formato { por, em (ISO), time }. null = não deu pra identificar (sem token,
// falha do gh, nenhum pedido na timeline); a tela diz "pedido não identificado", nunca inventa ator.
const JQ_PEDIDOS = '.[] | select(.event=="review_requested") | {por: .actor.login, em: .created_at, rev: .requested_reviewer.login, time: .requested_team.slug}';
async function ultimoPedidoDeRevisao(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!acc || !engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${pr.repo}/issues/${pr.number}/timeline?per_page=100`, '--paginate', '--jq', JQ_PEDIDOS], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const eu = String(acc).toLowerCase();
  let ultimo = null;
  for (const linha of String(r.stdout || '').split('\n')) {
    if (!linha.trim()) continue;
    const e = io.parseJson(linha);
    if (!e) continue;
    const time = !!e.time;
    if (!e.por || !e.em || !(time || String(e.rev || '').toLowerCase() === eu)) continue;
    if (!ultimo || String(e.em) >= ultimo.em) ultimo = { por: String(e.por), em: String(e.em), time };
  }
  return ultimo;
}

// SHA do head atual do PR. '' = nao deu pra confirmar (sem token, rede, gh), e quem
// chama trata isso como "nao sei separar rodada" e degrada pro comportamento anterior,
// nunca como "head novo" (que faria repostar review a cada falha de rede).
// Existe pra dar NOCAO DE ROUND a quem precisa: o dedup de postagem compara este sha
// com o commit_id do review que eu ja postei, e o carimbo do checkpoint de verificacao
// sai daqui tambem (antes o runHeadlessReview montava a mesma chamada na mao).
async function headSha(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return '';
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await io.run('gh', ['pr', 'view', url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(acc) });
  if (!r.ok) return '';
  return String(r.stdout || '').trim();
}

// Fontes da chave do card: título, branch e corpo. Conta dona e token resolvidos
// como em prState e headSha: buscar com outra identidade devolveria resultado que
// PARECE válido. Falha degrada pra vazio, porque card não verificável já é estado
// previsto do fluxo, e derrubar a revisão inteira por causa disso seria pior.
//
// io.parseJson, não JSON.parse: os cinco JSON.parse deste arquivo são dívida
// travada na baseline do gate, e um sexto reprova por regressão.
async function prCardSources(engine, pr) {
  const vazio = { title: '', headRefName: '', body: '' };
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return vazio;
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await io.run('gh', ['pr', 'view', url, '--json', 'title,headRefName,body'], { env: engine.ghEnv(acc) });
  if (!r.ok) {
    engine.log('WARN', `metadados do PR ${pr.repo}#${pr.number} indisponíveis, card fica não verificável: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return vazio;
  }
  const dados = io.parseJson(r.stdout, null) || {};
  return { title: String(dados.title || ''), headRefName: String(dados.headRefName || ''), body: String(dados.body || '') };
}

const ghQueries = { searchPRs, myAuthoredPRs, prState, prEstadoELabels, mergeavelDoPr, headSha, ultimoPedidoDeRevisao, prCardSources };
export default ghQueries;
export { searchPRs, myAuthoredPRs, prState, prEstadoELabels, mergeavelDoPr, headSha, ultimoPedidoDeRevisao, prCardSources };
