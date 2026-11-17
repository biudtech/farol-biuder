'use client';

// As sessões mais recentes do registro, como o snapshot as traz (até 100, a mais nova
// primeiro). Chegam pelo fluxo de eventos, sem pedido: é a parte da tela que anda sozinha. A
// tela mostra as primeiras e deixa abrir o resto; não filtra nem reordena. No desenho enxuto
// ficam fechadas numa linha, com a contagem no resumo.
import { memo, useMemo, useState } from 'react';
import type { Execucao } from '@/contratos/consumo';
import { inteiro } from '@/consumo/formato';
import { dataComAno } from '@/radar/formato';
import { Linha, ui } from '../ui';
import { TabelaDeExecucoes, type LinhaDeExecucao } from './TabelaDeExecucoes';

// quantas aparecem antes de alguém pedir o resto
export const SESSOES_A_VISTA = 10;

// A chave de cada linha: a hora e a ordem entre as de mesma hora. Não usa a posição na lista,
// que muda a cada sessão nova.
function linhasDasSessoes(sessoes: readonly Execucao[]): LinhaDeExecucao[] {
  const vistas = new Map<number, number>();
  return sessoes.map((sessao) => {
    const ordem = vistas.get(sessao.at) ?? 0;
    vistas.set(sessao.at, ordem + 1);
    return { chave: `${sessao.at}:${ordem}`, execucao: sessao };
  });
}

interface Props {
  // ausente enquanto o snapshot não trouxe a lista
  sessoes: readonly Execucao[] | undefined;
  descartadas: number;
  // a hora da primeira sessão do registro individual
  desde: number | undefined;
}

export const SessoesRecentes = memo(function SessoesRecentes({ sessoes, descartadas, desde }: Props) {
  const [todas, setTodas] = useState(false);
  const linhas = useMemo(() => linhasDasSessoes(sessoes ?? []), [sessoes]);
  const mostradas = todas ? linhas : linhas.slice(0, SESSOES_A_VISTA);
  const primeira = dataComAno(desde);
  let contagem = 'ainda não chegaram';
  if (sessoes !== undefined) contagem = linhas.length ? inteiro(linhas.length) : 'nenhuma';
  const resumo = (
    <>
      <span className={ui.t}>Sessões recentes</span>
      <span className={`${ui.r} ${ui.empurra}`}>{contagem}</span>
    </>
  );
  return (
    <Linha resumo={resumo}>
      {sessoes === undefined ? <p className={ui.vazio}>As sessões recentes ainda não chegaram do motor.</p> : null}
      {sessoes !== undefined && linhas.length === 0 && !descartadas ? <p className={ui.vazio}>Nenhuma sessão registrada ainda.</p> : null}
      {descartadas ? (
        <p className={ui.nota}>
          Atenção: {descartadas} sessão(ões) chegaram em formato que esta tela não lê e ficaram de fora.
        </p>
      ) : null}
      {mostradas.length ? (
        <TabelaDeExecucoes
          nome="Tabela das sessões recentes"
          legenda="As sessões mais recentes que o motor registrou, a mais nova primeiro. Atualiza sozinha. A hora é a do fim de cada sessão, no fuso deste navegador."
          linhas={mostradas}
        />
      ) : null}
      {linhas.length > SESSOES_A_VISTA ? (
        <div className={ui.fila}>
          <button type="button" className={`${ui.botao} ${ui.pequeno}`} aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
            {todas ? `Mostrar só as ${SESSOES_A_VISTA} mais recentes` : `Mostrar as ${inteiro(linhas.length)} que o motor mandou`}
          </button>
        </div>
      ) : null}
      {linhas.length ? (
        <p className={ui.mini}>
          O motor manda no máximo as 100 mais recentes; o registro inteiro fica nele, sem poda{primeira ? `, e começa em ${primeira}` : ''}. Para ver as mais antigas, use as Execuções acima.
        </p>
      ) : null}
    </Linha>
  );
});
