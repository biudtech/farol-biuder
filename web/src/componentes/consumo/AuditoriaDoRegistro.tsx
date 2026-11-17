'use client';

// A auditoria do registro inteiro de sessões: quanto do custo estimado não virou resultado,
// quanto o motor calculou e quanto ficou desconhecido. Vem da chave `usage` do snapshot, que o
// motor recalcula quando grava sessão. É só leitura do que foi medido: o motor não tem teto
// de gasto, e nada aqui pausa revisão. No desenho enxuto fica fechada numa linha, com o total
// do registro no resumo.
import { memo } from 'react';
import type { Auditoria } from '@/contratos/consumo';
import { linhasDaAuditoria } from '@/consumo/auditoria';
import { dolar, inteiro } from '@/consumo/formato';
import { Linha, ui } from '../ui';
import estilos from './Consumo.module.css';

interface Props {
  // ausente enquanto o snapshot não trouxe a auditoria
  auditoria: Auditoria | undefined;
}

export const AuditoriaDoRegistro = memo(function AuditoriaDoRegistro({ auditoria }: Props) {
  const total = auditoria?.total;
  const destaque = total
    ? `${dolar(total.costUsd)} em ${inteiro(total.sessions)} ${total.sessions === 1 ? 'sessão' : 'sessões'}`
    : 'ainda não chegou';
  const resumo = (
    <>
      <span className={ui.t}>Auditoria do registro</span>
      <span className={`${ui.r} ${ui.empurra}`}>{destaque}</span>
    </>
  );
  return (
    <Linha resumo={resumo}>
      {auditoria ? (
        <ul className={estilos.linhas}>
          {linhasDaAuditoria(auditoria).map((linha) => <li key={linha}>{linha}</li>)}
        </ul>
      ) : <p className={ui.vazio}>A auditoria do registro ainda não chegou do motor.</p>}
      <p className={ui.mini}>
        Cobre todo o registro de sessões do motor, sem período nem filtro. O custo é estimado: é o valor que cada sessão informa ao terminar, não uma cobrança.
      </p>
    </Linha>
  );
});
