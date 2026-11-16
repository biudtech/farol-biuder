import { describe, expect, it } from 'vitest';
import { criarLeitorDeSse } from './sse';

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
});
