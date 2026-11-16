// Como o Consumo escreve o que o motor manda: números em pt-BR com a unidade dita, o dia como
// o motor o definiu, rótulos e o custo conforme a origem dele. Só formata: nenhuma soma, preço
// ou classificação é daqui.
import type { Execucao } from '@/contratos/consumo';

const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DUAS_CASAS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERCENTUAL = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

// o que a tela escreve quando o motor não mandou o número
export const SEM_DADO = 'sem dado';

export function inteiro(valor: number | undefined): string {
  return valor === undefined ? SEM_DADO : INTEIRO.format(valor);
}

// Dólar com duas casas. O valor que existe e arredondaria para zero diz que é menor que um
// centavo, em vez de aparecer como "US$ 0,00".
export function dolar(valor: number | undefined): string {
  if (valor === undefined) return SEM_DADO;
  if (valor > 0 && valor < 0.005) return 'menos de US$ 0,01';
  return `US$ ${DUAS_CASAS.format(valor)}`;
}

export function tokens(valor: number | undefined): string {
  if (valor === undefined) return SEM_DADO;
  return `${INTEIRO.format(valor)} ${valor === 1 ? 'token' : 'tokens'}`;
}

// A fatia de uma parte no todo, só para exibir. Vazio quando não dá para dizer (falta um dos
// dois, ou o todo é zero).
export function participacao(parte: number | undefined, todo: number | undefined): string {
  if (parte === undefined || todo === undefined || !(todo > 0)) return '';
  return PERCENTUAL.format(parte / todo);
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

// O dia que o motor mandou (AAAA-MM-DD) escrito como DD/MM/AAAA. É troca de texto: não passa
// por Date, para o fuso do navegador não mexer no dia que o motor definiu.
export function diaPorExtenso(dia: string): string {
  const partes = DIA.exec(dia);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : dia;
}

export function diaCurto(dia: string): string {
  const partes = DIA.exec(dia);
  return partes ? `${partes[3]}/${partes[2]}` : dia;
}

function proprio(mapa: Record<string, string>, chave: string | undefined): string | undefined {
  return chave !== undefined && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

// Os tipos de sessão que o motor registra, pelo prefixo do id (kindFromId,
// lib/engine/usage.js). Tipo que a tela não conhece aparece cru.
const TIPO: Record<string, string> = {
  review: 'Revisão',
  pushback: 'Contestação',
  chat: 'Chat',
  tool: 'Ferramenta',
  outro: 'Outro',
};

export function rotuloDoTipo(tipo: string | undefined): string {
  if (tipo === undefined) return 'Tipo não informado';
  return proprio(TIPO, tipo) ?? tipo;
}

// Os desfechos de uma sessão (DESFECHOS, lib/engine/usage-desfechos.js), mais o
// "desconhecido" com que o diário marca o que não reconhece.
const DESFECHO: Record<string, string> = {
  ok: 'Concluída',
  erro: 'Erro',
  cancelada: 'Cancelada',
  interrompida: 'Interrompida (o motor parou com a sessão aberta)',
  parcial: 'Parcial (a sessão morreu antes do fim)',
  descartada: 'Descartada (terminou, e o resultado foi jogado fora)',
  desconhecido: 'Não informado',
};

export function rotuloDoDesfecho(status: string | undefined): string {
  if (status === undefined) return 'Não informado';
  return proprio(DESFECHO, status) ?? status;
}

// o diário escreve "desconhecido" quando a sessão não tem modelo
export function rotuloDoModelo(modelo: string | undefined): string {
  return modelo === undefined || modelo === 'desconhecido' ? 'Modelo não informado' : modelo;
}

// O custo de uma execução conforme a origem que o motor gravou (`costSource`): informado pela
// sessão, calculado pelo motor para a sessão que morreu antes de informar, ou desconhecido
// (aí não há número: zero mentiria para baixo). Origem que a tela não conhece aparece crua.
export function textoDoCusto(execucao: Pick<Execucao, 'costUsd' | 'costSource'>): string {
  const origem = execucao.costSource;
  if (origem === 'desconhecido' || origem === 'sem-base') return 'Desconhecido';
  if (execucao.costUsd === undefined) return SEM_DADO;
  const valor = dolar(execucao.costUsd);
  if (origem === 'estimado') return `${valor} (calculado pelo motor)`;
  if (origem === undefined || origem === 'medido') return valor;
  return `${valor} (origem "${origem}")`;
}

// dono no formato de login do GitHub; repositório com letras, dígitos, ponto, hífen e sublinhado
const CHAVE_DE_PR = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([\w.-]+)#(\d+)$/;

// O endereço do PR no GitHub, montado da chave `dono/repo#n` que o motor grava. O motor não
// manda o endereço no consumo; referência de outro formato (um chat, uma ferramenta) não vira
// link.
export function urlDoPr(referencia: string | undefined): string | undefined {
  const partes = CHAVE_DE_PR.exec(referencia ?? '');
  // "." e ".." são segmentos de caminho, não nome de repositório
  if (!partes || partes[2] === '.' || partes[2] === '..') return undefined;
  return `https://github.com/${partes[1]}/${partes[2]}/pull/${partes[3]}`;
}
