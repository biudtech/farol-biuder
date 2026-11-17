'use client';

// As quebras do período: por tipo de sessão e por modelo, cada uma fechada numa linha com o
// destaque no resumo. As somas são do motor. A participação é a fatia de cada linha no total
// que o motor mandou, calculada só para exibir. A quebra por repositório vem do mesmo
// relatório (custo e execuções de cada repositório no período).
import { memo, useMemo } from 'react';
import type { Relatorio } from '@/contratos/consumo';
import { dolar, inteiro, participacao, rotuloDoModelo, rotuloDoTipo } from '@/consumo/formato';
import { maiorDia } from '@/consumo/grafico';
import { Linha, ui } from '../ui';
import estilos from './Consumo.module.css';

interface Props {
  relatorio: Relatorio;
}

// entrada mais saída de uma mesma linha: é o valor que ordena e a base da participação
function entradaESaida(item: { inputTokens?: number; outputTokens?: number }): number | undefined {
  return item.inputTokens === undefined || item.outputTokens === undefined ? undefined : item.inputTokens + item.outputTokens;
}

function Resumo({ titulo, destaque }: { titulo: string; destaque: string }) {
  return (
    <>
      <span className={ui.t}>{titulo}</span>
      {destaque ? <span className={`${ui.r} ${ui.empurra}`}>{destaque}</span> : null}
    </>
  );
}

// O destaque do resumo: o tipo de maior custo e a fatia dele no total do motor. É comparação
// e formatação, não soma.
export function destaqueDoTipo(relatorio: Relatorio): string {
  const { byKind, totals } = relatorio;
  if (!byKind.length) return 'o motor não mandou';
  const maior = maiorDia(byKind, (tipo) => tipo.costUsd);
  if (!maior) return `${inteiro(byKind.length)} ${byKind.length === 1 ? 'tipo' : 'tipos'}, sem custo`;
  const fatia = participacao(maior.costUsd, totals.costUsd);
  return fatia ? `${rotuloDoTipo(maior.name)} é ${fatia} do custo` : `${rotuloDoTipo(maior.name)} lidera`;
}

export const PorTipo = memo(function PorTipo({ relatorio }: Props) {
  const { byKind, totals } = relatorio;
  return (
    <Linha resumo={<Resumo titulo="Por tipo" destaque={destaqueDoTipo(relatorio)} />}>
      {byKind.length === 0 ? <p className={ui.mini}>O motor não mandou a quebra por tipo.</p> : (
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
    </Linha>
  );
});

export const PorModelo = memo(function PorModelo({ relatorio }: Props) {
  const { models, totals } = relatorio;
  // O motor manda os modelos na ordem em que apareceram no diário, que não é ordem de valor:
  // a tela ordena pelos tokens de entrada e saída, do maior para o menor (é formatação).
  const ordenados = useMemo(() => [...models].sort((a, b) => (entradaESaida(b) ?? -1) - (entradaESaida(a) ?? -1)), [models]);
  const todo = entradaESaida(totals);
  const primeiro = ordenados[0];
  let destaque = 'nenhum modelo';
  if (primeiro) {
    const fatia = participacao(entradaESaida(primeiro), todo);
    destaque = fatia ? `${rotuloDoModelo(primeiro.name)} é ${fatia} dos tokens` : `${inteiro(ordenados.length)} ${ordenados.length === 1 ? 'modelo' : 'modelos'}`;
  }
  return (
    <Linha resumo={<Resumo titulo="Por modelo" destaque={destaque} />}>
      {ordenados.length === 0 ? <p className={ui.mini}>Nenhum modelo com execução neste período.</p> : (
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
      <p className={ui.mini}>O motor não manda custo nem cache por modelo neste relatório. Uma execução que usou dois modelos conta nos dois.</p>
    </Linha>
  );
});

// como a tabela chama o repositório: o nome vazio é o que não é de PR
function rotuloDoRepo(nome: string): string {
  return nome || 'Sem repositório';
}

export function destaqueDoRepo(repos: readonly { name: string; costUsd?: number }[]): string {
  const comNome = repos.filter((r) => r.name);
  const maior = maiorDia(comNome, (r) => r.costUsd);
  if (!maior) return comNome.length ? `${inteiro(comNome.length)} ${comNome.length === 1 ? 'repositório' : 'repositórios'}, sem custo` : 'nenhum repositório';
  return `${maior.name.split('/').pop() ?? maior.name} lidera`;
}

export const PorRepositorio = memo(function PorRepositorio({ relatorio }: Props) {
  const { totals } = relatorio;
  // do maior custo para o menor (é formatação); o que não é de PR vai por último
  const ordenados = useMemo(
    () => [...(relatorio.repos ?? [])].sort((a, b) => Number(!a.name) - Number(!b.name) || (b.costUsd ?? -1) - (a.costUsd ?? -1)),
    [relatorio.repos],
  );
  if (!relatorio.repos) return null;
  return (
    <Linha resumo={<Resumo titulo="Por repositório" destaque={destaqueDoRepo(ordenados)} />}>
      {ordenados.length === 0 ? <p className={ui.mini}>Nenhuma execução neste período.</p> : (
        <div className={estilos.rolagem} role="region" aria-label="Tabela do consumo por repositório" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Consumo do período por repositório, do maior custo ao menor.</caption>
            <thead>
              <tr>
                <th scope="col">Repositório</th>
                <th scope="col">Custo estimado</th>
                <th scope="col">Participação no custo</th>
                <th scope="col">Execuções</th>
                <th scope="col">Execuções de custo desconhecido</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((repo) => (
                <tr key={repo.name || '(sem)'}>
                  <th scope="row">{rotuloDoRepo(repo.name)}</th>
                  <td>{dolar(repo.costUsd)}</td>
                  <td>{participacao(repo.costUsd, totals.costUsd) || 'sem base'}</td>
                  <td>{inteiro(repo.attempts)}</td>
                  <td>{inteiro(repo.unknownCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={ui.mini}>Sem repositório são as execuções que não são de um PR (ferramenta, conversa ou registro antigo). A execução de custo desconhecido não entra na soma.</p>
    </Linha>
  );
});
