// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECAR } from '@/radar/acoes';
import { AcoesGerais } from './AcoesGerais';
import { URL_DO_PR, controleFalso } from './apoio-de-teste';

afterEach(cleanup);

async function pedir(url: string) {
  fireEvent.change(screen.getByLabelText('Revisar sob demanda: URL do PR'), { target: { value: url } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Revisar este PR' })); });
}

describe('ações gerais', () => {
  it('Checar agora envia a checagem, e o estado dela aparece ao lado', () => {
    const { controle, disparar } = controleFalso();
    render(<AcoesGerais checagem="Última checagem: 16/11, 14:32." controle={controle} />);
    expect(screen.getByText('Última checagem: 16/11, 14:32.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Checar agora' }));
    expect(disparar).toHaveBeenCalledWith(CHECAR);
  });

  it('com a checagem no ar o botão fica desabilitado e diz Enviando', () => {
    const { controle } = controleFalso({ checar: 'checar' });
    render(<AcoesGerais checagem="" controle={controle} />);
    const botao = screen.getByRole('button', { name: 'Enviando: Checar agora' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it('URL de PR válida vai ao motor aparada, com o nome do PR, e o campo esvazia quando o motor aceita', async () => {
    const { controle, disparar } = controleFalso();
    render(<AcoesGerais checagem="" controle={controle} />);
    await pedir(`  ${URL_DO_PR}  `);
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL_DO_PR, alvo: 'sob-demanda', nome: 'PR #12 de dono/repo' });
    expect((screen.getByLabelText('Revisar sob demanda: URL do PR') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('quando o motor recusa, o que foi digitado fica no campo', async () => {
    const { controle, disparar } = controleFalso();
    disparar.mockResolvedValueOnce(false);
    render(<AcoesGerais checagem="" controle={controle} />);
    await pedir(URL_DO_PR);
    expect((screen.getByLabelText('Revisar sob demanda: URL do PR') as HTMLInputElement).value).toBe(URL_DO_PR);
  });

  it.each(['', 'dono/repo#12', 'https://github.com/dono/repo', 'http://github.com/dono/repo/pull/12', 'https://outro.example/dono/repo/pull/12'])(
    'o que não é URL de PR do GitHub (%s) não chega ao motor, e o campo diz a forma esperada',
    async (url) => {
      const { controle, disparar } = controleFalso();
      render(<AcoesGerais checagem="" controle={controle} />);
      await pedir(url);
      expect(disparar).not.toHaveBeenCalled();
      const alerta = screen.getByRole('alert');
      expect(alerta.textContent).toMatch(/URL de um PR do GitHub/);
      const campo = screen.getByLabelText('Revisar sob demanda: URL do PR');
      expect(campo.getAttribute('aria-invalid')).toBe('true');
      expect(campo.getAttribute('aria-describedby')).toBe(alerta.id);
    },
  );

  it('corrigir a URL tira a mensagem', async () => {
    const { controle } = controleFalso();
    render(<AcoesGerais checagem="" controle={controle} />);
    await pedir('torta');
    expect(screen.getByRole('alert')).toBeTruthy();
    await pedir(URL_DO_PR);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('com a revisão sob demanda no ar, o botão fica desabilitado', () => {
    const { controle } = controleFalso({ 'sob-demanda': 'revisar' });
    render(<AcoesGerais checagem="" controle={controle} />);
    expect((screen.getByRole('button', { name: 'Enviando…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
