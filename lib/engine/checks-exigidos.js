/* Dono da pergunta "como estão os checks obrigatórios deste PR?".

   Módulo próprio, e não mais um bloco no skip-review.js: o assunto é outro (aquele arquivo é
   dono de "um Farol por PR" e do gate de consciência, que falam de QUEM já agiu no PR; este fala
   do ESTADO da pipe).

   Até 17/11/2026 o consumidor principal era o gate de entrada (só começar a revisar com os checks
   verdes, `aguardarCiParaRevisar`). Ele saiu com a regra do dono de que o revisor nunca espera o
   CI: o que ficou é a leitura dos checks na SAÍDA, como informação (anexarChecksObrigatorios e a
   publicação), e a separação do check herdado da base. */
import { TEMPOS } from '../constants.js';
import io from '../io.js';
/* ---------- a régua dos checks OBRIGATÓRIOS verdes (31/08/2026) ----

   Nasceu como gate de estabilidade de entrada, que saiu em 17/11/2026 (o revisor nunca espera
   o CI). A régua de o que conta como verde ficou, para a leitura informativa dos checks.

   PEDIDO DE UM COLEGA, com dois desperdícios que ele mediu em campo: o Farol começa a
   revisar, alguém clica em "Update branch", entra commit novo e a sessão inteira vira
   lixo; e o Farol aprova, a pipe quebra depois, e o ciclo de correção custa outra
   revisão. A proposta original dele era esperar "90% das pipes verdes"; o dono
   simplificou para a régua que vale aqui: TODOS os obrigatórios verdes, com o botão
   Revisar continuando a atravessar sem esperar, para quem tem pressa.

   OBRIGATÓRIOS, e não todos, e isso não é detalhe: o `sonar` do engine-ai é
   cronicamente vermelho e não é exigido pela branch. Exigir tudo verde nunca revisaria
   aquele repositório, que é o oposto do que este gate existe pra fazer.

   O MESMO CHECK APARECE MAIS DE UMA VEZ, e é o caso comum, não a exceção: medido no
   biud-frontend#860, `deploy` aparece duas vezes no rollup, FAILURE de 28/08 e SUCCESS
   de 31/08, porque o job foi relançado. Contar as duas travaria o PR pra sempre por uma
   falha já corrigida, então vale a rodada MAIS RECENTE de cada nome, que é a mesma
   regra de "último estado da pessoa vence" do gate de consciência logo abaixo.

   SKIPPED e NEUTRAL contam como verde porque é assim que o próprio GitHub trata check
   obrigatório na caixa de merge; divergir disso faria o Farol esperar por algo que o
   repositório já considera satisfeito. PURA. */
const CONCLUSOES_VERDES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/* VEREDITO DE REVISÃO NÃO É SINAL DE PIPE, e esperar por ele é um laço fechado
   (16/09/2026). Medido no engine-ai#203: `acrity/review` é check OBRIGATÓRIO na
   `development` e fica vermelho enquanto o bot não aprovar. O gate acima então segura a
   revisão do Farol, e o PR fica parado esperando uma revisão que ninguém vai fazer,
   porque o próprio Farol é quem faria.

   A regra deste gate é sobre ESTABILIDADE DA PIPE: não revisar código que vai mudar,
   nem aprovar o que a esteira já reprovou. Um bot de review não diz nada sobre isso.
   Ele diz o que o Farol também vai dizer, e o Farol tem que poder discordar dele.

   COMO SE RECONHECE: status de commit publicado por app externo vem namespaced, no
   formato `dono/review` (`acrity/review`). Job do GitHub Actions não colide com isso:
   o contexto dele é o nome do workflow e do job, com espaços em volta da barra
   (`build / build`), e o padrão abaixo exige a barra sem espaço. PURA. */
const VEREDITO_DE_REVIEW = /^[a-z0-9][a-z0-9._-]*\/review$/i;
function ehVeredictoDeReview(nome) { return VEREDITO_DE_REVIEW.test(String(nome || '').trim()); }

// nome do check nas duas formas que o gh devolve: CheckRun tem `name`, status legado
// (a API antiga de commit status) tem `context`. O mesmo vale pro desfecho.
function nomeDoCheck(c) { return String((c && (c.name || c.context)) || '').trim(); }
function desfechoDoCheck(c) { return String((c && (c.conclusion || c.state)) || '').toUpperCase(); }

// Status legado não tem `status`: quem ainda roda só aparece no `state`. Lido como concluído, virava
// vermelho, e a conta que reprova sozinha publicava que o check estava falhando.
const STATUS_LEGADO_ABERTO = new Set(['PENDING', 'EXPECTED']);
function checkConcluido(c) {
  if (!c.status) return !STATUS_LEGADO_ABERTO.has(String(c.state || '').toUpperCase());
  return String(c.status).toUpperCase() === 'COMPLETED';
}

// Última rodada de cada check, por horário de início. Sem horário (status legado, dado
// truncado) vale a ordem em que o gh entregou, que é o melhor palpite disponível.
function ultimaRodadaPorNome(rollup) {
  const porNome = new Map();
  for (const c of Array.isArray(rollup) ? rollup : []) {
    const nome = nomeDoCheck(c);
    if (!nome) continue;
    const anterior = porNome.get(nome);
    const t = Date.parse((c && c.startedAt) || '') || 0;
    const tAnterior = anterior ? (Date.parse(anterior.startedAt || '') || 0) : -1;
    if (!anterior || t >= tAnterior) porNome.set(nome, c);
  }
  return porNome;
}

/* Os obrigatórios estão todos verdes? Devolve { pronto, faltando: [{nome, estado}] },
   com estado em 'rodando' | 'vermelho' | 'ausente' (nem começou, que é o caso do
   Update branch recém-clicado). FALTA DE DADO NUNCA SEGURA: sem exigência conhecida ou
   sem rollup legível, devolve pronto, porque o pior caso de deixar passar é uma
   revisão que talvez precise ser refeita, e o pior caso de segurar por falha de leitura
   é um PR que nunca é revisado e ninguém entende o silêncio. */
function checksExigidosVerdes(rollup, exigidos) {
  const lista = (Array.isArray(exigidos) ? exigidos.map(String).filter(Boolean) : [])
    .filter(nome => !ehVeredictoDeReview(nome));
  if (!lista.length || !Array.isArray(rollup)) return { pronto: true, faltando: [] };
  const porNome = ultimaRodadaPorNome(rollup);
  const faltando = [];
  for (const nome of lista) {
    const c = porNome.get(nome);
    if (!c) { faltando.push({ nome, estado: 'ausente' }); continue; }
    if (!checkConcluido(c)) { faltando.push({ nome, estado: 'rodando' }); continue; }
    if (!CONCLUSOES_VERDES.has(desfechoDoCheck(c))) faltando.push({ nome, estado: 'vermelho' });
  }
  return { pronto: faltando.length === 0, faltando };
}

// O ruleset da branch de destino não exige check nenhum (fora o veredito de review de
// ferramenta)? Então nada no GitHub barra o merge com o CI vermelho, e a aprovação que sai
// precisa dizer isso no card (06/11/2026). Lista desconhecida (null) não é "sem exigência".
function semCheckObrigatorio(exigidos) {
  return Array.isArray(exigidos) && !exigidos.map(String).some(nome => nome && !ehVeredictoDeReview(nome));
}

// Os checks do head que não estão verdes, quando nenhum é obrigatório: o que o card cita no
// aviso. Mesma régua do checksExigidosVerdes (última rodada por nome).
function checksNaoVerdes(rollup) {
  const naoVerdes = [];
  for (const [nome, c] of ultimaRodadaPorNome(rollup)) {
    if (ehVeredictoDeReview(nome)) continue;
    if (!checkConcluido(c)) naoVerdes.push({ nome, estado: 'rodando' });
    else if (!CONCLUSOES_VERDES.has(desfechoDoCheck(c))) naoVerdes.push({ nome, estado: 'vermelho' });
  }
  return naoVerdes;
}

/* Quais checks a BRANCH DE DESTINO exige, pelo mesmo endpoint que o fetchRuleBlocked
   já usa (`repos/{repo}/rules/branches/{base}`). Ele responde pra quem tem leitura, sem
   exigir admin, e foi conferido em campo: biud-frontend@development exige
   lint/typecheck/test/build/audit/gitleaks, e engine-ai@development exige
   lint/quality-gate/coverage/golden-set/integration-tests/acrity-review.

   Cache por repo@base porque a exigência muda por mudança de ruleset, que é rara, e
   sem ele isto seria uma chamada gh por PR por ciclo. null = não deu pra saber, e quem
   chama trata isso como "não segura". */
async function checksExigidosDoRepo(engine, repo, base) {
  if (!repo || !base) return null;
  if (!(engine.checksExigidosCache instanceof Map)) engine.checksExigidosCache = new Map();
  const chave = `${repo}@${base}`;
  const c = engine.checksExigidosCache.get(chave);
  if (c && (Date.now() - c.at) < TEMPOS.CHECKS_EXIGIDOS_TTL_MS) return c.lista;
  const acc = engine.primaryUser();
  if (!engine.tokenFor(acc)) return null;
  const jq = '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[]?.context]';
  const r = await io.run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', jq], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const lista = io.parseJson(r.stdout, null);
  if (!Array.isArray(lista)) return null;
  engine.checksExigidosCache.set(chave, { lista, at: Date.now() });
  return lista;
}

/* ---------- check herdado da base (17/11/2026) ----------

   Regra do dono, nascida num PR de task para uma bancada `release_hmg_*`: a revisão cobrou o
   `osv` obrigatório vermelho no head, mas o `osv` já falhava no commit atual da própria base, e o
   PR só herdou a falha. "Não é momento de cobrar coisas que não são check required", e o GitHub
   segura o merge pelo ruleset de qualquer jeito: a cobrança do review só gerava atrito.

   HERDADO é o check obrigatório que falta no head (vermelho, rodando ou ausente) e que está
   VERMELHO (falhou) no commit atual da base. Base sem o check (ausente, rollup vazio, check que só
   roda em pull_request) ou com ele ainda rodando nunca herda: a base não mostra falha nenhuma, e
   sem resultado dos dois lados nada prova que o PR não quebrou o check (revisão independente de
   17/11/2026). Ele sai da lista do que falta, e com isso não segura a aprovação, a
   espera do CI, o gate de entrada nem a publicação, e não vira texto de cobrança: todo leitor do
   estado do CI lê só o que falta. O que não está vermelho na base continua valendo como antes.
   Base ilegível (null) não inventa herança. PURA. */
function separarHerdados(faltando, rollupBase) {
  const lista = Array.isArray(faltando) ? faltando : [];
  if (!Array.isArray(rollupBase)) return { faltando: lista, herdados: [] };
  const ficam = [];
  const herdados = [];
  for (const f of lista) {
    const naBase = (checksExigidosVerdes(rollupBase, [f.nome]).faltando[0] || { estado: 'verde' }).estado;
    if (naBase === 'vermelho') herdados.push({ ...f, naBase });
    else ficam.push(f);
  }
  return { faltando: ficam, herdados };
}

// O commit atual da branch base e os checks dele, numa consulta GraphQL, no mesmo formato do
// statusCheckRollup do `gh pr view` (CheckRun com name, status, conclusion e startedAt; status
// legado com context, state e startedAt), para a mesma régua (checksExigidosVerdes) ler os dois.
const CONSULTA_DA_BASE = 'query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{oid ... on Commit{statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename ... on CheckRun{name status conclusion startedAt} ... on StatusContext{context state startedAt:createdAt}}}}}}}}}';
const JQ_DA_BASE = '.data.repository.ref.target | {oid: .oid, mais: (.statusCheckRollup.contexts.pageInfo.hasNextPage // false), rollup: (.statusCheckRollup.contexts.nodes // [])}';
const SHA_DO_COMMIT = /^[0-9a-f]{40}$/;

async function lerChecksDaBase(engine, conta, repo, base) {
  const [owner, name] = String(repo).split('/');
  if (!owner || !name || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['api', 'graphql', '-f', `query=${CONSULTA_DA_BASE}`, '-F', `owner=${owner}`, '-F', `name=${name}`,
    '-f', `ref=refs/heads/${base}`, '--jq', JQ_DA_BASE], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  // lista cortada não prova ausência de check na base; commit sem oid é a branch que não existe
  if (!j || !SHA_DO_COMMIT.test(String(j.oid || '')) || j.mais !== false || !Array.isArray(j.rollup)) return null;
  return { sha: j.oid, rollup: j.rollup };
}

/* Os checks do commit atual da base, ou null quando não deu para ler (quem chama trata como "não
   herdado", o comportamento de antes). Cache curto por repo@base (TEMPOS.CHECKS_DA_BASE_TTL_MS),
   guardando o SHA lido: o mesmo ciclo pergunta da mesma base para vários PRs, e a espera do CI
   relê a cada ciclo. A falha também fica no cache pelo mesmo prazo, para a leitura que falha não
   virar uma chamada por PR por ciclo; durante ele, vale o conservador.

   QUEM DECIDE LÊ FRESCO (`{ fresco: true }`, revisão independente de 17/11/2026): a retirada do
   pedido (lerCi, espera-ci.js). A leitura fresca atualiza o cache. A leitura da revisão usa o
   cache. */
async function checksDaBase(engine, conta, repo, base, { fresco = false } = {}) {
  if (!repo || !base) return null;
  if (!(engine.checksDaBaseCache instanceof Map)) engine.checksDaBaseCache = new Map();
  const chave = `${repo}@${base}`;
  const c = engine.checksDaBaseCache.get(chave);
  if (!fresco && c && (Date.now() - c.at) < TEMPOS.CHECKS_DA_BASE_TTL_MS) return c.lido ? c.lido.rollup : null;
  const lido = await lerChecksDaBase(engine, conta, repo, base);
  engine.checksDaBaseCache.set(chave, { lido, at: Date.now() });
  return lido ? lido.rollup : null;
}

// O que falta no head, sem o herdado da base. Só lê a base quando há check obrigatório fora do
// verde: com tudo verde não há o que comparar, e nenhuma chamada nova acontece.
async function semHerdados(engine, conta, repo, base, faltando, opcoes) {
  if (!Array.isArray(faltando) || !faltando.length) return { faltando: faltando || [], herdados: [] };
  return separarHerdados(faltando, await checksDaBase(engine, conta, repo, base, opcoes));
}

/* Os checks obrigatórios do head. Uma chamada gh pro PR (base + rollup no mesmo `--json`) e, no
   máximo, uma pra exigência do repo, que fica em cache.

   Devolve { bloqueado, faltando }. `bloqueado` só informa (nada espera por ele desde
   17/11/2026). Falta de dado (sem token, gh fora, rollup ilegível, repo sem exigência) vem como
   livre: o gate não inventa CI vermelho. */
async function bloqueadoPorChecks(engine, pr, opcoes) {
  const livre = { bloqueado: false, faltando: [] };
  const acc = engine.accountForPr(pr);
  if (!pr || !pr.url || !engine.tokenFor(acc)) return livre;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'baseRefName,headRefOid,statusCheckRollup'], { env: engine.ghEnv(acc) });
  if (!r.ok) return livre;
  const j = io.parseJson(r.stdout, null);
  if (!j) return livre;
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const exigidos = await checksExigidosDoRepo(engine, repo, j.baseRefName);
  if (!Array.isArray(exigidos) || !Array.isArray(j.statusCheckRollup) || !j.headRefOid) return livre;
  const v = await semHerdados(engine, acc, repo, j.baseRefName, checksExigidosVerdes(j.statusCheckRollup, exigidos).faltando, opcoes);
  const lido = { bloqueado: v.faltando.length > 0, faltando: v.faltando, herdados: v.herdados, verifiedHead: j.headRefOid };
  return semCheckObrigatorio(exigidos) ? { ...lido, semExigencia: true, naoVerdes: checksNaoVerdes(j.statusCheckRollup) } : lido;
}

/* O gate de entrada pelo CI (`aguardarCiParaRevisar`, "só começa com os checks obrigatórios
   verdes") saiu em 17/11/2026, regra do dono: o revisor nunca espera o CI para começar a
   revisar. `bloqueadoPorChecks` continua sendo a leitura dos checks obrigatórios do PR, mas só
   na SAÍDA (anexarChecksObrigatorios, abaixo, e a publicação em
   lib/technical-review/publication.js), como informação para a revisão e o card. */

// O estado dos checks OBRIGATÓRIOS no head, entregue ao gate como campo do envelope
// (result.checksObrigatorios), no mesmo desenho do verificationCheckpoint: decision.js continua
// puro. Lido na SAÍDA, como informação: o card avisa a aprovação que saiu com o check fora do
// verde (gate-espera.js). Leitura que falha devolve [] e o gate não inventa CI vermelho.
async function anexarChecksObrigatorios(engine, pr, result) {
  result.checksVerifiedHead = null;
  try {
    const checks = await engine.bloqueadoPorChecks(pr);
    result.checksVerifiedHead = checks?.verifiedHead || null;
    result.checksObrigatorios = Array.isArray(checks && checks.faltando) ? checks.faltando : [];
    // o herdado da base fica só para a linha informativa do card (avisoDosHerdados), sem peso
    result.checksHerdados = Array.isArray(checks && checks.herdados) ? checks.herdados : [];
    // repositório sem check obrigatório no ruleset: o card da aprovação avisa (avisoDaAprovacao)
    result.semCheckObrigatorio = checks?.semExigencia === true;
    result.checksForaDoRuleset = result.semCheckObrigatorio && Array.isArray(checks.naoVerdes) ? checks.naoVerdes : [];
  } catch { result.checksObrigatorios = []; }
}

const checksMod = {
  anexarChecksObrigatorios, checksExigidosVerdes, checksExigidosDoRepo, bloqueadoPorChecks,
  semCheckObrigatorio, checksNaoVerdes, separarHerdados, checksDaBase, semHerdados,
};
export default checksMod;
export {
  anexarChecksObrigatorios, checksExigidosVerdes, checksExigidosDoRepo, bloqueadoPorChecks,
  semCheckObrigatorio, checksNaoVerdes, separarHerdados, checksDaBase, semHerdados,
};
