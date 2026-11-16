'use client';

// As quebras do período: por tipo de sessão e por modelo. As somas são do motor. A
// participação é a fatia de cada linha no total que o motor mandou, calculada só para exibir.
import { memo, useId, useMemo } from 'react';
import type { Relatorio } from '@/contratos/consumo';
import { dolar, inteiro, participacao, rotuloDoModelo, rotuloDoTipo } from '@/consumo/formato';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

interface Props {
  relatorio: Relatorio;
}

// entrada mais saída de uma mesma linha: é o valor que ordena e a base da participação
function entradaESaida(item: { inputTokens?: number; outputTokens?: number }): number | undefined {
  return item.inputTokens === undefined || item.outputTokens === undefined ? undefined : item.inputTokens + item.outputTokens;
}

export const PorTipo = memo(function PorTipo({ relatorio }: Props) {
  const id = useId();
  const { byKind, totals } = relatorio;
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Por tipo de sessão</h2>
      {byKind.length === 0 ? <p className={comuns.vazio}>O motor não mandou a quebra por tipo.</p> : (
        <div className={estilos.rolagem} role="region" aria-label="Tabela do consumo por tipo de sessão" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Consumo do período por tipo de sessão, na ordem do motor.</caption>
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Custo estimado</th>
                <th scope="col">Participação no custo</th>
                <th scope="col">Execuções</th>
                <th scope="col">Tokens de entrada</th>
                <th scope="col">Tokens de saída</th>
                <th scope="col">Tokens de cache lido</th>
                <th scope="col">Tokens de cache criado</th>
              </tr>
            </thead>
            <tbody>
              {byKind.map((tipo) => (
                <tr key={tipo.name}>
                  <th scope="row">{rotuloDoTipo(tipo.name)}</th>
                  <td>{dolar(tipo.costUsd)}</td>
                  <td>{participacao(tipo.costUsd, totals.costUsd) || 'sem base'}</td>
                  <td>{inteiro(tipo.attempts)}</td>
                  <td>{inteiro(tipo.inputTokens)}</td>
                  <td>{inteiro(tipo.outputTokens)}</td>
                  <td>{inteiro(tipo.cacheReadTokens)}</td>
                  <td>{inteiro(tipo.cacheCreationTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});

export const PorModelo = memo(function PorModelo({ relatorio }: Props) {
  const id = useId();
  const { models, totals } = relatorio;
  // O motor manda os modelos na ordem em que apareceram no diário, que não é ordem de valor:
  // a tela ordena pelos tokens de entrada e saída, do maior para o menor (é formatação).
  const ordenados = useMemo(() => [...models].sort((a, b) => (entradaESaida(b) ?? -1) - (entradaESaida(a) ?? -1)), [models]);
  const todo = entradaESaida(totals);
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Por modelo</h2>
      {ordenados.length === 0 ? <p className={comuns.vazio}>Nenhum modelo com execução neste período.</p> : (
        <div className={estilos.rolagem} role="region" aria-label="Tabela do consumo por modelo" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Consumo do período por modelo, do que mais usou tokens de entrada e saída ao que menos usou.</caption>
            <thead>
              <tr>
                <th scope="col">Modelo</th>
                <th scope="col">Execuções</th>
                <th scope="col">Tokens de entrada</th>
                <th scope="col">Tokens de saída</th>
                <th scope="col">Participação nos tokens de entrada e saída</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((modelo) => (
                <tr key={modelo.name}>
                  <th scope="row">{rotuloDoModelo(modelo.name)}</th>
                  <td>{inteiro(modelo.attempts)}</td>
                  <td>{inteiro(modelo.inputTokens)}</td>
                  <td>{inteiro(modelo.outputTokens)}</td>
                  <td>{participacao(entradaESaida(modelo), todo) || 'sem base'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={comuns.meta}>O motor não manda custo nem cache por modelo neste relatório. Uma execução que usou dois modelos conta nos dois.</p>
    </section>
  );
});
