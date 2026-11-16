// Como o Radar fatia o snapshot nos blocos da tela. Nada aqui decide: cada corte lê um campo
// que o motor já mandou pronto.
import type { Pendencia } from '@/contratos/radar';
import type { Snapshot } from '@/contratos/snapshot';
import { dataHora, linkDoPr } from './formato';

// As pendências em dois blocos. A que o motor marcou com a espera do CI (`esperaCi`), ou com a
// recuperação da prova que ele mesmo retoma (`esperaProva` sem `pedeVoce`), não espera
// clique: vai para "Esperando o CI". O resto é "Precisa de você". A ordem é a do motor.
export function fatiarPendencias(pendentes: readonly Pendencia[]): { precisam: Pendencia[]; esperando: Pendencia[] } {
  const espera = (p: Pendencia): boolean => p.esperaCi !== undefined || (p.esperaProva !== undefined && !p.esperaProva.pedeVoce);
  return { precisam: pendentes.filter((p) => !espera(p)), esperando: pendentes.filter(espera) };
}

export interface AcoesDaPendencia {
  aprovar: boolean;
  pedirMudancas: boolean;
  comentar: boolean;
  pular: boolean;
  revisar: boolean;
}

// Os botões de uma pendência, pelos dois campos com que o motor diz o que não pode sair:
// - `prProprio`: o GitHub recusa a revisão decisiva do autor, então só Comentar e Pular;
// - `blockedKind: "stale_head"`: o texto fala de um commit anterior e não sai por clique
//   nenhum; o que cabe é revisar de novo, ou pular.
// Fora desses dois, a tela oferece tudo e quem recusa é o motor, com o motivo.
export function acoesDaPendencia(p: Pendencia): AcoesDaPendencia {
  if (p.blockedKind === 'stale_head') {
    return { aprovar: false, pedirMudancas: false, comentar: false, pular: true, revisar: linkDoPr(p.pr?.url) !== null };
  }
  const decisivos = p.prProprio !== true;
  return { aprovar: decisivos, pedirMudancas: decisivos, comentar: true, pular: true, revisar: false };
}

export interface AvisoDoMotor {
  tom: 'erro' | 'info';
  texto: string;
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
    avisos.push({ tom: 'erro', texto: `A última checagem falhou: ${s.error}. O motor tenta de novo no próximo ciclo.` });
  }
  if (s.buscasPausadas?.length) {
    const quais = s.buscasPausadas.map((b) => `${b.conta || 'conta do motor'} até ${dataHora(b.ate, fuso)}`).join('; ');
    avisos.push({ tom: 'info', texto: `Buscas pausadas pelo limite de requisições do GitHub: ${quais}. O que está na tela é o último retrato.` });
  }
  return avisos;
}

// As chaves de que os blocos dependem e que o estado não trouxe (ou trouxe com forma errada,
// sem valor anterior para manter). O bloco aparece vazio, e a tela diz por quê.
const BLOCOS = [['decisions', 'as pendências'], ['activeSessions', 'as sessões em curso'], ['queue', 'a fila']] as const;

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
