// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, DesfechoDoPareamento, EstadoDoApp, Motor } from '@/estado/app';
import { ESTADO_INICIAL } from '@/estado/app';
import { criarStore } from '@/estado/store';
import { Pareamento } from './Pareamento';

afterEach(cleanup);

function appFalso(motor: Motor, desfecho: DesfechoDoPareamento = 'recusado') {
  const store = criarStore<EstadoDoApp>({ ...ESTADO_INICIAL, sessao: 'pareamento', motor });
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

  it('envia o código e o nome aparados', async () => {
    const { app, parear } = appFalso('alcancavel', 'pareado');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    fireEvent.change(screen.getByLabelText(/Nome deste navegador/), { target: { value: '  notebook  ' } });
    await enviar('  abcde23456 ');
    expect(parear).toHaveBeenCalledWith('abcde23456', 'notebook');
  });

  it('código vazio não chama o motor', async () => {
    const { app, parear } = appFalso('alcancavel');
    render(<Pareamento app={app} base="http://127.0.0.1:47170" />);
    await enviar('   ');
    expect(parear).not.toHaveBeenCalled();
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
