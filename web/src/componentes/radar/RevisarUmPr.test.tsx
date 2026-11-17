// @vitest-environment jsdom
// Herdeiro de AcoesGerais.test.tsx: a conferência da URL e o Checar agora são os mesmos; mudou
// a casca (o painel que abre do botão "Revisar um PR"), o rótulo do campo ("URL do PR"), o
// texto do botão ("Revisar") e o estado ocupado ("Lendo o PR…", "Checando…").
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECAR } from '@/radar/acoes';
import { RevisarUmPr } from './RevisarUmPr';
import { URL_DO_PR, controleFalso } from './apoio-de-teste';

afterEach(cleanup);

const campo = () => screen.getByLabelText('URL do PR') as HTMLInputElement;
const gaveta = (container: HTMLElement) => container.querySelector('details') as HTMLDetailsElement;

async function pedir(url: string) {
  fireEvent.change(campo(), { target: { value: url } });
  await act(async () => { fireEvent.submit(campo().closest('form') as HTMLFormElement); });
}

describe('Revisar um PR', () => {
  it('o botão abre o painel com o campo da URL e o Revisar, e fecha de novo', () => {
    const { controle } = controleFalso();
    const { container } = render(<RevisarUmPr checagem="" controle={controle} />);
    expect(gaveta(container).open).toBe(false);
    fireEvent.click(screen.getByText('Revisar um PR'));
    expect(gaveta(container).open).toBe(true);
    expect(campo()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeTruthy();
    fireEvent.click(screen.getByText('Revisar um PR'));
    expect(gaveta(container).open).toBe(false);
  });

  it('URL de PR válida vai ao motor aparada e canônica, com o nome do PR; aceito, o campo esvazia e o painel fecha', async () => {
    const { controle, disparar } = controleFalso();
    const { container } = render(<RevisarUmPr checagem="" controle={controle} />);
    fireEvent.click(screen.getByText('Revisar um PR'));
    await pedir(`  ${URL_DO_PR}/files?w=1#diff-abc  `);
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL_DO_PR, alvo: 'sob-demanda', nome: 'PR #12 de dono/repo' });
    expect(campo().value).toBe('');
    expect(gaveta(container).open).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('quando o motor recusa, o que foi digitado fica no campo e o painel fica aberto', async () => {
    const { controle, disparar } = controleFalso();
    disparar.mockResolvedValueOnce(false);
    const { container } = render(<RevisarUmPr checagem="" controle={controle} />);
    fireEvent.click(screen.getByText('Revisar um PR'));
    await pedir(URL_DO_PR);
    expect(campo().value).toBe(URL_DO_PR);
    expect(gaveta(container).open).toBe(true);
  });

  it.each(['', 'dono/repo#12', 'https://github.com/dono/repo', 'http://github.com/dono/repo/pull/12', 'https://outro.example/dono/repo/pull/12'])(
    'o que não é URL de PR do GitHub (%s) não chega ao motor, e o campo diz a forma esperada',
    async (url) => {
      const { controle, disparar } = controleFalso();
      render(<RevisarUmPr checagem="" controle={controle} />);
      await pedir(url);
      expect(disparar).not.toHaveBeenCalled();
      const alerta = screen.getByRole('alert');
      expect(alerta.textContent).toMatch(/URL de um PR do GitHub/);
      expect(campo().getAttribute('aria-invalid')).toBe('true');
      expect(campo().getAttribute('aria-describedby')).toBe(alerta.id);
    },
  );

  it('corrigir a URL tira a mensagem', async () => {
    const { controle } = controleFalso();
    render(<RevisarUmPr checagem="" controle={controle} />);
    await pedir('torta');
    expect(screen.getByRole('alert')).toBeTruthy();
    await pedir(URL_DO_PR);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('com a revisão sob demanda no ar, o botão diz Lendo o PR, e ele e o campo ficam desabilitados', () => {
    const { controle } = controleFalso({ 'sob-demanda': 'revisar' });
    render(<RevisarUmPr checagem="" controle={controle} />);
    const botao = screen.getByRole('button', { name: 'Lendo o PR…' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(campo().disabled).toBe(true);
  });

  it('Checar agora fica no mesmo painel, com o estado da checagem ao lado', () => {
    const { controle, disparar } = controleFalso();
    render(<RevisarUmPr checagem="Última checagem: 16/11, 14:32." controle={controle} />);
    expect(screen.getByText('Última checagem: 16/11, 14:32.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Checar agora' }));
    expect(disparar).toHaveBeenCalledWith(CHECAR);
  });

  it('com a checagem no ar o botão diz Checando e fica desabilitado', () => {
    const { controle } = controleFalso({ checar: 'checar' });
    render(<RevisarUmPr checagem="" controle={controle} />);
    const botao = screen.getByRole('button', { name: 'Enviando: Checar agora' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe('Checando…');
  });
});
