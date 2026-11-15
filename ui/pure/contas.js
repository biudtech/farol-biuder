// Contas, perfis do Claude e orçamento: escopo e barra de contas, banner do topo, selo de
// autenticação, editor de orçamento por perfil e gerenciador de contas. Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo
// não mudou.
//
// Banner do topo: os três avisos (sem conta, conta sem token, falha na última checagem)
// são decisão de TEXTO, não de DOM. A forma é `if` plano de propósito, e sem `?.` também
// de propósito: snapshot sem `account` tem que explodir alto em vez de virar
// silenciosamente "Nenhuma conta detectada".
//
// Painel de perfis e contas: o render lê o estado e atribui; o CONSTRUTOR só recebe um ctx
// e devolve string. Ficaram no app.js, por serem DOM e não markup, o guarda de foco e o
// `hint.hidden = true` do fim dos perfis.
//
// Editor de orçamento (v2.50.0): cada perfil de chave de API tem o seu. Três granularidades, do geral para o específico, na mesma
// ordem em que o dailyCapFor resolve: teto base, por dia da semana, de uma data só.

// escopo salvo no navegador validado contra as contas atuais: conta removida ou
// renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
// Compara sem caixa e preserva o valor original quando ele e valido.
import { esc, fmtMoney, fmtClock } from './comum.js';
import { reviewScopeHtml } from './review-scope.js';

export function validScope(scope, users) {
  if (!scope || scope === 'all') return 'all';
  const s = String(scope).toLowerCase();
  return (users || []).some(u => String(u).toLowerCase() === s) ? scope : 'all';
}

// abas onde a barra de contas APARECE: so onde o filtro por conta age de verdade
// (Radar e Time filtram/agrupam por SCOPE). Allowlist, nao denylist:
// uma aba que nasceu depois chegou a mostrar um filtro que nao filtrava nada (B14);
// aba nova nasce SEM a barra ate alguem decidir que ela respeita o escopo.
export function accountBarVisible(nContas, tab) {
  return nContas >= 2 && (tab === 'radar' || tab === 'time');
}

// Os campos de uma edição de conta como viajam para POST /api/accounts/edit. `undefined`
// some do JSON, e "tirar o valor" (perfil, peso na cota) chegaria ao servidor como "não
// mexer": vai null, que o servidor lê como remover o campo (lib/engine/contas-config.js).
export function camposDaEdicao(patch) {
  return Object.fromEntries(Object.entries(patch || {}).map(([k, v]) => [k, v === undefined ? null : v]));
}

// Buscas paradas por limite do GitHub. Vem ANTES dos outros avisos porque, enquanto ela
// vale, o que a tela mostra do GitHub é retrato velho, e isso muda como ler todo o resto.
// Medido em 30/09/2026: 38 bloqueios em poucos dias, e nenhum deles aparecia na tela.
function avisoDeBuscasPausadas(lista) {
  const paradas = (lista || []).filter(x => x && x.ate);
  if (!paradas.length) return '';
  const quais = paradas.map(x => `<b>@${esc(x.conta)}</b> até ${esc(fmtClock(x.ate))}`).join(' · ');
  return `Buscas pausadas pelo limite de requisições do GitHub: ${quais}. `
    + 'O que está na tela é o último retrato; insistir só prolongaria o bloqueio.';
}

export function statusBannerHtml(s = {}) {
  const pausadas = avisoDeBuscasPausadas(s.buscasPausadas);
  if (pausadas) return pausadas;
  const partindo = s.status === 'starting';
  if (!s.account.user && !partindo) {
    return 'Bem-vindo ao Farol! Nenhuma conta do GitHub foi detectada. Rode <code>gh auth login</code> no terminal (conta de trabalho) e clique em Verificar agora.';
  }
  if (!s.account.tokenOk && !partindo) {
    return `A conta <b>${esc(s.account.user)}</b> não está autenticada no GitHub CLI. Rode <code>gh auth login</code> no terminal e clique em Verificar agora.`;
  }
  if (s.status === 'error' && s.error) {
    return `Falha na última checagem: ${esc(s.error)}. Vou tentar de novo no próximo ciclo.`;
  }
  return '';
}

// ` selected` de <option>: o padrão aparecia doze vezes no mesmo template da linha
// de conta, e cada repetição contava como ternário no gate. Um nome resolve as doze
// e o markup fica legível: `${sel(a.onClean === 'approve')}` em vez do ternário inteiro.
function sel(cond) { return cond ? ' selected' : ''; }

// Selo do teto estourado. Os motivos `-previsto` dizem que o gasto ainda NÃO
// passou do teto, mas a próxima revisão passaria: é a diferença entre "acabou" e
// "a próxima não cabe", e a ação de quem lê é diferente em cada caso.
function seloOrcamento(budget) {
  const eixo = String(budget.reason || '').startsWith('total') ? 'orçamento total' : 'orçamento diário';
  if (String(budget.reason || '').endsWith('-previsto')) {
    const custo = Number(budget.tipicoReview || 0).toFixed(2);
    return `<span class="a-claude bad" title="a próxima revisão (US$ ${custo} em média) passaria do ${eixo}, então a automação pausou antes de gastar (clique manual continua liberado)">🔴 ${eixo} no limite</span>`;
  }
  return `<span class="a-claude bad" title="${eixo} estourado, automação pausada (clique manual continua liberado)">🔴 ${eixo} estourado</span>`;
}

export function claudeAuthBadge(id, ctx) {
  const all = (ctx.doctor && ctx.doctor.claudeAuth) || [];
  // sem perfil nenhum a sessão não abre: o selo diz isso em vez de sumir. Doctor que ainda
  // não chegou (sem a lista) não diz nada.
  if (!all.length) return ctx.doctor && Array.isArray(ctx.doctor.claudeAuth) ? '<span class="a-claude bad" title="Cadastre uma chave de API em Plano e chaves">SEM PERFIL</span>' : '';
  // id === '' é a conta sem perfil próprio e sem padrão salvo: vale o primeiro com chave
  const info = all.find(x => x.id === id) || all.find(x => x.ready) || all[0];
  if (!info.ready) return `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
  // bloqueio de orçamento vem de ctx.usage.budgets (fonte única, viva a cada
  // pushState, v2.40.0); o doctor parou de carregar blocked/reason, e este selo
  // lia de lá (achado da revisão adversarial: o ramo tinha virado código morto).
  const budget = ((ctx.usage && ctx.usage.budgets) || []).find(b => b.id === (info.id || id)) || {};
  if (budget.blocked) return seloOrcamento(budget);
  return `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`;
}

const DIAS_DO_TETO = [
  { dow: '1', nome: 'seg' }, { dow: '2', nome: 'ter' }, { dow: '3', nome: 'qua' },
  { dow: '4', nome: 'qui' }, { dow: '5', nome: 'sex' },
  { dow: '6', nome: 'sáb' }, { dow: '0', nome: 'dom' },
];

const CAP_ORIGEM_LABEL = { data: 'só hoje', semana: 'deste dia da semana', base: 'padrão' };

// valor de input numérico: campo vazio quando não há teto (placeholder explica),
// nunca 0, porque 0 é um teto VÁLIDO que bloqueia tudo e seria mentira mostrá-lo
function valorTeto(v) { return Number.isFinite(v) ? v : ''; }

function linhaGastoHoje(info) {
  if (!info) return '';
  const gasto = fmtMoney(info.today || 0);
  if (!Number.isFinite(info.capHoje)) return `Hoje: ${gasto} (sem teto)`;
  const origem = CAP_ORIGEM_LABEL[info.capOrigem] || '';
  // 0 é teto de verdade: o número sozinho ("de US$ 0.00") não dizia que a automação parou.
  // A origem fica junto, senão um 0 do dia da semana ou da data não diz onde mudar.
  if (info.capHoje === 0) {
    const de = info.capOrigem === 'base' || !origem ? '' : ` ${origem}`;
    return `Hoje: ${gasto} · teto 0${de}: revisão automática pausada`;
  }
  const marca = info.capOrigem === 'base' ? '' : ` · teto ${origem}`;
  return `Hoje: ${gasto} de ${fmtMoney(info.capHoje)}${marca}`;
}

function botaoSugestao(p, info) {
  // some assim que existe teto salvo: sugestão é ajuda pra começar, não conselho
  // permanente, e um botão que reescreve o que a pessoa configurou seria hostil
  const sugestao = info && info.sugestaoDiaria;
  if (!sugestao || Number.isFinite(p.budgetDaily)) return '';
  // arredonda em centavos: o valor cru é uma mediana com 9 casas, e ela ia parar
  // dentro do config.json e do campo da tela do jeito que saiu da conta
  const emCentavos = Math.round(sugestao * 100) / 100;
  return `<button class="btn sm ghost cp-usar-sugerido" data-id="${esc(p.id)}" data-valor="${emCentavos}"
    title="Mediana do que você gastou nos dias úteis dos últimos 30 dias. Só passa a valer depois de salvar.">usar ${esc(fmtMoney(sugestao))}</button>`;
}

function campoDia(p, d) {
  const v = valorTeto((p.budgetByWeekday || {})[d.dow]);
  return `<label class="cp-dow"><span>${esc(d.nome)}</span>
    <input class="cp-budget-dow" type="number" min="0" step="0.01" data-id="${esc(p.id)}" data-dow="${d.dow}" value="${v}" placeholder="padrão"></label>`;
}

function linhaData(p, dia, valor) {
  return `<li><span class="cp-data-dia">${esc(dia)}</span><span class="cp-data-valor">${esc(fmtMoney(valor))}</span>
    <button class="btn icon sm ghost cp-budget-date-del" data-id="${esc(p.id)}" data-dia="${esc(dia)}" title="Remover o teto desta data" aria-label="Remover o teto desta data">✕</button></li>`;
}

function listaDeDatas(p) {
  const datas = Object.entries(p.budgetDates || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!datas.length) return '<p class="a-hint">Nenhuma data com teto próprio.</p>';
  return `<ul class="cp-datas">${datas.map(([dia, v]) => linhaData(p, dia, v)).join('')}</ul>`;
}

export function budgetEditorHtml(p, info) {
  const id = esc(p.id);
  return `<div class="cp-budget">
    <div class="cp-budget-head"><strong>Orçamento</strong><span class="a-hint">${esc(linhaGastoHoje(info))}</span></div>
    <div class="a-editrow">
      <input class="cp-budget-daily" type="number" min="0" step="0.01" data-id="${id}" value="${valorTeto(p.budgetDaily)}" placeholder="Teto por dia (US$, vazio = sem teto)">
      ${botaoSugestao(p, info)}
    </div>
    <div class="a-editrow">
      <input class="cp-budget-total" type="number" min="0" step="0.01" data-id="${id}" value="${valorTeto(p.budgetTotal)}" placeholder="Teto total (US$, vazio = sem teto)">
      <input class="cp-budget-since" type="date" data-id="${id}" value="${esc(p.budgetSince || '')}" title="Contar o teto total a partir desta data">
    </div>
    <p class="a-hint">Campo vazio: sem teto. 0 pausa a revisão automática deste perfil (o clique manual continua valendo).</p>
    <details class="cp-budget-mais">
      <summary>Ajustar por dia</summary>
      <div class="a-editrow cp-atalhos">
        <button class="btn sm ghost cp-budget-uteis" data-id="${id}" title="Copia o teto por dia para segunda a sexta">aplicar aos dias úteis</button>
        <button class="btn sm ghost cp-budget-fds" data-id="${id}" title="Copia o teto por dia para sábado e domingo">aplicar ao fim de semana</button>
        <button class="btn sm ghost cp-budget-limpa-dow" data-id="${id}" title="Remove os tetos por dia da semana (volta todos ao padrão)">limpar</button>
      </div>
      <div class="cp-dows">${DIAS_DO_TETO.map(d => campoDia(p, d)).join('')}</div>
      <p class="a-hint">Dia em branco usa o teto por dia lá de cima; 0 pausa naquele dia.</p>
      <div class="a-editrow">
        <input class="cp-budget-date-new" type="date" data-id="${id}" title="Data com teto próprio">
        <input class="cp-budget-date-val" type="number" min="0" step="0.01" data-id="${id}" placeholder="Teto só nesse dia (US$)">
        <button class="btn sm cp-budget-date-add" data-id="${id}">adicionar</button>
      </div>
      ${listaDeDatas(p)}
    </details>
  </div>`;
}

export function claudeProfilesHtml(ctx) {
  const c = ctx.config || {};
  const profiles = c.claudeProfiles || [];
  const rows = profiles.map(p => {
    // gasto vem de ctx.usage.budgets (fonte unica do orcamento, viva a cada
    // pushState), nunca mais do cache do doctor, que congelava o "Hoje" daqui
    // enquanto a aba Consumo andava (v2.40.0)
    const budgetInfo = ((ctx.usage && ctx.usage.budgets) || []).find(x => x.id === p.id);
    // todo o orçamento sai de budgetEditorHtml: teto base, por dia da semana e por data única
    const camposOrcamento = budgetEditorHtml(p, budgetInfo);
    const camposChave = `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>`;
    return `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id, ctx)}
      </div>
      ${camposChave + camposOrcamento}
      <div class="cp-teste" data-teste="${esc(p.id)}"></div>
    </div>
    <div class="a-actions">
      <button class="btn sm cp-testar" data-id="${esc(p.id)}">Testar perfil</button>
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil de chave de API</div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddApiKey" type="password" placeholder="chave de API" spellcheck="false" autocomplete="off">
      <input id="cpAddBaseUrl" placeholder="URL base (opcional)" spellcheck="false">
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
    <div class="a-hint" id="cpAddHint">Deixe a URL base em branco pra usar a Anthropic direto. Um endpoint customizado (um proxy, por exemplo) precisa falar a API de Mensagens da Anthropic.</div>
  </div>`;
  return rows + addForm;
}

// As palavras da política da conta, um lugar só (30/09/2026): o cartão de Sistema > Contas e
// os controles à distância de Radar > Aparelhos (ui/pure/aparelhos-painel.js) editam os
// MESMOS quatro campos, e com cada tela escrevendo o seu texto o mesmo campo tinha dois
// nomes. Cada opção é [valor gravado, texto].
export const POLITICA_DA_CONTA_TEXTOS = Object.freeze({
  autoReview: {
    rotulo: 'quando chega um PR pra você',
    opcoes: [[true, 'revisa sozinho'], [false, 'só põe na fila (você manda revisar; o resultado segue as regras abaixo)']],
  },
  onClean: {
    rotulo: 'quando fica aprovável sem ressalvas',
    opcoes: [['approve', 'aprova sozinho'], ['wait', 'espera você aprovar']],
  },
  onCaveats: {
    rotulo: 'quando fica aprovável com ressalvas',
    opcoes: [['approve', 'aprova (as ressalvas ficam no app)'], ['wait', 'espera você aprovar']],
    // o com ressalvas nunca é mais permissivo que o limpo: com o limpo esperando, não há escolha
    presoAoLimpo: 'espera você (o sem ressalvas espera)',
  },
  onReject: {
    rotulo: 'quando tem bloqueios',
    opcoes: [['wait', 'espera você'], ['request_changes', 'reprova sozinho (posta pedir mudanças)']],
  },
});

// A frase do aviso depois de mudar um dos quatro campos da política (com o Desfazer ao lado).
// Vazia para campo que não é política, porque aviso só existe onde a mudança tem efeito no GitHub.
export function textoDaMudancaDePolitica({ user, campo, para }) {
  const def = POLITICA_DA_CONTA_TEXTOS[campo];
  if (!def) return '';
  const opcao = def.opcoes.find(([valor]) => valor === para);
  const nova = opcao ? opcao[1] : String(para);
  return `Política de @${user} alterada: ${def.rotulo}, ${nova}.`;
}

// O valor que a conta tem em cada campo, por extenso. O servidor grava os quatro em toda
// conta (lib/engine/contas-migracao.js); a leitura tolerante é para o retrato otimista da
// tela entre o clique e a resposta, e ela devolve o mesmo padrão da conta nova.
export function politicaDaContaNaTela(a) {
  const c = a || {};
  const onClean = c.onClean === 'wait' ? 'wait' : 'approve';
  // o com ressalvas nunca é mais permissivo que o limpo
  const onCaveats = onClean === 'approve' && c.onCaveats !== 'wait' ? 'approve' : 'wait';
  const onReject = c.onReject === 'wait' ? 'wait' : 'request_changes';
  return { autoReview: c.autoReview !== false, onClean, onCaveats, onReject };
}

// O que devolve a conta ao estado de antes da mudança. Trocar "sem ressalvas" para aguardar também
// leva o "com ressalvas" junto (aplicarEdicao, lib/engine/contas-config.js): desfazer só o campo
// mexido deixaria a aprovação com ressalvas desligada sem ninguém ter pedido.
export function politicaParaDesfazer(antes, campo) {
  return campo === 'onClean' ? { onClean: antes.onClean, onCaveats: antes.onCaveats } : { [campo]: antes[campo] };
}

function opcoesDaPolitica(campo, atual) {
  return POLITICA_DA_CONTA_TEXTOS[campo].opcoes
    .map(([v, texto]) => `<option value="${esc(String(v))}"${sel(v === atual)}>${esc(texto)}</option>`).join('');
}

// O que o CI obrigatório faz com a aprovação, conforme "CI obrigatório antes da aprovação"
// (Sistema > Automação, 06/11/2026). Desligada, que é o padrão, nada pode prometer espera do CI.
export function fraseDoCi(config) {
  if (config && config.aguardarCiParaAprovar === true) {
    return 'CI obrigatório vermelho ou rodando só adia: o Farol espera e aprova sozinho quando fechar verde no mesmo commit';
  }
  return 'O estado do CI obrigatório não segura nem adia a aprovação (CI obrigatório antes da aprovação está desligado em Automação); o merge só fica barrado pelo GitHub onde o check é obrigatório no ruleset';
}

export function accountsManagerHtml(ctx) {
  // não re-renderiza enquanto você edita um campo (senão apaga o que está digitando)
  const accounts = (ctx.accounts || []);
  const multi = accounts.length > 1;
  const T = POLITICA_DA_CONTA_TEXTOS;
  const rows = accounts.map(a => {
    const meta = ctx.acct[a.user.toLowerCase()] || {};
    // três estados, um por linha: silenciada ganha de tudo, senão o token decide
  let auth = 'sem token: rode gh auth login';
  if (a.muted) auth = 'silenciada (fora dos avisos e da auto-revisão)';
  else if (a.tokenOk) auth = 'autenticada no gh';
    // os condicionais inline saem pra nomes: o template da linha de conta tinha
    // sete deles e o gate conta interrogacao por statement, sem distinguir markup
    // de logica. Nomeados, da pra ler a linha sem desembaralhar ternario.
    const selo = a.primary ? '<span class="a-tag">primária</span>' : '';
    const classeAuth = (a.tokenOk && !a.muted) ? 'ok' : '';
    // os quatro seletores mostram o valor da conta, sem opção de herdar (30/09/2026). Com o
    // "sem ressalvas" esperando você, o "com ressalvas" não tem escolha: fica desligado e diz por quê
    const pol = politicaDaContaNaTela(a);
    const frase = { ci: fraseDoCi(ctx.config) };
    const ressalvaPresa = pol.onClean === 'wait';
    let opcoesRessalva = opcoesDaPolitica('onCaveats', pol.onCaveats);
    if (ressalvaPresa) opcoesRessalva = `<option value="wait" selected>${esc(T.onCaveats.presoAoLimpo)}</option>`;
    const travaRessalva = ressalvaPresa ? ' disabled' : '';
    const classeMute = a.muted ? 'ok' : 'ghost';
    const rotuloMute = a.muted ? 'Reativar' : 'Silenciar';
    // a barra de acoes sai pra um nome: e o maior condicional do template e
    // aparecia inteiro no meio do markup da linha
    const barraAcoes = multi ? `<div class="a-actions">
        <button class="btn sm ${classeMute} act-mute" data-user="${esc(a.user)}">${rotuloMute}</button>
        <button class="btn sm danger-ghost acct-remove" data-user="${esc(a.user)}" title="parar de monitorar esta conta no Farol">Remover</button>
      </div>` : '';
    return `<div class="card acct-card ${a.muted ? 'muted' : ''}" style="--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};">
      <input type="color" class="acct-color" data-user="${esc(a.user)}" value="${esc(a.color || meta.color || '#ffb454')}" title="cor da conta">
      <div class="a-body">
        <div class="a-editrow">
          <input class="acct-label" data-user="${esc(a.user)}" value="${esc(a.label || a.user)}" placeholder="rótulo" spellcheck="false" title="rótulo da conta">
          <input class="acct-kind" data-user="${esc(a.user)}" list="acctKinds" value="${esc(a.kind || '')}" placeholder="tipo (Pessoal/Trabalho)" spellcheck="false">
          ${selo}
        </div>
        <div class="a-sub"><a class="a-auth ${classeAuth}" href="https://github.com/${encodeURIComponent(a.user)}" target="_blank" rel="noreferrer" title="Abrir @${esc(a.user)} no GitHub">@${esc(a.user)}</a> · ${esc(auth)}</div>
        <div class="a-editrow orgs"><span class="a-fieldlabel">orgs</span>
          <input class="acct-owners" data-user="${esc(a.user)}" value="${esc((a.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false" title="organizações monitoradas por esta conta"></div>
        <div class="a-pol-note">O que o Farol faz sozinho nos PRs desta conta:</div>
        <div class="a-policy">
          <div class="a-pol-item"><span class="a-fieldlabel">${T.autoReview.rotulo}</span>
            <select class="acct-autoreview" data-user="${esc(a.user)}" title="Revisar sozinho ou só listar e esperar você mandar revisar. Revisar sozinho não é na hora: espera os checks obrigatórios ficarem verdes (só se você ligou Esperar o CI antes de revisar em Automação), sai de cena se outra pessoa estiver revisando, segura com reprovação humana ou duas aprovações humanas no head, respeita o limite do plano e o orçamento, e só roda com o Farol aberto">
              ${opcoesDaPolitica('autoReview', pol.autoReview)}
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">${T.onClean.rotulo}</span>
            <select class="acct-onclean" data-user="${esc(a.user)}" title="PR aprovável e sem nenhum ponto de atenção. Com o Jira ligado, isso exige o card do PR lido e atendido: PR sem card cai na regra com ressalvas. ${frase.ci}">
              ${opcoesDaPolitica('onClean', pol.onClean)}
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">${T.onCaveats.rotulo}</span>
            <select class="acct-oncaveats" data-user="${esc(a.user)}"${travaRessalva} title="PR aprovável, mas com pontos de atenção anotados: o que a revisão levantou, PR sem card do Jira (quando o Jira está ligado), leitura que não cobriu o diff inteiro, dependência em aberto ou discordância de outro review. O APPROVE sai com o texto da revisão; as ressalvas ficam aqui no app, não no PR. ${frase.ci}">
              ${opcoesRessalva}
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">${T.onReject.rotulo}</span>
            <select class="acct-onreject" data-user="${esc(a.user)}" title="PR com bloqueios reais (a revisão pediu mudanças)">
              ${opcoesDaPolitica('onReject', pol.onReject)}
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">perfil de chave de API</span>
            <select class="acct-claudeprofile" data-user="${esc(a.user)}" title="Qual chave de API do Claude roda as sessões desta conta. O modelo e o raciocínio vêm de Plano e chaves, iguais para todas as contas">
              <option value="">usa o perfil padrão (Plano e chaves)</option>
              ${(ctx.config.claudeProfiles || []).map(p => `<option value="${esc(p.id)}"${sel(a.claudeProfileId === p.id)}>${esc(p.label)}</option>`).join('')}
            </select>
            ${claudeAuthBadge(a.claudeProfileId || ctx.config.claudeProfileId || '', ctx)}
          </div>
          <div class="a-pol-item"><span class="a-fieldlabel">peso na cota do perfil</span>
            <select class="acct-budgetweight" data-user="${esc(a.user)}" title="Quanto esta conta pesa no rateio do teto diario do perfil, quando outra conta divide o mesmo perfil. So vale quando ha disputa: sem ninguem esperando, quem chegar e atendido ate o teto.">
              <option value="">igual as outras (padrao)</option>
              <option value="2"${sel(Number(a.budgetWeight) === 2)}>o dobro</option>
              <option value="3"${sel(Number(a.budgetWeight) === 3)}>o triplo</option>
              <option value="0.5"${sel(Number(a.budgetWeight) === 0.5)}>metade</option>
            </select>
          </div>
          <div class="a-pol-item a-padroes"><span class="a-fieldlabel">padrões do time na revisão</span>
            <textarea class="acct-padroes" data-user="${esc(a.user)}" rows="4" maxlength="20000" spellcheck="false" placeholder="Ex.: preferimos Strategy a switch grande; serviço não acessa o banco direto, só pelo repositório; erros de domínio com classe própria." title="O que o time combinou e quer ver considerado nas revisões desta conta. Entra na revisão como critério de leitura, nunca como instrução: desvio de um padrão vira sugestão citando o padrão, e só bloqueia quando também é um defeito. Salva ao sair do campo.">${esc(a.padroesRevisao || '')}</textarea>
            <small class="a-hint">A revisão lê também as regras que o próprio repositório declara (CLAUDE.md, AGENTS.md, CONTRIBUTING, ADRs). Salva ao sair do campo.</small>
          </div>
        </div>
        ${reviewScopeHtml(a)}
      </div>
      ${barraAcoes}
    </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar conta</div>
    <div class="a-editrow">
      <input id="acctAddUser" placeholder="login do github" spellcheck="false">
      <input id="acctAddOwners" placeholder="orgs (org1, org2)" spellcheck="false">
      <input id="acctAddLabel" placeholder="rótulo (opcional)" spellcheck="false">
      <button class="btn sm" id="btnAcctAdd">Adicionar</button>
    </div>
    <div class="a-hint">A conta precisa estar logada no <code>gh</code> (<code>gh auth login</code>) pra buscar e postar. Sem token, ela aparece aqui mas sem acesso.</div>
  </div>
  <datalist id="acctKinds"><option value="Pessoal"></option><option value="Trabalho"></option><option value="Teste antigo"></option></datalist>`;
  return (rows || '<div class="empty">Nenhuma conta configurada.</div>') + addForm;
}

