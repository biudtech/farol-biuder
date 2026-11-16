// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { RespostaDeAcao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { Radar } from './Radar';
import { URL_DO_PR, pendencia } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';
const ACEITE: Resultado<RespostaDeAcao> = { ok: true, dados: { ok: true } };

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
    decisions: { pending: [], resolved: [] },
    ...extra,
  };
}

// Um app de mentira: o store de verdade e um `post` que o teste controla.
function montar(snapshot: Snapshot | null, resposta: Resultado<RespostaDeAcao> = ACEITE) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareado', snapshot });
  const post = vi.fn(async (rota: string, corpo: unknown) => { void rota; void corpo; return resposta; });
  const app = { store, cliente: { post } } as unknown as App;
  render(<Radar app={app} />);
  return { store, post };
}

const resultado = () => screen.getByRole('status', { name: 'Resultado da última ação' });
const clicar = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: nome })); }); };

describe('tela Radar: carga, avisos e blocos', () => {
  it('antes do primeiro estado mostra carregando, e nenhum bloco', () => {
    montar(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Radar' })).toBeTruthy();
    expect(screen.getByText('Carregando o estado do motor.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com o estado, os blocos vêm na ordem da tela, cada um com a linha de vazio', () => {
    montar(estado());
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Precisa de você (0)', 'Analisando agora (0)', 'Esperando o CI (0)', 'Fila (0)', 'Ignorados (0)',
    ]);
    expect(screen.getByText('Nenhuma revisão esperando a sua decisão.')).toBeTruthy();
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão esperando o CI.')).toBeTruthy();
    expect(screen.getByText('Nenhum PR na fila.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Avisos do motor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Checar agora' })).toBeTruthy();
    expect(resultado().textContent).toBe('');
  });

  it('a pendência que espera o CI vai para o bloco dela, e a comum fica em Precisa de você', () => {
    montar(estado({ decisions: { pending: [pendencia(), pendencia({ id: 'd2', key: 'dono/outro#3', esperaCi: { desde: 1, checks: [] } })], resolved: [] } }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).slice(0, 3)).toEqual(['Precisa de você (1)', 'Analisando agora (0)', 'Esperando o CI (1)']);
    expect(screen.getByRole('button', { name: `Aprovar ${NOME}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar PR #3 de dono/outro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pular PR #3 de dono/outro' })).toBeTruthy();
  });

  it('motor sem conta e motor sem token do gh aparecem como aviso', () => {
    montar(estado({ account: { user: '', tokenOk: false } }));
    expect(within(screen.getByRole('list', { name: 'Avisos do motor' })).getByText(/sem conta do GitHub/)).toBeTruthy();
    cleanup();
    montar(estado({ account: { user: 'revisora', tokenOk: false }, status: 'error', error: 'gh: timeout' }));
    const avisos = within(screen.getByRole('list', { name: 'Avisos do motor' })).getAllByRole('listitem');
    expect(avisos.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/A conta revisora está sem token no gh/),
      expect.stringMatching(/A última checagem falhou: gh: timeout/),
    ]);
  });

  it('estado que chega sem a chave de um bloco diz isso, e a tela desenha', () => {
    montar({ status: 'idle', activeSessions: [] });
    expect(within(screen.getByRole('list', { name: 'Avisos do motor' })).getByText(/chegou sem as pendências, a fila/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5);
  });

  it('antes da primeira checagem, a fila vazia não diz que não há nada', () => {
    montar(estado({ lastCheckAt: null, nextCheckAt: null, status: 'checking' }));
    expect(screen.getByText('A primeira checagem ainda não terminou.')).toBeTruthy();
    expect(screen.getByText('Checando agora.')).toBeTruthy();
  });
});

describe('tela Radar: ações', () => {
  it('envio: o POST sai pelo cliente, o botão diz Enviando e fica desabilitado, e o resultado aparece', async () => {
    let soltar!: (r: Resultado<RespostaDeAcao>) => void;
    const t = montar(estado({ decisions: { pending: [pendencia()], resolved: [] } }));
    t.post.mockImplementationOnce(() => new Promise<Resultado<RespostaDeAcao>>((resolver) => { soltar = resolver; }));
    await clicar(`Pular ${NOME}`);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/decide', { id: 'd1', action: 'skip' }]);
    const enviando = screen.getByRole('button', { name: `Enviando: Pular ${NOME}` }) as HTMLButtonElement;
    expect(enviando.disabled).toBe(true);
    expect((screen.getByRole('button', { name: `Aprovar ${NOME}` }) as HTMLButtonElement).disabled).toBe(true);
    // clique dobrado não manda outro pedido
    fireEvent.click(enviando);
    expect(t.post).toHaveBeenCalledTimes(1);

    await act(async () => { soltar(ACEITE); });
    expect(resultado().textContent).toContain('O motor aceitou: pular PR #12 de dono/repo. Nada foi publicado.');
    expect((screen.getByRole('button', { name: `Pular ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('nada de atualização otimista: o item só sai quando o snapshot do motor muda', async () => {
    const t = montar(estado({ decisions: { pending: [pendencia()], resolved: [] } }));
    await clicar(`Pular ${NOME}`);
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (1)' })).toBeTruthy();
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (0)' })).toBeTruthy();
    // o resultado da ação continua dito na tela
    expect(resultado().textContent).toContain('O motor aceitou');
  });

  it('recusa: a mensagem é a do código que o motor mandou, e a pendência continua na mesa', async () => {
    montar(estado({ decisions: { pending: [pendencia()], resolved: [] } }), { ok: true, dados: { ok: false, blocked: 'pr_fechado', error: 'PR mergeado, então o review não foi postado' } });
    await clicar(`Comentar ${NOME}`);
    expect(resultado().textContent).toContain('O PR já foi mergeado ou fechado: o review não foi publicado.');
    expect(resultado().querySelector('[data-tom="erro"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: `Comentar ${NOME}` })).toBeTruthy();
  });

  it('rede: diz que não deu para falar com o motor', async () => {
    montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }), { ok: false, falha: 'rede', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(resultado().textContent).toMatch(/Não deu para falar com o motor \(falha de rede\)/);
    expect((screen.getByRole('button', { name: `Revisar agora ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('chamada abortada pela saída da sessão não vira mensagem', async () => {
    montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }), { ok: false, falha: 'cancelado', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(resultado().textContent).toBe('');
  });

  it('confirmação: Aprovar só envia depois do sim, com o que vai ser publicado dito na pergunta', async () => {
    const t = montar(estado({ decisions: { pending: [pendencia()], resolved: [] } }));
    await clicar(`Aprovar ${NOME}`);
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Aprovar ${NOME}?` }).textContent).toMatch(/APPROVE.*PR #12 de dono\/repo/);
    await clicar(`Publicar a aprovação: ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/decide', { id: 'd1', action: 'approve' }]);
    expect(resultado().textContent).toContain('O motor aceitou: aprovar PR #12 de dono/repo.');
  });

  it('confirmação cancelada: nada é enviado e nada é dito', async () => {
    const t = montar(estado({ decisions: { pending: [pendencia()], resolved: [] } }));
    await clicar(`Pedir mudanças ${NOME}`);
    await clicar('Voltar sem enviar');
    expect(t.post).not.toHaveBeenCalled();
    expect(resultado().textContent).toBe('');
    expect(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` })).toBeTruthy();
  });

  it('o resultado pode ser dispensado, e a ação seguinte troca a mensagem', async () => {
    montar(estado());
    await clicar('Checar agora');
    expect(resultado().textContent).toContain('O motor aceitou: checar agora.');
    await clicar('Dispensar');
    expect(resultado().textContent).toBe('');
  });

  it('Ignorar aceito leva o PR ao bloco dos ignorados quando ele sai da fila, e Restaurar o tira de lá', async () => {
    const t = montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }));
    await clicar(`Ignorar ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/ignore', { key: 'dono/repo#12' }]);
    // enquanto o motor não tira o PR da fila, ele continua lá e não aparece como ignorado
    expect(screen.getByRole('heading', { level: 2, name: 'Fila (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados (0)' })).toBeTruthy();
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados (1)' })).toBeTruthy();
    await clicar(`Restaurar ${NOME}`);
    expect(t.post.mock.calls[1]?.slice(0, 2)).toEqual(['/api/restore', { key: 'dono/repo#12' }]);
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados (0)' })).toBeTruthy();
  });

  it('Ignorar recusado não cria ignorado', async () => {
    const t = montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }), { ok: false, falha: 'recusado', status: 403 });
    await clicar(`Ignorar ${NOME}`);
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Ignorados (0)' })).toBeTruthy();
    expect(resultado().textContent).toMatch(/HTTP 403/);
  });

  it('Cancelar a sessão manda o id dela, depois da confirmação', async () => {
    const sessao = { id: 'a1', label: 'Revisão automática de dono/repo#12', startedAt: 1, cancellable: true, pr: { key: 'dono/repo#12', url: URL_DO_PR } };
    const t = montar(estado({ activeSessions: [sessao], activity: { a1: [{ t: 1, k: 'tool', text: 'lendo o diff' }] } }));
    expect(screen.getByText('lendo o diff')).toBeTruthy();
    await clicar(`Cancelar a sessão de ${NOME}`);
    await clicar(`Cancelar a sessão: a sessão de ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/cancel', { id: 'a1' }]);
  });
});
