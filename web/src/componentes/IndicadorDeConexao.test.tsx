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
});
