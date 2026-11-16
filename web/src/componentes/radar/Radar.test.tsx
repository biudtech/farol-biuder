// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pendencia } from '@/contratos/radar';
import type { Snapshot } from '@/contratos/snapshot';
import { ESTADO_INICIAL, type App, type EstadoDoApp, type RecadoNaTela } from '@/estado/app';
import { criarStore } from '@/estado/store';
import type { RespostaDeAcao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { Radar } from './Radar';
import { URL_DO_PR, pendencia } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';
const ACEITE: Resultado<RespostaDeAcao> = { ok: true, dados: { ok: true } };
const decisoes = (pending: Pendencia[], ilegiveis = 0) => ({ pending, resolved: [], ilegiveis });

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
const recado = (n: number, tom: RecadoNaTela['tom'], texto: string): RecadoNaTela => ({ n, tom, texto });

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
    expect(titulos()).toEqual(['Precisa de você (0)', 'Analisando agora (0)', 'Esperando o CI (0)', 'Fila (0)', 'Ignorados (0)']);
    expect(screen.getByText('Nenhuma revisão esperando a sua decisão.')).toBeTruthy();
    expect(screen.getByText('Nenhuma sessão em curso.')).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão esperando o CI.')).toBeTruthy();
    expect(screen.getByText('Nenhum PR na fila.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Avisos do motor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Checar agora' })).toBeTruthy();
    expect(regiao().textContent).toBe('');
  });

  it('a pendência que espera o CI vai para o bloco dela, e a comum fica em Precisa de você', () => {
    montar(estado({ decisions: decisoes([pendencia(), pendencia({ id: 'd2', key: 'dono/outro#3', esperaCi: { desde: 1, checks: [] } })]) }));
    expect(titulos().slice(0, 3)).toEqual(['Precisa de você (1)', 'Analisando agora (0)', 'Esperando o CI (1)']);
    expect(screen.getByRole('button', { name: `Aprovar ${NOME}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar PR #3 de dono/outro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pular PR #3 de dono/outro' })).toBeTruthy();
  });

  it('pendência que a borda não conseguiu ler aparece como aviso, e o título não diz zero', () => {
    montar(estado({ decisions: decisoes([], 1) }));
    expect(titulos()[0]).toBe('Precisa de você (0, e mais 1 que esta tela não lê)');
    expect(screen.getByText(/1 pendência\(s\) chegaram em formato que esta tela não lê; veja o log do navegador\./)).toBeTruthy();
    expect(screen.queryByText('Nenhuma revisão esperando a sua decisão.')).toBeNull();
  });

  it('motor sem conta e motor sem token do gh aparecem como aviso, com o tipo dito em texto', () => {
    montar(estado({ account: { user: '', tokenOk: false } }));
    expect(within(screen.getByRole('list', { name: 'Avisos do motor' })).getByText(/sem conta do GitHub/)).toBeTruthy();
    cleanup();
    montar(estado({ account: { user: 'revisora', tokenOk: false }, status: 'error', error: 'gh: timeout', buscasPausadas: [{ conta: 'revisora', ate: Date.UTC(2026, 10, 16, 15) }] }));
    const avisos = within(screen.getByRole('list', { name: 'Avisos do motor' })).getAllByRole('listitem');
    expect(avisos.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/^Erro: A conta revisora está sem token no gh/),
      expect.stringMatching(/^Erro: A última checagem falhou: gh: timeout/),
      expect.stringMatching(/^Aviso: Buscas pausadas/),
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

  it('PR com sessão em curso não aparece também na fila, e o que espera com pendência não aparece duas vezes', () => {
    const pr = (key: string) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });
    montar(estado({
      queue: [pr('dono/repo#12'), pr('dono/livre#1')],
      activeSessions: [{ id: 'a1', label: 'Revisão automática de dono/repo#12', keys: ['dono/repo#12'], pr: { key: 'dono/repo#12' } }],
      headlessWaitingPrs: [pr('dono/livre#1'), pr('dono/outro#3'), pr('dono/espera#7')],
      decisions: decisoes([pendencia({ id: 'd2', key: 'dono/outro#3' })]),
    }));
    expect(titulos()).toEqual(['Precisa de você (1)', 'Analisando agora (1)', 'Esperando o CI (0)', 'Fila (2)', 'Ignorados (0)']);
    const fila = screen.getByRole('heading', { level: 2, name: 'Fila (2)' }).closest('section') as HTMLElement;
    expect(within(fila).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['dono/livre#1 (abre em nova aba)', 'dono/espera#7 (abre em nova aba)']);
    expect(screen.getAllByRole('button', { name: /^Revisar agora / })).toHaveLength(1);
  });
});

describe('tela Radar: ações', () => {
  it('envio: o POST sai pelo cliente, o botão diz Enviando e fica desabilitado, a região viva anuncia, e depois vem o resultado', async () => {
    let soltar!: (r: Resultado<RespostaDeAcao>) => void;
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    t.post.mockImplementationOnce(() => new Promise<Resultado<RespostaDeAcao>>((resolver) => { soltar = resolver; }));
    await clicar(`Pular ${NOME}`);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/decide', { id: 'd1', action: 'skip' }]);
    const enviando = screen.getByRole('button', { name: `Enviando: Pular ${NOME}` }) as HTMLButtonElement;
    expect(enviando.disabled).toBe(true);
    expect((screen.getByRole('button', { name: `Aprovar ${NOME}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(regiao().getAttribute('aria-live')).toBe('polite');
    expect(regiao().textContent).toBe(`Enviando: Pular ${NOME}.`);
    // clique dobrado não manda outro pedido
    fireEvent.click(enviando);
    expect(t.post).toHaveBeenCalledTimes(1);

    await act(async () => { soltar(ACEITE); });
    expect(regiao().textContent).toContain(`O motor aceitou o pedido: pular ${NOME}. O desfecho vem no aviso do motor.`);
    expect(regiao().textContent).not.toContain('Enviando');
    expect((screen.getByRole('button', { name: `Pular ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('nada de atualização otimista: o item só sai quando o snapshot do motor muda', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    await clicar(`Pular ${NOME}`);
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (1)' })).toBeTruthy();
    act(() => { t.store.trocar({ snapshot: estado() }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (0)' })).toBeTruthy();
    // o resultado da ação continua dito na tela
    expect(regiao().textContent).toContain('O motor aceitou o pedido');
  });

  it('o desfecho de verdade vem do aviso do motor: "já havia um APPROVE seu" aparece, e a tela não afirma publicação', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    await clicar(`Aprovar ${NOME}`);
    await clicar(`Publicar a aprovação: ${NOME}`);
    expect(regiao().textContent).not.toMatch(/publicad|postad/i);
    act(() => { t.store.trocar({ recados: [recado(1, 'info', 'dono/repo#12: já havia um APPROVE seu neste PR; não postei de novo.')] }); });
    expect(regiao().textContent).toContain('Aviso do motor: dono/repo#12: já havia um APPROVE seu neste PR; não postei de novo.');
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

  it('recusa: a mensagem é a do código que o motor mandou, dita como erro, e a pendência continua na mesa', async () => {
    montar(estado({ decisions: decisoes([pendencia()]) }), { ok: true, dados: { ok: false, blocked: 'pr_fechado', error: 'PR mergeado, então o review não foi postado' } });
    await clicar(`Comentar ${NOME}`);
    await clicar(`Publicar o comentário: ${NOME}`);
    expect(regiao().textContent).toContain('Erro: O PR já foi mergeado ou fechado: o review não foi publicado.');
    expect(regiao().querySelector('[data-tom="erro"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: `Comentar ${NOME}` })).toBeTruthy();
  });

  it('rede: diz que não deu para falar com o motor', async () => {
    montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }), { ok: false, falha: 'rede', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(regiao().textContent).toMatch(/^Erro: Não deu para falar com o motor \(falha de rede\)/);
    expect((screen.getByRole('button', { name: `Revisar agora ${NOME}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('chamada abortada pela saída da sessão não vira mensagem', async () => {
    montar(estado({ queue: [{ key: 'dono/repo#12', url: URL_DO_PR }] }), { ok: false, falha: 'cancelado', status: 0 });
    await clicar(`Revisar agora ${NOME}`);
    expect(regiao().textContent).toBe('');
  });

  it('confirmação: Aprovar só envia depois do sim, e o foco vai à região do resultado, não ao corpo da página', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    await clicar(`Aprovar ${NOME}`);
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Aprovar ${NOME}?` }).textContent).toMatch(/APPROVE.*PR #12 de dono\/repo/);
    await clicar(`Publicar a aprovação: ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/decide', { id: 'd1', action: 'approve' }]);
    expect(document.activeElement).toBe(regiao());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Enter repetido na confirmação manda um POST só', async () => {
    let soltar!: (r: Resultado<RespostaDeAcao>) => void;
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    t.post.mockImplementation(() => new Promise<Resultado<RespostaDeAcao>>((resolver) => { soltar = resolver; }));
    await clicar(`Aprovar ${NOME}`);
    const confirmar = screen.getByRole('button', { name: `Publicar a aprovação: ${NOME}` });
    // o Enter num botão chega como clique; três seguidos, sem esperar o desenho
    await act(async () => {
      fireEvent.click(confirmar);
      fireEvent.click(confirmar);
      fireEvent.click(confirmar);
    });
    expect(t.post).toHaveBeenCalledTimes(1);
    // e o botão de origem, que voltou desabilitado, também não manda outro
    fireEvent.click(screen.getByRole('button', { name: `Enviando: Aprovar ${NOME}` }));
    expect(t.post).toHaveBeenCalledTimes(1);
    await act(async () => { soltar(ACEITE); });
    expect(t.post).toHaveBeenCalledTimes(1);
  });

  it('confirmação cancelada: nada é enviado e nada é dito', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    await clicar(`Pedir mudanças ${NOME}`);
    await clicar('Voltar sem enviar');
    expect(t.post).not.toHaveBeenCalled();
    expect(regiao().textContent).toBe('');
    expect(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` })).toBeTruthy();
  });

  it('a pendência muda sob a pergunta (chegou commit novo): a pergunta fecha e nada é enviado', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia()]) }));
    await clicar(`Aprovar ${NOME}`);
    act(() => { t.store.trocar({ snapshot: estado({ decisions: decisoes([pendencia({ blockedKind: 'stale_head', blockedReason: 'commit novo' })]) }) }); });
    expect(screen.queryByRole('button', { name: `Publicar a aprovação: ${NOME}` })).toBeNull();
    expect(screen.getByText(/A pergunta foi fechada/)).toBeTruthy();
    expect(t.post).not.toHaveBeenCalled();
  });

  it('o resultado pode ser dispensado', async () => {
    montar(estado());
    await clicar('Checar agora');
    expect(regiao().textContent).toContain('O motor aceitou o pedido: checar agora.');
    await clicar('Dispensar');
    expect(regiao().textContent).toBe('');
  });

  it('Pular em Esperando o CI pergunta antes, dizendo o que se perde', async () => {
    const t = montar(estado({ decisions: decisoes([pendencia({ esperaCi: { desde: 1, checks: [] } })]) }));
    await clicar(`Pular ${NOME}`);
    expect(t.post).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: `Pular ${NOME}?` }).textContent).toMatch(/descarta a aprovação que sairia sozinha/);
    await clicar(`Pular e descartar a espera: ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/decide', { id: 'd1', action: 'skip' }]);
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
    expect(regiao().textContent).toMatch(/HTTP 403/);
  });

  it('Cancelar a sessão manda o id dela, depois da confirmação', async () => {
    const sessao = { id: 'a1', label: 'Revisão automática de dono/repo#12', startedAt: 1, cancellable: true, pr: { key: 'dono/repo#12', url: URL_DO_PR } };
    const t = montar(estado({ activeSessions: [sessao], activity: { a1: [{ t: 1, k: 'tool', text: 'lendo o diff' }] } }));
    expect(screen.getByText('lendo o diff')).toBeTruthy();
    await clicar(`Cancelar a sessão de ${NOME}`);
    await clicar(`Cancelar a sessão: a sessão de ${NOME}`);
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/cancel', { id: 'a1' }]);
  });

  it('revisar sob demanda manda a URL canônica do PR', async () => {
    const t = montar(estado());
    fireEvent.change(screen.getByLabelText('Revisar sob demanda: URL do PR'), { target: { value: `${URL_DO_PR}/files?w=1#x` } });
    await clicar('Revisar este PR');
    expect(t.post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/review', { urls: [URL_DO_PR] }]);
  });
});
