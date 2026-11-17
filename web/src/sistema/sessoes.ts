// As sessões pareadas e o Sair, sem React: como a tela chama cada sessão, o que ela pergunta
// antes de revogar e o que diz depois de sair. Quem revoga é o motor, pelo `id` da sessão
// (POST /api/auth/revoke, lib/local-auth/acesso.js, na raiz); o `id` é um pedaço do hash do
// token, nunca o token.
import type { SessaoPareada } from '@/contratos/sistema';
import type { Saida } from '@/estado/app';

const COMANDO_DE_PAREAR = 'node tools/farol-parear.js';

export function nomeDaSessao(sessao: Pick<SessaoPareada, 'rotulo' | 'atual'>): string {
  const rotulo = sessao.rotulo.trim();
  const nome = rotulo ? `"${rotulo}"` : 'sem nome';
  return sessao.atual ? `${nome} (este navegador)` : nome;
}

export interface PerguntaDeRevogar {
  titulo: string;
  texto: string;
  confirmar: string;
}

// A pergunta antes de encerrar (revogar, no motor). Encerrar a sessão ATUAL derruba este
// navegador: a pergunta diz, e depois do aceite a tela vai ao pareamento.
export function perguntaDeRevogar(sessao: Pick<SessaoPareada, 'rotulo' | 'atual'>): PerguntaDeRevogar {
  if (sessao.atual) {
    return {
      titulo: 'Encerrar a sessão deste navegador?',
      texto: `Esta é a sessão em uso agora. O token deste navegador deixa de valer no motor, e esta tela volta ao pareamento assim que o motor aceitar, junto com as outras abas abertas nele. Para entrar de novo é preciso um código novo, gerado no terminal do motor com ${COMANDO_DE_PAREAR}. Não dá para desfazer.`,
      confirmar: 'Encerrar e voltar ao pareamento',
    };
  }
  return {
    titulo: `Encerrar a sessão ${nomeDaSessao(sessao)}?`,
    texto: `O token dessa sessão deixa de valer no motor na hora: o navegador que a usa volta ao pareamento na próxima chamada, e o motor corta o fluxo de eventos que ele tiver aberto. Para voltar, ele precisa de um código novo, gerado com ${COMANDO_DE_PAREAR}. Não dá para desfazer. Este navegador continua pareado.`,
    confirmar: 'Encerrar a sessão',
  };
}

const SO_DAQUI = `O token foi apagado deste navegador, mas a sessão continua valendo no motor até expirar. Para derrubá-la, revogue-a em Sistema, Sessões pareadas, a partir de um navegador pareado, ou rode ${COMANDO_DE_PAREAR} --revogar-todas no terminal do motor.`;

// O que a tela de pareamento diz depois do Sair: se a sessão foi revogada no motor ou só
// esquecida neste navegador, e por quê.
export function textoDaSaida(saida: Saida): string {
  switch (saida) {
    case 'revogada': return 'Você saiu, e o motor revogou a sessão deste navegador: o token que estava aqui não vale mais.';
    case 'nao-confirmada': return `Você saiu deste navegador, e o token foi apagado daqui, mas não deu para confirmar se o motor revogou a sessão: o pedido de revogação saiu e a resposta não chegou (falha de rede, ou o prazo venceu). Para ter certeza, confira em Sistema, Sessões pareadas, a partir de um navegador pareado, ou rode ${COMANDO_DE_PAREAR} --revogar-todas no terminal do motor.`;
    case 'sem-resposta': return `Você saiu deste navegador, mas não deu para falar com o motor para revogar a sessão (falha de rede, ou ele não respondeu a tempo). ${SO_DAQUI}`;
    case 'recusada': return `Você saiu deste navegador, mas o motor não revogou a sessão (a rota recusou o pedido ou respondeu fora do formato). ${SO_DAQUI}`;
    case 'nao-encontrada': return `Você saiu deste navegador, mas o motor não listou a sessão dele entre as pareadas, então nada foi revogado. ${SO_DAQUI}`;
  }
}

// O que a região viva diz da lista de sessões.
export function textoDaLista(total: number): string {
  if (total === 0) return 'Nenhuma sessão pareada';
  return total === 1 ? '1 sessão pareada' : `${total} sessões pareadas`;
}
