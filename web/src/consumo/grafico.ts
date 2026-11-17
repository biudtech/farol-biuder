// A geometria do gráfico de barras do Consumo: os dias do período, a escala do eixo vertical,
// os rótulos do eixo horizontal e o retângulo de cada barra. Sem React e sem relógio: tudo sai
// do período e dos valores que o motor mandou.

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

// O dia (AAAA-MM-DD) como instante do calendário, em UTC só para fazer a conta: não é
// conversão de fuso, o dia entra e sai como texto. NaN quando o texto não é um dia que existe.
function instanteDoDia(dia: string): number {
  const partes = DIA.exec(dia);
  if (!partes) return Number.NaN;
  const ms = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return new Date(ms).toISOString().slice(0, 10) === dia ? ms : Number.NaN;
}

// o que um Date aguenta, para um lado e para o outro
const LIMITE_DO_DATE_MS = 8.64e15;

// O dia que fica `n` dias antes. Vazio quando o texto não é um dia, quando `n` não é número ou
// quando a conta sai do que o calendário representa com quatro dígitos de ano.
export function diaMenos(dia: string, n: number): string {
  const ms = instanteDoDia(dia) - n * DIA_MS;
  if (!Number.isFinite(ms) || Math.abs(ms) > LIMITE_DO_DATE_MS) return '';
  const texto = new Date(ms).toISOString().slice(0, 10);
  return DIA.test(texto) ? texto : '';
}

// Quantos dias o período tem, contando as duas pontas. 0 quando não dá para contar.
export function diasNoPeriodo(inicio: string, fim: string): number {
  const dias = (instanteDoDia(fim) - instanteDoDia(inicio)) / DIA_MS + 1;
  return Number.isFinite(dias) && dias >= 1 ? Math.round(dias) : 0;
}

// acima disto as barras ficam finas demais para ler: a tela mostra só a tabela
export const TETO_DE_BARRAS = 120;

// Todos os dias do período, do primeiro ao último: o motor só manda os que tiveram execução,
// e o gráfico mostra os outros com a barra vazia. null quando o período não cabe no gráfico.
export function diasDoPeriodo(inicio: string, fim: string, teto: number = TETO_DE_BARRAS): string[] | null {
  const quantos = diasNoPeriodo(inicio, fim);
  // a comparação é escrita assim para um teto que não é número também recusar
  if (quantos === 0 || !(quantos <= teto)) return null;
  const primeiro = instanteDoDia(inicio);
  return Array.from({ length: quantos }, (_, i) => new Date(primeiro + i * DIA_MS).toISOString().slice(0, 10));
}

export interface Escala {
  // o topo do eixo: o primeiro múltiplo do passo que cobre o maior valor
  teto: number;
  // as marcas, de zero ao teto
  marcas: number[];
}

// tira a poeira de ponto flutuante de uma conta com passo decimal (0,1 + 0,2)
const limpo = (valor: number): number => Number(valor.toPrecision(12));

// A faixa em que a escala faz conta. Abaixo do piso (um milionésimo de dólar) o eixo fica no
// piso, e acima do teto fica no teto, com a barra encostada no topo: fora dela a potência de
// dez do passo vira zero ou infinito, e custo desse tamanho não existe.
const PISO_DA_ESCALA = 1e-6;
const TETO_DA_ESCALA = 1e15;

// A escala do eixo vertical: passo "redondo" (1, 2, 2,5 ou 5 vezes uma potência de dez), com
// perto de `alvo` intervalos. Sem valor acima de zero, o eixo vai de 0 a 1.
export function escalaDoEixo(maximoPedido: number, alvoPedido = 4): Escala {
  if (!Number.isFinite(maximoPedido) || maximoPedido <= 0) return { teto: 1, marcas: [0, 1] };
  const maximo = Math.min(TETO_DA_ESCALA, Math.max(PISO_DA_ESCALA, maximoPedido));
  const alvo = Number.isFinite(alvoPedido) && alvoPedido >= 1 ? Math.min(10, Math.floor(alvoPedido)) : 4;
  const bruto = maximo / alvo;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const fracao = bruto / potencia;
  const redondo = [1, 2, 2.5, 5, 10].find((passo) => fracao <= passo * (1 + 1e-9)) ?? 10;
  const passo = limpo(redondo * potencia);
  const intervalos = Math.max(1, Math.ceil(limpo(maximo / passo)));
  return { teto: limpo(passo * intervalos), marcas: Array.from({ length: intervalos + 1 }, (_, i) => limpo(passo * i)) };
}

// Quais barras ganham rótulo no eixo horizontal: a primeira, a última e as que cabem entre
// elas, espaçadas por igual. Com poucas barras, todas.
export function indicesDosRotulos(quantasPedidas: number, maximoPedido = 6): number[] {
  if (!Number.isFinite(quantasPedidas) || quantasPedidas < 1) return [];
  const quantas = Math.floor(quantasPedidas);
  // com menos de dois rótulos não há primeira e última
  const maximo = Number.isFinite(maximoPedido) && maximoPedido >= 2 ? Math.floor(maximoPedido) : 2;
  if (quantas <= maximo) return Array.from({ length: quantas }, (_, i) => i);
  const passo = Math.ceil((quantas - 1) / (maximo - 1));
  const indices: number[] = [];
  for (let i = 0; i < quantas - 1; i += passo) indices.push(i);
  // o último rótulo é sempre o do último dia; o vizinho colado nele sai
  if (quantas - 1 - (indices.at(-1) ?? 0) < passo / 2 && indices.length > 1) indices.pop();
  indices.push(quantas - 1);
  return indices;
}

// A área do desenho, em unidades do viewBox.
export interface Area {
  largura: number;
  altura: number;
  esquerda: number;
  direita: number;
  topo: number;
  base: number;
}

export const AREA_DO_GRAFICO: Area = Object.freeze({ largura: 560, altura: 240, esquerda: 84, direita: 10, topo: 12, base: 30 });

// A área do gráfico da tela, no desenho enxuto: só as barras e a linha de base, sem eixo
// vertical escrito. O SVG estica na largura do cartão (preserveAspectRatio="none"), e os dias
// do começo e do fim do período ficam embaixo, em texto da página, para não esticar com ele.
export const AREA_ENXUTA: Area = Object.freeze({ largura: 1200, altura: 160, esquerda: 0, direita: 0, topo: 4, base: 1 });

export interface Barra {
  dia: string;
  // o valor do dia; 0 para o dia que o motor não mandou
  valor: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  // o meio da barra, onde o rótulo do eixo se apoia
  centro: number;
}

const duasCasas = (valor: number): number => Math.round(valor * 100) / 100;

// O retângulo de cada dia. A barra ocupa 70% da faixa do dia; valor acima de zero nunca fica
// com menos de uma unidade de altura, para não sumir ao lado de um dia muito maior.
export function barrasDoGrafico(dias: readonly string[], valorDoDia: (dia: string) => number | undefined, teto: number, area: Area = AREA_DO_GRAFICO): Barra[] {
  const util = area.largura - area.esquerda - area.direita;
  const alturaUtil = area.altura - area.topo - area.base;
  const faixa = dias.length ? util / dias.length : 0;
  const chao = area.altura - area.base;
  return dias.map((dia, i) => {
    const bruto = valorDoDia(dia);
    const valor = bruto !== undefined && Number.isFinite(bruto) && bruto > 0 ? bruto : 0;
    const proporcao = teto > 0 ? Math.min(1, valor / teto) : 0;
    const altura = valor > 0 ? Math.max(1, proporcao * alturaUtil) : 0;
    return {
      dia,
      valor,
      x: duasCasas(area.esquerda + i * faixa + faixa * 0.15),
      y: duasCasas(chao - altura),
      largura: duasCasas(faixa * 0.7),
      altura: duasCasas(altura),
      centro: duasCasas(area.esquerda + i * faixa + faixa / 2),
    };
  });
}

// A altura (y) de uma marca do eixo vertical.
export function alturaDaMarca(valor: number, teto: number, area: Area = AREA_DO_GRAFICO): number {
  const alturaUtil = area.altura - area.topo - area.base;
  return duasCasas(area.altura - area.base - (teto > 0 ? valor / teto : 0) * alturaUtil);
}

// O dia de maior valor entre os que o motor mandou; em empate, o primeiro. null sem valor
// acima de zero. É comparação para o resumo do gráfico, não soma.
export function maiorDia<T extends { name: string }>(serie: readonly T[], valor: (item: T) => number | undefined): T | null {
  let maior: T | null = null;
  let topo = 0;
  for (const item of serie) {
    const v = valor(item);
    if (v !== undefined && v > topo) {
      maior = item;
      topo = v;
    }
  }
  return maior;
}
