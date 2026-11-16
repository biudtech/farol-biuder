// Leitor incremental de Server-Sent Events. O fluxo do motor chega por fetch em pedaços que
// não respeitam a fronteira das linhas nem dos eventos: a linha pela metade e o evento ainda
// sem a linha vazia do fim ficam guardados até o próximo pedaço.
//
// Segue a especificação (HTML, "Server-sent events", interpretação do fluxo): a linha termina
// em CRLF, LF ou CR sozinho; a linha vazia entrega o evento; linha que começa com dois pontos
// é comentário; linha sem dois pontos é campo de valor vazio; depois dos dois pontos sai um
// espaço só. Dos campos, só `event` e `data` interessam aqui (`id` e `retry` são ignorados).

export interface EventoSse {
  tipo: string;
  dados: string;
}

export interface LeitorDeSse {
  // Lança quando o evento em montagem passa de LIMITE_DO_EVENTO: quem lê derruba a conexão.
  alimentar(pedaco: string): EventoSse[];
}

// O teto, em caracteres, do que fica guardado entre dois pedaços (a linha pela metade mais os
// dados do evento ainda aberto). O maior evento do motor é o `state`, o snapshot inteiro, que
// fica na casa das centenas de KB: 8 MiB é folga de sobra, e um fluxo que nunca fecha o evento
// (proxy que troca o corpo, resposta que não é SSE) para aqui em vez de comer a memória da aba.
export const LIMITE_DO_EVENTO = 8 * 1024 * 1024;

const FIM_DE_LINHA = /\r\n|\r|\n/;

export function criarLeitorDeSse(): LeitorDeSse {
  // a linha ainda sem fim (pode terminar num CR à espera do LF)
  let resto = '';
  // o evento em montagem
  let tipo = '';
  let dados: string[] = [];
  let tamanhoDosDados = 0;

  function lerLinha(linha: string, eventos: EventoSse[]): void {
    if (linha === '') {
      // bloco sem data (comentário, só o nome do evento) não é evento
      if (dados.length) eventos.push({ tipo: tipo || 'message', dados: dados.join('\n') });
      tipo = '';
      dados = [];
      tamanhoDosDados = 0;
      return;
    }
    if (linha.startsWith(':')) return;
    const doisPontos = linha.indexOf(':');
    const campo = doisPontos < 0 ? linha : linha.slice(0, doisPontos);
    let valor = doisPontos < 0 ? '' : linha.slice(doisPontos + 1);
    if (valor.startsWith(' ')) valor = valor.slice(1);
    if (campo === 'event') tipo = valor;
    else if (campo === 'data') {
      dados.push(valor);
      tamanhoDosDados += valor.length + 1;
    }
  }

  return {
    alimentar(pedaco) {
      let texto = resto + pedaco;
      // O CR do fim fica guardado: se o LF dele vier no próximo pedaço, os dois são um fim de
      // linha só. Sozinho, ele fecha a linha quando o próximo pedaço chegar.
      let crPendente = '';
      if (texto.endsWith('\r')) {
        crPendente = '\r';
        texto = texto.slice(0, -1);
      }
      const linhas = texto.split(FIM_DE_LINHA);
      resto = (linhas.pop() ?? '') + crPendente;
      const eventos: EventoSse[] = [];
      for (const linha of linhas) lerLinha(linha, eventos);
      if (resto.length + tamanhoDosDados > LIMITE_DO_EVENTO) {
        resto = '';
        dados = [];
        tamanhoDosDados = 0;
        throw new Error('fluxo de eventos: evento passou do teto de tamanho sem terminar');
      }
      return eventos;
    },
  };
}
