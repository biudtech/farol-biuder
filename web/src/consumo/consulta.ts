// A consulta do Consumo: o que mora no endereço da página (período, filtros, busca e página do
// diário), o pedido que isso vira em GET /api/usage e as frases do resultado. Sem React.
//
// Quem recorta, filtra, soma e pagina é o motor (lib/usage/report.js, na raiz). Valor do
// endereço que a tela não conhece segue como veio; o motor responde com o que achar.
import type { Relatorio } from '@/contratos/consumo';
import type { Resultado } from '@/transporte/cliente';
import { diaPorExtenso, dolar, inteiro } from './formato';
import { diaMenos, diasNoPeriodo } from './grafico';

export interface Consulta {
  // AAAA-MM-DD; vazio deixa o motor escolher (os 30 dias que terminam no hoje dele)
  inicio: string;
  fim: string;
  // review, pushback, chat, tool ou outro; vazio é sem filtro
  tipo: string;
  modelo: string;
  // dono/repo
  repo: string;
  // a busca do diário
  q: string;
  // a página do diário, a partir de 1 (no motor ela começa em zero)
  pagina: number;
}

export const CONSULTA_VAZIA: Consulta = Object.freeze({ inicio: '', fim: '', tipo: '', modelo: '', repo: '', q: '', pagina: 1 });

// o mesmo corte do motor para `search` (historyOf, lib/usage/report.js)
export const TETO_DA_BUSCA = 200;

const PAGINA = /^[1-9]\d{0,8}$/;

export function lerEndereco(params: Pick<URLSearchParams, 'get'>): Consulta {
  const pagina = params.get('pagina') ?? '';
  return {
    inicio: params.get('inicio') ?? '',
    fim: params.get('fim') ?? '',
    tipo: params.get('tipo') ?? '',
    modelo: params.get('modelo') ?? '',
    repo: params.get('repo') ?? '',
    q: params.get('q') ?? '',
    pagina: PAGINA.test(pagina) ? Number(pagina) : 1,
  };
}

// A query string da tela (sem o `?`), só com o que não é padrão.
export function enderecoDa(consulta: Consulta): string {
  const params = new URLSearchParams();
  if (consulta.inicio) params.set('inicio', consulta.inicio);
  if (consulta.fim) params.set('fim', consulta.fim);
  if (consulta.tipo) params.set('tipo', consulta.tipo);
  if (consulta.modelo) params.set('modelo', consulta.modelo);
  if (consulta.repo) params.set('repo', consulta.repo);
  if (consulta.q) params.set('q', consulta.q);
  if (consulta.pagina > 1) params.set('pagina', String(consulta.pagina));
  return params.toString();
}

// tipo, modelo e repositório recortam o relatório inteiro; a busca, só o diário
export function temFiltro(consulta: Consulta): boolean {
  return consulta.tipo !== '' || consulta.modelo !== '' || consulta.repo !== '' || consulta.q !== '';
}

export function temPeriodo(consulta: Consulta): boolean {
  return consulta.inicio !== '' || consulta.fim !== '';
}

// GET /api/usage com os nomes da rota (activityRange, matchesActivity e historyOf).
export function caminhoDoRelatorio(consulta: Consulta): string {
  const params = new URLSearchParams();
  if (consulta.inicio) params.set('start', consulta.inicio);
  if (consulta.fim) params.set('end', consulta.fim);
  if (consulta.tipo) params.set('kind', consulta.tipo);
  if (consulta.modelo) params.set('model', consulta.modelo);
  if (consulta.repo) params.set('repo', consulta.repo);
  if (consulta.q) params.set('search', consulta.q);
  if (consulta.pagina > 1) params.set('page', String(consulta.pagina - 1));
  const query = params.toString();
  return query ? `/api/usage?${query}` : '/api/usage';
}

// Os períodos prontos que a tela oferece, em dias. O motor aceita qualquer intervalo de dias
// que não passe do hoje dele; 30 é o que ele usa quando não se pede nenhum.
export const PERIODOS = [7, 30, 90] as const;

// A consulta com o período de `dias` que termina no fim do relatório na tela. O dia de hoje é
// o que o motor disse (o `range.end` de uma resposta), nunca o relógio do navegador. Grava as
// duas datas: só o início deixaria o fim correr com o hoje do motor, e o endereço de "7 dias"
// aberto no dia seguinte mostraria 8.
export function comPeriodo(consulta: Consulta, fimDoRelatorio: string, dias: number): Consulta {
  const inicio = diaMenos(fimDoRelatorio, dias - 1);
  return inicio ? { ...consulta, inicio, fim: fimDoRelatorio, pagina: 1 } : consulta;
}

// Qual dos períodos prontos está na tela, se algum. Só vale quando o endereço pede as duas
// datas que o relatório trouxe, ou nenhuma (aí o período é o padrão do motor, que são sempre
// 30 dias). Com uma data só, ou com datas que o motor não seguiu, nenhum fica marcado.
export function periodoPronto(consulta: Pick<Consulta, 'inicio' | 'fim'>, range: { start: string; end: string }): number | null {
  const asDuas = consulta.inicio === range.start && consulta.fim === range.end;
  const nenhuma = consulta.inicio === '' && consulta.fim === '';
  if (!asDuas && !nenhuma) return null;
  const dias = diasNoPeriodo(range.start, range.end);
  return PERIODOS.find((p) => p === dias) ?? null;
}

// o primeiro ano que o campo de data aceita
export const ANO_MINIMO = 1970;

// A data digitada serve para virar pedido: é um dia que existe, de 1970 em diante. Enquanto
// se digita o ano, o campo de data passa por 0002, 0020 e 0202: nenhum deles vai ao motor.
export function dataAceita(dia: string): boolean {
  return diasNoPeriodo(dia, dia) === 1 && Number(dia.slice(0, 4)) >= ANO_MINIMO;
}

// O que o período do endereço quer dizer, para quem preencheu só uma das datas.
export function dicaDoPeriodo(consulta: Pick<Consulta, 'inicio' | 'fim'>, range: { start: string; end: string } | null): string {
  if (consulta.inicio === '' && consulta.fim === '') return 'Sem datas, o motor mostra os 30 dias que terminam no hoje dele.';
  if (consulta.fim === '') {
    const ate = range ? ` Agora ele termina em ${diaPorExtenso(range.end)}.` : '';
    return `Só com "De", o período vai dessa data até o hoje do motor e cresce a cada dia.${ate}`;
  }
  if (consulta.inicio === '') {
    return 'Só com "Até", o motor começa 30 dias antes do hoje dele, não desta data. Se a data for mais antiga que isso, ele não entrega o relatório: preencha também "De".';
  }
  return 'Período fixo nas duas datas: não acompanha o dia de hoje.';
}

export function textoDoPeriodo(range: { start: string; end: string }): string {
  const dias = diasNoPeriodo(range.start, range.end);
  const quantos = dias ? ` (${inteiro(dias)} ${dias === 1 ? 'dia' : 'dias'})` : '';
  return range.start === range.end ? `${diaPorExtenso(range.start)}${quantos}` : `${diaPorExtenso(range.start)} a ${diaPorExtenso(range.end)}${quantos}`;
}

// O que a região viva anuncia depois de cada carga.
export function textoDoResultado(relatorio: Relatorio): string {
  const { totals, history, range } = relatorio;
  const periodo = `Período de ${textoDoPeriodo(range)}`;
  if (totals.attempts === 0) return `${periodo}: nenhuma execução de IA.`;
  const execucoes = totals.attempts === undefined
    ? 'o motor não disse quantas execuções de IA'
    : `${inteiro(totals.attempts)} ${totals.attempts === 1 ? 'execução' : 'execuções'} de IA`;
  const diario = history.total === 0
    ? 'Diário: nenhuma operação.'
    : `Diário: ${inteiro(history.total)} ${history.total === 1 ? 'operação' : 'operações'}, página ${history.page + 1} de ${history.pages}.`;
  const custo = totals.costUsd === undefined ? 'custo não informado' : `custo estimado de ${dolar(totals.costUsd)}`;
  return `${periodo}: ${execucoes}, ${custo}. ${diario}`;
}

export function textoDoVazio(consulta: Consulta): string {
  return consulta.tipo !== '' || consulta.modelo !== '' || consulta.repo !== ''
    ? 'Nenhuma execução de IA neste período com os filtros escolhidos.'
    : 'Nenhuma execução de IA neste período.';
}

export function textoDoDiarioVazio(consulta: Consulta): string {
  return temFiltro(consulta)
    ? 'Nenhuma operação passa pela busca e pelos filtros escolhidos neste período.'
    : 'Nenhuma operação neste período.';
}

// A marca do consumo no snapshot: quantas sessões o agregado do motor já contou. Serve só
// para a tela perceber que entrou sessão nova desde a última carga do relatório. null
// enquanto o snapshot não trouxe a contagem.
export function marcaDoConsumo(sessoesContadas: number | undefined): string | null {
  return sessoesContadas === undefined ? null : String(sessoesContadas);
}

// Como a tela chama cada parâmetro da rota, caso o motor passe a recusar um deles pelo nome.
// Hoje ele não recusa assim: período inválido volta como 200 com `ok: false` e uma frase.
const CAMPO_RECUSADO: Record<string, string> = {
  start: 'o início do período',
  end: 'o fim do período',
  kind: 'o filtro de tipo',
  model: 'o filtro de modelo',
  repo: 'o filtro de repositório',
  search: 'a busca do diário',
  page: 'a página do diário',
};

type Falha = Extract<Resultado<never>, { ok: false }>;

// A frase de uma leitura que falhou. Vazia no cancelamento, que não é erro.
export function mensagemDaFalha(falha: Falha): string {
  switch (falha.falha) {
    case 'cancelado': return '';
    case 'rede': return 'Não deu para falar com o motor (falha de rede).';
    case 'nao_autenticado': return 'A sessão deste navegador não vale mais no motor. Pareie de novo.';
    case 'resposta_invalida': return 'O motor respondeu fora do formato esperado.';
    case 'recusado': {
      const detalhe = falha.detalhe;
      if (!detalhe) return `O motor recusou o pedido (HTTP ${falha.status}).`;
      if (detalhe.campo === undefined) return `O motor recusou o pedido (HTTP ${falha.status}, ${detalhe.codigo}).`;
      const nome = Object.hasOwn(CAMPO_RECUSADO, detalhe.campo) ? CAMPO_RECUSADO[detalhe.campo] : undefined;
      return nome ? `O motor recusou ${nome} (campo "${detalhe.campo}").` : `O motor recusou o campo "${detalhe.campo}".`;
    }
  }
}

// A recusa nomeia um campo: mudar o período ou os filtros resolve, tentar de novo não.
export function ehRecusaDeCampo(falha: Falha): boolean {
  return falha.falha === 'recusado' && falha.detalhe?.campo !== undefined;
}
