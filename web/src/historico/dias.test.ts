// Os dias da lista do Histórico: no fuso de Brasília (o do motor, o mesmo do Período e do CSV).
import { describe, expect, it } from 'vitest';
import { FUSO_DO_HISTORICO, agruparPorDia, chaveDoDia, horaCurta, rotuloDoDia, tituloDoGrupo } from './dias';

// "agora": terça, 17/11/2026, 15:00 em São Paulo (18:00 UTC)
const AGORA = Date.UTC(2026, 10, 17, 18, 0);
const SP = 'America/Sao_Paulo';

describe('dias do Histórico', () => {
  it('o fuso padrão é o de Brasília, o do motor', () => {
    expect(FUSO_DO_HISTORICO).toBe(SP);
    // 01:30 UTC do dia 17 ainda é dia 16 em Brasília, qualquer que seja o fuso da máquina
    const madrugada = Date.UTC(2026, 10, 17, 1, 30);
    expect(chaveDoDia(madrugada)).toBe('2026-11-16');
    expect(horaCurta(madrugada)).toBe('22:30');
    expect(rotuloDoDia(madrugada, AGORA)).toBe('Ontem, 16 de novembro');
  });

  it('a chave é o dia do calendário no fuso, não em UTC', () => {
    // 02:00 UTC do dia 17 ainda é dia 16 em São Paulo, e já é 17 em Tóquio
    const madrugada = Date.UTC(2026, 10, 17, 2, 0);
    expect(chaveDoDia(madrugada, SP)).toBe('2026-11-16');
    expect(chaveDoDia(madrugada, 'Asia/Tokyo')).toBe('2026-11-17');
    expect(chaveDoDia(undefined, SP)).toBe('');
    expect(chaveDoDia(0, SP)).toBe('');
  });

  it('Hoje e Ontem com o dia por extenso, depois o dia da semana; o ano só quando muda', () => {
    expect(rotuloDoDia(Date.UTC(2026, 10, 17, 12, 0), AGORA, SP)).toBe('Hoje, 17 de novembro');
    expect(rotuloDoDia(Date.UTC(2026, 10, 16, 12, 0), AGORA, SP)).toBe('Ontem, 16 de novembro');
    // a madrugada UTC do dia 17 é ontem em São Paulo
    expect(rotuloDoDia(Date.UTC(2026, 10, 17, 2, 0), AGORA, SP)).toBe('Ontem, 16 de novembro');
    expect(rotuloDoDia(Date.UTC(2026, 10, 14, 12, 0), AGORA, SP)).toBe('sábado, 14 de novembro');
    expect(rotuloDoDia(Date.UTC(2025, 11, 31, 12, 0), AGORA, SP)).toBe('quarta-feira, 31 de dezembro de 2025');
    expect(rotuloDoDia(undefined, AGORA, SP)).toBe('Sem data registrada');
  });

  it('ontem é pelo calendário, também na virada do mês e do ano', () => {
    const primeiroDeMarco = Date.UTC(2026, 2, 1, 15, 0);
    expect(rotuloDoDia(Date.UTC(2026, 1, 28, 15, 0), primeiroDeMarco, 'UTC')).toBe('Ontem, 28 de fevereiro');
    const anoNovo = Date.UTC(2027, 0, 1, 15, 0);
    expect(rotuloDoDia(Date.UTC(2026, 11, 31, 15, 0), anoNovo, 'UTC')).toBe('Ontem, 31 de dezembro de 2026');
  });

  it('a hora curta é hora e minuto no fuso', () => {
    expect(horaCurta(Date.UTC(2026, 10, 17, 16, 52), SP)).toBe('13:52');
    expect(horaCurta(undefined, SP)).toBe('');
  });

  it('agrupa na ordem em que vieram, um grupo por dia seguido', () => {
    const itens = [
      { id: 'a', t: Date.UTC(2026, 10, 17, 16, 0) },
      { id: 'b', t: Date.UTC(2026, 10, 17, 13, 0) },
      { id: 'c', t: Date.UTC(2026, 10, 16, 20, 0) },
      { id: 'd', t: undefined },
      { id: 'e', t: Date.UTC(2026, 10, 10, 12, 0) },
    ];
    const grupos = agruparPorDia(itens, (i) => i.t, AGORA, SP);
    expect(grupos.map((g) => [g.rotulo, g.itens.map((i) => i.id).join('')])).toEqual([
      ['Hoje, 17 de novembro', 'ab'],
      ['Ontem, 16 de novembro', 'c'],
      ['Sem data registrada', 'd'],
      ['terça-feira, 10 de novembro', 'e'],
    ]);
    expect(new Set(grupos.map((g) => g.chave)).size).toBe(grupos.length);
  });

  it('o título do grupo diz quantas revisões ele tem; com mais de uma página, que é desta página', () => {
    expect(tituloDoGrupo('Hoje, 17 de novembro', 1, false)).toBe('Hoje, 17 de novembro · 1 revisão');
    expect(tituloDoGrupo('Hoje, 17 de novembro', 9, false)).toBe('Hoje, 17 de novembro · 9 revisões');
    expect(tituloDoGrupo('Ontem, 16 de novembro', 3, true)).toBe('Ontem, 16 de novembro · 3 revisões nesta página');
  });
});
