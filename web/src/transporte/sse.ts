// Leitor incremental de Server-Sent Events. O fluxo do motor chega por fetch em pedaços que
// não respeitam a fronteira dos eventos: o que sobra depois do último separador é evento pela
// metade e fica guardado até o próximo pedaço.

export interface EventoSse {
  tipo: string;
  dados: string;
}

export interface LeitorDeSse {
  alimentar(pedaco: string): EventoSse[];
}

function lerBloco(bloco: string): EventoSse | null {
  let tipo = 'message';
  const dados: string[] = [];
  for (const linha of bloco.split('\n')) {
    if (linha.startsWith('event:')) tipo = linha.slice(6).trim();
    else if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
  }
  // bloco sem data (comentário, só o nome do evento) não é evento
  return dados.length ? { tipo, dados: dados.join('\n') } : null;
}

export function criarLeitorDeSse(): LeitorDeSse {
  let resto = '';
  return {
    alimentar(pedaco) {
      // O \r do fim fica no resto sem trocar: se o \n dele vier no próximo pedaço, a troca
      // acontece lá, com o par inteiro.
      const blocos = (resto + pedaco).replace(/\r\n/g, '\n').split('\n\n');
      resto = blocos.pop() ?? '';
      const eventos: EventoSse[] = [];
      for (const bloco of blocos) {
        const evento = lerBloco(bloco);
        if (evento) eventos.push(evento);
      }
      return eventos;
    },
  };
}
