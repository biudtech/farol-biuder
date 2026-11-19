'use client';

// O detalhe do período (redesenho, lote 5): as notas que pesam na leitura dos números, à vista, e
// numa linha que abre o resto das somas do motor, a modalidade e os avisos menores. Nenhum número
// daqui é somado na tela.
import { memo } from 'react';
import type { Relatorio, Soma } from '@/contratos/consumo';
import { diaPorExtenso, dolar, inteiro, tokens } from '@/consumo/formato';
import { Linha, ui } from '../ui';
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

// A modalidade das execuções, nas parcelas em que o motor as separa (add e addApi,
// lib/usage/report.js): as de assinatura são contadas e as de chave de API só somadas em
// dólar. As sem modalidade registrada têm frase própria (semModalidade). Nenhuma frase diz
// "N de M": a diferença não é o que foi cobrado.
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
  return linhas;
}

export function semModalidade(totals: Soma): string | null {
  if (totals.unknownBilling === undefined || !(totals.unknownBilling > 0)) return null;
  return `Sem modalidade registrada: ${execucoes(totals.unknownBilling)}. O motor não gravou se rodaram por assinatura ou por chave de API, e a tela não supõe.`;
}

// Os avisos que pesam na leitura do número grande: ficam à vista, como nota.
export function notasDoPeriodo(relatorio: Relatorio): string[] {
  const notas: string[] = [];
  const sem = semModalidade(relatorio.totals);
  if (sem) notas.push(sem);
  if (relatorio.incomplete === true) {
    notas.push('O diário tem menos sessões do que o agregado do motor contou: os números desta tela cobrem só o que está no diário.');
  }
  if (relatorio.sinceDay !== undefined && relatorio.range.start < relatorio.sinceDay) {
    notas.push(`O período começa antes do primeiro registro do diário (${diaPorExtenso(relatorio.sinceDay)}): não há dado dos dias anteriores.`);
  }
  return notas;
}

// Os avisos menores, com os números do motor: ficam no detalhe do período.
export function avisosDoPeriodo(relatorio: Relatorio): string[] {
  const { totals } = relatorio;
  const avisos: string[] = [];
  if (totals.estimatedUsd !== undefined && totals.estimatedUsd > 0) {
    avisos.push(`${dolar(totals.estimatedUsd)} do custo deste período foi calculado pelo motor, para sessão que morreu antes de informar o valor: ele usa a mediana do custo por token de saída das sessões concluídas do mesmo modelo.`);
  }
  if (totals.unknownCost !== undefined && totals.unknownCost > 0) {
    avisos.push(`${inteiro(totals.unknownCost)} ${totals.unknownCost === 1 ? 'execução tem' : 'execuções têm'} custo desconhecido e não ${totals.unknownCost === 1 ? 'entra' : 'entram'} no valor em dólar.`);
  }
  if (relatorio.unidentified !== undefined && relatorio.unidentified > 0) {
    avisos.push(`${inteiro(relatorio.unidentified)} ${relatorio.unidentified === 1 ? 'execução' : 'execuções'} sem identidade de operação: o consumo está nas somas, mas não entra em revisões concluídas nem em retentativas.`);
  }
  return avisos;
}

// O detalhe do período: o resto das somas do motor e os avisos menores.
export const DetalhesDoPeriodo = memo(function DetalhesDoPeriodo({ relatorio }: { relatorio: Relatorio }) {
  const { totals, completed } = relatorio;
  const avisos = avisosDoPeriodo(relatorio);
  const partes = [completed ? `${inteiro(completed.reviews)} ${completed.reviews === 1 ? 'revisão concluída' : 'revisões concluídas'}` : 'tokens e retentativas'];
  if (avisos.length) partes.push(`${inteiro(avisos.length)} ${avisos.length === 1 ? 'aviso' : 'avisos'}`);
  const resumo = (
    <>
      <span className={ui.t}>Detalhes do período</span>
      <span className={`${ui.r} ${ui.empurra}`}>{partes.join(' · ')}</span>
    </>
  );
  return (
    <Linha resumo={resumo}>
      <dl className={estilos.pares}>
        <Par nome="Execuções de IA">{inteiro(totals.attempts)}</Par>
        {relatorio.retries !== undefined ? <Par nome="Retentativas, já contadas nas execuções">{inteiro(relatorio.retries)}</Par> : null}
        {completed ? <Par nome="Revisões concluídas">{inteiro(completed.reviews)}</Par> : null}
        {completed ? <Par nome="PRs com revisão concluída">{inteiro(completed.prs)}</Par> : null}
        <Par nome="Entrada">{tokens(totals.inputTokens)}</Par>
        <Par nome="Saída">{tokens(totals.outputTokens)}</Par>
        <Par nome="Pensamento">{tokens(totals.thinkingTokens)}</Par>
        <Par nome="Cache lido">{tokens(totals.cacheReadTokens)}</Par>
        <Par nome="Cache criado">{tokens(totals.cacheCreationTokens)}</Par>
      </dl>
      {modalidades(totals).map((linha) => <p key={linha} className={ui.texto}>{linha}</p>)}
      {avisos.map((aviso) => <p key={aviso} className={ui.texto}>{aviso}</p>)}
      <p className={ui.mini}>
        De onde vem o custo: é o valor em dólar que a sessão do Claude Code informa ao terminar. Em perfil de assinatura ninguém cobra esse valor por sessão: ele é uma estimativa, que serve para comparar dias.
      </p>
      {completed ? <p className={ui.mini}>Revisão concluída é a operação cuja última execução terminou bem no período. Não quer dizer que o review foi publicado.</p> : null}
    </Linha>
  );
});
