// Como o Radar fatia o snapshot nas seções da tela. Nada aqui decide: cada corte lê um campo
// que o motor já mandou pronto. As pendências da mesa (`decisions.pending`) não entram no
// Radar: o revisor é autônomo, e a revisão que não publicou nada aparece no Histórico.
import type { ItemDaFila, PrEmEspera, SessaoAtiva } from '@/contratos/radar';
import type { Snapshot } from '@/contratos/snapshot';
import { dataHora, dia, horaCurta } from './formato';

// O que a Fila mostra, sem repetir PR que já aparece em outro lugar da tela. É só exibição:
// - PR com sessão em curso está em "Em análise", e sai da fila e da espera;
// - PR em espera de execução que ainda está na fila aparece uma vez, na fila.
// A ordem é a do motor, e a chave do PR é comparada sem diferenciar caixa.
export function fatiarFila(
  fila: readonly ItemDaFila[],
  emEspera: readonly PrEmEspera[],
  sessoes: readonly SessaoAtiva[],
): { fila: ItemDaFila[]; emEspera: PrEmEspera[] } {
  const igual = (chave: string): string => chave.toLowerCase();
  const emSessao = new Set(sessoes.flatMap((s) => [...(s.keys ?? []), ...(s.pr?.key ? [s.pr.key] : [])]).map(igual));
  const naFila = fila.filter((pr) => !emSessao.has(igual(pr.key)));
  const jaNaTela = new Set([...emSessao, ...naFila.map((pr) => igual(pr.key))]);
  const vistos = new Set<string>();
  const esperando = emEspera.filter((pr) => {
    const chave = igual(pr.key);
    if (jaNaTela.has(chave) || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  return { fila: naFila, emEspera: esperando };
}

// A frase de baixo do título: o que está na tela agora, contado depois de fatiarFila.
export function resumoDoTopo(emAnalise: number, naFila: number): string {
  return `${emAnalise} em análise · ${naFila} na fila`;
}

export interface AvisoDoMotor {
  tom: 'erro' | 'info';
  texto: string;
  // o aviso leva o Checar agora junto: a checagem que falhou
  checar?: true;
}

// O que o snapshot diz que impede o motor de trabalhar: sem conta, sem token do gh, a
// última checagem que falhou, as buscas pausadas pelo limite do GitHub. Enquanto o motor
// está iniciando (`starting`) a conta e o token ainda não foram lidos, e não viram aviso.
export function avisosDoMotor(s: Snapshot, fuso?: string): AvisoDoMotor[] {
  const avisos: AvisoDoMotor[] = [];
  const iniciando = s.status === 'starting';
  if (s.account && !iniciando) {
    if (!s.account.user) {
      avisos.push({ tom: 'erro', texto: 'O motor está sem conta do GitHub: nenhuma foi configurada nem detectada. Rode gh auth login na máquina do motor e use Checar agora.' });
    } else if (!s.account.tokenOk) {
      avisos.push({ tom: 'erro', texto: `A conta ${s.account.user} está sem token no gh do motor: nada é buscado nem publicado. Rode gh auth login na máquina do motor e use Checar agora.` });
    }
  }
  if (s.status === 'error' && s.error) {
    avisos.push({ tom: 'erro', texto: `A última checagem falhou: ${s.error}. O motor tenta de novo no próximo ciclo.`, checar: true });
  }
  if (s.buscasPausadas?.length) {
    const quais = s.buscasPausadas.map((b) => `${b.conta || 'conta do motor'} até ${dataHora(b.ate, fuso)}`).join('; ');
    avisos.push({ tom: 'info', texto: `Buscas pausadas pelo limite de requisições do GitHub: ${quais}. O que está na tela é o último retrato.` });
  }
  return avisos;
}

// As chaves de que as seções dependem e que o estado não trouxe (ou trouxe com forma errada,
// sem valor anterior para manter). A seção aparece vazia, e a tela diz por quê.
const BLOCOS = [['activeSessions', 'as sessões em curso'], ['queue', 'a fila'], ['decisions', 'as revisões postadas']] as const;

export function chavesAusentes(s: Snapshot): string[] {
  return BLOCOS.filter(([chave]) => s[chave] === undefined).map(([, nome]) => nome);
}

// O estado da checagem, numa linha.
export function textoDaChecagem(s: Snapshot, fuso?: string): string {
  if (s.status === 'starting') return 'O motor está iniciando.';
  if (s.status === 'checking') return 'Checando agora.';
  const ultima = dataHora(s.lastCheckAt, fuso);
  const proxima = dataHora(s.nextCheckAt, fuso);
  const partes = [ultima ? `Última checagem: ${ultima}.` : 'Nenhuma checagem terminou ainda.'];
  if (proxima) partes.push(`Próxima: ${proxima}.`);
  return partes.join(' ');
}

// A linha da fila vazia. Antes de a primeira checagem terminar, vazio não quer dizer "nada
// pedido": o motor ainda não olhou.
export function textoDaFilaVazia(s: Snapshot): string {
  if (s.lastCheckAt) return 'Nenhum PR na fila.';
  return s.status === 'error'
    ? 'A primeira checagem falhou: ainda não dá para dizer o que está na fila.'
    : 'A primeira checagem ainda não terminou.';
}

// A frase do "Tudo revisado": a fila vazia e, quando o motor manda, a próxima checagem. A hora
// basta quando a checagem é hoje; noutro dia vai a data junto. `agora` e `fuso` existem para o
// teste: a tela usa o relógio e o fuso do navegador.
export function textoDoTudoEmDia(s: Snapshot, agora: number = Date.now(), fuso?: string): string {
  const proxima = s.nextCheckAt;
  if (!proxima) return 'Nenhum PR na fila.';
  const hoje = dia(proxima, fuso) === dia(agora, fuso);
  const quando = hoje ? `às ${horaCurta(proxima, fuso)}` : `em ${dataHora(proxima, fuso)}`;
  return `Nenhum PR na fila. A próxima checagem é ${quando}.`;
}
