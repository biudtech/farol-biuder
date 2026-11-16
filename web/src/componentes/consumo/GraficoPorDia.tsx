'use client';

// O custo estimado por dia: um gráfico de barras em SVG próprio e a mesma informação numa
// tabela. O gráfico é complemento (uma imagem com um nome que o resume); quem lê os números,
// com leitor de tela ou sem, lê a tabela. O dia é o que o motor definiu: nada é reagrupado.
import { memo, useId, useMemo } from 'react';
import type { Relatorio, SomaComNome } from '@/contratos/consumo';
import { textoDoPeriodo } from '@/consumo/consulta';
import { diaCurto, diaPorExtenso, dolar, dolarDoEixo, inteiro } from '@/consumo/formato';
import { AREA_DO_GRAFICO, TETO_DE_BARRAS, alturaDaMarca, barrasDoGrafico, diasDoPeriodo, escalaDoEixo, indicesDosRotulos, maiorDia } from '@/consumo/grafico';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

interface Props {
  relatorio: Relatorio;
}

const custo = (dia: SomaComNome): number | undefined => dia.costUsd;

// O que o gráfico diz, em uma frase: é o nome da imagem. O total é o que o motor somou.
export function resumoDoGrafico(relatorio: Relatorio): string {
  const { range, series, totals } = relatorio;
  const inicio = `Custo estimado por dia, em dólar, de ${textoDoPeriodo(range)}.`;
  const maior = maiorDia(series, custo);
  if (!maior) return `${inicio} Nenhum dia com custo neste período.`;
  const comExecucao = `${inteiro(series.length)} ${series.length === 1 ? 'dia com execução' : 'dias com execução'}`;
  return `${inicio} ${comExecucao}. Maior dia: ${diaPorExtenso(maior.name)}, com ${dolar(maior.costUsd)}. Custo estimado do período, somado pelo motor: ${dolar(totals.costUsd)}.`;
}

function Grafico({ relatorio, dias }: { relatorio: Relatorio; dias: readonly string[] }) {
  const { series } = relatorio;
  const desenho = useMemo(() => {
    const porDia = new Map(series.map((dia) => [dia.name, dia.costUsd]));
    const maior = maiorDia(series, custo);
    const escala = escalaDoEixo(maior?.costUsd ?? 0);
    const barras = barrasDoGrafico(dias, (dia) => porDia.get(dia), escala.teto);
    return { escala, barras, rotulos: indicesDosRotulos(barras.length) };
  }, [series, dias]);
  const { largura, altura, esquerda, direita, base } = AREA_DO_GRAFICO;
  const passo = desenho.escala.marcas[1] ?? 1;

  return (
    <div className={estilos.rolagem} role="region" aria-label="Gráfico do custo estimado por dia" tabIndex={0}>
      <svg className={estilos.grafico} viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={resumoDoGrafico(relatorio)}>
        {desenho.escala.marcas.map((marca) => {
          const y = alturaDaMarca(marca, desenho.escala.teto);
          return (
            <g key={marca}>
              <line className={marca === 0 ? estilos.eixo : estilos.grade} x1={esquerda} x2={largura - direita} y1={y} y2={y} />
              <text className={estilos.rotuloDoEixo} x={esquerda - 8} y={y + 4} textAnchor="end">{dolarDoEixo(marca, passo)}</text>
            </g>
          );
        })}
        {desenho.barras.map((barra) => (barra.altura > 0 ? (
          <rect key={barra.dia} className={estilos.barra} x={barra.x} y={barra.y} width={barra.largura} height={barra.altura}>
            <title>{`${diaPorExtenso(barra.dia)}: ${dolar(barra.valor)} estimados`}</title>
          </rect>
        ) : null))}
        {desenho.rotulos.map((i) => {
          const barra = desenho.barras[i];
          return barra ? <text key={barra.dia} className={estilos.rotuloDoEixo} x={barra.centro} y={altura - base + 18} textAnchor="middle">{diaCurto(barra.dia)}</text> : null;
        })}
      </svg>
    </div>
  );
}

export const GraficoPorDia = memo(function GraficoPorDia({ relatorio }: Props) {
  const id = useId();
  const { range, series } = relatorio;
  const dias = useMemo(() => diasDoPeriodo(range.start, range.end), [range.start, range.end]);
  // a ordem do dia é formatação: a tabela acompanha o gráfico, do mais antigo ao mais novo
  const ordenada = useMemo(() => [...series].sort((a, b) => a.name.localeCompare(b.name)), [series]);

  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Gasto por dia</h2>
      {dias ? <Grafico relatorio={relatorio} dias={dias} /> : (
        <p className={comuns.meta}>O período passa de {TETO_DE_BARRAS} dias: o gráfico não é desenhado, e a tabela traz todos os dias com execução.</p>
      )}
      {dias ? <p className={comuns.meta}>Barra: custo estimado do dia, em dólar. Dia sem barra não teve execução ou só teve execução de custo desconhecido; a tabela diz qual.</p> : null}
      {ordenada.length ? (
        <div className={estilos.rolagem} role="region" aria-label="Tabela do consumo por dia" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Consumo por dia, só os dias com execução. O dia vira à meia-noite de Brasília, que é o fuso em que o motor agrupa o diário.</caption>
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
      ) : null}
    </section>
  );
});
