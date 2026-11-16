// O estado do teto de um perfil, em frases. O teto é o orçamento em dólar que cada perfil do
// Claude pode ter no motor (por dia e total); quem compara o gasto com ele e decide pausar é o
// motor (profileBudgetStatus, lib/engine/usage.js, na raiz). Aqui só se escreve o que veio.
import type { Auditoria, TetoDoPerfil } from '@/contratos/consumo';
import { diaPorExtenso, dolar, inteiro, participacao } from './formato';

export interface EstadoDoTeto {
  nome: string;
  // Assinatura ou Chave de API
  tipo: string;
  // o motor não inicia revisão automática por este perfil
  pausado: boolean;
  situacao: string;
  // o gasto contra cada teto que existe
  linhas: string[];
  notas: string[];
}

const TIPO_DO_PERFIL: Record<string, string> = { assinatura: 'Assinatura', apikey: 'Chave de API' };

// de onde vem o teto que vale hoje (dailyCapSource)
const ORIGEM_DO_TETO: Record<string, string> = {
  base: 'teto diário',
  semana: 'teto deste dia da semana',
  data: 'teto só desta data',
};

function proprio(mapa: Record<string, string>, chave: string | undefined): string | undefined {
  return chave !== undefined && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

// O que falta para o teto. É a diferença entre dois números do motor, só para exibir: a conta
// que pausa é a dele, que ainda soma uma reserva que não vem no snapshot.
function contraOTeto(gasto: number | undefined, teto: number, nome: string): string {
  if (gasto === undefined) return `gasto não informado; o teto é de ${dolar(teto)} (${nome}).`;
  const resta = gasto >= teto ? 'Teto atingido.' : `Resta ${dolar(teto - gasto)}.`;
  return `${dolar(gasto)} estimados de ${dolar(teto)} (${nome}). ${resta}`;
}

const PAUSA: Record<string, string> = {
  diario: 'Pausado: o teto de hoje foi atingido.',
  total: 'Pausado: o teto total foi atingido.',
  'diario-previsto': 'Pausado: a próxima revisão não cabe no teto de hoje.',
  'total-previsto': 'Pausado: a próxima revisão não cabe no teto total.',
};

function situacaoDo(teto: TetoDoPerfil, temTeto: boolean): string {
  if (teto.blocked === true) {
    if (teto.reason === undefined) return 'Pausado pelo teto.';
    return proprio(PAUSA, teto.reason) ?? `Pausado pelo teto (motivo que esta tela não conhece: ${teto.reason}).`;
  }
  if (teto.blocked === undefined) return 'O motor não disse se este perfil está pausado.';
  return temTeto ? 'Dentro do teto: a revisão automática segue.' : 'Sem teto definido: este perfil não pausa por gasto.';
}

// O que para e o que continua com o perfil pausado, lido do motor: a fila automática
// (server.js), o round automático de re-revisão (travaDoRound, lib/engine/review.js), a
// retentativa (review-retry.js), a recuperação de prova de PR estacionado por orçamento
// (recuperacao-prova.js) e a busca de contestação (pushback.js). Na largada da sessão
// (review.js) só passa a revisão manual que não é de lote.
export const NOTA_DA_PAUSA = 'Enquanto durar, o motor não inicia por este perfil: revisão automática da fila, nova rodada automática de um PR já revisado, retentativa, recuperação de prova, busca de contestação e revisão em lote, mesmo pedida por você. A revisão de um PR só, pedida por você, continua liberada.';

// O dia do teto não é o do diário: o motor corta o gasto de hoje pelo dia local do processo.
export const NOTA_DO_DIA_DO_TETO = 'O "hoje" do teto é o dia local do processo do motor, não o dia de Brasília do diário: com o motor em UTC, ele vira às 21h de Brasília.';

export function estadoDoTeto(teto: TetoDoPerfil): EstadoDoTeto {
  const temTeto = teto.capHoje !== undefined || teto.budgetTotal !== undefined;
  const linhas: string[] = [];
  if (teto.capHoje !== undefined) {
    const origem = proprio(ORIGEM_DO_TETO, teto.capOrigem) ?? 'teto de hoje';
    linhas.push(`Hoje, no dia local do processo do motor: ${contraOTeto(teto.today, teto.capHoje, origem)}`);
  } else if (teto.today !== undefined) {
    linhas.push(`Hoje, no dia local do processo do motor: ${dolar(teto.today)} estimados, sem teto diário.`);
  }
  if (teto.budgetTotal !== undefined) {
    const desde = teto.budgetSince ? `Desde ${diaPorExtenso(teto.budgetSince)}` : 'Em todo o registro';
    linhas.push(`${desde}: ${contraOTeto(teto.sinceCutoff, teto.budgetTotal, 'teto total')}`);
  }

  const notas: string[] = [];
  if (teto.blocked === true) {
    notas.push(NOTA_DA_PAUSA);
    if (teto.reason?.endsWith('-previsto') && teto.tipicoReview !== undefined && teto.tipicoReview > 0) {
      notas.push(`O motor projeta ${dolar(teto.tipicoReview)} para a próxima revisão (a mediana do custo das revisões dos últimos 30 dias) e pausa antes de gastar.`);
    }
  }
  if (teto.parcialmenteEstimado === true) {
    notas.push('Há sessão com custo desconhecido neste perfil: ao comparar com o teto, o motor reserva para cada uma o custo de uma revisão típica. Por isso a pausa pode chegar antes do valor mostrado aqui.');
  }

  return {
    nome: teto.label ?? teto.id,
    tipo: teto.kind === undefined ? 'Tipo não informado' : proprio(TIPO_DO_PERFIL, teto.kind) ?? teto.kind,
    pausado: teto.blocked === true,
    situacao: situacaoDo(teto, temTeto),
    linhas,
    notas,
  };
}

const sessoes = (n: number): string => `${inteiro(n)} ${n === 1 ? 'sessão' : 'sessões'}`;

// A auditoria do registro inteiro, em frases. As somas são do motor; a participação é só
// para exibir.
export function linhasDaAuditoria(auditoria: Auditoria): string[] {
  const { total, perdido, estimado, desconhecido } = auditoria;
  const linhas = [`Registro inteiro de sessões: ${dolar(total.costUsd)} estimados em ${sessoes(total.sessions)}.`];
  if (perdido && perdido.sessions > 0) {
    const fatia = participacao(perdido.costUsd, total.costUsd);
    linhas.push(`Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): ${dolar(perdido.costUsd)} em ${sessoes(perdido.sessions)}${fatia ? `, ${fatia} do custo registrado` : ''}.`);
  }
  if (estimado && estimado.sessions > 0) {
    linhas.push(`Custo calculado pelo motor, para sessão que morreu antes de informar: ${dolar(estimado.costUsd)} em ${sessoes(estimado.sessions)}.`);
  }
  if (desconhecido && desconhecido.sessions > 0) {
    linhas.push(`Custo desconhecido: ${sessoes(desconhecido.sessions)}, fora de todo valor em dólar.`);
  }
  return linhas;
}
