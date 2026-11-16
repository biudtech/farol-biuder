import { describe, expect, it } from 'vitest';
import { enderecoDoMotor } from './endereco';

describe('endereço do motor', () => {
  it('devolve só a origem', () => {
    expect(enderecoDoMotor('https://farol.exemplo.com')).toBe('https://farol.exemplo.com');
    expect(enderecoDoMotor('https://farol.exemplo.com/')).toBe('https://farol.exemplo.com');
    expect(enderecoDoMotor(' http://127.0.0.1:47170 ')).toBe('http://127.0.0.1:47170');
  });

  it('recusa o que não é uma origem http ou https limpa', () => {
    const tortos = [
      undefined, '', '   ', 'farol.exemplo.com', 'ftp://farol.exemplo.com', 'javascript:alert(1)',
      'https://farol.exemplo.com/api', 'https://farol.exemplo.com?x=1',
      'https://usuario:senha@farol.exemplo.com', 'https://farol.exemplo.com#a',
    ];
    for (const torto of tortos) expect(enderecoDoMotor(torto)).toBe('');
  });
});
