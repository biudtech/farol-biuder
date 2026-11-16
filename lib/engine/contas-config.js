// A configuração da conta revisora: a política efetiva dela, a edição por OPERAÇÃO e o
// rastro de toda mudança na política de automação (25/09/2026).
//
// Pedido do Wanderson: "Essas configurações precisam serem respeitadas". Quatro PRs
// aprováveis sem ressalva esperaram clique numa conta que estava em "aprova sozinho", e
// ninguém conseguiu dizer quem pôs a conta em "aguardar" naquela meia hora. A investigação
// achou a classe do defeito: a tela salvava a LISTA INTEIRA de contas a cada edição, com o
// que ela tinha na memória, e o servidor gravava a lista como veio. Um campo que a tela não
// conhecia (o peso na cota nunca chegava a ela) era apagado em todas as contas por uma
// mudança de cor; um que ela conhecia velho era ressuscitado.
//
// Aqui a tela diz O QUE mudou (editar este campo da conta, ou uma regra de review) e o
// servidor aplica sobre a config ATUAL. E cada mudança de política, venha da tela de Contas
// ou da de Automação, fica registrada com data e origem, para o próximo "aguardar" que
// ninguém lembra de ter posto ter resposta.
import { readJson, writeJsonAtomic } from '../io.js';
import { editarRegra, normalizarRegras } from './review-scope.js';
import { isDeepStrictEqual } from 'node:util';
import { POLITICA_HISTORICO_FILE } from '../paths.js';
import { contaLimpa, CHAVES_GERAIS_ANTIGAS, DOMINIO_DA_POLITICA, OWNERS_PADRAO } from '../settings.js';
import { normalizarPadroes } from '../parse.js';
import limiteGh from './limite-gh.js';

// O que a tela pode editar na conta. `user` fica de fora: o login da conta revisora é do
// arquivo (ou da detecção do gh no primeiro boot), nunca de um clique.
const CAMPOS_EDITAVEIS = Object.freeze(['owners', 'autoReview', 'onClean', 'onCaveats', 'onReject', 'padroesRevisao']);

// O que decide se o Farol age sozinho.
const POLITICA_DA_CONTA = Object.freeze(['autoReview', 'onClean', 'onCaveats', 'onReject', 'reviewRules']);
// As chaves gerais de revisar e de aprovar com ressalvas saíram daqui em 30/09/2026 (a
// política mora só na conta), e a de aprovar discordando de outro review também:
// discordância é sempre ressalva, e quem decide é a conta.
const POLITICA_GERAL = Object.freeze(['aguardarCiParaRevisar', 'aguardarCiParaAprovar']);

// O padrão da conta (01/10/2026): aprova sozinho, com ou sem ressalvas, e reprova sozinho.
// Quem prefere revisar ele mesmo desliga nos seletores da conta.
const PADRAO = Object.freeze({ autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });

const TETO_DO_HISTORICO = 200;

function minusculo(v) {
  return String(v || '').trim().toLowerCase();
}

function vazio(v) {
  return v === '' || v === null || v === undefined;
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Os quatro campos da política por extenso. Valor da conta vale; ausente recebe o padrão.
// O com ressalvas nunca é mais permissivo que o limpo.
function politicaExplicita(conta) {
  const a = objeto(conta) ? conta : {};
  const onClean = a.onClean === 'wait' ? 'wait' : 'approve';
  let onCaveats = DOMINIO_DA_POLITICA.onCaveats.includes(a.onCaveats) ? a.onCaveats : PADRAO.onCaveats;
  if (onClean === 'wait') onCaveats = 'wait';
  const autoReview = DOMINIO_DA_POLITICA.autoReview.includes(a.autoReview) ? a.autoReview : PADRAO.autoReview;
  const onReject = DOMINIO_DA_POLITICA.onReject.includes(a.onReject) ? a.onReject : PADRAO.onReject;
  return { autoReview, onClean, onCaveats, onReject };
}

// A conta revisora como o motor a lê: só os campos que existem, saneados. Sem conta no
// arquivo devolve a conta sem login (`user: ''`), e é ela o único elemento do accountList.
function contaConfigurada(config) {
  const conta = contaLimpa(objeto(config) && objeto(config.conta) ? config.conta : {});
  if (conta.reviewRules) conta.reviewRules = normalizarRegras(conta.reviewRules);
  return conta;
}

// A conta como vai para o disco: saneada, com os padrões do time no teto de gravação e a
// política escrita por extenso (o arquivo diz o que a conta faz, sem padrão implícito).
function contaParaGravar(conta) {
  const c = contaConfigurada({ conta });
  const padroes = normalizarPadroes(c.padroesRevisao);
  if (padroes) c.padroesRevisao = padroes;
  else delete c.padroesRevisao;
  if (c.reviewRules && !Object.keys(c.reviewRules).length) delete c.reviewRules;
  return { ...c, ...politicaExplicita(c) };
}

// Aplica UMA operação sobre a conta atual. PURA: devolve a conta nova, e quem saneia e grava
// é o editarConta. Só edição de campo e regra de review: adicionar e remover conta saíram com
// o corte para uma conta por instância.
function aplicarEdicao(contaAtual, op) {
  const o = objeto(op) ? op : {};
  const alvo = minusculo(o.user);
  if (!alvo) return { ok: false, erro: 'conta sem login' };
  const conta = objeto(contaAtual) ? contaAtual : {};
  if (minusculo(conta.user) !== alvo) return { ok: false, erro: `a conta @${o.user} não é a conta deste Farol` };
  if (o.tipo === 'regra-review') {
    const r = editarRegra(conta, o);
    return r.ok ? { ok: true, ignorados: [], conta: r.conta } : r;
  }
  if (o.tipo !== 'editar') return { ok: false, erro: 'operação de conta desconhecida' };
  const campos = objeto(o.campos) ? o.campos : {};
  const tortos = Object.keys(campos).filter((k) => DOMINIO_DA_POLITICA[k] && !vazio(campos[k]) && !DOMINIO_DA_POLITICA[k].includes(campos[k]));
  const ignorados = [...Object.keys(campos).filter((k) => !CAMPOS_EDITAVEIS.includes(k)), ...tortos];
  const nova = { ...conta };
  for (const k of Object.keys(campos).filter((c) => CAMPOS_EDITAVEIS.includes(c) && !tortos.includes(c))) {
    // vazio remove o campo; nos quatro da política, a gravação o reescreve com o padrão
    if (vazio(campos[k])) delete nova[k];
    else nova[k] = campos[k];
  }
  // O com ressalvas nunca é mais permissivo que o limpo, também na escrita (30/09/2026).
  // Pedir "aprova" nas ressalvas de conta cujo limpo espera você é recusa, não gravação
  // calada de outro valor: quem pediu precisa saber.
  if (nova.onClean === 'wait' && campos.onCaveats === 'approve') {
    return { ok: false, erro: `o "sem ressalvas" de @${o.user} espera você, então o "com ressalvas" também espera` };
  }
  if (nova.onClean === 'wait') nova.onCaveats = 'wait';
  return { ok: true, ignorados, conta: nova };
}

function mesmasOrgs(a, b) {
  const chave = (c) => (c.owners || []).map(minusculo).sort().join(',');
  return chave(a) === chave(b);
}

// A operação aplicada, saneada e gravada, com o rastro da política. Recusa volta como veio,
// sem gravar nada. Falha de disco desfaz a mudança em memória e sobe para a rota.
function editarConta(engine, op, origem) {
  const r = aplicarEdicao(engine.config.conta, op);
  if (!r.ok) return r;
  const anterior = engine.config;
  const antes = retratoDaPolitica(anterior);
  engine.config = { ...anterior, conta: contaParaGravar(r.conta) };
  try { engine.saveConfig(); }
  catch (error) { engine.config = anterior; throw error; }
  registrarMudancas(engine, mudancasDePolitica(antes, retratoDaPolitica(engine.config)), origem);
  // orgs novas mudam o que a busca traz: confere já, sem esperar o próximo ciclo
  if (!mesmasOrgs(contaConfigurada(anterior), engine.config.conta)) engine.checkNow();
  engine.emit('settings-changed', engine.config);
  engine.pushState();
  return { ok: true, ignoradas: [], ignorados: r.ignorados };
}

// A conta como a TELA a vê, em lista de UM (a tela nova, da fase 3, lê assim): o que ela
// monitora, se tem token, até quando as buscas dela estão paradas pelo limite do GitHub e até
// quando a assinatura do Claude está no limite do plano (0 = livre nos dois).
function contasParaTela(engine) {
  const regras = (a) => (a.reviewRules ? { reviewRules: a.reviewRules } : {});
  return engine.accountList().map((a) => ({
    user: a.user, owners: a.owners, tokenOk: !!engine.tokenFor(a.user),
    limiteGhAte: limiteGh.limiteAte(engine, a.user),
    limitePlanoAte: typeof engine.limiteDoPlanoAte === 'function' ? engine.limiteDoPlanoAte(a.user) : 0,
    autoReview: a.autoReview, onClean: a.onClean, onCaveats: a.onCaveats, onReject: a.onReject,
    ...regras(a),
    // sem este campo a tela de Contas recebia os padrões sempre vazios e mostrava o campo em branco
    padroesRevisao: a.padroesRevisao,
  }));
}

// A política vai por extenso para o arquivo. Devolve se mudou, para quem chama gravar.
function escreverPoliticaPorExtenso(engine) {
  if (!objeto(engine.config.conta)) return false;
  const nova = contaParaGravar(engine.config.conta);
  if (isDeepStrictEqual(nova, engine.config.conta)) return false;
  engine.config.conta = nova;
  return true;
}

const CAMPOS_DA_POLITICA = Object.freeze(['autoReview', 'onClean', 'onCaveats', 'onReject']);

// A conta como estava ESCRITA no arquivo (formato novo ou lista antiga), para o rastro dizer
// de onde cada campo saiu. Sem registro dela, todos os campos nasceram agora.
function contaCrua(cru, user) {
  const mesma = (a) => objeto(a) && minusculo(a.user) === minusculo(user);
  if (mesma(cru.conta)) return cru.conta;
  return (Array.isArray(cru.accounts) ? cru.accounts : []).find(mesma) || {};
}

function camposQueMudaram(antes, depois) {
  return CAMPOS_DA_POLITICA.filter((campo) => antes[campo] !== depois[campo])
    .map((campo) => ({ conta: depois.user, campo, de: valorOuNulo(antes[campo]), para: depois[campo] }));
}

// O que a carga do config.json decidiu sobre a política: chave geral antiga que deixou de
// existir e campo que a conta não tinha escrito. Config já no formato de hoje não muda nada,
// então o segundo boot não registra de novo.
function mudancasDaCarga(cru, conta) {
  const c = objeto(cru) ? cru : {};
  const gerais = CHAVES_GERAIS_ANTIGAS.filter((k) => Object.hasOwn(c, k))
    .map((campo) => ({ conta: null, campo, de: valorOuNulo(c[campo]), para: null }));
  // a conta ainda sem login não tem nome para o rastro: os campos dela entram na detecção
  if (!objeto(conta) || !conta.user) return gerais;
  return [...gerais, ...camposQueMudaram(contaCrua(c, conta.user), conta)];
}

// Na carga: a política por extenso e o rastro do que a leitura da config antiga decidiu. O
// arquivo como veio (`engine.configCrua`) é consumido aqui: o rastro sai uma vez por boot,
// mesmo que o preparo do HOME rode de novo.
function aoCarregar(engine) {
  const cru = engine.configCrua;
  engine.configCrua = undefined;
  const mudou = escreverPoliticaPorExtenso(engine);
  if (cru === undefined) return mudou;
  registrarMudancas(engine, mudancasDaCarga(cru, engine.config.conta), 'migração');
  // o arquivo é regravado quando a carga o leu diferente do que ele dizia (formato antigo,
  // chave geral, conta escolhida): senão o próximo boot decidiria e registraria tudo de novo
  return mudou || arquivoDesatualizado(objeto(cru) ? cru : {}, engine.config.conta);
}

function arquivoDesatualizado(cru, conta) {
  if ([...CHAVES_GERAIS_ANTIGAS, 'accounts', 'ghUser', 'owners'].some((k) => Object.hasOwn(cru, k))) return true;
  return objeto(conta) && !isDeepStrictEqual(cru.conta, conta);
}

// Quando o gh detecta a conta: ela herda o que o arquivo já dizia (a escolha de política
// gravada antes do login) e nasce com as orgs padrão e a política por extenso, no rastro.
function contaDetectada(engine, login) {
  const atual = contaConfigurada(engine.config);
  engine.config.conta = contaParaGravar({ ...atual, user: login, owners: atual.owners.length ? atual.owners : [...OWNERS_PADRAO] });
  registrarMudancas(engine, camposQueMudaram({}, engine.config.conta), 'detecção do gh');
}

/* ---------- a política da conta ----------
   Lida SÓ da conta (30/09/2026). Campo ausente vale o padrão, pela mesma função que a
   gravação usa, para as duas leituras nunca se desencontrarem. `user` continua no contrato
   das perguntas porque os consumidores do núcleo seguem perguntando por login. */
function politicaDaConta(engine, user) {
  const u = minusculo(user);
  return engine.accountList().find((a) => minusculo(a.user) === u) || {};
}

function revisaSozinho(engine, user) {
  return politicaExplicita(politicaDaConta(engine, user)).autoReview;
}

// `limpo` = aprovável sem ressalvas. O com ressalvas nunca é mais permissivo que o limpo:
// quem garante é politicaExplicita, na leitura, e aplicarEdicao, na escrita.
function acaoAoAprovar(engine, user, limpo) {
  const p = politicaExplicita(politicaDaConta(engine, user));
  return limpo ? p.onClean : p.onCaveats;
}

// reprovar sozinho é política da conta (padrão desde 01/10/2026): não existe reprovação automática geral
function acaoAoReprovar(engine, user) {
  return politicaExplicita(politicaDaConta(engine, user)).onReject;
}

function valorOuNulo(v) {
  return v === undefined ? null : v;
}

function retratoDaPolitica(config) {
  const c = objeto(config) ? config : {};
  const geral = Object.fromEntries(POLITICA_GERAL.map((k) => [k, valorOuNulo(c[k])]));
  const contas = {};
  const a = contaConfigurada(c);
  if (a.user) contas[a.user] = Object.fromEntries(POLITICA_DA_CONTA.map((k) => [k, valorOuNulo(a[k])]));
  return { geral, contas };
}

// O que mudou entre dois retratos: primeiro as chaves gerais, depois a conta.
function mudancasDePolitica(antes, depois) {
  const saida = [];
  for (const campo of POLITICA_GERAL) {
    const de = antes.geral[campo];
    const para = depois.geral[campo];
    if (de !== para) saida.push({ conta: null, campo, de, para });
  }
  const nomes = [...new Set([...Object.keys(depois.contas), ...Object.keys(antes.contas)])];
  for (const conta of nomes) {
    for (const campo of POLITICA_DA_CONTA) {
      const de = valorOuNulo((antes.contas[conta] || {})[campo]);
      const para = valorOuNulo((depois.contas[conta] || {})[campo]);
      if (!isDeepStrictEqual(de, para)) saida.push({ conta, campo, de, para });
    }
  }
  return saida;
}

// Todo pedido à API local vem desta máquina (a allowlist de Host garante), então o que
// distingue a origem é QUAL tela: a janela do app ou um navegador aberto no endereço local.
function origemDaRequisicao(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'desconhecida';
  return /\bElectron\//.test(ua) ? 'janela do Farol' : 'navegador';
}

function aparar(lista) {
  return lista.length > TETO_DO_HISTORICO ? lista.slice(lista.length - TETO_DO_HISTORICO) : lista;
}

function historico(engine) {
  if (!Array.isArray(engine.politicaHistorico)) {
    const lido = readJson(POLITICA_HISTORICO_FILE, []);
    engine.politicaHistorico = Array.isArray(lido) ? lido : [];
  }
  return engine.politicaHistorico;
}

// A origem é o texto da tela local ('janela do Farol', 'navegador'), 'migração' (a carga de
// uma config antiga) ou 'detecção do gh' (a conta nascida do login ativo do gh).
function origemDoRastro(origem) {
  return { origem: (typeof origem === 'string' && origem) || 'desconhecida' };
}

function registrarMudancas(engine, mudancas, origem, agora = Date.now()) {
  if (!mudancas.length) return;
  const rastro = origemDoRastro(origem);
  const novas = mudancas.map((m) => ({ at: agora, ...m, ...rastro }));
  engine.politicaHistorico = aparar([...historico(engine), ...novas]);
  try { writeJsonAtomic(POLITICA_HISTORICO_FILE, engine.politicaHistorico); }
  catch (err) { engine.log('ERROR', `gravar politica-historico.json: ${err.message}`); }
}

function ultimaMudanca(engine, conta, campo) {
  const alvo = conta === null ? null : minusculo(conta);
  const achadas = historico(engine).filter((h) => h && h.campo === campo &&
    (alvo === null ? h.conta === null : minusculo(h.conta) === alvo));
  return achadas.length ? achadas[achadas.length - 1] : null;
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

function quandoEOrigem(mudanca) {
  if (!mudanca) return '';
  const d = new Date(Number(mudanca.at) || 0);
  const data = `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  const por = { 'janela do Farol': 'pela janela do Farol', navegador: 'pelo navegador', admin: 'pelo admin', 'migração': 'quando a política foi lida da configuração antiga', 'detecção do gh': 'quando o gh detectou a conta' }[mudanca.origem] || 'por origem desconhecida';
  return ` (definido em ${data}, ${por})`;
}

// O nome da conta no motivo do card: o login; vazio para "todas" ('*' ou nada).
// Morava em lib/engine/tools.js (scopeLabel), que saiu no corte do lote 7; a fachada
// `Engine.scopeLabel` continua sendo o ponto que os testes trocam.
function rotuloDaConta(engine, conta) {
  const chave = String(conta || '').trim().toLowerCase();
  if (!chave || chave === '*') return '';
  const a = engine.accountList().find(x => x.user.toLowerCase() === chave);
  return (a && a.user) || String(conta);
}

// O motivo que o card mostra quando a política segurou a aprovação, com a configuração que
// DE FATO segurou e quando ela foi definida. Com ressalvas, quem segura é a regra de
// ressalvas da conta ou o "sem ressalvas" dela (o com ressalvas nunca é mais permissivo).
function motivoDaPolitica(engine, conta, limpo) {
  const label = engine.scopeLabel(conta) || conta || 'esta conta';
  if (limpo) {
    return `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação${quandoEOrigem(ultimaMudanca(engine, conta, 'onClean'))} (ajuste em Sistema > Contas)`;
  }
  if (politicaExplicita(politicaDaConta(engine, conta)).onClean === 'wait') {
    return `aprovável com ressalvas, e o "sem ressalvas" da conta ${label} espera você, então o com ressalvas também espera${quandoEOrigem(ultimaMudanca(engine, conta, 'onClean'))} (ajuste em Sistema > Contas)`;
  }
  return `aprovável com ressalvas, e a política da conta ${label} é aguardar você${quandoEOrigem(ultimaMudanca(engine, conta, 'onCaveats'))} (mude pra "aprova (as ressalvas ficam no app)" em Sistema > Contas se quiser que aprove sozinho)`;
}

// As últimas mudanças, para o Diagnóstico. Só campo, valores e origem: nada de caminho.
function historicoRecente(engine, limite = 20) {
  return historico(engine).slice(-limite).reverse();
}

export default {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  PADRAO, politicaExplicita, contaConfigurada, contaParaGravar, contasParaTela, escreverPoliticaPorExtenso,
  mudancasDaCarga, aoCarregar, contaDetectada,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar,
  aplicarEdicao, editarConta, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, motivoDaPolitica, historicoRecente, rotuloDaConta,
};
export {
  CAMPOS_EDITAVEIS, TETO_DO_HISTORICO,
  PADRAO, politicaExplicita, contaConfigurada, contaParaGravar, contasParaTela, escreverPoliticaPorExtenso,
  mudancasDaCarga, aoCarregar, contaDetectada,
  politicaDaConta, revisaSozinho, acaoAoAprovar, acaoAoReprovar,
  aplicarEdicao, editarConta, retratoDaPolitica, mudancasDePolitica, origemDaRequisicao,
  aparar, registrarMudancas, motivoDaPolitica, historicoRecente, rotuloDaConta,
};
