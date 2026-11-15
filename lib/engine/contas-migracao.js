// A política de revisão e de aprovação mora SÓ na conta (30/09/2026). PURO: sem estado,
// sem IO, sem rede.
//
// Pedido do dono: "Preciso que não exista mais sobreposição de configurações". Até aqui a
// mesma decisão tinha dois endereços: as chaves gerais `autoReview` e `autoApproveAll`
// (Sistema > Automação) eram o padrão, cada conta podia ter valor próprio, e ainda havia
// uma regra implícita (conta cujo limpo espera você não seguia a chave das ressalvas).
// Para saber o que uma conta fazia era preciso ler duas telas e lembrar da regra.
//
// Este módulo é o ÚNICO lugar que conhece as chaves gerais antigas. Ele escreve em cada
// conta, por extenso, o que ela já fazia (`autoReview`, `onClean`, `onCaveats`,
// `onReject`) e descarta as chaves gerais. Roda na carga da config e depois de toda
// gravação de contas, então conta nova também nasce com os quatro campos escritos.
//
// IDEMPOTENTE: config já migrada sai idêntica, e `mudou` volta falso.
//
// AS CHAVES ANTIGAS SÃO ENTRADA DA MIGRAÇÃO, e só isso. Enquanto não existe conta nenhuma
// (config sem `accounts` e sem `ghUser`, o caso do `{"port": 47180, "autoReview": false}`
// das instâncias de teste), elas ficam onde estão, esperando: quando a conta é detectada,
// a migração roda de novo e a conta nasce com o que o arquivo pedia. Descartar antes
// faria a instância de teste revisar sozinha na conta real de quem a abriu.
//
// O MODO SIMPLES VIRA CONTA. Config sem `accounts` valia pela conta única `ghUser` +
// `owners`, que não tinha onde guardar política (e que a tela de Contas nunca conseguiu
// editar). A migração escreve essa conta na lista, com o mesmo login e as mesmas orgs.
//
// A ÚNICA DIFERENÇA DE COMPORTAMENTO, e ela só restringe: conta com "sem ressalvas"
// esperando você E "com ressalvas" aprovando por escolha própria. Antes ela aprovava
// sozinha o PR com ressalvas e segurava o limpo; agora o com ressalvas nunca é mais
// permissivo que o limpo, sem exceção, e ela passa a esperar você nos dois.

const CHAVES_GERAIS_ANTIGAS = Object.freeze(['autoReview', 'autoApproveAll']);
const CAMPOS_DA_POLITICA = Object.freeze(['autoReview', 'onClean', 'onCaveats', 'onReject']);
// O padrão da conta NOVA (01/10/2026): aprova sozinho, com ou sem ressalvas, e reprova sozinho.
// Quem prefere revisar ele mesmo desliga nos seletores da conta. Conta que já existia e ainda
// não passou pela primeira migração (esquemaConfig ausente) NÃO recebe isto: ela recebe o que já
// praticava (geralAntigo), porque atualizar nunca pode passar a postar no GitHub sem a pessoa
// ter escolhido.
const PADRAO = Object.freeze({ autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

// O que as chaves gerais valiam, lido como o engine lia: a config em memória era
// `{ ...padrões, ...arquivo }` com `autoReview: true` e `autoApproveAll: false` nos
// padrões, e as duas leituras eram `!== false`. Chave ausente do arquivo cai no padrão.
function geralAntigo(config) {
  const c = objeto(config) ? config : {};
  return {
    autoReview: c.autoReview !== false,
    aprovaComRessalva: Object.hasOwn(c, 'autoApproveAll') && c.autoApproveAll !== false,
    rejeita: false,
  };
}

// Os quatro campos por extenso. Valor da conta vale; ausente recebe o que ela herdava.
function politicaExplicita(conta, geral) {
  const a = objeto(conta) ? conta : {};
  const g = geral || { autoReview: PADRAO.autoReview, aprovaComRessalva: PADRAO.onCaveats === 'approve', rejeita: PADRAO.onReject === 'request_changes' };
  const onClean = a.onClean === 'wait' ? 'wait' : 'approve';
  let onCaveats = g.aprovaComRessalva ? 'approve' : 'wait';
  if (a.onCaveats === 'approve' || a.onCaveats === 'wait') onCaveats = a.onCaveats;
  // o com ressalvas nunca é mais permissivo que o limpo
  if (onClean === 'wait') onCaveats = 'wait';
  const escolheuRevisao = a.autoReview === true || a.autoReview === false;
  const autoReview = escolheuRevisao ? a.autoReview : g.autoReview;
  let onReject = g.rejeita ? 'request_changes' : 'wait';
  if (a.onReject === 'request_changes' || a.onReject === 'wait') onReject = a.onReject;
  return { autoReview, onClean, onCaveats, onReject };
}

function contasDaConfig(c) {
  const lista = (Array.isArray(c.accounts) ? c.accounts : []).filter((a) => objeto(a) && texto(a.user));
  if (lista.length || !texto(c.ghUser)) return lista;
  // modo simples: a conta única legada entra na lista com a mesma identidade
  const owners = (Array.isArray(c.owners) ? c.owners : []).map(texto).filter(Boolean);
  return [{ user: texto(c.ghUser), owners }];
}

function valorOuNulo(v) {
  return v === undefined ? null : v;
}

function diferencasDaConta(antes, depois) {
  return CAMPOS_DA_POLITICA
    .filter((campo) => antes[campo] !== depois[campo])
    .map((campo) => ({ conta: depois.user, campo, de: valorOuNulo(antes[campo]), para: depois[campo] }));
}

// Devolve as contas com a política por extenso, as chaves gerais a descartar e o que mudou
// (para o rastro em state/politica-historico.json). Não toca na config recebida.
function migrarPolitica(config) {
  const c = objeto(config) ? config : {};
  const base = contasDaConfig(c);
  const jaEraLista = Array.isArray(c.accounts) && c.accounts.length === base.length;
  if (!base.length) return { mudou: false, contas: Array.isArray(c.accounts) ? c.accounts : [], descartar: [], mudancas: [] };
  // Instalação já migrada (ou nova): conta sem campo recebe o padrão novo. Instalação de antes da
  // primeira migração: recebe o que as chaves gerais antigas diziam. Chave antiga AINDA no
  // arquivo também vale, com o marcador gravado ou não: com conta ela já teria sido descartada,
  // então ela só chega aqui esperando a primeira conta (a instância de teste, cuja carga sem
  // conta grava `esquemaConfig` antes de o gh ser detectado; medido em 20/10/2026, a conta
  // nascia revisando e aprovando sozinha).
  const descartar = CHAVES_GERAIS_ANTIGAS.filter((k) => Object.hasOwn(c, k));
  const geral = (inteiro(c.esquemaConfig) || 0) >= 1 && !descartar.length ? null : geralAntigo(c);
  const contas = base.map((a) => ({ ...a, ...politicaExplicita(a, geral) }));
  const mudancas = [
    ...descartar.map((campo) => ({ conta: null, campo, de: valorOuNulo(c[campo]), para: null })),
    ...contas.flatMap((depois, i) => diferencasDaConta(base[i], depois)),
  ];
  return { mudou: mudancas.length > 0 || !jaEraLista, contas, descartar, mudancas };
}

/* ---------- o marcador do esquema 1 ----------
   O esquema 1 gravava no teto total (`globalParallelReviews`) o que a instalação com a
   visão compartilhada ligada já praticava. A visão compartilhada saiu, então sobra o ramo de
   quem nunca a teve: nada muda nos números, e a primeira carga só grava o MARCADOR explícito
   (`esquemaConfig`), que as migrações seguintes leem. */
const ESQUEMA_PARALELISMO = 1;

function inteiro(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function migrarParalelismo(config) {
  const c = objeto(config) ? config : {};
  if ((inteiro(c.esquemaConfig) || 0) >= ESQUEMA_PARALELISMO) return { mudou: false, mudancas: [] };
  return { mudou: true, esquemaConfig: ESQUEMA_PARALELISMO, mudancas: [] };
}

/* ---------- os padrões de 06/11/2026 (esquema 2) ----------
   Pedido do dono: "CI obrigatório antes da aprovação ... deve vir por default como
   desabilitado. Devem vir habilitados por default: Retomar a sessão na segunda rodada; (...);
   Atualizar sozinho." "Atualizar sozinho" (`autoUpdate`) fica fora desta migração, porque já
   nascia ligado (motivo completo abaixo).

   O saveConfig grava a config INTEIRA, então o padrão antigo estava escrito no config.json de
   todo mundo sem ninguém ter escolhido: `reReviewResume: false`
   desde sempre, e `aguardarCiParaAprovar: true` desde 17/10/2026 (quando o saneador passou a
   forçar o verdadeiro e a tela tirou a chave; ninguém podia escolher outra coisa). O arquivo
   não diz o que foi escolha, então a migração vale UMA vez, pelo marcador explícito
   `esquemaConfig` (como a do paralelismo): grava os padrões novos e sobe o marcador. O que a
   pessoa escolher depois dela fica, porque ela não roda de novo.

   Escolha explícita x padrão gravado: só o `true` distingue (já é o padrão novo, nada muda).
   Um `false` de `reReviewResume` gravado antes do esquema 2 é indistinguível do padrão
   antigo, porque nenhum rastro registrava a chave; ali a migração única fica, por decisão
   do dono (06/11/2026).

   `autoUpdate` fica de fora de propósito: o padrão dele é ligado desde que a chave nasceu
   (v2.46.0) e o saneador só desliga com `false` explícito, então um `false` no arquivo é
   escolha de alguém, e a migração não o desfaz. */
const ESQUEMA_PADROES = 2;
const PADROES_LIGADOS = Object.freeze(['reReviewResume']);

function migrarPadroes(config) {
  const c = objeto(config) ? config : {};
  if ((inteiro(c.esquemaConfig) || 0) >= ESQUEMA_PADROES) return { mudou: false, valores: {}, mudancas: [] };
  const valores = {};
  for (const k of PADROES_LIGADOS) if (c[k] !== true) valores[k] = true;
  if (c.aguardarCiParaAprovar !== false) valores.aguardarCiParaAprovar = false;
  // vai ao rastro (state/politica-historico.json) a chave de política; reReviewResume não muda risco nenhum
  const mudancas = ['aguardarCiParaAprovar'].filter((k) => k in valores)
    .map((k) => ({ conta: null, campo: k, de: valorOuNulo(c[k]), para: valores[k] }));
  return { mudou: true, esquemaConfig: ESQUEMA_PADROES, valores, mudancas };
}

export default { CHAVES_GERAIS_ANTIGAS, CAMPOS_DA_POLITICA, PADRAO, ESQUEMA_PARALELISMO, ESQUEMA_PADROES, PADROES_LIGADOS, politicaExplicita, migrarPolitica, migrarParalelismo, migrarPadroes };
export { CHAVES_GERAIS_ANTIGAS, CAMPOS_DA_POLITICA, PADRAO, ESQUEMA_PARALELISMO, ESQUEMA_PADROES, PADROES_LIGADOS, politicaExplicita, migrarPolitica, migrarParalelismo, migrarPadroes };
