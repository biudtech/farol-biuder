import { describe, expect, it, vi } from 'vitest';
import { aplicarEstadoInteiro } from '@/transporte/estado';
import {
  lerConfigDoSistema, lerContas, lerDiagnostico, lerModelos, lerPerfisDoClaude, lerRevogacao, lerSaude, lerSaudeDaRota,
  lerSessoes, lerSitesDoJira, lerTesteDePerfil, lerTesteDoJira,
} from './sistema';

// Valores com cara de segredo, montados em pedaços para o arquivo não parecer ter um.
const CHAVE_DA_ANTHROPIC = ['sk', 'ant', 'api03', 'AAAAAAAAAAAAAAAAAAAA'].join('-');
const TOKEN_DO_GITHUB = `ghp_${'a1B2c3D4'.repeat(4)}`;
const TOKEN_DO_ATLASSIAN = `ATATT${'x9Y8'.repeat(6)}`;
const SENHA = 'correto-cavalo-bateria';
const SEGREDOS = [CHAVE_DA_ANTHROPIC, TOKEN_DO_GITHUB, TOKEN_DO_ATLASSIAN, SENHA];

const semNenhumSegredo = (valor: unknown) => {
  const texto = JSON.stringify(valor);
  for (const segredo of SEGREDOS) expect(texto).not.toContain(segredo);
};

// A config como configParaFora (lib/engine/chave-do-perfil.js) a manda: o perfil de chave
// sem `apiKey` e com `temChave`.
const CONFIG = {
  intervalSeconds: 300,
  aguardarCiParaAprovar: false,
  parallelReviews: 2,
  globalParallelReviews: 0,
  reviewModel: 'opus',
  reviewEffort: 'high',
  claudeProfileId: 'plano',
  claudeProfiles: [
    { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '/home/farol/.farol/claude/plano' },
    { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true },
  ],
  bind: '0.0.0.0',
  hostPublico: 'farol.exemplo.com',
  origensPermitidas: ['https://painel.exemplo.com'],
  port: 47170,
};

describe('lerConfigDoSistema', () => {
  it('lê a automação, os perfis e as chaves só de arquivo; a pasta do perfil e a lista crua não ficam', () => {
    const registrar = vi.fn();
    const lido = lerConfigDoSistema(CONFIG, registrar);
    expect(lido).toEqual({
      aguardarCiParaAprovar: false,
      parallelReviews: 2,
      globalParallelReviews: 0,
      reviewModel: 'opus',
      reviewEffort: 'high',
      claudeProfileId: 'plano',
      claudeProfiles: [
        { id: 'plano', label: 'Assinatura', kind: 'dir' },
        { id: 'api', label: 'Chave', kind: 'apikey', temChave: true },
      ],
      bind: '0.0.0.0',
      hostPublico: 'farol.exemplo.com',
      origensPermitidas: ['https://painel.exemplo.com'],
      port: 47170,
    });
    // nada do perfil é guardado como veio: nem a pasta, nem uma lista crua
    expect(JSON.stringify(lido)).not.toContain('/home/farol');
    expect(Object.keys(lido)).not.toContain('claudeProfilesCru');
    expect(registrar).not.toHaveBeenCalled();
  });

  it('chave ausente ou de forma errada fica ausente, e config que não é objeto vira vazia', () => {
    expect(lerConfigDoSistema({ parallelReviews: '2', reviewModel: 3, origensPermitidas: [1], claudeProfiles: 'x' }, vi.fn())).toEqual({});
    expect(lerConfigDoSistema(null, vi.fn())).toEqual({});
  });

  it('perfil sem id fica de fora, e campo que a tela não conhece não é guardado', () => {
    const lido = lerConfigDoSistema({ claudeProfiles: [{ id: 'p1', kind: 'dir', cor: 'azul' }, { label: 'sem id' }, 7] }, vi.fn());
    expect(lido.claudeProfiles).toEqual([{ id: 'p1', kind: 'dir' }]);
  });

  // O teto de gasto saiu do motor em 16/11/2026: o campo de teto que um config antigo ainda
  // traga não é guardado nem vira marca nenhuma no perfil.
  it('campo de teto de um config antigo não é guardado nem marca o perfil', () => {
    for (const teto of [{ budgetDaily: 20 }, { budgetDaily: 0 }, { budgetTotal: 100, budgetSince: '2026-11-01' }, { budgetByWeekday: { 6: 5 } }, { budgetDates: { '2026-12-25': 0 } }]) {
      expect(lerConfigDoSistema({ claudeProfiles: [{ id: 'p1', kind: 'dir', ...teto }] }, vi.fn()).claudeProfiles).toEqual([{ id: 'p1', kind: 'dir' }]);
    }
  });

  it('perfil com id que parece chave e não é não some da lista: sk-anthropic-1', () => {
    const registrar = vi.fn();
    const lido = lerConfigDoSistema({ claudeProfiles: [{ id: 'sk-anthropic-1', label: 'Chave da Anthropic 1', kind: 'apikey', temChave: true }, { id: 'plano', kind: 'dir' }] }, registrar);
    expect(lido.claudeProfiles).toEqual([{ id: 'sk-anthropic-1', label: 'Chave da Anthropic 1', kind: 'apikey', temChave: true }, { id: 'plano', kind: 'dir' }]);
    expect(lido.segredosDescartados).toBeUndefined();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('segredo que chegue num perfil é descartado na borda, e o registro leva só a contagem', () => {
    const registrar = vi.fn();
    const lido = lerConfigDoSistema({
      claudeProfiles: [
        { id: 'api', label: 'Chave', kind: 'apikey', apiKey: CHAVE_DA_ANTHROPIC, temChave: true, baseUrl: `https://u:${SENHA}@proxy.exemplo.com` },
        { id: 'plano', kind: 'dir', token: TOKEN_DO_GITHUB, credencial: { senha: SENHA } },
      ],
    }, registrar);
    semNenhumSegredo(lido);
    expect(lido.claudeProfiles).toEqual([{ id: 'api', label: 'Chave', kind: 'apikey', temChave: true }, { id: 'plano', kind: 'dir' }]);
    expect(lido.segredosDescartados).toBe(4);
    expect(registrar).toHaveBeenCalledTimes(1);
    const aviso = String(registrar.mock.calls[0]?.[0]);
    expect(aviso).toContain('4 campo(s)');
    semNenhumSegredo(aviso);
    for (const nome of ['apiKey', 'token', 'credencial', 'senha']) expect(aviso).not.toContain(nome);
  });
});

describe('o snapshot com segredo não chega ao store', () => {
  it('um estado inteiro que traz token, chave, senha e credencial entra no store sem nenhum deles', () => {
    const avisos: string[] = [];
    const snapshot = aplicarEstadoInteiro(null, {
      app: { name: 'Farol', version: '3.0.0-dev', platform: 'linux', token: TOKEN_DO_GITHUB },
      // chaves que nenhuma tela lê ainda, e uma que entra como registro
      baseline: { at: 1, githubToken: TOKEN_DO_GITHUB },
      reviewActions: [{ nota: CHAVE_DA_ANTHROPIC, senha: SENHA }],
      paths: { home: '/home/farol/.farol', credencial: SENHA },
      esperaConflito: { 'dono/repo#1': { at: 1, head: 'abc', token: TOKEN_DO_GITHUB } },
      // o erro do motor é texto para ler: fica, sem o trecho
      error: `falha ao buscar: o gh respondeu 401 para o cabeçalho Authorization: Bearer ${TOKEN_DO_GITHUB}`,
      account: { user: 'farol-bot', tokenOk: true, token: TOKEN_DO_GITHUB },
      accounts: [{ user: 'farol-bot', owners: ['biudtech'], tokenOk: true, token: TOKEN_DO_GITHUB, ghToken: TOKEN_DO_GITHUB, autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
      config: {
        ...CONFIG,
        githubToken: TOKEN_DO_GITHUB,
        anthropicApiKey: CHAVE_DA_ANTHROPIC,
        claudeProfiles: [{ id: 'api', kind: 'apikey', apiKey: CHAVE_DA_ANTHROPIC, temChave: true, label: CHAVE_DA_ANTHROPIC }],
        jiraSites: [{ id: 'biud', baseUrl: 'https://biud.atlassian.net', email: 'x@biud.com.br', token: TOKEN_DO_ATLASSIAN }],
        people: {},
      },
      jiraSites: [{ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: true, token: TOKEN_DO_ATLASSIAN, credential: { email: 'x@biud.com.br', token: TOKEN_DO_ATLASSIAN } }],
      doctor: { node: 'v24.22.1', gh: 'gh version 2.80.0', claude: '2.1.300 (Claude Code)', ghAuth: true, ghToken: TOKEN_DO_GITHUB, root: false, home: '/home/farol/.farol', claudeAuth: [{ id: 'api', label: 'Chave', ready: true, apiKeyMode: true, apiKey: CHAVE_DA_ANTHROPIC }], checkedAt: 1 },
      claudePerfis: { problemas: [], uso: { plano: { lido: true, ok: false, erro: `o CLI respondeu Bearer ${TOKEN_DO_GITHUB}`, janelas: [], credencial: SENHA } } },
      modelos: { cli: { instalada: '2.1.300', token: TOKEN_DO_GITHUB }, claude: [{ valor: 'opus', rotulo: 'Opus', aceitaEsforco: true, apiKey: CHAVE_DA_ANTHROPIC }] },
    }, (aviso) => { avisos.push(aviso); });
    expect(snapshot).not.toBeNull();
    semNenhumSegredo(snapshot);
    semNenhumSegredo(avisos);
    // a presença continua lá, que é o que a tela mostra
    expect(snapshot?.accounts?.[0]?.tokenOk).toBe(true);
    expect(snapshot?.config?.claudeProfiles).toEqual([{ id: 'api', kind: 'apikey', temChave: true }]);
    expect(snapshot?.jiraSites?.[0]).toEqual({ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: true });
    expect(snapshot?.esperaConflito).toEqual({ 'dono/repo#1': { at: 1, head: 'abc' } });
    expect(snapshot?.baseline).toEqual({ at: 1 });
    // mensagem do motor não some: perde só o trecho
    expect(snapshot?.error).toBe('falha ao buscar: o gh respondeu 401 para o cabeçalho Authorization: Bearer [segredo omitido]');
    expect(snapshot?.claudePerfis?.uso.plano?.erro).toBe('o CLI respondeu Bearer [segredo omitido]');
    // a pasta do perfil e a do diagnóstico não vão ao store
    expect(JSON.stringify([snapshot?.config, snapshot?.doctor])).not.toContain('/home/farol');
  });

  it('texto longo que a tela mostra fica, com o trecho trocado: o review, o feed e o relatório de diagnóstico', () => {
    const review = `## Review\n\n${'O código lê a variável e segue. '.repeat(10)}\n\nNo log do CI apareceu ${TOKEN_DO_GITHUB} em texto claro.`;
    const snapshot = aplicarEstadoInteiro(null, {
      decisions: { pending: [{ id: 'd1', key: 'dono/repo#1', reportMarkdown: review, reasons: [{ text: `o gh respondeu com ${TOKEN_DO_GITHUB}`, kind: 'infra' }] }], resolved: [] },
      activity: { s1: [{ t: 1, k: 'info', text: `export GH_TOKEN=${TOKEN_DO_GITHUB}` }] },
    }, () => {});
    semNenhumSegredo([snapshot?.decisions?.pending, snapshot?.activity]);
    expect(snapshot?.decisions?.pending[0]?.reportMarkdown).toContain('No log do CI apareceu [segredo omitido] em texto claro.');
    expect(snapshot?.decisions?.pending[0]?.reportMarkdown).toContain('## Review');
    expect(snapshot?.decisions?.pending[0]?.reasons[0]?.text).toBe('o gh respondeu com [segredo omitido]');
    expect(snapshot?.activity?.s1?.[0]?.text).toBe('export GH_TOKEN=[segredo omitido]');
    const diagnostico = lerDiagnostico({ ok: true, markdown: `# Diagnóstico do Farol\n\n- erro: Authorization: Basic dXN1YXJpbzpzZW5oYS1sb25nYQ==\n`, falhas: [] });
    expect(diagnostico?.markdown).toBe('# Diagnóstico do Farol\n\n- erro: Authorization: Basic [segredo omitido]\n');
  });
});

describe('leitores do snapshot', () => {
  it('accounts: a conta com a política, a presença do token e a contagem das regras de review', () => {
    const registrar = vi.fn();
    const lido = lerContas([
      { user: 'farol-bot', owners: ['biudtech', 7], tokenOk: true, limiteGhAte: 0, limitePlanoAte: 0, autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes', reviewRules: { acme: { mode: 'manual' } }, padroesRevisao: 'texto' },
      { owners: [] },
    ], registrar);
    expect(lido).toEqual([{ user: 'farol-bot', owners: ['biudtech'], tokenOk: true, limiteGhAte: 0, limitePlanoAte: 0, autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes', regrasDeReview: 1 }]);
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(lerContas({}, vi.fn())).toBeUndefined();
  });

  it('doctor: nulo é valor (ainda não rodou), e os caminhos de pasta não são lidos', () => {
    expect(lerSaude(null, vi.fn())).toBeNull();
    expect(lerSaude('x', vi.fn())).toBeUndefined();
    expect(lerSaude({ node: 'v24.22.1', gh: null, claude: '2.1.300', ghAuth: false, root: false, instanciaIsolada: true, home: '/h', workspace: '/w', claudeAuth: [{ id: 'a', label: 'A', ready: true, apiKeyMode: true }, { id: 'b', ready: false, assinaturaMode: true }, { id: 'c' }], claudePerfilPronto: false, claudePerfilTipo: 'assinatura', claudePerfilFalta: 'login', avaliacaoTecnica: { pronta: false, detalhe: 'ferramenta ausente', ferramenta: 'ausente' }, checkedAt: 9 }, vi.fn())).toEqual({
      node: 'v24.22.1',
      claude: '2.1.300',
      ghAuth: false,
      root: false,
      instanciaIsolada: true,
      claudeAuth: [{ id: 'a', label: 'A', ready: true, tipo: 'chave' }, { id: 'b', ready: false, tipo: 'assinatura' }, { id: 'c', tipo: 'desconhecido' }],
      claudePerfilPronto: false,
      claudePerfilTipo: 'assinatura',
      claudePerfilFalta: 'login',
      avaliacaoTecnica: { pronta: false, detalhe: 'ferramenta ausente' },
      checkedAt: 9,
    });
    // avaliação técnica torta (sem o booleano ou sem o texto) fica de fora, e a tela diz sem dado
    expect(lerSaudeDaRota({ node: 'v24', avaliacaoTecnica: { pronta: 'sim', detalhe: 'x' } })).toEqual({ node: 'v24', claudeAuth: [] });
    expect(lerSaudeDaRota({ node: 'v24', avaliacaoTecnica: { pronta: true } })).toEqual({ node: 'v24', claudeAuth: [] });
    expect(lerSaudeDaRota({ node: 'v24' })).toEqual({ node: 'v24', claudeAuth: [] });
    expect(lerSaudeDaRota(null)).toBeNull();
  });

  it('doctor.saude: a saúde do motor campo a campo, e o torto sai', () => {
    const motor = { medidoEm: 5000, noArDesde: 1000, commit: 'a'.repeat(40), disco: { livreBytes: 30, totalBytes: 100 },
      telemetria: { consumoNoBanco: true, historicoNoBanco: false, ultimaEscritaEm: 4000 }, caminho: '/home/farol' };
    expect(lerSaudeDaRota({ saude: motor })?.motor).toEqual({ medidoEm: 5000, noArDesde: 1000, commit: 'a'.repeat(40), disco: { livreBytes: 30, totalBytes: 100 },
      telemetria: { consumoNoBanco: true, historicoNoBanco: false, ultimaEscritaEm: 4000 } });
    expect(lerSaudeDaRota({ saude: { commit: null, disco: null, telemetria: null } })?.motor).toEqual({});
    expect(lerSaudeDaRota({ saude: { commit: 'não é sha', disco: { livreBytes: 200, totalBytes: 100 }, telemetria: { consumoNoBanco: 'sim' } } })?.motor).toEqual({});
    expect(lerSaudeDaRota({ saude: 'x' })).toEqual({ claudeAuth: [] });
  });

  it('modelos: as seleções do catálogo e a versão do Claude Code', () => {
    expect(lerModelos({ cli: { instalada: '2.1.268', maisRecente: '2.1.300', atualizada: false, atrasada: true, atrasadaDesde: 5 }, claude: [{ valor: '', rotulo: 'Padrão', auto: false, aceitaEsforco: true, nome: '' }, { valor: 'auto', rotulo: 'Auto', auto: true, aceitaEsforco: false }, { rotulo: 'sem valor' }] }, vi.fn())).toEqual({
      cli: { instalada: '2.1.268', maisRecente: '2.1.300', atualizada: false, atrasada: true, atrasadaDesde: 5 },
      claude: [{ valor: '', rotulo: 'Padrão', auto: false, aceitaEsforco: true }, { valor: 'auto', rotulo: 'Auto', auto: true, aceitaEsforco: false }],
    });
    expect(lerModelos({ cli: null, claude: 'x' }, vi.fn())).toEqual({ claude: [] });
    expect(lerModelos([], vi.fn())).toBeUndefined();
  });

  it('claudePerfis: os problemas e o uso do plano por perfil', () => {
    expect(lerPerfisDoClaude({ problemas: [{ escopo: 'padrao', user: '', profileId: 'x', code: 'perfil-inexistente' }, {}], uso: { plano: { lido: true, ok: true, erro: '', em: 1, venceEm: 99, faixaDoLogin: 'perto', desatualizado: false, lidaEm: 1, janelas: [{ id: 's', nome: 'Sessão', usado: 0.4, reset: 5, resetTexto: 'às 18h' }] }, torto: 3, novo: { lido: false } } }, vi.fn())).toEqual({
      problemas: [{ profileId: 'x', code: 'perfil-inexistente' }],
      uso: { plano: { lido: true, ok: true, venceEm: 99, faixaDoLogin: 'perto', desatualizado: false, lidaEm: 1, janelas: [{ nome: 'Sessão', usado: 0.4, resetTexto: 'às 18h' }] }, novo: { lido: false, janelas: [] } },
    });
    expect(lerPerfisDoClaude(null, vi.fn())).toBeUndefined();
  });

  it('jiraSites: o site sem id é descartado e contado', () => {
    const registrar = vi.fn();
    expect(lerSitesDoJira([{ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: false }, { label: 'x' }], registrar)).toEqual([
      { id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: false },
    ]);
    expect(registrar).toHaveBeenCalledTimes(1);
  });
});

describe('leitores das rotas', () => {
  it('sessões: a lista com a atual marcada; id fora do formato fica de fora', () => {
    expect(lerSessoes({ ok: true, sessoes: [
      { id: '0123456789abcdef', rotulo: 'Notebook', criadoEm: 10, ultimoUsoEm: 20, atual: true, hash: 'x'.repeat(64) },
      { id: 'fedcba9876543210', rotulo: '', criadoEm: 5, ultimoUsoEm: 6, atual: false },
      { id: 'curto', rotulo: 'x' },
    ] })).toEqual({
      sessoes: [
        { id: '0123456789abcdef', rotulo: 'Notebook', criadoEm: 10, ultimoUsoEm: 20, atual: true },
        { id: 'fedcba9876543210', rotulo: '', criadoEm: 5, ultimoUsoEm: 6, atual: false },
      ],
      descartadas: 1,
    });
    for (const torto of [null, {}, { ok: false }, { ok: true }, { ok: true, sessoes: {} }]) expect(lerSessoes(torto)).toBeNull();
  });

  it('revogação: o aceite diz se era a atual, e a recusa traz o código', () => {
    expect(lerRevogacao({ ok: true, eraAtual: true })).toEqual({ ok: true, eraAtual: true });
    expect(lerRevogacao({ ok: true })).toEqual({ ok: true, eraAtual: false });
    expect(lerRevogacao({ ok: false, code: 'sessao_inexistente' })).toEqual({ ok: false, code: 'sessao_inexistente' });
    expect(lerRevogacao({ ok: 'sim' })).toBeNull();
  });

  it('teste de perfil: os campos com a origem de cada um, ou a recusa com o motivo', () => {
    expect(lerTesteDePerfil({ ok: true, escreveu: false, perfil: { id: 'plano', label: 'Assinatura', kind: 'dir', aviso: '', campos: { login: { valor: true, origem: 'validado' }, email: { valor: 'x@biud.com.br', origem: 'validado' }, tipoAuth: { valor: null, origem: 'desconhecido' }, plano: { valor: null, origem: 'desconhecido', motivo: 'não é detectável' }, token: { valor: TOKEN_DO_GITHUB, origem: 'validado' } } } })).toEqual({
      ok: true,
      id: 'plano',
      label: 'Assinatura',
      kind: 'dir',
      campos: { tipoAuth: { origem: 'desconhecido' }, login: { valor: true, origem: 'validado' }, email: { valor: 'x@biud.com.br', origem: 'validado' }, plano: { origem: 'desconhecido', motivo: 'não é detectável' } },
    });
    expect(lerTesteDePerfil({ ok: false, code: 'perfil-inexistente', motivo: 'esse perfil não existe mais na configuração' })).toEqual({ ok: false, code: 'perfil-inexistente', motivo: 'esse perfil não existe mais na configuração' });
    expect(lerTesteDePerfil({ ok: true })).toBeNull();
  });

  it('teste do Jira: quem a credencial representa, ou o código e a frase', () => {
    expect(lerTesteDoJira({ ok: true, site: { id: 'biud' }, quem: 'Farol Bot' })).toEqual({ ok: true, quem: 'Farol Bot' });
    expect(lerTesteDoJira({ ok: false, code: 'sem_credencial', site: null, motivo: 'o site do Jira desta organização está sem credencial cadastrada' })).toEqual({ ok: false, code: 'sem_credencial', motivo: 'o site do Jira desta organização está sem credencial cadastrada' });
    expect(lerTesteDoJira([])).toBeNull();
  });

  it('diagnóstico: o markdown do motor e a contagem das falhas', () => {
    expect(lerDiagnostico({ ok: true, markdown: '# Diagnóstico do Farol\n', falhas: [{}, {}] })).toEqual({ markdown: '# Diagnóstico do Farol\n', falhas: 2 });
    expect(lerDiagnostico({ ok: true })).toBeNull();
  });
});
