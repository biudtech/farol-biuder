import { describe, expect, it } from 'vitest';
import { LIMITE_DO_EVENTO, criarLeitorDeSse } from './sse';

describe('leitor incremental de SSE', () => {
  it('entrega o evento inteiro com tipo e dados', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('event: state\ndata: {"a":1}\n\n')).toEqual([{ tipo: 'state', dados: '{"a":1}' }]);
  });

  it('guarda o evento pela metade e entrega quando o resto chega', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('event: state-pa')).toEqual([]);
    expect(leitor.alimentar('tch\ndata: {"campos":{},')).toEqual([]);
    expect(leitor.alimentar('"removidos":[]}\n')).toEqual([]);
    expect(leitor.alimentar('\nevent: ping\ndata: 17\n\n')).toEqual([
      { tipo: 'state-patch', dados: '{"campos":{},"removidos":[]}' },
      { tipo: 'ping', dados: '17' },
    ]);
  });

  it('entrega vários eventos do mesmo pedaço, na ordem', () => {
    const leitor = criarLeitorDeSse();
    const eventos = leitor.alimentar('event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3');
    expect(eventos.map((e) => e.tipo)).toEqual(['a', 'b']);
    expect(leitor.alimentar('\n\n')).toEqual([{ tipo: 'c', dados: '3' }]);
  });

  it('junta várias linhas data com quebra de linha e tira só um espaço depois dos dois pontos', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('data: um\ndata:  dois\ndata:tres\n\n')).toEqual([{ tipo: 'message', dados: 'um\n dois\ntres' }]);
  });

  it('ignora comentário e bloco sem data', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar(': batimento\n\nevent: vazio\n\nevent: ping\ndata: 1\n\n')).toEqual([{ tipo: 'ping', dados: '1' }]);
  });

  it('aceita CRLF, inclusive partido entre dois pedaços', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('event: ping\r\ndata: 1\r\n\r')).toEqual([]);
    expect(leitor.alimentar('\nevent: ping\r\ndata: 2\r\n\r\n')).toEqual([
      { tipo: 'ping', dados: '1' },
      { tipo: 'ping', dados: '2' },
    ]);
  });

  it('aceita CR sozinho como fim de linha, como a especificação de SSE', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('event: ping\rdata: 1\r\revent: ping\rdata: 2\r\rx')).toEqual([
      { tipo: 'ping', dados: '1' },
      { tipo: 'ping', dados: '2' },
    ]);
  });

  it('CR no fim do pedaço espera o próximo: pode ser a metade de um CRLF', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('data: 1\r')).toEqual([]);
    // veio o LF: era um CRLF só, e a linha vazia ainda não chegou
    expect(leitor.alimentar('\n')).toEqual([]);
    expect(leitor.alimentar('\r')).toEqual([]);
    expect(leitor.alimentar('data: 2\n\n')).toEqual([{ tipo: 'message', dados: '1' }, { tipo: 'message', dados: '2' }]);
  });

  it('mistura os três fins de linha no mesmo fluxo', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('data: a\r\ndata: b\rdata: c\n\n')).toEqual([{ tipo: 'message', dados: 'a\nb\nc' }]);
  });

  it('linha sem dois pontos é campo de valor vazio, e campo desconhecido é ignorado', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('id: 7\nretry: 10\ndata\ndata: x\n\n')).toEqual([{ tipo: 'message', dados: '\nx' }]);
  });

  it('o nome do evento não vaza para o evento seguinte', () => {
    const leitor = criarLeitorDeSse();
    expect(leitor.alimentar('event: state\n\ndata: 1\n\n')).toEqual([{ tipo: 'message', dados: '1' }]);
  });

  it('evento sem fim estoura o teto e lança, em vez de crescer sem limite', () => {
    const leitor = criarLeitorDeSse();
    const pedaco = `data: ${'x'.repeat(1024 * 1024)}`;
    expect(() => {
      for (let i = 0; i <= LIMITE_DO_EVENTO / pedaco.length + 1; i++) leitor.alimentar(pedaco);
    }).toThrow(/teto/);
  });

  it('muitas linhas data sem a linha vazia também estouram o teto', () => {
    const leitor = criarLeitorDeSse();
    const pedaco = `data: ${'x'.repeat(1024 * 1024)}\n`;
    expect(() => {
      for (let i = 0; i <= LIMITE_DO_EVENTO / pedaco.length + 1; i++) leitor.alimentar(pedaco);
    }).toThrow(/teto/);
  });

  it('evento grande que termina dentro do teto passa', () => {
    const leitor = criarLeitorDeSse();
    const dados = 'x'.repeat(LIMITE_DO_EVENTO - 100);
    expect(leitor.alimentar(`data: ${dados}\n\n`)).toEqual([{ tipo: 'message', dados }]);
  });
});
