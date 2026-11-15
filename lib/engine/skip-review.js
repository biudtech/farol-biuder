/* UM Farol por PR (v2.50.1, decisão do Wanderson em 20/08/2026).

   A v2.49.0 estreou o pulo por label e ele estava ERRADO de origem. A label
   `<conta>:revisando` é um marcador TRANSITÓRIO: o próprio Farol a remove ao fim
   da sessão. Gatear nela respondia "tem alguém revisando neste segundo", e essa
   resposta volta a ser "não" em minutos. Medido no biudtech/engine-ai#60:

     18:48:42  label do thiagocarvalho-dev entra
     18:50:29  Farol do Alexpraxedes comenta "não vou duplicar a revisão"
     18:52:15  label do thiagocarvalho-dev SAI (a revisão dele terminou)
     18:55:46  Farol do Alexpraxedes entra e revisa
     18:59:09  Alexpraxedes APROVA

   Ou seja: o pulo era um adiamento de cinco minutos com uma promessa pública
   quebrada em cima. Pior, quem se calou era o CODEOWNERS do repo (`* @Alexpraxedes`).

   O que vale agora: ver a label de outra pessoa faz o Farol SAIR DE CENA naquele
   head, de forma DURÁVEL, e é isso que o comentário passa a descrever com verdade.
   Ele não revisa depois: fica de fora e o PR espera você. O clique manual em
   Revisar sempre funciona e nunca passa por este gate. (A co-assinatura, que aprovava
   em seu nome quando quem pegou o PR aprovava, saiu no corte da fase 1.)

   CADUCIDADE (a rede de segurança): se a label da outra pessoa sumiu e ela NÃO
   postou review nenhum naquele head, a sessão dela morreu no meio. Aí a saída de
   cena caduca e o Farol volta a revisar normalmente, senão um crash na máquina
   do colega deixaria o PR órfão pra sempre.

   LIMITE CONHECIDO: dois Farols que começam no mesmo segundo não se veem (nenhum
   dos dois tem sinal ainda) e os dois revisam. O sinal reduz duplicata, não é
   trava distribuída, e fingir o contrário seria mentira.

   CAPÍTULO DE 28/08/2026 (duas decisões do Wanderson no MESMO dia):
   - De manhã (incidente do biud-frontend#845), a label pública
     `<conta>:revisando` foi tratada como vazamento e a v2.53.9 a trocou por
     refs git invisíveis, matando junto o COMENTÁRIO público de pulo (template
     fixo, a mesma frase saindo de contas diferentes minutos depois do sinal
     alheio subir, denunciava a ferramenta).
   - À tarde ele corrigiu o rumo: a label visível é DESEJADA ("deixa os demais
     membros cientes da revisão") e voltou a ser o sinal ESCRITO (lib/engine/
     review.js). O que continua proibido é TEXTO público não-humanizado: o
     comentário de pulo segue morto, a saída de cena segue SILENCIOSA no GitHub
     (a âncora nasce da DECISÃO e o aviso é um toast no app), e o firewall de
     linguagem dos reviews fica como está.
   O sinal de "revisando agora" é a label `<login>:revisando` (chega de graça no campo
   labels do gh search prs). As refs git da v2.53.9, que ficaram por um tempo como
   leitura de transição, saíram no corte da fase 1.

   Na MESMA tarde nasceu o gate de CONSCIÊNCIA do review automático (a regra do
   Wanderson: "se alguém já aprovou, se alguém tá revisando e se alguém já
   reprovou que não seja o acrity, não fazemos review a menos que haja ação
   manual"): ver bloqueadoPorHistorico/bloqueiaAutomatico no fim deste arquivo. */
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { writeJsonAtomic } from '../io.js';
import { pedidoMeuAberto, seguradoPeloPedido, lembrarSegurado } from './pedido-de-revisao.js';
import { pausaDaObservacao } from './relogio-da-label.js';
import { avisaBloqueioChecks, aguardaChecksParaRevisar } from './checks-exigidos.js';
import { largarSeHeadMudou } from './head-novo.js';

const SKIP_FILE = path.join(STATE_DIR, 'skip-comentado.json');
const SUFIXO = ':revisando';

// Contas que carregam label no formato de pessoa mas NÃO são pessoas: review de
// ferramenta não dispensa olho humano, então ver a label dela não pode calar o Farol.
// A grafia aqui é a do PREFIXO DA LABEL (`acrity:approved`), que é curto; o login
// da mesma ferramenta na API de reviews é outro e mais longo, e é `ehFerramenta`
// quem faz as duas grafias se encontrarem.
const NAO_SAO_PESSOAS = new Set(['acrity']);

/* É ferramenta, e não gente? Três provas independentes, de propósito (o gate
   erra pro lado seguro: ferramenta contada como pessoa SEGURA a revisão
   automática, e foi exatamente isso que aconteceu).

   INCIDENTE QUE ORIGINOU (biudtech/engine-ai#108, 29/08/2026): a lista acima
   guarda `acrity`, que é o prefixo da LABEL. Na API de reviews o mesmo Acrity
   aparece como `acrity-advesarial-code-review[bot]`, então o `has()` cru dava
   falso, a reprovação dele contou como reprovação de gente e o gate de
   consciência segurou a revisão automática do time num PR inteiro, em silêncio.
   As fixtures da suíte usavam o prefixo curto, então nada ficou vermelho.

   As três provas:
   1. `type` do autor igual a `Bot` (a API do GitHub diz na letra; vale pra
      QUALQUER ferramenta, inclusive as que ninguém cadastrou nesta lista);
   2. login terminado em `[bot]` (a mesma verdade sem depender da projeção do
      jq, pra cópia velha do Farol e pra chamador que só tem o login);
   3. o nome, ou um login que COMEÇA com o nome mais hífen (`acrity` casa
      `acrity-advesarial-code-review`), que é o caso da ferramenta rodando sob
      conta comum, onde o GitHub não marca `Bot` nenhum.
   PURA. `tipo` é opcional: quem só tem o login passa um argumento só. */
function ehFerramenta(login, tipo) {
  if (String(tipo || '').trim().toLowerCase() === 'bot') return true;
  const bruto = String(login || '').trim().toLowerCase();
  if (!bruto) return false;
  if (bruto.endsWith('[bot]')) return true;
  if (NAO_SAO_PESSOAS.has(bruto)) return true;
  for (const nome of NAO_SAO_PESSOAS) if (bruto.startsWith(`${nome}-`)) return true;
  return false;
}


/* ---------- leitura dos sinais (PURA) ---------- */

// Quem MAIS está revisando agora SEGUNDO AS LABELS, tirando a minha conta e as
// ferramentas. Desde a tarde de 28/08/2026 a label voltou a ser o sinal ESCRITO
// por esta versão (lib/engine/review.js), então esta é a fonte principal. Ordem
// estável porque a lista entra em texto visível, que não pode variar por sorte
// do gh. Comparação sem caixa: o GitHub preserva a caixa do login.
function revisandoPorOutros(labels, minhaConta, vistas, agora, ttlMs) {
  const me = String(minhaConta || '').trim().toLowerCase();
  const relogio = (vistas && typeof vistas === 'object') ? vistas : null;
  const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : 0;
  const t = Number(agora) || 0;
  const achados = new Set();
  for (const nome of Array.isArray(labels) ? labels : []) {
    const texto = String(nome || '');
    if (!texto.toLowerCase().endsWith(SUFIXO)) continue;
    const login = texto.slice(0, -SUFIXO.length).trim();
    if (!login) continue;
    const chave = login.toLowerCase();
    if (chave === me || ehFerramenta(login)) continue;
    if (labelOrfa(relogio, chave, t, ttl)) continue;
    achados.add(login);
  }
  return [...achados].sort((a, b) => a.localeCompare(b));
}

/* A label deste login já passou da validade? PURA. Sem relógio, sem TTL ou sem
   carimbo devolve false: a label vale, que é o comportamento de sempre e o lado
   seguro (falta de dado nunca libera revisão sozinha). O carimbo do FUTURO
   (relógio da máquina andou pra trás) também não expira, mesma régua do
   sinalVivo das refs. */
function labelOrfa(vistas, chaveLogin, agora, ttlMs) {
  if (!vistas || !ttlMs || !agora) return false;
  const desde = Number(vistas[chaveLogin]);
  if (!Number.isFinite(desde) || desde <= 0) return false;
  return (agora - desde) >= ttlMs;
}

/* Carimba, por PR, desde quando ESTE Farol vê cada label `<login>:revisando` de
   outra pessoa. É o relógio que faltava: a label não carrega hora nenhuma e
   perguntar ao GitHub quando ela entrou custaria uma chamada por PR por ciclo.
   O carimbo é local, monotônico e auto-limpante:
   - primeira observação carimba `agora`;
   - observação seguinte da MESMA label PRESERVA o carimbo (é isso que faz o
     tempo passar);
   - label que sumiu do PR perde o carimbo, então uma sessão nova do colega
     recomeça o relógio do zero;
   - PR que saiu do panorama perde tudo, mesmo critério de poda do resto.
   Roda uma vez por ciclo de polling, sobre os labels que a busca já trouxe. */
// Os dois retratos de carimbo são iguais? PURA. Serve só pra decidir se vale
// gravar em disco; nada de decisão de revisão passa por aqui.
function mesmosCarimbos(antes, depois) {
  if (!antes || typeof antes !== 'object') return false;
  const a = Object.keys(antes), d = Object.keys(depois);
  if (a.length !== d.length) return false;
  return d.every(k => antes[k] === depois[k]);
}

function marcarLabelsVistas(engine, panorama, agora = Date.now()) {
  if (!engine.labelVistaDesde || typeof engine.labelVistaDesde !== 'object') engine.labelVistaDesde = {};
  const pausa = pausaDaObservacao(engine, agora);
  const mapa = engine.labelVistaDesde;
  const vivos = new Set();
  let mudou = false;
  for (const pr of Array.isArray(panorama) ? panorama : []) {
    if (!pr || !pr.key) continue;
    vivos.add(pr.key);
    const minha = String(engine.accountForPr(pr) || '').trim().toLowerCase();
    const agoraNoPr = {};
    for (const nome of Array.isArray(pr.labels) ? pr.labels : []) {
      const texto = String(nome || '');
      if (!texto.toLowerCase().endsWith(SUFIXO)) continue;
      const chave = texto.slice(0, -SUFIXO.length).trim().toLowerCase();
      if (!chave || chave === minha || ehFerramenta(chave)) continue;
      const anterior = Number((mapa[pr.key] || {})[chave]);
      agoraNoPr[chave] = Number.isFinite(anterior) && anterior > 0 ? Math.min(anterior + pausa, agora) : agora;
    }
    const tem = Object.keys(agoraNoPr).length > 0;
    if (!tem) {
      if (mapa[pr.key] !== undefined) { delete mapa[pr.key]; mudou = true; }
      continue;
    }
    if (mesmosCarimbos(mapa[pr.key], agoraNoPr)) continue;
    mapa[pr.key] = agoraNoPr;
    mudou = true;
  }
  for (const key of Object.keys(mapa)) {
    if (!vivos.has(key)) { delete mapa[key]; mudou = true; }
  }
  if (mudou && typeof engine.saveLabelVistaDesde === 'function') engine.saveLabelVistaDesde();
}

// Gate SÍNCRONO e sem IO (mesmo contrato do reReviewTargets: quem decide gastar
// sessão Claude tem que ser testável sem rede). Lê só o que os ciclos anteriores
// já trouxeram: as labels do gh search prs.
function outrosRevisando(engine, pr) {
  return revisandoPorOutros(pr && pr.labels, engine.accountForPr(pr),
    (engine.labelVistaDesde || {})[pr && pr.key], Date.now(), TEMPOS.SINAL_REVISAO_TTL_MS);
}

/* ---------- quem segura os gates ----------
   `outrosRevisando` é a resposta de "quem está revisando" (é ela que a tela mostra);
   `outrosQueSeguram` é a que os GATES leem. Lê pela fachada do engine quando ela existe
   (é a que a suíte substitui), senão direto. */
function outrosQueSeguram(engine, pr) {
  return typeof engine.outrosRevisando === 'function' ? engine.outrosRevisando(pr) : outrosRevisando(engine, pr);
}

// Anota em cada PR quem MAIS está revisando, para a tela avisar no card. É a mesma
// leitura do gate (label viva, sem a minha conta e sem ferramenta), nunca uma releitura
// das labels do lado da tela.
// `foraDeCena` vai junto, por allowlist: com a label já sumida, é ele que diz "fulano
// revisou e eu fiquei de fora" (a âncora que caducou sem review já foi apagada no ciclo).
function anotarOutrosRevisando(engine, prs) {
  for (const pr of new Set(prs || [])) {
    if (!pr || typeof pr !== 'object') continue;
    pr.outrosRevisando = engine.outrosRevisando(pr);
    pr.foraDeCena = foraDeCenaParaTela((engine.skipComentado || {})[pr.key]);
  }
}

function foraDeCenaParaTela(reg) {
  if (!reg) return null;
  const quem = Array.isArray(reg.quem) ? reg.quem.map(String) : [];
  return { quem, desde: Number(reg.at) || 0 };
}

// O passo de sinais do ciclo, na ordem que os gates síncronos precisam: o relógio das
// labels alheias (marcarLabelsVistas) carimba ANTES de qualquer gate ler outrosRevisando,
// e cada PR leva a lista para a tela.
function lerSinaisDoCiclo(engine, panorama, queue) {
  marcarLabelsVistas(engine, panorama);
  anotarOutrosRevisando(engine, [...(panorama || []), ...(queue || [])]);
}

/* ---------- textos ---------- */

// Desde 28/08/2026 este texto alimenta só o TOAST no app (o comentário público
// de pulo morreu, ver o cabeçalho). A régua de redação continua a mesma: sem
// citar automação, sem travessão, e sem pronome de gênero pra quem o app não
// tem como saber.
function textoDoPulo(outros) {
  const nomes = (outros || []).map(u => `@${u}`);
  if (!nomes.length) return '';
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const verbo = nomes.length === 1 ? 'já está revisando' : 'já estão revisando';
  return `Vi que ${lista} ${verbo} este PR, então não vou duplicar a revisão.`;
}

/* ---------- estado ---------- */

function loadSkipComentado(log) {
  const bruto = io.readJson(SKIP_FILE, {}, log);
  return (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
}

function saveSkipComentado(engine) {
  try { writeJsonAtomic(SKIP_FILE, engine.skipComentado || {}); }
  catch (err) { engine.log('WARN', `salvar skip-comentado: ${err.message}`); }
}

/* ---------- saída de cena ---------- */

// Grava a âncora POR HEAD e avisa NO APP, sem postar nada no GitHub. O contrato
// antigo ("a âncora só nasce de um comentário que SAIU") morreu junto com o
// comentário público em 28/08/2026: agora a âncora nasce da DECISÃO de sair de
// cena, e quem avisa é o toast. A exigência que fica é `outros` não vazio (sair
// de cena por ninguém não é decisão, é bug do chamador).
async function saiDeCena(engine, pr, outros, head) {
  const texto = textoDoPulo(outros);
  if (!texto) return false;
  engine.skipComentado[pr.key] = { head: head || '', quem: outros, at: Date.now() };
  saveSkipComentado(engine);
  engine.emit('toast', { kind: 'info', text: `${texto} (${pr.key}: saí de cena sem postar nada público no GitHub)` });
  return true;
}

// Reviews postados por OUTRAS pessoas naquele head. null = não deu pra confirmar
// (rede, token), e nesse caso nada caduca: falta de prova nunca vira ação.
async function reviewsDeOutros(engine, pr, head) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me || !engine.tokenFor(acc)) return null;
  // `tipo` (.user.type) viaja junto desde 29/08/2026 pra ehFerramenta ter a prova
  // que o GitHub já dá de graça: ferramenta nova não precisa entrar em lista nenhuma.
  const jq = `[.[] | select((.user.login | ascii_downcase) != "${me}") | {quem: .user.login, tipo: .user.type, state, commit_id}]`;
  const r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews?per_page=100`, '--jq', jq], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const raw = io.parseJson(r.stdout, null);
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(x => reviewNoHead(x, head))
    .map(x => ({ quem: String(x.quem || ''), tipo: String(x.tipo || ''), state: String(x.state || ''), commit: String(x.commit_id || '') }));
}

// Leitura tolerante: head vazio ou review sem commit_id entram, porque a falta de dado já
// pende para o lado seguro (ninguém caduca, ninguém é liberado).
function reviewNoHead(x, head) {
  return !head || !x.commit_id || x.commit_id === head;
}

// PURA: a saída de cena caducou? Sim quando a pessoa por quem eu saí não está
// mais com a label E não deixou review naquele head
// (a sessão dela morreu no meio). Sem a lista de reviews (rede fora), NUNCA
// caduca: na dúvida, fico fora, que é o lado seguro de "um Farol por PR".
function standDownCaducou(registro, aindaRevisando, reviews) {
  if (!registro || !Array.isArray(reviews)) return false;
  const quem = (registro.quem || []).map(u => String(u).toLowerCase());
  if (!quem.length) return false;
  const comLabel = new Set((aindaRevisando || []).map(u => String(u).toLowerCase()));
  const comReview = new Set(reviews.map(r => String(r.quem).toLowerCase()));
  return quem.every(u => !comLabel.has(u) && !comReview.has(u));
}

/* ---------- orquestração por ciclo ---------- */

// PR que já tem saída de cena registrada NAQUELE head: decide entre caducar (volta
// a revisar) ou seguir fora. Devolve true quando o PR deve continuar FORA da fila de revisão.
async function seguirForaDeCena(engine, pr, registro, head) {
  if (largarSeHeadMudou(engine, pr.key, head)) return false;
  const reviews = await reviewsDeOutros(engine, pr, head);
  if (standDownCaducou(registro, outrosRevisando(engine, pr), reviews)) {
    delete engine.skipComentado[pr.key];
    saveSkipComentado(engine);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: a revisão de quem tinha pegado não saiu, então assumi de volta.` });
    return false;
  }
  return true;
}

// Poda a âncora dos PRs que saíram do panorama, no mesmo compromisso do
// reReviewLaunched: busca parcialmente falha pode custar UM comentário repetido,
// nunca um comentário perdido.
function podarSkipComentado(engine, abertos) {
  let mudou = false;
  for (const key of Object.keys(engine.skipComentado || {})) {
    if (!abertos.has(key)) { delete engine.skipComentado[key]; mudou = true; }
  }
  if (mudou) saveSkipComentado(engine);
}

/* ---------- gate de consciência do review automático (28/08/2026 à tarde) ----------
   A regra do Wanderson: "se alguém já aprovou, se alguém tá revisando e se
   alguém já reprovou que não seja o acrity, não fazemos review a menos que haja
   ação manual. Se ninguém está revisando e não temos histórico de review no
   head ativo então devemos seguir na revisão automatizada, claro se for essa a
   configuração aplicada." A metade do "tá revisando" já mora acima
   (outrosRevisando/saiDeCena); daqui pra baixo é a metade do HISTÓRICO. */

// O head ATIVO do PR já tem histórico que segura o automático? Decisivo é
// APPROVED ou CHANGES_REQUESTED; DISMISSED e COMMENTED não contam, e as contas
// de NAO_SAO_PESSOAS (ferramenta) também não (comparação sem caixa). Cada pessoa
// conta pelo ÚLTIMO estado decisivo dela no head. Regra do dono (05/11/2026): qualquer aprovação
// ou recusa de gente no head segura, porque PR com head decidido não é reanalisado (medido: 81 de
// 225 revisões rodavam assim). A exceção é o meu pedido automático aberto em commit anterior
// (`pedidoMeuAberto`, pedido-de-revisao.js): a rodada roda para retirá-lo, sem aprovar por cima.
// Head
// novo zera o histórico por construção: reviewsDeOutros filtra por
// commit_id === head.
// Custo: no MÁXIMO 2 chamadas gh (headSha + a lista de reviews), e ela SÓ roda
// na boca do lançamento automático (bloqueiaAutomatico), nunca por ciclo em todo
// PR do panorama. Falta de dado NUNCA bloqueia (rede, sem token, head
// desconhecido devolvem o caminho livre): o pior caso de deixar passar é uma
// revisão redundante, nunca um post errado (o gate de postagem e o dedup por
// head continuam na frente de qualquer escrita).
async function bloqueadoPorHistorico(engine, pr) {
  let head = '';
  try { head = String((await engine.headSha(pr)) || '').trim(); }
  catch { head = ''; }
  if (!head) return { bloqueado: false, head: '', quem: [], decisivos: [] };
  const reviews = await reviewsDeOutros(engine, pr, head);
  if (!Array.isArray(reviews)) return { bloqueado: false, head, quem: [], decisivos: [] };
  // reduz ao ÚLTIMO estado decisivo POR PESSOA (a lista vem em ordem de
  // submissão, então a entrada mais nova vence): quem pediu mudanças e depois
  // aprovou o mesmo head conta como aprovação, nunca como as duas coisas.
  const porPessoa = new Map(); // chave minúscula -> { quem: primeira grafia, state: último decisivo }
  for (const r of reviews) {
    if (r.state !== 'APPROVED' && r.state !== 'CHANGES_REQUESTED') continue;
    const login = String(r.quem || '').trim();
    if (!login || ehFerramenta(login, r.tipo)) continue;
    const chave = login.toLowerCase();
    const atual = porPessoa.get(chave);
    porPessoa.set(chave, { quem: atual ? atual.quem : login, state: r.state });
  }
  const finais = [...porPessoa.values()];
  const reprovadores = finais.filter(p => p.state === 'CHANGES_REQUESTED');
  const aprovadores = finais.filter(p => p.state === 'APPROVED');
  const responsaveis = [...aprovadores, ...reprovadores];
  return {
    // `decidido` é o fato; `bloqueado` é se a rodada não roda, e a exceção mora só nele
    decidido: responsaveis.length > 0, bloqueado: responsaveis.length > 0 && (reprovadores.length > 0 || !pedidoMeuAberto(engine, pr, head)),
    head,
    quem: responsaveis.map(p => p.quem).sort((a, b) => a.localeCompare(b)),
    // os estados viajam junto pro toast acertar a concordância (aprovou x
    // pediu mudanças); quem consome a decisão usa só `bloqueado`
    decisivos: responsaveis.map(p => ({ quem: p.quem, state: p.state })),
    // quem pediu mudanças neste head: o log da espera e o card dizem
    pediramMudancas: reprovadores.map(p => p.quem).sort((a, b) => a.localeCompare(b)),
  };
}

// Texto do toast do bloqueio por histórico. PURA, mesma régua de redação do
// textoDoPulo: português, sem travessão, sem pronome de gênero.
function textoDoBloqueio(key, hist) {
  const nomes = ((hist && hist.quem) || []).map(u => `@${u}`);
  if (!nomes.length) return '';
  let lista = nomes[0];
  if (nomes.length > 1) lista = `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const estados = new Set(((hist && hist.decisivos) || []).map(d => d.state));
  const um = nomes.length === 1;
  let verbo;
  if (estados.size === 1 && estados.has('APPROVED')) {
    verbo = um ? 'já aprovou este head' : 'já aprovaram este head';
  } else if (estados.size === 1 && estados.has('CHANGES_REQUESTED')) {
    verbo = um ? 'já pediu mudanças neste head' : 'já pediram mudanças neste head';
  } else {
    verbo = um ? 'já revisou este head' : 'já revisaram este head';
  }
  return `${key}: ${lista} ${verbo}, então a revisão automática não é necessária (o botão Revisar continua valendo).`;
}

// Aviso ÚNICO por PR+head (Set em memória, engine.historicoAvisado): o mesmo PR
// pode voltar à boca do lançamento em ciclos seguintes, e o que a pessoa precisa
// saber cabe num toast só. Head novo zera o aviso do PR (a chave carrega o head,
// e as chaves velhas do mesmo PR são apagadas na entrada).
function avisaBloqueioHistorico(engine, pr, hist) {
  if (!(engine.historicoAvisado instanceof Set)) engine.historicoAvisado = new Set();
  const chave = `${pr.key}@${hist.head}`;
  if (engine.historicoAvisado.has(chave)) return;
  for (const k of [...engine.historicoAvisado]) {
    if (k.slice(0, k.lastIndexOf('@')) === pr.key) engine.historicoAvisado.delete(k);
  }
  engine.historicoAvisado.add(chave);
  const texto = textoDoBloqueio(pr.key, hist);
  if (texto) engine.emit('toast', { kind: 'info', text: texto });
  // o toast morre com a sessão do app, e a pergunta "por que o Farol não revisou
  // aquele PR?" chega dias depois (engine-ai#108, 29/08/2026: a resposta só saiu
  // lendo o código, porque o bloqueio não deixava rastro nenhum). O motivo agora
  // fica no farol.log, com o head e o estado de cada decisivo.
  if (typeof engine.log === 'function') {
    const quemQuem = (hist.decisivos || []).map(d => `${d.quem} ${d.state}`).join(', ');
    engine.log('INFO', `automático segurado em ${pr.key} (head ${String(hist.head || '').slice(0, 8)}): ${quemQuem || 'sem detalhe'}`);
  }
}

// A boca ÚNICA do gate: consulta o histórico SÓ no caminho automático (clique
// manual atravessa sem nenhuma chamada gh) e, quando bloqueia, avisa uma vez por
// PR+head. Devolve true = não enfileire (decisão de gente no head: a revisão
// automática não é necessária, e o PR não some da tela); false = siga. Os três
// caminhos automáticos aguardam esta função antes
// do enqueueHeadless: launchReview e launchReReviews (lib/engine/review.js) e o
// retry pós-transitório (server.js, _dispararAutomacoes).
async function bloqueiaAutomatico(engine, pr) {
  if (!pr || pr.manual) return false;
  if (await seguradoPeloPedido(engine, pr)) return true;
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (hist && hist.bloqueado) {
    avisaBloqueioHistorico(engine, pr, hist);
    lembrarSegurado(engine, pr);
    return true;
  }
  // estabilidade: com `aguardarCiParaRevisar` ligado, só começa com 100% dos checks
  // OBRIGATÓRIOS verdes (pedido do Guilherme, régua do Wanderson, 31/08/2026; virou opt-in
  // em 01/10/2026, desligado por padrão). Depois do histórico de propósito: a pergunta
  // "alguém já revisou isto?" é mais barata de responder e mais definitiva que "a pipe
  // terminou?", que muda sozinha em minutos.
  if (!aguardaChecksParaRevisar(engine)) return false;
  const checks = await engine.bloqueadoPorChecks(pr);
  if (!checks.bloqueado) return false;
  avisaBloqueioChecks(engine, pr, checks.faltando);
  return true;
}

// Poda da memória de aviso: some junto com o PR (mesma fonte do
// podarSkipComentado). É memória em processo, e podar errado custa no máximo UM
// toast repetido, nunca sessão nem postagem.
function podarHistoricoAvisado(engine, abertos) {
  if (!(engine.historicoAvisado instanceof Set)) return;
  for (const chave of [...engine.historicoAvisado]) {
    if (!abertos.has(chave.slice(0, chave.lastIndexOf('@')))) engine.historicoAvisado.delete(chave);
  }
}

const skipMod = {
  SKIP_FILE, NAO_SAO_PESSOAS, ehFerramenta, labelOrfa, marcarLabelsVistas, revisandoPorOutros, outrosRevisando,
  outrosQueSeguram, anotarOutrosRevisando, lerSinaisDoCiclo,
  textoDoPulo, loadSkipComentado, saveSkipComentado,
  saiDeCena, reviewsDeOutros, standDownCaducou,
  seguirForaDeCena, podarSkipComentado,
  bloqueadoPorHistorico, textoDoBloqueio, avisaBloqueioHistorico, bloqueiaAutomatico, podarHistoricoAvisado,
};
export default skipMod;
export {
  SKIP_FILE, NAO_SAO_PESSOAS, ehFerramenta, labelOrfa, marcarLabelsVistas, revisandoPorOutros, outrosRevisando,
  outrosQueSeguram, anotarOutrosRevisando, lerSinaisDoCiclo,
  textoDoPulo, loadSkipComentado, saveSkipComentado,
  saiDeCena, reviewsDeOutros, standDownCaducou,
  seguirForaDeCena, podarSkipComentado,
  bloqueadoPorHistorico, textoDoBloqueio, avisaBloqueioHistorico, bloqueiaAutomatico, podarHistoricoAvisado,
};
