'use client';

// A auditoria do registro inteiro de sessões: quanto do custo estimado não virou resultado,
// quanto o motor calculou e quanto ficou desconhecido. Vem da chave `usage` do snapshot, que o
// motor recalcula quando grava sessão. É só leitura do que foi medido: o motor não tem teto
// de gasto, e nada aqui pausa revisão.
import { memo, useId } from 'react';
import type { Auditoria } from '@/contratos/consumo';
import { linhasDaAuditoria } from '@/consumo/auditoria';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

interface Props {
  // ausente enquanto o snapshot não trouxe a auditoria
  auditoria: Auditoria | undefined;
}

export const AuditoriaDoRegistro = memo(function AuditoriaDoRegistro({ auditoria }: Props) {
  const id = useId();
  return (
    <section className={comuns.bloco} aria-labelledby={id}>
      <h2 id={id} className={comuns.tituloDoBloco}>Auditoria do registro</h2>
      {auditoria ? (
        <ul className={estilos.linhas}>
          {linhasDaAuditoria(auditoria).map((linha) => <li key={linha}>{linha}</li>)}
        </ul>
      ) : <p className={comuns.vazio}>A auditoria do registro ainda não chegou do motor.</p>}
      <p className={comuns.meta}>
        Cobre todo o registro de sessões do motor, sem período nem filtro. O custo é estimado: é o valor que cada sessão informa ao terminar, não uma cobrança.
      </p>
    </section>
  );
});
