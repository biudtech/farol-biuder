// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import { dataComAno } from '@/radar/formato';
import type { Resultado } from '@/transporte/cliente';
import { aplicarEstadoInteiro } from '@/transporte/estado';
import { Sistema } from './Sistema';

type Falha = Extract<Resultado<never>, { ok: false }>;
// O que o motor de mentira devolve: o corpo cru (que passa pelo leitor da borda, como no
// cliente de verdade) ou uma falha do transporte.
type Resposta = { corpo: unknown } | Falha;

const corpo = (valor: unknown): Resposta => ({ corpo: valor });
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };

// Valores com cara de segredo, montados em pedaços para o arquivo não parecer ter um.
const CHAVE_DA_ANTHROPIC = ['sk', 'ant', 'api03', 'CCCCCCCCCCCCCCCCCCCC'].join('-');
const TOKEN_DO_GITHUB = `ghp_${'z9Y8x7W6'.repeat(4)}`;

// Os perfis como configParaFora (lib/engine/chave-do-perfil.js) os manda: o de chave sem
// `apiKey` e com `temChave`.
const PLANO = { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 20 };
const API = { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true, budgetByWeekday: { 6: 5 } };

const CONTA = { user: 'farol-bot', owners: ['biudtech'], tokenOk: true, limiteGhAte: 0, limitePlanoAte: 0, autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };
const ABERTA = { ...CONTA, autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };

const CONFIG = {
  intervalSeconds: 300,
  aguardarCiParaAprovar: true,
  parallelReviews: 1,
  globalParallelReviews: 0,
  reviewModel: 'opus',
  reviewEffort: '',
  claudeProfileId: 'plano',
  claudeProfiles: [PLANO, API],
  bind: '127.0.0.1',
  hostPublico: 'farol.exemplo.com',
  origensPermitidas: ['https://painel.exemplo.com'],
  port: 47170,
  people: {},
};

// O snapshot como o motor o emite (snapshot(), server.js, na raiz).
const BRUTO = {
  app: { name: 'Farol', version: '3.0.0-dev', platform: 'linux' },
  doctor: {
    node: 'v24.22.1', gh: 'gh version 2.80.0', claude: '2.1.300 (Claude Code)', ghAuth: true, root: false, instanciaIsolada: false,
    home: '/home/farol/.farol', workspace: '/home/farol/.farol/workspace',
    claudeAuth: [{ id: 'plano', label: 'Assinatura', ready: true, assinaturaMode: true }, { id: 'api', label: 'Chave', ready: true, apiKeyMode: true }],
    claudePerfilPronto: true, claudePerfilTipo: 'assinatura', claudePerfilFalta: '', checkedAt: 1763300000000,
  },
  modelos: {
    cli: { instalada: '2.1.300', maisRecente: '2.1.300', atualizada: true, atrasadaDesde: 0, atrasada: false },
    claude: [
      { valor: '', rotulo: 'Padrão do Claude', nome: '', auto: false, aceitaEsforco: true },
      { valor: 'auto', rotulo: 'Auto (qualidade primeiro)', nome: '', auto: true, aceitaEsforco: false },
      { valor: 'opus', rotulo: 'Opus', nome: 'Opus', auto: false, aceitaEsforco: true },
      { valor: 'sonnet', rotulo: 'Sonnet', nome: 'Sonnet', auto: false, aceitaEsforco: true },
    ],
  },
  claudePerfis: { problemas: [], uso: { plano: { lido: true, ok: true, erro: '', em: 1, venceEm: 0, faixaDoLogin: '', desatualizado: false, lidaEm: 1, janelas: [{ id: 's', nome: 'Sessão', usado: 0.4, reset: 5, resetTexto: 'às 18h' }] } } },
  accounts: [CONTA],
  config: CONFIG,
  jiraSites: [{ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: true }],
};

const ATUAL = { id: '0123456789abcdef', rotulo: 'Notebook', criadoEm: 1763200000000, ultimoUsoEm: 1763290000000, atual: true };
const OUTRA = { id: 'fedcba9876543210', rotulo: 'Celular', criadoEm: 1763100000000, ultimoUsoEm: 1763150000000, atual: false };
const SESSOES = { ok: true, sessoes: [ATUAL, OUTRA] };

// O estado como entra no store: o bruto passado pelos leitores da borda de verdade.
function snapshotDe(bruto: unknown): Snapshot {
  const lido = aplicarEstadoInteiro(null, bruto, () => {});
  if (!lido) throw new Error('snapshot de teste fora da forma');
  return lido;
}

interface Montagem {
  bruto?: unknown;
  semEstado?: boolean;
  conexao?: EstadoDoApp['conexao'];
  estadoEmDia?: boolean;
  responder?: (caminho: string) => Resposta | Promise<Resposta>;
  // o corpo cru que cada POST devolve; sem resposta própria, a lista de sessões e `{ ok: true }`
  aoPostar?: (rota: string, enviado: unknown) => Resposta | Promise<Resposta> | undefined;
}

function montar({ bruto = BRUTO, semEstado = false, conexao = 'conectado', estadoEmDia = true, responder = () => REDE, aoPostar = () => undefined }: Montagem = {}) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao, estadoEmDia, snapshot: semEstado ? null : snapshotDe(bruto) });
  const ler = (r: Resposta, leitor: (bruto: unknown) => unknown) => {
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  };
  const get = vi.fn(async (caminho: string, leitor: (bruto: unknown) => unknown) => ler(await responder(caminho), leitor));
  const post = vi.fn(async (rota: string, enviado: unknown, leitor: (bruto: unknown) => unknown) => {
    const propria = await aoPostar(rota, enviado);
    return ler(propria ?? corpo(rota === '/api/auth/sessions' ? SESSOES : { ok: true }), leitor);
  });
  const esquecerSessao = vi.fn();
  const app = { store, cliente: { get, post }, dispensarRecados: () => store.trocar({ recados: [] }), esquecerSessao } as unknown as App;
  const tela = render(<Sistema app={app} />);
  // os POSTs que não são a carga da lista de sessões
  const envios = (): Array<[string, unknown]> => post.mock.calls.filter(([rota]) => rota !== '/api/auth/sessions').map(([rota, enviado]) => [rota, enviado]);
  const trocar = (novo: unknown) => act(() => { store.trocar({ snapshot: snapshotDe(novo) }); });
  return { store, get, post, esquecerSessao, envios, trocar, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };
const secao = (nome: string | RegExp) => screen.getByRole('region', { name: nome });
const na = (nome: string | RegExp) => within(secao(nome));
const clicarEm = async (onde: ReturnType<typeof within>, nome: string | RegExp) => { await act(async () => { fireEvent.click(onde.getByRole('button', { name: nome })); }); };
const mudar = (campo: HTMLElement, valor: string) => { act(() => { fireEvent.change(campo, { target: { value: valor } }); }); };
const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });

const SAUDE = 'Saúde';
const CONTA_E_POLITICA = 'Conta revisora e política';
const AUTOMACAO = 'Automação';
const CLAUDE = 'Perfil do Claude e teto de gasto';
const JIRA = 'Jira';
const SESSOES_PAREADAS = 'Sessões pareadas';
const REDE_E_ACESSO = 'Rede e acesso';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Sistema: a página', () => {
  it('tem as sete seções com título próprio e o índice que leva a cada uma', async () => {
    montar();
    await assentar();
    expect(screen.getByRole('heading', { level: 1, name: 'Sistema' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([SAUDE, CONTA_E_POLITICA, AUTOMACAO, CLAUDE, JIRA, SESSOES_PAREADAS, REDE_E_ACESSO]);
    const indice = within(screen.getByRole('navigation', { name: 'Seções do Sistema' })).getAllByRole('link');
    expect(indice.map((a) => a.getAttribute('href'))).toEqual(['#saude', '#conta', '#automacao', '#claude', '#jira', '#sessoes', '#rede']);
    for (const link of indice) expect(document.getElementById((link.getAttribute('href') ?? '').slice(1))).not.toBeNull();
  });

  it('não tem campo de senha nem campo para digitar token, chave ou credencial', async () => {
    const t = montar();
    await assentar();
    expect(t.container.querySelector('input[type="password"]')).toBeNull();
    const rotulos = [...t.container.querySelectorAll('label')].map((l) => l.textContent ?? '');
    expect(rotulos.length).toBeGreaterThan(5);
    for (const rotulo of rotulos) expect(rotulo).not.toMatch(/token|chave de api|senha|credencial|api key/i);
  });

  it('segredo que venha no estado não aparece na tela, e a seção dos perfis avisa que descartou', async () => {
    const t = montar({
      bruto: {
        ...BRUTO,
        accounts: [{ ...CONTA, token: TOKEN_DO_GITHUB }],
        config: { ...CONFIG, githubToken: TOKEN_DO_GITHUB, claudeProfiles: [PLANO, { ...API, apiKey: CHAVE_DA_ANTHROPIC }] },
        doctor: { ...BRUTO.doctor, ghToken: TOKEN_DO_GITHUB },
      },
    });
    await assentar();
    expect(t.container.innerHTML).not.toContain(CHAVE_DA_ANTHROPIC);
    expect(t.container.innerHTML).not.toContain(TOKEN_DO_GITHUB);
    expect(JSON.stringify(t.store.ler().snapshot)).not.toContain(CHAVE_DA_ANTHROPIC);
    expect(na(CLAUDE).getByRole('alert').textContent).toContain('1 campo(s) com cara de segredo');
    // o caminho de pasta do diagnóstico também não é mostrado
    expect(t.container.innerHTML).not.toContain('/home/farol');
  });

  it('sem o estado do motor a tela diz que está esperando, e cada seção diz o que falta', async () => {
    montar({ semEstado: true });
    await assentar();
    expect(screen.getByText(/Esperando o estado do motor/)).toBeTruthy();
    expect(na(SAUDE).getByText(/o motor não mandou o diagnóstico/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByText(/o motor não mandou a conta revisora/)).toBeTruthy();
    expect(na(AUTOMACAO).getByText(/o motor não mandou as chaves de automação/)).toBeTruthy();
    expect(na(CLAUDE).getByText(/o motor não mandou a lista de perfis/)).toBeTruthy();
    expect(na(JIRA).getByText(/o motor não mandou a lista de sites/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Salvar/ })).toBeNull();
  });
});

describe('Sistema: saúde', () => {
  const linhas = () => within(na(SAUDE).getByRole('list', { name: 'Verificações do diagnóstico' })).getAllByRole('listitem').map((li) => li.textContent);

  it('mostra cada verificação com o estado em texto e a versão do motor', async () => {
    montar();
    await assentar();
    expect(linhas()).toEqual([
      'OKNode: v24.22.1',
      'OKGitHub CLI: gh version 2.80.0',
      'OKAutenticação do GitHub: autenticado',
      'OKClaude Code: 2.1.300 (Claude Code)',
      'OKUsuário do sistema: usuário comum',
      'OKPerfil do Claude que o motor usa: pronto (assinatura)',
      'OKPerfil de assinatura: Assinatura: pronto',
      'OKPerfil de chave de API: Chave: pronto',
      'OKEscrita no GitHub: instância normal: o motor publica pelos gates',
      'OKVersão do Claude Code: 2.1.300 é a mais recente',
      'OKMonitoramento da conta: @farol-bot vigiando biudtech',
    ]);
    expect(na(SAUDE).getByRole('status', { name: 'Resumo da saúde' }).textContent).toBe('11 verificações, nenhuma pede atenção.');
    expect(na(SAUDE).getByText('3.0.0-dev')).toBeTruthy();
  });

  it('o que não está certo pede atenção em texto, não só na cor', async () => {
    montar({ bruto: { ...BRUTO, doctor: { ...BRUTO.doctor, ghAuth: false, claudePerfilPronto: false, claudePerfilFalta: 'login' }, accounts: [{ ...CONTA, tokenOk: false }] } });
    await assentar();
    expect(linhas()).toContain('AtençãoAutenticação do GitHub: sem autenticação');
    expect(linhas().find((l) => l?.includes('Perfil do Claude que o motor usa'))).toMatch(/^Atenção.*sem login/);
    expect(linhas().find((l) => l?.includes('Monitoramento da conta'))).toMatch(/^Atenção.*sem token no gh/);
    expect(na(SAUDE).getByRole('status', { name: 'Resumo da saúde' }).textContent).toBe('11 verificações, 3 pedem atenção.');
  });

  it('diagnóstico que ainda não rodou é dito, e não vira lista de falhas', async () => {
    montar({ bruto: { ...BRUTO, doctor: null } });
    await assentar();
    expect(na(SAUDE).getByText(/ainda não rodou nesta execução do motor\. Rode-o abaixo/)).toBeTruthy();
    expect(linhas()).toEqual(['OKVersão do Claude Code: 2.1.300 é a mais recente', 'OKMonitoramento da conta: @farol-bot vigiando biudtech']);
  });

  it('Rodar o diagnóstico de novo chama GET /api/doctor e diz o que o motor respondeu', async () => {
    const t = montar({ responder: (caminho) => (caminho === '/api/doctor' ? corpo({ ...BRUTO.doctor, checkedAt: 1763300060000 }) : REDE) });
    await assentar();
    expect(na(SAUDE).getByText(/Não abre sessão de IA e não consome o plano nem a chave/)).toBeTruthy();
    await clicarEm(na(SAUDE), 'Rodar o diagnóstico de novo');
    await assentar();
    expect(t.get.mock.calls.map(([caminho]) => caminho)).toEqual(['/api/doctor']);
    expect(na(SAUDE).getByRole('status', { name: 'Resultado do diagnóstico' }).textContent).toContain('O motor refez o diagnóstico');
  });

  it('falha ao rodar o diagnóstico aparece como erro, e a lista anterior fica', async () => {
    montar();
    await assentar();
    await clicarEm(na(SAUDE), 'Rodar o diagnóstico de novo');
    await assentar();
    expect(na(SAUDE).getByRole('status', { name: 'Resultado do diagnóstico' }).textContent).toBe('Erro: Não deu para falar com o motor (falha de rede). O que está acima é do diagnóstico anterior.');
    expect(linhas()).toHaveLength(11);
  });

  it('o relatório é o markdown do motor, pedido em GET /api/diagnostics', async () => {
    const t = montar({ responder: (caminho) => (caminho === '/api/diagnostics' ? corpo({ ok: true, markdown: '# Diagnóstico do Farol\n\n## Ambiente\n\n- ok · Node: v24.22.1\n', falhas: [{}, {}] }) : REDE) });
    await assentar();
    await clicarEm(na(SAUDE), 'Carregar o relatório');
    await assentar();
    expect(t.get.mock.calls.map(([caminho]) => caminho)).toEqual(['/api/diagnostics']);
    const relatorio = na(SAUDE).getByRole('region', { name: 'Relatório do motor' });
    expect(within(relatorio).getByRole('heading', { name: 'Diagnóstico do Farol' })).toBeTruthy();
    expect(relatorio.textContent).toContain('ok · Node: v24.22.1');
    expect(na(SAUDE).getByText('O motor tem 2 falhas registradas no relatório.')).toBeTruthy();
    expect(na(SAUDE).getByRole('button', { name: 'Carregar o relatório de novo' })).toBeTruthy();
  });
});

describe('Sistema: conta revisora e política', () => {
  const SALVAR = 'Salvar conta e política de @farol-bot';
  const CONFIRMAR = 'Salvar e ampliar a publicação automática: @farol-bot';
  const campo = (rotulo: string | RegExp) => na(CONTA_E_POLITICA).getByLabelText(rotulo) as HTMLSelectElement;

  it('mostra a conta, a presença do token e a política, com o efeito de cada valor', async () => {
    montar();
    await assentar();
    const s = na(CONTA_E_POLITICA);
    expect(s.getByText('@farol-bot')).toBeTruthy();
    expect(s.getByText('Presente: o motor tem token do gh para esta conta.')).toBeTruthy();
    expect(s.getByText(/Do token o motor informa a presença, não a validade/)).toBeTruthy();
    expect(within(s.getByRole('list', { name: 'Organizações monitoradas' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['biudtechTirar']);
    expect((s.getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(false);
    expect(campo(/revisão sai limpa/).value).toBe('wait');
    expect(campo(/revisão reprova/).value).toBe('wait');
    expect(s.getAllByText(/Espera você: o PR vai a "Precisa de você"/).length).toBeGreaterThan(0);
    expect(s.getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(s.queryByRole('button', { name: SALVAR })).toBeNull();
  });

  it('ligar a revisão automática pergunta antes, com o efeito; cancelar não envia nada', async () => {
    const t = montar();
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    const pergunta = na(CONTA_E_POLITICA).getByRole('group', { name: 'Ampliar o que o motor publica sozinho por @farol-bot?' });
    expect(pergunta.textContent).toContain('Revisão automática ligada: o motor passa a abrir sozinho a sessão de revisão de todo PR pedido a @farol-bot');
    expect(pergunta.textContent).toContain('sem clique');
    expect(t.envios()).toEqual([]);
    await clicarEm(na(CONTA_E_POLITICA), 'Voltar sem enviar');
    await assentar();
    expect(t.envios()).toEqual([]);
    // a edição continua no formulário
    expect((na(CONTA_E_POLITICA).getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
  });

  it('aceita a pergunta: o corpo de accounts/edit leva só o campo editado', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/accounts/edit' ? corpo({ ok: true, ignoradas: [], ignorados: [] }) : undefined) });
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { autoReview: true } }]]);
    expect(regiao().textContent).toContain('O motor aceitou a mudança em @farol-bot: revisão automática: ligada. A resposta dele não traz a conta gravada.');
    expect(document.activeElement).toBe(regiao());
  });

  it('trocar esperar por publicar pergunta, dizendo o que passa a ser publicado', async () => {
    const t = montar();
    await assentar();
    mudar(campo(/revisão sai limpa/), 'approve');
    mudar(campo(/revisão reprova/), 'request_changes');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    const pergunta = na(CONTA_E_POLITICA).getByRole('group', { name: /Ampliar o que o motor publica sozinho/ });
    expect(pergunta.textContent).toContain('publicar sozinho a aprovação (APPROVE) no GitHub, pela conta @farol-bot');
    expect(pergunta.textContent).toContain('publicar sozinho o pedido de mudanças (REQUEST_CHANGES)');
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'approve', onReject: 'request_changes' } }]]);
  });

  it('a mudança que reduz vai direto, sem pergunta, só com o que mudou', async () => {
    const t = montar({ bruto: { ...BRUTO, accounts: [ABERTA] } });
    await assentar();
    mudar(campo(/revisão reprova/), 'wait');
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(na(CONTA_E_POLITICA).queryByRole('group')).toBeNull();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { autoReview: false, onReject: 'wait' } }]]);
  });

  it('limpo em espera leva o com ressalvas junto: o campo trava, e o corpo não o manda', async () => {
    const t = montar({ bruto: { ...BRUTO, accounts: [ABERTA] } });
    await assentar();
    mudar(campo(/revisão sai limpa/), 'wait');
    expect(campo(/com ressalvas/).disabled).toBe(true);
    expect(campo(/com ressalvas/).value).toBe('wait');
    expect(na(CONTA_E_POLITICA).getByText(/o com ressalvas nunca é mais permissivo que o limpo/)).toBeTruthy();
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'wait' } }]]);
  });

  it('organização nova pergunta e vai como lista inteira; tirar organização não pergunta', async () => {
    const t = montar();
    await assentar();
    mudar(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'), 'acme');
    await clicarEm(na(CONTA_E_POLITICA), 'Adicionar à lista');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    expect(na(CONTA_E_POLITICA).getByRole('group').textContent).toContain('Organização acme: o motor passa a buscar os PRs pedidos a @farol-bot em acme');
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { owners: ['biudtech', 'acme'] } }]]);

    cleanup();
    const outra = montar();
    await assentar();
    await clicarEm(na(CONTA_E_POLITICA), 'Tirar biudtech das organizações monitoradas');
    expect(na(CONTA_E_POLITICA).getByText(/sem organização monitorada o motor não faz busca nenhuma/)).toBeTruthy();
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(outra.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { owners: [] } }]]);
  });

  it('nome de organização torto, ou repetido, não entra na lista', async () => {
    montar();
    await assentar();
    mudar(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'), 'a/b');
    await clicarEm(na(CONTA_E_POLITICA), 'Adicionar à lista');
    expect(na(CONTA_E_POLITICA).getByRole('alert').textContent).toContain('letras, dígitos e hífen');
    mudar(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'), 'BiudTech');
    await clicarEm(na(CONTA_E_POLITICA), 'Adicionar à lista');
    expect(na(CONTA_E_POLITICA).getByRole('alert').textContent).toContain('já está na lista');
    expect(na(CONTA_E_POLITICA).queryByRole('button', { name: SALVAR })).toBeNull();
  });

  it('campo que o motor ignorou e recusa do motor aparecem como erro', async () => {
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] }, aoPostar: (rota) => (rota === '/api/accounts/edit' ? corpo({ ok: true, ignoradas: [], ignorados: ['onReject'] }) : undefined) });
    await assentar();
    mudar(campo(/revisão reprova/), 'wait');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor aceitou o pedido de @farol-bot, mas ignorou revisão reprovada');

    cleanup();
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] }, aoPostar: (rota) => (rota === '/api/accounts/edit' ? corpo({ ok: false, erro: 'a conta @farol-bot não é a conta deste Farol' }) : undefined) });
    await assentar();
    mudar(campo(/revisão reprova/), 'wait');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor recusou: a conta @farol-bot não é a conta deste Farol');
  });

  it('sem conexão, ou sem o estado desta conexão, o salvar fica fechado e a tela diz por quê', async () => {
    const t = montar({ conexao: 'reconectando', estadoEmDia: false });
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    expect(na(CONTA_E_POLITICA).getByText(/^Bloqueado: Esta aba está sem conexão com o motor/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).queryByRole('button', { name: SALVAR })).toBeNull();
    act(() => { t.store.trocar({ conexao: 'conectado' }); });
    expect(na(CONTA_E_POLITICA).getByText(/^Bloqueado: A conexão com o motor acabou de abrir/)).toBeTruthy();
    act(() => { t.store.trocar({ estadoEmDia: true }); });
    expect(na(CONTA_E_POLITICA).getByRole('button', { name: SALVAR })).toBeTruthy();
  });

  it('política que muda no motor com a edição aberta vira aviso, e dá para descartar', async () => {
    const t = montar();
    await assentar();
    mudar(campo(/revisão reprova/), 'request_changes');
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, onClean: 'approve' }] });
    expect(na(CONTA_E_POLITICA).getByText(/a conta e a política mudou no motor enquanto você editava/)).toBeTruthy();
    await clicarEm(na(CONTA_E_POLITICA), 'Descartar a edição de a conta e a política');
    expect(campo(/revisão reprova/).value).toBe('wait');
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    expect(na(CONTA_E_POLITICA).getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('sem edição, o formulário acompanha o que o motor manda', async () => {
    const t = montar();
    await assentar();
    t.trocar({ ...BRUTO, accounts: [ABERTA] });
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    expect((na(CONTA_E_POLITICA).getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
    expect(na(CONTA_E_POLITICA).queryByText(/mudou no motor enquanto você editava/)).toBeNull();
  });

  it('motor sem conta revisora: só leitura, sem formulário', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ user: '', owners: [], tokenOk: false }] } });
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText('O motor ainda não tem conta revisora.')).toBeTruthy();
    expect(na(CONTA_E_POLITICA).queryByLabelText('Revisão automática')).toBeNull();
  });

  it('regra de review por organização é avisada, porque decide antes da revisão automática', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ ...CONTA, reviewRules: { acme: { mode: 'auto' } } }] } });
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText(/a conta tem regra de review própria para 1 organização/)).toBeTruthy();
  });
});

describe('Sistema: automação', () => {
  const SALVAR = 'Salvar automação';
  const campo = (rotulo: string | RegExp) => na(AUTOMACAO).getByLabelText(rotulo) as HTMLSelectElement;
  const gravou = (config: unknown) => (rota: string) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config }) : undefined);

  it('mostra as quatro chaves com o efeito de cada uma, e os modelos do catálogo do motor', async () => {
    montar();
    await assentar();
    expect((na(AUTOMACAO).getByLabelText('CI obrigatório antes de aprovar') as HTMLInputElement).checked).toBe(true);
    expect(na(AUTOMACAO).getByText(/a aprovação automática espera os checks obrigatórios/)).toBeTruthy();
    expect([...campo('Revisões ao mesmo tempo').options].map((o) => o.value)).toEqual(['1', '2', '3', '4']);
    expect([...campo('Modelo da revisão').options].map((o) => [o.value, o.textContent])).toEqual([['', 'Padrão do Claude'], ['auto', 'Auto (qualidade primeiro)'], ['opus', 'Opus'], ['sonnet', 'Sonnet']]);
    expect([...campo('Esforço da revisão').options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh']);
    expect(na(AUTOMACAO).getByText(/Vira a flag --model/)).toBeTruthy();
    expect(na(AUTOMACAO).getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('salvar manda só a chave editada, sem política nem perfis, e confere a resposta', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, parallelReviews: 3 }) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '3');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(na(AUTOMACAO).queryByRole('group')).toBeNull();
    expect(t.envios()).toEqual([['/api/settings', { parallelReviews: 3 }]]);
    expect(regiao().textContent).toContain('O motor gravou: revisões ao mesmo tempo: 3.');
    expect(document.activeElement).toBe(regiao());
  });

  it('modelo e esforço vão juntos quando os dois mudam, e só eles', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, reviewModel: 'sonnet', reviewEffort: 'high' }) });
    await assentar();
    mudar(campo('Modelo da revisão'), 'sonnet');
    mudar(campo('Esforço da revisão'), 'high');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { reviewModel: 'sonnet', reviewEffort: 'high' }]]);
  });

  it('desligar o CI antes de aprovar pergunta, com o efeito; cancelar não envia', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, aguardarCiParaAprovar: false }) });
    await assentar();
    act(() => { fireEvent.click(na(AUTOMACAO).getByLabelText('CI obrigatório antes de aprovar')); });
    expect(na(AUTOMACAO).getByText(/o motor pode aprovar com o CI vermelho ou ainda rodando/)).toBeTruthy();
    await clicarEm(na(AUTOMACAO), SALVAR);
    const pergunta = na(AUTOMACAO).getByRole('group', { name: 'Desligar o CI antes de aprovar?' });
    expect(pergunta.textContent).toContain('passa a poder publicar APPROVE com o CI vermelho ou ainda rodando');
    await clicarEm(na(AUTOMACAO), 'Voltar sem enviar');
    await assentar();
    expect(t.envios()).toEqual([]);

    await clicarEm(na(AUTOMACAO), SALVAR);
    await clicarEm(na(AUTOMACAO), 'Salvar e desligar a espera do CI: a automação');
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { aguardarCiParaAprovar: false }]]);
    expect(regiao().textContent).toContain('O motor gravou: CI antes de aprovar: desligado.');
  });

  it('ligar o CI antes de aprovar reduz a publicação: vai direto', async () => {
    const t = montar({ bruto: { ...BRUTO, config: { ...CONFIG, aguardarCiParaAprovar: false } }, aoPostar: gravou({ ...CONFIG, aguardarCiParaAprovar: true }) });
    await assentar();
    act(() => { fireEvent.click(na(AUTOMACAO).getByLabelText('CI obrigatório antes de aprovar')); });
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { aguardarCiParaAprovar: true }]]);
  });

  it('o motor gravou diferente do pedido: a tela diz o que ficou, como erro', async () => {
    montar({ aoPostar: gravou({ ...CONFIG, reviewModel: 'opus' }) });
    await assentar();
    mudar(campo('Modelo da revisão'), 'sonnet');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor gravou diferente do pedido: modelo ficou opus, e o pedido era sonnet.');
  });

  it('falha de rede não afirma que gravou', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/settings' ? REDE : undefined) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '2');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: Não deu para falar com o motor (falha de rede). Não dá para saber se o pedido chegou');
  });

  it('com o Auto, a tela avisa que o esforço não é usado; modelo fixado no arquivo aparece como opção', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, reviewModel: 'claude-opus-5-5', reviewEffort: 'high', globalParallelReviews: 3 } } });
    await assentar();
    expect(campo('Modelo da revisão').selectedOptions[0]?.textContent).toBe('claude-opus-5-5 (fixado no arquivo de configuração; não está no catálogo)');
    expect(na(AUTOMACAO).getByText(/teto total de 3 sessões ao mesmo tempo/)).toBeTruthy();
    mudar(campo('Modelo da revisão'), 'auto');
    expect(na(AUTOMACAO).getByText(/com o modelo escolhido o motor não usa este valor/)).toBeTruthy();
  });

  it('sem conexão o salvar fica fechado', async () => {
    montar({ conexao: 'sem-motor' });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '2');
    expect(na(AUTOMACAO).getByText(/^Bloqueado:/)).toBeTruthy();
    expect(na(AUTOMACAO).queryByRole('button', { name: SALVAR })).toBeNull();
  });
});

describe('Sistema: perfil do Claude e teto de gasto', () => {
  const SALVAR = 'Salvar teto de Assinatura';
  const CONFIRMAR = 'Salvar o teto: Assinatura';
  const perfil = (nome: string) => within(within(na(CLAUDE).getByRole('list', { name: 'Perfis do Claude' })).getByRole('heading', { level: 3, name: new RegExp(`^${nome}`) }).closest('li') as HTMLElement);
  const gravou = (claudeProfiles: unknown) => (rota: string) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config: { ...CONFIG, claudeProfiles } }) : undefined);

  it('mostra os perfis, a presença da credencial, o uso do plano e o teto, sem chave nem pasta', async () => {
    const t = montar();
    await assentar();
    expect(perfil('Assinatura').getByText('Perfil padrão')).toBeTruthy();
    expect(perfil('Assinatura').getByText(/Login presente na pasta do perfil/)).toBeTruthy();
    expect(perfil('Assinatura').getByText('40% usado, volta às 18h')).toBeTruthy();
    expect(perfil('Assinatura').getByText('Teto no motor agora: US$ 20,00 por dia.')).toBeTruthy();
    expect((perfil('Assinatura').getByLabelText('Teto do dia, em dólar') as HTMLInputElement).value).toBe('20');
    expect(perfil('Chave').getByText(/Chave presente\. O motor não informa se ela vale/)).toBeTruthy();
    expect(perfil('Chave').getByText(/teto do dia próprio para sábado \(US\$ 5,00\)/)).toBeTruthy();
    expect(perfil('Chave').getByText('Teto no motor agora: sem teto.')).toBeTruthy();
    expect(na(CLAUDE).getByText(/Baixar ou zerar um teto pode pausar as revisões automáticas na hora/)).toBeTruthy();
    expect(na(CLAUDE).getByText(/ela não tem campo para segredo/)).toBeTruthy();
    expect(t.container.innerHTML).not.toContain('apiKey');
  });

  it('Testar perfil diz antes o que o teste faz e que não consome, e manda só o id do perfil', async () => {
    const t = montar({
      aoPostar: (rota) => (rota === '/api/claude/profile-test'
        ? corpo({ ok: true, escreveu: false, perfil: { id: 'plano', label: 'Assinatura', kind: 'dir', aviso: '', campos: { login: { valor: true, origem: 'validado' }, email: { valor: 'bot@biud.com.br', origem: 'validado' }, tipoAuth: { valor: 'claude.ai', origem: 'validado' }, plano: { valor: null, origem: 'desconhecido', motivo: 'o nome comercial do plano não é detectável' } } } })
        : undefined),
    });
    await assentar();
    expect(perfil('Assinatura').getByText(/Não chama modelo, não consome o plano e não grava nada/)).toBeTruthy();
    expect(perfil('Chave').getByText(/Não chama a Anthropic: não consome nada, e por isso não prova que a chave vale/)).toBeTruthy();
    await clicarEm(perfil('Assinatura'), 'Testar o perfil Assinatura');
    await assentar();
    expect(t.envios()).toEqual([['/api/claude/profile-test', { profileId: 'plano' }]]);
    const resultado = perfil('Assinatura').getByRole('status', { name: 'Resultado do teste do perfil Assinatura' });
    expect(resultado.textContent).toContain('O motor testou o perfil e não gravou nada.');
    expect(resultado.textContent).toContain('Loginsim (validado pelo Claude Code)');
    expect(resultado.textContent).toContain('Planonão informado (desconhecido: o nome comercial do plano não é detectável)');
  });

  it('teste que o motor recusa, ou que não chega, aparece como erro', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/claude/profile-test' ? corpo({ ok: false, code: 'perfil-invalido', motivo: 'esse perfil está incompleto: falta a chave, ou a pasta fica fora do HOME do Farol' }) : undefined) });
    await assentar();
    await clicarEm(perfil('Chave'), 'Testar o perfil Chave');
    await assentar();
    expect(perfil('Chave').getByRole('status', { name: 'Resultado do teste do perfil Chave' }).textContent).toBe('Erro: o motor não testou o perfil: esse perfil está incompleto: falta a chave, ou a pasta fica fora do HOME do Farol.');
  });

  it('baixar o teto pergunta sempre, com o antes, o depois e a pausa; cancelar não envia', async () => {
    const t = montar();
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    await clicarEm(perfil('Assinatura'), SALVAR);
    const pergunta = perfil('Assinatura').getByRole('group', { name: 'Mudar o teto de gasto de Assinatura?' });
    expect(pergunta.textContent).toContain('passa de US$ 20,00 por dia para US$ 5,00 por dia');
    expect(pergunta.textContent).toContain('as revisões automáticas deste perfil pausam');
    await clicarEm(perfil('Assinatura'), 'Voltar sem enviar');
    await assentar();
    expect(t.envios()).toEqual([]);
  });

  it('aceita a pergunta: o corpo é só claudeProfiles, a lista crua com o teto deste perfil trocado', async () => {
    const t = montar({ aoPostar: gravou([{ ...PLANO, budgetDaily: 5 }, API]) });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    await clicarEm(perfil('Assinatura'), SALVAR);
    await clicarEm(perfil('Assinatura'), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { claudeProfiles: [{ id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 5 }, API] }]]);
    // nenhum segredo, nenhuma outra chave de config
    expect(JSON.stringify(t.envios())).not.toMatch(/apiKey|aguardarCi|reviewModel|people/);
    expect(regiao().textContent).toContain('O motor gravou o teto de Assinatura: US$ 5,00 por dia.');
  });

  it('teto total com data de corte, no perfil de chave: os tetos por dia da semana voltam como vieram', async () => {
    const t = montar({ aoPostar: gravou([PLANO, { ...API, budgetTotal: 100, budgetSince: '2026-11-01' }]) });
    await assentar();
    mudar(perfil('Chave').getByLabelText('Teto total, em dólar'), '100');
    mudar(perfil('Chave').getByLabelText(/Data de corte do teto total/), '2026-11-01');
    await clicarEm(perfil('Chave'), 'Salvar teto de Chave');
    await clicarEm(perfil('Chave'), 'Salvar o teto: Chave');
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { claudeProfiles: [PLANO, { ...API, budgetTotal: 100, budgetSince: '2026-11-01' }] }]]);
  });

  it('zerar o teto avisa que as revisões automáticas param já; tirar o teto tira o campo', async () => {
    const t = montar({ aoPostar: gravou([{ id: 'plano', label: 'Assinatura', kind: 'dir', dir: '' }, API]) });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '0');
    await clicarEm(perfil('Assinatura'), SALVAR);
    expect(perfil('Assinatura').getByRole('group', { name: 'Mudar o teto de gasto de Assinatura?' }).textContent).toContain('as revisões automáticas deste perfil param já');
    await clicarEm(perfil('Assinatura'), 'Voltar sem enviar');
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '');
    await clicarEm(perfil('Assinatura'), SALVAR);
    expect(perfil('Assinatura').getByRole('group', { name: 'Mudar o teto de gasto de Assinatura?' }).textContent).toContain('o que estava pausado por ele volta a rodar');
    await clicarEm(perfil('Assinatura'), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { claudeProfiles: [{ id: 'plano', label: 'Assinatura', kind: 'dir', dir: '' }, API] }]]);
    expect(regiao().textContent).toContain('O motor gravou o teto de Assinatura: sem teto.');
  });

  it('valor que o motor descartaria é erro no campo, e não há salvar', async () => {
    montar();
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '-3');
    expect(perfil('Assinatura').getByText(/^Erro: Use um valor em dólar de zero para cima/)).toBeTruthy();
    expect((perfil('Assinatura').getByLabelText('Teto do dia, em dólar') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
    expect(perfil('Assinatura').queryByRole('button', { name: SALVAR })).toBeNull();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '20');
    mudar(perfil('Assinatura').getByLabelText(/Data de corte do teto total/), '2026-02-30');
    expect(perfil('Assinatura').getByText(/^Erro: Use um dia que existe/)).toBeTruthy();
    expect(perfil('Assinatura').queryByRole('button', { name: SALVAR })).toBeNull();
  });

  it('o motor gravou diferente, ou mexeu em outro perfil: a tela diz, como erro', async () => {
    montar({ aoPostar: gravou([{ ...PLANO, budgetDaily: 5 }]) });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    await clicarEm(perfil('Assinatura'), SALVAR);
    await clicarEm(perfil('Assinatura'), CONFIRMAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor gravou o teto de Assinatura: US$ 5,00 por dia. Atenção: outro perfil ficou diferente do que esta tela enviou, mudou ou saiu da lista (api).');
  });

  it('a recusa do endereço diz que nada foi gravado e que a tela não digita chave', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/settings' ? corpo({ ok: false, code: 'chave_exigida', perfis: ['api'], erro: 'Para mudar o endereço deste perfil, digite a chave de novo.' }) : undefined) });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    await clicarEm(perfil('Assinatura'), SALVAR);
    await clicarEm(perfil('Assinatura'), CONFIRMAR);
    await assentar();
    expect(regiao().textContent).toContain('Esta tela não digita chave: nada foi gravado.');
  });

  it('sem o estado desta conexão o salvar do teto fica fechado', async () => {
    montar({ estadoEmDia: false });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    expect(perfil('Assinatura').getByText(/^Bloqueado: A conexão com o motor acabou de abrir/)).toBeTruthy();
    expect(perfil('Assinatura').queryByRole('button', { name: SALVAR })).toBeNull();
  });

  it('com segredo descartado dos perfis, o teto não se salva: a lista guardada não é mais a do motor', async () => {
    const t = montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [PLANO, { ...API, apiKey: CHAVE_DA_ANTHROPIC }] } } });
    await assentar();
    mudar(perfil('Assinatura').getByLabelText('Teto do dia, em dólar'), '5');
    expect(perfil('Assinatura').getByText(/^Bloqueado: O motor mandou campo com cara de segredo junto dos perfis/)).toBeTruthy();
    expect(perfil('Assinatura').queryByRole('button', { name: SALVAR })).toBeNull();
    expect(t.envios()).toEqual([]);
  });

  it('sem perfil, a seção diz o que isso significa', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [] } } });
    await assentar();
    expect(na(CLAUDE).getByText(/O motor não tem perfil do Claude/)).toBeTruthy();
  });
});

describe('Sistema: Jira', () => {
  it('mostra os sites e a presença da credencial, só para leitura', async () => {
    montar();
    await assentar();
    const s = na(JIRA);
    expect(s.getByRole('heading', { level: 3, name: 'BIUD' })).toBeTruthy();
    expect(s.getByText('https://biud.atlassian.net')).toBeTruthy();
    expect(s.getByText('Presente. Se ela vale, quem diz é o teste abaixo.')).toBeTruthy();
    expect(s.getByText(/Esta seção é só leitura/)).toBeTruthy();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.queryByRole('button', { name: /^Salvar/ })).toBeNull();
  });

  it('Testar a conexão manda só o id do site e mostra de quem é a credencial', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/jira/test' ? corpo({ ok: true, site: { id: 'biud' }, quem: 'Farol Bot' }) : undefined) });
    await assentar();
    await clicarEm(na(JIRA), 'Testar a conexão com BIUD');
    await assentar();
    expect(t.envios()).toEqual([['/api/jira/test', { siteId: 'biud' }]]);
    expect(na(JIRA).getByRole('status', { name: 'Resultado do teste de BIUD' }).textContent).toBe('A conexão funciona: a credencial guardada no motor representa Farol Bot.');
  });

  it('teste que falha mostra a frase e o código do motor; falha de rede é dita como tal', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/jira/test' ? corpo({ ok: false, code: 'sem_permissao', site: null, motivo: 'a credencial não tem permissão para ler este card' }) : undefined) });
    await assentar();
    await clicarEm(na(JIRA), 'Testar a conexão com BIUD');
    await assentar();
    expect(na(JIRA).getByRole('status', { name: 'Resultado do teste de BIUD' }).textContent).toBe('Erro: o teste falhou: a credencial não tem permissão para ler este card (sem_permissao).');

    cleanup();
    montar({ aoPostar: (rota) => (rota === '/api/jira/test' ? REDE : undefined) });
    await assentar();
    await clicarEm(na(JIRA), 'Testar a conexão com BIUD');
    await assentar();
    expect(na(JIRA).getByRole('status', { name: 'Resultado do teste de BIUD' }).textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).');
  });

  it('sem site, a seção diz que o recurso está desligado', async () => {
    montar({ bruto: { ...BRUTO, jiraSites: [] } });
    await assentar();
    expect(na(JIRA).getByText(/O motor não tem site do Jira: o recurso está desligado/)).toBeTruthy();
  });
});

describe('Sistema: sessões pareadas', () => {
  const itens = () => within(na(SESSOES_PAREADAS).getByRole('list', { name: 'Sessões pareadas' })).getAllByRole('listitem');
  const cargas = (t: ReturnType<typeof montar>) => t.post.mock.calls.filter(([rota]) => rota === '/api/auth/sessions');

  it('pede a lista em POST /api/auth/sessions e mostra cada sessão, com a atual marcada', async () => {
    const t = montar();
    expect(na(SESSOES_PAREADAS).getByRole('status', { name: 'Resultado da lista de sessões' }).textContent).toBe('Carregando as sessões pareadas.');
    await assentar();
    expect(cargas(t).map(([rota, enviado]) => [rota, enviado])).toEqual([['/api/auth/sessions', {}]]);
    expect(na(SESSOES_PAREADAS).getByRole('status', { name: 'Resultado da lista de sessões' }).textContent).toBe('2 sessões pareadas');
    const [atual, outra] = itens();
    expect(within(atual as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Sessão "Notebook"Este navegador');
    expect(atual?.textContent).toContain(`Criada em${dataComAno(ATUAL.criadoEm)}`);
    expect(atual?.textContent).toContain(`Usada pela última vez em${dataComAno(ATUAL.ultimoUsoEm)}`);
    expect(within(outra as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Sessão "Celular"');
    expect(within(outra as HTMLElement).queryByText('Este navegador')).toBeNull();
  });

  it('revogar outra sessão pergunta antes; cancelar não envia', async () => {
    const t = montar();
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Celular"');
    const pergunta = na(SESSOES_PAREADAS).getByRole('group', { name: 'Revogar a sessão "Celular"?' });
    expect(pergunta.textContent).toContain('Este navegador continua pareado');
    await clicarEm(na(SESSOES_PAREADAS), 'Voltar sem enviar');
    await assentar();
    expect(t.envios()).toEqual([]);
    expect(t.esquecerSessao).not.toHaveBeenCalled();
  });

  it('aceita: revoga pelo id, pede a lista de novo, e este navegador continua onde está', async () => {
    let revogada = false;
    const t = montar({
      aoPostar: (rota) => {
        if (rota === '/api/auth/revoke') { revogada = true; return corpo({ ok: true, eraAtual: false }); }
        return rota === '/api/auth/sessions' && revogada ? corpo({ ok: true, sessoes: [ATUAL] }) : undefined;
      },
    });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Celular"');
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão: "Celular"');
    await assentar();
    expect(t.envios()).toEqual([['/api/auth/revoke', { id: OUTRA.id }]]);
    expect(regiao().textContent).toContain('O motor revogou a sessão "Celular": o token dela não vale mais.');
    expect(cargas(t)).toHaveLength(2);
    expect(itens()).toHaveLength(1);
    expect(t.esquecerSessao).not.toHaveBeenCalled();
  });

  it('revogar a sessão atual avisa que este navegador volta ao pareamento, e depois do aceite a tela vai de fato', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? corpo({ ok: true, eraAtual: true }) : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Notebook" (este navegador)');
    const pergunta = na(SESSOES_PAREADAS).getByRole('group', { name: 'Revogar a sessão deste navegador?' });
    expect(pergunta.textContent).toContain('esta tela volta ao pareamento assim que o motor aceitar');
    expect(t.esquecerSessao).not.toHaveBeenCalled();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(t.envios()).toEqual([['/api/auth/revoke', { id: ATUAL.id }]]);
    expect(t.esquecerSessao).toHaveBeenCalledTimes(1);
    expect(t.esquecerSessao).toHaveBeenCalledWith('revogada');
  });

  it('revogação da atual cancelada, recusada ou sem resposta não leva ao pareamento', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? corpo({ ok: false, code: 'sessao_inexistente' }) : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Notebook" (este navegador)');
    await clicarEm(na(SESSOES_PAREADAS), 'Voltar sem enviar');
    expect(t.envios()).toEqual([]);
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Notebook" (este navegador)');
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor não tem mais essa sessão: ela já foi revogada ou expirou. Atualize a lista.');
    expect(t.esquecerSessao).not.toHaveBeenCalled();

    cleanup();
    const semRede = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? REDE : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Notebook" (este navegador)');
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(semRede.esquecerSessao).not.toHaveBeenCalled();
  });

  it('falha ao carregar a lista é dita, e Atualizar a lista pede de novo', async () => {
    let falhar = true;
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/sessions' && falhar ? REDE : undefined) });
    await assentar();
    expect(na(SESSOES_PAREADAS).getByRole('alert').textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).');
    expect(na(SESSOES_PAREADAS).queryByRole('list', { name: 'Sessões pareadas' })).toBeNull();
    falhar = false;
    await clicarEm(na(SESSOES_PAREADAS), 'Atualizar a lista');
    await assentar();
    expect(cargas(t)).toHaveLength(2);
    expect(itens()).toHaveLength(2);
    expect(na(SESSOES_PAREADAS).queryByRole('alert')).toBeNull();
  });

  it('lista vazia e lista sem a sessão atual são ditas', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/auth/sessions' ? corpo({ ok: true, sessoes: [] }) : undefined) });
    await assentar();
    expect(na(SESSOES_PAREADAS).getByText(/O motor não listou sessão pareada/)).toBeTruthy();
    cleanup();
    montar({ aoPostar: (rota) => (rota === '/api/auth/sessions' ? corpo({ ok: true, sessoes: [OUTRA] }) : undefined) });
    await assentar();
    expect(na(SESSOES_PAREADAS).getByText(/o motor não marcou nenhuma sessão como a deste navegador/)).toBeTruthy();
  });
});

describe('Sistema: rede e acesso', () => {
  it('bind, nome público e origens permitidas aparecem só para leitura, com a nota de que mudam por arquivo', async () => {
    montar();
    await assentar();
    const s = na(REDE_E_ACESSO);
    expect(s.getByText('127.0.0.1')).toBeTruthy();
    expect(s.getByText('farol.exemplo.com')).toBeTruthy();
    expect(s.getByText('https://painel.exemplo.com')).toBeTruthy();
    expect(s.getByText('47170')).toBeTruthy();
    expect(s.getByText(/mudam apenas pelo arquivo de configuração do motor \(config\.json\), com reinício/)).toBeTruthy();
    expect(s.getByText(/tirar a própria origem daqui a trancaria para fora/)).toBeTruthy();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.queryByRole('button')).toBeNull();
  });
});

describe('Sistema: edição por salvar', () => {
  it('a tela avisa no topo o que está por salvar, e segura o fechar da página enquanto houver', async () => {
    const adicionados = vi.spyOn(window, 'addEventListener');
    const removidos = vi.spyOn(window, 'removeEventListener');
    montar();
    await assentar();
    const ouvindo = () => adicionados.mock.calls.filter(([tipo]) => tipo === 'beforeunload').length - removidos.mock.calls.filter(([tipo]) => tipo === 'beforeunload').length;
    expect(ouvindo()).toBe(0);
    mudar(na(AUTOMACAO).getByLabelText('Revisões ao mesmo tempo'), '2');
    expect(screen.getByText('Aviso: há edição por salvar nesta tela (automação). Trocar de aba do Farol a descarta sem perguntar.')).toBeTruthy();
    expect(ouvindo()).toBe(1);
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    await clicarEm(na(AUTOMACAO), 'Descartar a edição de a automação');
    expect(screen.queryByText(/há edição por salvar nesta tela/)).toBeNull();
    expect(ouvindo()).toBe(0);
    expect((na(AUTOMACAO).getByLabelText('Revisões ao mesmo tempo') as HTMLSelectElement).value).toBe('1');
  });
});
