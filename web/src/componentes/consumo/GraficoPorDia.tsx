'use client';

// O custo estimado por dia: um gráfico de barras em SVG próprio e, numa linha que abre, a
// mesma informação numa tabela. O gráfico é complemento (uma imagem com um nome que o resume);
// quem lê os números, com leitor de tela ou sem, lê a tabela. O dia é o que o motor definiu:
// nada é reagrupado.
import { memo, useMemo } from 'react';
import type { Relatorio, SomaComNome } from '@/contratos/consumo';
import { textoDoPeriodo } from '@/consumo/consulta';
import { diaCurto, diaPorExtenso, dolar, inteiro } from '@/consumo/formato';
import { AREA_ENXUTA, TETO_DE_BARRAS, barrasDoGrafico, diasDoPeriodo, escalaDoEixo, maiorDia } from '@/consumo/grafico';
import { Linha, ui } from '../ui';
import estilos from './Consumo.module.css';

interface Props {
  relatorio: Relatorio;
}

const custo = (dia: SomaComNome): number | undefined => dia.costUsd;

// O que o gráfico diz, em uma frase: é o nome da imagem. O total é o que o motor somou.
export function resumoDoGrafico(relatorio: Relatorio): string {
  const { range, series, totals } = relatorio;
  const inicio = `Custo estimado por dia de Brasília, em dólar, de ${textoDoPeriodo(range)}.`;
  const maior = maiorDia(series, custo);
  if (!maior) return `${inicio} Nenhum dia com custo neste período.`;
  const comExecucao = `${inteiro(series.length)} ${series.length === 1 ? 'dia com execução' : 'dias com execução'}`;
  return `${inicio} ${comExecucao}. Maior dia: ${diaPorExtenso(maior.name)}, com ${dolar(maior.costUsd)}. Custo estimado do período, somado pelo motor: ${dolar(totals.costUsd)}.`;
}

// As barras na primária e a linha de base. O SVG estica na largura do cartão; os dias das
// pontas ficam embaixo, em texto da página.
export const GraficoPorDia = memo(function GraficoPorDia({ relatorio }: Props) {
  const { range, series } = relatorio;
  const dias = useMemo(() => diasDoPeriodo(range.start, range.end), [range.start, range.end]);
  const barras = useMemo(() => {
    if (!dias) return [];
    const porDia = new Map(series.map((dia) => [dia.name, dia.costUsd]));
    const escala = escalaDoEixo(maiorDia(series, custo)?.costUsd ?? 0);
    return barrasDoGrafico(dias, (dia) => porDia.get(dia), escala.teto, AREA_ENXUTA);
  }, [series, dias]);

  if (!dias) {
    return <p className={ui.mini}>O período passa de {TETO_DE_BARRAS} dias: o gráfico não é desenhado, e a tabela Por dia traz todos os dias com execução.</p>;
  }
  const { largura, altura, base } = AREA_ENXUTA;
  const chao = altura - base;
  return (
    <div>
      <svg className={estilos.grafico} viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label={resumoDoGrafico(relatorio)}>
        {barras.map((barra) => (barra.altura > 0 ? (
          <rect key={barra.dia} className={estilos.barra} x={barra.x} y={barra.y} width={barra.largura} height={barra.altura}>
            <title>{`${diaPorExtenso(barra.dia)}: ${dolar(barra.valor)} estimados`}</title>
          </rect>
        ) : null))}
        <line className={estilos.eixo} x1={0} x2={largura} y1={chao} y2={chao} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={estilos.pontas} aria-hidden="true">
        <span className={estilos.rotuloDoEixo}>{diaCurto(range.start)}</span>
        <span className={estilos.rotuloDoEixo}>{diaCurto(range.end)}</span>
      </div>
    </div>
  );
});

// A tabela por dia, fechada numa linha com o resumo de quantos dias tiveram execução.
export const TabelaPorDia = memo(function TabelaPorDia({ relatorio }: Props) {
  const { series } = relatorio;
  // a ordem do dia é formatação: a tabela acompanha o gráfico, do mais antigo ao mais novo
  const ordenada = useMemo(() => [...series].sort((a, b) => a.name.localeCompare(b.name)), [series]);
  const resumo = (
    <>
      <span className={ui.t}>Por dia</span>
      <span className={`${ui.r} ${ui.empurra}`}>{inteiro(ordenada.length)} {ordenada.length === 1 ? 'dia com execução' : 'dias com execução'}</span>
    </>
  );
  return (
    <Linha resumo={resumo}>
      {ordenada.length ? (
        <div className={estilos.rolagem} role="region" aria-label="Tabela do consumo por dia" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Consumo por dia de Brasília (o fuso em que o motor agrupa o diário), só os dias com execução.</caption>
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Custo estimado</th>
                <th scope="col">Execuções</th>
                <th scope="col">Execuções de custo desconhecido</th>
                <th scope="col">Tokens de entrada</th>
                <th scope="col">Tokens de saída</th>
                <th scope="col">Tokens de cache lido</th>
                <th scope="col">Tokens de cache criado</th>
              </tr>
            </thead>
            <tbody>
              {ordenada.map((dia) => (
                <tr key={dia.name}>
                  <th scope="row">{diaPorExtenso(dia.name)}</th>
                  <td>{dolar(dia.costUsd)}</td>
                  <td>{inteiro(dia.attempts)}</td>
                  <td>{inteiro(dia.unknownCost)}</td>
                  <td>{inteiro(dia.inputTokens)}</td>
                  <td>{inteiro(dia.outputTokens)}</td>
                  <td>{inteiro(dia.cacheReadTokens)}</td>
                  <td>{inteiro(dia.cacheCreationTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={ui.mini}>O motor não mandou nenhum dia com execução.</p>}
      <p className={ui.mini}>Barra do gráfico: custo estimado do dia, em dólar. Dia sem barra não teve execução ou só teve execução de custo desconhecido; esta tabela diz qual.</p>
    </Linha>
  );
});
