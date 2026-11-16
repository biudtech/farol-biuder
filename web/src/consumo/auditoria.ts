// A auditoria do registro inteiro de sessões, em frases: quanto do custo não virou resultado,
// quanto o motor calculou e quanto ficou desconhecido. As somas são do motor
// (auditoriaDeConsumo, lib/engine/usage-desfechos.js, na raiz); a participação é só para
// exibir. O custo é sempre dito estimado: é o valor que a sessão do Claude Code informa, não
// uma cobrança. Nada daqui pausa revisão: o motor não tem teto de gasto.
import type { Auditoria } from '@/contratos/consumo';
import { dolar, inteiro, participacao } from './formato';

const sessoes = (n: number): string => `${inteiro(n)} ${n === 1 ? 'sessão' : 'sessões'}`;

export function linhasDaAuditoria(auditoria: Auditoria): string[] {
  const { total, perdido, estimado, desconhecido } = auditoria;
  const linhas = [`Registro inteiro de sessões: ${dolar(total.costUsd)} estimados em ${sessoes(total.sessions)}.`];
  if (perdido && perdido.sessions > 0) {
    const fatia = participacao(perdido.costUsd, total.costUsd);
    linhas.push(`Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): ${dolar(perdido.costUsd)} em ${sessoes(perdido.sessions)}${fatia ? `, ${fatia} do custo registrado` : ''}.`);
  }
  if (estimado && estimado.sessions > 0) {
    linhas.push(`Custo calculado pelo motor, para sessão que morreu antes de informar: ${dolar(estimado.costUsd)} em ${sessoes(estimado.sessions)}.`);
  }
  if (desconhecido && desconhecido.sessions > 0) {
    linhas.push(`Custo desconhecido: ${sessoes(desconhecido.sessions)}, fora de todo valor em dólar.`);
  }
  return linhas;
}
