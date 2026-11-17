'use client';

// As execuções do período (o diário): uma página de GET /api/usage, fechada numa linha com o
// total de operações no resumo. Dentro ficam a busca, a tabela e a paginação. Quem busca,
// filtra e pagina é o motor. Cada operação aparece pela tentativa mais recente; as anteriores
// (uma retomada, por exemplo) vêm logo abaixo, cada uma com os tokens e o custo dela. Nada é
// somado entre tentativas.
import { memo, useMemo, useRef, useState } from 'react';
import type { Operacao, PaginaDoDiario } from '@/contratos/consumo';
import { inteiro } from '@/consumo/formato';
import { Botao, Linha, ui } from '../ui';
import { BuscaDoDiario } from './Filtros';
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
  // a busca do endereço
  q: string;
  vazio: string;
  // uma carga está no ar: os botões esperam
  ocupado: boolean;
  // a linha nasce aberta quando o endereço já traz busca ou página
  abertaDeInicio: boolean;
  aoBuscar(q: string): void;
  aoIr(pagina: number): void;
}

export const Diario = memo(function Diario({ diario, periodo, q, vazio, ocupado, abertaDeInicio, aoBuscar, aoIr }: Props) {
  const linhas = useMemo(() => linhasDoDiario(diario.rows, periodo), [diario.rows, periodo]);
  // `aberta` da Linha é só o estado inicial: guardado aqui, não muda quando o endereço muda
  const [aberta] = useState(abertaDeInicio);
  const caixa = useRef<HTMLDivElement>(null);
  // no motor a página começa em zero; na tela e no endereço, em um
  const pagina = diario.page + 1;
  const ir = (para: number) => {
    aoIr(para);
    // o foco vai ao resumo da linha: quem estava no pé da tabela volta ao começo dela
    caixa.current?.querySelector('summary')?.focus();
  };
  const resumo = (
    <>
      <span className={ui.t}>Execuções</span>
      <span className={`${ui.r} ${ui.empurra}`}>{diario.total === 0 ? 'nenhuma operação' : `${inteiro(diario.total)} ${diario.total === 1 ? 'operação' : 'operações'}`}</span>
    </>
  );
  return (
    <div ref={caixa}>
      <Linha resumo={resumo} aberta={aberta}>
        <BuscaDoDiario q={q} aoBuscar={aoBuscar} />
        {diario.descartados ? (
          <p className={ui.nota}>
            Atenção: {diario.descartados} operação(ões) desta página chegaram em formato que esta tela não lê e ficaram de fora.
          </p>
        ) : null}
        {diario.total === 0 ? <p className={ui.vazio}>{vazio}</p> : null}
        {linhas.length ? (
          <TabelaDeExecucoes
            nome="Tabela do diário de execuções"
            legenda="Operações com execução no período, a mais recente primeiro, 8 por página. A hora é a do fim de cada execução, no fuso deste navegador."
            linhas={linhas}
          />
        ) : null}
        {linhas.length ? (
          <p className={ui.mini}>
            As linhas não fecham com o total do período: cada operação traz todas as tentativas dela, inclusive as de fora do período ou do filtro, que as somas não contam. As de fora do período estão marcadas na coluna Quando; as de fora do filtro o motor não marca.
          </p>
        ) : null}
        {diario.total > 0 ? (
          <nav className={estilos.paginacao} aria-label="Páginas do diário">
            <Botao pequeno disabled={ocupado || pagina <= 1} aria-label="Página anterior do diário" onClick={() => ir(pagina - 1)}>
              Anterior
            </Botao>
            <p className={estilos.onde}>
              Página {pagina} de {diario.pages} · {inteiro(diario.total)} {diario.total === 1 ? 'operação' : 'operações'}
            </p>
            <Botao pequeno disabled={ocupado || pagina >= diario.pages} aria-label="Próxima página do diário" onClick={() => ir(pagina + 1)}>
              Próxima
            </Botao>
          </nav>
        ) : null}
      </Linha>
    </div>
  );
});
