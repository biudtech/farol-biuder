'use client';

// O custo por dia (redesenho, lote 5): uma barra por dia do período, cada uma um botão que vira o
// filtro do dia (clicar de novo tira). A barra é SVG próprio (a altura é atributo do SVG, que a CSP
// aceita); o nome de cada botão diz o dia e o valor, e a mesma informação está na tabela da linha
// "Ver em tabela", que é a alternativa em texto. O dia é o que o motor definiu (de Brasília): nada
// é reagrupado. Com um dia clicado, o gráfico continua mostrando o período (o segundo pedido).
import { memo, useMemo } from 'react';
import type { Relatorio, SomaComNome } from '@/contratos/consumo';
import { textoDoPeriodo } from '@/consumo/consulta';
import { diaCurto, diaPorExtenso, dolar, fracao, inteiro } from '@/consumo/formato';
import { TETO_DE_BARRAS, diasDoPeriodo, indicesDosRotulos, maiorDia } from '@/consumo/grafico';
import { Linha, ui } from '../ui';
import estilos from './Consumo.module.css';

const custo = (dia: SomaComNome): number | undefined => dia.costUsd;

// O que o gráfico diz, em uma frase, para quem não vê as barras. O total é o que o motor somou.
export function resumoDoGrafico(relatorio: Relatorio): string {
  const { range, series, totals } = relatorio;
  const inicio = `Custo estimado por dia de Brasília, em dólar, de ${textoDoPeriodo(range)}.`;
  const maior = maiorDia(series, custo);
  if (!maior) return `${inicio} Nenhum dia com custo neste período.`;
  const comExecucao = `${inteiro(series.length)} ${series.length === 1 ? 'dia com execução' : 'dias com execução'}`;
  return `${inicio} ${comExecucao}. Maior dia: ${diaPorExtenso(maior.name)}, com ${dolar(maior.costUsd)}. Custo estimado do período, somado pelo motor: ${dolar(totals.costUsd)}.`;
}

// até quantos dias cada barra leva o valor escrito em cima
const VALOR_ESCRITO_ATE = 14;

interface Props {
  // o relatório do período (sem o dia clicado)
  relatorio: Relatorio;
  // o dia do endereço
  dia: string;
  aoEscolher(dia: string): void;
}

export const CustoPorDia = memo(function CustoPorDia({ relatorio, dia: escolhido, aoEscolher }: Props) {
  const { range, series } = relatorio;
  const dias = useMemo(() => diasDoPeriodo(range.start, range.end), [range.start, range.end]);
  const porDia = useMemo(() => new Map(series.map((d) => [d.name, d.costUsd])), [series]);
  const maior = maiorDia(series, custo)?.costUsd ?? 0;
  const rotulados = useMemo(() => new Set(indicesDosRotulos(dias?.length ?? 0, 7)), [dias]);
  const escrito = (dias?.length ?? 0) <= VALOR_ESCRITO_ATE;

  return (
    <section className={estilos.painel} aria-labelledby="consumo-por-dia">
      <h2 id="consumo-por-dia" className={estilos.tituloDoPainel}>Custo por dia</h2>
      <p className={ui.soLeitor}>{resumoDoGrafico(relatorio)}</p>
      {dias ? (
        <div className={estilos.dias} role="group" aria-label="Custo por dia: cada dia filtra a tela">
          {dias.map((dia, i) => {
            const valor = porDia.get(dia);
            const altura = fracao(valor, maior);
            const ativo = escolhido === dia;
            return (
              <button
                key={dia}
                type="button"
                className={estilos.botaoDeBarra}
                aria-pressed={ativo}
                aria-label={`${ativo ? 'Tirar o filtro do dia' : 'Filtrar pelo dia'} ${diaPorExtenso(dia)}: ${valor === undefined ? 'sem execução' : dolar(valor)}`}
                onClick={() => aoEscolher(dia)}
              >
                {escrito ? <span className={estilos.valorDoDia} aria-hidden="true">{valor === undefined ? '' : dolar(valor).replace('US$ ', '')}</span> : null}
                <span className={estilos.colunaDaBarra} aria-hidden="true">
                  <svg viewBox="0 0 10 100" preserveAspectRatio="none" focusable="false">
                    {altura > 0 ? <rect className={estilos.barraDoDia} x={0} y={100 - altura} width={10} height={altura} /> : null}
                  </svg>
                </span>
                <span className={estilos.rotuloDoDia} aria-hidden="true">{rotulados.has(i) ? diaCurto(dia) : ''}</span>
              </button>
            );
          })}
        </div>
      ) : <p className={ui.mini}>O período passa de {TETO_DE_BARRAS} dias: as barras não são desenhadas, e a tabela traz todos os dias com execução.</p>}
      <TabelaPorDia relatorio={relatorio} />
    </section>
  );
});

// A alternativa em texto do gráfico: a tabela dos dias com execução, fechada numa linha.
export const TabelaPorDia = memo(function TabelaPorDia({ relatorio }: { relatorio: Relatorio }) {
  const { series } = relatorio;
  // a ordem do dia é formatação: a tabela acompanha o gráfico, do mais antigo ao mais novo
  const ordenada = useMemo(() => [...series].sort((a, b) => a.name.localeCompare(b.name)), [series]);
  const resumo = (
    <>
      <span className={ui.t}>Ver em tabela</span>
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
                <th scope="col">Tokens de pensamento</th>
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
                  <td>{inteiro(dia.thinkingTokens)}</td>
                  <td>{inteiro(dia.cacheReadTokens)}</td>
                  <td>{inteiro(dia.cacheCreationTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={ui.mini}>O motor não mandou nenhum dia com execução.</p>}
      <p className={ui.mini}>Dia sem barra não teve execução, ou só teve execução de custo desconhecido; esta tabela diz qual.</p>
    </Linha>
  );
});
