'use client';

// A tabela de execuções de IA, uma por linha: é a mesma para o diário de GET /api/usage e para
// as sessões recentes do snapshot. Cada linha mostra o que existir; o que o motor não mandou
// aparece dito, não como zero. A tabela é larga e rola dentro do próprio contêiner.
import { memo } from 'react';
import type { Execucao } from '@/contratos/consumo';
import { inteiro, rotuloDoDesfecho, rotuloDoModelo, rotuloDoTipo, textoDoCusto, urlDoPr } from '@/consumo/formato';
import { dataComAno } from '@/radar/formato';
import { ReferenciaDoPr } from '../radar/Bloco';
import estilos from './Consumo.module.css';

export interface LinhaDeExecucao {
  chave: string;
  execucao: Partial<Execucao>;
  // a chave canônica do PR, quando o motor a manda à parte da referência
  pr?: string;
  // o que a linha diz além da hora: "tentativa 2 de 3", por exemplo
  observacao?: string;
}

interface Props {
  // o nome da região que rola e da tabela
  nome: string;
  legenda: string;
  linhas: readonly LinhaDeExecucao[];
}

function Referencia({ linha }: { linha: LinhaDeExecucao }) {
  const texto = linha.execucao.ref ?? linha.pr;
  if (!texto) return <>Sem referência</>;
  // o link só existe para chave de PR, e sempre aponta para o GitHub por HTTPS
  return <ReferenciaDoPr chave={texto} url={urlDoPr(linha.pr) ?? urlDoPr(linha.execucao.ref)} />;
}

export const TabelaDeExecucoes = memo(function TabelaDeExecucoes({ nome, legenda, linhas }: Props) {
  return (
    <div className={estilos.rolagem} role="region" aria-label={nome} tabIndex={0}>
      <table className={estilos.tabela}>
        <caption>{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Tipo</th>
            <th scope="col">Modelo</th>
            <th scope="col">PR ou trabalho</th>
            <th scope="col">Tokens de entrada</th>
            <th scope="col">Tokens de saída</th>
            <th scope="col">Tokens de cache lido</th>
            <th scope="col">Tokens de cache criado</th>
            <th scope="col">Custo estimado</th>
            <th scope="col">Desfecho</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => {
            const e = linha.execucao;
            return (
              <tr key={linha.chave}>
                <th scope="row">
                  {dataComAno(e.at) || 'Sem data registrada'}
                  {linha.observacao ? <span className={estilos.observacao}> ({linha.observacao})</span> : null}
                </th>
                <td>{rotuloDoTipo(e.kind)}</td>
                <td>{rotuloDoModelo(e.model)}</td>
                <td><Referencia linha={linha} /></td>
                <td>{inteiro(e.inputTokens)}</td>
                <td>{inteiro(e.outputTokens)}</td>
                <td>{inteiro(e.cacheReadTokens)}</td>
                <td>{inteiro(e.cacheCreationTokens)}</td>
                <td>{textoDoCusto(e)}</td>
                <td>{rotuloDoDesfecho(e.status)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
