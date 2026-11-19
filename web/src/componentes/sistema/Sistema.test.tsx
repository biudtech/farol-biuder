// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import { dataComAno } from '@/radar/formato';
import { ASSUNTOS, type IdDoAssunto } from '@/sistema/assuntos';
import type { Resultado } from '@/transporte/cliente';
import { aplicarEstadoInteiro } from '@/transporte/estado';
import { Sistema } from './Sistema';
import { SistemaNaRota } from './SistemaNaRota';

const caminhoDaRota = vi.hoisted(() => ({ atual: '/sistema' }));
vi.mock('next/navigation', () => ({ usePathname: () => caminhoDaRota.atual }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

type Falha = Extract<Resultado<never>, { ok: false }>;
// O que o motor de mentira devolve: o corpo cru (que passa pelo leitor da borda, como no
// cliente de verdade) ou uma falha do transporte.
type Resposta = { corpo: unknown } | Falha;

const corpo = (valor: unknown): Resposta => ({ corpo: valor });
const REDE: Falha = { ok: false, falha: 'rede', status: 0 };

// Valores com cara de segredo, montados em pedaços para o arquivo não parecer ter um.
const CHAVE_DA_ANTHROPIC = ['sk', 'ant', 'api03', 'CCCCCCCCCCCCCCCCCCCC'].join('-');
const TOKEN_DO_GITHUB = `ghp_${'z9Y8x7W6'.repeat(4)}`;
const TOKEN_DO_JIRA = ['ATATT', 'xFfGF0', 'k9J8h7G6f5D4s3A2'].join('3');
const CODIGO_DO_LOGIN = ['codigo', 'de', 'uso', 'unico'].join('Q') + '#estadoQ123';

// Os perfis como configParaFora (lib/engine/chave-do-perfil.js) os manda: o de chave sem
// `apiKey` e com `temChave`.
const PLANO = { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '/home/farol/.farol/claude/plano' };
const API = { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true };

const CONTA = { user: 'farol-bot', owners: ['biudtech'], tokenOk: true, limiteGhAte: 0, limitePlanoAte: 0, autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };
const ABERTA = { ...CONTA, autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };

const CONFIG = {
  intervalSeconds: 300,
  reReviewResume: true,
  autoPushback: true,
  reviewFast: false,
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
    avaliacaoTecnica: { ferramenta: 'integra', versao: '0.17.0', commit: 'ed3e1535cb84faf572fe66c6dc13a1af441588ee', cadastro: 'legivel', repositorios: 1, pronta: true, detalhe: 'ferramenta instalada e íntegra (eng-behaviour 0.17.0, commit ed3e1535cb84); 1 repositório declarado' },
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
  claudePerfis: { problemas: [], uso: { plano: { lido: true, ok: true, erro: '', em: 1, venceEm: 1766000000000, faixaDoLogin: '', desatualizado: false, lidaEm: 1, janelas: [{ id: 's', nome: 'Sessão', usado: 0.4, reset: 5, resetTexto: 'às 18h' }] } } },
  accounts: [CONTA],
  config: CONFIG,
  jiraSites: [{ id: 'biud', label: 'BIUD', baseUrl: 'https://biud.atlassian.net', owners: ['biudtech'], projectKeys: ['BT'], hasCredential: true }],
  decisions: {
    pending: [],
    resolved: [
      { id: 'd1', key: 'biudtech/app#1', card: 'BT-10', resolvedAt: 1763200000000 },
      { id: 'd2', key: 'biudtech/app#2', card: 'BT-11', resolvedAt: 1763300000000 },
      { id: 'd3', key: 'outra/app#3', card: 'BT-12', resolvedAt: 1763400000000 },
    ],
  },
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
  caminho?: string;
  responder?: (caminho: string) => Resposta | Promise<Resposta>;
  // o corpo cru que cada POST devolve; sem resposta própria, a lista de sessões e `{ ok: true }`
  aoPostar?: (rota: string, enviado: unknown) => Resposta | Promise<Resposta> | undefined;
}

// A montagem em uso: `irPara` troca o assunto aberto como a rota faria, sem desmontar a tela.
let emUso: { irPara(caminho: string): void; caminho: string } | null = null;

function montar({ bruto = BRUTO, semEstado = false, conexao = 'conectado', estadoEmDia = true, caminho = '/sistema', responder = () => REDE, aoPostar = () => undefined }: Montagem = {}) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao, estadoEmDia, snapshot: semEstado ? null : snapshotDe(bruto) });
  const ler = (r: Resposta, leitor: (bruto: unknown) => unknown) => {
    if (!('corpo' in r)) return r;
    const dados = leitor(r.corpo);
    return dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados };
  };
  const get = vi.fn(async (caminhoDoGet: string, leitor: (bruto: unknown) => unknown) => ler(await responder(caminhoDoGet), leitor));
  const post = vi.fn(async (rota: string, enviado: unknown, leitor: (bruto: unknown) => unknown) => {
    const propria = await aoPostar(rota, enviado);
    return ler(propria ?? corpo(rota === '/api/auth/sessions' ? SESSOES : { ok: true }), leitor);
  });
  const esquecerSessao = vi.fn();
  const app = { store, cliente: { get, post }, dispensarRecados: () => store.trocar({ recados: [] }), esquecerSessao } as unknown as App;
  const tela = render(<Sistema app={app} caminho={caminho} />);
  emUso = {
    caminho,
    irPara(novo: string) {
      if (!emUso || emUso.caminho === novo) return;
      emUso.caminho = novo;
      act(() => { tela.rerender(<Sistema app={app} caminho={novo} />); });
    },
  };
  // os POSTs que não são a carga da lista de sessões
  const envios = (): Array<[string, unknown]> => post.mock.calls.filter(([rota]) => rota !== '/api/auth/sessions').map(([rota, enviado]) => [rota, enviado]);
  const trocar = (novo: unknown) => act(() => { store.trocar({ snapshot: snapshotDe(novo) }); });
  return { store, get, post, esquecerSessao, envios, trocar, ...tela };
}

// deixa as promessas pendentes (a resposta do motor de mentira) assentarem
const assentar = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); };

// Cada assunto é uma região com o nome do título; dentro de alguns, um bloco também é região.
// Só o assunto aberto aparece: `secao` abre o assunto da região pedida, como o clique no menu.
const SAUDE = 'Saúde do motor';
const CONTA_E_POLITICA = 'Conta revisora';
const REGRAS = 'Regras por organização e autor';
const PADROES = 'Padrões do time';
const CLAUDE = 'Claude';
const AUTOMACAO = 'Modelo e sessões';
const JIRA = 'Jira';
const RITMO = 'Ritmo da revisão';
const SESSOES_PAREADAS = 'Quem está conectado';
const REDE_E_ACESSO = 'Rede e acesso';
const ASSUNTO_DA_SECAO: Record<string, IdDoAssunto> = {
  [SAUDE]: 'saude', [CONTA_E_POLITICA]: 'conta', [REGRAS]: 'regras', [PADROES]: 'padroes', [CLAUDE]: 'claude', [AUTOMACAO]: 'claude',
  [JIRA]: 'jira', [RITMO]: 'ritmo', [SESSOES_PAREADAS]: 'acesso', [REDE_E_ACESSO]: 'acesso',
};
const secao = (nome: string) => {
  const assunto = ASSUNTO_DA_SECAO[nome];
  if (assunto) emUso?.irPara(`/sistema/${assunto}`);
  return screen.getByRole('region', { name: nome });
};
const na = (nome: string) => within(secao(nome));
const clicarEm = async (onde: ReturnType<typeof within>, nome: string | RegExp) => { await act(async () => { fireEvent.click(onde.getByRole('button', { name: nome })); }); };
const mudar = (campo: HTMLElement, valor: string) => { act(() => { fireEvent.change(campo, { target: { value: valor } }); }); };
const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
const menu = () => screen.getByRole('navigation', { name: 'Assuntos do Sistema' });
const itensDoMenu = () => within(menu()).getAllByRole('link');
// o item do menu do assunto onde mora a seção
const resumoDe = (nome: string) => itensDoMenu().find((a) => a.getAttribute('href') === `/sistema/${ASSUNTO_DA_SECAO[nome]}`) as HTMLElement;

afterEach(() => {
  cleanup();
  emUso = null;
  caminhoDaRota.atual = '/sistema';
  vi.restoreAllMocks();
});

// Uma resposta que só chega quando o teste mandar: para ver o "Salvando…", o "Revogando…" e o
// "Conferindo" enquanto o pedido está no ar.
function adiada() {
  let soltar: (r: Resposta) => void = () => {};
  const promessa = new Promise<Resposta>((resolver) => { soltar = resolver; });
  return { promessa, soltar: async (r: Resposta) => { await act(async () => { soltar(r); }); await assentar(); } };
}

describe('Sistema: o menu e a rota', () => {
  it('tem o título, sem faixa de saúde no topo, e o menu dos assuntos com bolinha e resumo', async () => {
    montar();
    await assentar();
    expect(screen.getByRole('heading', { level: 1, name: 'Sistema' })).toBeTruthy();
    expect(screen.queryByText(/pontos? pedem? atenção|Nenhum ponto pede atenção/)).toBeNull();
    expect(itensDoMenu().map((a) => a.getAttribute('href'))).toEqual(ASSUNTOS.map((a) => `/sistema/${a.id}`));
    expect(itensDoMenu().map((a) => a.textContent)).toEqual([
      'OK:Conta revisora@farol-bot, revisão automática desligada',
      'Sem dado ou desligado:Regras por organização e autorNenhuma exceção',
      'Sem dado ou desligado:Padrões do timeNenhum padrão',
      'OK:ClaudeAssinatura, pronto',
      'OK:Jirabiud.atlassian.net',
      'OK:Ritmo da revisãoChecagem a cada 5 minutos',
      'OK:Quem está conectado2 ativas',
      'OK:Saúde do motor12 verificações OK',
    ]);
  });

  it('/sistema abre o primeiro assunto; o caminho do assunto abre ele, marcado no menu', async () => {
    montar();
    await assentar();
    expect(screen.getAllByRole('region').filter((r) => r.querySelector('h2')).map((r) => r.querySelector('h2')?.textContent)).toEqual([CONTA_E_POLITICA]);
    expect(itensDoMenu().filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href'))).toEqual(['/sistema/conta']);
    cleanup();
    montar({ caminho: '/sistema/jira' });
    await assentar();
    expect(screen.getByRole('heading', { level: 2, name: JIRA })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: CONTA_E_POLITICA })).toBeNull();
    expect(itensDoMenu().filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href'))).toEqual(['/sistema/jira']);
  });

  it('trocar de assunto leva o foco ao título dele e não perde o que foi digitado em outro', async () => {
    montar();
    await assentar();
    mudar(na(PADROES).getByLabelText('Texto dos padrões, um por linha'), 'Teste em todo endpoint.');
    secao(RITMO);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: RITMO }));
    expect((na(PADROES).getByLabelText('Texto dos padrões, um por linha') as HTMLTextAreaElement).value).toBe('Teste em todo endpoint.');
    expect(resumoDe(PADROES).textContent).toContain('alteração por salvar');
    expect(screen.getByText(/^Aviso: há edição por salvar nesta tela \(padrões do time\)\. Trocar de assunto não a perde/)).toBeTruthy();
  });

  it('no celular o endereço sem assunto é a lista; com assunto, o Voltar aos assuntos leva à lista', async () => {
    const t = montar();
    await assentar();
    const raiz = t.container.querySelector('nav')?.parentElement as HTMLElement;
    expect(raiz.className).toMatch(/semAssunto/);
    secao(JIRA);
    expect(raiz.className).toMatch(/comAssunto/);
    expect(screen.getByRole('link', { name: 'Voltar aos assuntos' }).getAttribute('href')).toBe('/sistema');
  });

  it('presa à rota: o caminho do navegador escolhe o assunto, e assunto que não existe mostra a página da rota (o 404)', async () => {
    const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', conexao: 'conectado', estadoEmDia: true, snapshot: snapshotDe(BRUTO) });
    const post = vi.fn(async () => ({ ok: true, dados: { sessoes: [], descartadas: 0 } }));
    const app = { store, cliente: { get: vi.fn(), post }, dispensarRecados: vi.fn(), esquecerSessao: vi.fn() } as unknown as App;
    caminhoDaRota.atual = '/sistema/ritmo';
    const { container, rerender } = render(<SistemaNaRota app={app}><p>página da rota</p></SistemaNaRota>);
    expect(container.textContent).not.toContain('página da rota');
    expect(screen.getByRole('heading', { level: 2, name: RITMO })).toBeTruthy();
    caminhoDaRota.atual = '/sistema/nada';
    rerender(<SistemaNaRota app={app}><p>página da rota</p></SistemaNaRota>);
    expect(container.textContent).toBe('página da rota');
    await assentar();
  });

  it('não guarda segredo: o que vem no estado com cara de segredo não aparece, e o assunto dos perfis avisa que descartou', async () => {
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
    // os perfis continuam na tela: o segredo sai, o perfil fica
    expect(within(na(CLAUDE).getByRole('list', { name: 'Perfis do Claude, na ordem de uso' })).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    // o caminho de pasta do diagnóstico também não é mostrado
    expect(t.container.innerHTML).not.toContain('/home/farol');
  });

  it('campo mascarado só para os dois segredos digitados: o token do Jira e o código do login', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/claude/login-web/start' ? corpo({ ok: true, loginId: 'l1', url: 'https://claude.com/cai/oauth/authorize?code=true' }) : undefined) });
    await assentar();
    expect(t.container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    await clicarEm(na(JIRA), 'Trocar a credencial do Jira de BIUD');
    await clicarEm(na(CLAUDE), /^Assinatura/);
    await clicarEm(na(CLAUDE), 'Refazer o login do perfil Assinatura');
    await assentar();
    const mascarados = [...t.container.querySelectorAll('input[type="password"]')].map((campo) => ((campo as HTMLInputElement).labels?.[0]?.textContent ?? ''));
    expect(mascarados.sort()).toEqual(['Código da página de login', 'Token de API do Atlassian']);
    // nenhum outro rótulo pede segredo
    const rotulos = [...t.container.querySelectorAll('label')].map((l) => l.textContent ?? '').filter((r) => !mascarados.includes(r));
    for (const rotulo of rotulos) expect(rotulo).not.toMatch(/token|chave de api|senha|credencial|api key|código/i);
  });

  it('sem o estado do motor a página mostra o esqueleto e diz que está esperando, sem salvar nenhum', async () => {
    montar({ semEstado: true });
    await assentar();
    expect(screen.getByText('Esperando o estado do motor')).toBeTruthy();
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Esperando o estado do motor: os assuntos aparecem preenchidos quando ele chegar.');
    expect(screen.queryByRole('navigation', { name: 'Assuntos do Sistema' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Salvar/ })).toBeNull();
  });

  it('cada assunto diz o que falta quando o motor não mandou a parte dele', async () => {
    montar({ bruto: { app: BRUTO.app } });
    await assentar();
    expect(na(SAUDE).getByText(/^Atenção: o motor não mandou o diagnóstico/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByText(/o motor não mandou a conta revisora/)).toBeTruthy();
    expect(na(REGRAS).getByText(/o motor não mandou a conta revisora/)).toBeTruthy();
    expect(na(PADROES).getByText(/o motor não mandou a conta revisora/)).toBeTruthy();
    expect(na(AUTOMACAO).getByText(/o motor não mandou as chaves de automação/)).toBeTruthy();
    expect(na(CLAUDE).getByText(/o motor não mandou a lista de perfis/)).toBeTruthy();
    expect(na(JIRA).getByText(/o motor não mandou a lista de sites/)).toBeTruthy();
    expect(na(RITMO).getByText(/o motor não mandou as chaves do ritmo/)).toBeTruthy();
    expect(resumoDe(RITMO).textContent).toBe('Sem dado ou desligado:Ritmo da revisãoo motor não mandou as chaves');
  });

  it('a bolinha do menu diz o estado de cada assunto', async () => {
    montar({ bruto: { ...BRUTO, doctor: { ...BRUTO.doctor, ghAuth: false }, accounts: [{ ...CONTA, owners: [] }], jiraSites: [] } });
    await assentar();
    expect(resumoDe(SAUDE).querySelector('[data-tom]')?.getAttribute('data-tom')).toBe('ruim');
    expect(resumoDe(SAUDE).textContent).toBe('Problema:Saúde do motorAutenticação do GitHub e mais 1');
    expect(resumoDe(CONTA_E_POLITICA).textContent).toBe('Atenção:Conta revisora@farol-bot, sem organização monitorada');
    expect(resumoDe(JIRA).textContent).toBe('Sem dado ou desligado:Jiradesligado');
  });
});

describe('Sistema: saúde', () => {
  const itens = () => within(na(SAUDE).getByRole('list', { name: 'Verificações do diagnóstico' })).getAllByRole('listitem');
  const textos = () => itens().map((li) => li.textContent);

  it('mostra cada verificação com o estado num chip em texto, e a versão do motor', async () => {
    montar();
    await assentar();
    expect(textos()).toEqual([
      'Node: v24.22.1OK',
      'GitHub CLI: gh version 2.80.0OK',
      'Autenticação do GitHub: autenticadoOK',
      'Claude Code: 2.1.300 (Claude Code)OK',
      'Usuário do sistema: usuário comumOK',
      'Perfil do Claude que o motor usa: pronto (assinatura)OK',
      'Perfil de assinatura: Assinatura: prontoOK',
      'Perfil de chave de API: Chave: prontoOK',
      'Avaliação técnica: ferramenta instalada e íntegra (eng-behaviour 0.17.0, commit ed3e1535cb84); 1 repositório declaradoOK',
      'Escrita no GitHub: instância normal: o motor publica pelos gatesOK',
      'Versão do Claude Code: 2.1.300 é a mais recenteOK',
      'Monitoramento da conta: @farol-bot vigiando biudtechOK',
    ]);
    expect(na(SAUDE).getByRole('status', { name: 'Resumo da saúde' }).textContent).toBe('12 verificações, nenhuma pede atenção.');
    expect(na(SAUDE).getByText(/^Motor 3\.0\.0-dev, diagnóstico feito em/)).toBeTruthy();
  });

  it('o que não está certo pede atenção em texto; o que para a revisão é vermelho, o resto âmbar', async () => {
    montar({ bruto: { ...BRUTO, doctor: { ...BRUTO.doctor, ghAuth: false, claudePerfilPronto: false, claudePerfilFalta: 'login' }, modelos: { ...BRUTO.modelos, cli: { instalada: '2.1.200', maisRecente: '2.1.300', atualizada: false, atrasada: true } } } });
    await assentar();
    const chip = (trecho: string) => itens().find((li) => li.textContent?.includes(trecho))?.querySelector('[data-tom]');
    expect(textos()).toContain('Autenticação do GitHub: sem autenticaçãoAtenção');
    expect(chip('Autenticação do GitHub')?.getAttribute('data-tom')).toBe('ruim');
    expect(chip('Perfil do Claude que o motor usa')?.getAttribute('data-tom')).toBe('ruim');
    expect(chip('Versão do Claude Code')?.getAttribute('data-tom')).toBe('aviso');
    expect(chip('Node')?.getAttribute('data-tom')).toBe('ok');
    expect(na(SAUDE).getByRole('status', { name: 'Resumo da saúde' }).textContent).toBe('12 verificações, 3 pedem atenção.');
  });

  it('diagnóstico que ainda não rodou é dito, e não vira lista de falhas', async () => {
    montar({ bruto: { ...BRUTO, doctor: null } });
    await assentar();
    expect(na(SAUDE).getByText(/ainda não rodou nesta execução do motor\. Rode-o abaixo/)).toBeTruthy();
    expect(textos()).toEqual(['Versão do Claude Code: 2.1.300 é a mais recenteOK', 'Monitoramento da conta: @farol-bot vigiando biudtechOK']);
    expect(resumoDe(SAUDE).textContent).toBe('Sem dado ou desligado:Saúde do motordiagnóstico ainda não rodou');
  });

  it('Rodar o diagnóstico de novo chama GET /api/doctor; enquanto roda, as linhas dizem Conferindo e o botão fica ocupado', async () => {
    const resposta = adiada();
    const t = montar({ responder: (caminho) => (caminho === '/api/doctor' ? resposta.promessa : REDE) });
    await assentar();
    expect(na(SAUDE).getByText(/Não abre sessão de IA e não consome o plano nem a chave/)).toBeTruthy();
    await clicarEm(na(SAUDE), 'Rodar o diagnóstico de novo');
    const ocupado = na(SAUDE).getByRole('button', { name: 'Rodando o diagnóstico…' }) as HTMLButtonElement;
    expect(ocupado.disabled).toBe(true);
    // as linhas que o doctor refaz dizem Conferindo; as que vêm de outro lugar ficam
    expect(textos().filter((texto) => texto?.endsWith('Conferindo'))).toHaveLength(10);
    expect(textos()).toContain('Monitoramento da conta: @farol-bot vigiando biudtechOK');
    await resposta.soltar(corpo({ ...BRUTO.doctor, checkedAt: 1763300060000 }));
    expect(t.get.mock.calls.map(([caminho]) => caminho)).toEqual(['/api/doctor']);
    expect(na(SAUDE).getByRole('status', { name: 'Resultado do diagnóstico' }).textContent).toContain('O motor refez o diagnóstico');
    expect(textos().some((texto) => texto?.endsWith('Conferindo'))).toBe(false);
  });

  it('falha ao rodar o diagnóstico aparece como erro, e a lista anterior fica', async () => {
    montar();
    await assentar();
    await clicarEm(na(SAUDE), 'Rodar o diagnóstico de novo');
    await assentar();
    expect(na(SAUDE).getByRole('status', { name: 'Resultado do diagnóstico' }).textContent).toBe('Erro: Não deu para falar com o motor (falha de rede). O que está acima é do diagnóstico anterior.');
    expect(itens()).toHaveLength(12);
  });

  it('o relatório é o markdown do motor, pedido em GET /api/diagnostics, com o botão ocupado enquanto carrega', async () => {
    const resposta = adiada();
    const t = montar({ responder: (caminho) => (caminho === '/api/diagnostics' ? resposta.promessa : REDE) });
    await assentar();
    await clicarEm(na(SAUDE), 'Carregar o relatório');
    expect((na(SAUDE).getByRole('button', { name: 'Carregando o relatório…' }) as HTMLButtonElement).disabled).toBe(true);
    await resposta.soltar(corpo({ ok: true, markdown: '# Diagnóstico do Farol\n\n## Ambiente\n\n- ok · Node: v24.22.1\n', falhas: [{}, {}] }));
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
  const habilitadas = (select: HTMLSelectElement) => [...select.options].filter((o) => !o.disabled).map((o) => o.value);

  it('as duas regras fixas do motor aparecem como texto, nunca como caixa de marcar', async () => {
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] } });
    await assentar();
    const s = na(CONTA_E_POLITICA);
    expect(within(s.getByRole('list', { name: 'Regras fixas do motor' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Check que já falha na base não segura. O check obrigatório que também falha no commit atual da base é herdado e não pesa na decisão.',
      'Merge-back sem commit próprio sai limpo. No PR de sincronização entre branches contínuas, sem defeito, a falta de card e os itens de processo não viram ressalva.',
    ]);
    expect(s.queryByRole('checkbox', { name: /falha na base|Merge-back/ })).toBeNull();
    expect(s.getAllByRole('checkbox')).toEqual([s.getByLabelText('Revisão automática')]);
    expect(s.getByText(/Não são configuração: valem sempre/)).toBeTruthy();
  });

  it('mostra a conta, a presença do token e a política, com o efeito de cada valor', async () => {
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] } });
    await assentar();
    const s = na(CONTA_E_POLITICA);
    expect(s.getByText('@farol-bot')).toBeTruthy();
    expect(s.getByText('Presente: o motor tem token do gh para esta conta.')).toBeTruthy();
    expect(s.getByText(/Do token o motor informa a presença, não a validade/)).toBeTruthy();
    expect(within(s.getByRole('list', { name: 'Organizações monitoradas' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['biudtechTirar']);
    expect((s.getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    expect(campo(/revisão reprova/).value).toBe('request_changes');
    expect(s.getByText(/Publica sozinho o pedido de mudanças/)).toBeTruthy();
    expect(s.getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(s.queryByRole('button', { name: SALVAR })).toBeNull();
  });

  it('os seletores não oferecem esperar: só publicar', async () => {
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] } });
    await assentar();
    expect([...campo(/revisão sai limpa/).options].map((o) => o.value)).toEqual(['approve']);
    expect([...campo(/com ressalvas/).options].map((o) => o.value)).toEqual(['approve']);
    expect([...campo(/revisão reprova/).options].map((o) => o.value)).toEqual(['request_changes']);
    expect(na(CONTA_E_POLITICA).queryByText(/Esperar/)).toBeNull();
  });

  it('conta que chega com esperar mostra o valor sem quebrar, numa opção desabilitada, e nunca o reenvia', async () => {
    const t = montar();
    await assentar();
    const limpa = campo(/revisão sai limpa/);
    expect(limpa.value).toBe('wait');
    expect(limpa.selectedOptions[0]?.textContent).toBe('Esperar (definido no motor)');
    expect(limpa.selectedOptions[0]?.disabled).toBe(true);
    expect(habilitadas(limpa)).toEqual(['approve']);
    expect(habilitadas(campo(/revisão reprova/))).toEqual(['request_changes']);
    expect(na(CONTA_E_POLITICA).getAllByText(/^Esperar \(definido no motor\): o motor não publica este desfecho sozinho/).length).toBeGreaterThan(0);
    // mexer só na revisão automática não leva a política junto, nem o esperar
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { autoReview: true } }]]);
    expect(JSON.stringify(t.envios())).not.toContain('wait');
  });

  it('com a limpa em espera vinda do motor, o com ressalvas fica travado; trocar a limpa para publicar o libera', async () => {
    const t = montar();
    await assentar();
    expect(campo(/com ressalvas/).disabled).toBe(true);
    expect(campo(/com ressalvas/).value).toBe('wait');
    expect(na(CONTA_E_POLITICA).getByText(/o com ressalvas nunca é mais permissivo que o limpo\)\. Troque a limpa para publicar/)).toBeTruthy();
    mudar(campo(/revisão sai limpa/), 'approve');
    expect(campo(/com ressalvas/).disabled).toBe(false);
    mudar(campo(/com ressalvas/), 'approve');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'approve', onCaveats: 'approve' } }]]);
  });

  it('ligar a revisão automática pergunta antes, com o efeito; cancelar não envia nada', async () => {
    const t = montar();
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    const pergunta = na(CONTA_E_POLITICA).getByRole('group', { name: 'Ampliar o que o motor publica sozinho por @farol-bot?' });
    expect(pergunta.textContent).toContain('Revisão automática ligada: o motor passa a abrir sozinho a sessão de revisão de todo PR pedido a @farol-bot');
    expect(pergunta.textContent).toContain('sem clique');
    // quando passa a valer, como o motor faz; sem mesa nem clique prometido
    expect(pergunta.textContent).toContain('O PR que a política anterior deixou esperando não é reavaliado');
    expect(pergunta.textContent).not.toContain('Precisa de você');
    expect(document.activeElement).toBe(within(pergunta).getByRole('button', { name: 'Voltar sem enviar' }));
    expect(t.envios()).toEqual([]);
    await clicarEm(na(CONTA_E_POLITICA), 'Voltar sem enviar');
    await assentar();
    expect(t.envios()).toEqual([]);
    // a edição continua no formulário, e o foco volta ao Salvar
    expect((na(CONTA_E_POLITICA).getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(na(CONTA_E_POLITICA).getByRole('button', { name: SALVAR }));
  });

  it('o pé diz quantas alterações há por salvar, e oferece Descartar e Salvar', async () => {
    montar();
    await assentar();
    mudar(campo(/revisão sai limpa/), 'approve');
    mudar(campo(/revisão reprova/), 'request_changes');
    expect(na(CONTA_E_POLITICA).getByText('2 alterações por salvar.')).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByRole('button', { name: 'Descartar a edição de a conta e a política' }).textContent).toBe('Descartar');
    expect(na(CONTA_E_POLITICA).getByRole('button', { name: SALVAR }).textContent).toBe('Salvar');
    expect(resumoDe(CONTA_E_POLITICA).textContent).toContain('alteração por salvar');
  });

  it('aceita a pergunta: o corpo leva só o campo editado; enquanto salva o botão diz Salvando…; depois, Salvo às', async () => {
    const resposta = adiada();
    const t = montar({ aoPostar: (rota) => (rota === '/api/accounts/edit' ? resposta.promessa : undefined) });
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    const ocupado = na(CONTA_E_POLITICA).getByRole('button', { name: /^Salvando…/ }) as HTMLButtonElement;
    expect(ocupado.disabled).toBe(true);
    expect(ocupado.textContent).toBe('Salvando…');
    await resposta.soltar(corpo({ ok: true, ignoradas: [], ignorados: [] }));
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { autoReview: true } }]]);
    expect(regiao().textContent).toContain('O motor aceitou a mudança em @farol-bot: revisão automática: ligada. A resposta dele não traz a conta gravada.');
    expect(document.activeElement).toBe(regiao());
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, autoReview: true }] });
    expect(na(CONTA_E_POLITICA).getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByText(/^Salvo às /)).toBeTruthy();
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
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(na(CONTA_E_POLITICA).queryByRole('group')).toBeNull();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { autoReview: false } }]]);
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

  it('campo que o motor ignorou e recusa do motor aparecem como erro, também no pé do formulário', async () => {
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] }, aoPostar: (rota) => (rota === '/api/accounts/edit' ? corpo({ ok: true, ignoradas: [], ignorados: ['autoReview'] }) : undefined) });
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor aceitou o pedido de @farol-bot, mas ignorou revisão automática');
    expect(na(CONTA_E_POLITICA).getByText(/^Erro ao salvar: o motor não gravou esta edição/)).toBeTruthy();

    cleanup();
    montar({ bruto: { ...BRUTO, accounts: [ABERTA] }, aoPostar: (rota) => (rota === '/api/accounts/edit' ? corpo({ ok: false, erro: 'a conta @farol-bot não é a conta deste Farol' }) : undefined) });
    await assentar();
    act(() => { fireEvent.click(na(CONTA_E_POLITICA).getByLabelText('Revisão automática')); });
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

  it('política que muda no motor com a edição aberta: o salvar leva só o que a pessoa alterou, e o campo do outro não é revertido', async () => {
    const t = montar();
    await assentar();
    // ela só mexe na reprovada
    mudar(campo(/revisão reprova/), 'request_changes');
    // nesse meio outra pessoa liga a revisão automática e acrescenta uma organização
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, autoReview: true, owners: ['biudtech', 'outra'] }] });
    expect(na(CONTA_E_POLITICA).getByText(/a conta e a política mudou no motor enquanto você editava.*o salvar leva só o que você alterou: o que a outra pessoa mudou não é desfeito/)).toBeTruthy();
    // os campos que ela não tocou mostram o que o motor tem agora
    expect((na(CONTA_E_POLITICA).getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
    expect(within(na(CONTA_E_POLITICA).getByRole('list', { name: 'Organizações monitoradas' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['biudtechTirar', 'outraTirar']);
    expect(campo(/revisão reprova/).value).toBe('request_changes');
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    // nem autoReview nem owners vão no corpo: o que a outra pessoa mudou fica
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onReject: 'request_changes' } }]]);
  });

  it('o mesmo campo alterado pelos dois: a tela mostra o valor do motor e o seu, e a pergunta é contra o valor atual do motor', async () => {
    const t = montar();
    await assentar();
    mudar(campo(/revisão sai limpa/), 'approve');
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, onClean: 'merge' }] });
    const aviso = na(CONTA_E_POLITICA).getByText(/mudou no motor enquanto você editava/).closest('div') as HTMLElement;
    expect(within(aviso).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Revisão limpa: no motor agora está "merge (valor que esta tela não conhece)", e no seu formulário, "publicar a aprovação sozinho". Salvar grava o seu.',
    ]);
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'approve' } }]]);

    // agora o contrário: ela põe a reprovada em publicar, e nesse meio o motor passa a ter outro valor nela
    cleanup();
    const outra = montar();
    await assentar();
    mudar(campo(/revisão reprova/), 'request_changes');
    outra.trocar({ ...BRUTO, accounts: [{ ...CONTA, onReject: 'merge' }] });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    // a ampliação é calculada contra o motor de agora, que não publicava
    expect(na(CONTA_E_POLITICA).getByRole('group', { name: /Ampliar o que o motor publica sozinho/ }).textContent).toContain('publicar sozinho o pedido de mudanças (REQUEST_CHANGES)');
    await clicarEm(na(CONTA_E_POLITICA), 'Voltar sem enviar');
    // e se o motor já ficou com o valor que ela pôs, não há o que mandar nem o que perguntar
    outra.trocar({ ...BRUTO, accounts: [{ ...CONTA, onReject: 'request_changes' }] });
    expect(na(CONTA_E_POLITICA).getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(outra.envios()).toEqual([]);
  });

  it('dá para descartar a edição e ficar com o que o motor tem agora, inclusive o esperar dele', async () => {
    const t = montar();
    await assentar();
    mudar(campo(/revisão reprova/), 'request_changes');
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, onClean: 'approve' }] });
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    await clicarEm(na(CONTA_E_POLITICA), 'Descartar a edição de a conta e a política');
    expect(campo(/revisão reprova/).value).toBe('wait');
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    expect(na(CONTA_E_POLITICA).getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('organização que outra pessoa acrescentou nesse meio continua na lista que vai no corpo', async () => {
    const t = montar();
    await assentar();
    mudar(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'), 'acme');
    await clicarEm(na(CONTA_E_POLITICA), 'Adicionar à lista');
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, owners: ['biudtech', 'outra'] }] });
    await clicarEm(na(CONTA_E_POLITICA), SALVAR);
    await clicarEm(na(CONTA_E_POLITICA), CONFIRMAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { owners: ['biudtech', 'outra', 'acme'] } }]]);
  });

  it('cada seletor e o checkbox têm o efeito ligado por aria-describedby', async () => {
    montar();
    await assentar();
    const descricao = (elemento: HTMLElement): string => {
      const id = elemento.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      return document.getElementById(id ?? '')?.textContent ?? '';
    };
    expect(descricao(na(CONTA_E_POLITICA).getByLabelText('Revisão automática'))).toContain('Desligada: o PR pedido à conta só entra na fila');
    expect(descricao(campo(/revisão sai limpa/))).toContain('Esperar (definido no motor)');
    expect(descricao(campo(/com ressalvas/))).toContain('o com ressalvas nunca é mais permissivo que o limpo');
    expect(descricao(campo(/revisão reprova/))).toContain('Esperar (definido no motor)');
    expect(descricao(na(AUTOMACAO).getByLabelText('Revisões ao mesmo tempo'))).toContain('Quantas sessões de revisão');
    expect(descricao(na(AUTOMACAO).getByLabelText('Modelo da revisão'))).toContain('Vira a flag --model');
    expect(descricao(na(AUTOMACAO).getByLabelText('Esforço (effort) da revisão'))).toContain('Vira a flag --effort');
  });

  it('depois de Tirar uma organização o foco vai ao campo de acrescentar', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ ...CONTA, owners: ['biudtech', 'acme'] }] } });
    await assentar();
    const botao = na(CONTA_E_POLITICA).getByRole('button', { name: 'Tirar acme das organizações monitoradas' });
    botao.focus();
    await clicarEm(na(CONTA_E_POLITICA), 'Tirar acme das organizações monitoradas');
    expect(document.activeElement).toBe(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'));
    // também quando era a última
    await clicarEm(na(CONTA_E_POLITICA), 'Tirar biudtech das organizações monitoradas');
    expect(document.activeElement).toBe(na(CONTA_E_POLITICA).getByLabelText('Organização a adicionar'));
  });

  it('sem edição, o formulário acompanha o que o motor manda', async () => {
    const t = montar();
    await assentar();
    t.trocar({ ...BRUTO, accounts: [ABERTA] });
    expect(campo(/revisão sai limpa/).value).toBe('approve');
    expect((na(CONTA_E_POLITICA).getByLabelText('Revisão automática') as HTMLInputElement).checked).toBe(true);
    expect(na(CONTA_E_POLITICA).queryByText(/mudou no motor enquanto você editava/)).toBeNull();
    expect(resumoDe(CONTA_E_POLITICA).textContent).toBe('OK:Conta revisora@farol-bot, publica sozinho');
  });

  it('motor sem conta revisora: só leitura, sem formulário, e a linha fica vermelha', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ user: '', owners: [], tokenOk: false }] } });
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText('O motor ainda não tem conta revisora.')).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByText(/Sem conta revisora não há política a editar/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).queryByLabelText('Revisão automática')).toBeNull();
    expect(resumoDe(CONTA_E_POLITICA).textContent).toBe('Problema:Conta revisorasem conta revisora');
  });

  it('regra de review por organização é avisada, porque decide antes da revisão automática', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ ...CONTA, reviewRules: { acme: { mode: 'auto' } } }] } });
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText(/a conta tem regra de review própria para 1 organização/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByRole('link', { name: 'Regras por organização e autor' }).getAttribute('href')).toBe('/sistema/regras');
  });

  it('a política explicada em frase, do valor do motor', async () => {
    montar({ bruto: { ...BRUTO, accounts: [{ ...ABERTA, owners: ['biudtech', 'acme'], reviewRules: { acme: { mode: 'manual' } } }] } });
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText(/^O Farol revisa sozinho todo PR pedido a @farol-bot nas organizações biudtech e acme: aprova sozinho o que sai limpo ou com ressalvas e pede mudanças sozinho quando acha defeito/)).toBeTruthy();
    expect(na(CONTA_E_POLITICA).getByText(/A regra por organização e autor vem antes disto\.$/)).toBeTruthy();
    cleanup();
    montar();
    await assentar();
    expect(na(CONTA_E_POLITICA).getByText('A revisão automática está desligada: os PRs pedidos a @farol-bot nas organizações biudtech só são revisados no clique.')).toBeTruthy();
  });
});

describe('Sistema: automação', () => {
  const SALVAR = 'Salvar automação';
  const campo = (rotulo: string | RegExp) => na(AUTOMACAO).getByLabelText(rotulo) as HTMLSelectElement;
  const gravou = (config: unknown) => (rota: string) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config }) : undefined);

  it('mostra as três chaves com o efeito de cada uma, e os modelos do catálogo do motor', async () => {
    montar();
    await assentar();
    expect([...campo('Revisões ao mesmo tempo').options].map((o) => o.value)).toEqual(['1', '2', '3', '4']);
    expect([...campo('Modelo da revisão').options].map((o) => [o.value, o.textContent])).toEqual([['', 'Padrão do Claude'], ['auto', 'Auto (qualidade primeiro)'], ['opus', 'Opus'], ['sonnet', 'Sonnet']]);
    expect([...campo('Esforço (effort) da revisão').options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh']);
    expect(na(AUTOMACAO).getByText(/Vira a flag --model/)).toBeTruthy();
    expect(na(AUTOMACAO).getByText('Sem alteração por salvar.')).toBeTruthy();
  });

  it('não tem o controle da espera do CI: o único checkbox é o modo rápido, e nenhum texto de CI antes de aprovar', async () => {
    montar();
    await assentar();
    expect(na(AUTOMACAO).getAllByRole('checkbox')).toEqual([na(AUTOMACAO).getByLabelText('Modo rápido')]);
    expect(na(AUTOMACAO).queryByLabelText(/CI/)).toBeNull();
    expect(secao(AUTOMACAO).textContent).not.toMatch(/CI obrigatório|antes de aprovar|Esperando o CI/);
  });

  it('salvar manda só a chave editada, sem política, perfis nem a espera do CI, e confere a resposta', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, parallelReviews: 3 }) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '3');
    expect(na(AUTOMACAO).getByText('1 alteração por salvar.')).toBeTruthy();
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(na(AUTOMACAO).queryByRole('group')).toBeNull();
    expect(t.envios()).toEqual([['/api/settings', { parallelReviews: 3 }]]);
    expect(regiao().textContent).toContain('O motor gravou: revisões ao mesmo tempo: 3.');
    expect(document.activeElement).toBe(regiao());
  });

  it('o corpo nunca leva aguardarCiParaAprovar, nem quando o motor muda a chave com a edição aberta', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, reviewModel: 'sonnet', reviewEffort: 'high', parallelReviews: 2 }) });
    await assentar();
    mudar(campo('Modelo da revisão'), 'sonnet');
    t.trocar({ ...BRUTO, config: { ...CONFIG, aguardarCiParaAprovar: false } });
    mudar(campo('Esforço (effort) da revisão'), 'high');
    mudar(campo('Revisões ao mesmo tempo'), '2');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { reviewModel: 'sonnet', reviewEffort: 'high', parallelReviews: 2 }]]);
    expect(JSON.stringify(t.envios())).not.toContain('aguardarCiParaAprovar');
  });

  it('motor sem a espera do CI no config ainda mostra a automação', async () => {
    const semCi: Record<string, unknown> = { ...CONFIG };
    delete semCi.aguardarCiParaAprovar;
    montar({ bruto: { ...BRUTO, config: semCi } });
    await assentar();
    expect(campo('Revisões ao mesmo tempo').value).toBe('1');
  });

  it('enquanto salva, o botão diz Salvando… e fica desabilitado', async () => {
    const resposta = adiada();
    montar({ aoPostar: (rota) => (rota === '/api/settings' ? resposta.promessa : undefined) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '2');
    await clicarEm(na(AUTOMACAO), SALVAR);
    const ocupado = na(AUTOMACAO).getByRole('button', { name: /^Salvando…/ }) as HTMLButtonElement;
    expect(ocupado.disabled).toBe(true);
    await resposta.soltar(corpo({ ok: true, ignoradas: [], config: { ...CONFIG, parallelReviews: 2 } }));
    expect(na(AUTOMACAO).queryByRole('button', { name: /^Salvando…/ })).toBeNull();
  });

  it('o motor gravou diferente do pedido: a tela diz o que ficou, como erro', async () => {
    montar({ aoPostar: gravou({ ...CONFIG, reviewModel: 'opus' }) });
    await assentar();
    mudar(campo('Modelo da revisão'), 'sonnet');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor gravou diferente do pedido: modelo ficou opus, e o pedido era sonnet.');
  });

  it('falha de rede não afirma que gravou, e o pé diz o erro ao salvar', async () => {
    montar({ aoPostar: (rota) => (rota === '/api/settings' ? REDE : undefined) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '2');
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(regiao().textContent).toContain('Erro: Não deu para falar com o motor (falha de rede). Não dá para saber se o pedido chegou');
    expect(na(AUTOMACAO).getByText(/^Erro ao salvar: o motor não gravou esta edição/)).toBeTruthy();
    expect(na(AUTOMACAO).getByRole('button', { name: SALVAR })).toBeTruthy();
  });

  it('com o Auto, a tela avisa que o esforço não é usado; modelo fixado no arquivo aparece como opção', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, reviewModel: 'claude-opus-5-5', reviewEffort: 'high', globalParallelReviews: 3 } } });
    await assentar();
    expect(campo('Modelo da revisão').selectedOptions[0]?.textContent).toBe('claude-opus-5-5 (fixado no arquivo de configuração; não está no catálogo)');
    expect(na(AUTOMACAO).getByText(/limite total de 3 sessões ao mesmo tempo/)).toBeTruthy();
    mudar(campo('Modelo da revisão'), 'auto');
    expect(na(AUTOMACAO).getByText(/com o modelo escolhido o motor não usa este valor/)).toBeTruthy();
  });

  it('chave que outra pessoa mudou com a edição aberta não vai no corpo, e a que os dois mexeram é dita', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, parallelReviews: 3, reviewModel: '' }) });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '3');
    mudar(campo('Modelo da revisão'), '');
    // nesse meio alguém troca o modelo e o esforço
    t.trocar({ ...BRUTO, config: { ...CONFIG, reviewModel: 'sonnet', reviewEffort: 'low' } });
    expect(campo('Esforço (effort) da revisão').value).toBe('low');
    const aviso = na(AUTOMACAO).getByText(/a automação mudou no motor enquanto você editava/).closest('div') as HTMLElement;
    expect(within(aviso).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['modelo: no motor agora está "sonnet", e no seu formulário, "padrão do Claude Code". Salvar grava o seu.']);
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    // o esforço que a outra pessoa trocou não volta, e não há pergunta
    expect(t.envios()).toEqual([['/api/settings', { parallelReviews: 3, reviewModel: '' }]]);
  });

  it('o modo rápido vai sozinho no corpo, e sem a chave no motor fica sem edição', async () => {
    const t = montar({ aoPostar: gravou({ ...CONFIG, reviewFast: true }) });
    await assentar();
    expect(na(AUTOMACAO).getByText(/Nenhum gate fica mais frouxo/)).toBeTruthy();
    act(() => { fireEvent.click(na(AUTOMACAO).getByLabelText('Modo rápido')); });
    await clicarEm(na(AUTOMACAO), SALVAR);
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { reviewFast: true }]]);
    expect(regiao().textContent).toContain('O motor gravou: modo rápido: ligado.');

    cleanup();
    const semChave: Record<string, unknown> = { ...CONFIG };
    delete semChave.reviewFast;
    montar({ bruto: { ...BRUTO, config: semChave } });
    await assentar();
    expect((na(AUTOMACAO).getByLabelText('Modo rápido') as HTMLInputElement).disabled).toBe(true);
    expect(na(AUTOMACAO).getByText(/O motor não mandou este campo/)).toBeTruthy();
  });

  it('sem conexão o salvar fica fechado', async () => {
    montar({ conexao: 'sem-motor' });
    await assentar();
    mudar(campo('Revisões ao mesmo tempo'), '2');
    expect(na(AUTOMACAO).getByText(/^Bloqueado:/)).toBeTruthy();
    expect(na(AUTOMACAO).queryByRole('button', { name: SALVAR })).toBeNull();
  });
});

describe('Sistema: Claude', () => {
  const lista = () => na(CLAUDE).getByRole('list', { name: 'Perfis do Claude, na ordem de uso' });
  const perfil = (nome: string) => within(within(lista()).getByRole('heading', { level: 3, name: new RegExp(`^${nome}`) }).closest('li') as HTMLElement);
  const abrir = async (nome: string) => { await clicarEm(perfil(nome), new RegExp(`^${nome}`)); };
  const inicioDoLogin = corpo({ ok: true, loginId: 'login-1', url: 'https://claude.com/cai/oauth/authorize?code=true&state=x' });

  it('os perfis na ordem de uso, o padrão primeiro, cada um fechado com o tipo e o estado', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [API, PLANO] } } });
    await assentar();
    const titulos = within(lista()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual(['1AssinaturaAssinatura · perfil padrãoPronto', '2ChaveChave de APIChave presente']);
    expect(perfil('Assinatura').getByRole('button', { name: /^Assinatura/ }).getAttribute('aria-expanded')).toBe('false');
    expect(perfil('Assinatura').queryByRole('button', { name: 'Testar o perfil Assinatura' })).toBeNull();
  });

  it('o perfil abre com o uso do plano, a validade do login, a posição e as ações', async () => {
    const t = montar();
    await assentar();
    await abrir('Assinatura');
    expect(perfil('Assinatura').getByRole('button', { name: /^Assinatura/ }).getAttribute('aria-expanded')).toBe('true');
    expect(perfil('Assinatura').getByText('40% usado, volta às 18h')).toBeTruthy();
    expect(perfil('Assinatura').getByText(/^Vale até /)).toBeTruthy();
    expect(perfil('Assinatura').getByText(/1º, o perfil padrão: a sessão começa por ele/)).toBeTruthy();
    expect(perfil('Assinatura').getByRole('button', { name: 'Testar o perfil Assinatura' })).toBeTruthy();
    expect(perfil('Assinatura').getByRole('button', { name: 'Refazer o login do perfil Assinatura' })).toBeTruthy();
    // o primeiro não sobe
    expect(perfil('Assinatura').queryByRole('button', { name: /na ordem de uso/ })).toBeNull();
    expect(t.container.innerHTML).not.toContain('apiKey');
    expect(t.container.innerHTML).not.toContain('/home/farol');
  });

  it('o perfil por chave de API não tem Refazer login: a tela diz que a chave é só pela API', async () => {
    montar();
    await assentar();
    await abrir('Chave');
    expect(perfil('Chave').queryByRole('button', { name: /Refazer/ })).toBeNull();
    expect(perfil('Chave').getByText(/Este perfil usa chave de API: não tem login para refazer\. A chave entra e muda só pela API do motor/)).toBeTruthy();
    expect(perfil('Chave').getByText(/Chave presente\. O motor não informa se ela vale/)).toBeTruthy();
    expect(perfil('Chave').queryByRole('textbox')).toBeNull();
  });

  it('não tem teto nem campo de chave: nenhum valor nem aviso de teto na tela', async () => {
    const t = montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [{ ...PLANO, budgetDaily: 20, budgetTotal: 300, budgetSince: '2026-11-01' }, API] } } });
    await assentar();
    await abrir('Assinatura');
    await abrir('Chave');
    expect(within(lista()).queryByRole('textbox')).toBeNull();
    expect(within(lista()).queryByRole('button', { name: /teto/i })).toBeNull();
    expect(within(lista()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      '1AssinaturaAssinatura · perfil padrãoPronto', 'Testar o perfil Assinatura', 'Refazer o login do perfil Assinatura',
      '2ChaveChave de APIChave presente', 'Testar o perfil Chave', 'Subir Chave na ordem de uso',
    ]);
    expect(secao(CLAUDE).textContent).not.toMatch(/US\$|20,00|2026-11-01|01\/11\/2026|[Tt]eto|pausar/);
    // e o valor do teto nem entra no store
    expect(JSON.stringify(t.store.ler().snapshot?.config)).not.toMatch(/budget|2026-11-01|temTeto/);
  });

  it('Testar diz antes o que faz e que não consome, e manda só o id do perfil', async () => {
    const t = montar({
      aoPostar: (rota) => (rota === '/api/claude/profile-test'
        ? corpo({ ok: true, escreveu: false, perfil: { id: 'plano', label: 'Assinatura', kind: 'dir', aviso: '', campos: { login: { valor: true, origem: 'validado' }, email: { valor: 'bot@biud.com.br', origem: 'validado' }, tipoAuth: { valor: 'claude.ai', origem: 'validado' }, plano: { valor: null, origem: 'desconhecido', motivo: 'o nome comercial do plano não é detectável' } } } })
        : undefined),
    });
    await assentar();
    await abrir('Assinatura');
    await abrir('Chave');
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
    await abrir('Chave');
    await clicarEm(perfil('Chave'), 'Testar o perfil Chave');
    await assentar();
    expect(perfil('Chave').getByRole('status', { name: 'Resultado do teste do perfil Chave' }).textContent).toBe('Erro: o motor não testou o perfil: esse perfil está incompleto: falta a chave, ou a pasta fica fora do HOME do Farol.');

    cleanup();
    montar({ aoPostar: (rota) => (rota === '/api/claude/profile-test' ? REDE : undefined) });
    await assentar();
    await abrir('Chave');
    await clicarEm(perfil('Chave'), 'Testar o perfil Chave');
    await assentar();
    expect(perfil('Chave').getByRole('status', { name: 'Resultado do teste do perfil Chave' }).textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).');
  });

  it('Subir na ordem manda o padrão e a lista na ordem nova, sem chave nem pasta, e confere o que voltou', async () => {
    const gravada = { ...CONFIG, claudeProfileId: 'api', claudeProfiles: [API, PLANO] };
    const t = montar({ aoPostar: (rota) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config: gravada }) : undefined) });
    await assentar();
    await abrir('Chave');
    await clicarEm(perfil('Chave'), 'Subir Chave na ordem de uso');
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { claudeProfileId: 'api', claudeProfiles: [{ id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '' }, { id: 'plano', label: 'Assinatura', kind: 'dir' }] }]]);
    expect(JSON.stringify(t.envios())).not.toMatch(/apiKey|\/home\/farol|temChave|budget/);
    expect(regiao().textContent).toContain('O motor gravou a ordem de uso: Chave, Assinatura.');
  });

  it('com parte da lista descartada na borda, Subir na ordem fica fechado e diz por quê', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [PLANO, { ...API, apiKey: CHAVE_DA_ANTHROPIC }] } } });
    await assentar();
    await abrir('Chave');
    expect(perfil('Chave').queryByRole('button', { name: /na ordem de uso/ })).toBeNull();
    expect(perfil('Chave').getByText(/^Subir na ordem fechado: Parte da lista de perfis chegou fora da forma/)).toBeTruthy();
  });

  it('Refazer login: abre o link do motor, o código vai só no corpo do POST e some do campo', async () => {
    const enviados: unknown[] = [];
    const t = montar({
      aoPostar: (rota, enviado) => {
        enviados.push(enviado);
        if (rota === '/api/claude/login-web/start') return inicioDoLogin;
        if (rota === '/api/claude/login-web/code') return corpo({ ok: true, code: CODIGO_DO_LOGIN });
        return undefined;
      },
    });
    await assentar();
    await abrir('Assinatura');
    await clicarEm(perfil('Assinatura'), 'Refazer o login do perfil Assinatura');
    await assentar();
    expect(t.envios()).toEqual([['/api/claude/login-web/start', { profileId: 'plano' }]]);
    const link = perfil('Assinatura').getByRole('link', { name: 'Abrir a página de login do Claude' });
    expect(link.getAttribute('href')).toBe('https://claude.com/cai/oauth/authorize?code=true&state=x');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const campo = perfil('Assinatura').getByLabelText('Código da página de login') as HTMLInputElement;
    expect(campo.type).toBe('password');
    campo.value = CODIGO_DO_LOGIN;
    await clicarEm(perfil('Assinatura'), 'Enviar o código');
    await assentar();
    expect(t.envios()[1]).toEqual(['/api/claude/login-web/code', { loginId: 'login-1', code: CODIGO_DO_LOGIN }]);
    expect(perfil('Assinatura').getByRole('status', { name: 'Resultado do login do perfil Assinatura' }).textContent).toContain('Login feito no perfil Assinatura.');
    expect(t.container.innerHTML).not.toContain(CODIGO_DO_LOGIN);
    expect(enviados.length).toBeGreaterThan(0);
  });

  it('login recusado: o código some do campo, a frase do motor aparece, e dá para começar de novo', async () => {
    const t = montar({
      aoPostar: (rota) => {
        if (rota === '/api/claude/login-web/start') return inicioDoLogin;
        if (rota === '/api/claude/login-web/code') return corpo({ ok: false, code: 'recusado', motivo: 'Login failed: Request failed with status code 400' });
        return undefined;
      },
    });
    await assentar();
    await abrir('Assinatura');
    await clicarEm(perfil('Assinatura'), 'Refazer o login do perfil Assinatura');
    await assentar();
    (perfil('Assinatura').getByLabelText('Código da página de login') as HTMLInputElement).value = CODIGO_DO_LOGIN;
    await clicarEm(perfil('Assinatura'), 'Enviar o código');
    await assentar();
    expect(perfil('Assinatura').getByRole('status', { name: 'Resultado do login do perfil Assinatura' }).textContent).toBe('Erro: O Claude Code não aceitou o código: comece de novo e cole o código da página nova. O motor disse: Login failed: Request failed with status code 400.');
    expect(t.container.innerHTML).not.toContain(CODIGO_DO_LOGIN);
    expect(perfil('Assinatura').getByRole('button', { name: 'Refazer o login do perfil Assinatura' })).toBeTruthy();
  });

  it('com outro login aberto no motor, a tela oferece cancelá-lo pelo perfil; Cancelar encerra pelo id', async () => {
    const t = montar({
      aoPostar: (rota) => {
        if (rota === '/api/claude/login-web/start') return t.envios().length > 2 ? inicioDoLogin : corpo({ ok: false, code: 'login-em-curso', perfilAberto: 'outro', motivo: 'já há um login do Claude aberto neste Farol' });
        return undefined;
      },
    });
    await assentar();
    await abrir('Assinatura');
    await clicarEm(perfil('Assinatura'), 'Refazer o login do perfil Assinatura');
    await assentar();
    expect(perfil('Assinatura').getByRole('status', { name: 'Resultado do login do perfil Assinatura' }).textContent).toContain('Já há um login do Claude aberto neste motor.');
    await clicarEm(perfil('Assinatura'), 'Cancelar o login aberto');
    await assentar();
    expect(t.envios()[1]).toEqual(['/api/claude/login-web/cancel', { profileId: 'outro' }]);
    await clicarEm(perfil('Assinatura'), 'Refazer o login do perfil Assinatura');
    await assentar();
    await clicarEm(perfil('Assinatura'), 'Cancelar');
    await assentar();
    expect(t.envios()[3]).toEqual(['/api/claude/login-web/cancel', { loginId: 'login-1' }]);
  });

  it('perfil com id que parece chave e não é aparece na lista: sk-anthropic-1', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [{ id: 'sk-anthropic-1', kind: 'apikey', baseUrl: '', temChave: true }, PLANO] } } });
    await assentar();
    expect(perfil('sk-anthropic-1').getByText('Chave de API')).toBeTruthy();
    expect(na(CLAUDE).queryByRole('alert')).toBeNull();
  });

  it('sem perfil, o assunto diz o que isso significa, e o menu fica vermelho', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, claudeProfiles: [] } } });
    await assentar();
    expect(na(CLAUDE).getByText(/O motor não tem perfil do Claude/)).toBeTruthy();
    expect(resumoDe(CLAUDE).textContent).toBe('Problema:Claudenenhum perfil');
  });
});

describe('Sistema: Jira', () => {
  const credencial = (t: ReturnType<typeof montar>) => t.post.mock.calls.filter(([rota]) => rota === '/api/jira/credential');

  it('mostra o site, as organizações, os projetos, os últimos cards lidos e a presença da credencial', async () => {
    montar();
    await assentar();
    const s = na(JIRA);
    expect(s.getByRole('heading', { level: 3, name: /^BIUD/ })).toBeTruthy();
    expect(s.getByText('Com credencial').getAttribute('data-tom')).toBe('ok');
    expect(s.getByText('https://biud.atlassian.net')).toBeTruthy();
    expect(s.getByText('biudtech')).toBeTruthy();
    expect(s.getByText('BT')).toBeTruthy();
    // das decisões resolvidas, só as da organização do site, da mais nova para a mais antiga
    expect(s.getByText(/^BT-11 \(.+\), BT-10 \(.+\)$/)).toBeTruthy();
    expect(s.queryByText(/BT-12/)).toBeNull();
    expect(s.getByText('Presente. Se ela vale, quem diz é o teste abaixo.')).toBeTruthy();
    expect(s.queryByRole('textbox')).toBeNull();
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

  it('Trocar credencial: o token vai só no corpo do POST, some do campo e da tela, e não volta da resposta', async () => {
    // o motor de mentira ecoa o token na resposta: a tela não pode mostrá-lo nem guardá-lo
    const t = montar({ aoPostar: (rota) => (rota === '/api/jira/credential' ? corpo({ ok: true, token: TOKEN_DO_JIRA, email: 'bot@exemplo.com' }) : undefined) });
    await assentar();
    await clicarEm(na(JIRA), 'Trocar a credencial do Jira de BIUD');
    const token = na(JIRA).getByLabelText('Token de API do Atlassian') as HTMLInputElement;
    expect(token.type).toBe('password');
    mudar(na(JIRA).getByLabelText('E-mail da conta do Atlassian'), 'bot@exemplo.com');
    token.value = TOKEN_DO_JIRA;
    await clicarEm(na(JIRA), 'Guardar a credencial');
    await assentar();
    expect(credencial(t).map(([rota, enviado]) => [rota, enviado])).toEqual([['/api/jira/credential', { siteId: 'biud', email: 'bot@exemplo.com', token: TOKEN_DO_JIRA }]]);
    expect(t.container.innerHTML).not.toContain(TOKEN_DO_JIRA);
    expect(JSON.stringify(t.store.ler())).not.toContain(TOKEN_DO_JIRA);
    expect(na(JIRA).queryByLabelText('Token de API do Atlassian')).toBeNull();
    expect(na(JIRA).getByRole('status', { name: 'Resultado da troca da credencial de BIUD' }).textContent).toContain('O motor guardou a credencial nova de BIUD.');
  });

  it('credencial recusada ou sem resposta: o token some do campo, o e-mail fica, e o erro aparece', async () => {
    let resposta: Resposta = corpo({ ok: false, error: 'dados incompletos' });
    const t = montar({ aoPostar: (rota) => (rota === '/api/jira/credential' ? resposta : undefined) });
    await assentar();
    await clicarEm(na(JIRA), 'Trocar a credencial do Jira de BIUD');
    mudar(na(JIRA).getByLabelText('E-mail da conta do Atlassian'), 'bot@exemplo.com');
    (na(JIRA).getByLabelText('Token de API do Atlassian') as HTMLInputElement).value = TOKEN_DO_JIRA;
    await clicarEm(na(JIRA), 'Guardar a credencial');
    await assentar();
    expect(na(JIRA).getByRole('status', { name: 'Resultado da troca da credencial de BIUD' }).textContent).toBe('Erro: O motor recusou a credencial: dados incompletos. O token foi apagado deste campo: cole de novo para tentar.');
    expect((na(JIRA).getByLabelText('Token de API do Atlassian') as HTMLInputElement).value).toBe('');
    expect((na(JIRA).getByLabelText('E-mail da conta do Atlassian') as HTMLInputElement).value).toBe('bot@exemplo.com');
    expect(t.container.innerHTML).not.toContain(TOKEN_DO_JIRA);

    resposta = REDE;
    (na(JIRA).getByLabelText('Token de API do Atlassian') as HTMLInputElement).value = TOKEN_DO_JIRA;
    await clicarEm(na(JIRA), 'Guardar a credencial');
    await assentar();
    expect(na(JIRA).getByRole('status', { name: 'Resultado da troca da credencial de BIUD' }).textContent).toContain('Não dá para saber se a credencial entrou');
    expect(t.container.innerHTML).not.toContain(TOKEN_DO_JIRA);
  });

  it('sem e-mail ou sem token nada é enviado', async () => {
    const t = montar();
    await assentar();
    await clicarEm(na(JIRA), 'Trocar a credencial do Jira de BIUD');
    await clicarEm(na(JIRA), 'Guardar a credencial');
    expect(na(JIRA).getByRole('status', { name: 'Resultado da troca da credencial de BIUD' }).textContent).toContain('Informe o e-mail');
    mudar(na(JIRA).getByLabelText('E-mail da conta do Atlassian'), 'bot@exemplo.com');
    await clicarEm(na(JIRA), 'Guardar a credencial');
    expect(na(JIRA).getByRole('status', { name: 'Resultado da troca da credencial de BIUD' }).textContent).toContain('Cole o token');
    expect(credencial(t)).toEqual([]);
  });

  it('sem site, o assunto diz que o recurso está desligado', async () => {
    montar({ bruto: { ...BRUTO, jiraSites: [] } });
    await assentar();
    expect(na(JIRA).getByText(/O motor não tem site do Jira: o recurso está desligado/)).toBeTruthy();
  });
});

describe('Sistema: regras por organização e autor', () => {
  const COM_REGRAS = { ...BRUTO, accounts: [{ ...CONTA, reviewRules: { biudtech: { mode: 'manual', authors: { 'robo[bot]': 'auto' } } } }] };

  it('lista cada regra com a frase do que ela faz', async () => {
    montar({ bruto: COM_REGRAS });
    await assentar();
    const itens = within(na(REGRAS).getByRole('list', { name: 'Regras por organização e autor' })).getAllByRole('listitem');
    expect(itens.map((li) => li.querySelector('h3')?.textContent)).toEqual(['biudtechSó no clique', '@robo[bot] em biudtechRevisa sozinho']);
    expect(itens[0]?.textContent).toContain('Os PRs de biudtech só são revisados no clique');
    expect(resumoDe(REGRAS).textContent).toBe('OK:Regras por organização e autor2 exceções');
  });

  it('criar regra no clique vai direto, com a operação pontual, e limpa o formulário só depois do aceite', async () => {
    let resposta: Resposta = REDE;
    const t = montar({ aoPostar: (rota) => (rota === '/api/accounts/edit' ? resposta : undefined) });
    await assentar();
    mudar(na(REGRAS).getByLabelText('Organização do GitHub'), 'Acme');
    mudar(na(REGRAS).getByLabelText('Autor (opcional)'), '@Fulano');
    await clicarEm(na(REGRAS), 'Salvar a regra de @fulano em acme: só no clique');
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'regra-review', user: 'farol-bot', organization: 'acme', author: 'fulano', mode: 'manual' }]]);
    // a falha não perde o que foi digitado
    expect((na(REGRAS).getByLabelText('Organização do GitHub') as HTMLInputElement).value).toBe('Acme');
    resposta = corpo({ ok: true, ignoradas: [], ignorados: [] });
    await clicarEm(na(REGRAS), 'Salvar a regra de @fulano em acme: só no clique');
    await assentar();
    expect(regiao().textContent).toContain('O motor gravou a regra de @fulano em acme: só no clique.');
    expect((na(REGRAS).getByLabelText('Organização do GitHub') as HTMLInputElement).value).toBe('');
  });

  it('regra que revisa sozinho pergunta antes; nome torto não deixa enviar', async () => {
    const t = montar();
    await assentar();
    mudar(na(REGRAS).getByLabelText('Organização do GitHub'), 'a/b');
    expect(na(REGRAS).getByRole('alert').textContent).toContain('letras, dígitos e hífen');
    expect(na(REGRAS).queryByRole('button', { name: /Salvar a regra/ })).toBeNull();
    mudar(na(REGRAS).getByLabelText('Organização do GitHub'), 'acme');
    mudar(na(REGRAS).getByLabelText('O que o motor faz'), 'auto');
    await clicarEm(na(REGRAS), 'Salvar a regra de a organização acme: revisa sozinho');
    expect(na(REGRAS).getByRole('group', { name: 'Revisar sozinho a organização acme?' }).textContent).toContain('revisa e publica sozinho');
    expect(t.envios()).toEqual([]);
    await clicarEm(na(REGRAS), 'Salvar e revisar sozinho: a organização acme');
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'regra-review', user: 'farol-bot', organization: 'acme', mode: 'auto' }]]);
  });

  it('trocar o modo e remover uma regra; remover pergunta', async () => {
    const t = montar({ bruto: COM_REGRAS });
    await assentar();
    await clicarEm(na(REGRAS), 'Salvar a regra de @robo[bot] em biudtech: só no clique');
    await assentar();
    await clicarEm(na(REGRAS), 'Remover a regra de a organização biudtech');
    expect(na(REGRAS).getByRole('group', { name: 'Remover a regra de a organização biudtech?' })).toBeTruthy();
    await clicarEm(na(REGRAS), 'Remover a regra: a organização biudtech');
    await assentar();
    expect(t.envios()).toEqual([
      ['/api/accounts/edit', { tipo: 'regra-review', user: 'farol-bot', organization: 'biudtech', author: 'robo[bot]', mode: 'manual' }],
      ['/api/accounts/edit', { tipo: 'regra-review', user: 'farol-bot', organization: 'biudtech', mode: 'inherit' }],
    ]);
  });
});

describe('Sistema: padrões do time', () => {
  it('editar e salvar manda o texto inteiro a accounts/edit; a falha não perde o texto', async () => {
    let resposta: Resposta = REDE;
    const t = montar({ aoPostar: (rota) => (rota === '/api/accounts/edit' ? resposta : undefined) });
    await assentar();
    const campo = () => na(PADROES).getByLabelText('Texto dos padrões, um por linha') as HTMLTextAreaElement;
    mudar(campo(), 'Teste em todo endpoint.\nMigração tem volta.\n');
    expect(na(PADROES).getByText('43 de 6.000 caracteres que entram na revisão.')).toBeTruthy();
    await clicarEm(na(PADROES), 'Salvar os padrões do time de @farol-bot');
    await assentar();
    expect(t.envios()).toEqual([['/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { padroesRevisao: 'Teste em todo endpoint.\nMigração tem volta.' } }]]);
    expect(campo().value).toBe('Teste em todo endpoint.\nMigração tem volta.\n');
    expect(na(PADROES).getByText(/^Erro ao salvar/)).toBeTruthy();
    resposta = corpo({ ok: true, ignoradas: [], ignorados: [] });
    await clicarEm(na(PADROES), 'Salvar os padrões do time de @farol-bot');
    await assentar();
    expect(regiao().textContent).toContain('os padrões do time agora têm 2 padrões');
    t.trocar({ ...BRUTO, accounts: [{ ...CONTA, padroesRevisao: 'Teste em todo endpoint.\nMigração tem volta.' }] });
    expect(na(PADROES).getByText('Sem alteração por salvar.')).toBeTruthy();
    expect(resumoDe(PADROES).textContent).toBe('OK:Padrões do time2 padrões');
  });

  it('o trecho com cara de segredo aparece trocado, com o aviso', async () => {
    const t = montar({ bruto: { ...BRUTO, accounts: [{ ...CONTA, padroesRevisao: `Use ${TOKEN_DO_GITHUB} no teste.` }] } });
    await assentar();
    expect((na(PADROES).getByLabelText('Texto dos padrões, um por linha') as HTMLTextAreaElement).value).toBe('Use [segredo omitido] no teste.');
    expect(na(PADROES).getByText(/trecho com cara de credencial/)).toBeTruthy();
    expect(t.container.innerHTML).not.toContain(TOKEN_DO_GITHUB);
  });
});

describe('Sistema: ritmo da revisão', () => {
  it('intervalo, retomada e contestação, cada um com o efeito; salvar manda só o que mudou e confere', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config: { ...CONFIG, intervalSeconds: 600, autoPushback: false } }) : undefined) });
    await assentar();
    const intervalo = na(RITMO).getByLabelText('Checar o GitHub a cada') as HTMLSelectElement;
    expect([...intervalo.options].map((o) => o.textContent)).toEqual(['3 minutos', '5 minutos', '10 minutos', '15 minutos', '30 minutos', '1 hora']);
    expect(intervalo.value).toBe('300');
    expect((na(RITMO).getByLabelText('Retomar a sessão na rodada nova') as HTMLInputElement).checked).toBe(true);
    expect(na(RITMO).getByText(/Nada é publicado no PR por causa dela/)).toBeTruthy();
    mudar(intervalo, '600');
    act(() => { fireEvent.click(na(RITMO).getByLabelText('Analisar sozinho a contestação do autor')); });
    await clicarEm(na(RITMO), 'Salvar o ritmo da revisão');
    await assentar();
    expect(t.envios()).toEqual([['/api/settings', { intervalSeconds: 600, autoPushback: false }]]);
    expect(regiao().textContent).toContain('O motor gravou: checagem do GitHub: a cada 10 minutos; análise da contestação: desligada.');
  });

  it('valor do motor fora da lista aparece como opção, e gravado diferente é erro', async () => {
    montar({ bruto: { ...BRUTO, config: { ...CONFIG, intervalSeconds: 420 } }, aoPostar: (rota) => (rota === '/api/settings' ? corpo({ ok: true, ignoradas: [], config: { ...CONFIG, intervalSeconds: 420, reReviewResume: true } }) : undefined) });
    await assentar();
    expect((na(RITMO).getByLabelText('Checar o GitHub a cada') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('7 minutos (definido no motor)');
    act(() => { fireEvent.click(na(RITMO).getByLabelText('Retomar a sessão na rodada nova')); });
    await clicarEm(na(RITMO), 'Salvar o ritmo da revisão');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor gravou diferente do pedido: retomada na rodada nova ficou ligada, e o pedido era desligada.');
  });
});

describe('Sistema: quem está conectado', () => {
  const itens = () => within(na(SESSOES_PAREADAS).getByRole('list', { name: 'Sessões pareadas' })).getAllByRole('listitem');
  const cargas = (t: ReturnType<typeof montar>) => t.post.mock.calls.filter(([rota]) => rota === '/api/auth/sessions');

  it('pede a lista em POST /api/auth/sessions e mostra cada sessão, com a atual marcada', async () => {
    const t = montar();
    expect(na(SESSOES_PAREADAS).getByRole('status', { name: 'Resultado da lista de sessões' }).textContent).toBe('Carregando as sessões pareadas.');
    expect(resumoDe(SESSOES_PAREADAS).textContent).toBe('Sem dado ou desligado:Quem está conectadocarregando');
    await assentar();
    expect(cargas(t).map(([rota, enviado]) => [rota, enviado])).toEqual([['/api/auth/sessions', {}]]);
    expect(na(SESSOES_PAREADAS).getByRole('status', { name: 'Resultado da lista de sessões' }).textContent).toBe('2 sessões pareadas');
    const [atual, outra] = itens();
    expect(within(atual as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Sessão "Notebook"Este navegador');
    expect(atual?.textContent).toContain(`Criada em ${dataComAno(ATUAL.criadoEm)}`);
    expect(atual?.textContent).toContain(`usada pela última vez em ${dataComAno(ATUAL.ultimoUsoEm)}`);
    expect(within(atual as HTMLElement).getByRole('button').textContent).toBe('Sair');
    expect(within(outra as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe('Sessão "Celular"');
    expect(within(outra as HTMLElement).getByRole('button').textContent).toBe('Revogar');
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

  it('aceita: o botão diz Revogando… enquanto o motor responde, revoga pelo id, pede a lista de novo, e este navegador continua onde está', async () => {
    const resposta = adiada();
    let revogada = false;
    const t = montar({
      aoPostar: (rota) => {
        if (rota === '/api/auth/revoke') { revogada = true; return resposta.promessa; }
        return rota === '/api/auth/sessions' && revogada ? corpo({ ok: true, sessoes: [ATUAL] }) : undefined;
      },
    });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão "Celular"');
    await clicarEm(na(SESSOES_PAREADAS), 'Revogar a sessão: "Celular"');
    const ocupado = na(SESSOES_PAREADAS).getByRole('button', { name: /^Revogando…/ }) as HTMLButtonElement;
    expect(ocupado.disabled).toBe(true);
    expect(ocupado.textContent).toBe('Revogando…');
    await resposta.soltar(corpo({ ok: true, eraAtual: false }));
    expect(t.envios()).toEqual([['/api/auth/revoke', { id: OUTRA.id }]]);
    expect(regiao().textContent).toContain('O motor revogou a sessão "Celular": o token dela não vale mais.');
    expect(cargas(t)).toHaveLength(2);
    expect(itens()).toHaveLength(1);
    expect(t.esquecerSessao).not.toHaveBeenCalled();
  });

  it('Sair (a sessão atual) avisa que este navegador volta ao pareamento, e depois do aceite a tela vai de fato', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? corpo({ ok: true, eraAtual: true }) : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Sair deste navegador');
    const pergunta = na(SESSOES_PAREADAS).getByRole('group', { name: 'Sair deste navegador?' });
    expect(pergunta.textContent).toContain('esta tela volta ao pareamento assim que o motor aceitar');
    expect(t.esquecerSessao).not.toHaveBeenCalled();
    await clicarEm(na(SESSOES_PAREADAS), 'Sair e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(t.envios()).toEqual([['/api/auth/revoke', { id: ATUAL.id }]]);
    expect(t.esquecerSessao).toHaveBeenCalledTimes(1);
    expect(t.esquecerSessao).toHaveBeenCalledWith('revogada');
  });

  it('Sair cancelado, recusado ou sem resposta não leva ao pareamento', async () => {
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? corpo({ ok: false, code: 'sessao_inexistente' }) : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Sair deste navegador');
    await clicarEm(na(SESSOES_PAREADAS), 'Voltar sem enviar');
    expect(t.envios()).toEqual([]);
    await clicarEm(na(SESSOES_PAREADAS), 'Sair deste navegador');
    await clicarEm(na(SESSOES_PAREADAS), 'Sair e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(regiao().textContent).toContain('Erro: O motor não tem mais essa sessão: ela já foi revogada ou expirou. Atualize a lista.');
    expect(t.esquecerSessao).not.toHaveBeenCalled();

    cleanup();
    const semRede = montar({ aoPostar: (rota) => (rota === '/api/auth/revoke' ? REDE : undefined) });
    await assentar();
    await clicarEm(na(SESSOES_PAREADAS), 'Sair deste navegador');
    await clicarEm(na(SESSOES_PAREADAS), 'Sair e voltar ao pareamento: "Notebook" (este navegador)');
    await assentar();
    expect(semRede.esquecerSessao).not.toHaveBeenCalled();
  });

  it('falha ao carregar a lista é dita, e Atualizar a lista pede de novo', async () => {
    let falhar = true;
    const t = montar({ aoPostar: (rota) => (rota === '/api/auth/sessions' && falhar ? REDE : undefined) });
    await assentar();
    expect(na(SESSOES_PAREADAS).getByRole('alert').textContent).toBe('Erro: Não deu para falar com o motor (falha de rede).');
    expect(na(SESSOES_PAREADAS).queryByRole('list', { name: 'Sessões pareadas' })).toBeNull();
    expect(resumoDe(SESSOES_PAREADAS).textContent).toBe('Atenção:Quem está conectadoa lista não carregou');
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
    expect(na(SESSOES_PAREADAS).getByText(/O motor não listou sessão pareada.*não há sessão a encerrar/)).toBeTruthy();
    expect(resumoDe(SESSOES_PAREADAS).textContent).toBe('Sem dado ou desligado:Quem está conectadonenhuma');
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
    expect(s.getByText('farol.exemplo.com', { selector: 'dd' })).toBeTruthy();
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
    expect(screen.getByText('Aviso: há edição por salvar nesta tela (modelo e sessões). Trocar de assunto não a perde; trocar de aba do Farol a descarta sem perguntar.')).toBeTruthy();
    expect(resumoDe(AUTOMACAO).textContent).toContain('alteração por salvar');
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
