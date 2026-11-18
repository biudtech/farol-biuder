// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Conexao } from '@/transporte/cliente';
import { IndicadorDeConexao } from './IndicadorDeConexao';

afterEach(cleanup);

describe('indicador de conexão', () => {
  const casos: Array<[Conexao, string]> = [
    ['conectando', 'Conectando'],
    ['conectado', 'Conectado'],
    ['reconectando', 'Reconectando'],
    ['sem-motor', 'Sem motor'],
  ];

  it.each(casos)('%s aparece em texto, numa região de status', (conexao, texto) => {
    render(<IndicadorDeConexao conexao={conexao} />);
    const regiao = screen.getByRole('status');
    expect(regiao.textContent).toBe(texto);
    expect(regiao.getAttribute('data-conexao')).toBe(conexao);
  });

  it('conectado não aparece como selo: só o texto para o leitor de tela, sem o ponto', () => {
    const { container } = render(<IndicadorDeConexao conexao="conectado" />);
    const regiao = screen.getByRole('status');
    expect(regiao.className).not.toMatch(/indicador/);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('fora do ar o selo aparece, com o ponto', () => {
    const { container } = render(<IndicadorDeConexao conexao="sem-motor" />);
    expect(screen.getByRole('status').className).toMatch(/indicador/);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
