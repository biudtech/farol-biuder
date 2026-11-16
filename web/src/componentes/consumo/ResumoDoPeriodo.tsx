'use client';

// As somas do período, como o motor as mandou, e de onde vem o custo. Nenhum número daqui é
// somado na tela.
import { memo, useId } from 'react';
import type { Relatorio, Soma } from '@/contratos/consumo';
import { textoDoPeriodo } from '@/consumo/consulta';
import { diaPorExtenso, dolar, inteiro, tokens } from '@/consumo/formato';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

function Par({ nome, children }: { nome: string; children: string }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const execucoes = (n: number): string => `${inteiro(n)} ${n === 1 ? 'execução' : 'execuções'}`;

// A modalidade das execuções, nas três parcelas em que o motor as separa (add e addApi,
// lib/usage/report.js): as de assinatura são contadas, as de chave de API só somadas em dólar,
// e as sem modalidade registrada contadas à parte. Nenhuma frase diz "N de M": a diferença
// não é o que foi cobrado.
export function modalidades(totals: Soma): string[] {
  const linhas: string[] = [];
  if (totals.subscription !== undefined && totals.subscription > 0) {
    linhas.push(`Por assinatura: ${execucoes(totals.subscription)}. O valor em dólar delas não é cobrança.`);
  }
  const temApi = (totals.apiUsd ?? 0) > 0 || (totals.apiEstimatedUsd ?? 0) > 0 || (totals.apiUnknown ?? 0) > 0;
  if (temApi) {
    const calculado = totals.apiEstimatedUsd !== undefined && totals.apiEstimatedUsd > 0 ? `, dos quais ${dolar(totals.apiEstimatedUsd)} calculados pelo motor` : '';
    const desconhecido = totals.apiUnknown !== undefined && totals.apiUnknown > 0 ? ` Mais ${execucoes(totals.apiUnknown)} de custo desconhecido.` : '';
    linhas.push(`Por chave de API: ${dolar(totals.apiUsd)}${calculado}. O motor soma o valor e não diz quantas execuções foram.${desconhecido}`);
  }
  if (totals.unknownBilling !== undefined && totals.unknownBilling > 0) {
    linhas.push(`Sem modalidade registrada: ${execucoes(totals.unknownBilling)}. O motor não gravou se rodaram por assinatura ou por chave de API, e a tela não supõe.`);
  }
  return linhas;
}

// O que o período tem de incompleto ou de estimado, com os números do motor.
export function avisosDoPeriodo(relatorio: Relatorio): string[] {
  const { totals, range } = relatorio;
  const avisos: string[] = [];
  avisos.push(...modalidades(totals));
  if (totals.estimatedUsd !== undefined && totals.estimatedUsd > 0) {
    avisos.push(`${dolar(totals.estimatedUsd)} do custo deste período foi calculado pelo motor, para sessão que morreu antes de informar o valor: ele usa a mediana do custo por token de saída das sessões concluídas do mesmo modelo.`);
  }
  if (totals.unknownCost !== undefined && totals.unknownCost > 0) {
    avisos.push(`${inteiro(totals.unknownCost)} ${totals.unknownCost === 1 ? 'execução tem' : 'execuções têm'} custo desconhecido e não ${totals.unknownCost === 1 ? 'entra' : 'entram'} no valor em dólar.`);
  }
  if (relatorio.incomplete === true) {
    avisos.push('O diário tem menos sessões do que o agregado do motor contou: os números desta tela cobrem só o que está no diário.');
  }
  if (relatorio.unidentified !== undefined && relatorio.unidentified > 0) {
    avisos.push(`${inteiro(relatorio.unidentified)} ${relatorio.unidentified === 1 ? 'execução' : 'execuções'} sem identidade de operação: o consumo está nas somas, mas não entra em revisões concluídas nem em retentativas.`);
  }
  if (relatorio.sinceDay !== undefined && range.start < relatorio.sinceDay) {
    avisos.push(`O período começa antes do primeiro registro do diário (${diaPorExtenso(relatorio.sinceDay)}): não há dado dos dias anteriores.`);
  }
  return avisos;
}

interface Props {
  relatorio: Relatorio;
  vazio: string;
}

export const ResumoDoPeriodo = memo(function ResumoDoPeriodo({ relatorio, vazio }: Props) {
  const id = useId();
  const { totals, completed } = relatorio;
  // só o zero que o motor mandou é "sem execução"; contagem ausente mostra o que houver
  const semExecucao = totals.attempts === 0;
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Resumo do período</h2>
      <p className={comuns.meta}>
        {textoDoPeriodo(relatorio.range)}, em dias de Brasília: é nesse fuso que o motor agrupa o diário.
      </p>
      {semExecucao ? <p className={comuns.vazio}>{vazio}</p> : (
        <dl className={estilos.pares}>
          <Par nome="Custo estimado">{dolar(totals.costUsd)}</Par>
          <Par nome="Execuções de IA">{inteiro(totals.attempts)}</Par>
          {relatorio.retries !== undefined ? <Par nome="Retentativas, já contadas nas execuções">{inteiro(relatorio.retries)}</Par> : null}
          {completed ? <Par nome="Revisões concluídas">{inteiro(completed.reviews)}</Par> : null}
          {completed ? <Par nome="PRs com revisão concluída">{inteiro(completed.prs)}</Par> : null}
          <Par nome="Entrada">{tokens(totals.inputTokens)}</Par>
          <Par nome="Saída">{tokens(totals.outputTokens)}</Par>
          <Par nome="Cache lido">{tokens(totals.cacheReadTokens)}</Par>
          <Par nome="Cache criado">{tokens(totals.cacheCreationTokens)}</Par>
        </dl>
      )}
      <p className={comuns.meta}>
        De onde vem o custo: é o valor em dólar que a sessão do Claude Code informa ao terminar. Em perfil de assinatura ninguém cobra esse valor por sessão: ele é uma estimativa, que serve para comparar dias e para o teto.
      </p>
      {semExecucao ? null : avisosDoPeriodo(relatorio).map((aviso) => <p key={aviso} className={comuns.meta}>{aviso}</p>)}
      {completed && !semExecucao ? <p className={comuns.meta}>Revisão concluída é a operação cuja última execução terminou bem no período. Não quer dizer que o review foi publicado.</p> : null}
    </section>
  );
});
