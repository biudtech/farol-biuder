// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pendencia } from '@/contratos/radar';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp, type RecadoNaTela } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { RespostaDeAcao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { Radar } from './Radar';
import { URL_DO_PR, pendencia } from './apoio-de-teste';

vi.mock('next/link', () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';
const ACEITE: Resultado<RespostaDeAcao> = { ok: true, dados: { ok: true } };
const decisoes = (pending: Pendencia[], resolved: unknown[] = [], ilegiveis = 0) => ({ pending, resolved, ilegiveis });
const pr = (key: string, extra: Record<string, unknown> = {}) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}`, ...extra });

function estado(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    status: 'idle',
    error: null,
    account: { user: 'revisora', tokenOk: true },
    lastCheckAt: Date.UTC(2026, 10, 16, 14, 32),
    nextCheckAt: Date.UTC(2026, 10, 16, 14, 35),
    buscasPausadas: [],
    queue: [],
    activeSessions: [],
    activity: {},
    headlessWaitingPrs: [],
    decisions: decisoes([]),
    ...extra,
  };
}

// Um app de mentira: o store de verdade e um `post` que o teste controla.
function montar(snapshot: Snapshot | null, resposta: Resultado<RespostaDeAcao> = ACEITE) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot });
  const post = vi.fn(async (rota: string, corpo: unknown) => { void rota; void corpo; return resposta; });
  const app = { store, cliente: { post }, dispensarRecados: () => store.trocar({ recados: [] }) } as unknown as App;
  render(<Radar app={app} />);
  return { store, post };
}

const regiao = () => screen.getByRole('status', { name: 'Resultado da última ação e avisos do motor' });
const clicar = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };
const titulos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const sub = () => screen.getByRole('heading', { level: 1, name: 'Radar' }).parentElement?.querySelector('p')?.textContent;
const recado = (n: number, tom: RecadoNaTela['tom'], texto: string): RecadoNaTela => ({ n, tom, texto });

// As pendências que a mesa mostrava: uma comum, uma esperando o CI e uma de commit novo.
const PENDENCIAS = [
  pendencia(),
  pendencia({ id: 'd2', key: 'dono/outro#3', esperaCi: { desde: 1, checks: [{ nome: 'ci', estado: 'pending' }] } }),
  pendencia({ id: 'd3', key: 'dono/velho#4', blockedKind: 'stale_head', blockedReason: 'commit novo' }),
];

describe('tela Radar: carga, topo e estados', () => {
  it('antes do primeiro estado mostra o esqueleto com a frase, e nenhuma seção nem botão', () => {
    montar(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Radar' })).toBeTruthy();
    expect(screen.getByText('Carregando o estado do motor.').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Revisar um PR')).toBeNull();
  });

  it('o topo conta o que está na tela: em análise e na fila (a espera de execução conta, o PR repetido não)', () => {
    montar(estado({
      queue: [pr('dono/repo#12'), pr('dono/livre#1'), pr('dono/mais#2')],
      activeSessions: [{ id: 'a1', keys: ['dono/repo#12'], pr: { key: 'dono/repo#12' } }],
      headlessWaitingPrs: [pr('dono/livre#1'), pr('dono/espera#7')],
    }));
    expect(sub()).toBe('1 em análise · 3 na fila');
  });

  it('tudo em dia: o símbolo da BIUD, "Tudo revisado" e a fila vazia, sem as seções vazias', () => {
    const { store } = montar(estado({ nextCheckAt: null }));
    expect(sub()).toBe('0 em análise · 0 na fila');
    const cartao = screen.getByRole('region', { name: 'Tudo revisado' });
    expect(cartao.querySelector('img')?.getAttribute('src')).toBe('/biud-simbolo.svg');
    expect(within(cartao).getByText('Nenhum PR na fila.')).toBeTruthy();
    expect(titulos()).toEqual(['Tudo revisado', 'Postadas hoje']);
    // a próxima checagem aparece quando o motor manda
    act(() => { store.trocar({ snapshot: estado({ nextCheckAt: Date.now() + 60000 }) }); });
    expect(within(screen.getByRole('region', { name: 'Tudo revisado' })).getByText(/^Nenhum PR na fila\. A próxima checagem é (às|em) /)).toBeTruthy();
  });

  it('com algo em curso, as seções vêm na ordem da tela', () => {
    montar(estado({ queue: [pr('dono/repo#12')] }));
    expect(titulos()).toEqual(['Em análise', 'Fila', 'Postadas hoje']);
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Avisos do motor' })).toBeNull();
    expect(regiao().textContent).toBe('');
  });

  it('primeira checagem em curso: não diz que está tudo em dia, e a fila diz que ainda não terminou', () => {
    montar(estado({ lastCheckAt: null, nextCheckAt: null, status: 'checking' }));
    expect(screen.queryByText('Tudo revisado')).toBeNull();
    expect(screen.getByText('A primeira checagem ainda não terminou.')).toBeTruthy();
    expect(screen.getByText('Checando agora.')).toBeTruthy();
  });

  it('primeira checagem que falhou: o erro traz o Checar agora, e a fila não diz que não há nada', async () => {
    const t = montar(estado({ lastCheckAt: null, nextCheckAt: null, status: 'error', error: 'gh: timeout' }));
    const aviso = within(screen.getByRole('list', { name: 'Avisos do motor' })).getByRole('listitem');
    expect(aviso.textContent).toMatch(/^Erro: A última checagem falhou: gh: timeout/);
    expect(screen.getByText('A primeira checagem falhou: ainda não dá para dizer o que está na fila.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(aviso).getByRole('button', { name: 'Checar agora' })); });
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/check', {}]);
  });

  it('motor sem conta, sem token e com buscas pausadas aparecem como aviso, com o tipo dito em texto', () => {
    montar(estado({ account: { user: '', tokenOk: false } }));
    expect(within(screen.getByRole('list', { name: 'Avisos do motor' })).getByText(/sem conta do GitHub/)).toBeTruthy();
    cleanup();
    montar(estado({ account: { user: 'revisora', tokenOk: false }, status: 'error', error: 'gh: timeout', buscasPausadas: [{ conta: 'revisora', ate: Date.UTC(2026, 10, 16, 15) }] }));
    const avisos = within(screen.getByRole('list', { name: 'Avisos do motor' })).getAllByRole('listitem');
    expect(avisos.map((a) => a.querySelector('span')?.textContent)).toEqual([
      expect.stringMatching(/^Erro: A conta revisora está sem token no gh/),
      expect.stringMatching(/^Erro: A última checagem falhou: gh: timeout/),
      expect.stringMatching(/^Aviso: Buscas pausadas/),
    ]);
  });

  it('estado que chega sem a chave de uma seção diz isso, e a tela desenha', () => {
    montar({ status: 'idle', activeSessions: [] });
    expect(within(screen.getByRole('list', { name: 'Avisos do motor' })).getByText(/chegou sem a fila, as revisões postadas/)).toBeTruthy();
    expect(titulos()).toEqual(['Em análise', 'Fila', 'Postadas hoje']);
  });

  it('PR com sessão em curso não aparece também na fila, e o que espera vaga e está na fila aparece uma vez', () => {
    montar(estado({
      queue: [pr('dono/repo#12', { title: 'Em sessão' }), pr('dono/livre#1', { title: 'Livre' })],
      activeSessions: [{ id: 'a1', label: 'Revisão automática de dono/repo#12', keys: ['dono/repo#12'], pr: { key: 'dono/repo#12' } }],
      headlessWaitingPrs: [pr('dono/livre#1'), pr('dono/espera#7', { title: 'Esperando' })],
    }));
    const fila = screen.getByRole('region', { name: 'Fila' });
    expect([...fila.querySelectorAll('summary')].map((s) => s.querySelector('span')?.textContent)).toEqual(['Livre', 'Esperando']);
    expect(screen.getAllByRole('button', { name: /^Revisar agora / })).toHaveLength(1);
  });
});

describe('tela Radar: sem mesa e sem espera do CI', () => {
  it('pendências no snapshot não aparecem: nem "Precisa de você", nem "Esperando o CI", nem botão de decisão', () => {
    montar(estado({ decisions: decisoes(PENDENCIAS, [], 2) }));
    expect(screen.queryByText(/Precisa de você/)).toBeNull();
    expect(screen.queryByText(/Esperando o CI/)).toBeNull();
    expect(screen.queryByText(/não lê; veja o log/)).toBeNull();
    expect(screen.queryByText('Corrige o cálculo')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Aprovar|Pedir mudanças|Comentar|Pular)\b/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Aprovar|Pedir mudanças|Pular/);
  });

  it('com pendência guardada sem publicar não diz "Tudo revisado": uma linha conta e leva ao Histórico, sem botão', () => {
    montar(estado({ decisions: decisoes(PENDENCIAS) }));
    expect(screen.queryByText('Tudo revisado')).toBeNull();
    const linha = screen.getByText('3 revisões sem nada postado').parentElement as HTMLElement;
    expect(within(linha).getByRole('link', { name: 'Ver no Histórico' }).getAttribute('href')).toBe('/historico');
    expect(within(linha).queryByRole('button')).toBeNull();
  });

  it('uma pendência só fala no singular; sem pendência a linha não aparece e o tudo em dia volta', () => {
    montar(estado({ decisions: decisoes([pendencia()]) }));
    expect(screen.getByText('1 revisão sem nada postado')).toBeTruthy();
    cleanup();
    montar(estado());
    expect(screen.queryByText(/sem nada postado/)).toBeNull();
    expect(screen.getByText('Tudo revisado')).toBeTruthy();
  });

  it('nenhum clique da tela vai a POST /api/decide', async () => {
    const t = montar(estado({ decisions: decisoes(PENDENCIAS), queue: [pr('dono/repo#12')], activeSessions: [{ id: 'a1', cancellable: true, pr: { key: 'dono/x#1' } }] }));
    for (const botao of screen.getAllByRole('button')) {
      await act(async () => { fireEvent.click(botao); });
    }
    expect(t.post.mock.calls.map(([rota]) => rota)).not.toContain('/api/decide');
  });
});

describe('tela Radar: Postadas hoje', () => {
  it('lista só as publicadas de hoje do snapshot, com o link para o Histórico', () => {
    const agora = Date.now();
    montar(estado({
      decisions: decisoes([], [
        { id: 'r1', key: 'dono/repo#12', resolvedAt: agora, action: 'approve', status: 'auto_approved', pr: { title: 'Aprovada hoje' } },
        { id: 'r2', key: 'dono/repo#13', resolvedAt: agora, action: 'skip', status: 'skipped', pr: { title: 'Pulada hoje' } },
        { id: 'r3', key: 'dono/repo#14', resolvedAt: agora - 3 * 86400000, action: 'approve', pr: { title: 'Aprovada antes' } },
      ]),
    }));
    const secao = screen.getByRole('region', { name: 'Postadas hoje' });
    expect([...secao.querySelectorAll('summary')].map((s) => s.textContent)).toEqual([expect.stringContaining('Aprovada hoje')]);
    expect(within(secao).getByRole('link', { name: 'Ver histórico' }).getAttribute('href')).toBe('/historico');
    expect(within(secao).getByRole('link', { name: 'Ver a revisão de dono/repo#12' }).getAttribute('href')).toBe('/historico?id=r1&pr=dono%2Frepo%2312');
  });
});

describe('tela Radar: ações', () => {
  it('Revisar um PR abre o campo, e o pedido manda a URL canônica do PR', async () => {
    const t = montar(estado());
    const gaveta = screen.getByText('Revisar um PR').closest('details') as HTMLDetailsElement;
    expect(gaveta.open).toBe(false);
    fireEvent.click(screen.getByText('Revisar um PR'));
    expect(gaveta.open).toBe(true);
    fireEvent.change(screen.getByLabelText('URL do PR'), { target: { value: `${URL_DO_PR}/files?w=1#x` } });
    await clicar('Revisar');
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: [URL_DO_PR] }]);
    // aceito: o painel fecha, o foco volta ao botão e o resultado sai na região de status
    expect(gaveta.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('Revisar um PR'));
    expect(regiao().textContent).toMatch(/^O motor aceitou o pedido: .*PR #12 de dono\/repo/);
  });

  it('envio: o POST sai pelo cliente, o botão diz Enviando e fica desabilitado, a região viva anuncia, e depois vem o resultado', async () => {
    let soltar!: (r: Resultado<RespostaDeAcao>) => void;
    const t = montar(estado({ queue: [pr('dono/repo#12')] }));
    t.post.mockImplementationOnce(() => new Promise<Resultado<RespostaDeAcao>>((resolver) => { soltar = resolver; }));
    await clicar(`Revisar agora ${NOME}`);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: [URL_DO_PR] }]);
    const enviando = screen.getByRole('button', { name: `Enviando: Revisar agora ${NOME}` }) as HTMLButtonElement;
    expect(enviando.disabled).toBe(true);
    expect((screen.getByRole('button', { name: `Ignorar ${NOME}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(regiao().getAttribute('aria-live')).toBe('polite');
    expect(regiao().textContent).toBe(`Enviando: Revisar agora ${NOME}.`);
    // clique dobrado não manda outro pedido
    fireEvent.click(enviando);
    expect(t.post).toHaveBeenCalledTimes(1);

    await act(async () => { soltar(ACEITE); });
    expect(regiao().textContent).toContain(`O motor aceitou o pedido: revisar agora ${NOME}.`);
    expect(regiao().textContent).not.toContain('Enviando');
    expect((screen.getByRole('button', { name: `Revisar agora ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('nada de atualização otimista: o PR só sai da fila quando o snapshot do motor muda', async () => {
    const t = montar(estado({ queue: [pr('dono/repo#12')] }));
    await clicar(`Revisar agora ${NOME}`);
    expect(sub()).toBe('0 em análise · 1 na fila');
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(sub()).toBe('0 em análise · 0 na fila');
    expect(regiao().textContent).toContain('O motor aceitou o pedido');
  });

  it('os avisos do motor entram como texto, com o erro dito em palavra, e Dispensar tira tudo', async () => {
    const t = montar(estado());
    act(() => {
      t.store.trocar({ recados: [recado(1, 'ok', '<b>aprovado</b>'), recado(2, 'erro', 'Falha ao postar em a/b#2: rede'), recado(3, 'info', 'três')] });
    });
    const linhas = [...regiao().querySelectorAll('p')];
    expect(linhas.map((p) => p.textContent)).toEqual(['Aviso do motor: <b>aprovado</b>', 'Erro avisado pelo motor: Falha ao postar em a/b#2: rede', 'Aviso do motor: três']);
    expect(regiao().querySelector('b')).toBeNull();
    await clicar('Dispensar');
    expect(regiao().textContent).toBe('');
    expect(t.store.ler().recados).toEqual([]);
  });

  it('recusa: a mensagem é a do código que o motor mandou, dita como erro', async () => {
    montar(estado({ queue: [pr('dono/repo#12')] }), { ok: true, dados: { ok: false, blocked: 'instancia_isolada', error: 'isolada' } });
    await clicar(`Revisar agora ${NOME}`);
    expect(regiao().textContent).toContain('Erro: Este motor é uma instância isolada e não escreve no GitHub.');
    expect(regiao().querySelector('[data-tom="erro"]')).toBeTruthy();
  });

  it('rede: diz que não deu para falar com o motor', async () => {
    montar(estado({ queue: [pr('dono/repo#12')] }), { ok: false, falha: 'rede', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(regiao().textContent).toMatch(/^Erro: Não deu para falar com o motor \(falha de rede\)/);
    expect((screen.getByRole('button', { name: `Revisar agora ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('chamada abortada pela saída da sessão não vira mensagem', async () => {
    montar(estado({ queue: [pr('dono/repo#12')] }), { ok: false, falha: 'cancelado', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(regiao().textContent).toBe('');
  });

  it('o resultado pode ser dispensado', async () => {
    montar(estado());
    await clicar('Checar agora');
    expect(regiao().textContent).toContain('O motor aceitou o pedido: checar agora.');
    await clicar('Dispensar');
    expect(regiao().textContent).toBe('');
  });

  it('Cancelar a sessão manda o id dela, depois da confirmação, e o foco vai à região do resultado', async () => {
    const sessao = { id: 'a1', label: 'Revisão automática de dono/repo#12', startedAt: 1, cancellable: true, pr: { key: 'dono/repo#12', url: URL_DO_PR } };
    const t = montar(estado({ activeSessions: [sessao], activity: { a1: [{ t: 1, k: 'tool', text: 'lendo o diff' }] } }));
    expect(screen.getByText('lendo o diff')).toBeTruthy();
    await clicar(`Cancelar a sessão de ${NOME}`);
    expect(t.post).not.toHaveBeenCalled();
    await clicar(`Cancelar a sessão: a sessão de ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/cancel', { id: 'a1' }]);
    expect(document.activeElement).toBe(regiao());
  });

  it('a sessão muda sob a pergunta (o motor não deixa mais cancelar): a pergunta fecha e nada é enviado', async () => {
    const sessao = { id: 'a1', cancellable: true, pr: { key: 'dono/repo#12', url: URL_DO_PR } };
    const t = montar(estado({ activeSessions: [sessao] }));
    await clicar(`Cancelar a sessão de ${NOME}`);
    act(() => { t.store.trocar({ snapshot: estado({ activeSessions: [{ ...sessao, cancellable: false }] }) }); });
    expect(screen.queryByRole('button', { name: `Cancelar a sessão: a sessão de ${NOME}` })).toBeNull();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('Ignorar aceito leva o PR aos ignorados quando ele sai da fila, e Restaurar o tira de lá', async () => {
    const t = montar(estado({ queue: [pr('dono/repo#12')] }));
    await clicar(`Ignorar ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/ignore', { key: 'dono/repo#12' }]);
    // enquanto o motor não tira o PR da fila, ele continua lá e não aparece como ignorado
    expect(screen.queryByRole('heading', { level: 2, name: 'Ignorados' })).toBeNull();
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados' })).toBeTruthy();
    await clicar(`Restaurar ${NOME}`);
    expect(t.post.mock.calls[1]?.slice(0, 2)).toEqual(['/api/restore', { key: 'dono/repo#12' }]);
    expect(screen.queryByRole('heading', { level: 2, name: 'Ignorados' })).toBeNull();
  });

  it('Ignorar recusado não cria ignorado', async () => {
    const t = montar(estado({ queue: [pr('dono/repo#12')] }), { ok: false, falha: 'recusado', status: 403 });
    await clicar(`Ignorar ${NOME}`);
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.queryByRole('heading', { level: 2, name: 'Ignorados' })).toBeNull();
    expect(regiao().textContent).toMatch(/HTTP 403/);
  });
});
