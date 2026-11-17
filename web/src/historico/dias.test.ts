import { describe, expect, it } from 'vitest';
import { agruparPorDia, chaveDoDia, horaCurta, rotuloDoDia } from './dias';

// "agora": terça, 17/11/2026, 15:00 em São Paulo (18:00 UTC)
const AGORA = Date.UTC(2026, 10, 17, 18, 0);
const SP = 'America/Sao_Paulo';

describe('dias do Histórico', () => {
  it('a chave é o dia do calendário no fuso, não em UTC', () => {
    // 02:00 UTC do dia 17 ainda é dia 16 em São Paulo, e já é 17 em Tóquio
    const madrugada = Date.UTC(2026, 10, 17, 2, 0);
    expect(chaveDoDia(madrugada, SP)).toBe('2026-11-16');
    expect(chaveDoDia(madrugada, 'Asia/Tokyo')).toBe('2026-11-17');
    expect(chaveDoDia(undefined, SP)).toBe('');
    expect(chaveDoDia(0, SP)).toBe('');
  });

  it('Hoje, Ontem e depois a data com o dia da semana; o ano só quando muda', () => {
    expect(rotuloDoDia(Date.UTC(2026, 10, 17, 12, 0), AGORA, SP)).toBe('Hoje');
    expect(rotuloDoDia(Date.UTC(2026, 10, 16, 12, 0), AGORA, SP)).toBe('Ontem');
    // a madrugada UTC do dia 17 é ontem em São Paulo
    expect(rotuloDoDia(Date.UTC(2026, 10, 17, 2, 0), AGORA, SP)).toBe('Ontem');
    expect(rotuloDoDia(Date.UTC(2026, 10, 14, 12, 0), AGORA, SP)).toBe('sábado, 14/11');
    expect(rotuloDoDia(Date.UTC(2025, 11, 31, 12, 0), AGORA, SP)).toBe('quarta-feira, 31/12/2025');
    expect(rotuloDoDia(undefined, AGORA, SP)).toBe('Sem data registrada');
  });

  it('ontem é pelo calendário, também na virada do mês e do ano', () => {
    const primeiroDeMarco = Date.UTC(2026, 2, 1, 15, 0);
    expect(rotuloDoDia(Date.UTC(2026, 1, 28, 15, 0), primeiroDeMarco, 'UTC')).toBe('Ontem');
    const anoNovo = Date.UTC(2027, 0, 1, 15, 0);
    expect(rotuloDoDia(Date.UTC(2026, 11, 31, 15, 0), anoNovo, 'UTC')).toBe('Ontem');
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
      ['Hoje', 'ab'],
      ['Ontem', 'c'],
      ['Sem data registrada', 'd'],
      ['terça-feira, 10/11', 'e'],
    ]);
    expect(new Set(grupos.map((g) => g.chave)).size).toBe(grupos.length);
  });
});
