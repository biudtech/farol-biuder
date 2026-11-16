import { describe, expect, it, vi } from 'vitest';
import { aplicarEstadoInteiro } from '@/transporte/estado';
import { semSegredos } from './segredos';
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

describe('semSegredos', () => {
  it('tira o campo de nome suspeito, e deixa a presença do segredo, que é booleano', () => {
    const lido = semSegredos({ id: 'p1', apiKey: CHAVE_DA_ANTHROPIC, temChave: true, tokenOk: false, hasCredential: true, senha: SENHA, token: 3 });
    expect(lido).toEqual({ limpo: { id: 'p1', temChave: true, tokenOk: false, hasCredential: true }, descartados: 3 });
  });

  it('tira o valor com prefixo de chave ou de token, qualquer que seja o nome do campo', () => {
    const lido = semSegredos({ label: TOKEN_DO_GITHUB, nota: TOKEN_DO_ATLASSIAN, lista: ['ok', CHAVE_DA_ANTHROPIC], cabecalho: 'Bearer abcdefgh12345678' });
    expect(lido).toEqual({ limpo: { lista: ['ok'] }, descartados: 4 });
  });

  it('tira o endereço com usuário, e deixa o endereço comum e as chaves de projeto do Jira', () => {
    const lido = semSegredos({ baseUrl: `https://ana:${SENHA}@proxy.exemplo.com`, outro: 'https://api.exemplo.com', projectKeys: ['BT', 'BUGS'] });
    expect(lido).toEqual({ limpo: { outro: 'https://api.exemplo.com', projectKeys: ['BT', 'BUGS'] }, descartados: 1 });
  });

  it('o que está fundo demais para conferir sai inteiro, e o protótipo não é mexido', () => {
    let fundo: unknown = { apiKey: CHAVE_DA_ANTHROPIC };
    for (let i = 0; i < 12; i += 1) fundo = { dentro: fundo };
    semNenhumSegredo(semSegredos(fundo).limpo);
    const comProto = semSegredos(JSON.parse('{"__proto__":{"apiKey":"x"},"id":"p1"}'));
    expect(Object.getPrototypeOf(comProto.limpo)).toBe(Object.prototype);
    expect(({} as { apiKey?: string }).apiKey).toBeUndefined();
  });

  it('valor que não é objeto nem lista passa como veio', () => {
    expect(semSegredos(3)).toEqual({ limpo: 3, descartados: 0 });
    expect(semSegredos(null)).toEqual({ limpo: null, descartados: 0 });
    expect(semSegredos('texto comum')).toEqual({ limpo: 'texto comum', descartados: 0 });
  });
});

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
    { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 20 },
    { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true, budgetTotal: 100, budgetSince: '2026-11-01', budgetByWeekday: { 0: 0, 6: 5 }, budgetDates: { '2026-12-25': 0 } },
  ],
  bind: '0.0.0.0',
  hostPublico: 'farol.exemplo.com',
  origensPermitidas: ['https://painel.exemplo.com'],
  port: 47170,
};

describe('lerConfigDoSistema', () => {
  it('lê a automação, os perfis e as chaves só de arquivo, e guarda a lista de perfis como veio', () => {
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
        { id: 'plano', label: 'Assinatura', kind: 'dir', budgetDaily: 20 },
        { id: 'api', label: 'Chave', kind: 'apikey', temChave: true, budgetTotal: 100, budgetSince: '2026-11-01', budgetByWeekday: { 0: 0, 6: 5 }, budgetDates: { '2026-12-25': 0 } },
      ],
      claudeProfilesCru: CONFIG.claudeProfiles,
      bind: '0.0.0.0',
      hostPublico: 'farol.exemplo.com',
      origensPermitidas: ['https://painel.exemplo.com'],
      port: 47170,
    });
    expect(registrar).not.toHaveBeenCalled();
  });

  it('chave ausente ou de forma errada fica ausente, e config que não é objeto vira vazia', () => {
    expect(lerConfigDoSistema({ parallelReviews: '2', reviewModel: 3, origensPermitidas: [1], claudeProfiles: 'x' }, vi.fn())).toEqual({});
    expect(lerConfigDoSistema(null, vi.fn())).toEqual({});
  });

  it('perfil com campo que a tela não conhece é contado, e o cru o mantém', () => {
    const perfis = [{ id: 'p1', kind: 'dir', cor: 'azul' }, { label: 'sem id' }, 7];
    const lido = lerConfigDoSistema({ claudeProfiles: perfis }, vi.fn());
    expect(lido.claudeProfiles).toEqual([{ id: 'p1', kind: 'dir' }]);
    expect(lido.claudeProfilesCru).toEqual(perfis);
    expect(lido.claudeProfilesIlegiveis).toBe(3);
  });

  it('segredo que chegue num perfil é descartado na borda: não fica no lido nem no cru, e o registro leva só a contagem', () => {
    const registrar = vi.fn();
    const lido = lerConfigDoSistema({
      claudeProfiles: [
        { id: 'api', label: 'Chave', kind: 'apikey', apiKey: CHAVE_DA_ANTHROPIC, temChave: true, baseUrl: `https://u:${SENHA}@proxy.exemplo.com`, budgetDaily: 5 },
        { id: 'plano', kind: 'dir', token: TOKEN_DO_GITHUB, credencial: { senha: SENHA } },
      ],
    }, registrar);
    semNenhumSegredo(lido);
    expect(lido.claudeProfiles).toEqual([{ id: 'api', label: 'Chave', kind: 'apikey', temChave: true, budgetDaily: 5 }, { id: 'plano', kind: 'dir' }]);
    expect(lido.claudeProfilesCru).toEqual([{ id: 'api', label: 'Chave', kind: 'apikey', temChave: true, budgetDaily: 5 }, { id: 'plano', kind: 'dir' }]);
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
      claudePerfis: { problemas: [], uso: { plano: { lido: true, ok: false, erro: `Bearer ${TOKEN_DO_GITHUB}`, janelas: [], credencial: SENHA } } },
      modelos: { cli: { instalada: '2.1.300', token: TOKEN_DO_GITHUB }, claude: [{ valor: 'opus', rotulo: 'Opus', aceitaEsforco: true, apiKey: CHAVE_DA_ANTHROPIC }] },
    }, (aviso) => { avisos.push(aviso); });
    expect(snapshot).not.toBeNull();
    semNenhumSegredo(snapshot);
    semNenhumSegredo(avisos);
    // a presença continua lá, que é o que a tela mostra
    expect(snapshot?.accounts?.[0]?.tokenOk).toBe(true);
    expect(snapshot?.config?.claudeProfiles).toEqual([{ id: 'api', kind: 'apikey', temChave: true }]);
    expect(snapshot?.config?.claudeProfilesCru).toEqual([{ id: 'api', kind: 'apikey', temChave: true }]);
    expect(snapshot?.jiraSites?.[0]).toEqual({ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: true });
    expect(snapshot?.esperaConflito).toEqual({ 'dono/repo#1': { at: 1, head: 'abc' } });
    expect(snapshot?.baseline).toEqual({ at: 1 });
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
    expect(lerSaude({ node: 'v24.22.1', gh: null, claude: '2.1.300', ghAuth: false, root: false, instanciaIsolada: true, home: '/h', workspace: '/w', claudeAuth: [{ id: 'a', label: 'A', ready: true, apiKeyMode: true }, { id: 'b', ready: false, assinaturaMode: true }, { id: 'c' }], claudePerfilPronto: false, claudePerfilTipo: 'assinatura', claudePerfilFalta: 'login', checkedAt: 9 }, vi.fn())).toEqual({
      node: 'v24.22.1',
      claude: '2.1.300',
      ghAuth: false,
      root: false,
      instanciaIsolada: true,
      claudeAuth: [{ id: 'a', label: 'A', ready: true, tipo: 'chave' }, { id: 'b', ready: false, tipo: 'assinatura' }, { id: 'c', tipo: 'desconhecido' }],
      claudePerfilPronto: false,
      claudePerfilTipo: 'assinatura',
      claudePerfilFalta: 'login',
      checkedAt: 9,
    });
    expect(lerSaudeDaRota({ node: 'v24' })).toEqual({ node: 'v24', claudeAuth: [] });
    expect(lerSaudeDaRota(null)).toBeNull();
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
