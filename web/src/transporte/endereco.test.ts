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

  it('aceita nome de host, IPv4 e IPv6 entre colchetes, com ou sem porta', () => {
    expect(enderecoDoMotor('https://farol.exemplo.com:8443')).toBe('https://farol.exemplo.com:8443');
    expect(enderecoDoMotor('HTTPS://Farol.Exemplo.COM')).toBe('https://farol.exemplo.com');
    expect(enderecoDoMotor('http://localhost:47170')).toBe('http://localhost:47170');
    expect(enderecoDoMotor('http://192.168.0.10:47170')).toBe('http://192.168.0.10:47170');
    expect(enderecoDoMotor('http://[::1]:47170')).toBe('http://[::1]:47170');
    expect(enderecoDoMotor('https://[2001:db8::1]')).toBe('https://[2001:db8::1]');
  });

  // Cada um destes abriria ou quebraria o connect-src da CSP se passasse.
  it.each([
    ['curinga no host', 'https://*'],
    ['curinga em subdomínio', 'https://*.exemplo.com'],
    ['ponto e vírgula', 'https://a.com;x'],
    ['ponto e vírgula com diretiva', "https://a.com; script-src 'unsafe-inline'"],
    ['aspa simples', "https://a.com'x"],
    ['espaço no meio', 'https://a .com'],
    ['duas origens', 'https://a.com https://b.com'],
    ['vírgula', 'https://a.com,b.com'],
    ['sublinhado', 'https://a_b.com'],
    ['barra invertida', 'https://a.com\\x'],
    ['rótulo começando com hífen', 'https://-a.com'],
    ['ponto no fim', 'https://a.com.'],
    ['host vazio', 'https://'],
    ['só porta', 'https://:8443'],
    ['porta que não é número', 'https://a.com:x'],
    ['porta fora da faixa', 'https://a.com:70000'],
    ['IPv4 fora da faixa', 'http://999.1.1.1'],
    ['IPv6 sem colchetes', 'http://::1'],
    ['IPv6 torto', 'http://[::g]'],
    ['usuário', 'https://usuario@a.com'],
    ['usuário e senha', 'https://usuario:senha@a.com'],
    ['caminho', 'https://a.com/api'],
    ['query', 'https://a.com?x=1'],
    ['query vazia', 'https://a.com?'],
    ['fragmento', 'https://a.com#a'],
    ['fragmento vazio', 'https://a.com#'],
    ['outro esquema', 'ws://a.com'],
    ['esquema file', 'file:///etc/passwd'],
    ['quebra de linha no meio', 'https://a.com\nhttps://b.com'],
  ])('recusa %s', (_caso, valor) => {
    expect(enderecoDoMotor(valor)).toBe('');
  });
});
