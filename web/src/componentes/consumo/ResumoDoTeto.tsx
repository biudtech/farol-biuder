'use client';

// O estado do teto de gasto, por perfil do Claude, e a auditoria do registro inteiro. Vem da
// chave `usage` do snapshot, que o motor recalcula a cada envio com a mesma conta do gate. Diz
// em texto se a revisão automática está pausada: a cor só acompanha.
import { memo, useId } from 'react';
import type { Auditoria, TetoDoPerfil } from '@/contratos/consumo';
import { NOTA_DO_DIA_DO_TETO, estadoDoTeto, linhasDaAuditoria } from '@/consumo/teto';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

interface Props {
  // ausente enquanto o snapshot não trouxe a lista
  tetos: readonly TetoDoPerfil[] | undefined;
  descartados: number;
  auditoria: Auditoria | undefined;
}

function Perfil({ teto }: { teto: TetoDoPerfil }) {
  const estado = estadoDoTeto(teto);
  return (
    <li className={comuns.cartao}>
      <h3 className={comuns.tituloDoCartao}>
        {estado.nome} <span className={comuns.selo}>{estado.tipo}</span>
      </h3>
      <p className={estado.pausado ? `${comuns.nota} ${comuns.bloqueio}` : estilos.situacao}>{estado.situacao}</p>
      {estado.linhas.length ? (
        <ul className={estilos.linhas}>
          {estado.linhas.map((linha) => <li key={linha}>{linha}</li>)}
        </ul>
      ) : null}
      {estado.notas.map((nota) => <p key={nota} className={comuns.meta}>{nota}</p>)}
    </li>
  );
}

export const ResumoDoTeto = memo(function ResumoDoTeto({ tetos, descartados, auditoria }: Props) {
  const id = useId();
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Teto de gasto</h2>
      {tetos === undefined ? <p className={comuns.vazio}>O estado do teto ainda não chegou do motor.</p> : null}
      {tetos !== undefined && tetos.length === 0 && !descartados ? (
        <p className={comuns.vazio}>Nenhum perfil do Claude configurado no motor: não há teto, e nada pausa por gasto.</p>
      ) : null}
      {descartados ? (
        <p className={`${comuns.nota} ${comuns.bloqueio}`}>
          Atenção: {descartados} perfil(is) chegaram em formato que esta tela não lê e ficaram de fora.
        </p>
      ) : null}
      {tetos?.length ? (
        <ul className={comuns.lista}>
          {tetos.map((teto) => <Perfil key={teto.id} teto={teto} />)}
        </ul>
      ) : null}
      {tetos?.length ? (
        <p className={comuns.meta}>
          O teto é um limite em dólar por perfil do Claude, definido na configuração do motor (por dia e total). O motor compara o custo estimado com ele antes de iniciar cada revisão automática.
        </p>
      ) : null}
      {tetos?.length ? <p className={comuns.meta}>{NOTA_DO_DIA_DO_TETO}</p> : null}
      {auditoria ? (
        <ul className={estilos.linhas}>
          {linhasDaAuditoria(auditoria).map((linha) => <li key={linha}>{linha}</li>)}
        </ul>
      ) : null}
    </section>
  );
});
