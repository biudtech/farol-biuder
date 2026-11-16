// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, DesfechoDoPareamento, EstadoDoApp, MotivoDoPareamento, Motor, Saida } from '@/estado/app';
import { ESTADO_INICIAL } from '@/estado/app';
import { criarStore } from '@/estado/store';
import { Pareamento } from './Pareamento';

afterEach(cleanup);

function appFalso(motor: Motor, desfecho: DesfechoDoPareamento = 'recusado', motivo: MotivoDoPareamento = 'nenhum', saida: Saida | null = null) {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareamento', motor, motivo, saida });
  const parear = vi.fn(async (): Promise<DesfechoDoPareamento> => {
    store.trocar({ motor: desfecho === 'inalcancavel' ? 'inalcancavel' : 'alcancavel' });
    return desfecho;
  });
  const verificarMotor = vi.fn(async () => { store.trocar({ motor: 'alcancavel' }); });
  const app = { store, parear, verificarMotor } as unknown as App;
  return { app, parear, verificarMotor, store };
}

async function enviar(codigo: string) {
  fireEvent.change(screen.getByLabelText('Código'), { target: { value: codigo } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Parear' })); });
}

describe('tela de pareamento', () => {
  it('com o motor alcançável mostra o formulário e nenhuma mensagem de erro', () => {
    const { app } = appFalso('alcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Parear este navegador' })).toBeTruthy();
    expect(screen.getByText('node tools/farol-parear.js')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('envia o código normalizado como o motor normaliza (maiúsculas, sem espaço e hífen) e o nome aparado', async () => {
    const { app, parear } = appFalso('alcancavel', 'pareado');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    fireEvent.change(screen.getByLabelText(/Nome deste navegador/), { target: { value: '  notebook  ' } });
    await enviar('  abcde-23456 ');
    expect(parear).toHaveBeenCalledWith('ABCDE23456', 'notebook');
  });

  it('código vazio não chama o motor', async () => {
    const { app, parear } = appFalso('alcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar('   ');
    expect(parear).not.toHaveBeenCalled();
  });

  // O motor conta toda tentativa errada contra o código pendente (cinco queimam). O que nem
  // tem a forma de um código não chega a ele.
  it.each([
    ['curto', 'ABCDE2345'],
    ['comprido', 'ABCDE234567'],
    ['com 0 e 1, que o alfabeto não tem', 'ABCDE01234'],
    ['com 8 e 9', 'ABCDE89234'],
    ['com símbolo', 'ABCDE_2345'],
    ['só espaço e hífen', ' - - '],
  ])('código de forma errada (%s) mostra a mensagem na tela sem gastar tentativa no motor', async (_caso, codigo) => {
    const { app, parear } = appFalso('alcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar(codigo);
    expect(parear).not.toHaveBeenCalled();
    const alertas = screen.getAllByRole('alert');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.textContent).toMatch(/10 caracteres/);
    const campo = screen.getByLabelText('Código');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(alertas[0]?.id);
  });

  it('corrigir o código depois da mensagem de forma envia e tira a mensagem', async () => {
    const { app, parear } = appFalso('alcancavel', 'pareado');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar('ABC');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await enviar('ABCDE23456');
    expect(parear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('chegada normal não mostra aviso nem puxa o foco', () => {
    const { app } = appFalso('alcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ['nao-autenticado', /sessão deste navegador/],
    ['outra-aba', /outra aba/],
  ] as const)('chegada por %s diz por quê numa linha de status e leva o foco ao campo do código', (motivo, texto) => {
    const { app } = appFalso('alcancavel', 'recusado', motivo);
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toMatch(texto);
    const campo = screen.getByLabelText('Código');
    expect(document.activeElement).toBe(campo);
    expect(campo.getAttribute('aria-describedby')).toBe(aviso.id);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['revogada', /o motor revogou a sessão deste navegador/],
    ['sem-resposta', /não deu para falar com o motor.*continua valendo no motor até expirar/],
    ['recusada', /o motor não revogou a sessão.*continua valendo no motor até expirar/],
    ['nao-encontrada', /não listou a sessão.*continua valendo no motor até expirar/],
  ] as const)('depois do Sair (%s) diz se a sessão foi revogada no motor ou só esquecida aqui', (saida, texto) => {
    const { app } = appFalso('alcancavel', 'recusado', 'saiu', saida);
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toMatch(texto);
    const campo = screen.getByLabelText('Código');
    expect(document.activeElement).toBe(campo);
    expect(campo.getAttribute('aria-describedby')).toBe(aviso.id);
  });

  it('saída sem desfecho registrado não mostra aviso, mas o foco vai ao campo do código', () => {
    const { app } = appFalso('alcancavel', 'recusado', 'saiu');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Código'));
  });

  it('pareamento cancelado no meio não mostra erro', async () => {
    const { app } = appFalso('alcancavel', 'cancelado');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar('ABCDE23456');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('código recusado mostra uma mensagem só', async () => {
    const { app } = appFalso('alcancavel', 'recusado');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar('ERRADO2345');
    const alertas = screen.getAllByRole('alert');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.textContent).toMatch(/^Código não confere\./);
    expect((screen.getByLabelText('Código') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('motor inalcançável mostra uma mensagem só, com o endereço e o botão de tentar de novo', async () => {
    const { app, verificarMotor } = appFalso('inalcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    const alertas = screen.getAllByRole('alert');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.textContent).toContain('http://127.0.0.1:47170');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })); });
    expect(verificarMotor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recusa seguida de motor fora troca a mensagem, não soma', async () => {
    const t = appFalso('alcancavel', 'recusado');
    render(<Pareamento app={t.app} base="http://127.0.0.1:47170" />);
    await enviar('ERRADO2345');
    t.parear.mockImplementationOnce(async () => { t.store.trocar({ motor: 'inalcancavel' }); return 'inalcancavel'; });
    await enviar('ABCDE23456');
    const alertas = screen.getAllByRole('alert');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.textContent).toMatch(/^Não deu para falar com o motor/);
  });
});
