// Fonte ÚNICA dos literais de infra (core.duplication.business-rule: chave de
// infra e tempo têm nome e UM endereço). Antes a porta 47170 vivia em 6 pontos
// e divergiria em silêncio num ajuste.
const DEFAULT_PORT = 47170;
// base das duracoes derivadas. Fica FORA do objeto pra as outras poderem se
// apoiar nela, e escrita como 3600*1000 (nao 60*60*1000) porque a forma
// `N * 60 * 1000` e justamente o que o gate de qualidade conta como tempo magico.
const HORA_MS = 3600 * 1000;

const TEMPOS = {
  GH_TIMEOUT_MS: 60000,          // teto dos comandos gh/shell (io.run/runShell)
  SESSAO_HEADLESS_MS: 2 * HORA_MS, // teto absoluto, mesmo com progresso contínuo
  SESSAO_SEM_PROGRESSO_MS: HORA_MS / 2, // silêncio de eventos úteis, não tempo total
  RECUPERACAO_SEM_PROGRESSO_MS: HORA_MS / 12,
  // teto de cada passo da montagem da copia do eng-behaviour (clone, instalacao, build)
  CONSTRUCAO_FERRAMENTA_MS: HORA_MS / 6,
  // intervalo minimo entre gravacoes do consumo parcial no diario de tentativas
  // (lib/engine/usage-tentativas.js). O fim de cada turno grava sempre; entre turnos,
  // uma sessao que emite dezenas de eventos por segundo nao reescreve o arquivo a cada um.
  TENTATIVA_PARCIAL_MS: 5000,
  SSE_PING_MS: 25000,            // keepalive do EventSource
  // prazo da sonda do socket Unix antes do listen (lib/escuta-em-socket.js): socket local
  // responde na hora; sem resposta no prazo conta como vivo, e a subida é recusada
  SOCKET_SONDA_MS: 2000,
  // Sem NADA vindo do engine por isto (nem batimento), a conexao esta morta sem ter
  // avisado: proxy ou antivirus que bufferiza text/event-stream deixa o socket aberto
  // e a tela congelada sem disparar onerror. Tres batimentos perdidos mais folga, o
  // mesmo criterio do STREAM_IDLE_MS do stream remoto.
  SSE_OCIOSO_MS: 90 * 1000,
  LOG_ROTACAO_BYTES: 2 * 1024 * 1024, // teto do farol.log antes de rotacionar
  // teto do state/spawns.log antes de rotacionar. Maior que o do farol.log porque
  // este e de alto volume por natureza (uma linha por comando disparado, e o ciclo
  // de polling dispara dezenas por minuto), e menor do que o que ele ja alcancou
  // sozinho: medido em 30/08/2026, com debugSpawns ligado, o arquivo estava com
  // 60 MB e crescendo, porque NADA o rotacionava. Diagnostico e sobre o passado
  // recente; historico infinito so ocupa disco.
  SPAWN_LOG_ROTACAO_BYTES: 8 * 1024 * 1024,
  // espera do scan de pushback quando o limite do plano Claude nao cita a hora do reset.
  // Com hora citada quem manda e a mensagem (resetAtFrom); sem ela, meia hora e o suficiente
  // pra nao gastar uma sessao por ciclo numa condicao que so passa com o tempo.
  PUSHBACK_ESPERA_SEM_HORA_MS: HORA_MS / 2,
  // limite do plano sem hora de reset citada (lib/engine/limite-plano.js): o perfil fica
  // indisponível por este prazo ESTIMADO
  LIMITE_PLANO_SEM_HORA_MS: HORA_MS,
  // a label "<conta>:revisando" sem coordenação espera o primeiro evento da sessão ou este prazo
  // depois do spawn (lib/engine/label-tardia.js): sessão que morre antes não deixa label pública
  LABEL_APOS_SPAWN_MS: HORA_MS / 240,
  // espera das buscas de uma conta que estourou o limite de requisicoes do GitHub, quando
  // o proprio GitHub nao informa a hora do reset. Mesma doutrina do PUSHBACK acima: sem
  // prazo citado, meia hora e o bastante pra parar de queimar cota a cada ciclo de 30 s
  // numa condicao que so passa com o tempo.
  LIMITE_GH_ESPERA_SEM_HORA_MS: HORA_MS / 2,
  // espera quando o GitHub recusou a busca mas a cota GraphQL ainda tem saldo: foi o
  // limite de rajada, e o GitHub manda esperar ao menos um minuto. Dois minutos dao
  // folga sem deixar a conta cega por um ciclo de polling inteiro.
  LIMITE_GH_ESPERA_RAJADA_MS: HORA_MS / 30,
  // de quanto em quanto tempo a sessao de revisao confere se o mundo andou (head novo,
  // revisao ja existente, PR fechado). Tres minutos: a sessao tipica de infra mede 7
  // minutos, entao duas conferidas cabem dentro dela, e o custo e de tres chamadas gh por tique.
  VIGIA_SESSAO_MS: HORA_MS / 20,
  // processo da sessão que saiu com o pipe ainda preso por um neto (fecharSaidaPresa):
  // quanto esperar o 'close' antes de fechar os pipes do lado do Farol
  SAIDA_SEM_FECHAMENTO_MS: HORA_MS / 360,
  // teto de uma consulta às fontes preparadas (lib/review-context/query.js), que a sessão
  // roda como ferramenta: passou disso, o processo encerra sozinho em vez de ficar órfão
  CONSULTA_FONTES_MS: HORA_MS / 12,
  // versao do Claude Code (lib/engine/versao-claude.js): relida a cada 6 h, para um
  // `claude update` aparecer sem reiniciar o Farol; atrasado so depois de 3 dias atras,
  // porque o CLI sai com versao nova quase todo dia e um aviso por patch viveria aceso
  CLAUDE_CLI_VERSAO_MS: HORA_MS * 6,
  // de quanto em quanto tempo a referência de retomada que sobrou pergunta se o PR fechou
  RETOMADA_CONFERIR_MS: HORA_MS,
  CLAUDE_CLI_TOLERANCIA_MS: HORA_MS * 24 * 3,
  CLAUDE_CLI_REGISTRO_TIMEOUT_MS: HORA_MS / 360,
  HORA_MS,                       // base de TTLs curtos de cache
  DIA_MS: 24 * HORA_MS,          // base das janelas contadas em dias
  // poda do escopo materializado (state/pr-scope): patch por arquivo de PR que ninguem
  // reanalisa ha uma semana e so disco ocupado; a proxima analise materializa de novo
  ESCOPO_PR_MAX_AGE_MS: 7 * 24 * 3600 * 1000,
  PROVA_ARQUIVO_MAX_AGE_MS: 30 * 24 * 3600 * 1000, // poda da prova por arquivo (state/file-proof): PR morto ha semanas nao herda mais nada
  // poda do rascunho que as SESSOES deixam em workspace/tmp (clone de repositorio,
  // patch avulso). Mesma regua do escopo materializado, e a folga e deliberada: sessao
  // headless vive no maximo SESSAO_HEADLESS_MS, entao material de uma semana nao pode
  // pertencer a nada em andamento. Medido em 31/08/2026: 4,0 GB em 394.683 arquivos,
  // o mais novo com quatro dias, porque nada olhava para esse diretorio.
  TMP_SESSAO_MAX_AGE_MS: 7 * 24 * 3600 * 1000,
  // cache da lista de checks OBRIGATORIOS de um repo@branch. Ela muda por mudanca de
  // ruleset, que e raro; meia hora e a mesma janela que o fetchRuleBlocked ja usa pra
  // ler o mesmo endpoint, e evita uma chamada gh por PR por ciclo.
  CHECKS_EXIGIDOS_TTL_MS: HORA_MS / 2,
  // cache dos checks do commit atual da branch base, para o check herdado (checks-exigidos.js).
  // Curto porque a base anda: um minuto cobre o ciclo que pergunta da mesma base para vários PRs.
  CHECKS_DA_BASE_TTL_MS: HORA_MS / 60,
  GIT_OCIOSO_PARA_DESPEJO_MS: HORA_MS,
  LABEL_FOLGA_OBSERVACAO_MS: HORA_MS / 6,
  LABEL_GRAVAR_OBSERVACAO_MS: HORA_MS / 12,
  // prazo da pendência de remoção da label `<conta>:revisando` (lib/engine/labels-a-tirar.js)
  // (7 dias, escrito como 7 * 24 * HORA_MS porque DIA_MS ainda não existe aqui, é declarado depois no objeto)
  LABEL_PENDENCIA_MAX_MS: 7 * 24 * HORA_MS,
  // memoria do review que ACABOU de sair (dedup da fila de postagem, decision.js).
  // Curta DE PROPOSITO: ela cobre a CORRIDA entre duas vias (10 segundos no caso
  // real do biud-esg#230), e so isso. Passada a janela, quem decide e o dedup
  // remoto de cada via, que sabe o que esta memoria nao sabe: review DISMISSED
  // pelo autor nao conta como postado, entao aprovar de novo no MESMO head e
  // legitimo depois que a aprovacao anterior foi derrubada. Com janela longa a
  // memoria vetaria essa repostagem e o app daria a pendencia por resolvida sem
  // nada ter ido pro PR.
  POSTAGEM_MEMORIA_MS: HORA_MS / 12,  // 5 min
  // Debounce do round automático pós-push: o head precisa estar quieto por esta
  // janela antes de gastar sessão, senão uma rajada de pushes (caso engine-ai#90,
  // 14 commits em ciclos rápidos) viraria uma sessão por push. Na prática o
  // ciclo de polling já espaça; isto garante o mínimo mesmo com polling curto.
  HEAD_QUIETO_MS: 300000,
  // Espera LONGA do mesmo debounce (v2.59.3): vale depois de MAX_RODADAS_PRESAS rodadas
  // seguidas que terminaram de novo com commit novo no meio (lib/engine/review.js). O
  // autor ainda está empurrando; meia hora de PR quieto antes de gastar outra sessão,
  // e o round volta sozinho depois dela, sem clique.
  HEAD_QUIETO_LONGO_MS: HORA_MS / 2,
  // Validade do sinal de "revisão em andamento" (a label <conta>:revisando de outra pessoa,
  // lib/engine/skip-review.js). Cobre o teto absoluto de 2h mais 1h de folga.
  SINAL_REVISAO_TTL_MS: 3 * HORA_MS,
  // Intervalo entre as retentativas da postagem da revisão automática quando a recusa não
  // chegou à rede (lib/engine/postagem-retentativa.js, falhaPassageira).
  POSTAGEM_RETENTATIVA_MS: 2 * 1000,
  // Autenticação da API local (A4, spec 2026-09-15-operacao-multidispositivo, 7.A4).
  // Código de pareamento: 10 minutos de vida, uso único.
  PAREAMENTO_VALIDADE_MS: HORA_MS / 6,
  // Sessão autorizada: expira com 30 dias sem uso ou 90 dias desde a criação.
  SESSAO_LOCAL_OCIOSA_MS: 30 * 24 * HORA_MS,
  SESSAO_LOCAL_ABSOLUTA_MS: 90 * 24 * HORA_MS,
  // O último uso só é regravado quando ficou mais velho que isto: sem a folga, toda
  // chamada da API reescreveria o arquivo de sessões.
  SESSAO_LOCAL_TOQUE_MS: HORA_MS,
  // um stream de eventos aberto reconfere a própria credencial com esta memória: revogar
  // corta o que está aberto em no máximo este tempo, sem ler o disco a cada envio
  STREAM_RECONFERENCIA_MS: 2000,
  // login do Claude pela tela (lib/engine/login-web.js): quanto o CLI tem para mostrar o
  // link, quanto ele tem para responder ao código, e quanto o login fica aberto esperando
  LOGIN_WEB_LINK_MS: 20000,
  LOGIN_WEB_CODIGO_MS: 60000,
  LOGIN_WEB_ABERTO_MS: HORA_MS / 6,
  // Uso do plano do Claude (lib/engine/uso-do-plano.js): por quanto tempo o `/usage` lido vale
  // antes de ler de novo, quanto ele tem para responder, e a antecedência dos dois avisos de
  // login que vence (o primeiro e o do último dia)
  CLAUDE_USO_CACHE_MS: HORA_MS / 12,
  CLAUDE_USO_LIMITE_MS: HORA_MS / 60,
  CLAUDE_VENCE_AVISO_MS: HORA_MS * 72,
  CLAUDE_VENCE_ULTIMO_DIA_MS: HORA_MS * 24,
};
// Infra do Jira multi-tenant. Nomes em MAIÚSCULO de propósito: a regra
// `tempoMagico` do gate casa `timeout:` minúsculo, e o lar legítimo do número é
// aqui. A API é a v2 porque a v3 devolve `description` em ADF (JSON aninhado) e
// exigiria um interpretador só pra ler critério de aceite.
const JIRA = {
  CACHE_TTL_MS: HORA_MS,        // card muda durante a vida do PR; 1h equilibra frescor e releitura
  REQUEST_TIMEOUT_MS: 20000,    // teto de UMA chamada ao Atlassian, o que o conector claude.ai não dá (timeout medido lá: 300s)
  API_PATH: '/rest/api/2/issue/',
  SEARCH_PATH: '/rest/api/2/search',
  MYSELF_PATH: '/rest/api/2/myself',   // prova credencial sem depender de existir card algum
  FIELDS: 'summary,status,description',
  CACHE_DIR: 'cards',           // dentro de ~/.farol/, fora do workspace da sessão (ver lib/jira/cache.js)
  MCP_DIR: 'mcp',               // dentro de ~/.farol/
  MCP_SERVER_NAME: 'farol-jira',
};

// Fuso do dia canônico do Consumo (lib/usage/activity.js): o dia vira à meia-noite de Brasília.
const FUSO_DO_DIA = 'America/Sao_Paulo';

// Limites da autenticação da API local (A4). Os caminhos moram em lib/paths.js.
const LOCAL_AUTH = {
  CODIGO_TAMANHO: 10,     // caracteres base32 do código de pareamento
  CODIGO_MAX_ERROS: 5,    // tentativas erradas que invalidam o código
  TOKEN_BYTES: 32,        // bytes aleatórios do token de sessão
  ROTULO_MAX: 60,         // tamanho máximo do rótulo descritivo da sessão
};

// Ambiente fixo de toda sessão headless do claude (runProvedor, em lib/engine/session.js).
// Headless não tem "depois": quando o turno acaba, o processo acaba. Com segundo plano
// disponível, o modelo mandava a espera pelo CI para o background (`run_in_background`),
// encerrava o turno com "aguardo o resultado" e a sessão morria sem o JSON. Medido em
// biud-frontend#1239, #1249 e #1267 (29 e 30/09/2026): três revisões perdidas, cada uma com
// um `until ... gh pr checks ... pending` em segundo plano. A variável é o knob oficial do
// Claude Code; com ela o Bash recusa o parâmetro (provado no CLI real em 30/09/2026). O
// prompt também pede, mas pedido ao modelo não é trava.
const ENV_HEADLESS = Object.freeze({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });

export default { DEFAULT_PORT, TEMPOS, JIRA, FUSO_DO_DIA, LOCAL_AUTH, ENV_HEADLESS };
export { DEFAULT_PORT, TEMPOS, JIRA, FUSO_DO_DIA, LOCAL_AUTH, ENV_HEADLESS };
