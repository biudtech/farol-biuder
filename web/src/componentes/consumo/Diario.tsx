'use client';

// O diário de execuções: uma página de GET /api/usage. Quem busca, filtra e pagina é o motor.
// Cada operação aparece pela tentativa mais recente; as anteriores (uma retomada, por exemplo)
// vêm logo abaixo, cada uma com os tokens e o custo dela. Nada é somado entre tentativas.
import { memo, useId, useMemo, type RefObject } from 'react';
import type { Operacao, PaginaDoDiario } from '@/contratos/consumo';
import { inteiro } from '@/consumo/formato';
import comuns from '../radar/Radar.module.css';
import { TabelaDeExecucoes, type LinhaDeExecucao } from './TabelaDeExecucoes';
import estilos from './Consumo.module.css';

export const FORA_DO_PERIODO = 'fora do período';

// O dia da execução (o que o motor mandou, em dia de Brasília) cai fora do período do
// relatório. É comparação de texto entre dois dias do motor; sem o dia, não dá para dizer.
function foraDoPeriodo(dia: string | undefined, periodo: { start: string; end: string }): boolean {
  return dia !== undefined && (dia < periodo.start || dia > periodo.end);
}

// As linhas da tabela: por operação, da tentativa mais nova à mais antiga. O motor manda todas
// as tentativas da operação, também as que ficaram fora do período: essas saem marcadas.
export function linhasDoDiario(operacoes: readonly Operacao[], periodo: { start: string; end: string }): LinhaDeExecucao[] {
  return operacoes.flatMap((operacao): LinhaDeExecucao[] => {
    const total = operacao.attempts.length;
    if (total <= 1) {
      const execucao = operacao.attempts[0] ?? operacao;
      return [{ chave: operacao.key, execucao, pr: operacao.pr, observacao: foraDoPeriodo(execucao.day, periodo) ? FORA_DO_PERIODO : undefined }];
    }
    return operacao.attempts.map((tentativa, i) => ({
      chave: `${operacao.key}|${i}`,
      execucao: { ...tentativa, ref: tentativa.ref ?? operacao.ref },
      pr: operacao.pr,
      observacao: `tentativa ${i + 1} de ${total} da mesma operação${foraDoPeriodo(tentativa.day, periodo) ? `, ${FORA_DO_PERIODO}` : ''}`,
    })).reverse();
  });
}

interface Props {
  diario: PaginaDoDiario;
  // o período do relatório, para marcar a tentativa que ficou fora dele
  periodo: { start: string; end: string };
  vazio: string;
  // uma carga está no ar: os botões esperam
  ocupado: boolean;
  titulo: RefObject<HTMLHeadingElement | null>;
  aoIr(pagina: number): void;
}

export const Diario = memo(function Diario({ diario, periodo, vazio, ocupado, titulo, aoIr }: Props) {
  const id = useId();
  const linhas = useMemo(() => linhasDoDiario(diario.rows, periodo), [diario.rows, periodo]);
  // no motor a página começa em zero; na tela e no endereço, em um
  const pagina = diario.page + 1;
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} ref={titulo} className={comuns.tituloDoBloco} tabIndex={-1}>Diário de execuções</h2>
      {diario.descartados ? (
        <p className={`${comuns.nota} ${comuns.bloqueio}`}>
          Atenção: {diario.descartados} operação(ões) desta página chegaram em formato que esta tela não lê e ficaram de fora.
        </p>
      ) : null}
      {diario.total === 0 ? <p className={comuns.vazio}>{vazio}</p> : null}
      {linhas.length ? (
        <TabelaDeExecucoes
          nome="Tabela do diário de execuções"
          legenda="Operações com execução no período, a mais recente primeiro, 8 por página. A hora é a do fim de cada execução, no fuso deste navegador."
          linhas={linhas}
        />
      ) : null}
      {linhas.length ? (
        <p className={comuns.meta}>
          As linhas não fecham com o total do período: cada operação traz todas as tentativas dela, inclusive as de fora do período ou do filtro, que as somas não contam. As de fora do período estão marcadas na coluna Quando; as de fora do filtro o motor não marca.
        </p>
      ) : null}
      {diario.total > 0 ? (
        <nav className={estilos.paginacao} aria-label="Páginas do diário">
          <button type="button" className={comuns.botao} disabled={ocupado || pagina <= 1} aria-label="Página anterior do diário" onClick={() => aoIr(pagina - 1)}>
            Anterior
          </button>
          <p className={estilos.onde}>
            Página {pagina} de {diario.pages} · {inteiro(diario.total)} {diario.total === 1 ? 'operação' : 'operações'}
          </p>
          <button type="button" className={comuns.botao} disabled={ocupado || pagina >= diario.pages} aria-label="Próxima página do diário" onClick={() => aoIr(pagina + 1)}>
            Próxima
          </button>
        </nav>
      ) : null}
    </section>
  );
});
