// Os dias da lista do Histórico: em que dia do calendário uma revisão foi resolvida, como o
// título do grupo diz esse dia ("Hoje, 19 de novembro", "Ontem, 18 de novembro", depois o dia da
// semana) e a hora curta de cada cartão. Sem React. O fuso é o de Brasília, o do motor
// (FUSO_DO_DIA, lib/constants.js na raiz), o mesmo do filtro Período e do nome do CSV: a revisão
// das 23h de Brasília cai no mesmo dia para quem abre a tela de outro fuso. O parâmetro `fuso`
// existe para o teste.

export const FUSO_DO_HISTORICO = 'America/Sao_Paulo';

const FORMATADORES = new Map<string, Intl.DateTimeFormat>();

function formatador(nome: string, opcoes: Intl.DateTimeFormatOptions, fuso: string): Intl.DateTimeFormat {
  const chave = `${nome}|${fuso}`;
  let f = FORMATADORES.get(chave);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', { ...opcoes, timeZone: fuso });
    FORMATADORES.set(chave, f);
  }
  return f;
}

// 0 é o que o motor grava quando não sabe a hora
function valido(ms: number | undefined): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0;
}

// O dia do calendário no fuso, como 'AAAA-MM-DD'. Vazio sem hora.
export function chaveDoDia(ms: number | undefined, fuso: string = FUSO_DO_HISTORICO): string {
  if (!valido(ms)) return '';
  const partes = formatador('chave', { year: 'numeric', month: '2-digit', day: '2-digit' }, fuso).formatToParts(ms);
  const parte = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

// O dia anterior a uma chave, pelo calendário (não por 24 horas: o horário de verão não muda
// o que é ontem).
function diaAnterior(chave: string): string {
  const [ano, mes, dia] = chave.split('-').map(Number);
  if (ano === undefined || mes === undefined || dia === undefined) return '';
  const antes = new Date(Date.UTC(ano, mes - 1, dia - 1));
  return antes.toISOString().slice(0, 10);
}

// "Hoje, 19 de novembro", "Ontem, 18 de novembro" ou "sexta-feira, 14 de novembro"; com o ano
// quando não é o ano de agora. "Sem data registrada" quando o motor não mandou a hora.
export function rotuloDoDia(ms: number | undefined, agora: number, fuso: string = FUSO_DO_HISTORICO): string {
  const chave = chaveDoDia(ms, fuso);
  if (!chave) return 'Sem data registrada';
  const hoje = chaveDoDia(agora, fuso);
  const mesmoAno = chave.slice(0, 4) === hoje.slice(0, 4);
  const extenso = formatador(mesmoAno ? 'extenso' : 'extensoComAno', mesmoAno
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' }, fuso).format(ms as number);
  if (chave === hoje) return `Hoje, ${extenso}`;
  if (chave === diaAnterior(hoje)) return `Ontem, ${extenso}`;
  const semana = formatador('semana', { weekday: 'long' }, fuso).format(ms as number);
  return `${semana}, ${extenso}`;
}

// Hora e minuto, no fuso. Vazio sem hora.
export function horaCurta(ms: number | undefined, fuso: string = FUSO_DO_HISTORICO): string {
  if (!valido(ms)) return '';
  return formatador('hora', { hour: '2-digit', minute: '2-digit' }, fuso).format(ms);
}

// O título do grupo com a contagem. A contagem é do que a página carregada traz daquele dia: com
// mais de uma página o dia pode continuar na outra, e o título diz que é "nesta página".
export function tituloDoGrupo(rotulo: string, n: number, variasPaginas: boolean): string {
  const revisoes = n === 1 ? '1 revisão' : `${n} revisões`;
  return `${rotulo} · ${revisoes}${variasPaginas ? ' nesta página' : ''}`;
}

export interface GrupoDoDia<T> {
  chave: string;
  rotulo: string;
  itens: T[];
}

// Agrupa na ordem em que os itens vieram (a do motor): itens seguidos do mesmo dia formam um
// grupo. A tela não reordena nada; se o motor mandar um dia fora de ordem, ele vira outro
// grupo no lugar em que veio.
export function agruparPorDia<T>(itens: readonly T[], instanteDe: (item: T) => number | undefined, agora: number, fuso: string = FUSO_DO_HISTORICO): GrupoDoDia<T>[] {
  const grupos: GrupoDoDia<T>[] = [];
  for (const item of itens) {
    const ms = instanteDe(item);
    const dia = chaveDoDia(ms, fuso) || 'sem-data';
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.chave.split('|')[0] === dia) {
      ultimo.itens.push(item);
      continue;
    }
    grupos.push({ chave: `${dia}|${grupos.length}`, rotulo: rotuloDoDia(ms, agora, fuso), itens: [item] });
  }
  return grupos;
}
