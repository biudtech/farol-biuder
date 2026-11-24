'use client';

// "Revisões que não publicaram" (24/11/2026): as revisões do período que terminaram sem publicar
// nada no PR e sem decisão no histórico, com o motivo que o motor registrou (o PR mergeado antes
// de a sessão abrir, o commit novo durante ela, a queda da sessão, o cancelamento...). Servem para
// remontar o que aconteceu sem achar que foi falha do Farol. A frase é do motor e vai como veio;
// a tela só formata a hora (no fuso de Brasília, o do dia do relatório) e o rótulo da origem.
import { memo } from 'react';
import type { Ocorrencia } from '@/contratos/consumo';
import { urlDoPr } from '@/consumo/formato';
import { FUSO_DO_HISTORICO } from '@/historico/dias';
import { dataComAno } from '@/radar/formato';
import { ReferenciaDoPr } from '../radar/Bloco';
import { ui } from '../ui';
import estilos from './Consumo.module.css';

const ORIGENS: Record<string, string> = {
  clique: 'Clique seu',
  lote: 'Revisar tudo',
  retentativa: 'Nova tentativa automática',
  commit_novo: 'Commit novo',
  rodada_extra: 'Rodada extra',
  fila: 'Pedido de revisão',
};

export function rotuloDaOrigem(origem: string | undefined): string {
  return origem !== undefined && Object.hasOwn(ORIGENS, origem) ? ORIGENS[origem] as string : 'Sem registro';
}

// A chave de cada linha: a hora, o PR e a ordem entre as iguais. Não usa a posição na lista.
function chaves(lista: readonly Ocorrencia[]): string[] {
  const vistas = new Map<string, number>();
  return lista.map((o) => {
    const base = `${o.at}:${o.ref}`;
    const n = vistas.get(base) ?? 0;
    vistas.set(base, n + 1);
    return `${base}:${n}`;
  });
}

export const Ocorrencias = memo(function Ocorrencias({ ocorrencias }: { ocorrencias: readonly Ocorrencia[] }) {
  const ids = chaves(ocorrencias);
  return (
    <section className={estilos.painel} aria-labelledby="consumo-ocorrencias">
      <h2 id="consumo-ocorrencias" className={estilos.tituloDoPainel}>Revisões que não publicaram</h2>
      <p className={ui.mini}>
        Revisões deste período que terminaram sem publicar nada no PR e sem decisão no Histórico, com o motivo que o motor registrou:
        o PR que mudou ou foi mergeado, a revisão cancelada, a sessão que caiu.
      </p>
      {ocorrencias.length === 0 ? <p className={ui.vazio}>Nenhuma revisão terminou sem publicar no período.</p> : (
        <div className={estilos.rolagem} role="region" aria-label="Tabela das revisões que não publicaram" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>A mais recente primeiro (até 200). A hora é a de Brasília.</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col" className={estilos.esquerda}>PR</th>
                <th scope="col" className={estilos.esquerda}>O que aconteceu</th>
                <th scope="col" className={estilos.esquerda}>Origem</th>
                <th scope="col" className={estilos.esquerda}>Sessão</th>
              </tr>
            </thead>
            <tbody>
              {ocorrencias.map((o, i) => (
                <tr key={ids[i]}>
                  <th scope="row">{dataComAno(o.at, FUSO_DO_HISTORICO) || 'Sem data registrada'}</th>
                  <td className={estilos.esquerda}><ReferenciaDoPr chave={o.ref} url={urlDoPr(o.ref)} /></td>
                  <td className={estilos.esquerda}>{o.texto}</td>
                  <td className={estilos.esquerda}>{rotuloDaOrigem(o.origem)}</td>
                  <td className={estilos.esquerda}>{o.sessao ? <code>{o.sessao}</code> : 'Sem sessão'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
