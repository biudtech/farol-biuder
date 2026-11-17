// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarraDeCarga, Bolinha, Botao, Chip, Esqueleto, Linha, Spinner } from './index';

afterEach(cleanup);

describe('Linha', () => {
  it('fechada mostra só o resumo; um clique no resumo abre o detalhe e outro fecha', () => {
    const aoAlternar = vi.fn();
    const { container } = render(<Linha resumo={<span>Título do PR</span>} aoAlternar={aoAlternar}><p>detalhe</p></Linha>);
    const detalhes = container.querySelector('details') as HTMLDetailsElement;
    expect(detalhes.open).toBe(false);
    fireEvent.click(screen.getByText('Título do PR'));
    expect(detalhes.open).toBe(true);
    fireEvent.click(screen.getByText('Título do PR'));
    expect(detalhes.open).toBe(false);
  });

  it('aberta começa aberta', () => {
    const { container } = render(<Linha resumo="Bloqueio" aberta><p>detalhe</p></Linha>);
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true);
  });

  it('o resumo é o <summary>, que o teclado e o leitor de tela já tratam como botão de abrir', () => {
    const { container } = render(<Linha resumo="Fila"><p>x</p></Linha>);
    expect(container.querySelector('details > summary')?.textContent).toBe('Fila');
  });
});

describe('estado e carregamento', () => {
  it('a bolinha é decorativa e o estado vai em texto', () => {
    const { container } = render(<Bolinha tom="ok" rotulo="aprovado" />);
    expect(container.querySelector('[data-tom="ok"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('aprovado')).toBeTruthy();
  });

  it('o chip leva o tom e o texto', () => {
    render(<Chip tom="ruim">Pediu mudanças</Chip>);
    expect(screen.getByText('Pediu mudanças').getAttribute('data-tom')).toBe('ruim');
  });

  it('o spinner com rótulo é uma região de status; sem rótulo, decorativo', () => {
    render(<><Spinner tamanho="g" rotulo="Carregando" /><Spinner tamanho="p" /></>);
    expect(screen.getByRole('status', { name: 'Carregando' }).getAttribute('data-tamanho')).toBe('g');
  });

  it('o esqueleto diz o que carrega e marca a região como ocupada', () => {
    render(<Esqueleto texto="Carregando as revisões." linhas={3} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Carregando as revisões.');
    expect(status.parentElement?.getAttribute('aria-busy')).toBe('true');
  });

  it('a barra do topo é um progresso sem valor, com nome', () => {
    render(<BarraDeCarga rotulo="Carregando a página" />);
    expect(screen.getByRole('progressbar', { name: 'Carregando a página' }).getAttribute('aria-valuenow')).toBeNull();
  });

  it('o botão ocupado diz o processo e fica desabilitado', () => {
    const clique = vi.fn();
    render(<Botao primario ocupado="Salvando…" onClick={clique}>Salvar</Botao>);
    const botao = screen.getByRole('button', { name: 'Salvando…' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.click(botao);
    expect(clique).not.toHaveBeenCalled();
  });
});

describe('o CSS das peças comuns', () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, 'ui.module.css'), 'utf8');

  it('não tem cor escrita à mão: só as variáveis de globals.css', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it('as animações param com prefers-reduced-motion (regra global de globals.css)', () => {
    const global = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
    expect(global).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  });
});
