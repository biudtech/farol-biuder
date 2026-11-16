// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dataHora } from '@/radar/formato';
import { EsperandoOCi } from './EsperandoOCi';
import { controleFalso, nomes, pendencia } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';
const DESDE = Date.UTC(2026, 10, 16, 14, 32);

describe('bloco Esperando o CI', () => {
  it('lista vazia diz que está vazia numa linha', () => {
    const { controle } = controleFalso();
    render(<EsperandoOCi pendencias={[]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Esperando o CI (0)' })).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão esperando o CI.')).toBeTruthy();
  });

  it('item normal diz desde quando espera e quais checks faltam, com o estado de cada um', () => {
    const { controle } = controleFalso();
    render(<EsperandoOCi pendencias={[pendencia({ esperaCi: { desde: DESDE, checks: [{ nome: 'ci / build', estado: 'pending' }, { nome: 'ci / test', estado: '' }] } })]} controle={controle} />);
    expect(screen.getByText(`Esperando o CI desde ${dataHora(DESDE)}.`)).toBeTruthy();
    const checks = within(screen.getByRole('list', { name: `Checks que faltam em ${NOME}` })).getAllByRole('listitem');
    expect(checks.map((c) => c.textContent)).toEqual(['ci / build: pending', 'ci / test']);
    expect(screen.getByRole('link', { name: /dono\/repo#12/ })).toBeTruthy();
  });

  it('não oferece decisão: a única ação é tirar da mesa', () => {
    const { controle, disparar } = controleFalso();
    render(<EsperandoOCi pendencias={[pendencia({ esperaCi: { desde: DESDE, checks: [] } })]} controle={controle} />);
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Pular ${NOME}`]);
    fireEvent.click(screen.getByRole('button'));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'decidir', id: 'd1', decisao: 'skip', alvo: 'dono/repo#12', nome: NOME });
  });

  it('sem a lista de checks, diz que o motor não listou', () => {
    const { controle } = controleFalso();
    render(<EsperandoOCi pendencias={[pendencia({ esperaCi: { desde: 0, checks: [] } })]} controle={controle} />);
    expect(screen.getByText('Esperando o CI.')).toBeTruthy();
    expect(screen.getByText('O motor não listou quais checks faltam.')).toBeTruthy();
  });

  it('PR da própria conta e item com impedimento aparecem do mesmo jeito, com o motivo do motor', () => {
    const { controle } = controleFalso();
    render(
      <EsperandoOCi
        pendencias={[pendencia({ prProprio: true, esperaProva: { desde: DESDE, tentativas: 2, aguardandoCi: true, proximaEm: 0, impedimento: 'a ferramenta de avaliação não está instalada', pedeVoce: false } })]}
        controle={controle}
      />,
    );
    expect(screen.getByText(/recuperando a análise desde .*2 tentativa\(s\) concluída\(s\)\. Aguarda o CI antes de retomar\./)).toBeTruthy();
    expect(screen.getByText('a ferramenta de avaliação não está instalada')).toBeTruthy();
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Pular ${NOME}`]);
  });
});
